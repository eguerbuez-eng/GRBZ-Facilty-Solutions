// Inventar & Barcode: Eindeutigkeit, Suche, Bestandsbuchungen (inkl. Ausgabe/Rücknahme,
// Schutz vor negativem Bestand), Maschinen (Objekt, Standort, Ausgabe, Zustand), eigene Barcodes, Rechte.
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, Client, makeEmployee, loginAs, uid } from './helpers.js';

let srv; let admin; const S = {};
before(async () => {
  srv = await startServer(); admin = new Client(srv.base); await admin.loginAdmin();
  S.emp = await makeEmployee(admin); S.empC = await loginAs(srv.base, S.emp);
  const c = await admin.ok('entity.save', { entity: 'customers', id: uid(), data: { company_name: 'Inventar Kunde' } });
  S.obj = (await admin.ok('entity.save', { entity: 'objects', id: uid(), data: { customer_id: c.row.id, name: 'Lager Objekt' } })).row;
});
after(async () => { await srv.stop(); });

describe('Barcodes', () => {
  test('Artikel mit Barcode, Anfangsbestand ist Pflicht (keine erfundenen Mengen)', async () => {
    const noStock = await admin.cmd('entity.save', { entity: 'materials', id: uid(), data: { name: 'Ohne Bestand', category: 'reinigungsmittel' } });
    assert.match(noStock.error, /Anfangsbestand/);
    const r = await admin.ok('entity.save', { entity: 'materials', id: uid(), data: { name: 'Glasreiniger 1 l', category: 'reinigungsmittel', barcode: ' 4006381333931 ', stock: 24, unit: 'Flaschen', location: 'Lager A' } });
    assert.equal(r.row.barcode, '4006381333931', 'Barcode wird normalisiert');
    S.mat = r.row;
  });
  test('doppelte Barcodes werden abgelehnt (auch zwischen Artikel und Maschine)', async () => {
    const dup = await admin.cmd('entity.save', { entity: 'materials', id: uid(), data: { name: 'Kopie', category: 'verbrauchsmaterial', barcode: '4006381333931', stock: 1 } });
    assert.equal(dup.http, 409);
    assert.match(dup.error, /bereits vergeben/);
    const dupM = await admin.cmd('entity.save', { entity: 'machines', id: uid(), data: { name: 'Sauger', barcode: S.mat.article_no } });
    assert.equal(dupM.http, 409, 'Barcode darf keiner Artikelnummer entsprechen');
    const m = await admin.ok('entity.save', { entity: 'machines', id: uid(), data: { name: 'Scheuersaugmaschine B1', machine_type: 'reinigungsmaschine', barcode: 'SN-998877', manufacturer: 'Kärcher', model: 'B 40' } });
    assert.match(m.row.inventory_no, /^MAS-\d{4}$/);
    S.mach = m.row;
    const same = await admin.ok('entity.save', { entity: 'materials', id: S.mat.id, data: { barcode: '4006381333931', location: 'Lager B' }, base_version: S.mat.version });
    assert.equal(same.row.location, 'Lager B', 'eigener Barcode kollidiert nicht mit sich selbst');
  });
  test('Suche: Barcode, Artikelnummer, Inventar-/Seriennummer, unbekannt', async () => {
    const a = (await admin.get('/api/inventory/lookup?code=4006381333931')).data;
    assert.deepEqual([a.hit.type, a.item.name, a.item.stock], ['material', 'Glasreiniger 1 l', 24]);
    const b = (await admin.get(`/api/inventory/lookup?code=${S.mach.inventory_no}`)).data;
    assert.equal(b.hit.type, 'machine');
    assert.equal((await admin.get('/api/inventory/lookup?code=SN-998877')).data.item.id, S.mach.id);
    assert.equal((await admin.get('/api/inventory/lookup?code=0000UNBEKANNT')).data.hit, null);
  });
  test('eigener, eindeutiger Inventarbarcode + Etikett', async () => {
    const t = await admin.ok('entity.save', { entity: 'materials', id: uid(), data: { name: 'Wischmopp-Halter', category: 'werkzeug', stock: 10 } });
    const r = await admin.ok('inventory.newCode', { type: 'material', id: t.row.id });
    assert.match(r.code, /^GRBZ-INV-\d{6}$/);
    const again = await admin.cmd('inventory.newCode', { type: 'material', id: t.row.id });
    assert.match(again.error, /bereits den Barcode/);
    const r2 = await admin.ok('inventory.newCode', { type: 'machine', id: S.mach.id, replace: true });
    assert.notEqual(r2.code, r.code);
    S.tool = srv.db.byId('materials', t.row.id);
    const pdf = await admin.req('GET', `/api/inventory/labels.pdf?items=material:${t.row.id},machine:${S.mach.id}`, undefined, { raw: true });
    assert.equal(Buffer.from(await pdf.arrayBuffer()).subarray(0, 4).toString(), '%PDF');
    assert.equal((await S.empC.req('GET', `/api/inventory/labels.pdf?items=material:${t.row.id}`, undefined, { raw: true })).status, 403);
  });
});

