// End-to-End-Test im echten Browser (Chromium/Playwright):
// Anmeldung, Kunden-/Objektanlage, QR-Code, Scanner-Eingabe (Keyboard-Wedge),
// Auftrag, Offline-Ausführung der Checkliste inkl. Foto und Zeitstempel,
// automatische Synchronisation, Service-Worker-Offline-Start, PDF-Erstellung.
// Aufruf: npm run test:e2e
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { createApp } from '../server/app.js';

const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { console.error('Playwright ist nicht installiert (npm i -D playwright).'); process.exit(2); }

const ADMIN = { email: 'admin@e2e.local', pw: 'Start-E2E-2026', pw2: 'Neu-E2E-Passwort-2026' };
const results = [];
const step = async (name, fn) => {
  const t = Date.now();
  try { await fn(); results.push({ name, ok: true, ms: Date.now() - t }); console.log(`  ✓ ${name}`); }
  catch (e) { results.push({ name, ok: false, error: e.message }); console.log(`  ✗ ${name}\n    ${e.message}`); throw e; }
};
const assert = (c, msg) => { if (!c) throw new Error(msg); };

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'grbz-e2e-'));
process.env.GRBZ_ADMIN_EMAIL = ADMIN.email;
process.env.GRBZ_ADMIN_PASSWORD = ADMIN.pw;
const app = createApp({ dataDir, log: () => {}, startTimers: false });
const server = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
const BASE = `http://localhost:${server.address().port}`;
const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
const ctx = await browser.newContext({ viewport: { width: 400, height: 800 }, locale: 'de-DE', timezoneId: 'Europe/Berlin' });
const page = await ctx.newPage();
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(e.message));
page.on('dialog', (d) => d.accept());
const db = app.locals.db;

const go = async (hash) => { await page.evaluate((h) => { location.hash = h; }, hash); await page.waitForTimeout(350); };
const waitSynced = async () => page.waitForFunction(() => document.querySelector('.sync-pill')?.textContent.includes('Synchron'), null, { timeout: 15000 });

