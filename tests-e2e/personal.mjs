// Browser-Test der Personalverwaltung (Playwright/Chromium).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { createApp } from '../server/app.js';
import { addDays, todayYmd, weekday } from '../shared/dates.js';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const ADMIN = { email: 'admin@e2e.local', pw: 'Start-E2E-2026', pw2: 'Neu-E2E-Passwort-2026' };
const results = [];
const step = async (name, fn) => {
  try { await fn(); results.push(true); console.log(`  ✓ ${name}`); }
  catch (e) { results.push(false); console.log(`  ✗ ${name}\n    ${e.message.split('\n')[0]}`); throw e; }
};
const assert = (c, msg) => { if (!c) throw new Error(msg); };

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'grbz-e2e-hr-'));
process.env.GRBZ_ADMIN_EMAIL = ADMIN.email;
process.env.GRBZ_ADMIN_PASSWORD = ADMIN.pw;
const app = createApp({ dataDir, log: () => {}, startTimers: false });
const db = app.locals.db;
const server = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
const BASE = `http://localhost:${server.address().port}`;
const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'de-DE', timezoneId: 'Europe/Berlin' });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const go = async (hash) => { await page.evaluate((x) => { location.hash = x; }, hash); await page.waitForTimeout(450); };
const noError = async (where) => { const bad = await page.$('main .notice.bad'); assert(!bad, `${where}: ${bad ? await bad.innerText() : ''}`); };
const esc = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const field = (label, pg = page) => pg.locator('.modal .field, main .field').filter({ has: pg.locator('label', { hasText: new RegExp('^' + esc(label) + '( \\*)?$') }) }).first();
const sync = () => page.evaluate(async () => { const s = await import('/js/store.js'); await s.flush(); });

