// Browser-Test: Administrator-Funktionen (Status-unabhängige Korrektur, Papierkorb, Datenverwaltung, Sicherung).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { createApp } from '../server/app.js';
import { hashPassword } from '../server/auth.js';
import { todayYmd } from '../shared/dates.js';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const results = [];
const step = async (name, fn) => {
  try { await fn(); results.push(true); console.log(`  ✓ ${name}`); }
  catch (e) { results.push(false); console.log(`  ✗ ${name}\n    ${e.message.split('\n')[0]}`); throw e; }
};
const assert = (c, msg) => { if (!c) throw new Error(msg); };

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'grbz-e2e-admin-'));
process.env.GRBZ_ADMIN_EMAIL = 'admin@e2e.local'; process.env.GRBZ_ADMIN_PASSWORD = 'Start-E2E-2026';
const app = createApp({ dataDir, log: () => {}, startTimers: false });
const db = app.locals.db;
db.run('UPDATE users SET must_change_password = 0');
db.insert('users', { name: 'Gerd Geschäftsführer', email: 'gf@e2e.local', role: 'geschaeftsfuehrer', employee_no: 'G-0099', password_hash: hashPassword('GF-Passwort-2026'), active: 1 });
const server = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
const BASE = `http://localhost:${server.address().port}`;
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'de-DE', timezoneId: 'Europe/Berlin' });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const go = async (hash) => { await page.evaluate((x) => { location.hash = x; }, hash); await page.waitForTimeout(500); };
const login = async (p, email, pw) => { await p.goto(BASE + '/'); await p.fill('#login-email', email); await p.fill('#login-pw', pw); await p.click('button[type=submit]'); await p.waitForSelector('.kpis'); };

