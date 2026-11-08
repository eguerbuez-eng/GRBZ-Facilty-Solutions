// Geschäftslogik als Befehle. Jeder Schreibzugriff (online oder aus der
// Offline-Warteschlange) läuft über genau einen dieser Befehle. Dadurch gelten
// Validierung, Berechtigungen, Nummernvergabe und Protokollierung überall gleich.
import crypto from 'node:crypto';
import { AppError, nowIso, uuid, pad } from './db.js';
import { assertPerm } from './auth.js';
import { assertSee, canSee, isScoped } from './scope.js';
import { ENTITIES } from '../shared/entities.js';
import {
  can, ORDER_STATUS, CHECK_RESULTS, FREQUENCIES, QR_TARGET_TYPES, QR_AREA_TYPES, DEFECT_STATUS, DEFECT_KINDS,
  PHOTO_CATEGORIES,
} from '../shared/constants.js';
import { todayYmd, addDays, weekday, daysBetween, seasonOf, ymdOf } from '../shared/dates.js';
import { checklistProblems, autoReport } from '../shared/rules.js';
import { fmtPersonnelNo, validateRuleParams, RULE_KINDS, SCOPE_TYPES } from '../shared/hr.js';

export const GENERIC = ['customers', 'contact_history', 'services', 'objects', 'materials', 'machines', 'winter_areas', 'winter_standby', 'checklist_templates',
  'employment_types', 'positions', 'departments', 'work_models', 'holidays', 'pay_rules', 'pay_adjustments', 'mileage_logs', 'overtime_adjustments', 'object_revenues'];
const YMD = /^\d{4}-\d{2}-\d{2}$/;
const HM = /^\d{2}:\d{2}$/;

export const bad = (msg) => new AppError(400, msg);
export const req = (v, msg) => { if (v === undefined || v === null || v === '') throw bad(msg); return v; };
const isIso = (v) => typeof v === 'string' && !isNaN(Date.parse(v));
const year = () => todayYmd().slice(0, 4);

function numberFor(db, table) {
  const y = year();
  switch (table) {
    case 'customers': return 'K-' + pad(db.nextNumber('customer'), 5);
    case 'objects': return 'GRBZ-OBJ-' + pad(db.nextNumber('object'), 4);
    case 'materials': return 'ART-' + pad(db.nextNumber('material'), 5);
    case 'machines': return 'MAS-' + pad(db.nextNumber('machine'), 4);
    case 'orders': return `A-${y}-` + pad(db.nextNumber('order_' + y), 5);
    case 'defects': return `M-${y}-` + pad(db.nextNumber('defect_' + y), 4);
    case 'inspections': return `QK-${y}-` + pad(db.nextNumber('inspection_' + y), 4);
    case 'winter_operations': return `WD-${y}-` + pad(db.nextNumber('winter_' + y), 4);
    case 'users': return fmtPersonnelNo(db.nextNumber('personnel')); // G-0001 …, nie wiederverwendet
    case 'qr_codes': return 'GRBZ-QR-' + pad(db.nextNumber('qr'), 6);
    default: return null;
  }
}
export { numberFor };

/** Feldwerte anhand der Entitätsdefinition prüfen und normalisieren */
function cleanFields(def, data, isNew) {
  const out = {};
  for (const f of def.fields) {
    if (!(f.name in data)) continue;
    if (f.createOnly && !isNew) continue;
    let v = data[f.name];
    if (typeof v === 'string') v = v.trim();
    if (v === '' || v === undefined) v = null;
    if (v !== null) {
      switch (f.type) {
        case 'number': case 'money': {
          const n = typeof v === 'number' ? v : Number(String(v).replace(',', '.'));
          if (!isFinite(n)) throw bad(`„${f.label}“ muss eine Zahl sein.`);
          if (n < 0 && !f.allowNegative) throw bad(`„${f.label}“ darf nicht negativ sein.`);
          v = n; break;
        }
        case 'month': if (!/^\d{4}-\d{2}$/.test(v)) throw bad(`„${f.label}“ muss ein Monat (JJJJ-MM) sein.`); break;
        case 'json': v = JSON.stringify(typeof v === 'string' ? JSON.parse(v) : v); break;
        case 'dayhours': {
          const arr = typeof v === 'string' ? JSON.parse(v) : v;
          if (!Array.isArray(arr) || arr.length !== 7 || arr.some((m) => !(+m >= 0 && +m <= 1440))) throw bad(`„${f.label}“: bitte für jeden Wochentag 0–24 Stunden angeben.`);
          v = JSON.stringify(arr.map((m) => Math.round(+m))); break;
        }
        case 'date': if (!YMD.test(v)) throw bad(`„${f.label}“ ist kein gültiges Datum.`); break;
        case 'datetime': if (!isIso(v)) throw bad(`„${f.label}“ ist kein gültiger Zeitpunkt.`); v = new Date(v).toISOString(); break;
        case 'email': if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) throw bad(`„${f.label}“ ist keine gültige E-Mail-Adresse.`); break;
        case 'bool': v = v === true || v === 1 || v === '1' || v === 'true' ? 1 : 0; break;
        case 'select': if (!f.options.some((o) => o.value === v)) throw bad(`Ungültiger Wert für „${f.label}“.`); break;
        default: v = String(v).slice(0, 5000);
      }
    }
    out[f.name] = v;
  }
  if (isNew) for (const f of def.fields) {
    if (out[f.name] == null && f.default !== undefined && f.default !== 'today') out[f.name] = f.default;
    if (out[f.name] == null && f.default === 'today') out[f.name] = todayYmd();
  }
  for (const f of def.fields) {
    if (f.required && (isNew || f.name in out) && (out[f.name] === null || out[f.name] === undefined)) throw bad(`Bitte „${f.label}“ ausfüllen.`);
  }
  return out;
}

export function checkVersion(existing, baseVersion) {
  if (baseVersion != null && existing.version !== Number(baseVersion)) {
    throw new AppError(409, 'Der Datensatz wurde zwischenzeitlich auf einem anderen Gerät geändert.', { conflict: true, server: existing });
  }
}

export function requireRef(db, table, id, label) {
  if (id == null) return;
  const r = db.get(`SELECT id FROM ${table} WHERE id = ? AND deleted = 0`, id);
  if (!r) throw bad(`${label} wurde nicht gefunden.`);
}

/** seq erhöhen, damit Geräte neu sichtbar gewordene Datensätze per Delta-Sync erhalten */
function touch(db, table, where, ...params) {
  const s = db.nextSeq();
  db.run(`UPDATE ${table} SET seq = ? WHERE ${where}`, s, ...params);
}
function touchObjectTree(db, objectId) {
  touch(db, 'objects', 'id = ?', objectId);
  touch(db, 'customers', 'id = (SELECT customer_id FROM objects WHERE id = ?)', objectId);
  touch(db, 'qr_codes', 'object_id = ?', objectId);
  touch(db, 'winter_areas', 'object_id = ?', objectId);
}
export function touchOrderTree(db, orderId) {
  touch(db, 'order_checklist_items', 'order_id = ?', orderId);
  touch(db, 'photos', 'order_id = ?', orderId);
  const o = db.byId('orders', orderId);
  if (o) touchObjectTree(db, o.object_id);
}

export function newQrToken() {
  return crypto.randomBytes(18).toString('base64url'); // 144 Bit, nicht erratbar
}