let failed = false;
let empId; let empPw;
try {
  console.log(`Personal-E2E gegen ${BASE}`);
  await step('Anmeldung', async () => {
    await page.goto(BASE + '/');
    await page.fill('#login-email', ADMIN.email); await page.fill('#login-pw', ADMIN.pw);
    await page.click('button[type=submit]');
    await page.waitForSelector('text=Passwort speichern');
    const pw = await page.$$('input[type=password]');
    await pw[0].fill(ADMIN.pw); await pw[1].fill(ADMIN.pw2); await pw[2].fill(ADMIN.pw2);
    await page.click('text=Passwort speichern');
    await page.waitForSelector('.kpis');
    assert(await page.isVisible('nav.sidebar >> text=Personalkosten'), 'Navigation „Personal“ fehlt');
  });

  await step('Mitarbeiter anlegen → Personalnummer G-0002, Beschäftigung, Stundenlohn', async () => {
    await go('#/mitarbeiter/neu');
    await field('Vor- und Nachname').locator('input').fill('Anna Beispiel');
    await field('E-Mail (Anmeldename)').locator('input').fill('anna@e2e.local');
    await field('Rolle (Zugang & Rechte)').locator('select').selectOption({ label: 'Minijobber' });
    await field('Beschäftigungsart').locator('select').selectOption({ label: 'Minijobber' });
    await field('Position').locator('select').selectOption({ label: 'Reinigungskraft' });
    await field('Arbeitszeitmodell').locator('select').selectOption({ label: 'Montag–Freitag, 4 Std./Tag' });
    await field('Urlaubsanspruch (Tage/Jahr)').locator('input').fill('20');
    await field('Vergütungsart').locator('select').selectOption('stunde');
    await field('Stundenlohn (€)').locator('input').fill('14,50');
    await page.click('button:has-text("Mitarbeiter anlegen")');
    await page.waitForSelector('.modal:has-text("Zugangsdaten")');
    empPw = (await page.textContent('.modal .mono')).trim();
    await page.click('.modal-foot button:has-text("Verstanden")');
    await page.waitForSelector('h1:has-text("Anna Beispiel")');
    assert(await page.isVisible('.page-head .sub:has-text("G-0002")'), 'Personalnummer G-0002 fehlt');
    empId = db.get("SELECT id FROM users WHERE email = 'anna@e2e.local'").id;
    const p = db.byId('employee_profiles', empId);
    assert(p.hourly_rate === 14.5 && p.pay_type === 'stunde', 'Vergütung nicht gespeichert');
  });

  await step('Personalakte: alle Reiter ohne Fehler', async () => {
    for (const t of ['Personalakte', 'Objekte', 'Urlaub & Abwesenheit', 'Arbeitszeit & Überstunden', 'Vergütung & Kosten', 'Dokumente', 'Historie']) {
      await page.click(`.tabs button:has-text("${t}")`);
      await page.waitForTimeout(500);
      await noError(t);
      if (t === 'Vergütung & Kosten') { await page.waitForSelector('text=Bruttovergütung (intern)', { timeout: 5000 }); }
    }
  });

  await step('Berechnungsmodell „Sonntagszuschlag“ über die Oberfläche anlegen', async () => {
    await go('#/lohnmodelle');
    await page.click('button:has-text("Neues Modell")');
    await page.locator('.modal select').first().selectOption('zeitzuschlag');
    await field('Bezeichnung').locator('input').fill('Sonntagszuschlag Test');
    await field('Kategorie').locator('select').selectOption('sonntag');
    await field('Zuschlagsart').locator('select').selectOption('prozent');
    await field('Zuschlag (% bzw. €/Std.)').locator('input').fill('50');
    await page.locator('.modal .weekday-picker label:has-text("So")').click();
    await page.click('.modal-foot button:has-text("Speichern")');
    await page.waitForSelector('main .row:has-text("Sonntagszuschlag Test")');
    const r = db.get("SELECT * FROM pay_rules WHERE name = 'Sonntagszuschlag Test'");
    assert(r && JSON.parse(r.params).weekdays[0] === 0, 'Regel nicht korrekt gespeichert');
  });

  const mon = addDays(todayYmd(), 7 - ((weekday(todayYmd()) + 6) % 7)); // nächster Montag
  await step('Dienstplan: Schicht eintragen (nächste Woche)', async () => {
    await go('#/dienstplan');
    await page.click('button[title="Folgewoche"]');
    await page.waitForTimeout(400);
    const rowEl = page.locator('tr', { has: page.locator('a:has-text("Anna Beispiel")') });
    await rowEl.locator('td').nth(1).locator('button[aria-label="Schicht hinzufügen"]').click();
    await field('Beginn').locator('input').fill('06:00');
    await field('Ende').locator('input').fill('10:00');
    await page.click('.modal-foot button:has-text("Speichern")');
    await page.waitForSelector('td >> text=06:00–10:00');
    await sync();
    assert(db.get('SELECT COUNT(*) c FROM shifts WHERE user_id = ? AND date = ?', empId, mon).c === 1, 'Schicht nicht gespeichert');
  });

  await step('Urlaub erfassen → Vertretungsbedarf → Vertretung zuweisen', async () => {
    await go('#/abwesenheiten');
    await page.click('button:has-text("Abwesenheit erfassen")');
    await field('Mitarbeiter').locator('select').selectOption(empId);
    await field('Von').locator('input').fill(mon);
    await field('Bis').locator('input').fill(addDays(mon, 4));
    await page.click('.modal-foot button:has-text("Speichern")');
    await page.waitForTimeout(800);
    await sync();
    const a = db.get('SELECT * FROM absences WHERE user_id = ?', empId);
    assert(a && a.status === 'genehmigt' && a.days === 5, `Abwesenheit falsch: ${JSON.stringify(a)}`);
    await page.click('.tabs button:has-text("Urlaubsplan")');
    await noError('Urlaubsplan');
    await page.click('.tabs button:has-text("Vertretungsplanung")');
    await page.waitForSelector('main .row:has-text("Schicht 06:00–10:00")');
    const adminId = db.get('SELECT id FROM users WHERE email = ?', ADMIN.email).id;
    await page.locator('main .row:has-text("Schicht 06:00–10:00") select').selectOption(adminId);
    await page.click('main .row:has-text("Schicht 06:00–10:00") button:has-text("Zuweisen")');
    await page.waitForTimeout(800);
    assert(db.get('SELECT user_id, replaces_user_id FROM shifts WHERE date = ?', mon).replaces_user_id === empId, 'Vertretung nicht gespeichert');
  });

  await step('Personalkosten-Übersicht', async () => {
    db.insert('time_entries', { user_id: empId, kind: 'arbeit', start_at: new Date(Date.now() - 4 * 3600e3).toISOString(), end_at: new Date(Date.now() - 3600e3).toISOString(), source: 'stempel' });
    await go('#/personalkosten');
    await page.waitForSelector('text=Je Mitarbeiter');
    await noError('Personalkosten');
    assert(await page.isVisible('td:has-text("Anna Beispiel")'), 'Mitarbeiter fehlt in den Personalkosten');
    assert(await page.isVisible('text=keine Lohnabrechnung'), 'Hinweis „keine Lohnabrechnung“ fehlt');
  });

  await step('Personal-Einstellungen: Position, Feiertag, Arbeitszeitmodell', async () => {
    await go('#/personal/einstellungen');
    await page.click('.tabs button:has-text("Positionen")');
    await page.click('main button:has-text("Neu")');
    await field('Bezeichnung').locator('input').fill('Fassadenreiniger');
    await page.click('.modal-foot button:has-text("Speichern")');
    await page.waitForSelector('main .row:has-text("Fassadenreiniger")');
    await page.click('.tabs button:has-text("Arbeitszeitmodelle")');
    await page.click('main button:has-text("Neu")');
    await field('Bezeichnung').locator('input').fill('Teilzeit 20 Std.');
    const inputs = page.locator('.modal .field').filter({ hasText: 'Soll-Stunden je Wochentag' }).locator('input');
    for (let i = 0; i < 5; i++) await inputs.nth(i).fill('4');
    await page.click('.modal-foot button:has-text("Speichern")');
    await page.waitForSelector('main .row:has-text("20 Std./Woche")');
    await page.click('.tabs button:has-text("Feiertage")');
    await page.click('.card-head button:has-text("Feiertag")');
    await field('Datum').locator('input').fill(`${todayYmd().slice(0, 4)}-12-25`);
    await field('Bezeichnung').locator('input').fill('1. Weihnachtstag');
    await page.click('.modal-foot button:has-text("Speichern")');
    await page.waitForSelector('main .row:has-text("1. Weihnachtstag")');
  });

  await step('Rolle „Hausmeister-Team“ mit eigenen Rechten anlegen', async () => {
    await go('#/rollen');
    await page.click('button:has-text("Neue Rolle")');
    await field('Name der Rolle').locator('input').fill('Hausmeister-Team');
    for (const p of ['Dashboard ansehen', 'Objekte ansehen', 'Eigene Zeiterfassung', 'Maschinen ansehen']) await page.locator('.modal label.check', { hasText: p }).first().locator('input').check();
    await page.click('.modal-foot button:has-text("Speichern")');
    await page.waitForSelector('main .row:has-text("Hausmeister-Team")');
    const r = db.get("SELECT * FROM roles WHERE name = 'Hausmeister-Team'");
    assert(JSON.parse(r.permissions).length === 4, 'Rechte nicht gespeichert');
  });

  await step('Minijobber-Zugang: eigener Dienstplan, Urlaubsantrag, keine Personalkosten', async () => {
    const c2 = await browser.newContext({ viewport: { width: 400, height: 800 }, locale: 'de-DE', timezoneId: 'Europe/Berlin' });
    const p2 = await c2.newPage();
    p2.on('pageerror', (e) => errors.push('MA: ' + e.message));
    await p2.goto(BASE + '/');
    await p2.fill('#login-email', 'anna@e2e.local'); await p2.fill('#login-pw', empPw);
    await p2.click('button[type=submit]');
    await p2.waitForSelector('text=Passwort speichern');
    const pw = await p2.$$('input[type=password]');
    await pw[0].fill(empPw); await pw[1].fill('Anna-Passwort-2026'); await pw[2].fill('Anna-Passwort-2026');
    await p2.click('text=Passwort speichern');
    await p2.waitForSelector('.kpis');
    await p2.evaluate(() => { location.hash = '#/menu'; });
    await p2.waitForTimeout(400);
    assert(!(await p2.isVisible('text=Personalkosten')), 'Minijobber darf Personalkosten nicht sehen');
    assert(await p2.isVisible('.tile:has-text("Dienstplan")'), 'Dienstplan fehlt im Menü');
    await p2.evaluate(() => { location.hash = '#/abwesenheiten'; });
    await p2.waitForTimeout(400);
    await p2.click('button:has-text("Urlaub beantragen")');
    await field('Von', p2).locator('input').fill(addDays(mon, 14));
    await field('Bis', p2).locator('input').fill(addDays(mon, 15));
    await p2.click('.modal-foot button:has-text("Beantragen")');
    await p2.waitForTimeout(1000);
    assert(db.get("SELECT COUNT(*) c FROM absences WHERE user_id = ? AND status = 'beantragt'", empId).c === 1, 'Antrag nicht angekommen');
    const r = await p2.request.get(BASE + '/api/personnel/costs');
    assert(r.status() === 403, 'Personalkosten-API muss gesperrt sein');
    await c2.close();
  });

  assert(!errors.length, 'JavaScript-Fehler: ' + errors.join(' | '));
} catch (e) {
  failed = true;
  await page.screenshot({ path: path.join(os.tmpdir(), 'grbz-e2e-personal-fehler.png'), fullPage: true }).catch(() => {});
  console.log('Screenshot: ' + path.join(os.tmpdir(), 'grbz-e2e-personal-fehler.png'));
} finally {
  await browser.close(); server.close(); app.locals.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
}
console.log(`\n${results.filter(Boolean).length}/${results.length} Schritte erfolgreich${errors.length ? ' – JS-Fehler: ' + errors.join(' | ') : ''}`);
process.exit(failed ? 1 : 0);