let failed = false; let orderId; let objectId;
try {
  console.log(`Admin-E2E gegen ${BASE}`);
  await step('Anmeldung als Administrator, Navigation „Datenverwaltung“', async () => {
    await login(page, 'admin@e2e.local', 'Start-E2E-2026');
    assert(await page.isVisible('nav.sidebar >> text=Datenverwaltung'), 'Navigation fehlt');
    const ids = await page.evaluate(async (today) => {
      const push = async (type, payload) => (await (await fetch('/api/sync/push', { method: 'POST', headers: { 'X-GRBZ': '1', 'Content-Type': 'application/json' }, body: JSON.stringify({ ops: [{ op_id: crypto.randomUUID(), type, payload }] }) })).json()).results[0];
      const c = crypto.randomUUID(); const o = crypto.randomUUID(); const a = crypto.randomUUID();
      await push('entity.save', { entity: 'customers', id: c, data: { company_name: 'Admin Kunde' } });
      await push('entity.save', { entity: 'objects', id: o, data: { customer_id: c, name: 'Objekt Alt' } });
      const svcs = (await (await fetch('/api/sync/pull?since=0')).json()).tables.services;
      await push('order.save', { id: a, data: { object_id: o, service_id: svcs.find((s) => s.name === 'Büroreinigung').id, scheduled_date: today } });
      return { o, a };
    }, todayYmd());
    orderId = ids.a; objectId = ids.o;
    await page.reload(); await page.waitForSelector('.kpis');
  });

  await step('Unvollständigen Auftrag als Admin abschließen (Sicherheitsabfrage)', async () => {
    await go(`#/auftraege/${orderId}`);
    await page.click('button:has-text("Abschließen")');
    await page.click('.modal-foot button:has-text("Trotzdem abschließen (Administrator)")');
    await page.click('.modal-foot button:has-text("Abschließen")');
    await page.waitForSelector('text=Abgeschlossen am');
    assert(db.byId('orders', orderId).completed_at, 'nicht abgeschlossen');
  });

  await step('Abgeschlossenen Auftrag korrigieren und wieder öffnen', async () => {
    await page.locator('.check-item').first().locator('button.erledigt').click();
    await page.waitForTimeout(800);
    assert(db.get("SELECT COUNT(*) c FROM order_checklist_items WHERE order_id = ? AND result = 'erledigt'", orderId).c === 1, 'Korrektur nicht gespeichert');
    await page.click('button:has-text("Wieder öffnen")');
    await page.locator('.modal textarea').fill('Nacharbeit nötig');
    await page.click('.modal-foot button:has-text("Wieder öffnen")');
    await page.waitForTimeout(800);
    assert(!db.byId('orders', orderId).completed_at, 'nicht wieder geöffnet');
  });

  await step('Auftrag löschen → Papierkorb → wiederherstellen', async () => {
    await page.click('.page-head button:has-text("Löschen")');
    await page.click('.modal-foot button:has-text("Löschen")');
    await page.waitForTimeout(800);
    assert(db.byId('orders', orderId).deleted === 1, 'nicht gelöscht');
    await go('#/admin/daten');
    await page.click('.tabs button:has-text("Papierkorb")');
    await page.waitForSelector('.chip:has-text("Aufträge (1)")');
    await page.click('main .row');
    await page.click('.modal-foot button:has-text("Wiederherstellen")');
    await page.waitForTimeout(800);
    assert(db.byId('orders', orderId).deleted === 0, 'nicht wiederhergestellt');
  });

  await step('Datensatz direkt bearbeiten (mit Bestätigung und Protokoll)', async () => {
    await page.click('.tabs button:has-text("Datensätze")');
    await page.locator('main .toolbar select').selectOption('objects');
    await page.waitForSelector('main .row:has-text("Objekt Alt")');
    await page.click('main .row:has-text("Objekt Alt")');
    await page.locator('.modal .field', { has: page.locator('label', { hasText: /^name/ }) }).locator('input').fill('Objekt Neu');
    await page.click('.modal-foot button:has-text("Speichern")');
    await page.click('.modal-foot button:has-text("Ändern")');
    await page.waitForTimeout(800);
    assert(db.byId('objects', objectId).name === 'Objekt Neu', 'nicht geändert');
    assert(db.get("SELECT COUNT(*) c FROM audit_log WHERE action = 'admin.geaendert'").c === 1, 'nicht protokolliert');
  });

  await step('Endgültig löschen nur mit eingegebener Bestätigung', async () => {
    await page.click('main .row:has-text("Objekt Neu")');
    await page.click('.modal-foot button:has-text("Löschen")');
    await page.click('.modal-foot button:has-text("Löschen") >> nth=-1');
    await page.waitForTimeout(800);
    await page.click('.tabs button:has-text("Papierkorb")');
    await page.click('.chip:has-text("Objekte")');
    await page.waitForTimeout(500);
    await page.click('main .row:has-text("Objekt Neu")');
    await page.click('.modal-foot button:has-text("Endgültig löschen")');
    await page.click('.modal-foot button:has-text("Endgültig löschen") >> nth=-1');
    await page.waitForTimeout(400);
    assert(db.byId('objects', objectId), 'ohne Bestätigung gelöscht!');
    await page.locator('.modal input[placeholder="ENDGÜLTIG LÖSCHEN"]').fill('ENDGÜLTIG LÖSCHEN');
    await page.click('.modal-foot button:has-text("Endgültig löschen") >> nth=-1');
    await page.waitForTimeout(1000);
    // Objekt hat noch einen Auftrag → Fremdschlüssel verhindert Löschen mit verständlicher Meldung
    const stillThere = !!db.byId('objects', objectId);
    if (stillThere) assert(await page.isVisible('text=abhängige Datensätze'), 'Meldung zu abhängigen Daten fehlt');
  });

  await step('Sicherung erstellen und wiederherstellen', async () => {
    await page.keyboard.press('Escape');
    await page.click('.tabs button:has-text("Sicherung & Wiederherstellung")');
    await page.click('button:has-text("Jetzt sichern")');
    await page.waitForSelector('main .row:has-text("grbz-manuell")');
    db.run("UPDATE customers SET company_name = 'Nach Sicherung' WHERE company_name = 'Admin Kunde'");
    await page.click('main .row:has-text("grbz-manuell") button:has-text("Wiederherstellen")');
    await page.locator('.modal input[placeholder="WIEDERHERSTELLEN"]').fill('WIEDERHERSTELLEN');
    await page.click('.modal-foot button:has-text("Wiederherstellen")');
    await page.waitForSelector('text=Wiederhergestellt', { timeout: 15000 });
    assert(db.get("SELECT COUNT(*) c FROM customers WHERE company_name = 'Admin Kunde'").c === 1, 'nicht wiederhergestellt');
  });

  await step('Protokoll zeigt Administrator-Aktionen', async () => {
    await go('#/protokoll');
    await page.waitForSelector('td:has-text("Administrator: Datensatz geändert")');
    assert(await page.isVisible('td:has-text("Daten aus Sicherung wiederhergestellt")'), 'Wiederherstellung fehlt im Protokoll');
  });

  await step('Geschäftsführer: keine Datenverwaltung (Oberfläche und Server)', async () => {
    const c2 = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const p2 = await c2.newPage();
    await login(p2, 'gf@e2e.local', 'GF-Passwort-2026');
    assert(!(await p2.isVisible('nav.sidebar >> text=Datenverwaltung')), 'GF sieht Datenverwaltung');
    await p2.evaluate(() => { location.hash = '#/admin/daten'; }); await p2.waitForTimeout(500);
    assert(await p2.isVisible('text=dem Administrator vorbehalten'), 'Hinweis fehlt');
    assert((await p2.request.get(BASE + '/api/admin/records?table=customers')).status() === 403, 'Server erlaubt Zugriff');
    await c2.close();
  });
  assert(!errors.length, 'JavaScript-Fehler: ' + errors.join(' | '));
} catch (e) {
  failed = true;
  await page.screenshot({ path: path.join(os.tmpdir(), 'grbz-e2e-admin-fehler.png'), fullPage: true }).catch(() => {});
  console.log('Screenshot: ' + path.join(os.tmpdir(), 'grbz-e2e-admin-fehler.png'));
} finally {
  await browser.close(); server.close(); app.locals.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
}
console.log(`\n${results.filter(Boolean).length}/${results.length} Schritte erfolgreich`);
process.exit(failed ? 1 : 0);
void crypto;
