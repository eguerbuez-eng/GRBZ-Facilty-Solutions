// Browser-Test: systemweiter Barcode-Scanner + Inventar (Playwright/Chromium).
// Der Honeywell-Scanner wird simuliert: (a) sehr schnelle Tastenanschläge + Enter (Keyboard-Wedge),
// (b) Texteinfügung in einem Stück + Enter (Android-InputConnection), (c) Präfix-Modus.
// Menschliches Tippen wird mit 80–120 ms Abstand simuliert.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { createApp } from '../server/app.js';
import { hashPassword } from '../server/auth.js';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const results = [];
const step = async (name, fn) => {
  try { await fn(); results.push(true); console.log(`  ✓ ${name}`); }
  catch (e) { results.push(false); console.log(`  ✗ ${name}\n    ${e.message.split('\n')[0]}`); throw e; }
};
const assert = (c, msg) => { if (!c) throw new Error(msg); };

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'grbz-e2e-inv-'));
process.env.GRBZ_ADMIN_EMAIL = 'admin@e2e.local'; process.env.GRBZ_ADMIN_PASSWORD = 'Start-E2E-2026';
const app = createApp({ dataDir, log: () => {}, startTimers: false });
const db = app.locals.db;
db.run('UPDATE users SET must_change_password = 0');
const emp = db.insert('users', { name: 'Mia Mitarbeiterin', email: 'mia@e2e.local', role: 'mitarbeiter', employee_no: 'G-0050', password_hash: hashPassword('Mia-Passwort-2026'), active: 1 });
const cust = db.insert('customers', { company_name: 'Scan Kunde', customer_no: 'K-00001' });
const obj = db.insert('objects', { name: 'Bürohaus Scanstraße', object_no: 'GRBZ-OBJ-0001', customer_id: cust.id });
const mat = db.insert('materials', { name: 'Allzweckreiniger 1 l', article_no: 'ART-00001', category: 'reinigungsmittel', barcode: '4012345000017', stock: 24, unit: 'Stück', location: 'Lager A', min_stock: 5 });
const mat2 = db.insert('materials', { name: 'Müllbeutel 120 l', article_no: 'ART-00002', category: 'verbrauchsmaterial', barcode: '4012345000024', stock: 300, unit: 'Stück', location: 'Lager B' });
const server = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
const BASE = `http://localhost:${server.address().port}`;
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 412, height: 900 }, locale: 'de-DE', timezoneId: 'Europe/Berlin' });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const go = async (hash) => { await page.evaluate((x) => { location.hash = x; }, hash); await page.waitForTimeout(500); };
const blur = () => page.evaluate(() => document.activeElement?.blur());
/** Hardware-Scanner (Keyboard-Wedge): Zeichen im Abstand von ~3 ms, danach Enter */
const hwScan = async (code) => { await page.keyboard.type(code, { delay: 3 }); await page.keyboard.press('Enter'); await page.waitForTimeout(450); };
const newest = () => page.locator('.inv-results > div').first();
const login = async (p, email, pw) => { await p.goto(BASE + '/'); await p.fill('#login-email', email); await p.fill('#login-pw', pw); await p.click('button[type=submit]'); await p.waitForSelector('.kpis'); };

