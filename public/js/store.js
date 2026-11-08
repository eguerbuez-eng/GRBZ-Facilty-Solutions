// Lokaler Datenbestand + Synchronisations-Engine (Offline-first).
//
// Prinzip:
//  * Alle für den Benutzer freigegebenen Daten liegen als Replikat in IndexedDB
//    (und für schnelle Anzeige zusätzlich im Arbeitsspeicher).
//  * Jede Änderung ist ein Befehl mit eindeutiger op_id. Online wird er sofort
//    gesendet, offline in die Warteschlange (outbox) gelegt und später in
//    Originalreihenfolge übertragen. Der Server dedupliziert über op_id
//    → wiederholte Uploads sind unschädlich.
//  * Danach holt der Client per Delta-Sync (seq-Cursor) alle Änderungen ab.
//  * Konflikte (Datensatz zwischenzeitlich anderswo geändert) und abgelehnte
//    Vorgänge landen in eigenen Listen und werden dem Benutzer angezeigt.
import { SYNC_TABLES, ENTITIES } from '/shared/entities.js';
import { checklistProblems, autoReport } from '/shared/rules.js';
import { seasonOf, todayYmd } from '/shared/dates.js';
import { can } from '/shared/constants.js';
import { idbAll, idbGet, idbPut, idbDel, idbClear, idbBatch, metaGet, metaSet } from './idb.js';
import { api, ApiError } from './api.js';

const mem = Object.fromEntries(SYNC_TABLES.map((t) => [t, new Map()]));
let user = null;
let cursor = 0;
const listeners = new Set();
export const status = { online: navigator.onLine, syncing: false, pending: 0, failed: 0, conflicts: 0, lastSync: null, lastError: null, authLost: false };

