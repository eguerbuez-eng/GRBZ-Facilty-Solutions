// Inventar: Barcode-Eindeutigkeit, Bestandsbuchungen (inkl. Ausgabe/Rücknahme),
// Maschinen-Zuordnung, eigene Inventarbarcodes. Alles serverseitig berechtigungsgeprüft und protokolliert.
import { AppError, nowIso, uuid, pad } from './db.js';
import { assertPerm } from './auth.js';
import { commands, bad, req, requireRef, isAdmin } from './commands.js';
import { can } from '../shared/constants.js';
import { categoryMode, normalizeCode, barcodeTaken, MACHINE_TYPES } from '../shared/inventory.js';

const isIso = (v) => typeof v === 'string' && !isNaN(Date.parse(v));
const r3 = (v) => Math.round(v * 1000) / 1000;

function inventoryRows(db) {
  return {
    materials: db.all('SELECT id, name, barcode, article_no, deleted FROM materials WHERE deleted = 0'),
    machines: db.all('SELECT id, name, barcode, inventory_no, serial_no, deleted FROM machines WHERE deleted = 0'),
    qr_codes: db.all('SELECT id, label, deleted FROM qr_codes WHERE deleted = 0'),
  };
}

/** Wird von entity.save (materials/machines) aufgerufen */
export function assertBarcodeFree(db, code, self) {
  const c = normalizeCode(code);
  if (!c) return null;
  const hit = barcodeTaken(c, inventoryRows(db), self);
  if (hit) throw new AppError(409, `Der Barcode „${c}“ ist bereits vergeben (${hit.type === 'machine' ? 'Maschine' : hit.type === 'qr' ? 'QR-Etikett' : 'Artikel'}: ${hit.name}).`, { details: [`Vorhandener Gegenstand: ${hit.name}`], duplicate: hit });
  return c;
}

// entity.save für Inventar um Barcode-Prüfung erweitern (bestehende Logik bleibt unverändert)
const baseSave = commands['entity.save'];
commands['entity.save'] = function (ctx, p) {
  if (['materials', 'machines'].includes(p.entity) && p.data && 'barcode' in p.data && p.data.barcode) {
    p.data.barcode = assertBarcodeFree(ctx.db, p.data.barcode, { type: p.entity === 'materials' ? 'material' : 'machine', id: p.id });
  }
  if (p.entity === 'machines' && p.data?.machine_type && !MACHINE_TYPES[p.data.machine_type]) throw bad('Ungültige Gegenstandsart.');
  return baseSave(ctx, p);
};