describe('Bestandsführung', () => {
  test('erhöhen, reduzieren, Protokoll mit Bestand danach', async () => {
    const z = await admin.ok('stock.move', { id: uid(), material_id: S.mat.id, kind: 'zugang', qty: 6 });
    assert.equal(z.material.stock, 30);
    const v = await S.empC.ok('stock.move', { id: uid(), material_id: S.mat.id, kind: 'verbrauch', qty: 4 });
    assert.equal(v.material.stock, 26);
    assert.equal(v.row.stock_after, 26);
    assert.ok(srv.db.get("SELECT id FROM audit_log WHERE action = 'bestand.verbrauch'"), 'Bestandsbewegung protokolliert');
  });
  test('negativer Bestand nur mit ausdrücklicher Bestätigung', async () => {
    const r = await admin.cmd('stock.move', { id: uid(), material_id: S.mat.id, kind: 'verbrauch', qty: 100 });
    assert.equal(r.http, 409);
    assert.match(r.error, /negativ/);
    assert.equal(srv.db.byId('materials', S.mat.id).stock, 26, 'nichts gebucht');
    const emp = await S.empC.cmd('stock.move', { id: uid(), material_id: S.mat.id, kind: 'verbrauch', qty: 100, allow_negative: true });
    assert.equal(emp.http, 403, 'Mitarbeiter darf keinen negativen Bestand erzwingen');
    const ok = await admin.ok('stock.move', { id: uid(), material_id: S.mat.id, kind: 'verbrauch', qty: 30, allow_negative: true });
    assert.equal(ok.material.stock, -4);
    assert.ok(JSON.parse(srv.db.get("SELECT details FROM audit_log WHERE action = 'bestand.verbrauch' ORDER BY id DESC").details).negativ_bestaetigt);
    await admin.ok('stock.move', { id: uid(), material_id: S.mat.id, kind: 'inventur', qty: 24 });
  });
  test('Ausgabe/Rücknahme: Werkzeug (verfügbar sinkt, Bestand bleibt) vs. Verbrauchsmaterial', async () => {
    const a = await admin.ok('stock.move', { id: uid(), material_id: S.tool.id, kind: 'ausgabe', qty: 3, recipient_user_id: S.emp.user.id });
    assert.deepEqual([a.material.stock, a.material.issued], [10, 3]);
    const tooMany = await admin.cmd('stock.move', { id: uid(), material_id: S.tool.id, kind: 'ausgabe', qty: 8, recipient_user_id: S.emp.user.id });
    assert.match(tooMany.error, /Nicht genügend verfügbar/);
    const back = await admin.cmd('stock.move', { id: uid(), material_id: S.tool.id, kind: 'ruecknahme', qty: 5 });
    assert.match(back.error, /nur 3/);
    const r = await admin.ok('stock.move', { id: uid(), material_id: S.tool.id, kind: 'ruecknahme', qty: 2, recipient_user_id: S.emp.user.id });
    assert.deepEqual([r.material.stock, r.material.issued], [10, 1]);
    const noRecipient = await admin.cmd('stock.move', { id: uid(), material_id: S.mat.id, kind: 'ausgabe', qty: 1 });
    assert.match(noRecipient.error, /Mitarbeiter/);
    const c = await admin.ok('stock.move', { id: uid(), material_id: S.mat.id, kind: 'ausgabe', qty: 2, recipient_user_id: S.emp.user.id });
    assert.equal(c.material.stock, 22, 'Verbrauchsmaterial: Ausgabe senkt Bestand');
    assert.equal((await S.empC.cmd('stock.move', { id: uid(), material_id: S.mat.id, kind: 'zugang', qty: 1 })).http, 403);
    assert.equal((await S.empC.cmd('stock.move', { id: uid(), material_id: S.tool.id, kind: 'ausgabe', qty: 1, recipient_user_id: S.emp.user.id })).http, 403);
  });
  test('Mehrfachbuchung desselben Vorgangs (gleiche op_id) wird nur einmal gebucht', async () => {
    const op = uid(); const p = { id: uid(), material_id: S.mat.id, kind: 'verbrauch', qty: 1 };
    await admin.cmd('stock.move', p, op); const d = await admin.cmd('stock.move', p, op);
    assert.equal(d.duplicate, true);
    assert.equal(srv.db.byId('materials', S.mat.id).stock, 21);
  });
  test('Admin-Löschung einer Ausgabe korrigiert die verfügbare Menge', async () => {
    const mv = srv.db.get("SELECT id FROM stock_movements WHERE material_id = ? AND kind = 'ausgabe'", S.tool.id);
    await admin.ok('admin.delete', { table: 'stock_movements', id: mv.id });
    const t = srv.db.byId('materials', S.tool.id);
    assert.deepEqual([t.stock, t.issued], [10, 0]);
  });
});

