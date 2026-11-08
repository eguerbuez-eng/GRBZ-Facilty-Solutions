// Administrator: uneingeschränkte Rechte, unabhängig vom Status; andere Rollen bleiben eingeschränkt.
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, Client, makeEmployee, loginAs, uid } from './helpers.js';
import { todayYmd } from '../shared/dates.js';

let srv; let admin; const S = {};
const audit = (action) => srv.db.all('SELECT * FROM audit_log WHERE action = ?', action);

before(async () => {
  srv = await startServer(); admin = new Client(srv.base); await admin.loginAdmin();
  const c = await admin.ok('entity.save', { entity: 'customers', id: uid(), data: { company_name: 'Admin-Test GmbH' } });
  const o = await admin.ok('entity.save', { entity: 'objects', id: uid(), data: { customer_id: c.row.id, name: 'Admin-Objekt' } });
  S.obj = o.row;
  S.emp = await makeEmployee(admin);
  S.empC = await loginAs(srv.base, S.emp);
  S.ol = await loginAs(srv.base, await makeEmployee(admin, { role: 'objektleiter' }));
  S.gf = await loginAs(srv.base, await makeEmployee(admin, { role: 'geschaeftsfuehrer' }));
  const svc = srv.db.get("SELECT id FROM services WHERE name = 'Treppenhausreinigung'").id;
  const ord = await admin.ok('order.save', { id: uid(), data: { object_id: o.row.id, service_id: svc, scheduled_date: todayYmd(), assigned_user_id: S.emp.user.id } });
  for (const it of srv.db.all('SELECT id FROM order_checklist_items WHERE order_id = ?', ord.row.id)) await S.empC.ok('order.checkItem', { item_id: it.id, result: 'erledigt' });
  await S.empC.ok('order.complete', { id: ord.row.id });
  S.order = srv.db.byId('orders', ord.row.id);
});
after(async () => { await srv.stop(); });

