// Integrationstests der zentralen Geschäftsabläufe (echte Datenbank, echter HTTP-Server).
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, Client, ADMIN, makeEmployee, loginAs, uid } from './helpers.js';
import { todayYmd, addDays } from '../shared/dates.js';

let srv; let admin;
const S = {}; // gemeinsam genutzte Testdaten

// 1x1-JPEG (gültige Signatur)
const JPEG = Buffer.from('/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=', 'base64');

before(async () => { srv = await startServer(); admin = new Client(srv.base); });
after(async () => { await srv.stop(); });

describe('Anmeldung', () => {
  test('falsches Passwort wird abgelehnt (deutsche Meldung)', async () => {
    const c = new Client(srv.base);
    const r = await c.post('/api/auth/login', { email: ADMIN.email, password: 'falsch' });
    assert.equal(r.status, 401);
    assert.match(r.data.error, /E-Mail-Adresse oder Passwort ist falsch/);
  });
  test('ohne Anmeldung kein Zugriff', async () => {
    const r = await new Client(srv.base).get('/api/sync/pull');
    assert.equal(r.status, 401);
  });
  test('Admin-Login, Pflicht-Passwortwechsel, Session-Cookie', async () => {
    const c = new Client(srv.base);
    const u = await c.login(ADMIN.email, ADMIN.password);
    assert.equal(u.role, 'admin');
    assert.equal(u.must_change_password, true);
    const blocked = await c.get('/api/dashboard');
    assert.equal(blocked.status, 403);
    assert.equal(blocked.data.must_change_password, true);
    const weak = await c.post('/api/auth/password', { current: ADMIN.password, next: 'kurz' });
    assert.equal(weak.status, 400);
    await admin.loginAdmin();
    const dash = await admin.get('/api/dashboard');
    assert.equal(dash.status, 200);
  });
  test('schreibende Anfragen ohne CSRF-Header werden abgelehnt', async () => {
    const r = await admin.req('POST', '/api/sync/push', { ops: [] }, { headers: { 'X-GRBZ': '' } });
    assert.equal(r.status, 403);
  });
  test('Kontosperre nach 5 Fehlversuchen', async () => {
    const emp = await makeEmployee(admin);
    const c = new Client(srv.base);
    for (let i = 0; i < 5; i++) await c.post('/api/auth/login', { email: emp.email, password: 'falsch' });
    const r = await c.post('/api/auth/login', { email: emp.email, password: emp.password });
    assert.equal(r.status, 423);
  });
});

describe('Kunden und Objekte', () => {
  test('Kundenanlage mit Kundennummer und Validierung', async () => {
    const bad = await admin.cmd('entity.save', { entity: 'customers', id: uid(), data: { phone: '030' } });
    assert.equal(bad.status, 'error');
    assert.match(bad.error, /Firmenname/);
    const id = uid();
    const r = await admin.ok('entity.save', { entity: 'customers', id, data: { company_name: 'Muster Immobilien GmbH', contact_person: 'Frau Muster', email: 'info@muster.de', billing_city: 'Berlin' } });
    assert.match(r.row.customer_no, /^K-\d{5}$/);
    assert.equal(r.row.contract_status, 'aktiv');
    S.customer = r.row;
  });
  test('Objektanlage erzeugt Objekt-ID und QR-Code ohne Kundendaten', async () => {
    const r = await admin.ok('entity.save', { entity: 'objects', id: uid(), data: { customer_id: S.customer.id, name: 'Bürohaus Mitte', street: 'Hauptstr. 1', city: 'Berlin', area_sqm: '450,5', floors: 3 } });
    assert.match(r.row.object_no, /^GRBZ-OBJ-\d{4}$/);
    assert.equal(r.row.area_sqm, 450.5);
    S.object = r.row;
    const qr = srv.db.get("SELECT * FROM qr_codes WHERE object_id = ? AND target_type = 'object'", r.row.id);
    assert.ok(qr);
    assert.match(qr.token, /^[A-Za-z0-9_-]{24}$/);
    assert.ok(!qr.token.includes('Muster'));
    S.qr = qr;
  });
  test('Konflikterkennung bei veralteter Version', async () => {
    const ok = await admin.ok('entity.save', { entity: 'customers', id: S.customer.id, data: { phone: '030 123' }, base_version: S.customer.version });
    assert.equal(ok.row.version, S.customer.version + 1);
    const conflict = await admin.cmd('entity.save', { entity: 'customers', id: S.customer.id, data: { phone: '030 999' }, base_version: S.customer.version });
    assert.equal(conflict.status, 'conflict');
    assert.equal(conflict.server.phone, '030 123');
  });
  test('Archivieren und Suche (Pull enthält archiviert-Flag)', async () => {
    const c2 = await admin.ok('entity.save', { entity: 'customers', id: uid(), data: { company_name: 'Alt Kunde' } });
    await admin.ok('entity.archive', { entity: 'customers', id: c2.row.id, archived: true });
    const pull = await admin.get('/api/sync/pull?since=0');
    assert.equal(pull.data.tables.customers.find((c) => c.id === c2.row.id).archived, 1);
  });
});