Object.assign(commands, {
  // Bestandsbuchung (ersetzt die bisherige Version; alle bisherigen Buchungsarten verhalten sich wie zuvor)
  'stock.move'(ctx, { id, material_id, qty, kind, object_id, order_id, note, moved_at, recipient_user_id, allow_negative }) {
    const { db, user } = ctx;
    const mat = db.byId('materials', material_id);
    if (!mat || mat.deleted) throw bad('Artikel nicht gefunden.');
    const n = Number(String(qty).replace(',', '.'));
    if (!isFinite(n)) throw bad('Bitte eine gültige Menge angeben.');
    const mode = categoryMode(mat.category);
    let delta = 0; let issuedDelta = 0;
    switch (kind) {
      case 'verbrauch': assertPerm(user, 'materials.consume', 'materials.write'); if (n <= 0) throw bad('Die Menge muss größer als 0 sein.'); delta = -n; break;
      case 'zugang': assertPerm(user, 'materials.write'); if (n <= 0) throw bad('Die Menge muss größer als 0 sein.'); delta = n; break;
      case 'korrektur': assertPerm(user, 'materials.write'); if (!n) throw bad('Die Menge darf nicht 0 sein.'); if (!String(note || '').trim()) throw bad('Bitte einen Grund für die Korrektur angeben.'); delta = n; break;
      case 'inventur': assertPerm(user, 'materials.write'); if (n < 0) throw bad('Der Zählbestand darf nicht negativ sein.'); delta = n - mat.stock; break;
      case 'ausgabe':
        assertPerm(user, 'materials.write');
        if (n <= 0) throw bad('Die Menge muss größer als 0 sein.');
        requireRef(db, 'users', req(recipient_user_id, 'Bitte den Mitarbeiter wählen, an den ausgegeben wird.'), 'Der Mitarbeiter');
        if (mode === 'leihe') { issuedDelta = n; if (mat.stock - (mat.issued || 0) - n < 0 && !allow_negative) throw new AppError(409, `Nicht genügend verfügbar: ${r3(mat.stock - (mat.issued || 0))} ${mat.unit || ''} verfügbar.`, { negative: true }); }
        else delta = -n;
        break;
      case 'ruecknahme':
        assertPerm(user, 'materials.write');
        if (n <= 0) throw bad('Die Menge muss größer als 0 sein.');
        if (mode === 'leihe') { if (n > (mat.issued || 0) + 1e-9) throw bad(`Es sind nur ${r3(mat.issued || 0)} ${mat.unit || ''} ausgegeben.`); issuedDelta = -n; }
        else delta = n;
        if (recipient_user_id) requireRef(db, 'users', recipient_user_id, 'Der Mitarbeiter');
        break;
      default: throw bad('Unbekannte Buchungsart.');
    }
    const newStock = r3(mat.stock + delta);
    // Negative Bestände nie unbemerkt: nur mit ausdrücklicher Bestätigung (wird protokolliert)
    if (newStock < 0 && !allow_negative) throw new AppError(409, `Der Bestand würde negativ werden (${newStock} ${mat.unit || ''}). Aktuell vorhanden: ${mat.stock}.`, { negative: true });
    if (newStock < 0 && kind !== 'inventur') assertPerm(user, 'materials.write');
    const mv = db.insert('stock_movements', {
      id: id || uuid(), material_id, qty: delta || (kind === 'ausgabe' ? -n : n), kind, object_id: object_id || null, order_id: order_id || null,
      user_id: user.id, recipient_user_id: recipient_user_id || null, note: note || null, moved_at: isIso(moved_at) ? moved_at : nowIso(), stock_after: newStock,
    });
    const m2 = db.update('materials', material_id, { stock: newStock, issued: r3(Math.max(0, (mat.issued || 0) + issuedDelta)) });
    db.audit(user.id, `bestand.${kind}`, 'materials', material_id, { menge: n, vorher: mat.stock, nachher: newStock, ausgegeben: m2.issued, an: recipient_user_id || undefined, negativ_bestaetigt: newStock < 0 || undefined });
    return { row: db.byId('stock_movements', mv.id), material: m2, low: m2.min_stock > 0 && m2.stock <= m2.min_stock };
  },

  // Maschine/Einzelgerät: Standort, Objekt, Ausgabe/Rücknahme
  'machine.assign'(ctx, { id, action, object_id, location, user_id, note }) {
    const { db, user } = ctx;
    assertPerm(user, 'machines.write');
    const m = db.byId('machines', id);
    if (!m || m.deleted) throw bad('Maschine nicht gefunden.');
    const patch = {}; let text;
    switch (action) {
      case 'objekt':
        if (object_id) requireRef(db, 'objects', object_id, 'Das Objekt');
        patch.object_id = object_id || null;
        text = object_id ? `Objekt zugeordnet: ${db.byId('objects', object_id).name}` : 'Objektzuordnung entfernt';
        break;
      case 'standort':
        patch.location = String(location || '').trim() || null;
        text = `Standort geändert: ${m.location || '–'} → ${patch.location || '–'}`;
        break;
      case 'ausgabe':
        requireRef(db, 'users', req(user_id, 'Bitte den Mitarbeiter wählen.'), 'Der Mitarbeiter');
        if (m.issued_to_user_id && m.issued_to_user_id !== user_id && !isAdmin(user)) throw bad(`Die Maschine ist bereits an ${db.byId('users', m.issued_to_user_id)?.name} ausgegeben. Bitte zuerst zurücknehmen.`);
        patch.issued_to_user_id = user_id;
        text = `Ausgegeben an ${db.byId('users', user_id).name}`;
        break;
      case 'ruecknahme':
        if (!m.issued_to_user_id) throw bad('Die Maschine ist nicht ausgegeben.');
        patch.issued_to_user_id = null;
        text = `Zurückgenommen von ${db.byId('users', m.issued_to_user_id)?.name || '–'}`;
        break;
      default: throw bad('Unbekannte Aktion.');
    }
    const row = db.update('machines', id, patch);
    db.insert('machine_events', { machine_id: id, kind: action === 'objekt' || action === 'standort' ? 'standort' : action, event_date: nowIso().slice(0, 10), description: [text, note].filter(Boolean).join(' – '), status: 'erledigt', user_id: user.id });
    db.audit(user.id, `maschine.${action}`, 'machines', id, { text });
    return { row };
  },

  // Eigener, eindeutiger Inventarbarcode (GRBZ-INV-000001 …)
  'inventory.newCode'(ctx, { type, id, replace }) {
    const { db, user } = ctx;
    const table = type === 'machine' ? 'machines' : 'materials';
    assertPerm(user, type === 'machine' ? 'machines.write' : 'materials.write');
    const it = db.byId(table, id);
    if (!it || it.deleted) throw bad('Gegenstand nicht gefunden.');
    if (it.barcode && !replace) throw bad(`Dieser Gegenstand hat bereits den Barcode „${it.barcode}“.`);
    let code; let tries = 0;
    do { code = 'GRBZ-INV-' + pad(db.nextNumber('invcode'), 6); tries++; } while (barcodeTaken(code, inventoryRows(db), { type, id }) && tries < 50);
    const row = db.update(table, id, { barcode: code });
    db.audit(user.id, 'inventar.barcode_erzeugt', table, id, { alt: it.barcode || undefined, neu: code });
    return { row, code };
  },
});

export { can };