let failed = false;
try {
  console.log(`Inventar-/Scanner-E2E gegen ${BASE}`);
  await login(page, 'admin@e2e.local', 'Start-E2E-2026');

  await step('Test 8+1+4: Inventar öffnen und ohne Klick scannen → bekannter Artikel mit Bestand', async () => {
    await go('#/material');
    assert(await page.isVisible('text=Scanner bereit'), 'Scanbereich fehlt');
    await blur();
    await hwScan('4012345000017');
    await newest().locator('h2:has-text("Allzweckreiniger 1 l")').waitFor({ timeout: 4000 });
    const txt = await newest().innerText();
    for (const s of ['24 Stück', 'Lager A', 'ART-00001', '4012345000017', 'Reinigungsmittel', 'Verbrauchsmaterial', 'Verfügbar']) assert(txt.includes(s), `fehlt: ${s}`);
  });

  await step('Test 5: Bestand erhöhen und reduzieren (protokolliert)', async () => {
    await newest().locator('button:has-text("Bestand +")').click();
    await page.locator('.modal input').first().fill('6');
    await page.click('.modal-foot button:has-text("Buchen")');
    await page.waitForTimeout(800);
    assert(db.byId('materials', mat.id).stock === 30, 'Zugang nicht gebucht');
    await newest().locator('button:has-text("Bestand −")').click();
    await page.locator('.modal input').first().fill('4');
    await page.click('.modal-foot button:has-text("Buchen")');
    await page.waitForTimeout(800);
    assert(db.byId('materials', mat.id).stock === 26, 'Verbrauch nicht gebucht');
    assert(await newest().locator('text=26 Stück').first().isVisible(), 'Anzeige nicht aktualisiert');
    assert(db.get("SELECT COUNT(*) c FROM audit_log WHERE action LIKE 'bestand.%'").c === 2, 'nicht protokolliert');
  });

  await step('Negativer Bestand wird abgefangen (Warnung statt stiller Buchung)', async () => {
    await newest().locator('button:has-text("Bestand −")').click();
    await page.locator('.modal input').first().fill('500');
    await page.click('.modal-foot button:has-text("Buchen")');
    await page.waitForSelector('.modal:has-text("Bestand würde negativ werden")');
    await page.click('.modal-foot button:has-text("Abbrechen")');
    await page.waitForTimeout(300);
    assert(db.byId('materials', mat.id).stock === 26, 'trotzdem gebucht');
  });

  await step('Test 2+3: Unbekannter Barcode → Neuanlage einer Maschine mit übernommenem Barcode', async () => {
    await blur();
    await hwScan('SN-KAERCHER-77');
    await page.waitForSelector('.modal:has-text("Unbekannter Barcode SN-KAERCHER-77")');
    await page.click('.modal-foot button:has-text("Maschine / Einzelgerät")');
    await page.waitForSelector('.modal:has-text("Neue Maschine")');
    const bc = page.locator('.modal .field', { has: page.locator('label', { hasText: /^Barcode/ }) }).locator('input');
    assert(await bc.inputValue() === 'SN-KAERCHER-77' && await bc.isDisabled(), 'Barcode nicht übernommen/gesperrt');
    await page.locator('.modal .field', { has: page.locator('label', { hasText: /^Bezeichnung/ }) }).locator('input').fill('Scheuersaugmaschine B 40');
    await page.locator('.modal .field', { has: page.locator('label', { hasText: /^Hersteller/ }) }).locator('input').fill('Kärcher');
    await page.click('.modal-foot button:has-text("Anlegen")');
    await newest().locator('h2:has-text("Scheuersaugmaschine B 40")').waitFor({ timeout: 4000 });
    const m = db.get("SELECT * FROM machines WHERE barcode = 'SN-KAERCHER-77'");
    assert(m && /^MAS-\d{4}$/.test(m.inventory_no), 'Maschine nicht angelegt');
    assert((await newest().innerText()).includes('Einzelstück'), 'Gegenstandsart fehlt');
  });

  await step('Test 6: Maschine einem Objekt zuordnen', async () => {
    await newest().locator('button:has-text("Objekt")').click();
    await page.locator('.modal select').first().selectOption(obj.id);
    await page.click('.modal-foot button:has-text("Speichern")');
    await page.waitForTimeout(800);
    assert(db.get("SELECT object_id FROM machines WHERE barcode = 'SN-KAERCHER-77'").object_id === obj.id, 'nicht zugeordnet');
    assert((await newest().innerText()).includes('Bürohaus Scanstraße'), 'Anzeige fehlt');
  });

  await step('Test 7: mehrere Barcodes direkt hintereinander; Doppelscan wird ignoriert', async () => {
    await blur();
    const before = await page.locator('.inv-results > div').count();
    await page.keyboard.type('4012345000017', { delay: 2 }); await page.keyboard.press('Enter');
    await page.keyboard.type('4012345000024', { delay: 2 }); await page.keyboard.press('Enter');
    await page.keyboard.type('4012345000024', { delay: 2 }); await page.keyboard.press('Enter'); // Doppelscan
    await page.waitForTimeout(1200);
    const after = await page.locator('.inv-results > div').count();
    assert(after - before === 2 || (before >= 5 && after === 6), `erwartet 2 neue Ergebnisse, erhalten ${after - before}`);
    assert(await newest().locator('h2:has-text("Müllbeutel 120 l")').isVisible(), 'letzter Scan nicht oben');
    assert((await page.locator('.inv-results > div').nth(1).innerText()).includes('Allzweckreiniger'), 'erster Scan fehlt');
  });

  await step('Test 9a: Scan während Texteingabe im Inventar – Suchtext bleibt erhalten', async () => {
    const search = page.locator('main input[type=search]');
    await search.click();
    await page.keyboard.type('Müll', { delay: 110 });
    await hwScan('4012345000017');
    assert(await search.inputValue() === 'Müll', `Suchfeld überschrieben: „${await search.inputValue()}“`);
    assert(await newest().locator('h2:has-text("Allzweckreiniger")').isVisible(), 'Scan nicht verarbeitet');
  });

  await step('Test 9b: Scan während Formulareingabe in anderem Modul – Eingabe bleibt, Seite bleibt', async () => {
    await go('#/kunden/neu');
    const name = page.locator('main .field', { has: page.locator('label', { hasText: /^Firmenname/ }) }).locator('input');
    await name.click();
    await page.keyboard.type('Müller GmbH', { delay: 90 });
    await hwScan('4012345000024');
    assert(await name.inputValue() === 'Müller GmbH', `Feld überschrieben: „${await name.inputValue()}“`);
    assert(page.url().includes('#/kunden/neu'), 'Formular wurde verlassen');
    assert(await page.isVisible('.toast:has-text("Ihre Eingabe bleibt erhalten")'), 'Hinweis fehlt');
    await page.keyboard.type(' & Co', { delay: 90 });
    assert(await name.inputValue() === 'Müller GmbH & Co', 'normales Tippen danach gestört');
  });

  await step('Systemweit: Scan auf der Startseite öffnet das Inventar-Ergebnis', async () => {
    await go('#/');
    await blur();
    await hwScan('4012345000024');
    await page.waitForFunction(() => location.hash.startsWith('#/material'));
    await newest().locator('h2:has-text("Müllbeutel 120 l")').waitFor({ timeout: 4000 });
  });

  await step('Android-Wedge (Text in einem Stück) in einem fokussierten Feld', async () => {
    const manual = page.locator('main input[placeholder="Code manuell eingeben"]');
    await manual.click();
    await page.keyboard.insertText('4012345000017');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(500);
    assert(await manual.inputValue() === '', 'Feld nicht leer');
    assert(await newest().locator('h2:has-text("Allzweckreiniger")').isVisible(), 'nicht verarbeitet');
  });

  await step('Android-Tastatur-Ereignisse ohne Zeichen (keyCode 229) – Zeichen über Texteingabe', async () => {
    const search = page.locator('main input[type=search]');
    await search.fill('');
    await search.click();
    await page.evaluate(async (code) => {
      const el = document.activeElement;
      for (const ch of code) {
        el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Unidentified', keyCode: 229, bubbles: true }));
        el.dispatchEvent(new InputEvent('beforeinput', { inputType: 'insertText', data: ch, bubbles: true, cancelable: true }));
        el.value += ch; el.dispatchEvent(new InputEvent('input', { inputType: 'insertText', data: ch, bubbles: true }));
        await new Promise((r) => setTimeout(r, 4));
      }
      el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true, cancelable: true }));
    }, '4012345000024');
    await page.waitForTimeout(500);
    assert(await search.inputValue() === '', `Suchfeld enthält Scan: „${await search.inputValue()}“`);
    assert(await newest().locator('h2:has-text("Müllbeutel")').isVisible(), 'nicht verarbeitet');
  });

  await step('Präfix-Modus (eindeutige Erkennung, auch bei langsamem Scanner)', async () => {
    await page.evaluate(async () => (await import('/js/scanner.js')).saveScannerConfig({ prefix: '~' }));
    await blur();
    await page.keyboard.type('~4012345000024', { delay: 70 });
    await page.keyboard.press('Enter');
    await page.waitForTimeout(500);
    assert(await newest().locator('h2:has-text("Müllbeutel")').isVisible(), 'Präfix-Scan nicht erkannt');
    await page.evaluate(async () => (await import('/js/scanner.js')).saveScannerConfig({ prefix: '' }));
  });

  await step('Test 10: Offline scannen und buchen, danach Synchronisation', async () => {
    await page.evaluate(async () => (await import('/js/store.js')).flush());
    await ctx.setOffline(true);
    await blur();
    await hwScan('4012345000017');
    await newest().locator('h2:has-text("Allzweckreiniger")').waitFor();
    await newest().locator('button:has-text("Bestand −")').click();
    await page.locator('.modal input').first().fill('1');
    await page.click('.modal-foot button:has-text("Buchen")');
    await page.waitForTimeout(700);
    assert((await newest().innerText()).includes('25 Stück'), 'Offline-Bestand nicht angezeigt');
    assert(db.byId('materials', mat.id).stock === 26, 'Server darf offline nichts wissen');
    await ctx.setOffline(false);
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await page.waitForFunction(() => document.querySelector('.sync-pill')?.textContent.includes('Synchron'), null, { timeout: 15000 });
    assert(db.byId('materials', mat.id).stock === 25, 'nicht synchronisiert');
  });

  await step('Berechtigungen: Mitarbeiterin scannt und entnimmt, darf aber nicht zubuchen', async () => {
    const c2 = await browser.newContext({ viewport: { width: 412, height: 900 } });
    const p2 = await c2.newPage();
    p2.on('pageerror', (e) => errors.push('MA: ' + e.message));
    await login(p2, 'mia@e2e.local', 'Mia-Passwort-2026');
    await p2.evaluate(() => { location.hash = '#/material'; }); await p2.waitForTimeout(500);
    await p2.evaluate(() => document.activeElement?.blur());
    await p2.keyboard.type('4012345000017', { delay: 3 }); await p2.keyboard.press('Enter');
    await p2.locator('.inv-results h2:has-text("Allzweckreiniger")').first().waitFor();
    assert(!(await p2.isVisible('.inv-results button:has-text("Bestand +")')), 'Zubuchen sichtbar');
    assert(await p2.isVisible('.inv-results button:has-text("Bestand −")'), 'Entnahme fehlt');
    await p2.keyboard.type('UNBEKANNT-123', { delay: 3 }); await p2.keyboard.press('Enter');
    await p2.waitForSelector('.inv-results h2:has-text("Unbekannter Barcode")');
    assert(await p2.isVisible('text=Für die Neuanlage fehlt Ihnen die Berechtigung'), 'Rechtehinweis fehlt');
    await c2.close();
  });

  assert(!errors.length, 'JavaScript-Fehler: ' + errors.join(' | '));
} catch (e) {
  failed = true;
  await page.screenshot({ path: path.join(os.tmpdir(), 'grbz-e2e-inv-fehler.png'), fullPage: true }).catch(() => {});
  console.log('Screenshot: ' + path.join(os.tmpdir(), 'grbz-e2e-inv-fehler.png'));
} finally {
  await browser.close(); server.close(); app.locals.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
}
console.log(`\n${results.filter(Boolean).length}/${results.length} Schritte erfolgreich`);
process.exit(failed ? 1 : 0);
void emp; void mat2;