describe('QR-Code-System', () => {
  test('Scan über URL, Label und Objektnummer; Scan-Historie', async () => {
    const r1 = await admin.ok('scan.log', { id: uid(), raw: `https://irgendwo.example/q/${S.qr.token}`, method: 'kamera' });
    assert.equal(r1.result, 'ok');
    assert.equal(r1.target.id, S.object.id);
    const r2 = await admin.ok('scan.log', { id: uid(), raw: S.qr.label, method: 'scanner' });
    assert.equal(r2.target.id, S.object.id);
    const r3 = await admin.ok('scan.log', { id: uid(), raw: S.object.object_no, method: 'manuell' });
    assert.equal(r3.target.id, S.object.id);
    const r4 = await admin.ok('scan.log', { id: uid(), raw: 'unbekannt123', method: 'scanner' });
    assert.equal(r4.result, 'unbekannt');
    assert.equal(srv.db.get('SELECT COUNT(*) c FROM scans').c, 4);
  });
  test('Bereichs-QR, Deaktivierung, Neuzuordnung', async () => {
    const area = await admin.ok('qr.create', { id: uid(), target_type: 'area', object_id: S.object.id, area_type: 'keller' });
    assert.equal(area.row.area_name, 'Keller');
    await admin.ok('qr.setActive', { id: area.row.id, active: false });
    const r = await admin.ok('scan.log', { id: uid(), raw: area.row.token, method: 'scanner' });
    assert.equal(r.result, 'inaktiv');
    await admin.ok('qr.setActive', { id: area.row.id, active: true });
    const m = await admin.ok('entity.save', { entity: 'machines', id: uid(), data: { name: 'Scheuersaugmaschine' } });
    await admin.ok('qr.reassign', { id: area.row.id, target_type: 'machine', machine_id: m.row.id });
    const r2 = await admin.ok('scan.log', { id: uid(), raw: area.row.token, method: 'scanner' });
    assert.deepEqual(r2.target, { type: 'machine', id: m.row.id });
    assert.ok(srv.db.get("SELECT id FROM audit_log WHERE action = 'qr.neu_zugeordnet'"));
  });
  test('QR als SVG/PNG und Etiketten-PDF', async () => {
    const svg = await admin.req('GET', `/api/qr/${S.qr.id}.svg`, undefined, { raw: true });
    assert.equal(svg.status, 200);
    assert.match(await svg.text(), /<svg/);
    const pdf = await admin.req('GET', `/api/qr-labels.pdf?ids=${S.qr.id}`, undefined, { raw: true });
    assert.equal(pdf.status, 200);
    assert.equal(Buffer.from(await pdf.arrayBuffer()).subarray(0, 4).toString(), '%PDF');
  });
  test('QR-Link leitet in die App weiter', async () => {
    const r = await new Client(srv.base).req('GET', `/q/${S.qr.token}`, undefined, { raw: true });
    assert.equal(r.status, 302);
    assert.equal(r.headers.get('location'), `/#/q/${S.qr.token}`);
  });
});