describe('Status sperrt den Administrator nicht', () => {
  test('abgeschlossener Auftrag: Admin korrigiert Checkliste und plant um; andere Rollen nicht', async () => {
    const item = srv.db.get('SELECT * FROM order_checklist_items WHERE order_id = ?', S.order.id);
    assert.match((await S.empC.cmd('order.checkItem', { item_id: item.id, result: 'nicht_zutreffend' })).error, /bereits abgeschlossen/);
    assert.match((await S.ol.cmd('order.checkItem', { item_id: item.id, result: 'nicht_zutreffend' })).error, /bereits abgeschlossen/);
    await admin.ok('order.checkItem', { item_id: item.id, result: 'nicht_zutreffend' });
    assert.match((await S.ol.cmd('order.save', { id: S.order.id, data: { scheduled_time: '09:00' } })).error, /nicht mehr umgeplant/);
    const r = await admin.ok('order.save', { id: S.order.id, data: { scheduled_time: '09:00' } });
    assert.equal(r.row.scheduled_time, '09:00');
    assert.ok(audit('admin.korrektur_abgeschlossen').length >= 1, 'Korrektur protokolliert');
  });
  test('abgeschlossenen Auftrag löschen: nur Admin', async () => {
    assert.match((await S.ol.cmd('order.delete', { id: S.order.id })).error, /nicht begonnene/);
    await admin.ok('order.delete', { id: S.order.id });
    assert.equal(srv.db.byId('orders', S.order.id).deleted, 1);
    assert.ok(audit('auftrag.geloescht').some((a) => JSON.parse(a.details).admin));
  });
  test('Abschluss trotz unvollständiger Checkliste nur für Admin (force)', async () => {
    const o = await admin.ok('order.save', { id: uid(), data: { object_id: S.obj.id, service_id: srv.db.get("SELECT id FROM services WHERE name = 'Büroreinigung'").id, scheduled_date: todayYmd(), assigned_user_id: S.emp.user.id } });
    assert.equal((await S.empC.cmd('order.complete', { id: o.row.id, force: true })).http, 422);
    const r = await admin.ok('order.complete', { id: o.row.id, force: true });
    assert.ok(r.row.completed_at);
    assert.equal(audit('admin.abschluss_erzwungen').length, 1);
  });
  test('unterschriebener Winterdiensteinsatz: Admin korrigiert und öffnet wieder', async () => {
    const id = uid();
    await S.empC.ok('winter.save', { id, data: { object_id: S.obj.id, start_at: new Date(Date.now() - 3600e3).toISOString(), end_at: new Date().toISOString(), weather: 'glaette', activity: 'gestreut' } });
    srv.db.run('INSERT OR IGNORE INTO object_employees (id, object_id, user_id, created_at, updated_at) VALUES (?,?,?,?,?)', uid(), S.obj.id, S.emp.user.id, 'x', 'x');
    await S.empC.ok('winter.sign', { id, signature: 'data:image/png;base64,iVBORw0KGgo=' });
    assert.match((await S.empC.cmd('winter.save', { id, data: { notes: 'x' } })).error, /abgeschlossen/);
    await admin.ok('winter.save', { id, data: { notes: 'Korrektur Admin' } });
    assert.equal((await S.ol.cmd('winter.reopen', { id, reason: 'x' })).http, 403);
    await admin.ok('winter.reopen', { id, reason: 'Falsche Fläche' });
    assert.equal(srv.db.byId('winter_operations', id).status, 'offen');
  });
  test('entschiedene Anträge: Admin kann umentscheiden (Zeitkorrektur wird zurückgesetzt)', async () => {
    const t0 = new Date(Date.now() - 3 * 3600e3).toISOString();
    const e = await S.empC.ok('time.clock', { id: uid(), action: 'start', at: t0 });
    await S.empC.ok('time.clock', { action: 'stop' });
    const newStart = new Date(Date.parse(t0) - 1800e3).toISOString();
    const c = await S.empC.ok('time.correction', { id: uid(), entry_id: e.row.id, new_start_at: newStart, reason: 'vergessen' });
    await S.ol.ok('time.decide', { id: c.row.id, approve: true });
    assert.equal(srv.db.byId('time_entries', e.row.id).start_at, newStart);
    assert.match((await S.ol.cmd('time.decide', { id: c.row.id, approve: false })).error, /bereits entschieden/);
    await admin.ok('time.decide', { id: c.row.id, approve: false, comment: 'falsch genehmigt' });
    assert.equal(srv.db.byId('time_entries', e.row.id).start_at, e.row.start_at, 'Originalzeit wiederhergestellt');
    const a = await admin.ok('absence.save', { id: uid(), user_id: S.emp.user.id, kind: 'urlaub', start_date: '2026-12-01', end_date: '2026-12-01' });
    await admin.ok('absence.decide', { id: a.row.id, approve: false, note: 'Korrektur' });
    assert.equal(srv.db.byId('absences', a.row.id).status, 'abgelehnt');
  });
});