let failed = false;
try {
  console.log(`E2E gegen ${BASE}`);
  await step('Anmeldung mit Pflicht-Passwortwechsel', async () => {
    await page.goto(BASE + '/');
    await page.fill('#login-email', ADMIN.email);
    await page.fill('#login-pw', ADMIN.pw);
    await page.click('button[type=submit]');
    await page.waitForSelector('text=Passwort speichern');
    const pw = await page.$$('input[type=password]');
    await pw[0].fill(ADMIN.pw); await pw[1].fill(ADMIN.pw2); await pw[2].fill(ADMIN.pw2);
    await page.click('text=Passwort speichern');
    await page.waitForSelector('.kpis', { timeout: 10000 });
    await waitSynced();
  });

  await step('Service Worker aktiv (PWA installierbar)', async () => {
    const ok = await page.evaluate(async () => { const r = await navigator.serviceWorker.ready; return !!r.active; });
    assert(ok, 'kein aktiver Service Worker');
    const manifest = await (await page.request.get(BASE + '/manifest.webmanifest')).json();
    assert(manifest.display === 'standalone' && manifest.icons.length >= 3, 'Manifest unvollständig');
  });

  await step('Kunde über Formular anlegen', async () => {
    await go('#/kunden/neu');
    await page.locator('.field', { hasText: 'Firmenname' }).locator('input').fill('Hausverwaltung Nord GmbH');
    await page.locator('.field', { hasText: 'Ansprechpartner' }).first().locator('input').fill('Herr Beispiel');
    await page.click('button:has-text("Anlegen")');
    await page.waitForSelector('h1:has-text("Hausverwaltung Nord GmbH")');
    await page.waitForFunction(() => /K-\d{5}/.test(document.querySelector('.page-head .sub')?.textContent || ''), null, { timeout: 8000 });
  });

  let objectId;
  await step('Objekt anlegen → Objekt-ID und QR-Code', async () => {
    await page.click('text=Objekt anlegen');
    await page.waitForSelector('h1:has-text("Objekt anlegen")');
    await page.locator('.field', { hasText: 'Objektname' }).locator('input').fill('Wohnanlage Lindenstraße 5');
    await page.locator('.field', { hasText: 'Straße und Hausnummer' }).locator('input').fill('Lindenstraße 5');
    await page.click('button:has-text("Anlegen")');
    await page.waitForSelector('h1:has-text("Wohnanlage Lindenstraße 5")');
    objectId = page.url().split('/').pop();
    await page.waitForFunction(() => /GRBZ-OBJ-\d{4}/.test(document.querySelector('.page-head .sub')?.textContent || ''), null, { timeout: 8000 });
    await page.click('.tabs button:has-text("QR-Codes")');
    await page.click('.row:has-text("Objekt")');
    await page.waitForSelector('img.qr-img');
    const loaded = await page.$eval('img.qr-img', (i) => new Promise((r) => (i.complete ? r(i.naturalWidth > 0) : (i.onload = () => r(true)))));
    assert(loaded, 'QR-Grafik nicht geladen');
    await page.click('.modal-foot button:has-text("Schließen")');
  });

  await step('Scanner (Keyboard-Wedge) öffnet Objektakte', async () => {
    const qr = db.get("SELECT * FROM qr_codes WHERE object_id = ? AND target_type = 'object'", objectId);
    await go('#/');
    await page.evaluate(() => document.activeElement?.blur());
    await page.keyboard.type(`${BASE}/q/${qr.token}`, { delay: 8 });
    await page.keyboard.press('Enter');
    await page.waitForSelector('h1:has-text("Wohnanlage Lindenstraße 5")', { timeout: 5000 });
    await page.waitForFunction(() => true);
    await page.waitForTimeout(800);
    assert(db.get("SELECT COUNT(*) c FROM scans WHERE method = 'scanner' AND result = 'ok'").c === 1, 'Scan nicht protokolliert');
  });

  let orderId;
  await step('Auftrag (Treppenhausreinigung) für heute anlegen', async () => {
    await go(`#/auftraege/neu?object=${objectId}`);
    const svc = db.get("SELECT id FROM services WHERE name = 'Treppenhausreinigung'").id;
    const admin = db.get("SELECT id FROM users WHERE email = ?", ADMIN.email).id;
    await page.getByLabel('Dienstleistung', { exact: true }).selectOption(svc);
    await page.getByLabel('Mitarbeiter', { exact: true }).selectOption(admin);
    await page.getByLabel('Uhrzeit', { exact: true }).fill('08:00');
    await page.click('button:has-text("Auftrag anlegen")');
    await page.waitForSelector('.check-item');
    orderId = page.url().split('/').pop();
    assert((await page.$$('.check-item')).length === 6, 'Checkliste nicht übernommen');
    await waitSynced();
  });

  await step('OFFLINE: Auftrag starten, Checkliste, Foto, Abschluss', async () => {
    await ctx.setOffline(true);
    await page.waitForTimeout(300);
    await page.click('button:has-text("Auftrag starten")');
    await page.click('.modal-foot button:has-text("Starten + Zeit erfassen")');
    await page.waitForTimeout(400);
    const items = await page.$$('.check-item');
    for (let i = 0; i < items.length; i++) {
      await page.locator('.check-item').nth(i).locator('button.erledigt').click();
      await page.waitForTimeout(150);
    }
    // Foto (Kamera-Eingabe simuliert)
    const jpeg = await page.evaluate(() => { const c = document.createElement('canvas'); c.width = 640; c.height = 480; const x = c.getContext('2d'); x.fillStyle = '#0E7C7B'; x.fillRect(0, 0, 640, 480); x.fillStyle = '#fff'; x.fillText('Nachher', 300, 240); return c.toDataURL('image/jpeg', 0.8); });
    const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.click('.card-head button:has-text("Nachher")')]);
    await chooser.setFiles({ name: 'foto.jpg', mimeType: 'image/jpeg', buffer: Buffer.from(jpeg.split(',')[1], 'base64') });
    await page.click('.modal-foot button:has-text("Speichern")');
    await page.waitForSelector('.photo .ph-pending');
    await page.click('button:has-text("Abschließen")');
    await page.locator('.modal textarea').fill('Treppenhaus vollständig gereinigt (offline erfasst).');
    await page.click('.modal-foot button:has-text("Abschließen")');
    await page.waitForSelector('text=Abgeschlossen am');
    const pill = await page.textContent('.sync-pill');
    assert(/Offline/.test(pill), 'Offline-Status wird nicht angezeigt: ' + pill);
    const server = db.byId('orders', orderId);
    assert(!server.completed_at, 'Server darf offline noch nichts wissen');
  });

  await step('OFFLINE: App-Neustart aus dem Service-Worker-Cache', async () => {
    await page.reload();
    await page.waitForSelector('.check-item', { timeout: 10000 });
    assert(await page.isVisible('text=Abgeschlossen am'), 'lokaler Stand nach Neustart verloren');
  });

  await step('ONLINE: automatische Synchronisation ohne Duplikate', async () => {
    await ctx.setOffline(false);
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await waitSynced();
    const o = db.byId('orders', orderId);
    assert(o.completed_at && o.status === 'abgeschlossen', 'Auftrag nicht synchronisiert');
    assert(o.final_report.includes('offline erfasst'), 'Abschlussbericht fehlt');
    assert(db.get("SELECT COUNT(*) c FROM order_checklist_items WHERE order_id = ? AND result = 'erledigt'", orderId).c === 6, 'Checkliste unvollständig');
    assert(db.get('SELECT COUNT(*) c FROM photos WHERE order_id = ?', orderId).c === 1, 'Foto nicht (oder doppelt) hochgeladen');
    const t = db.get("SELECT * FROM time_entries WHERE order_id = ? AND kind = 'arbeit'", orderId);
    assert(t && t.end_at, 'Arbeitszeit nicht gestempelt/beendet');
    // zweiter Sync-Lauf darf nichts duplizieren
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await page.waitForTimeout(1500);
    assert(db.get('SELECT COUNT(*) c FROM photos').c === 1, 'Duplikat nach erneutem Sync');
  });

  await step('PDF-Leistungsnachweis', async () => {
    const res = await page.request.get(`${BASE}/api/reports/order/${orderId}`);
    assert(res.status() === 200, 'Status ' + res.status());
    const buf = await res.body();
    assert(buf.subarray(0, 4).toString() === '%PDF' && buf.length > 3000, 'kein gültiges PDF');
  });

  await step('Material: Mindestbestand-Warnung', async () => {
    await go('#/material/neu');
    await page.locator('.field', { hasText: 'Bezeichnung' }).locator('input').fill('Allzweckreiniger 10 l');
    await page.locator('.field', { hasText: 'Mindestbestand' }).locator('input').fill('2');
    await page.locator('.field', { hasText: 'Anfangsbestand' }).locator('input').fill('3');
    await page.click('button:has-text("Anlegen")');
    await page.waitForSelector('text=Vorhandener Bestand');
    await page.click('button:has-text("Bestand −")');
    await page.locator('.modal .field', { hasText: 'Menge' }).locator('input').fill('2');
    await page.click('.modal-foot button:has-text("Buchen")');
    await page.waitForSelector('text=Mindestbestand (2');
  });

  assert(!pageErrors.length, 'JavaScript-Fehler: ' + pageErrors.join(' | '));
} catch (e) {
  failed = true;
  await page.screenshot({ path: path.join(os.tmpdir(), 'grbz-e2e-fehler.png'), fullPage: true }).catch(() => {});
  console.log('Screenshot: ' + path.join(os.tmpdir(), 'grbz-e2e-fehler.png'));
} finally {
  await browser.close();
  server.close();
  app.locals.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
}
console.log(`\n${results.filter((r) => r.ok).length}/${results.length} Schritte erfolgreich${pageErrors.length ? ' – JS-Fehler: ' + pageErrors.join(' | ') : ''}`);
process.exit(failed ? 1 : 0);