export function uuid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 15) | 64; b[8] = (b[8] & 63) | 128;
  const x = [...b].map((v) => v.toString(16).padStart(2, '0')).join('');
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`;
}
const now = () => new Date().toISOString();

export function on(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function emit(kind = 'status') { for (const fn of listeners) { try { fn(kind); } catch (e) { console.error(e); } } }

export async function init() {
  for (const t of SYNC_TABLES) {
    const rows = await idbAll(t);
    mem[t] = new Map(rows.map((r) => [r.id, r]));
  }
  user = await metaGet('user');
  cursor = await metaGet('cursor', 0);
  status.lastSync = await metaGet('lastSync');
  await refreshCounts();
  window.addEventListener('online', () => { status.online = true; emit(); flush(); });
  window.addEventListener('offline', () => { status.online = false; emit(); });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') flush(); });
  setInterval(() => { if (navigator.onLine && user) flush(); }, 60000);
}

// ---------- Lesen ----------
export const all = (t, pred) => { const out = []; for (const r of mem[t].values()) if (!r.deleted && (!pred || pred(r))) out.push(r); return out; };
export const get = (t, id) => { if (!id) return null; const r = mem[t]?.get(id); return r && !r.deleted ? r : null; };
export const getUser = () => user;
export const hasData = () => cursor > 0;
export const userName = (id) => get('users', id)?.name || '–';

export async function setUser(u) { user = u; await metaSet('user', u); emit('user'); }

async function refreshCounts() {
  status.pending = (await idbAll('outbox')).length;
  status.failed = (await idbAll('failed')).length;
  status.conflicts = (await idbAll('conflicts')).length;
}

// ---------- Lokale Transaktion (für optimistische Änderungen) ----------
function localTx() {
  const changes = new Map();
  const track = (t, id) => { const k = `${t}|${id}`; if (!changes.has(k)) changes.set(k, { t, id, prev: mem[t].get(id) || null }); };
  return {
    get, all,
    put(t, row) { track(t, row.id); mem[t].set(row.id, { ...row, updated_at: now() }); },
    del(t, id) { track(t, id); mem[t].delete(id); },
    rollback() { for (const c of changes.values()) c.prev ? mem[c.t].set(c.id, c.prev) : mem[c.t].delete(c.id); },
    async commit() {
      await idbBatch([...changes.values()].map((c) => (mem[c.t].has(c.id) ? [c.t, 'put', mem[c.t].get(c.id)] : [c.t, 'del', c.id])));
      return [...changes.values()];
    },
  };
}

async function revert(undo) {
  const ops = [];
  for (const c of undo) {
    if (c.prev) { mem[c.t].set(c.id, c.prev); ops.push([c.t, 'put', c.prev]); } else { mem[c.t].delete(c.id); ops.push([c.t, 'del', c.id]); }
  }
  await idbBatch(ops);
  emit('data');
}

const fail = (msg, details) => new ApiError(msg, { status: 400, details });

// ---------- Befehle ----------
/**
 * Führt einen Befehl aus: lokal sofort (optimistisch), dann Übertragung.
 * Rückgabe: { synced: true, ...ergebnis } oder { queued: true }
 */
export async function command(type, payload = {}) {
  const op = { op_id: uuid(), type, payload, created_at: now() };
  let undo = [];
  if (LOCAL[type]) {
    const tx = localTx();
    try { LOCAL[type](payload, tx); } catch (e) { tx.rollback(); throw e; }
    undo = await tx.commit();
    emit('data');
  }
  if (navigator.onLine && status.pending === 0 && !status.authLost) {
    try {
      const res = await api('POST', '/api/sync/push', { ops: [{ op_id: op.op_id, type, payload }] });
      const r = res.results[0];
      if (r.status === 'ok') {
        await pull().catch(() => {});
        return { synced: true, ...r.result };
      }
      await revert(undo);
      if (r.status === 'conflict') {
        pull().catch(() => {});
        throw new ApiError('Konflikt: Der Datensatz wurde zwischenzeitlich auf einem anderen Gerät geändert. Die aktuelle Fassung wurde geladen – bitte prüfen und erneut speichern.', { status: 409 });
      }
      if (r.http === 500) throw new ApiError(r.error, { status: 500 });
      throw new ApiError(r.error, { status: r.http, details: r.details });
    } catch (e) {
      if (!e.offline) { if (e.status === 401) authLost(); throw e; }
      status.online = false;
    }
  }
  await idbPut('outbox', op);
  status.pending++;
  emit();
  scheduleFlush();
  return { queued: true };
}

// ---------- Fotos ----------
export async function addPhoto(meta, file, thumb) {
  const row = { id: uuid(), category: 'sonstiges', ...meta, taken_at: meta.taken_at || now(), user_id: user?.id, created_at: now(), deleted: 0, _local: true };
  await idbPut('blobs', { id: row.id, file, thumb });
  mem.photos.set(row.id, row);
  await idbPut('photos', row);
  await idbPut('outbox', { op_id: row.id, type: '__photo', payload: { id: row.id }, created_at: now() });
  status.pending++;
  emit('data');
  scheduleFlush(200);
  return row;
}

const urlCache = new Map();
/** URL für ein Foto (lokal gespeichertes Blob oder Server-Datei) */
export async function photoUrl(row, thumb = true) {
  if (!row._local) return `/api/photos/${row.id}/file${thumb ? '?thumb=1' : ''}`;
  const key = row.id + (thumb ? 't' : 'f');
  if (urlCache.has(key)) return urlCache.get(key);
  const b = await idbGet('blobs', row.id);
  if (!b) return '';
  const url = URL.createObjectURL((thumb && b.thumb) || b.file);
  urlCache.set(key, url);
  return url;
}

async function uploadPhoto(op) {
  const row = mem.photos.get(op.payload.id);
  const b = await idbGet('blobs', op.payload.id);
  if (!row || !b) return true; // bereits gelöscht
  const fd = new FormData();
  const meta = {};
  for (const k of ['id', 'order_id', 'checklist_item_id', 'object_id', 'defect_id', 'winter_operation_id', 'machine_id', 'inspection_id', 'category', 'comment', 'taken_at']) meta[k] = row[k] ?? null;
  fd.append('meta', JSON.stringify(meta));
  fd.append('file', b.file, `${row.id}.jpg`);
  if (b.thumb) fd.append('thumb', b.thumb, `${row.id}-t.jpg`);
  try {
    const res = await api('POST', '/api/photos', fd, { timeout: 120000 });
    mem.photos.set(row.id, res.row);
    await idbPut('photos', res.row);
    await idbDel('blobs', row.id);
    return true;
  } catch (e) {
    if (e.offline || e.status >= 500 || e.status === 401) throw e;
    await idbPut('failed', { id: op.op_id, op, error: e.message, at: now(), photo: true });
    return false;
  }
}

// ---------- Synchronisation ----------
let flushTimer = null;
export function scheduleFlush(ms = 800) {
  clearTimeout(flushTimer);
  flushTimer = setTimeout(() => flush(), ms);
}

let flushing = null;
export function flush() {
  if (!user) return Promise.resolve();
  if (flushing) return flushing;
  flushing = (async () => {
    status.syncing = true; emit();
    let problems = false;
    try {
      for (;;) {
        const ops = (await idbAll('outbox')).sort((a, b) => a.n - b.n);
        if (!ops.length) break;
        if (ops[0].type === '__photo') {
          if (!(await uploadPhoto(ops[0]))) problems = true;
          await idbDel('outbox', ops[0].n);
          continue;
        }
        const batch = [];
        for (const o of ops) { if (o.type === '__photo' || batch.length >= 50) break; batch.push(o); }
        const res = await api('POST', '/api/sync/push', { ops: batch.map(({ op_id, type, payload }) => ({ op_id, type, payload })) });
        let serverError = null;
        for (const r of res.results) {
          const o = batch.find((b) => b.op_id === r.op_id);
          if (!o) continue;
          if (r.status !== 'ok' && r.http === 500) { serverError = r.error; break; }
          if (r.status === 'conflict') { await idbPut('conflicts', { id: o.op_id, op: o, server: r.server, error: r.error, at: now() }); problems = true; }
          else if (r.status === 'error') { await idbPut('failed', { id: o.op_id, op: o, error: r.error, details: r.details, at: now() }); problems = true; }
          await idbDel('outbox', o.n);
        }
        if (serverError) throw new ApiError(serverError, { status: 500 });
      }
      await refreshCounts();
      await pull(problems);
      status.online = true;
      status.lastError = null;
    } catch (e) {
      if (e.offline) status.online = false;
      else if (e.status === 401) authLost();
      else status.lastError = e.message;
    } finally {
      await refreshCounts();
      status.syncing = false;
      flushing = null;
      emit();
    }
  })();
  return flushing;
}

/** Änderungen vom Server holen. full = vollständiger Abgleich (ersetzt lokalen Bestand). */
export async function pull(full = false) {
  if (status.pending > 0) return flush();
  const lastFull = await metaGet('lastFull', 0);
  if (Date.now() - lastFull > 12 * 3600e3) full = true;
  const res = await api('GET', `/api/sync/pull?since=${full ? 0 : cursor}`);
  const ops = [];
  if (res.full) {
    for (const t of SYNC_TABLES) {
      const rows = res.tables[t] || [];
      mem[t] = new Map(rows.map((r) => [r.id, r]));
      ops.push(['__clear', t]);
    }
    for (const t of SYNC_TABLES) await idbClear(t);
    // lokal gespeicherte, noch nicht hochgeladene Fotos behalten
    for (const b of await idbAll('blobs')) { const r = await idbGet('photos', b.id); if (r) mem.photos.set(r.id, r); }
    const puts = [];
    for (const t of SYNC_TABLES) for (const r of mem[t].values()) puts.push([t, 'put', r]);
    await idbBatch(puts);
    await metaSet('lastFull', Date.now());
  } else {
    const batch = [];
    for (const [t, rows] of Object.entries(res.tables)) {
      for (const r of rows) {
        if (r.deleted) { mem[t].delete(r.id); batch.push([t, 'del', r.id]); } else { mem[t].set(r.id, r); batch.push([t, 'put', r]); }
      }
    }
    // Sichtbarkeit (Mitarbeiter): nicht mehr zugeordnete Objekte/Aufträge entfernen
    if (res.visible) {
      const vo = new Set(res.visible.objects); const vr = new Set(res.visible.orders);
      for (const id of [...mem.objects.keys()]) if (!vo.has(id)) { mem.objects.delete(id); batch.push(['objects', 'del', id]); }
      for (const id of [...mem.orders.keys()]) if (!vr.has(id)) { mem.orders.delete(id); batch.push(['orders', 'del', id]); }
      for (const [id, it] of [...mem.order_checklist_items]) if (!vr.has(it.order_id)) { mem.order_checklist_items.delete(id); batch.push(['order_checklist_items', 'del', id]); }
    }
    await idbBatch(batch);
  }
  cursor = res.cursor;
  user = { ...res.user };
  status.lastSync = now();
  status.authLost = false;
  await metaSet('cursor', cursor);
  await metaSet('user', user);
  await metaSet('lastSync', status.lastSync);
  emit('data');
}

function authLost() {
  status.authLost = true;
  emit('auth');
}

// ---------- Konflikte & Fehler ----------
export const listFailed = () => idbAll('failed');
export const listConflicts = () => idbAll('conflicts');

export async function retryFailed(id) {
  const f = await idbGet('failed', id);
  if (!f) return;
  await idbDel('failed', id);
  const op = { ...f.op, op_id: f.photo ? f.op.op_id : uuid() };
  delete op.n;
  if (f.photo) {
    // Fotos: gleiche ID beibehalten (Server ist idempotent)
  }
  await idbPut('outbox', op);
  await refreshCounts(); emit(); flush();
}

export async function discardFailed(id) {
  const f = await idbGet('failed', id);
  if (f?.photo) { await idbDel('blobs', f.op.payload.id); mem.photos.delete(f.op.payload.id); await idbDel('photos', f.op.payload.id); }
  await idbDel('failed', id);
  await refreshCounts(); emit();
  await pull(true).catch(() => {});
}

/** Konflikt lösen: 'server' = Serverstand übernehmen, 'mine' = eigene Änderung erneut senden (überschreibt) */
export async function resolveConflict(id, choice) {
  const c = await idbGet('conflicts', id);
  if (!c) return;
  await idbDel('conflicts', id);
  if (choice === 'mine') {
    const payload = { ...c.op.payload, base_version: c.server?.version };
    await idbPut('outbox', { op_id: uuid(), type: c.op.type, payload, created_at: now() });
  }
  await refreshCounts(); emit();
  await flush();
  if (choice === 'server') await pull(true).catch(() => {});
}

// ---------- Anmeldung / Abmeldung ----------
export async function login(email, password) {
  const res = await api('POST', '/api/auth/login', { email, password });
  const prev = await metaGet('user');
  if (prev && prev.id !== res.user.id) {
    const pending = (await idbAll('outbox')).length;
    if (pending) {
      await api('POST', '/api/auth/logout').catch(() => {});
      throw new ApiError(`Auf diesem Gerät liegen noch ${pending} nicht übertragene Vorgänge von ${prev.name}. Bitte zuerst mit diesem Konto anmelden und synchronisieren.`, { status: 409 });
    }
    await wipeLocal();
  }
  status.authLost = false;
  await setUser(res.user);
  return res.user;
}

export async function logout(force = false) {
  const pending = (await idbAll('outbox')).length;
  if (pending && !force) throw new ApiError(`${pending} Vorgänge sind noch nicht übertragen.`, { status: 409, data: { pending } });
  await api('POST', '/api/auth/logout').catch(() => {});
  await wipeLocal();
}

export async function wipeLocal() {
  for (const t of SYNC_TABLES) { await idbClear(t); mem[t] = new Map(); }
  for (const s of ['outbox', 'blobs', 'conflicts', 'failed', 'meta']) await idbClear(s);
  user = null; cursor = 0;
  await refreshCounts();
  emit('data');
}

export async function cacheSet(key, value) { await metaSet('cache:' + key, { value, at: now() }); }
export async function cacheGet(key) { return metaGet('cache:' + key); }

// =====================================================================
// Optimistische lokale Ausführung – spiegelt die Server-Regeln, damit auch
// offline sofort Rückmeldung (inkl. Validierung) gegeben werden kann.
// =====================================================================
function execOrder(tx, id) {
  const o = tx.get('orders', id);
  if (!o) throw fail('Auftrag nicht gefunden.');
  if (!can(user, 'orders.write') && user.scoped && o.assigned_user_id !== user.id) throw fail('Dieser Auftrag ist Ihnen nicht zugeordnet.');
  return o;
}
const openEntry = (tx, kind) => tx.all('time_entries', (e) => e.user_id === user.id && e.kind === kind && !e.end_at && !e.voided)
  .sort((a, b) => b.start_at.localeCompare(a.start_at))[0];

const LOCAL = {
  'entity.save'(p, tx) {
    const def = ENTITIES[p.entity];
    const ex = tx.get(def.table, p.id);
    if (ex) { tx.put(def.table, { ...ex, ...p.data, _pending: true }); return; }
    const defaults = {};
    for (const f of def.fields) if (f.default !== undefined) defaults[f.name] = f.default === 'today' ? todayYmd() : f.default;
    tx.put(def.table, { id: p.id, ...defaults, ...p.data, archived: 0, deleted: 0, version: 1, created_at: now(), _pending: true });
  },
  'entity.archive'(p, tx) { const t = ENTITIES[p.entity].table; const ex = tx.get(t, p.id); if (ex) tx.put(t, { ...ex, archived: p.archived ? 1 : 0 }); },
  'entity.delete'(p, tx) { tx.del(ENTITIES[p.entity].table, p.id); },
  'order.save'(p, tx) {
    const ex = tx.get('orders', p.id);
    if (ex) { tx.put('orders', { ...ex, ...p.data, _pending: true }); return; }
    const obj = tx.get('objects', p.data.object_id);
    if (!obj) throw fail('Bitte ein Objekt auswählen.');
    if (!p.data.scheduled_date) throw fail('Bitte ein Datum angeben.');
    let tpl = p.data.template_id;
    if (!tpl && p.data.service_id) tpl = tx.all('checklist_templates', (t) => t.service_id === p.data.service_id && t.active && t.purpose === 'reinigung').sort((a, b) => a.created_at.localeCompare(b.created_at))[0]?.id;
    p.data.template_id = tpl || null;
    const items = tpl ? tx.all('checklist_template_items', (i) => i.template_id === tpl).sort((a, b) => a.position - b.position) : [];
    p.data.item_ids = items.map(() => uuid());
    tx.put('orders', { id: p.id, order_no: null, customer_id: obj.customer_id, status: 'geplant', ...p.data, deleted: 0, version: 1, created_at: now(), _pending: true });
    items.forEach((it, i) => tx.put('order_checklist_items', { id: p.data.item_ids[i], order_id: p.id, position: i, text: it.text, required: it.required, photo_required: it.photo_required, result: 'offen', deleted: 0 }));
  },
  'order.delete'(p, tx) { tx.del('orders', p.id); },
  'order.setStatus'(p, tx) {
    const o = execOrder(tx, p.id);
    tx.put('orders', { ...o, status: p.status, started_at: o.started_at || (p.status === 'in_bearbeitung' ? p.at || now() : null), notes: p.note ? [o.notes, `${p.status === 'unterbrochen' ? 'Unterbrechung' : 'Hinweis'}: ${p.note}`].filter(Boolean).join('\n') : o.notes });
  },
  'order.checkItem'(p, tx) {
    const it = tx.get('order_checklist_items', p.item_id);
    if (!it) throw fail('Checklistenpunkt nicht gefunden.');
    const o = execOrder(tx, it.order_id);
    if (o.completed_at) throw fail('Der Auftrag ist bereits abgeschlossen.');
    p.at = p.at || now();
    tx.put('order_checklist_items', { ...it, result: p.result, comment: p.comment ?? it.comment, checked_by: user.id, checked_at: p.at });
    if (o.status === 'geplant') tx.put('orders', { ...o, status: 'in_bearbeitung', started_at: o.started_at || p.at });
  },
  'order.addItem'(p, tx) {
    const o = execOrder(tx, p.order_id);
    const pos = Math.max(-1, ...tx.all('order_checklist_items', (i) => i.order_id === o.id).map((i) => i.position)) + 1;
    tx.put('order_checklist_items', { id: p.id, order_id: o.id, position: pos, text: p.text, required: p.required ? 1 : 0, photo_required: 0, result: 'offen', deleted: 0 });
  },
  'order.complete'(p, tx) {
    const o = execOrder(tx, p.id);
    if (o.completed_at) return;
    const items = tx.all('order_checklist_items', (i) => i.order_id === o.id).sort((a, b) => a.position - b.position);
    const problems = checklistProblems(items, (itemId) => tx.all('photos', (ph) => ph.checklist_item_id === itemId).length > 0);
    if (problems.length) throw fail('Die Checkliste ist noch nicht vollständig.', problems);
    p.at = p.at || now();
    tx.put('orders', { ...o, status: items.some((i) => i.result === 'mangel') ? 'mangel' : 'abgeschlossen', completed_at: p.at, completed_by: user.id, final_report: p.final_report || autoReport(items) });
  },
  'time.clock'(p, tx) {
    p.at = p.at || now();
    const work = openEntry(tx, 'arbeit'); const pause = openEntry(tx, 'pause');
    if (p.action === 'start') {
      if (work) throw fail('Sie sind bereits eingestempelt.');
      tx.put('time_entries', { id: p.id, user_id: user.id, kind: 'arbeit', start_at: p.at, end_at: null, object_id: p.object_id || null, order_id: p.order_id || null, source: 'stempel', voided: 0, deleted: 0, created_at: now() });
    } else if (p.action === 'pause') {
      if (!work) throw fail('Sie sind nicht eingestempelt.');
      if (pause) throw fail('Es läuft bereits eine Pause.');
      tx.put('time_entries', { id: p.id, user_id: user.id, kind: 'pause', parent_id: work.id, start_at: p.at, end_at: null, source: 'stempel', voided: 0, deleted: 0, created_at: now() });
    } else if (p.action === 'resume') {
      if (!pause) throw fail('Es läuft keine Pause.');
      tx.put('time_entries', { ...pause, end_at: p.at });
    } else if (p.action === 'stop') {
      if (!work) throw fail('Sie sind nicht eingestempelt.');
      if (pause) tx.put('time_entries', { ...pause, end_at: p.at });
      tx.put('time_entries', { ...work, end_at: p.at });
    }
  },
  'time.correction'(p, tx) {
    if (String(p.reason || '').trim().length < 3) throw fail('Bitte eine Begründung für die Korrektur angeben.');
    let entryId = p.entry_id;
    if (!entryId) {
      p.new_entry_id = p.new_entry_id || uuid(); entryId = p.new_entry_id;
      tx.put('time_entries', { id: entryId, user_id: p.user_id || user.id, kind: p.kind || 'arbeit', start_at: p.new_start_at, end_at: p.new_end_at, source: 'nachtrag', voided: 1, deleted: 0, object_id: p.object_id || null, created_at: now() });
    }
    tx.put('time_corrections', { id: p.id, entry_id: entryId, requested_by: user.id, requested_at: now(), new_start_at: p.new_start_at || null, new_end_at: p.new_end_at || null, new_voided: p.void ? 1 : 0, reason: p.reason, status: 'beantragt', deleted: 0 });
  },
  'stock.move'(p, tx) {
    const m = tx.get('materials', p.material_id);
    if (!m) throw fail('Artikel nicht gefunden.');
    const n = Number(String(p.qty).replace(',', '.'));
    if (!isFinite(n) || (p.kind !== 'korrektur' && p.kind !== 'inventur' && n <= 0)) throw fail('Bitte eine gültige Menge angeben.');
    const delta = p.kind === 'verbrauch' ? -n : p.kind === 'inventur' ? n - m.stock : n;
    tx.put('stock_movements', { id: p.id, material_id: m.id, qty: delta, kind: p.kind, object_id: p.object_id || null, order_id: p.order_id || null, user_id: user.id, note: p.note || null, moved_at: now(), deleted: 0 });
    tx.put('materials', { ...m, stock: Math.round((m.stock + delta) * 1000) / 1000 });
  },
  'scan.log'(p, tx) { tx.put('scans', { id: p.id, raw: p.raw, method: p.method, result: p.local_result || 'offline', user_id: user.id, scanned_at: p.scanned_at || now(), deleted: 0 }); },
  'defect.save'(p, tx) {
    const ex = tx.get('defects', p.id);
    if (ex) { tx.put('defects', { ...ex, ...p.data }); return; }
    if (!String(p.data.title || '').trim()) throw fail('Bitte einen Titel angeben.');
    const obj = tx.get('objects', p.data.object_id);
    tx.put('defects', { id: p.id, defect_no: null, kind: 'mangel', status: 'offen', ...p.data, customer_id: obj?.customer_id || p.data.customer_id || null, reported_by: user.id, reported_at: now(), deleted: 0, _pending: true });
  },
  'defect.setStatus'(p, tx) {
    const d = tx.get('defects', p.id);
    if (!d) throw fail('Mangel nicht gefunden.');
    if (['behoben', 'verworfen'].includes(p.status) && !String(p.note || '').trim()) throw fail(p.status === 'behoben' ? 'Bitte beschreiben Sie, wie der Mangel behoben wurde (Erledigungsnachweis).' : 'Bitte begründen Sie, warum der Mangel verworfen wird.');
    tx.put('defects', { ...d, status: p.status, resolution_note: p.status === 'behoben' ? p.note : d.resolution_note, resolved_at: p.status === 'behoben' ? now() : d.resolved_at });
    tx.put('defect_log', { id: uuid(), defect_id: d.id, logged_at: now(), user_id: user.id, action: `status:${p.status}`, note: p.note || null, deleted: 0, _local: true });
  },
  'defect.comment'(p, tx) { tx.put('defect_log', { id: p.id, defect_id: p.defect_id, logged_at: now(), user_id: user.id, action: 'kommentar', note: p.note, deleted: 0 }); },
  'winter.save'(p, tx) {
    const ex = tx.get('winter_operations', p.id);
    const data = { ...p.data };
    if (data.area_ids) data.area_ids = JSON.stringify(data.area_ids);
    if (ex) {
      if (ex.status === 'abgeschlossen') throw fail('Der Einsatz ist bereits unterschrieben und abgeschlossen.');
      tx.put('winter_operations', { ...ex, ...data }); return;
    }
    if (!data.object_id) throw fail('Bitte ein Objekt auswählen.');
    data.start_at = data.start_at || now(); p.data.start_at = data.start_at;
    tx.put('winter_operations', { id: p.id, operation_no: null, season: seasonOf(data.start_at), user_id: user.id, status: 'offen', ...data, deleted: 0, created_at: now(), _pending: true });
  },
  'winter.sign'(p, tx) {
    const op = tx.get('winter_operations', p.id);
    if (!op) throw fail('Einsatz nicht gefunden.');
    if (!op.end_at) throw fail('Bitte zuerst das Einsatzende erfassen.');
    if (!op.activity) throw fail('Bitte die durchgeführte Tätigkeit angeben.');
    if (!op.weather) throw fail('Bitte die Wetterbedingungen angeben.');
    tx.put('winter_operations', { ...op, signature: p.signature, signed_at: now(), status: 'abgeschlossen' });
  },
  'machine.event'(p, tx) {
    const m = tx.get('machines', p.machine_id);
    if (!m) throw fail('Maschine nicht gefunden.');
    if (!String(p.description || '').trim()) throw fail('Bitte eine Beschreibung angeben.');
    tx.put('machine_events', { id: p.id, machine_id: m.id, kind: p.kind, event_date: p.event_date || todayYmd(), description: p.description, cost: p.cost || null, performed_by: p.performed_by || null, status: p.kind === 'defekt' ? 'offen' : 'erledigt', user_id: user.id, deleted: 0 });
    if (p.kind === 'defekt') tx.put('machines', { ...m, condition: 'defekt' });
  },
  'inspection.save'(p, tx) {
    const items = (p.items || []).filter((i) => String(i.text || '').trim());
    if (!items.length) throw fail('Die Kontrolle enthält keine Prüfpunkte.');
    const rated = items.filter((i) => i.rating !== null && i.rating !== undefined && i.rating !== '');
    const score = rated.length ? Math.round((rated.reduce((s, i) => s + +i.rating, 0) / (rated.length * 5)) * 1000) / 10 : null;
    tx.put('inspections', { id: p.id, inspection_no: null, object_id: p.object_id, order_id: p.order_id || null, inspector_id: user.id, inspected_at: now(), score, notes: p.notes || null, customer_visible: p.customer_visible ? 1 : 0, deleted: 0, _pending: true });
    items.forEach((i, idx) => { i.id = i.id || uuid(); tx.put('inspection_items', { id: i.id, inspection_id: p.id, position: idx, text: i.text, rating: rated.includes(i) ? +i.rating : null, comment: i.comment || null, deleted: 0 }); });
  },
  'employee.saveProfile'(p, tx) {
    const ex = tx.get('employee_profiles', p.user_id);
    tx.put('employee_profiles', { ...(ex || { id: p.user_id, user_id: p.user_id, status: 'aktiv', pay_type: 'keine', deleted: 0 }), ...p.data, _pending: true });
  },
  'absence.save'(p, tx) {
    if (!p.start_date || !p.end_date || p.end_date < p.start_date) throw fail('Bitte einen gültigen Zeitraum angeben.');
    const ex = tx.get('absences', p.id);
    const manager = can(user, 'absences.manage');
    tx.put('absences', { ...(ex || { status: manager ? 'genehmigt' : 'beantragt', requested_by: user.id, deleted: 0, days: 0 }), id: p.id, user_id: p.user_id || user.id, kind: p.kind, start_date: p.start_date, end_date: p.end_date, half_day: p.half_day ? 1 : 0, note: p.note || null, _pending: true });
  },
  'absence.decide'(p, tx) { const a = tx.get('absences', p.id); if (a) tx.put('absences', { ...a, status: p.approve ? 'genehmigt' : 'abgelehnt' }); },
  'absence.cancel'(p, tx) { const a = tx.get('absences', p.id); if (a) tx.put('absences', { ...a, status: 'storniert' }); },
  'shift.save'(p, tx) {
    const ex = tx.get('shifts', p.id);
    tx.put('shifts', { ...(ex || { status: 'geplant', deleted: 0 }), id: p.id, user_id: p.user_id, object_id: p.object_id || null, date: p.date, start_time: p.start_time, end_time: p.end_time, break_minutes: +p.break_minutes || 0, note: p.note || null, _pending: true });
  },
  'shift.delete'(p, tx) { tx.del('shifts', p.id); },
  'photo.update'(p, tx) { const ph = tx.get('photos', p.id); if (ph) tx.put('photos', { ...ph, ...Object.fromEntries(Object.entries(p).filter(([k]) => k !== 'id')) }); },
  'photo.delete'(p, tx) { tx.del('photos', p.id); },
};