describe('Datenverwaltung: bearbeiten, löschen, wiederherstellen, endgültig löschen', () => {
  test('nur Administrator – serverseitig (auch Geschäftsführer erhält 403)', async () => {
    assert.equal((await S.gf.get('/api/admin/records?table=customers')).status, 403);
    assert.equal((await S.ol.cmd('admin.delete', { table: 'customers', id: 'x' })).http, 403);
    assert.equal((await S.gf.cmd('admin.update', { table: 'objects', id: S.obj.id, data: { name: 'X' } })).http, 403);
    assert.equal((await admin.get('/api/admin/records?table=customers')).status, 200);
  });
  test('beliebiges Feld ändern mit Protokoll (alt/neu)', async () => {
    await admin.ok('admin.update', { table: 'objects', id: S.obj.id, data: { name: 'Admin-Objekt (korrigiert)', area_sqm: '120,5', password_hash: 'x', id: 'y' } });
    const o = srv.db.byId('objects', S.obj.id);
    assert.equal(o.name, 'Admin-Objekt (korrigiert)');
    assert.equal(o.area_sqm, 120.5);
    const a = audit('admin.geaendert').at(-1);
    assert.deepEqual(JSON.parse(a.details).alt.name, 'Admin-Objekt');
  });
  test('Löschen → Papierkorb → Wiederherstellen → endgültig löschen (mit Sicherheitsabfrage)', async () => {
    const m = await admin.ok('entity.save', { entity: 'machines', id: uid(), data: { name: 'Testsauger' } });
    await admin.ok('machine.event', { id: uid(), machine_id: m.row.id, kind: 'wartung', description: 'x' });
    await admin.ok('admin.delete', { table: 'machines', id: m.row.id });
    const trash = (await admin.get('/api/admin/records?table=machines&deleted=1')).data.rows;
    assert.ok(trash.some((r) => r.id === m.row.id));
    await admin.ok('admin.restore', { table: 'machines', id: m.row.id });
    assert.equal(srv.db.byId('machines', m.row.id).deleted, 0);
    assert.match((await admin.cmd('admin.hardDelete', { table: 'machines', id: m.row.id, confirm: 'ENDGÜLTIG LÖSCHEN' })).error, /Papierkorb/);
    await admin.ok('admin.delete', { table: 'machines', id: m.row.id });
    assert.match((await admin.cmd('admin.hardDelete', { table: 'machines', id: m.row.id })).error, /Sicherheitsabfrage/);
    const r = await admin.ok('admin.hardDelete', { table: 'machines', id: m.row.id, confirm: 'ENDGÜLTIG LÖSCHEN' });
    assert.equal(srv.db.byId('machines', m.row.id), undefined);
    assert.deepEqual(r.removed, ['machine_events: 1']);
    for (const x of ['admin.geloescht', 'admin.wiederhergestellt', 'admin.endgueltig_geloescht']) assert.ok(audit(x).length, x);
  });
  test('Bestandsbewegung löschen korrigiert den Bestand', async () => {
    const mat = await admin.ok('entity.save', { entity: 'materials', id: uid(), data: { name: 'Reiniger', stock: 10 } });
    const mv = await admin.ok('stock.move', { id: uid(), material_id: mat.row.id, qty: 3, kind: 'verbrauch' });
    await admin.ok('admin.delete', { table: 'stock_movements', id: mv.row.id });
    assert.equal(srv.db.byId('materials', mat.row.id).stock, 10);
  });
  test('Schutz vor Selbstaussperrung bleibt bestehen', async () => {
    const me = (await admin.get('/api/auth/me')).data.user;
    assert.match((await admin.cmd('admin.delete', { table: 'users', id: me.id })).error, /eigenes Konto/);
    const adminRole = srv.db.get("SELECT id FROM roles WHERE role_key = 'admin'").id;
    assert.equal((await admin.cmd('role.delete', { id: adminRole })).status, 'error');
    const aushilfe = srv.db.get("SELECT id FROM roles WHERE role_key = 'aushilfe'").id;
    await admin.ok('role.delete', { id: aushilfe });
  });
});

describe('Sicherung und Wiederherstellung', () => {
  test('Sicherung erstellen, Daten ändern, Wiederherstellen (vorher automatische Sicherung)', async () => {
    const b = await admin.post('/api/admin/backups');
    assert.equal(b.status, 200);
    const name = b.data.name;
    await admin.ok('admin.update', { table: 'objects', id: S.obj.id, data: { name: 'Nach der Sicherung geändert' } });
    const bad = await admin.post('/api/admin/backups/restore', { name, confirm: 'ja' });
    assert.equal(bad.status, 400);
    assert.equal((await S.gf.post('/api/admin/backups/restore', { name, confirm: 'WIEDERHERSTELLEN' })).status, 403);
    const epochBefore = (await admin.get('/api/sync/pull?since=0')).data.epoch;
    const r = await admin.post('/api/admin/backups/restore', { name, confirm: 'WIEDERHERSTELLEN' });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.equal(srv.db.byId('objects', S.obj.id).name, 'Admin-Objekt (korrigiert)');
    const list = (await admin.get('/api/admin/backups')).data.backups.map((x) => x.name);
    assert.ok(list.includes(r.data.safety), 'Sicherung vor Wiederherstellung vorhanden');
    const pull = (await admin.get('/api/sync/pull?since=0')).data;
    assert.notEqual(pull.epoch, epochBefore, 'Geräte laden nach Wiederherstellung neu');
    assert.ok(audit('admin.wiederhergestellt_sicherung').length);
    const dl = await admin.req('GET', `/api/admin/backups/${encodeURIComponent(name)}/download`, undefined, { raw: true });
    assert.equal(Buffer.from(await dl.arrayBuffer()).subarray(0, 15).toString(), 'SQLite format 3');
  });
});