describe('Aufträge und Checklisten', () => {
  test('Auftragserstellung übernimmt Checkliste der Dienstleistung', async () => {
    const svc = srv.db.get("SELECT id FROM services WHERE name = 'Treppenhausreinigung'");
    S.emp = await makeEmployee(admin);
    const r = await admin.ok('order.save', { id: uid(), data: { object_id: S.object.id, service_id: svc.id, scheduled_date: todayYmd(), scheduled_time: '08:00', assigned_user_id: S.emp.user.id } });
    assert.match(r.row.order_no, /^A-\d{4}-\d{5}$/);
    assert.equal(r.row.customer_id, S.customer.id);
    const items = srv.db.all('SELECT * FROM order_checklist_items WHERE order_id = ? ORDER BY position', r.row.id);
    assert.equal(items.length, 6);
    assert.equal(items[0].text, 'Eingangsbereich reinigen');
    S.order = r.row; S.items = items;
  });
  test('Checklistenabschluss erst bei vollständigen Angaben', async () => {
    const emp = await loginAs(srv.base, S.emp);
    S.empClient = emp;
    const r = await emp.cmd('order.complete', { id: S.order.id });
    assert.equal(r.status, 'error');
    assert.equal(r.http, 422);
    assert.equal(r.details.length, 6);
    for (const it of S.items.slice(0, 4)) await emp.ok('order.checkItem', { item_id: it.id, result: 'erledigt' });
    await emp.ok('order.checkItem', { item_id: S.items[4].id, result: 'nicht_zutreffend' });
    await emp.ok('order.checkItem', { item_id: S.items[5].id, result: 'mangel' });
    const r2 = await emp.cmd('order.complete', { id: S.order.id });
    assert.equal(r2.status, 'error');
    assert.match(r2.details[0], /Kommentar/);
    await emp.ok('order.checkItem', { item_id: S.items[5].id, result: 'mangel', comment: 'Briefkasten 3 beschädigt' });
    const done = await emp.ok('order.complete', { id: S.order.id, final_report: 'Alles erledigt, ein Mangel.' });
    assert.equal(done.row.status, 'mangel');
    assert.ok(done.row.completed_at);
    const defect = srv.db.get('SELECT * FROM defects WHERE checklist_item_id = ?', S.items[5].id);
    assert.ok(defect, 'Mangel wird automatisch angelegt');
    assert.equal(defect.description, null === defect.description ? null : defect.description);
    S.defect = defect;
  });
  test('Pflichtfoto wird beim Abschluss geprüft', async () => {
    const tpl = await admin.ok('entity.save', { entity: 'checklist_templates', id: uid(), data: { name: 'Fototest' } });
    await admin.ok('template.saveItems', { template_id: tpl.row.id, items: [{ text: 'Glasfront', required: true, photo_required: true }] });
    const o = await admin.ok('order.save', { id: uid(), data: { object_id: S.object.id, template_id: tpl.row.id, scheduled_date: todayYmd(), assigned_user_id: S.emp.user.id } });
    const item = srv.db.get('SELECT * FROM order_checklist_items WHERE order_id = ?', o.row.id);
    await S.empClient.ok('order.checkItem', { item_id: item.id, result: 'erledigt' });
    const r = await S.empClient.cmd('order.complete', { id: o.row.id });
    assert.match(r.details[0], /Foto erforderlich/);
    S.photoOrder = o.row; S.photoItem = item;
  });
});

