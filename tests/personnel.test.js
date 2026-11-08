// Tests der Personalverwaltung: Personalnummern, Migration, Kategorien, Personalakte,
// Rollen/Rechte, Abwesenheiten, Dienstplan, Vertretung, Berechnungsmodelle, Personalkosten.
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { startServer, Client, makeEmployee, loginAs, uid } from './helpers.js';
import { createApp } from '../server/app.js';

let srv; let admin; const S = {};
const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 0.02, `${msg}: erwartet ${b}, erhalten ${a}`);

before(async () => { srv = await startServer(); admin = new Client(srv.base); await admin.loginAdmin(); });
after(async () => { await srv.stop(); });

describe('Personalnummern', () => {
  test('fortlaufend G-0001 …, eindeutig, nach Löschen nicht wiederverwendet', async () => {
    const me = (await admin.get('/api/auth/me')).data.user;
    assert.equal(me.employee_no, 'G-0001');
    const a = await makeEmployee(admin); const b = await makeEmployee(admin);
    assert.equal(a.user.employee_no, 'G-0002');
    assert.equal(b.user.employee_no, 'G-0003');
    assert.equal((await admin.req('DELETE', `/api/users/${b.user.id}`)).status, 200);
    const c = await makeEmployee(admin);
    assert.equal(c.user.employee_no, 'G-0004', 'Nummer G-0003 darf nicht erneut vergeben werden');
    assert.equal(srv.db.byId('users', b.user.id).employee_no, 'G-0003', 'gelöschter Mitarbeiter behält seine Nummer');
    const cust = await admin.ok('entity.save', { entity: 'customers', id: uid(), data: { company_name: 'Portal GmbH' } });
    const k = await makeEmployee(admin, { role: 'kunde', customer_id: cust.row.id });
    assert.equal(k.user.employee_no, null, 'Kundenzugänge erhalten keine Personalnummer');
    S.emp = a; S.cust = cust.row;
  });
});