function createQr(db, ctx, p) {
  const target = p.target_type;
  if (!QR_TARGET_TYPES[target]) throw bad('Ungültiger QR-Code-Typ.');
  const row = { id: p.id || uuid(), target_type: target, object_id: null, area_type: null, area_name: null, machine_id: null, material_id: null };
  if (target === 'object' || target === 'area') {
    req(p.object_id, 'Bitte ein Objekt auswählen.');
    requireRef(db, 'objects', p.object_id, 'Das Objekt');
    row.object_id = p.object_id;
    if (target === 'area') {
      if (!QR_AREA_TYPES[p.area_type]) throw bad('Bitte einen Bereich auswählen.');
      row.area_type = p.area_type;
      row.area_name = (p.area_name || QR_AREA_TYPES[p.area_type]).slice(0, 120);
    }
  } else if (target === 'machine') {
    req(p.machine_id, 'Bitte eine Maschine auswählen.');
    requireRef(db, 'machines', p.machine_id, 'Die Maschine');
    row.machine_id = p.machine_id;
  } else if (target === 'material') {
    req(p.material_id, 'Bitte einen Artikel auswählen.');
    requireRef(db, 'materials', p.material_id, 'Der Artikel');
    row.material_id = p.material_id;
  }
  if (db.byId('qr_codes', row.id)) throw bad('QR-Code existiert bereits.');
  row.token = newQrToken();
  row.label = numberFor(db, 'qr_codes');
  const qr = db.insert('qr_codes', row);
  db.audit(ctx.user.id, 'qr.erstellt', 'qr_codes', qr.id, { label: qr.label, target });
  return qr;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Checkliste aus Vorlage kopieren. itemIds: optional vom Client vergebene IDs (Offline-Anlage). */
function instantiateChecklist(db, order, templateId, itemIds = []) {
  const items = templateId
    ? db.all('SELECT * FROM checklist_template_items WHERE template_id = ? AND deleted = 0 ORDER BY position', templateId) : [];
  items.forEach((it, i) => {
    const cid = itemIds[i];
    const id = cid && UUID.test(cid) && !db.byId('order_checklist_items', cid) ? cid : uuid();
    db.insert('order_checklist_items', { id, order_id: order.id, position: i, text: it.text, required: it.required, photo_required: it.photo_required });
  });
}

function defaultTemplateFor(db, serviceId) {
  if (!serviceId) return null;
  const t = db.get("SELECT id FROM checklist_templates WHERE service_id = ? AND active = 1 AND deleted = 0 AND purpose = 'reinigung' ORDER BY created_at LIMIT 1", serviceId);
  return t ? t.id : null;
}

function orderForExecution(db, user, id) {
  const o = db.byId('orders', id);
  if (!o || o.deleted) throw new AppError(404, 'Auftrag nicht gefunden.');
  if (!can(user, 'orders.write')) {
    assertPerm(user, 'orders.execute');
    if (isScoped(user) && o.assigned_user_id !== user.id) throw new AppError(403, 'Dieser Auftrag ist Ihnen nicht zugeordnet.');
  }
  return o;
}

function createOrder(db, ctx, d, id) {
  requireRef(db, 'objects', d.object_id, 'Das Objekt');
  const obj = db.byId('objects', d.object_id);
  if (d.service_id) requireRef(db, 'services', d.service_id, 'Die Dienstleistung');
  if (d.assigned_user_id) requireRef(db, 'users', d.assigned_user_id, 'Der Mitarbeiter');
  if (!YMD.test(d.scheduled_date || '')) throw bad('Bitte ein gültiges Datum angeben.');
  if (d.scheduled_time && !HM.test(d.scheduled_time)) throw bad('Bitte eine gültige Uhrzeit angeben (HH:MM).');
  const templateId = d.template_id || defaultTemplateFor(db, d.service_id);
  const order = db.insert('orders', {
    id, order_no: numberFor(db, 'orders'), customer_id: obj.customer_id, object_id: obj.id, service_id: d.service_id || null,
    template_id: templateId, recurrence_id: d.recurrence_id || null, scheduled_date: d.scheduled_date,
    scheduled_time: d.scheduled_time || null, planned_minutes: d.planned_minutes ? Math.round(+d.planned_minutes) : null,
    assigned_user_id: d.assigned_user_id || null, status: 'geplant', notes: d.notes || null,
  });
  instantiateChecklist(db, order, templateId, Array.isArray(d.item_ids) ? d.item_ids : []);
  return order;
}

// ---------- Serienaufträge ----------
function matchesRecurrence(r, ymd) {
  const wd = weekday(ymd);
  const days = (r.weekdays || '').split(',').filter((x) => x !== '').map(Number);
  const diff = daysBetween(r.start_date, ymd);
  if (diff < 0) return false;
  switch (r.frequency) {
    case 'taeglich': return wd >= 1 && wd <= 5;
    case 'taeglich_alle': return true;
    case 'woechentlich': return days.length ? days.includes(wd) : wd === weekday(r.start_date);
    case 'zweimal_woechentlich': return days.includes(wd);
    case 'zweiwoechentlich': {
      const ok = days.length ? days.includes(wd) : wd === weekday(r.start_date);
      const startMonday = addDays(r.start_date, -((weekday(r.start_date) + 6) % 7));
      return ok && Math.floor(daysBetween(startMonday, ymd) / 7) % 2 === 0;
    }
    case 'monatlich': {
      const dom = +r.start_date.slice(8, 10);
      const [y, m] = ymd.split('-').map(Number);
      const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
      return +ymd.slice(8, 10) === Math.min(dom, last);
    }
    case 'individuell':
      if (r.interval_days > 0) return diff % r.interval_days === 0;
      return days.includes(wd);
    default: return false;
  }
}

export function generateRecurrence(db, ctx, r) {
  if (!r.active || r.deleted) return 0;
  const horizon = +db.setting('recurrence_horizon_days', '28');
  const today = todayYmd();
  let from = r.start_date > today ? r.start_date : today;
  if (r.generated_until && addDays(r.generated_until, 1) > from) from = addDays(r.generated_until, 1);
  let until = addDays(today, horizon);
  if (r.end_date && r.end_date < until) until = r.end_date;
  let created = 0;
  for (let d = from; d <= until; d = addDays(d, 1)) {
    if (!matchesRecurrence(r, d)) continue;
    if (db.get('SELECT id FROM orders WHERE recurrence_id = ? AND scheduled_date = ? AND deleted = 0', r.id, d)) continue;
    createOrder(db, ctx, {
      object_id: r.object_id, service_id: r.service_id, template_id: r.template_id, recurrence_id: r.id,
      scheduled_date: d, scheduled_time: r.start_time, planned_minutes: r.planned_minutes,
      assigned_user_id: r.assigned_user_id, notes: r.notes,
    });
    created++;
  }
  if (until >= from) db.run('UPDATE recurrences SET generated_until = ? WHERE id = ?', until, r.id);
  return created;
}

export function generateAllRecurrences(db) {
  const ctx = { user: { id: null, role: 'admin' } };
  let n = 0;
  db.tx(() => {
    for (const r of db.all('SELECT * FROM recurrences WHERE active = 1 AND deleted = 0')) n += generateRecurrence(db, ctx, r);
  });
  return n;
}

// ---------- Scan-Auflösung ----------
export function resolveScan(db, user, raw) {
  const s = String(raw || '').trim();
  if (!s) return { result: 'unbekannt' };
  let token = null;
  const m = s.match(/\/q\/([A-Za-z0-9_-]{16,64})/);
  if (m) token = m[1];
  else if (/^[A-Za-z0-9_-]{24}$/.test(s)) token = s;
  let qr = null;
  if (token) qr = db.get('SELECT * FROM qr_codes WHERE token = ? AND deleted = 0', token);
  if (!qr && /^GRBZ-QR-\d+$/i.test(s)) qr = db.get('SELECT * FROM qr_codes WHERE label = ? AND deleted = 0', s.toUpperCase());
  if (!qr && /^GRBZ-OBJ-\d+$/i.test(s)) {
    const o = db.get('SELECT id FROM objects WHERE object_no = ? AND deleted = 0', s.toUpperCase());
    if (o) qr = db.get("SELECT * FROM qr_codes WHERE object_id = ? AND target_type = 'object' AND active = 1 AND deleted = 0 LIMIT 1", o.id)
      || { id: null, target_type: 'object', object_id: o.id, active: 1 };
  }
  if (!qr) {
    // Artikel-Barcode (EAN) oder Artikelnummer
    const mat = db.get('SELECT id FROM materials WHERE (barcode = ? OR article_no = ?) AND deleted = 0', s, s);
    if (mat && can(user, 'materials.read')) return { result: 'ok', target: { type: 'material', id: mat.id } };
    const mach = db.get('SELECT id FROM machines WHERE (inventory_no = ? OR serial_no = ?) AND deleted = 0', s, s);
    if (mach && can(user, 'machines.read')) return { result: 'ok', target: { type: 'machine', id: mach.id } };
    return { result: 'unbekannt' };
  }
  if (!qr.active) return { result: 'inaktiv', qr_code_id: qr.id };
  let target;
  if (qr.target_type === 'object' || qr.target_type === 'area') {
    if (!canSee(db, user, 'objects', qr.object_id)) return { result: 'kein_zugriff', qr_code_id: qr.id };
    target = { type: 'object', id: qr.object_id, area_type: qr.area_type, area_name: qr.area_name };
  } else if (qr.target_type === 'machine') {
    if (!can(user, 'machines.read')) return { result: 'kein_zugriff', qr_code_id: qr.id };
    target = { type: 'machine', id: qr.machine_id };
  } else {
    if (!can(user, 'materials.read')) return { result: 'kein_zugriff', qr_code_id: qr.id };
    target = { type: 'material', id: qr.material_id };
  }
  return { result: 'ok', qr_code_id: qr.id, label: qr.label, target };
}

// ---------- Zeiterfassung ----------
function openEntry(db, userId, kind) {
  return db.get('SELECT * FROM time_entries WHERE user_id = ? AND kind = ? AND end_at IS NULL AND voided = 0 AND deleted = 0 ORDER BY start_at DESC LIMIT 1', userId, kind);
}

function applyCorrection(db, corr, decidedBy) {
  const patch = {};
  if (corr.new_start_at) patch.start_at = corr.new_start_at;
  if (corr.new_end_at !== undefined && corr.new_end_at !== null) patch.end_at = corr.new_end_at;
  if (corr.new_voided != null) patch.voided = corr.new_voided;
  patch.source = db.byId('time_entries', corr.entry_id).source === 'nachtrag' ? 'nachtrag' : 'korrigiert';
  db.update('time_entries', corr.entry_id, patch);
  db.update('time_corrections', corr.id, { status: 'genehmigt', decided_by: decidedBy, decided_at: nowIso() });
}

function deriveDefectForItem(db, ctx, order, item) {
  if (db.get('SELECT id FROM defects WHERE checklist_item_id = ? AND deleted = 0', item.id)) return;
  const d = db.insert('defects', {
    defect_no: numberFor(db, 'defects'), kind: 'mangel', customer_id: order.customer_id, object_id: order.object_id,
    order_id: order.id, checklist_item_id: item.id, title: `Checkliste: ${item.text}`, description: item.comment || null,
    reported_by: ctx.user.id, reported_at: nowIso(), source: 'checkliste', status: 'offen',
  });
  db.insert('defect_log', { defect_id: d.id, logged_at: nowIso(), user_id: ctx.user.id, action: 'erstellt', note: 'Automatisch aus Auftrags-Checkliste ' + (order.order_no || '') });
}

function ratingText(score) {
  if (score == null) return null;
  if (score >= 90) return 'sehr gut';
  if (score >= 75) return 'gut';
  if (score >= 60) return 'befriedigend';
  if (score >= 40) return 'ausreichend';
  return 'mangelhaft';
}

// =====================================================================
export const commands = {
  'entity.save'(ctx, { entity, id, data = {}, base_version }) {
    const { db, user } = ctx;
    if (!GENERIC.includes(entity)) throw bad('Unbekannter Datentyp.');
    const def = ENTITIES[entity];
    assertPerm(user, def.write);
    const existing = id ? db.byId(def.table, id) : null;
    if (existing && !existing.deleted) {
      checkVersion(existing, base_version);
      const clean = cleanFields(def, data, false);
      if (def.numberField && def.numberField in data) {
        const nv = (data[def.numberField] || '').trim();
        if (nv && nv !== existing[def.numberField]) {
          if (db.get(`SELECT id FROM ${def.table} WHERE ${def.numberField} = ? AND id <> ?`, nv, id)) throw bad('Diese Nummer ist bereits vergeben.');
          clean[def.numberField] = nv;
        }
      }
      validateRefs(db, entity, clean);
      const row = db.update(def.table, id, clean);
      db.audit(user.id, `${entity}.geaendert`, entity, id, { felder: Object.keys(clean) });
      return { row };
    }
    if (existing?.deleted) throw bad('Datensatz wurde gelöscht.');
    const clean = cleanFields(def, data, true);
    validateRefs(db, entity, clean);
    if (def.numberField) {
      const given = typeof data[def.numberField] === 'string' ? data[def.numberField].trim() : '';
      if (given && ['materials', 'machines'].includes(entity)) {
        if (db.get(`SELECT id FROM ${def.table} WHERE ${def.numberField} = ?`, given)) throw bad('Diese Nummer ist bereits vergeben.');
        clean[def.numberField] = given;
      } else clean[def.numberField] = numberFor(db, def.table);
    }
    if (entity === 'contact_history') clean.user_id = user.id;
    if (['pay_adjustments', 'overtime_adjustments'].includes(entity)) clean.created_by = user.id;
    const row = db.insert(def.table, { id: id || uuid(), ...clean });
    if (entity === 'objects') createQr(db, ctx, { target_type: 'object', object_id: row.id });
    if (entity === 'materials' && row.stock) {
      db.insert('stock_movements', { material_id: row.id, qty: row.stock, kind: 'anfangsbestand', user_id: user.id, moved_at: nowIso() });
    }
    db.audit(user.id, `${entity}.erstellt`, entity, row.id, { nr: def.numberField ? row[def.numberField] : undefined });
    return { row };
  },

  'entity.archive'(ctx, { entity, id, archived }) {
    const { db, user } = ctx;
    const def = ENTITIES[entity];
    if (!def?.archivable || !GENERIC.includes(entity)) throw bad('Dieser Datentyp kann nicht archiviert werden.');
    assertPerm(user, def.write);
    req(db.byId(def.table, id), 'Datensatz nicht gefunden.');
    const row = db.update(def.table, id, { archived: archived ? 1 : 0 });
    db.audit(user.id, archived ? `${entity}.archiviert` : `${entity}.reaktiviert`, entity, id);
    return { row };
  },

  'entity.delete'(ctx, { entity, id }) {
    const { db, user } = ctx;
    const def = ENTITIES[entity];
    if (!def?.deletable || !GENERIC.includes(entity)) throw bad('Dieser Datentyp kann nicht gelöscht werden.');
    assertPerm(user, def.write);
    db.update(def.table, id, { deleted: 1 });
    db.audit(user.id, `${entity}.geloescht`, entity, id);
    return {};
  },

  'customer.setServices'(ctx, { customer_id, service_ids = [] }) {
    const { db, user } = ctx;
    assertPerm(user, 'customers.write');
    requireRef(db, 'customers', customer_id, 'Der Kunde');
    syncJunction(db, 'customer_services', 'customer_id', customer_id, 'service_id', service_ids);
    db.audit(user.id, 'customers.dienstleistungen', 'customers', customer_id, { service_ids });
    return {};
  },

  'object.setEmployees'(ctx, { object_id, user_ids = [] }) {
    const { db, user } = ctx;
    assertPerm(user, 'objects.write');
    requireRef(db, 'objects', object_id, 'Das Objekt');
    syncJunction(db, 'object_employees', 'object_id', object_id, 'user_id', user_ids);
    touchObjectTree(db, object_id);
    db.audit(user.id, 'objects.mitarbeiter', 'objects', object_id, { user_ids });
    return {};
  },

  'template.saveItems'(ctx, { template_id, items = [] }) {
    const { db, user } = ctx;
    assertPerm(user, 'checklists.manage');
    requireRef(db, 'checklist_templates', template_id, 'Die Checkliste');
    const keep = new Set();
    items.forEach((it, i) => {
      const text = String(it.text || '').trim();
      if (!text) return;
      const data = { template_id, position: i, text: text.slice(0, 300), required: it.required ? 1 : 0, photo_required: it.photo_required ? 1 : 0 };
      const ex = it.id && db.byId('checklist_template_items', it.id);
      if (ex && ex.template_id === template_id) { db.update('checklist_template_items', ex.id, { ...data, deleted: 0 }); keep.add(ex.id); }
      else keep.add(db.insert('checklist_template_items', { id: it.id && !ex ? it.id : uuid(), ...data }).id);
    });
    for (const r of db.all('SELECT id FROM checklist_template_items WHERE template_id = ? AND deleted = 0', template_id)) {
      if (!keep.has(r.id)) db.update('checklist_template_items', r.id, { deleted: 1 });
    }
    db.update('checklist_templates', template_id, {});
    db.audit(user.id, 'checkliste.gespeichert', 'checklist_templates', template_id, { punkte: keep.size });
    return {};
  },

  // ---------- Aufträge ----------
  'order.save'(ctx, { id, data = {}, base_version }) {
    const { db, user } = ctx;
    assertPerm(user, 'orders.write');
    const existing = id ? db.byId('orders', id) : null;
    if (!existing) {
      req(data.object_id, 'Bitte ein Objekt auswählen.');
      const order = createOrder(db, ctx, data, id || uuid());
      db.audit(user.id, 'auftrag.erstellt', 'orders', order.id, { nr: order.order_no });
      return { row: order };
    }
    if (existing.deleted) throw bad('Der Auftrag wurde gelöscht.');
    checkVersion(existing, base_version);
    const patch = {};
    for (const k of ['scheduled_date', 'scheduled_time', 'planned_minutes', 'assigned_user_id', 'notes', 'service_id', 'template_id', 'object_id']) {
      if (k in data) patch[k] = data[k] === '' ? null : data[k];
    }
    if (patch.scheduled_date !== undefined && !YMD.test(patch.scheduled_date || '')) throw bad('Bitte ein gültiges Datum angeben.');
    if (patch.scheduled_time && !HM.test(patch.scheduled_time)) throw bad('Bitte eine gültige Uhrzeit angeben (HH:MM).');
    if (patch.assigned_user_id) requireRef(db, 'users', patch.assigned_user_id, 'Der Mitarbeiter');
    if (patch.object_id && patch.object_id !== existing.object_id) {
      if (existing.status !== 'geplant') throw bad('Das Objekt kann nur bei geplanten Aufträgen geändert werden.');
      requireRef(db, 'objects', patch.object_id, 'Das Objekt');
      patch.customer_id = db.byId('objects', patch.object_id).customer_id;
    }
    if (existing.completed_at && Object.keys(patch).some((k) => k !== 'notes')) throw bad('Abgeschlossene Aufträge können nicht mehr umgeplant werden.');
    const row = db.update('orders', id, patch);
    if ('template_id' in patch && patch.template_id !== existing.template_id) {
      const touched = db.get("SELECT COUNT(*) c FROM order_checklist_items WHERE order_id = ? AND result <> 'offen' AND deleted = 0", id).c;
      if (touched) throw bad('Die Checkliste wurde bereits bearbeitet und kann nicht mehr ausgetauscht werden.');
      db.run('UPDATE order_checklist_items SET deleted = 1, seq = ? WHERE order_id = ?', db.nextSeq(), id);
      instantiateChecklist(db, row, patch.template_id, Array.isArray(data.item_ids) ? data.item_ids : []);
    }
    if (patch.assigned_user_id !== undefined && patch.assigned_user_id !== existing.assigned_user_id) touchOrderTree(db, id);
    db.audit(user.id, 'auftrag.geaendert', 'orders', id, { felder: Object.keys(patch) });
    return { row };
  },

  'order.delete'(ctx, { id }) {
    const { db, user } = ctx;
    assertPerm(user, 'orders.write');
    const o = req(db.byId('orders', id), 'Auftrag nicht gefunden.');
    if (o.status !== 'geplant' || o.started_at) throw bad('Nur noch nicht begonnene Aufträge können gelöscht werden.');
    db.update('orders', id, { deleted: 1 });
    db.audit(user.id, 'auftrag.geloescht', 'orders', id, { nr: o.order_no });
    return {};
  },

  'order.setStatus'(ctx, { id, status, note, at }) {
    const { db, user } = ctx;
    const o = orderForExecution(db, user, id);
    if (!ORDER_STATUS[status] || status === 'abgeschlossen') throw bad('Ungültiger Status. Zum Abschließen bitte „Auftrag abschließen“ verwenden.');
    if (o.completed_at && !can(user, 'orders.write')) throw bad('Der Auftrag ist bereits abgeschlossen.');
    const patch = { status };
    if (status === 'in_bearbeitung' && !o.started_at) patch.started_at = isIso(at) ? at : nowIso();
    if (o.completed_at && status !== 'mangel') { patch.completed_at = null; patch.completed_by = null; }
    if (note) patch.notes = [o.notes, `${status === 'unterbrochen' ? 'Unterbrechung' : 'Hinweis'}: ${note}`].filter(Boolean).join('\n');
    const row = db.update('orders', id, patch);
    db.audit(user.id, 'auftrag.status', 'orders', id, { von: o.status, nach: status, note });
    return { row };
  },

  'order.checkItem'(ctx, { item_id, result, comment, at }) {
    const { db, user } = ctx;
    const item = db.byId('order_checklist_items', item_id);
    if (!item || item.deleted) throw new AppError(404, 'Checklistenpunkt nicht gefunden.');
    const o = orderForExecution(db, user, item.order_id);
    if (o.completed_at) throw bad('Der Auftrag ist bereits abgeschlossen.');
    if (!CHECK_RESULTS[result]) throw bad('Ungültiges Ergebnis.');
    const row = db.update('order_checklist_items', item_id, {
      result, comment: comment != null ? String(comment).slice(0, 2000) : item.comment,
      checked_by: user.id, checked_at: isIso(at) ? at : nowIso(),
    });
    if (o.status === 'geplant') db.update('orders', o.id, { status: 'in_bearbeitung', started_at: o.started_at || (isIso(at) ? at : nowIso()) });
    if (result === 'mangel') deriveDefectForItem(db, ctx, o, row);
    return { row };
  },

  'order.addItem'(ctx, { id, order_id, text, required }) {
    const { db, user } = ctx;
    const o = orderForExecution(db, user, order_id);
    if (o.completed_at) throw bad('Der Auftrag ist bereits abgeschlossen.');
    req(String(text || '').trim(), 'Bitte einen Text eingeben.');
    const pos = db.get('SELECT COALESCE(MAX(position), -1) + 1 p FROM order_checklist_items WHERE order_id = ?', order_id).p;
    const row = db.insert('order_checklist_items', { id: id || uuid(), order_id, position: pos, text: String(text).trim().slice(0, 300), required: required ? 1 : 0 });
    return { row };
  },

  'order.complete'(ctx, { id, final_report, at }) {
    const { db, user } = ctx;
    const o = orderForExecution(db, user, id);
    if (o.completed_at) return { row: o }; // idempotent
    const items = db.all('SELECT * FROM order_checklist_items WHERE order_id = ? AND deleted = 0 ORDER BY position', id);
    const problems = checklistProblems(items, (itemId) => !!db.get('SELECT id FROM photos WHERE checklist_item_id = ? AND deleted = 0', itemId));
    if (problems.length) throw new AppError(422, 'Die Checkliste ist noch nicht vollständig.', { details: problems });
    const hasDefect = items.some((it) => it.result === 'mangel');
    const report = String(final_report || '').trim() || autoReport(items);
    const row = db.update('orders', id, {
      status: hasDefect ? 'mangel' : 'abgeschlossen', final_report: report.slice(0, 5000),
      completed_at: isIso(at) ? at : nowIso(), completed_by: user.id, started_at: o.started_at || (isIso(at) ? at : nowIso()),
    });
    db.audit(user.id, 'auftrag.abgeschlossen', 'orders', id, { nr: o.order_no, mangel: hasDefect });
    return { row };
  },

  'recurrence.save'(ctx, { id, data = {}, base_version }) {
    const { db, user } = ctx;
    assertPerm(user, 'orders.write');
    req(data.object_id, 'Bitte ein Objekt auswählen.');
    requireRef(db, 'objects', data.object_id, 'Das Objekt');
    if (!FREQUENCIES[data.frequency]) throw bad('Bitte einen Rhythmus auswählen.');
    if (!YMD.test(data.start_date || '')) throw bad('Bitte ein gültiges Startdatum angeben.');
    if (data.end_date && (!YMD.test(data.end_date) || data.end_date < data.start_date)) throw bad('Das Enddatum muss nach dem Startdatum liegen.');
    const weekdays = Array.isArray(data.weekdays) ? data.weekdays.map(Number).filter((n) => n >= 0 && n <= 6) : String(data.weekdays || '').split(',').filter(Boolean).map(Number);
    if (data.frequency === 'zweimal_woechentlich' && weekdays.length !== 2) throw bad('Bitte genau zwei Wochentage auswählen.');
    if (data.frequency === 'individuell' && !(+data.interval_days > 0) && !weekdays.length) throw bad('Bitte ein Intervall in Tagen oder Wochentage angeben.');
    const obj = db.byId('objects', data.object_id);
    const clean = {
      customer_id: obj.customer_id, object_id: obj.id, service_id: data.service_id || null, template_id: data.template_id || null,
      frequency: data.frequency, weekdays: weekdays.join(','), interval_days: +data.interval_days || null,
      start_date: data.start_date, end_date: data.end_date || null, start_time: data.start_time || null,
      planned_minutes: +data.planned_minutes || null, assigned_user_id: data.assigned_user_id || null, notes: data.notes || null,
      active: data.active === undefined ? 1 : (data.active ? 1 : 0),
    };
    const existing = id ? db.byId('recurrences', id) : null;
    let row;
    if (existing) {
      checkVersion(existing, base_version);
      // Zukünftige, unberührte Termine neu erzeugen
      const tomorrow = addDays(todayYmd(), 1);
      for (const o of db.all("SELECT id FROM orders WHERE recurrence_id = ? AND scheduled_date >= ? AND status = 'geplant' AND started_at IS NULL AND deleted = 0", id, tomorrow)) {
        db.update('orders', o.id, { deleted: 1 });
      }
      row = db.update('recurrences', id, { ...clean, generated_until: todayYmd() });
    } else {
      row = db.insert('recurrences', { id: id || uuid(), ...clean });
    }
    const created = generateRecurrence(db, ctx, row);
    db.audit(user.id, existing ? 'serie.geaendert' : 'serie.erstellt', 'recurrences', row.id, { erzeugt: created });
    return { row: db.byId('recurrences', row.id), created };
  },

  'recurrence.delete'(ctx, { id }) {
    const { db, user } = ctx;
    assertPerm(user, 'orders.write');
    const tomorrow = addDays(todayYmd(), 1);
    for (const o of db.all("SELECT id FROM orders WHERE recurrence_id = ? AND scheduled_date >= ? AND status = 'geplant' AND started_at IS NULL AND deleted = 0", id, tomorrow)) {
      db.update('orders', o.id, { deleted: 1 });
    }
    db.update('recurrences', id, { deleted: 1, active: 0 });
    db.audit(user.id, 'serie.geloescht', 'recurrences', id);
    return {};
  },

  // ---------- QR ----------
  'qr.create'(ctx, p) {
    assertPerm(ctx.user, 'qr.manage');
    return { row: createQr(ctx.db, ctx, p) };
  },

  'qr.reassign'(ctx, p) {
    const { db, user } = ctx;
    assertPerm(user, 'qr.manage');
    const qr = req(db.byId('qr_codes', p.id), 'QR-Code nicht gefunden.');
    const tmp = { target_type: p.target_type, object_id: null, area_type: null, area_name: null, machine_id: null, material_id: null };
    if (!QR_TARGET_TYPES[p.target_type]) throw bad('Ungültiger QR-Code-Typ.');
    if (['object', 'area'].includes(p.target_type)) { requireRef(db, 'objects', req(p.object_id, 'Bitte ein Objekt auswählen.'), 'Das Objekt'); tmp.object_id = p.object_id; }
    if (p.target_type === 'area') {
      if (!QR_AREA_TYPES[p.area_type]) throw bad('Bitte einen Bereich auswählen.');
      tmp.area_type = p.area_type; tmp.area_name = p.area_name || QR_AREA_TYPES[p.area_type];
    }
    if (p.target_type === 'machine') { requireRef(db, 'machines', req(p.machine_id, 'Bitte eine Maschine auswählen.'), 'Die Maschine'); tmp.machine_id = p.machine_id; }
    if (p.target_type === 'material') { requireRef(db, 'materials', req(p.material_id, 'Bitte einen Artikel auswählen.'), 'Der Artikel'); tmp.material_id = p.material_id; }
    const row = db.update('qr_codes', qr.id, tmp);
    db.audit(user.id, 'qr.neu_zugeordnet', 'qr_codes', qr.id, {
      label: qr.label, alt: { typ: qr.target_type, objekt: qr.object_id, bereich: qr.area_name, maschine: qr.machine_id, artikel: qr.material_id },
      neu: { typ: tmp.target_type, objekt: tmp.object_id, bereich: tmp.area_name, maschine: tmp.machine_id, artikel: tmp.material_id },
    });
    return { row };
  },

  'qr.setActive'(ctx, { id, active }) {
    const { db, user } = ctx;
    assertPerm(user, 'qr.manage');
    const qr = req(db.byId('qr_codes', id), 'QR-Code nicht gefunden.');
    const row = db.update('qr_codes', id, { active: active ? 1 : 0, deactivated_at: active ? null : nowIso() });
    db.audit(user.id, active ? 'qr.aktiviert' : 'qr.deaktiviert', 'qr_codes', id, { label: qr.label });
    return { row };
  },

  'scan.log'(ctx, { id, raw, method, scanned_at }) {
    const { db, user } = ctx;
    assertPerm(user, 'qr.scan');
    const res = resolveScan(db, user, raw);
    if (!db.byId('scans', id || '')) {
      db.insert('scans', {
        id: id || uuid(), qr_code_id: res.qr_code_id || null, raw: String(raw || '').slice(0, 200),
        method: ['kamera', 'scanner', 'manuell', 'link'].includes(method) ? method : 'manuell', result: res.result,
        user_id: user.id, scanned_at: isIso(scanned_at) ? scanned_at : nowIso(),
      });
    }
    return res;
  },

  // ---------- Zeiterfassung ----------
  'time.clock'(ctx, { id, action, at, object_id, order_id, note }) {
    const { db, user } = ctx;
    assertPerm(user, 'time.own');
    const ts = isIso(at) ? new Date(at).toISOString() : nowIso();
    if (Date.parse(ts) > Date.now() + 5 * 6e4) throw bad('Der Zeitstempel liegt in der Zukunft. Bitte Geräteuhrzeit prüfen.');
    if (Date.parse(ts) < Date.now() - 7 * 864e5) throw bad('Zeitstempel älter als 7 Tage können nur über eine Korrektur erfasst werden.');
    const source = Math.abs(Date.parse(ts) - Date.now()) > 2 * 6e4 ? 'offline' : 'stempel';
    const work = openEntry(db, user.id, 'arbeit');
    const pause = openEntry(db, user.id, 'pause');
    if (object_id) requireRef(db, 'objects', object_id, 'Das Objekt');
    if (order_id) requireRef(db, 'orders', order_id, 'Der Auftrag');
    switch (action) {
      case 'start': {
        if (work) throw bad('Sie sind bereits eingestempelt.');
        const row = db.insert('time_entries', { id: id || uuid(), user_id: user.id, kind: 'arbeit', start_at: ts, object_id: object_id || null, order_id: order_id || null, note: note || null, source, recorded_start_at: nowIso() });
        db.audit(user.id, 'zeit.beginn', 'time_entries', row.id);
        return { row };
      }
      case 'pause': {
        if (!work) throw bad('Sie sind nicht eingestempelt.');
        if (pause) throw bad('Es läuft bereits eine Pause.');
        if (ts < work.start_at) throw bad('Die Pause kann nicht vor Arbeitsbeginn liegen.');
        const row = db.insert('time_entries', { id: id || uuid(), user_id: user.id, kind: 'pause', parent_id: work.id, start_at: ts, source, recorded_start_at: nowIso() });
        return { row };
      }
      case 'resume': {
        if (!pause) throw bad('Es läuft keine Pause.');
        if (ts < pause.start_at) throw bad('Das Pausenende liegt vor dem Pausenbeginn.');
        return { row: db.update('time_entries', pause.id, { end_at: ts, recorded_end_at: nowIso() }) };
      }
      case 'stop': {
        if (!work) throw bad('Sie sind nicht eingestempelt.');
        if (ts < work.start_at) throw bad('Das Arbeitsende liegt vor dem Arbeitsbeginn.');
        if (pause) db.update('time_entries', pause.id, { end_at: ts, recorded_end_at: nowIso() });
        const row = db.update('time_entries', work.id, { end_at: ts, recorded_end_at: nowIso(), note: note || work.note });
        db.audit(user.id, 'zeit.ende', 'time_entries', row.id);
        return { row };
      }
      default: throw bad('Unbekannte Stempelaktion.');
    }
  },

  'time.correction'(ctx, p) {
    const { db, user } = ctx;
    assertPerm(user, 'time.own');
    const reason = String(p.reason || '').trim();
    if (reason.length < 3) throw bad('Bitte eine Begründung für die Korrektur angeben.');
    let entry;
    if (p.entry_id) {
      entry = req(db.byId('time_entries', p.entry_id), 'Zeiteintrag nicht gefunden.');
      if (entry.user_id !== user.id) assertPerm(user, 'time.all');
    } else {
      // Nachtrag eines vergessenen Eintrags (gilt erst nach Genehmigung)
      const forUser = p.user_id || user.id;
      if (forUser !== user.id) assertPerm(user, 'time.all');
      requireRef(db, 'users', forUser, 'Der Mitarbeiter');
      if (!isIso(p.new_start_at) || !isIso(p.new_end_at)) throw bad('Bitte Beginn und Ende angeben.');
      entry = db.insert('time_entries', {
        id: p.new_entry_id || uuid(), user_id: forUser, kind: p.kind === 'pause' ? 'pause' : 'arbeit', start_at: p.new_start_at,
        end_at: p.new_end_at, object_id: p.object_id || null, source: 'nachtrag', voided: 1, recorded_start_at: nowIso(),
      });
    }
    const ns = p.new_start_at ? new Date(p.new_start_at).toISOString() : null;
    const ne = p.new_end_at ? new Date(p.new_end_at).toISOString() : null;
    if (ns && ne && ne <= ns) throw bad('Das Ende muss nach dem Beginn liegen.');
    if (ne && !ns && ne <= entry.start_at) throw bad('Das Ende muss nach dem Beginn liegen.');
    const corr = db.insert('time_corrections', {
      id: p.id || uuid(), entry_id: entry.id, requested_by: user.id, requested_at: nowIso(),
      old_start_at: p.entry_id ? entry.start_at : null, old_end_at: p.entry_id ? entry.end_at : null, old_voided: p.entry_id ? entry.voided : 1,
      new_start_at: ns, new_end_at: ne, new_voided: p.void ? 1 : 0, reason, status: 'beantragt',
    });
    db.audit(user.id, 'zeit.korrektur_beantragt', 'time_corrections', corr.id, { eintrag: entry.id });
    if (can(user, 'time.approve')) {
      applyCorrection(db, corr, user.id);
      db.audit(user.id, 'zeit.korrektur_genehmigt', 'time_corrections', corr.id, { eintrag: entry.id, selbst: true });
    }
    return { row: db.byId('time_corrections', corr.id) };
  },

  'time.decide'(ctx, { id, approve, comment }) {
    const { db, user } = ctx;
    assertPerm(user, 'time.approve');
    const corr = req(db.byId('time_corrections', id), 'Korrekturantrag nicht gefunden.');
    if (corr.status !== 'beantragt') throw bad('Dieser Antrag wurde bereits entschieden.');
    if (approve) {
      db.update('time_corrections', id, { decision_comment: comment || null });
      applyCorrection(db, db.byId('time_corrections', id), user.id);
    } else {
      db.update('time_corrections', id, { status: 'abgelehnt', decided_by: user.id, decided_at: nowIso(), decision_comment: comment || null });
    }
    db.audit(user.id, approve ? 'zeit.korrektur_genehmigt' : 'zeit.korrektur_abgelehnt', 'time_corrections', id);
    return { row: db.byId('time_corrections', id) };
  },

  // ---------- Material ----------
  'stock.move'(ctx, { id, material_id, qty, kind, object_id, order_id, note, moved_at }) {
    const { db, user } = ctx;
    const mat = db.byId('materials', material_id);
    if (!mat || mat.deleted) throw bad('Artikel nicht gefunden.');
    const n = Number(String(qty).replace(',', '.'));
    if (!isFinite(n)) throw bad('Bitte eine gültige Menge angeben.');
    let delta;
    switch (kind) {
      case 'verbrauch': assertPerm(user, 'materials.consume', 'materials.write'); if (n <= 0) throw bad('Die Menge muss größer als 0 sein.'); delta = -n; break;
      case 'zugang': assertPerm(user, 'materials.write'); if (n <= 0) throw bad('Die Menge muss größer als 0 sein.'); delta = n; break;
      case 'korrektur': assertPerm(user, 'materials.write'); if (!n) throw bad('Die Menge darf nicht 0 sein.'); delta = n; break;
      case 'inventur': assertPerm(user, 'materials.write'); if (n < 0) throw bad('Der Zählbestand darf nicht negativ sein.'); delta = n - mat.stock; break;
      default: throw bad('Unbekannte Buchungsart.');
    }
    if (kind !== 'inventur' && !String(note || '').trim() && kind === 'korrektur') throw bad('Bitte einen Grund für die Korrektur angeben.');
    const mv = db.insert('stock_movements', {
      id: id || uuid(), material_id, qty: delta, kind, object_id: object_id || null, order_id: order_id || null,
      user_id: user.id, note: note || null, moved_at: isIso(moved_at) ? moved_at : nowIso(),
    });
    const m2 = db.update('materials', material_id, { stock: Math.round((mat.stock + delta) * 1000) / 1000 });
    return { row: mv, material: m2, low: m2.stock < m2.min_stock || (m2.min_stock > 0 && m2.stock <= m2.min_stock) };
  },

  // ---------- Maschinen ----------
  'machine.event'(ctx, p) {
    const { db, user } = ctx;
    const m = db.byId('machines', p.machine_id);
    if (!m || m.deleted) throw bad('Maschine nicht gefunden.');
    const kinds = ['wartung', 'reparatur', 'defekt', 'pruefung'];
    if (!kinds.includes(p.kind)) throw bad('Unbekannte Ereignisart.');
    if (p.kind === 'defekt') assertPerm(user, 'machines.read'); else assertPerm(user, 'machines.write');
    const date = YMD.test(p.event_date || '') ? p.event_date : todayYmd();
    req(String(p.description || '').trim(), 'Bitte eine Beschreibung angeben.');
    const ev = db.insert('machine_events', {
      id: p.id || uuid(), machine_id: m.id, kind: p.kind, event_date: date, description: String(p.description).slice(0, 3000),
      cost: p.cost ? +String(p.cost).replace(',', '.') || null : null, performed_by: p.performed_by || null,
      status: p.kind === 'defekt' ? 'offen' : 'erledigt', user_id: user.id,
    });
    const patch = {};
    if (p.kind === 'defekt') patch.condition = 'defekt';
    if (p.kind === 'reparatur' && ['defekt', 'in_reparatur'].includes(m.condition)) patch.condition = 'gut';
    if (p.kind === 'wartung' || p.kind === 'pruefung') {
      if (YMD.test(p.next_due || '')) patch.next_maintenance = p.next_due;
      else if (m.maintenance_interval_days) patch.next_maintenance = addDays(date, m.maintenance_interval_days);
    }
    if (p.kind === 'reparatur') {
      for (const d of db.all("SELECT id FROM machine_events WHERE machine_id = ? AND kind = 'defekt' AND status = 'offen' AND deleted = 0", m.id)) {
        db.update('machine_events', d.id, { status: 'erledigt' });
      }
    }
    if (Object.keys(patch).length) db.update('machines', m.id, patch);
    db.audit(user.id, 'maschine.' + p.kind, 'machines', m.id, { ereignis: ev.id });
    return { row: ev };
  },

  // ---------- Qualität ----------
  'inspection.save'(ctx, p) {
    const { db, user } = ctx;
    assertPerm(user, 'quality.write');
    requireRef(db, 'objects', req(p.object_id, 'Bitte ein Objekt auswählen.'), 'Das Objekt');
    if (db.byId('inspections', p.id || '')) return { row: db.byId('inspections', p.id) };
    const items = (p.items || []).filter((i) => String(i.text || '').trim());
    if (!items.length) throw bad('Die Kontrolle enthält keine Prüfpunkte.');
    const rated = items.filter((i) => i.rating !== null && i.rating !== undefined && i.rating !== '');
    for (const i of rated) if (!(+i.rating >= 0 && +i.rating <= 5)) throw bad('Bewertungen müssen zwischen 0 und 5 liegen.');
    const score = rated.length ? Math.round((rated.reduce((s, i) => s + +i.rating, 0) / (rated.length * 5)) * 1000) / 10 : null;
    const obj = db.byId('objects', p.object_id);
    const ins = db.insert('inspections', {
      id: p.id || uuid(), inspection_no: numberFor(db, 'inspections'), object_id: obj.id, order_id: p.order_id || null,
      template_id: p.template_id || null, inspector_id: user.id, inspected_at: isIso(p.inspected_at) ? p.inspected_at : nowIso(),
      score, rating: ratingText(score), notes: p.notes || null, customer_visible: p.customer_visible ? 1 : 0,
    });
    items.forEach((i, idx) => {
      db.insert('inspection_items', { id: i.id && UUID.test(i.id) && !db.byId('inspection_items', i.id) ? i.id : uuid(), inspection_id: ins.id, position: idx, text: String(i.text).slice(0, 300), rating: rated.includes(i) ? +i.rating : null, comment: i.comment || null });
      if (i.create_defect) {
        const d = db.insert('defects', {
          defect_no: numberFor(db, 'defects'), kind: 'mangel', customer_id: obj.customer_id, object_id: obj.id, inspection_id: ins.id,
          title: `Kontrolle: ${i.text}`, description: i.comment || null, reported_by: user.id, reported_at: nowIso(), source: 'kontrolle',
          responsible_user_id: p.responsible_user_id || null, due_date: YMD.test(p.due_date || '') ? p.due_date : null, status: 'offen',
        });
        db.insert('defect_log', { defect_id: d.id, logged_at: nowIso(), user_id: user.id, action: 'erstellt', note: `Aus Qualitätskontrolle ${ins.inspection_no}` });
      }
    });
    db.audit(user.id, 'kontrolle.erstellt', 'inspections', ins.id, { nr: ins.inspection_no, score });
    return { row: ins };
  },

  'inspection.update'(ctx, { id, notes, customer_visible }) {
    const { db, user } = ctx;
    assertPerm(user, 'quality.write');
    req(db.byId('inspections', id), 'Kontrolle nicht gefunden.');
    const patch = {};
    if (notes !== undefined) patch.notes = notes;
    if (customer_visible !== undefined) patch.customer_visible = customer_visible ? 1 : 0;
    return { row: db.update('inspections', id, patch) };
  },

  'defect.save'(ctx, { id, data = {}, base_version }) {
    const { db, user } = ctx;
    const existing = id ? db.byId('defects', id) : null;
    const fields = ['kind', 'object_id', 'order_id', 'title', 'description', 'responsible_user_id', 'due_date', 'priority', 'measures', 'customer_visible', 'source', 'customer_id'];
    const d = {};
    for (const k of fields) if (k in data) d[k] = data[k] === '' ? null : data[k];
    if (d.kind && !DEFECT_KINDS[d.kind]) throw bad('Ungültige Art.');
    if (d.due_date && !YMD.test(d.due_date)) throw bad('Ungültige Frist.');
    if (d.priority && !['niedrig', 'normal', 'hoch', 'dringend'].includes(d.priority)) throw bad('Ungültige Priorität.');
    if (d.responsible_user_id) requireRef(db, 'users', d.responsible_user_id, 'Der verantwortliche Mitarbeiter');
    if ('customer_visible' in d) d.customer_visible = d.customer_visible ? 1 : 0;
    if (!existing) {
      assertPerm(user, 'defects.report', 'quality.write');
      req(String(d.title || '').trim(), 'Bitte einen Titel angeben.');
      if (!d.object_id && !d.customer_id) throw bad('Bitte ein Objekt auswählen.');
      if (d.object_id) {
        requireRef(db, 'objects', d.object_id, 'Das Objekt');
        if (!can(user, 'quality.write')) assertSee(db, user, 'objects', d.object_id);
        d.customer_id = db.byId('objects', d.object_id).customer_id;
      }
      if (!can(user, 'quality.write')) { delete d.responsible_user_id; delete d.due_date; delete d.customer_visible; }
      const row = db.insert('defects', {
        id: id || uuid(), defect_no: numberFor(db, 'defects'), kind: d.kind || 'mangel', ...d,
        reported_by: user.id, reported_at: nowIso(), status: 'offen', source: d.source || 'intern',
      });
      db.insert('defect_log', { defect_id: row.id, logged_at: nowIso(), user_id: user.id, action: 'erstellt', note: row.description });
      db.audit(user.id, 'mangel.erstellt', 'defects', row.id, { nr: row.defect_no });
      return { row };
    }
    assertPerm(user, 'quality.write');
    checkVersion(existing, base_version);
    delete d.source;
    const row = db.update('defects', id, d);
    const changed = Object.keys(d).filter((k) => String(existing[k] ?? '') !== String(d[k] ?? ''));
    if (changed.length) db.insert('defect_log', { defect_id: id, logged_at: nowIso(), user_id: user.id, action: 'geaendert', note: 'Geändert: ' + changed.join(', ') });
    return { row };
  },

  'defect.setStatus'(ctx, { id, status, note }) {
    const { db, user } = ctx;
    const d = db.byId('defects', id);
    if (!d || d.deleted) throw new AppError(404, 'Mangel nicht gefunden.');
    if (!DEFECT_STATUS[status]) throw bad('Ungültiger Status.');
    const isResponsible = d.responsible_user_id === user.id;
    if (!can(user, 'quality.write') && !(isResponsible && ['in_bearbeitung', 'behoben'].includes(status))) {
      throw new AppError(403, 'Für diese Statusänderung fehlt Ihnen die Berechtigung.');
    }
    if (status === 'behoben' && !String(note || '').trim()) throw bad('Bitte beschreiben Sie, wie der Mangel behoben wurde (Erledigungsnachweis).');
    if (status === 'verworfen' && !String(note || '').trim()) throw bad('Bitte begründen Sie, warum der Mangel verworfen wird.');
    const patch = { status };
    if (status === 'behoben') { patch.resolved_at = nowIso(); patch.resolved_by = user.id; patch.resolution_note = note; }
    if (status === 'offen' || status === 'in_bearbeitung') { patch.resolved_at = null; }
    const row = db.update('defects', id, patch);
    db.insert('defect_log', { defect_id: id, logged_at: nowIso(), user_id: user.id, action: `status:${status}`, note: note || null });
    db.audit(user.id, 'mangel.status', 'defects', id, { von: d.status, nach: status });
    return { row };
  },

  'defect.comment'(ctx, { id, defect_id, note }) {
    const { db, user } = ctx;
    assertSee(db, user, 'defects', defect_id);
    req(String(note || '').trim(), 'Bitte einen Kommentar eingeben.');
    return { row: db.insert('defect_log', { id: id || uuid(), defect_id, logged_at: nowIso(), user_id: user.id, action: 'kommentar', note: String(note).slice(0, 3000) }) };
  },

  // ---------- Winterdienst ----------
  'winter.save'(ctx, { id, data = {}, base_version }) {
    const { db, user } = ctx;
    assertPerm(user, 'winter.execute', 'winter.write');
    const existing = id ? db.byId('winter_operations', id) : null;
    const d = {};
    for (const k of ['object_id', 'start_at', 'end_at', 'weather', 'temperature', 'snow_cm', 'activity', 'spreading_material', 'spreading_amount_kg', 'notes']) {
      if (k in data) d[k] = data[k] === '' ? null : data[k];
    }
    if ('area_ids' in data) d.area_ids = JSON.stringify(Array.isArray(data.area_ids) ? data.area_ids : []);
    for (const k of ['temperature', 'snow_cm', 'spreading_amount_kg']) if (d[k] != null) {
      const n = Number(String(d[k]).replace(',', '.'));
      if (!isFinite(n)) throw bad('Bitte gültige Zahlen angeben.');
      d[k] = n;
    }
    for (const k of ['start_at', 'end_at']) if (d[k] != null) { if (!isIso(d[k])) throw bad('Ungültiger Zeitpunkt.'); d[k] = new Date(d[k]).toISOString(); }
    if (!existing) {
      requireRef(db, 'objects', req(d.object_id, 'Bitte ein Objekt auswählen.'), 'Das Objekt');
      if (!can(user, 'winter.write')) assertSee(db, user, 'objects', d.object_id);
      d.start_at = d.start_at || nowIso();
      const row = db.insert('winter_operations', { id: id || uuid(), operation_no: numberFor(db, 'winter_operations'), season: seasonOf(d.start_at), user_id: user.id, status: 'offen', ...d });
      db.audit(user.id, 'winterdienst.erstellt', 'winter_operations', row.id, { nr: row.operation_no });
      return { row };
    }
    if (existing.user_id !== user.id) assertPerm(user, 'winter.write');
    if (existing.status === 'abgeschlossen') throw bad('Der Einsatz ist bereits unterschrieben und abgeschlossen.');
    checkVersion(existing, base_version);
    if (d.start_at) d.season = seasonOf(d.start_at);
    const st = d.start_at || existing.start_at;
    if (d.end_at && d.end_at < st) throw bad('Das Einsatzende liegt vor dem Beginn.');
    return { row: db.update('winter_operations', id, d) };
  },

  'winter.sign'(ctx, { id, signature }) {
    const { db, user } = ctx;
    const op = req(db.byId('winter_operations', id), 'Einsatz nicht gefunden.');
    if (op.user_id !== user.id) assertPerm(user, 'winter.write');
    if (op.status === 'abgeschlossen') return { row: op };
    if (!op.end_at) throw bad('Bitte zuerst das Einsatzende erfassen.');
    if (!op.activity) throw bad('Bitte die durchgeführte Tätigkeit angeben.');
    if (!op.weather) throw bad('Bitte die Wetterbedingungen angeben.');
    if (typeof signature !== 'string' || !signature.startsWith('data:image/png;base64,') || signature.length > 300000) throw bad('Bitte unterschreiben.');
    const row = db.update('winter_operations', id, { signature, signed_at: nowIso(), status: 'abgeschlossen' });
    db.audit(user.id, 'winterdienst.unterschrieben', 'winter_operations', id, { nr: op.operation_no });
    return { row };
  },

  // ---------- Fotos & Dokumente (Metadaten) ----------
  'photo.update'(ctx, { id, comment, category, customer_visible }) {
    const { db, user } = ctx;
    const ph = db.byId('photos', id);
    if (!ph || ph.deleted) throw new AppError(404, 'Foto nicht gefunden.');
    assertSee(db, user, 'photos', id);
    const patch = {};
    if (comment !== undefined) {
      if (ph.user_id !== user.id) assertPerm(user, 'photos.release');
      patch.comment = String(comment || '').slice(0, 1000);
    }
    if (category !== undefined) { if (!PHOTO_CATEGORIES[category]) throw bad('Ungültige Kategorie.'); patch.category = category; }
    if (customer_visible !== undefined) { assertPerm(user, 'photos.release'); patch.customer_visible = customer_visible ? 1 : 0; }
    const row = db.update('photos', id, patch);
    if ('customer_visible' in patch) db.audit(user.id, patch.customer_visible ? 'foto.freigegeben' : 'foto.freigabe_entzogen', 'photos', id);
    return { row };
  },

  'photo.delete'(ctx, { id }) {
    const { db, user } = ctx;
    const ph = db.byId('photos', id);
    if (!ph || ph.deleted) return {};
    const ownRecent = ph.user_id === user.id && Date.parse(ph.created_at) > Date.now() - 864e5;
    if (!ownRecent) assertPerm(user, 'photos.release');
    db.update('photos', id, { deleted: 1 });
    ctx.removeFiles?.push(...['photos', 'thumbs'].map((d) => [d, ph.file_name]));
    db.audit(user.id, 'foto.geloescht', 'photos', id);
    return {};
  },

  'document.update'(ctx, { id, data = {} }) {
    const { db, user } = ctx;
    assertPerm(user, 'documents.write');
    req(db.byId('documents', id), 'Dokument nicht gefunden.');
    const patch = {};
    for (const k of ['title', 'kind', 'customer_id', 'object_id', 'notes']) if (k in data) patch[k] = data[k] || null;
    if ('customer_visible' in data) patch.customer_visible = data.customer_visible ? 1 : 0;
    if ('title' in patch && !patch.title) throw bad('Bitte einen Titel angeben.');
    const row = db.update('documents', id, patch);
    db.audit(user.id, 'dokument.geaendert', 'documents', id);
    return { row };
  },

  'document.delete'(ctx, { id }) {
    const { db, user } = ctx;
    assertPerm(user, 'documents.write');
    const doc = db.byId('documents', id);
    if (!doc || doc.deleted) return {};
    db.update('documents', id, { deleted: 1 });
    ctx.removeFiles?.push(['documents', doc.file_name]);
    db.audit(user.id, 'dokument.geloescht', 'documents', id, { titel: doc.title });
    return {};
  },
};

function validateRefs(db, entity, clean) {
  if (clean.customer_id) requireRef(db, 'customers', clean.customer_id, 'Der Kunde');
  if (clean.object_id) requireRef(db, 'objects', clean.object_id, 'Das Objekt');
  if (clean.service_id) requireRef(db, 'services', clean.service_id, 'Die Dienstleistung');
  if (clean.user_id && entity !== 'contact_history') requireRef(db, 'users', clean.user_id, 'Der Mitarbeiter');
  if (clean.responsible_user_id) requireRef(db, 'users', clean.responsible_user_id, 'Der Mitarbeiter');
  if (entity === 'winter_standby' && clean.start_at && clean.end_at && clean.end_at <= clean.start_at) throw bad('Das Ende muss nach dem Beginn liegen.');
  if (entity === 'pay_rules') {
    if ('kind' in clean && !RULE_KINDS[clean.kind]) throw bad('Unbekannte Berechnungsart.');
    if ('scope_type' in clean && !SCOPE_TYPES[clean.scope_type]) throw bad('Ungültiger Geltungsbereich.');
    if (clean.scope_type && clean.scope_type !== 'alle') {
      const t = { abteilung: 'departments', beschaeftigungsart: 'employment_types', position: 'positions', mitarbeiter: 'users', objekt: 'objects' }[clean.scope_type];
      requireRef(db, t, req(clean.scope_id, 'Bitte die Auswahl für den Geltungsbereich treffen.'), 'Die Auswahl');
    }
    if (clean.scope_type === 'alle') clean.scope_id = null;
    if (clean.kind === 'objektverguetung' && clean.scope_type && clean.scope_type !== 'objekt') throw bad('Objektbezogene Vergütung bitte mit Geltungsbereich „Objekt“ anlegen.');
    if (clean.kind && clean.scope_type === 'objekt' && clean.kind !== 'objektverguetung') throw bad('Der Geltungsbereich „Objekt“ ist nur für die objektbezogene Vergütung vorgesehen.');
    if ('params' in clean) { const err = validateRuleParams(clean.kind, JSON.parse(clean.params || '{}')); if (err) throw bad(err); }
    if (clean.valid_from && clean.valid_to && clean.valid_to < clean.valid_from) throw bad('„Gültig bis“ liegt vor „Gültig ab“.');
  }
  if (clean.amount !== undefined && clean.amount !== null && entity === 'pay_adjustments' && clean.amount <= 0) throw bad('Bitte einen positiven Betrag angeben (die Art bestimmt Zuschlag oder Abzug).');
  if (entity === 'overtime_adjustments' && clean.minutes === 0) throw bad('Bitte eine Minutenanzahl ungleich 0 angeben.');
}

function syncJunction(db, table, ownerCol, ownerId, refCol, ids) {
  const want = new Set((ids || []).filter(Boolean));
  const rows = db.all(`SELECT * FROM ${table} WHERE ${ownerCol} = ?`, ownerId);
  for (const r of rows) {
    const should = want.has(r[refCol]);
    if (should && r.deleted) db.update(table, r.id, { deleted: 0 });
    if (!should && !r.deleted) db.update(table, r.id, { deleted: 1 });
    want.delete(r[refCol]);
  }
  for (const id of want) db.insert(table, { [ownerCol]: ownerId, [refCol]: id });
}

/** Führt einen Befehl transaktional aus. */
export function runCommand(ctx, type, payload) {
  const fn = commands[type];
  if (!fn) throw bad(`Unbekannter Befehl: ${type}`);
  return ctx.db.tx(() => fn(ctx, payload || {}));
}

export { ymdOf };