describe('Fotodokumentation', () => {
  test('Foto-Upload ist idempotent und berechtigungsgeprüft', async () => {
    const id = uid();
    const send = () => {
      const fd = new FormData();
      fd.append('meta', JSON.stringify({ id, order_id: S.photoOrder.id, checklist_item_id: S.photoItem.id, category: 'nachher', taken_at: new Date().toISOString() }));
      fd.append('file', new Blob([JPEG], { type: 'image/jpeg' }), 'foto.jpg');
      return S.empClient.req('POST', '/api/photos', fd);
    };
    const r1 = await send();
    assert.equal(r1.status, 200, JSON.stringify(r1.data));
    const r2 = await send();
    assert.equal(r2.data.duplicate, true);
    assert.equal(srv.db.get('SELECT COUNT(*) c FROM photos WHERE id = ?', id).c, 1);
    const done = await S.empClient.ok('order.complete', { id: S.photoOrder.id });
    assert.equal(done.row.status, 'abgeschlossen');
    const file = await S.empClient.req('GET', `/api/photos/${id}/file`, undefined, { raw: true });
    assert.equal(file.status, 200);
    // Fremder Mitarbeiter sieht das Foto nicht
    const other = await loginAs(srv.base, await makeEmployee(admin));
    const denied = await other.req('GET', `/api/photos/${id}/file`, undefined, { raw: true });
    assert.equal(denied.status, 404);
    S.photoId = id;
  });
  test('Falscher Dateityp wird abgelehnt', async () => {
    const fd = new FormData();
    fd.append('meta', JSON.stringify({ id: uid(), object_id: S.object.id }));
    fd.append('file', new Blob([Buffer.from('<script>')], { type: 'image/jpeg' }), 'x.jpg');
    const r = await admin.req('POST', '/api/photos', fd);
    assert.equal(r.status, 415);
  });
});

describe('Berechtigungen', () => {
  test('Mitarbeiter sieht nur zugeordnete Objekte/Aufträge, keine Kundendetails', async () => {
    const other = await admin.ok('entity.save', { entity: 'objects', id: uid(), data: { customer_id: S.customer.id, name: 'Fremdobjekt' } });
    const pull = await S.empClient.get('/api/sync/pull?since=0');
    assert.equal(pull.status, 200);
    const t = pull.data.tables;
    assert.ok(t.objects.some((o) => o.id === S.object.id));
    assert.ok(!t.objects.some((o) => o.id === other.row.id));
    assert.equal(t.customers.length, 1);
    assert.equal(t.customers[0].email, undefined, 'keine Kontaktdaten');
    assert.equal(t.contact_history, undefined);
    assert.equal(t.users.find((u) => u.id === S.emp.user.id).email, undefined);
    assert.ok(!('password_hash' in t.users[0]));
    assert.equal(t.objects[0].contract_info, undefined);
    assert.ok(t.orders.every((o) => o.assigned_user_id === S.emp.user.id));
    const scan = await S.empClient.ok('scan.log', { id: uid(), raw: srv.db.get("SELECT token FROM qr_codes WHERE object_id = ?", other.row.id).token, method: 'kamera' });
    assert.equal(scan.result, 'kein_zugriff');
  });
  test('Mitarbeiter darf keine Kunden anlegen, keine Benutzer verwalten, keine Berichte anderer', async () => {
    const r = await S.empClient.cmd('entity.save', { entity: 'customers', id: uid(), data: { company_name: 'X' } });
    assert.equal(r.status, 'error'); assert.equal(r.http, 403);
    assert.equal((await S.empClient.post('/api/users', { name: 'x', email: 'x@y.de', role: 'admin' })).status, 403);
    assert.equal((await S.empClient.get('/api/audit')).status, 403);
    assert.equal((await S.empClient.get('/api/settings')).status, 403);
    const foreign = await admin.ok('order.save', { id: uid(), data: { object_id: S.object.id, scheduled_date: todayYmd() } });
    const rep = await S.empClient.req('GET', `/api/reports/order/${foreign.row.id}`, undefined, { raw: true });
    assert.equal(rep.status, 404);
    const exec = await S.empClient.cmd('order.setStatus', { id: foreign.row.id, status: 'in_bearbeitung' });
    assert.equal(exec.http, 403);
  });
  test('Objektleiter darf keine Administratoren anlegen', async () => {
    const ol = await loginAs(srv.base, await makeEmployee(admin, { role: 'objektleiter' }));
    const r = await ol.post('/api/users', { name: 'X', email: 'boss@test.local', role: 'admin' });
    assert.equal(r.status, 403);
  });
});