describe('Migration bestehender Datenbank', () => {
  test('Sicherung, Rollen-Einschränkung entfernt, Personalnummern umgestellt, Daten erhalten', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'grbz-mig-'));
    const file = path.join(dir, 'grbz.sqlite');
    const old = new DatabaseSync(file);
    old.exec(fs.readFileSync(new URL('./fixtures/schema-v1.sql', import.meta.url), 'utf8'));
    const t = '2025-01-01T00:00:00.000Z';
    const ins = old.prepare("INSERT INTO users (id, employee_no, name, email, role, password_hash, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)");
    ins.run('u1', 'MA-001', 'Alt Admin', 'alt@x.de', 'admin', 'x', t, t);
    ins.run('u2', 'MA-002', 'Alt Kraft', 'kraft@x.de', 'mitarbeiter', 'x', '2025-02-01T00:00:00.000Z', t);
    old.exec(`INSERT INTO customers (id, customer_no, company_name, created_at, updated_at) VALUES ('c1','K-00001','Bestandskunde','${t}','${t}')`);
    old.exec(`INSERT INTO objects (id, object_no, customer_id, name, created_at, updated_at) VALUES ('o1','GRBZ-OBJ-0001','c1','Bestandsobjekt','${t}','${t}')`);
    old.exec(`INSERT INTO object_employees (id, object_id, user_id, created_at, updated_at) VALUES ('oe1','o1','u2','${t}','${t}')`);
    old.exec(`INSERT INTO time_entries (id, user_id, kind, start_at, end_at, created_at, updated_at) VALUES ('t1','u2','arbeit','${t}','2025-01-01T04:00:00.000Z','${t}','${t}')`);
    old.close();
    const app = createApp({ dataDir: dir, log: () => {}, startTimers: false });
    const db = app.locals.db;
    assert.ok(db.migration.backup && fs.existsSync(db.migration.backup), 'Sicherung vor Migration fehlt');
    assert.equal(db.migration.from, 1);
    assert.deepEqual(db.all('SELECT id, employee_no, legacy_employee_no FROM users ORDER BY id').map((r) => [r.id, r.employee_no, r.legacy_employee_no]), [['u1', 'G-0001', 'MA-001'], ['u2', 'G-0002', 'MA-002']]);
    assert.equal(db.get("SELECT COUNT(*) c FROM object_employees WHERE user_id = 'u2'").c, 1);
    assert.equal(db.get("SELECT COUNT(*) c FROM time_entries WHERE user_id = 'u2'").c, 1);
    assert.equal(db.get("SELECT name FROM objects WHERE id = 'o1'").name, 'Bestandsobjekt');
    assert.ok(db.byId('employee_profiles', 'u2'), 'Personalakte für Bestandsmitarbeiter angelegt');
    db.run("UPDATE users SET role = 'vorarbeiter' WHERE id = 'u2'"); // neue Rolle zulässig (CHECK entfernt)
    assert.equal(db.raw.prepare('PRAGMA foreign_key_check').all().length, 0);
    app.locals.close();
    // zweiter Start: keine erneute Migration/Umnummerierung
    const app2 = createApp({ dataDir: dir, log: () => {}, startTimers: false });
    assert.equal(app2.locals.db.migration.backup, null);
    assert.equal(app2.locals.db.byId('users', 'u2').employee_no, 'G-0002');
    app2.locals.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe('Kategorien und Personalakte', () => {
  test('eigene Beschäftigungsarten und Positionen anlegen/ändern', async () => {
    const pull = (await admin.get('/api/sync/pull?since=0')).data.tables;
    assert.equal(pull.employment_types.length, 10);
    assert.equal(pull.positions.length, 12);
    const et = await admin.ok('entity.save', { entity: 'employment_types', id: uid(), data: { name: 'Praktikant' } });
    const pos = await admin.ok('entity.save', { entity: 'positions', id: uid(), data: { name: 'Teamleitung Glas' } });
    const pos2 = await admin.ok('entity.save', { entity: 'positions', id: pos.row.id, data: { name: 'Teamleitung Glasreinigung' }, base_version: pos.row.version });
    assert.equal(pos2.row.name, 'Teamleitung Glasreinigung');
    S.et = et.row; S.pos = pos2.row;
    const model = await admin.ok('entity.save', { entity: 'work_models', id: uid(), data: { name: 'Test 0 Std.', day_minutes: [0, 0, 0, 0, 0, 0, 0], holidays_reduce: 0 } });
    S.zero = model.row;
    S.fulltime = srv.db.get("SELECT * FROM work_models WHERE name LIKE 'Montag–Freitag, 8%'");
    const bad = await admin.cmd('entity.save', { entity: 'work_models', id: uid(), data: { name: 'x', day_minutes: [1, 2] } });
    assert.equal(bad.status, 'error');
  });
  test('Personalakte: Position und Beschäftigungsart unabhängig, Vergütung nur mit Recht', async () => {
    const r = await admin.ok('employee.saveProfile', { user_id: S.emp.user.id, data: { employment_type_id: S.et.id, position_id: S.pos.id, pay_type: 'stunde', hourly_rate: '15', work_model_id: S.zero.id, vacation_days: 25, status: 'probezeit' } });
    assert.equal(r.row.hourly_rate, 15);
    // Rolle mit Personalakten-Recht, aber ohne Lohnrecht
    const role = await admin.ok('role.save', { id: uid(), data: { name: 'Personalsachbearbeitung', permissions: ['dashboard.view', 'users.read', 'hr.read', 'hr.manage'] } });
    S.hrRole = role.row;
    const hrUser = await makeEmployee(admin, { role: role.row.role_key });
    const c = await loginAs(srv.base, hrUser);
    const ok = await c.cmd('employee.saveProfile', { user_id: S.emp.user.id, data: { mobile: '0170 1' } });
    assert.equal(ok.status, 'ok');
    const denied = await c.cmd('employee.saveProfile', { user_id: S.emp.user.id, data: { hourly_rate: 99 } });
    assert.equal(denied.http, 403);
    const prof = (await c.get('/api/sync/pull?since=0')).data.tables.employee_profiles.find((p) => p.user_id === S.emp.user.id);
    assert.equal(prof.hourly_rate, undefined, 'Lohn ohne Recht hr.salary nicht sichtbar');
    assert.equal(prof.mobile, '0170 1');
    S.hrClient = c;
  });
});

describe('Rollen und Rechte', () => {
  test('eigene Rolle wirkt sofort; Administratorrolle unveränderbar; keine Rechteausweitung', async () => {
    const me = (await S.hrClient.get('/api/auth/me')).data.user;
    assert.ok(me.permissions.includes('hr.manage') && !me.permissions.includes('customers.read'));
    assert.equal((await S.hrClient.get('/api/personnel/costs')).status, 403);
    await admin.ok('role.save', { id: S.hrRole.id, data: { name: S.hrRole.name, permissions: [...JSON.parse(S.hrRole.permissions), 'customers.read'] }, base_version: S.hrRole.version });
    const me2 = (await S.hrClient.get('/api/auth/me')).data.user;
    assert.ok(me2.permissions.includes('customers.read'), 'geänderte Rechte gelten ohne neue Anmeldung');
    const adminRole = srv.db.get("SELECT id FROM roles WHERE role_key = 'admin'");
    assert.equal((await admin.cmd('role.save', { id: adminRole.id, data: { name: 'x', permissions: [] } })).status, 'error');
    // Objektleiter darf keine Rolle mit mehr Rechten vergeben
    const ol = await loginAs(srv.base, await makeEmployee(admin, { role: 'objektleiter' }));
    const r = await ol.post('/api/users', { name: 'X', email: `x${Date.now()}@t.de`, role: 'geschaeftsfuehrer' });
    assert.equal(r.status, 403);
    const rolesSeeded = srv.db.all('SELECT role_key FROM roles').map((x) => x.role_key);
    for (const k of ['geschaeftsfuehrer', 'admin', 'objektleiter', 'vorarbeiter', 'mitarbeiter', 'minijobber', 'aushilfe']) assert.ok(rolesSeeded.includes(k), k);
  });
  test('Minijobber-Rolle ist auf zugeordnete Objekte beschränkt', async () => {
    const mj = await loginAs(srv.base, await makeEmployee(admin, { role: 'minijobber' }));
    const me = (await mj.get('/api/auth/me')).data.user;
    assert.equal(me.scoped, true);
    const pull = (await mj.get('/api/sync/pull?since=0')).data.tables;
    assert.equal(pull.objects.length, 0);
    assert.equal(pull.pay_rules, undefined);
  });
});

describe('Abwesenheiten, Dienstplan, Vertretung', () => {
  test('Urlaubsantrag → Genehmigung; Arbeitstage nach Arbeitszeitmodell; Überschneidung abgelehnt', async () => {
    const emp = await makeEmployee(admin);
    await admin.ok('employee.saveProfile', { user_id: emp.user.id, data: { work_model_id: S.fulltime.id, vacation_days: 30 } });
    const c = await loginAs(srv.base, emp);
    const r = await c.ok('absence.save', { id: uid(), kind: 'urlaub', start_date: '2026-12-14', end_date: '2026-12-20' });
    assert.equal(r.row.status, 'beantragt');
    assert.equal(r.row.days, 5, 'Mo–Fr = 5 Arbeitstage');
    const dup = await c.cmd('absence.save', { id: uid(), kind: 'urlaub', start_date: '2026-12-18', end_date: '2026-12-18' });
    assert.match(dup.error, /bereits eine Abwesenheit/);
    assert.equal((await c.cmd('absence.decide', { id: r.row.id, approve: true })).http, 403);
    await admin.ok('absence.decide', { id: r.row.id, approve: true });
    const v = (await c.get(`/api/personnel/${emp.user.id}/vacation?year=2026`)).data;
    assert.deepEqual([v.entitlement, v.taken, v.remaining], [30, 5, 25]);
    S.absent = emp; S.absentClient = c; S.absence = r.row;
  });
  test('Schichten: Überschneidung, Abwesenheitswarnung, Woche kopieren, Vertretung', async () => {
    const obj = await admin.ok('entity.save', { entity: 'objects', id: uid(), data: { customer_id: S.cust.id, name: 'Planungsobjekt' } });
    S.obj = obj.row;
    const s1 = await admin.ok('shift.save', { id: uid(), user_id: S.absent.user.id, object_id: obj.row.id, date: '2026-12-07', start_time: '06:00', end_time: '10:00', break_minutes: 0 });
    const over = await admin.cmd('shift.save', { id: uid(), user_id: S.absent.user.id, date: '2026-12-07', start_time: '09:00', end_time: '12:00' });
    assert.match(over.error, /Überschneidung/);
    const night = await admin.ok('shift.save', { id: uid(), user_id: S.absent.user.id, date: '2026-12-08', start_time: '22:00', end_time: '02:00' });
    assert.ok(night.row);
    const copy = await admin.ok('shift.copyWeek', { from_monday: '2026-12-07', to_monday: '2026-12-14' });
    assert.equal(copy.created, 2);
    const warn = await admin.ok('shift.save', { id: uid(), user_id: S.absent.user.id, date: '2026-12-15', start_time: '12:00', end_time: '14:00' });
    assert.match(warn.warnings[0], /abwesend/);
    const affected = srv.db.get("SELECT id FROM shifts WHERE date = '2026-12-14' AND deleted = 0");
    await admin.ok('substitute.assign', { absence_id: S.absence.id, items: [{ type: 'shift', id: affected.id, user_id: S.emp.user.id }] });
    const moved = srv.db.byId('shifts', affected.id);
    assert.equal(moved.user_id, S.emp.user.id);
    assert.equal(moved.replaces_user_id, S.absent.user.id);
    const own = (await S.absentClient.get('/api/sync/pull?since=0')).data.tables.shifts;
    assert.ok(own.every((s) => s.user_id === S.absent.user.id || s.replaces_user_id === S.absent.user.id), 'Mitarbeiter sieht nur eigene Schichten');
    assert.ok(s1.row);
  });
});

describe('Berechnungsmodelle und Personalkosten', () => {
  test('Stundenlohn, Überstunden, Nacht-/Sonntagszuschlag, Objektvergütung, Fahrtkosten, Aufschlag', async () => {
    const u = S.emp.user.id;
    const rule = (name, kind, params, extra = {}) => admin.ok('entity.save', { entity: 'pay_rules', id: uid(), data: { name, kind, scope_type: 'alle', params, active: 1, ...extra } });
    await rule('Überstunden 25 %', 'ueberstunden', { behandlung: 'auszahlen', mode: 'prozent', value: 25 });
    await rule('Nacht 25 %', 'zeitzuschlag', { mode: 'prozent', value: 25, time_from: '22:00', time_to: '06:00', kombinierbar: 1 }, { category: 'nacht' });
    await rule('Sonntag 50 %', 'zeitzuschlag', { mode: 'prozent', value: 50, weekdays: [0], kombinierbar: 1 }, { category: 'sonntag' });
    await rule('Fahrt 5 € je Einsatztag', 'fahrtkosten', { mode: 'pro_einsatztag', value: 5 });
    await rule('AG-Aufschlag 20 %', 'kostenaufschlag', { prozent: 20 });
    await rule('Objektzulage', 'objektverguetung', { mode: 'zuschlag_stunde', value: 2 }, { scope_type: 'objekt', scope_id: S.obj.id });
    const badRule = await admin.cmd('entity.save', { entity: 'pay_rules', id: uid(), data: { name: 'x', kind: 'zeitzuschlag', scope_type: 'alle', params: { mode: 'prozent' } } });
    assert.match(badRule.error, /Zuschlag/);
    // Zeiten im September 2026 (Sommerzeit, UTC+2): So 06.09. 20–24 Uhr, Mo 07.09. 8–17 Uhr mit 30 Min. Pause am Objekt
    const ins = (id, kind, s, e, object_id = null) => srv.db.insert('time_entries', { id, user_id: u, kind, start_at: s, end_at: e, object_id, source: 'stempel' });
    ins(uid(), 'arbeit', '2026-09-06T18:00:00.000Z', '2026-09-06T22:00:00.000Z');
    ins(uid(), 'arbeit', '2026-09-07T06:00:00.000Z', '2026-09-07T15:00:00.000Z', S.obj.id);
    ins(uid(), 'pause', '2026-09-07T10:00:00.000Z', '2026-09-07T10:30:00.000Z');
    const r = (await admin.get(`/api/personnel/${u}/month?month=2026-09`)).data;
    assert.equal(r.hours.worked, 12.5);
    assert.equal(r.hours.soll, 0);
    assert.equal(r.hours.overtime, 12.5);
    near(r.amounts.base, 187.5, 'Grundvergütung');
    near(r.amounts.overtime, 46.88, 'Überstundenzuschlag');
    near(r.amounts.surcharges, 37.5, 'Zuschläge (Nacht 7,50 + Sonntag 30,00)');
    near(r.amounts.object, 17, 'Objektvergütung');
    near(r.amounts.travel, 10, 'Fahrtkosten');
    near(r.amounts.gross, 298.88, 'Brutto intern');
    near(r.amounts.total, 358.65, 'Personalkosten inkl. Aufschlag');
    near(r.amounts.per_hour, 28.69, 'Kosten je Stunde');
    // Mitarbeiterspezifische Regel schlägt allgemeine Regel
    await rule('Nacht 40 % (nur dieser MA)', 'zeitzuschlag', { mode: 'prozent', value: 40, time_from: '22:00', time_to: '06:00', kombinierbar: 1 }, { category: 'nacht', scope_type: 'mitarbeiter', scope_id: u });
    const r2 = (await admin.get(`/api/personnel/${u}/month?month=2026-09`)).data;
    near(r2.amounts.surcharges, 42, 'Nacht 40 % ersetzt 25 % (2 Std. × 15 € × 40 % = 12 + Sonntag 30)');
  });
  test('Personalkosten je Objekt mit Umsatzverhältnis; Rechte; CSV und PDF', async () => {
    await admin.ok('entity.save', { entity: 'object_revenues', id: uid(), data: { object_id: S.obj.id, month: '2026-09', amount: 1000 } });
    const c = (await admin.get('/api/personnel/costs?month=2026-09')).data;
    assert.match(c.disclaimer, /keine Lohnabrechnung/);
    const o = c.objects.find((x) => x.object_id === S.obj.id);
    assert.equal(o.revenue, 1000);
    assert.ok(o.cost > 0 && o.ratio === Math.round((o.cost / 1000) * 10000) / 100);
    const sumObjects = c.objects.reduce((s, x) => s + x.cost, 0);
    near(sumObjects, c.totals.total, 'Summe Objekte = Gesamtkosten');
    const self = (await new Client(srv.base).req('GET', '/api/personnel/costs')).status;
    assert.equal(self, 401);
    const emp = await loginAs(srv.base, S.emp);
    const own = (await emp.get(`/api/personnel/${S.emp.user.id}/month?month=2026-09`)).data;
    assert.equal(own.hours.worked, 12.5);
    assert.equal(own.amounts, undefined, 'Mitarbeiter sieht eigene Stunden, aber keine Kostenbeträge');
    assert.equal((await emp.get(`/api/personnel/${S.absent.user.id}/month`)).status, 403);
    const csv = await admin.req('GET', '/api/export/personalkosten.csv?month=2026-09', undefined, { raw: true });
    assert.match(await csv.text(), /keine Lohnabrechnung/);
    const pdf = await admin.req('GET', '/api/reports/personalkosten?month=2026-09', undefined, { raw: true });
    assert.equal(Buffer.from(await pdf.arrayBuffer()).subarray(0, 4).toString(), '%PDF');
  });
  test('Pausenregel, Rundung, Abwesenheitsgutschrift und Zeitkonto', async () => {
    const e = await makeEmployee(admin);
    const u = e.user.id;
    await admin.ok('employee.saveProfile', { user_id: u, data: { pay_type: 'monat', monthly_salary: 2000, work_model_id: S.fulltime.id } });
    srv.db.run("UPDATE users SET entry_date = '2026-10-01' WHERE id = ?", u);
    await admin.ok('entity.save', { entity: 'pay_rules', id: uid(), data: { name: 'Pause', kind: 'pausenregel', scope_type: 'mitarbeiter', scope_id: u, params: { stufe1_ab: 6, stufe1_pause: 30 }, active: 1 } });
    await admin.ok('entity.save', { entity: 'pay_rules', id: uid(), data: { name: 'Runden 15', kind: 'rundung', scope_type: 'mitarbeiter', scope_id: u, params: { einheit: 15, modus: 'ab' }, active: 1 } });
    // Do 01.10.2026 07:00–14:10 ohne Pause → 7:10 − 30 Min. = 6:40 → abgerundet 6:30
    srv.db.insert('time_entries', { user_id: u, kind: 'arbeit', start_at: '2026-10-01T05:00:00.000Z', end_at: '2026-10-01T12:10:00.000Z', source: 'stempel' });
    await admin.ok('absence.save', { id: uid(), user_id: u, kind: 'krank', start_date: '2026-10-02', end_date: '2026-10-02' });
    const r = (await admin.get(`/api/personnel/${u}/month?month=2026-10`)).data;
    assert.equal(r.hours.worked, 6.5);
    assert.equal(r.hours.auto_pause, 0.5);
    assert.equal(r.hours.absence_credit, 8);
    assert.equal(r.hours.soll, 22 * 8, 'Oktober 2026: 22 Arbeitstage');
    near(r.amounts.base, 2000, 'Monatsgehalt');
    await admin.ok('entity.save', { entity: 'overtime_adjustments', id: uid(), data: { user_id: u, date: '2026-10-15', minutes: 120, reason: 'Übertrag' } });
    const acc = (await admin.get(`/api/personnel/${u}/account?year=2026`)).data;
    const oct = acc.months.find((m) => m.month === '2026-10');
    assert.equal(oct.adjustments, 2);
    assert.equal(oct.overtime, 6.5 + 8 - 176);
  });
});