describe('Maschinen', () => {
  test('Objekt zuordnen, Standort, Ausgabe/Rücknahme, Zustand – mit Historie und Rechten', async () => {
    await admin.ok('machine.assign', { id: S.mach.id, action: 'objekt', object_id: S.obj.id });
    await admin.ok('machine.assign', { id: S.mach.id, action: 'standort', location: 'Keller Objekt 1' });
    await admin.ok('machine.assign', { id: S.mach.id, action: 'ausgabe', user_id: S.emp.user.id });
    let m = srv.db.byId('machines', S.mach.id);
    assert.deepEqual([m.object_id, m.location, m.issued_to_user_id], [S.obj.id, 'Keller Objekt 1', S.emp.user.id]);
    await admin.ok('machine.assign', { id: S.mach.id, action: 'ruecknahme' });
    await admin.ok('machine.event', { id: uid(), machine_id: S.mach.id, kind: 'zustand', condition: 'gebraucht', description: 'Bürsten abgenutzt' });
    m = srv.db.byId('machines', S.mach.id);
    assert.equal(m.condition, 'gebraucht');
    assert.equal(m.issued_to_user_id, null);
    const ev = srv.db.all('SELECT kind FROM machine_events WHERE machine_id = ?', S.mach.id).map((e) => e.kind);
    for (const k of ['standort', 'ausgabe', 'ruecknahme', 'zustand']) assert.ok(ev.includes(k), k);
    assert.equal((await S.empC.cmd('machine.assign', { id: S.mach.id, action: 'objekt', object_id: S.obj.id })).http, 403);
    assert.equal((await S.empC.cmd('machine.event', { id: uid(), machine_id: S.mach.id, kind: 'defekt', description: 'Kabel' })).status, 'ok', 'Defekt melden darf jeder Mitarbeiter');
  });
});