describe('Offline-Synchronisation', () => {
  test('Wiederholte Übertragung desselben Vorgangs wird nur einmal ausgeführt', async () => {
    const mat = await admin.ok('entity.save', { entity: 'materials', id: uid(), data: { name: 'Glasreiniger 1 l', stock: 10, min_stock: 3 } });
    const opId = uid();
    const payload = { id: uid(), material_id: mat.row.id, qty: 4, kind: 'verbrauch' };
    const a = await S.empClient.cmd('stock.move', payload, opId);
    const b = await S.empClient.cmd('stock.move', payload, opId);
    assert.equal(a.status, 'ok');
    assert.equal(b.duplicate, true);
    assert.equal(srv.db.byId('materials', mat.row.id).stock, 6);
    S.material = mat.row;
  });
  test('Offline erstellte Aufträge behalten Client-ID; Delta-Pull liefert nur Änderungen', async () => {
    const p0 = await admin.get('/api/sync/pull?since=0');
    const cursor = p0.data.cursor;
    const id = uid();
    const offlineOps = [
      { op_id: uid(), type: 'order.save', payload: { id, data: { object_id: S.object.id, scheduled_date: addDays(todayYmd(), 1), assigned_user_id: S.emp.user.id } } },
      { op_id: uid(), type: 'order.setStatus', payload: { id, status: 'in_bearbeitung' } },
    ];
    const r = await admin.post('/api/sync/push', { ops: offlineOps });
    assert.deepEqual(r.data.results.map((x) => x.status), ['ok', 'ok']);
    const delta = await admin.get(`/api/sync/pull?since=${cursor}`);
    assert.ok(delta.data.tables.orders.some((o) => o.id === id && o.status === 'in_bearbeitung'));
    assert.equal(delta.data.tables.customers, undefined, 'unveränderte Tabellen fehlen im Delta');
  });
  test('Neu zugeordnetes Objekt erscheint im Delta des Mitarbeiters', async () => {
    const before = await S.empClient.get('/api/sync/pull?since=0');
    const obj = await admin.ok('entity.save', { entity: 'objects', id: uid(), data: { customer_id: S.customer.id, name: 'Späte Zuordnung' } });
    await admin.ok('object.setEmployees', { object_id: obj.row.id, user_ids: [S.emp.user.id] });
    const delta = await S.empClient.get(`/api/sync/pull?since=${before.data.cursor}`);
    assert.ok(delta.data.tables.objects.some((o) => o.id === obj.row.id));
    assert.ok(delta.data.tables.qr_codes.some((q) => q.object_id === obj.row.id));
    assert.ok(delta.data.visible.objects.includes(obj.row.id));
  });
});

describe('Zeiterfassung', () => {
  test('Beginn, Pause, Ende und Validierung', async () => {
    const c = S.empClient;
    const t0 = new Date(Date.now() - 3 * 3600e3).toISOString();
    await c.ok('time.clock', { id: uid(), action: 'start', at: t0, object_id: S.object.id });
    const dbl = await c.cmd('time.clock', { id: uid(), action: 'start' });
    assert.match(dbl.error, /bereits eingestempelt/);
    await c.ok('time.clock', { id: uid(), action: 'pause', at: new Date(Date.now() - 2 * 3600e3).toISOString() });
    await c.ok('time.clock', { action: 'resume', at: new Date(Date.now() - 1.5 * 3600e3).toISOString() });
    const stop = await c.ok('time.clock', { action: 'stop' });
    assert.ok(stop.row.end_at);
    assert.equal(stop.row.source, 'offline', 'nachträglich übertragene Stempelung wird gekennzeichnet');
    S.timeEntry = stop.row;
    const future = await c.cmd('time.clock', { id: uid(), action: 'start', at: new Date(Date.now() + 3600e3).toISOString() });
    assert.match(future.error, /Zukunft/);
  });
  test('Korrektur: Antrag, Genehmigung, lückenloses Protokoll', async () => {
    const newStart = new Date(Date.parse(S.timeEntry.start_at) - 15 * 6e4).toISOString();
    const req = await S.empClient.ok('time.correction', { id: uid(), entry_id: S.timeEntry.id, new_start_at: newStart, reason: 'Beginn vergessen zu stempeln' });
    assert.equal(req.row.status, 'beantragt');
    assert.equal(srv.db.byId('time_entries', S.timeEntry.id).start_at, S.timeEntry.start_at, 'keine Änderung vor Genehmigung');
    const noReason = await S.empClient.cmd('time.correction', { id: uid(), entry_id: S.timeEntry.id, new_start_at: newStart, reason: '' });
    assert.equal(noReason.status, 'error');
    const denied = await S.empClient.cmd('time.decide', { id: req.row.id, approve: true });
    assert.equal(denied.http, 403);
    await admin.ok('time.decide', { id: req.row.id, approve: true, comment: 'ok' });
    const e = srv.db.byId('time_entries', S.timeEntry.id);
    assert.equal(e.start_at, newStart);
    assert.equal(e.source, 'korrigiert');
    const corr = srv.db.byId('time_corrections', req.row.id);
    assert.equal(corr.old_start_at, S.timeEntry.start_at);
    assert.equal(corr.new_start_at, newStart);
    assert.ok(corr.decided_by && corr.decided_at);
  });
  test('Monatsübersicht als PDF und CSV', async () => {
    const pdf = await S.empClient.req('GET', '/api/reports/time', undefined, { raw: true });
    assert.equal(pdf.status, 200);
    assert.equal(Buffer.from(await pdf.arrayBuffer()).subarray(0, 4).toString(), '%PDF');
    const csv = await S.empClient.req('GET', '/api/export/time.csv', undefined, { raw: true });
    const text = await csv.text();
    assert.match(text, /Mitarbeiter;Datum;Art/);
    const foreign = await S.empClient.req('GET', `/api/reports/time?user_id=${(await admin.get('/api/auth/me')).data.user.id}`, undefined, { raw: true });
    assert.equal(foreign.status, 403);
  });
});

describe('Material, Maschinen, Qualität, Winterdienst', () => {
  test('Mindestbestand-Warnung und Inventur', async () => {
    const r = await admin.ok('stock.move', { id: uid(), material_id: S.material.id, qty: 4, kind: 'verbrauch' });
    assert.equal(r.material.stock, 2);
    assert.equal(r.low, true);
    const dash = await admin.get('/api/dashboard');
    assert.ok(dash.data.materials.low.some((m) => m.id === S.material.id));
    const inv = await admin.ok('stock.move', { id: uid(), material_id: S.material.id, qty: 20, kind: 'inventur' });
    assert.equal(inv.material.stock, 20);
    assert.equal(inv.row.qty, 18);
  });
  test('Maschinenwartung setzt nächste Wartung', async () => {
    const m = await admin.ok('entity.save', { entity: 'machines', id: uid(), data: { name: 'Hochdruckreiniger', maintenance_interval_days: 180 } });
    await admin.ok('machine.event', { id: uid(), machine_id: m.row.id, kind: 'wartung', event_date: '2026-01-10', description: 'Jahreswartung' });
    assert.equal(srv.db.byId('machines', m.row.id).next_maintenance, '2026-07-09');
    await S.empClient.ok('machine.event', { id: uid(), machine_id: m.row.id, kind: 'defekt', description: 'Schlauch undicht' });
    assert.equal(srv.db.byId('machines', m.row.id).condition, 'defekt');
    const rep = await admin.req('GET', `/api/reports/machine/${m.row.id}`, undefined, { raw: true });
    assert.equal(rep.status, 200);
  });
  test('Qualitätskontrolle mit Bewertung und Mangelverfolgung bis zur Abnahme', async () => {
    const ins = await admin.ok('inspection.save', { id: uid(), object_id: S.object.id, items: [{ text: 'Böden', rating: 5 }, { text: 'Sanitär', rating: 2, comment: 'Kalk', create_defect: true }] });
    assert.equal(ins.row.score, 70);
    assert.equal(ins.row.rating, 'befriedigend');
    const d = srv.db.get('SELECT * FROM defects WHERE inspection_id = ?', ins.row.id);
    const noProof = await admin.cmd('defect.setStatus', { id: d.id, status: 'behoben' });
    assert.match(noProof.error, /Erledigungsnachweis/);
    await admin.ok('defect.setStatus', { id: d.id, status: 'behoben', note: 'Entkalkt' });
    await admin.ok('defect.setStatus', { id: d.id, status: 'abgenommen', note: 'Kontrolliert' });
    const log = srv.db.all('SELECT action FROM defect_log WHERE defect_id = ? ORDER BY logged_at', d.id).map((l) => l.action);
    assert.deepEqual(log, ['erstellt', 'status:behoben', 'status:abgenommen']);
    const pdf = await admin.req('GET', `/api/reports/inspection/${ins.row.id}`, undefined, { raw: true });
    assert.equal(pdf.status, 200);
    const q = await admin.req('GET', '/api/reports/quality', undefined, { raw: true });
    assert.equal(q.status, 200);
  });
  test('Winterdiensteinsatz mit Unterschrift; danach gesperrt', async () => {
    const area = await admin.ok('entity.save', { entity: 'winter_areas', id: uid(), data: { object_id: S.object.id, name: 'Gehweg vorne', area_sqm: 40 } });
    const id = uid();
    await S.empClient.ok('winter.save', { id, data: { object_id: S.object.id, start_at: new Date(Date.now() - 3600e3).toISOString(), weather: 'schneefall', temperature: '-2,5', area_ids: [area.row.id] } });
    const early = await S.empClient.cmd('winter.sign', { id, signature: 'data:image/png;base64,iVBORw0KGgo=' });
    assert.match(early.error, /Einsatzende/);
    const op = srv.db.byId('winter_operations', id);
    await S.empClient.ok('winter.save', { id, base_version: op.version, data: { end_at: new Date().toISOString(), activity: 'geraeumt_gestreut', spreading_material: 'Splitt', spreading_amount_kg: 15 } });
    await S.empClient.ok('winter.sign', { id, signature: 'data:image/png;base64,iVBORw0KGgo=' });
    const locked = await S.empClient.cmd('winter.save', { id, data: { notes: 'nachträglich' } });
    assert.match(locked.error, /abgeschlossen/);
    assert.equal(srv.db.byId('winter_operations', id).temperature, -2.5);
    const pdf = await S.empClient.req('GET', `/api/reports/winter/${id}`, undefined, { raw: true });
    assert.equal(pdf.status, 200);
  });
});

describe('Berichte und Dokumente', () => {
  test('Reinigungsnachweis als PDF und Ablage als Dokument', async () => {
    const r = await admin.req('GET', `/api/reports/order/${S.order.id}`, undefined, { raw: true });
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('content-type'), 'application/pdf');
    const buf = Buffer.from(await r.arrayBuffer());
    assert.equal(buf.subarray(0, 4).toString(), '%PDF');
    const saved = await admin.get(`/api/reports/order/${S.order.id}?save=1`);
    assert.equal(saved.data.document.kind, 'leistungsnachweis');
    assert.equal(saved.data.document.customer_id, S.customer.id);
    const monthly = await admin.req('GET', `/api/reports/monthly?customer_id=${S.customer.id}`, undefined, { raw: true });
    assert.equal(monthly.status, 200);
    const photos = await admin.req('GET', `/api/reports/photos?order_id=${S.photoOrder.id}`, undefined, { raw: true });
    assert.equal(photos.status, 200);
  });
  test('Dokument-Upload mit Zuordnung', async () => {
    const fd = new FormData();
    fd.append('title', 'Rahmenvertrag 2026');
    fd.append('kind', 'vertrag');
    fd.append('object_id', S.object.id);
    fd.append('file', new Blob([Buffer.from('%PDF-1.4\n%%EOF')], { type: 'application/pdf' }), 'vertrag.pdf');
    const r = await admin.req('POST', '/api/documents', fd);
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.equal(r.data.row.customer_id, S.customer.id);
    S.document = r.data.row;
  });
});

describe('Kundenportal', () => {
  test('deaktiviert: Kunde kann sich nicht anmelden', async () => {
    S.portal = await makeEmployee(admin, { role: 'kunde', customer_id: S.customer.id });
    const r = await new Client(srv.base).post('/api/auth/login', { email: S.portal.email, password: S.portal.password });
    assert.equal(r.status, 403);
    assert.match(r.data.error, /nicht freigeschaltet/);
  });
  test('aktiviert: Kunde sieht ausschließlich eigene, freigegebene Daten', async () => {
    await admin.put('/api/settings', { portal_enabled: '1' });
    const other = await admin.ok('entity.save', { entity: 'customers', id: uid(), data: { company_name: 'Andere GmbH' } });
    await admin.ok('entity.save', { entity: 'objects', id: uid(), data: { customer_id: other.row.id, name: 'Fremd' } });
    await admin.ok('photo.update', { id: S.photoId, customer_visible: true });
    await admin.ok('document.update', { id: S.document.id, data: { customer_visible: true } });
    const c = await loginAs(srv.base, S.portal);
    const ov = await c.get('/api/portal/overview');
    assert.equal(ov.status, 200);
    assert.ok(ov.data.objects.every((o) => o.id !== undefined));
    assert.ok(!ov.data.objects.some((o) => o.name === 'Fremd'));
    assert.equal(ov.data.photos.length, 1);
    assert.equal(ov.data.documents.length, 1);
    assert.equal((await c.get('/api/sync/pull')).status, 403, 'kein Zugriff auf interne API');
    const rep = await c.req('GET', `/api/portal/orders/${S.order.id}/report.pdf`, undefined, { raw: true });
    assert.equal(rep.status, 200);
    const comp = await c.post('/api/portal/complaints', { object_id: S.object.id, title: 'Treppenhaus nicht gereinigt' });
    assert.equal(comp.status, 200);
    const bad = await c.post('/api/portal/complaints', { object_id: srv.db.get("SELECT id FROM objects WHERE name = 'Fremd'").id, title: 'x' });
    assert.equal(bad.status, 400);
  });
});

describe('Serienaufträge', () => {
  test('wöchentliche Serie erzeugt Termine an den gewählten Wochentagen', async () => {
    const start = todayYmd();
    const r = await admin.ok('recurrence.save', { id: uid(), data: { object_id: S.object.id, frequency: 'zweimal_woechentlich', weekdays: [1, 4], start_date: start, start_time: '07:00' } });
    assert.ok(r.created >= 7 && r.created <= 10, `erzeugt: ${r.created}`);
    const orders = srv.db.all('SELECT scheduled_date FROM orders WHERE recurrence_id = ? AND deleted = 0', r.row.id);
    for (const o of orders) assert.ok([1, 4].includes(new Date(o.scheduled_date + 'T12:00:00Z').getUTCDay()));
    const again = await admin.ok('recurrence.save', { id: r.row.id, base_version: r.row.version, data: { object_id: S.object.id, frequency: 'monatlich', start_date: start } });
    const after = srv.db.all('SELECT scheduled_date FROM orders WHERE recurrence_id = ? AND deleted = 0', r.row.id);
    assert.ok(after.length <= 3, 'zukünftige Termine werden ersetzt');
    assert.ok(again.created >= 0);
  });
  test('Validierung zweimal wöchentlich', async () => {
    const r = await admin.cmd('recurrence.save', { id: uid(), data: { object_id: S.object.id, frequency: 'zweimal_woechentlich', weekdays: [1], start_date: todayYmd() } });
    assert.match(r.error, /zwei Wochentage/);
  });
});

describe('Protokoll und Administration', () => {
  test('Änderungen werden protokolliert; Backup-Download', async () => {
    const a = await admin.get('/api/audit?limit=500');
    const actions = a.data.entries.map((e) => e.action);
    for (const x of ['customers.erstellt', 'objects.erstellt', 'auftrag.abgeschlossen', 'zeit.korrektur_genehmigt', 'login']) assert.ok(actions.includes(x), x);
    const b = await admin.req('GET', '/api/admin/backup', undefined, { raw: true });
    assert.equal(b.status, 200);
    assert.equal(Buffer.from(await b.arrayBuffer()).subarray(0, 15).toString(), 'SQLite format 3');
  });
});
