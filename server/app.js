// Express-Anwendung (API + Auslieferung der PWA).
import express from 'express';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { openDb, AppError, nowIso, uuid } from './db.js';
import {
  cookieParser, authMiddleware, requireAuth, requirePerm, assertPerm, login, createSession, destroySession, cookieOptions,
  SESSION_COOKIE, publicUser, hashPassword, verifyPassword, validatePasswordStrength,
} from './auth.js';
import { runCommand, generateAllRecurrences, numberFor } from './commands.js';
import './commands-hr.js';
import { adminRouter } from './admin.js';
import { vacationInfo } from './commands-hr.js';
import { computeCosts, computeEmployeeMonth, timeAccount } from './payroll.js';
import { DISCLAIMER } from '../shared/hr.js';
import { createPdf, finalize, heading, keyValues, paragraph, table, pdfToBuffer } from './pdf.js';
import { sendCsv } from './reports.js';
import { selectScoped, canSee, assertSee, isScoped, tableScope } from './scope.js';
import { reportsRouter } from './reports.js';
import { seed } from './seed.js';
import { SYNC_TABLES } from '../shared/entities.js';
import { can, ROLES, APP_NAME } from '../shared/constants.js';
import { todayYmd, addDays } from '../shared/dates.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
export const VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;

const IMAGE_MIME = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
const DOC_MIME = {
  'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'text/plain': 'txt', 'text/csv': 'csv',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/msword': 'doc', 'application/vnd.ms-excel': 'xls',
};

function magicOk(buf, mime) {
  const h = buf.subarray(0, 12);
  if (mime === 'image/jpeg') return h[0] === 0xff && h[1] === 0xd8;
  if (mime === 'image/png') return h.toString('hex', 0, 4) === '89504e47';
  if (mime === 'image/webp') return h.toString('ascii', 0, 4) === 'RIFF' && h.toString('ascii', 8, 12) === 'WEBP';
  if (mime === 'application/pdf') return h.toString('ascii', 0, 4) === '%PDF';
  return true;
}

export function createApp({ dataDir = path.join(ROOT, 'data'), dbFile, log = console.log, startTimers = true } = {}) {
  fs.mkdirSync(dataDir, { recursive: true });
  const dirs = {
    photos: path.join(dataDir, 'uploads', 'photos'), thumbs: path.join(dataDir, 'uploads', 'thumbs'),
    documents: path.join(dataDir, 'uploads', 'documents'), branding: path.join(dataDir, 'uploads', 'branding'),
    backups: path.join(dataDir, 'backups'),
  };
  for (const d of Object.values(dirs)) fs.mkdirSync(d, { recursive: true });
  const db = openDb(dbFile || path.join(dataDir, 'grbz.sqlite'), { log });
  seed(db, { dataDir, log });

  const app = express();
  app.set('trust proxy', process.env.GRBZ_TRUST_PROXY === '1' ? 1 : false);
  app.disable('x-powered-by');
  app.locals.db = db;
  app.locals.dirs = dirs;

  // ---------- Sicherheits-Header ----------
  app.use((req, res, next) => {
    res.setHeader('Content-Security-Policy', [
      "default-src 'self'", "script-src 'self'", "style-src 'self' 'unsafe-inline'", "img-src 'self' data: blob:",
      "media-src 'self' blob:", "connect-src 'self'", "worker-src 'self'", "manifest-src 'self'", "font-src 'self'",
      "object-src 'none'", "base-uri 'self'", "frame-ancestors 'none'", "form-action 'self'",
    ].join('; '));
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Permissions-Policy', 'camera=(self), microphone=(), geolocation=(), payment=()');
    if (req.secure) res.setHeader('Strict-Transport-Security', 'max-age=31536000');
    next();
  });

  app.use(cookieParser);
  app.use(express.json({ limit: '2mb' }));
  app.use(authMiddleware(db));

  // CSRF-Schutz: schreibende API-Aufrufe brauchen einen eigenen Header
  // (Browser senden ihn cross-origin nicht ohne CORS-Freigabe) + SameSite=Strict-Cookie.
  app.use('/api', (req, _res, next) => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.get('X-GRBZ') !== '1') return next(new AppError(403, 'Ungültige Anfrage.'));
    next();
  });

  const upload = (maxMb) => multer({ storage: multer.memoryStorage(), limits: { fileSize: maxMb * 1024 * 1024, files: 2 } });

  // ---------- Öffentliche Endpunkte ----------
  app.get('/api/health', (_req, res) => res.json({ ok: true, version: VERSION, time: nowIso() }));
  app.get('/api/settings/public', (_req, res) => res.json({
    app: APP_NAME, company_name: db.setting('company_name'), portal_enabled: db.setting('portal_enabled') === '1',
    has_logo: !!db.setting('logo_file'), version: VERSION,
  }));
  app.get('/api/branding/logo', (_req, res) => {
    const f = db.setting('logo_file');
    if (!f) return res.status(404).end();
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(path.join(dirs.branding, f));
  });

  // ---------- Anmeldung ----------
  const attempts = new Map();
  app.post('/api/auth/login', (req, res) => {
    const ip = req.ip;
    const now = Date.now();
    const list = (attempts.get(ip) || []).filter((t) => t > now - 15 * 6e4);
    if (list.length >= 30) throw new AppError(429, 'Zu viele Anmeldeversuche. Bitte warten Sie einige Minuten.');
    list.push(now); attempts.set(ip, list);
    const user = login(db, req.body?.email, req.body?.password, ip);
    const token = createSession(db, user, req.get('user-agent'));
    res.cookie(SESSION_COOKIE, token, cookieOptions(req));
    res.json({ user: publicUser(user) });
  });
  app.post('/api/auth/logout', (req, res) => {
    destroySession(db, req.sessionToken);
    if (req.user) db.audit(req.user.id, 'logout', 'users', req.user.id);
    res.clearCookie(SESSION_COOKIE, { path: '/' });
    res.json({ ok: true });
  });
  app.get('/api/auth/me', (req, res) => {
    if (!req.user) throw new AppError(401, 'Nicht angemeldet.');
    res.json({ user: publicUser(req.user) });
  });
  app.post('/api/auth/password', requireAuth, (req, res) => {
    const { current, next } = req.body || {};
    if (!verifyPassword(current || '', req.user.password_hash)) throw new AppError(400, 'Das aktuelle Passwort ist falsch.');
    const err = validatePasswordStrength(next);
    if (err) throw new AppError(400, err);
    if (current === next) throw new AppError(400, 'Das neue Passwort muss sich vom bisherigen unterscheiden.');
    db.update('users', req.user.id, { password_hash: hashPassword(next), must_change_password: 0 });
    db.run('DELETE FROM sessions WHERE user_id = ? AND token_hash <> ?', req.user.id, crypto.createHash('sha256').update(req.sessionToken).digest('hex'));
    db.audit(req.user.id, 'passwort.geaendert', 'users', req.user.id);
    res.json({ ok: true });
  });

  // ---------- Kundenportal ----------
  app.use('/api/portal', portalRouter());

  // Alles Weitere erfordert Anmeldung (Mitarbeiterrollen)
  app.use('/api', requireAuth);
  app.use('/api', (req, _res, next) => {
    if (req.user.must_change_password && !['/auth/me', '/auth/password', '/auth/logout'].includes(req.path)) {
      return next(new AppError(403, 'Bitte ändern Sie zuerst Ihr Passwort.', { must_change_password: true }));
    }
    next();
  });

  // ---------- Synchronisation ----------
  app.get('/api/sync/pull', (req, res) => {
    const since = Math.max(0, parseInt(req.query.since, 10) || 0);
    const cursor = db.get("SELECT value FROM counters WHERE name = 'seq'").value;
    const tables = {};
    for (const t of SYNC_TABLES) {
      if (!tableScope(req.user, t)) continue; // kein Zugriff → Tabelle gar nicht ausliefern
      const rows = selectScoped(db, req.user, t, 'seq > $since', { since });
      if (rows.length || since === 0) tables[t] = rows;
    }
    const out = { cursor, full: since === 0, tables, user: publicUser(req.user), server_time: nowIso(), epoch: db.setting('data_epoch', '') };
    if (isScoped(req.user)) {
      out.visible = {
        objects: selectScoped(db, req.user, 'objects', 'deleted = 0').map((r) => r.id),
        orders: selectScoped(db, req.user, 'orders', 'deleted = 0').map((r) => r.id),
      };
    }
    res.json(out);
  });

  app.post('/api/sync/push', (req, res) => {
    const ops = Array.isArray(req.body?.ops) ? req.body.ops.slice(0, 200) : [];
    const results = [];
    for (const op of ops) {
      const opId = String(op.op_id || '');
      if (!/^[\w-]{8,64}$/.test(opId)) { results.push({ op_id: opId, status: 'error', error: 'Ungültige Vorgangs-ID.' }); continue; }
      const seen = db.get('SELECT result FROM sync_ops WHERE op_id = ?', opId);
      if (seen) { results.push({ ...JSON.parse(seen.result), op_id: opId, duplicate: true }); continue; }
      const ctx = { db, user: req.user, ip: req.ip, removeFiles: [] };
      let out;
      try {
        const result = runCommand(ctx, op.type, op.payload);
        out = { status: 'ok', result };
        for (const [dir, file] of ctx.removeFiles) if (file) fs.rmSync(path.join(dirs[dir], file), { force: true });
      } catch (e) {
        if (!(e instanceof AppError)) { log('Befehlsfehler', op.type, e); out = { status: 'error', http: 500, error: 'Interner Fehler bei der Verarbeitung.' }; }
        else if (e.conflict) out = { status: 'conflict', http: 409, error: e.message, server: e.server };
        else out = { status: 'error', http: e.status, error: e.message, details: e.details };
      }
      // Ergebnisse (auch Fehler) speichern → wiederholte Übertragung liefert dieselbe Antwort
      if (out.http !== 500) db.run('INSERT OR IGNORE INTO sync_ops(op_id, user_id, type, received_at, result) VALUES (?,?,?,?,?)', opId, req.user.id, String(op.type).slice(0, 60), nowIso(), JSON.stringify(out));
      results.push({ op_id: opId, ...out });
    }
    res.json({ results, cursor: db.get("SELECT value FROM counters WHERE name = 'seq'").value });
  });

  // ---------- Dashboard ----------
  app.get('/api/dashboard', requirePerm('dashboard.view'), (req, res) => {
    const u = req.user;
    const today = todayYmd();
    const out = { today, scoped: isScoped(u) };
    const orders = selectScoped(db, u, 'orders', 'deleted = 0');
    out.orders = {
      open: orders.filter((o) => !o.completed_at).length,
      done: orders.filter((o) => o.completed_at).length,
      done_month: orders.filter((o) => o.completed_at && o.scheduled_date.slice(0, 7) === today.slice(0, 7)).length,
      today: orders.filter((o) => o.scheduled_date === today).length,
      today_done: orders.filter((o) => o.scheduled_date === today && o.completed_at).length,
      overdue: orders.filter((o) => !o.completed_at && o.scheduled_date < today).length,
    };
    out.today_list = orders.filter((o) => o.scheduled_date === today).sort((a, b) => (a.scheduled_time || '').localeCompare(b.scheduled_time || ''))
      .map((o) => ({ id: o.id, order_no: o.order_no, status: o.status, scheduled_time: o.scheduled_time, object: db.byId('objects', o.object_id)?.name, assigned: db.byId('users', o.assigned_user_id || '')?.name }));
    if (can(u, 'customers.read')) out.customers = db.get('SELECT COUNT(*) c FROM customers WHERE deleted = 0 AND archived = 0').c;
    out.objects = selectScoped(db, u, 'objects', 'deleted = 0 AND archived = 0').length;
    const defects = selectScoped(db, u, 'defects', "deleted = 0 AND status IN ('offen','in_bearbeitung')");
    out.defects = { open: defects.length, overdue: defects.filter((d) => d.due_date && d.due_date < today).length };
    if (can(u, 'users.read')) {
      const staff = db.all("SELECT id, name, role FROM users WHERE deleted = 0 AND active = 1 AND role <> 'kunde' ORDER BY name");
      const active = new Set(db.all("SELECT user_id FROM time_entries WHERE kind = 'arbeit' AND end_at IS NULL AND voided = 0 AND deleted = 0").map((r) => r.user_id));
      const paused = new Set(db.all("SELECT user_id FROM time_entries WHERE kind = 'pause' AND end_at IS NULL AND voided = 0 AND deleted = 0").map((r) => r.user_id));
      const roleNames = Object.fromEntries(db.all('SELECT role_key, name FROM roles').map((r) => [r.role_key, r.name]));
      out.staff = staff.map((s) => ({ ...s, role_label: roleNames[s.role] || ROLES[s.role] || s.role, status: paused.has(s.id) ? 'pause' : active.has(s.id) ? 'aktiv' : 'abwesend',
        today: orders.filter((o) => o.assigned_user_id === s.id && o.scheduled_date === today).length }));
    }
    if (can(u, 'materials.read')) {
      const mats = db.all('SELECT id, name, stock, min_stock, unit FROM materials WHERE deleted = 0 AND archived = 0');
      out.materials = { total: mats.length, low: mats.filter((m) => m.min_stock > 0 && m.stock <= m.min_stock).map((m) => ({ id: m.id, name: m.name, stock: m.stock, min_stock: m.min_stock, unit: m.unit })) };
    }
    if (can(u, 'machines.read')) {
      out.maintenance = db.all("SELECT id, name, inventory_no, next_maintenance FROM machines WHERE deleted = 0 AND archived = 0 AND next_maintenance IS NOT NULL AND next_maintenance <= ? ORDER BY next_maintenance", addDays(today, 30));
      out.machines_defect = db.get("SELECT COUNT(*) c FROM machines WHERE deleted = 0 AND archived = 0 AND condition IN ('defekt','in_reparatur')").c;
    }
    if (can(u, 'time.approve')) out.corrections_pending = db.get("SELECT COUNT(*) c FROM time_corrections WHERE status = 'beantragt' AND deleted = 0").c;
    const actSql = can(u, 'audit.read') || can(u, 'orders.write')
      ? "SELECT a.*, u.name AS user_name FROM audit_log a LEFT JOIN users u ON u.id = a.user_id WHERE a.action NOT LIKE 'login%' AND a.action NOT IN ('logout','bericht.erstellt') ORDER BY a.id DESC LIMIT 15"
      : "SELECT a.*, u.name AS user_name FROM audit_log a LEFT JOIN users u ON u.id = a.user_id WHERE a.user_id = ? AND a.action NOT LIKE 'login%' AND a.action NOT IN ('logout','bericht.erstellt') ORDER BY a.id DESC LIMIT 15";
    out.activity = (actSql.includes('?') ? db.all(actSql, u.id) : db.all(actSql)).map((a) => ({ at: a.at, action: a.action, entity: a.entity, entity_id: a.entity_id, user_name: a.user_name, details: a.details ? JSON.parse(a.details) : null }));
    res.json(out);
  });

  // ---------- Fotos ----------
  app.post('/api/photos', requirePerm('photos.write'), upload(12).fields([{ name: 'file', maxCount: 1 }, { name: 'thumb', maxCount: 1 }]), (req, res) => {
    let meta;
    try { meta = JSON.parse(req.body.meta || '{}'); } catch { throw new AppError(400, 'Ungültige Fotodaten.'); }
    if (!/^[0-9a-f-]{36}$/i.test(meta.id || '')) throw new AppError(400, 'Ungültige Foto-ID.');
    const existing = db.byId('photos', meta.id);
    if (existing) return res.json({ row: existing, duplicate: true }); // idempotent (Wiederholung nach Verbindungsabbruch)
    const file = req.files?.file?.[0];
    if (!file) throw new AppError(400, 'Es wurde kein Foto übertragen.');
    if (!IMAGE_MIME[file.mimetype] || !magicOk(file.buffer, file.mimetype)) throw new AppError(415, 'Nur JPEG-, PNG- oder WebP-Bilder sind erlaubt.');
    const u = req.user;
    const links = {};
    if (meta.order_id) { assertSee(db, u, 'orders', meta.order_id, 'Auftrag nicht gefunden.'); links.order_id = meta.order_id; links.object_id = db.byId('orders', meta.order_id).object_id; }
    if (meta.checklist_item_id) {
      const it = db.byId('order_checklist_items', meta.checklist_item_id);
      if (!it || it.order_id !== meta.order_id) throw new AppError(400, 'Checklistenpunkt passt nicht zum Auftrag.');
      links.checklist_item_id = it.id;
    }
    if (meta.object_id && !links.object_id) { assertSee(db, u, 'objects', meta.object_id, 'Objekt nicht gefunden.'); links.object_id = meta.object_id; }
    if (meta.defect_id) { assertSee(db, u, 'defects', meta.defect_id, 'Mangel nicht gefunden.'); links.defect_id = meta.defect_id; links.object_id ||= db.byId('defects', meta.defect_id).object_id; }
    if (meta.winter_operation_id) { assertSee(db, u, 'winter_operations', meta.winter_operation_id, 'Einsatz nicht gefunden.'); links.winter_operation_id = meta.winter_operation_id; links.object_id ||= db.byId('winter_operations', meta.winter_operation_id).object_id; }
    if (meta.machine_id) { if (!can(u, 'machines.read')) throw new AppError(403, 'Kein Zugriff.'); links.machine_id = meta.machine_id; }
    if (meta.inspection_id) { assertPerm(u, 'quality.write'); links.inspection_id = meta.inspection_id; }
    if (!Object.keys(links).length) throw new AppError(400, 'Das Foto muss einem Auftrag, Objekt, Mangel, Einsatz oder einer Maschine zugeordnet sein.');
    const ext = IMAGE_MIME[file.mimetype];
    const name = `${meta.id}.${ext}`;
    fs.writeFileSync(path.join(dirs.photos, name), file.buffer);
    const thumb = req.files?.thumb?.[0];
    if (thumb && IMAGE_MIME[thumb.mimetype] && magicOk(thumb.buffer, thumb.mimetype)) fs.writeFileSync(path.join(dirs.thumbs, name), thumb.buffer);
    const row = db.tx(() => db.insert('photos', {
      id: meta.id, ...links, category: ['vorher', 'nachher', 'schaden', 'mangel', 'sonstiges'].includes(meta.category) ? meta.category : 'sonstiges',
      comment: String(meta.comment || '').slice(0, 1000) || null, taken_at: !isNaN(Date.parse(meta.taken_at)) ? meta.taken_at : nowIso(),
      user_id: u.id, file_name: name, mime: file.mimetype, size: file.size,
    }));
    db.audit(u.id, 'foto.hochgeladen', 'photos', row.id, { kategorie: row.category });
    res.json({ row });
  });

  app.get('/api/photos/:id/file', requirePerm('photos.read'), (req, res) => {
    const ph = db.byId('photos', req.params.id);
    if (!ph || ph.deleted || !canSee(db, req.user, 'photos', ph.id)) throw new AppError(404, 'Foto nicht gefunden.');
    let file = path.join(dirs.photos, ph.file_name);
    if (req.query.thumb === '1' && fs.existsSync(path.join(dirs.thumbs, ph.file_name))) file = path.join(dirs.thumbs, ph.file_name);
    if (!fs.existsSync(file)) throw new AppError(404, 'Bilddatei nicht vorhanden.');
    res.setHeader('Cache-Control', 'private, max-age=604800');
    res.type(ph.mime).sendFile(file);
  });

  // ---------- Dokumente ----------
  app.post('/api/documents', requirePerm('documents.write'), upload(25).single('file'), (req, res) => {
    const f = req.file;
    if (!f) throw new AppError(400, 'Bitte eine Datei auswählen.');
    if (!DOC_MIME[f.mimetype] || !magicOk(f.buffer, f.mimetype)) throw new AppError(415, 'Dateityp nicht erlaubt (erlaubt: PDF, Bilder, Word, Excel, Text/CSV).');
    const b = req.body;
    const title = String(b.title || f.originalname || '').trim().slice(0, 200);
    if (!title) throw new AppError(400, 'Bitte einen Titel angeben.');
    if (b.user_id && !can(req.user, 'hr.manage')) throw new AppError(403, 'Personaldokumente erfordern das Recht „Personalakten bearbeiten“.');
    for (const [k, t] of [['customer_id', 'customers'], ['object_id', 'objects'], ['order_id', 'orders'], ['machine_id', 'machines'], ['user_id', 'users']]) {
      if (b[k] && !db.get(`SELECT id FROM ${t} WHERE id = ?`, b[k])) throw new AppError(400, 'Zuordnung ungültig.');
    }
    const id = /^[0-9a-f-]{36}$/i.test(b.id || '') ? b.id : uuid();
    if (db.byId('documents', id)) return res.json({ row: db.byId('documents', id), duplicate: true });
    const name = `${id}.${DOC_MIME[f.mimetype]}`;
    fs.writeFileSync(path.join(dirs.documents, name), f.buffer);
    let customerId = b.customer_id || null;
    if (!customerId && b.object_id) customerId = db.byId('objects', b.object_id)?.customer_id || null;
    const row = db.tx(() => db.insert('documents', {
      id, title, kind: String(b.kind || 'sonstiges').slice(0, 40), customer_id: customerId, object_id: b.object_id || null,
      order_id: b.order_id || null, machine_id: b.machine_id || null, user_id: b.user_id || null, file_name: name, original_name: String(f.originalname || '').slice(0, 200),
      mime: f.mimetype, size: f.size, sha256: crypto.createHash('sha256').update(f.buffer).digest('hex'), uploaded_by: req.user.id,
      customer_visible: b.customer_visible === '1' ? 1 : 0, notes: b.notes || null,
    }));
    db.audit(req.user.id, 'dokument.hochgeladen', 'documents', row.id, { titel: title });
    res.json({ row });
  });

  app.get('/api/documents/:id/file', requirePerm('documents.read', 'hr.read'), (req, res) => {
    const d = db.byId('documents', req.params.id);
    if (!d || d.deleted || !canSee(db, req.user, 'documents', d.id)) throw new AppError(404, 'Dokument nicht gefunden.');
    sendDocument(res, d, dirs);
  });

  // ---------- Mitarbeiter / Benutzer ----------
  app.get('/api/users', requirePerm('users.read'), (_req, res) => {
    res.json({ users: db.all("SELECT id, employee_no, legacy_employee_no, name, email, phone, street, zip, city, entry_date, role, customer_id, active, last_login_at, notes, created_at FROM users WHERE deleted = 0 ORDER BY active DESC, name") });
  });

  const USER_FIELDS = ['name', 'email', 'phone', 'street', 'zip', 'city', 'entry_date', 'role', 'customer_id', 'notes', 'active'];
  function checkUserInput(req, data, existing) {
    const out = {};
    for (const k of USER_FIELDS) if (k in data) out[k] = typeof data[k] === 'string' ? data[k].trim() || null : data[k];
    if ('name' in out && !out.name) throw new AppError(400, 'Bitte einen Namen angeben.');
    if ('email' in out) {
      if (!out.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(out.email)) throw new AppError(400, 'Bitte eine gültige E-Mail-Adresse angeben (wird als Anmeldename verwendet).');
      const dupe = db.get('SELECT id FROM users WHERE email = ? AND id <> ?', out.email, existing?.id || '');
      if (dupe) throw new AppError(400, 'Diese E-Mail-Adresse wird bereits verwendet.');
    }
    if ('role' in out) {
      const role = db.get('SELECT * FROM roles WHERE role_key = ? AND deleted = 0', out.role || '');
      if (!role || !role.active) throw new AppError(400, 'Ungültige oder deaktivierte Rolle.');
      // Keine Rechteausweitung: Nicht-Administratoren dürfen nur Rollen vergeben, deren Rechte sie selbst besitzen
      if (req.user.role !== 'admin' && JSON.parse(role.permissions).some((p) => !can(req.user, p))) {
        throw new AppError(403, 'Diese Rolle hat Rechte, die Sie selbst nicht besitzen.');
      }
    }
    const privileged = ['admin', 'geschaeftsfuehrer'];
    if (req.user.role !== 'admin' && (privileged.includes(out.role) || privileged.includes(existing?.role))) {
      throw new AppError(403, 'Nur Administratoren dürfen Administrator- und Geschäftsführerkonten verwalten.');
    }
    if ((out.role || existing?.role) === 'kunde') {
      const cid = out.customer_id ?? existing?.customer_id;
      if (!cid || !db.byId('customers', cid)) throw new AppError(400, 'Für Kundenzugänge muss ein Kunde zugeordnet sein.');
    } else if ('role' in out) out.customer_id = null;
    if (out.entry_date && !/^\d{4}-\d{2}-\d{2}$/.test(out.entry_date)) throw new AppError(400, 'Ungültiges Eintrittsdatum.');
    if ('active' in out) out.active = out.active ? 1 : 0;
    return out;
  }
  const oneTimePassword = () => crypto.randomBytes(9).toString('base64url').replace(/[-_]/g, 'x') + '7a';

  app.post('/api/users', requirePerm('users.manage'), (req, res) => {
    const data = checkUserInput(req, req.body || {}, null);
    if (!data.name || !data.email || !data.role) throw new AppError(400, 'Name, E-Mail und Rolle sind Pflichtfelder.');
    let pw = req.body.password;
    if (pw) { const e = validatePasswordStrength(pw); if (e) throw new AppError(400, e); }
    const generated = !pw;
    if (!pw) pw = oneTimePassword();
    const row = db.tx(() => {
      const u = db.insert('users', { ...data, employee_no: data.role === 'kunde' ? null : numberFor(db, 'users'), password_hash: hashPassword(pw), must_change_password: 1, active: 1 });
      if (u.role !== 'kunde') db.insert('employee_profiles', { id: u.id, user_id: u.id, status: 'aktiv', pay_type: 'keine' });
      return u;
    });
    db.audit(req.user.id, 'benutzer.erstellt', 'users', row.id, { rolle: row.role });
    res.json({ user: { ...row, password_hash: undefined }, one_time_password: generated ? pw : undefined });
  });

  app.put('/api/users/:id', requirePerm('users.manage'), (req, res) => {
    const ex = db.byId('users', req.params.id);
    if (!ex || ex.deleted) throw new AppError(404, 'Benutzer nicht gefunden.');
    const data = checkUserInput(req, req.body || {}, ex);
    if (ex.id === req.user.id && (data.active === 0 || (data.role && data.role !== ex.role))) throw new AppError(400, 'Sie können Ihr eigenes Konto nicht deaktivieren oder Ihre eigene Rolle ändern.');
    if (ex.role === 'admin' && (data.active === 0 || (data.role && data.role !== 'admin'))) {
      if (db.get("SELECT COUNT(*) c FROM users WHERE role = 'admin' AND active = 1 AND deleted = 0").c <= 1) throw new AppError(400, 'Es muss mindestens ein aktiver Administrator bestehen bleiben.');
    }
    const row = db.update('users', ex.id, data);
    if (data.active === 0 || (data.role && data.role !== ex.role)) db.run('DELETE FROM sessions WHERE user_id = ?', ex.id);
    db.audit(req.user.id, 'benutzer.geaendert', 'users', ex.id, { felder: Object.keys(data), rolle_alt: data.role && data.role !== ex.role ? ex.role : undefined, rolle_neu: data.role !== ex.role ? data.role : undefined });
    res.json({ user: { ...row, password_hash: undefined } });
  });

  // Mitarbeiter löschen: Datensatz bleibt (Historie, Zeiten), Personalnummer wird nie neu vergeben
  app.delete('/api/users/:id', requirePerm('users.manage'), (req, res) => {
    const ex = db.byId('users', req.params.id);
    if (!ex || ex.deleted) throw new AppError(404, 'Benutzer nicht gefunden.');
    if (ex.id === req.user.id) throw new AppError(400, 'Sie können sich nicht selbst löschen.');
    if (req.user.role !== 'admin' && ['admin', 'geschaeftsfuehrer'].includes(ex.role)) throw new AppError(403, 'Keine Berechtigung.');
    if (ex.role === 'admin' && db.get("SELECT COUNT(*) c FROM users WHERE role = 'admin' AND active = 1 AND deleted = 0 AND id <> ?", ex.id).c < 1) throw new AppError(400, 'Es muss mindestens ein aktiver Administrator bestehen bleiben.');
    db.tx(() => {
      db.update('users', ex.id, { deleted: 1, active: 0 });
      const p = db.byId('employee_profiles', ex.id);
      if (p) db.update('employee_profiles', p.id, { status: 'ausgeschieden' });
    });
    db.run('DELETE FROM sessions WHERE user_id = ?', ex.id);
    db.audit(req.user.id, 'benutzer.geloescht', 'users', ex.id, { nr: ex.employee_no });
    res.json({ ok: true });
  });

  app.post('/api/users/:id/reset-password', requirePerm('users.manage'), (req, res) => {
    const ex = db.byId('users', req.params.id);
    if (!ex || ex.deleted) throw new AppError(404, 'Benutzer nicht gefunden.');
    if (req.user.role !== 'admin' && ['admin', 'geschaeftsfuehrer'].includes(ex.role)) throw new AppError(403, 'Keine Berechtigung.');
    const pw = oneTimePassword();
    db.update('users', ex.id, { password_hash: hashPassword(pw), must_change_password: 1, failed_logins: 0, locked_until: null });
    db.run('DELETE FROM sessions WHERE user_id = ?', ex.id);
    db.audit(req.user.id, 'benutzer.passwort_zurueckgesetzt', 'users', ex.id);
    res.json({ one_time_password: pw });
  });

  // ---------- Personalverwaltung: Auswertungen ----------
  const monthOf = (q) => (/^\d{4}-\d{2}$/.test(q || '') ? q : todayYmd().slice(0, 7));
  const selfOr = (req, perm) => { if (req.params.id !== req.user.id) requirePermSync(req.user, perm); };
  function requirePermSync(user, perm) { if (!can(user, perm)) throw new AppError(403, 'Für diese Aktion fehlt Ihnen die Berechtigung.'); }
  function staffUser(id) { const u = db.byId('users', id); if (!u || u.role === 'kunde') throw new AppError(404, 'Mitarbeiter nicht gefunden.'); return u; }

  app.get('/api/personnel/costs', requirePerm('hr.salary'), (req, res) => {
    res.json({ ...computeCosts(db, monthOf(req.query.month)), disclaimer: DISCLAIMER });
  });
  app.get('/api/personnel/:id/month', (req, res) => {
    selfOr(req, 'hr.read'); staffUser(req.params.id);
    const r = computeEmployeeMonth(db, req.params.id, monthOf(req.query.month));
    if (!can(req.user, 'hr.salary')) { delete r.amounts; delete r.lines; delete r.per_object; r.warnings = []; }
    res.json({ ...r, disclaimer: DISCLAIMER });
  });
  app.get('/api/personnel/:id/account', (req, res) => {
    selfOr(req, 'hr.read'); staffUser(req.params.id);
    const year = /^\d{4}$/.test(req.query.year || '') ? +req.query.year : +todayYmd().slice(0, 4);
    res.json(timeAccount(db, req.params.id, year));
  });
  app.get('/api/personnel/:id/vacation', (req, res) => {
    selfOr(req, 'hr.read'); staffUser(req.params.id);
    res.json(vacationInfo(db, req.params.id, /^\d{4}$/.test(req.query.year || '') ? req.query.year : todayYmd().slice(0, 4)));
  });
  app.get('/api/export/personalkosten.csv', requirePerm('hr.salary'), (req, res) => {
    const c = computeCosts(db, monthOf(req.query.month));
    const rows = [['Personalnr.', 'Name', 'Soll Std.', 'Ist Std.', 'Gearbeitet Std.', 'Überstunden', 'Grundvergütung', 'Überstunden €', 'Zuschläge €', 'Objektvergütung €', 'Fahrt €', 'Boni €', 'Abzüge €', 'Brutto intern €', 'AG-Aufschlag €', 'Personalkosten €', '€/Std.']];
    for (const e of c.employees) rows.push([e.employee_no, e.name, e.hours.soll, e.hours.ist, e.hours.worked, e.hours.overtime, e.amounts.base, e.amounts.overtime, e.amounts.surcharges, e.amounts.object, e.amounts.travel, e.amounts.bonus, e.amounts.deduction, e.amounts.gross, e.amounts.markup, e.amounts.total, e.amounts.per_hour ?? ''].map((v) => (typeof v === 'number' ? String(v).replace('.', ',') : v)));
    rows.push([]); rows.push([DISCLAIMER]);
    db.audit(req.user.id, 'export.personalkosten', null, null, { monat: c.month });
    sendCsv(res, `Personalkosten_${c.month}.csv`, rows);
  });
  app.get('/api/reports/personalkosten', requirePerm('hr.salary'), async (req, res) => {
    const c = computeCosts(db, monthOf(req.query.month));
    const logo = db.setting('logo_file');
    const doc = createPdf({ title: 'Personalkostenübersicht (intern)', subtitle: c.month, company: db.setting('company_name'), logoPath: logo ? path.join(dirs.branding, logo) : null });
    const eur = (v) => (v == null ? '–' : new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(v));
    paragraph(doc, DISCLAIMER, { size: 8, color: '#B54708' });
    heading(doc, 'Summen');
    keyValues(doc, [['Personalkosten gesamt', eur(c.totals.total)], ['Gearbeitete Stunden', String(c.totals.hours).replace('.', ',')], ['Kosten je Arbeitsstunde', eur(c.totals.per_hour)], ['Überstundenkosten', eur(c.totals.overtime_cost)], ['Zuschläge', eur(c.totals.surcharges)], ['Überstunden (Std.)', String(c.totals.overtime_hours).replace('.', ',')]]);
    heading(doc, 'Je Mitarbeiter');
    table(doc, [
      { label: 'Nr.', width: 50, key: 'employee_no' }, { label: 'Name', get: (e) => e.name },
      { label: 'Std.', width: 45, align: 'right', get: (e) => String(e.hours.worked).replace('.', ',') }, { label: 'Ü-Std.', width: 45, align: 'right', get: (e) => String(e.hours.overtime).replace('.', ',') },
      { label: 'Brutto intern', width: 75, align: 'right', get: (e) => eur(e.amounts.gross) }, { label: 'Kosten', width: 75, align: 'right', get: (e) => eur(e.amounts.total) },
      { label: '€/Std.', width: 55, align: 'right', get: (e) => eur(e.amounts.per_hour) },
    ], c.employees);
    heading(doc, 'Je Objekt');
    table(doc, [
      { label: 'Objekt', get: (o) => o.name }, { label: 'Std.', width: 50, align: 'right', get: (o) => String(o.hours ?? '').replace('.', ',') },
      { label: 'Kosten', width: 80, align: 'right', get: (o) => eur(o.cost) }, { label: 'Umsatz', width: 80, align: 'right', get: (o) => eur(o.revenue) },
      { label: 'Anteil', width: 55, align: 'right', get: (o) => (o.ratio == null ? '–' : `${String(o.ratio).replace('.', ',')} %`) },
    ], c.objects);
    finalize(doc);
    const buf = await pdfToBuffer(doc);
    db.audit(req.user.id, 'bericht.personalkosten', null, null, { monat: c.month });
    res.type('application/pdf').setHeader('Content-Disposition', `inline; filename="Personalkosten ${c.month}.pdf"`);
    res.send(buf);
  });

  // ---------- Historie / Protokoll ----------
  app.get('/api/history/:entity/:id', (req, res) => {
    const { entity, id } = req.params;
    if (!SYNC_TABLES.includes(entity)) throw new AppError(404, 'Unbekannt.');
    assertSee(db, req.user, entity, id);
    let rows = db.all('SELECT a.*, u.name AS user_name FROM audit_log a LEFT JOIN users u ON u.id = a.user_id WHERE a.entity = ? AND a.entity_id = ? ORDER BY a.id DESC LIMIT 200', entity, id);
    if (entity === 'objects') {
      rows = rows.concat(db.all(`SELECT a.*, u.name AS user_name FROM audit_log a LEFT JOIN users u ON u.id = a.user_id
        WHERE (a.entity = 'orders' AND a.entity_id IN (SELECT id FROM orders WHERE object_id = ?)) OR (a.entity = 'qr_codes' AND a.entity_id IN (SELECT id FROM qr_codes WHERE object_id = ?))
        ORDER BY a.id DESC LIMIT 200`, id, id)).sort((a, b) => b.id - a.id).slice(0, 200);
    }
    res.json({ history: rows.map((a) => ({ ...a, details: a.details ? JSON.parse(a.details) : null })) });
  });

  app.get('/api/audit', requirePerm('audit.read'), (req, res) => {
    const limit = Math.min(500, parseInt(req.query.limit, 10) || 100);
    const before = parseInt(req.query.before, 10) || 2 ** 52;
    const q = req.query.q ? `%${req.query.q}%` : '%';
    res.json({ entries: db.all('SELECT a.*, u.name AS user_name FROM audit_log a LEFT JOIN users u ON u.id = a.user_id WHERE a.id < ? AND (a.action LIKE ? OR IFNULL(a.details, \'\') LIKE ?) ORDER BY a.id DESC LIMIT ?', before, q, q, limit) });
  });

  // ---------- Einstellungen & Administration ----------
  app.get('/api/settings', requirePerm('settings.manage'), (_req, res) => {
    res.json({ settings: Object.fromEntries(db.all('SELECT key, value FROM settings').map((r) => [r.key, r.value])) });
  });
  app.put('/api/settings', requirePerm('settings.manage'), (req, res) => {
    const allowed = ['company_name', 'portal_enabled', 'recurrence_horizon_days', 'photo_retention_months', 'public_url', 'company_address', 'company_phone', 'company_email'];
    const b = req.body || {};
    for (const k of allowed) if (k in b) {
      let v = b[k] == null ? '' : String(b[k]).trim();
      if (k === 'portal_enabled') v = v === '1' || v === 'true' ? '1' : '0';
      if (k === 'recurrence_horizon_days' && !(+v >= 7 && +v <= 120)) throw new AppError(400, 'Der Planungshorizont muss zwischen 7 und 120 Tagen liegen.');
      if (k === 'public_url' && v && !/^https?:\/\/[^\s/]+(\/[^\s]*)?$/.test(v)) throw new AppError(400, 'Bitte eine gültige Adresse angeben, z. B. https://app.grbz-solutions.com');
      db.setSetting(k, v);
    }
    db.audit(req.user.id, 'einstellungen.geaendert', 'settings', null, { felder: Object.keys(b).filter((k) => allowed.includes(k)) });
    res.json({ ok: true });
  });
  app.post('/api/settings/logo', requirePerm('settings.manage'), upload(2).single('file'), (req, res) => {
    const f = req.file;
    if (!f || !['image/png', 'image/jpeg'].includes(f.mimetype) || !magicOk(f.buffer, f.mimetype)) throw new AppError(415, 'Bitte ein PNG- oder JPEG-Logo hochladen.');
    const old = db.setting('logo_file');
    if (old) fs.rmSync(path.join(dirs.branding, old), { force: true });
    const name = `logo-${Date.now()}.${IMAGE_MIME[f.mimetype]}`;
    fs.writeFileSync(path.join(dirs.branding, name), f.buffer);
    db.setSetting('logo_file', name);
    db.audit(req.user.id, 'einstellungen.logo', 'settings');
    res.json({ ok: true });
  });

  app.use('/api/admin', adminRouter({ db, dirs, log }));
  app.get('/api/admin/backup', requirePerm('settings.manage'), (req, res) => {
    const file = path.join(os.tmpdir(), `grbz-backup-${Date.now()}.sqlite`);
    db.raw.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
    db.audit(req.user.id, 'backup.heruntergeladen', 'settings');
    res.download(file, `grbz-datenbank-${todayYmd()}.sqlite`, () => fs.rmSync(file, { force: true }));
  });

  app.get('/api/admin/retention', requirePerm('settings.manage'), (req, res) => {
    const months = Math.max(1, parseInt(req.query.months, 10) || +db.setting('photo_retention_months', '24'));
    res.json({ months, ...retentionCandidates(db, months, true) });
  });
  app.post('/api/admin/retention', requirePerm('settings.manage'), (req, res) => {
    const months = Math.max(1, parseInt(req.body?.months, 10) || 0);
    if (!months) throw new AppError(400, 'Bitte Aufbewahrungsdauer in Monaten angeben.');
    const { photos } = retentionCandidates(db, months, false);
    db.tx(() => { for (const p of photos) db.update('photos', p.id, { deleted: 1 }); });
    for (const p of photos) for (const d of ['photos', 'thumbs']) fs.rmSync(path.join(dirs[d], p.file_name || '-'), { force: true });
    db.run("DELETE FROM sessions WHERE expires_at < ?", nowIso());
    db.run("DELETE FROM sync_ops WHERE received_at < datetime('now', '-90 days')");
    db.audit(req.user.id, 'aufbewahrung.bereinigt', 'photos', null, { monate: months, fotos: photos.length });
    res.json({ deleted: photos.length });
  });

  // ---------- Berichte, Exporte, QR ----------
  const reports = reportsRouter({ db, dirs });
  app.locals.reports = reports;
  app.use('/api', reports);

  app.use('/api', (_req, _res, next) => next(new AppError(404, 'Unbekannter API-Endpunkt.')));

  // ---------- QR-Link & PWA ----------
  app.get('/q/:token', (req, res) => res.redirect(302, `/#/q/${encodeURIComponent(req.params.token)}`));
  // Service Worker mit automatischer Versionskennung (Hash aller App-Dateien)
  const swVersion = (() => {
    const hash = crypto.createHash('sha256');
    const walk = (dir) => { for (const f of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) { const p = path.join(dir, f.name); if (f.isDirectory()) walk(p); else hash.update(f.name).update(fs.readFileSync(p)); } };
    walk(path.join(ROOT, 'public')); walk(path.join(ROOT, 'shared'));
    return `grbz-${VERSION}-${hash.digest('hex').slice(0, 10)}`;
  })();
  const swSource = fs.readFileSync(path.join(ROOT, 'public', 'sw.js'), 'utf8').replace(/const VERSION = '[^']*';/, `const VERSION = '${swVersion}';`);
  app.get('/sw.js', (_req, res) => {
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Service-Worker-Allowed', '/');
    res.type('application/javascript').send(swSource);
  });
  app.get('/vendor/jsQR.js', (_req, res) => { res.setHeader('Cache-Control', 'no-cache'); res.sendFile(path.join(ROOT, 'node_modules/jsqr/dist/jsQR.js')); });
  const staticOpts = { setHeaders: (res) => res.setHeader('Cache-Control', 'no-cache') };
  app.use('/shared', express.static(path.join(ROOT, 'shared'), staticOpts));
  app.use(express.static(path.join(ROOT, 'public'), staticOpts));

  // ---------- Fehlerbehandlung ----------
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, _next) => {
    if (err instanceof multer.MulterError) {
      return res.status(413).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'Die Datei ist zu groß.' : 'Fehler beim Hochladen.' });
    }
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Ungültige Anfrage.' });
    if (err instanceof AppError) {
      return res.status(err.status).json({ error: err.message, details: err.details, conflict: err.conflict, server: err.server, must_change_password: err.must_change_password });
    }
    log('Serverfehler:', err);
    res.status(500).json({ error: 'Interner Serverfehler. Bitte später erneut versuchen.' });
  });

  // ---------- Hintergrundaufgaben ----------
  const timers = [];
  if (startTimers) {
    const gen = () => { try { const n = generateAllRecurrences(db); if (n) log(`Serienaufträge: ${n} Termine erzeugt`); } catch (e) { log('Fehler Serienaufträge', e); } };
    gen();
    timers.push(setInterval(gen, 6 * 3600e3));
    timers.push(setInterval(() => db.run('DELETE FROM sessions WHERE expires_at < ?', nowIso()), 24 * 3600e3));
    timers.forEach((t) => t.unref());
  }
  app.locals.close = () => { timers.forEach(clearInterval); db.close(); };

  function portalRouter() {
    const r = express.Router();
    r.use((req, _res, next) => {
      if (!req.user) return next(new AppError(401, 'Bitte melden Sie sich an.'));
      if (req.user.role !== 'kunde' || !req.user.customer_id) return next(new AppError(403, 'Kein Zugriff auf das Kundenportal.'));
      if (db.setting('portal_enabled', '0') !== '1') return next(new AppError(403, 'Das Kundenportal ist derzeit nicht freigeschaltet.'));
      next();
    });
    const cid = (req) => req.user.customer_id;
    r.get('/overview', (req, res) => {
      const c = db.byId('customers', cid(req));
      const objects = db.all('SELECT id, object_no, name, street, zip, city, object_type FROM objects WHERE customer_id = ? AND deleted = 0 AND archived = 0 ORDER BY name', c.id);
      const orders = db.all(`SELECT o.id, o.order_no, o.object_id, o.scheduled_date, o.status, o.completed_at, o.final_report, s.name AS service
        FROM orders o LEFT JOIN services s ON s.id = o.service_id WHERE o.customer_id = ? AND o.deleted = 0 AND o.completed_at IS NOT NULL ORDER BY o.completed_at DESC LIMIT 200`, c.id);
      const photos = db.all('SELECT id, order_id, object_id, category, comment, taken_at FROM photos WHERE customer_visible = 1 AND deleted = 0 AND object_id IN (SELECT id FROM objects WHERE customer_id = ?) ORDER BY taken_at DESC LIMIT 200', c.id);
      const inspections = db.all('SELECT id, inspection_no, object_id, inspected_at, score, rating FROM inspections WHERE customer_visible = 1 AND deleted = 0 AND object_id IN (SELECT id FROM objects WHERE customer_id = ?) ORDER BY inspected_at DESC', c.id);
      const documents = db.all('SELECT id, title, kind, object_id, created_at, mime FROM documents WHERE customer_visible = 1 AND deleted = 0 AND customer_id = ? ORDER BY created_at DESC', c.id);
      const complaints = db.all("SELECT id, defect_no, kind, object_id, title, description, status, reported_at, resolved_at, resolution_note FROM defects WHERE customer_id = ? AND deleted = 0 AND (kind = 'reklamation' OR customer_visible = 1) ORDER BY reported_at DESC", c.id);
      res.json({ customer: { company_name: c.company_name, customer_no: c.customer_no }, objects, orders, photos, inspections, documents, complaints });
    });
    r.get('/orders/:id/report.pdf', async (req, res) => {
      const o = db.byId('orders', req.params.id);
      if (!o || o.deleted || o.customer_id !== cid(req) || !o.completed_at) throw new AppError(404, 'Nicht gefunden.');
      await reports.orderReport(o, req, res, true);
    });
    r.get('/inspections/:id/report.pdf', async (req, res) => {
      const ins = db.byId('inspections', req.params.id);
      if (!ins || ins.deleted || !ins.customer_visible || db.byId('objects', ins.object_id)?.customer_id !== cid(req)) throw new AppError(404, 'Nicht gefunden.');
      await reports.inspectionReport(ins, req, res);
    });
    r.get('/photos/:id', (req, res) => {
      const p = db.byId('photos', req.params.id);
      if (!p || p.deleted || !p.customer_visible || db.byId('objects', p.object_id || '')?.customer_id !== cid(req)) throw new AppError(404, 'Nicht gefunden.');
      const thumb = req.query.thumb === '1' && fs.existsSync(path.join(dirs.thumbs, p.file_name));
      res.setHeader('Cache-Control', 'private, max-age=86400');
      res.type(p.mime).sendFile(path.join(thumb ? dirs.thumbs : dirs.photos, p.file_name));
    });
    r.get('/documents/:id', (req, res) => {
      const d = db.byId('documents', req.params.id);
      if (!d || d.deleted || !d.customer_visible || d.customer_id !== cid(req)) throw new AppError(404, 'Nicht gefunden.');
      sendDocument(res, d, dirs);
    });
    r.post('/complaints', (req, res) => {
      const { object_id, title, description } = req.body || {};
      const obj = db.byId('objects', object_id || '');
      if (!obj || obj.customer_id !== cid(req)) throw new AppError(400, 'Bitte ein Objekt auswählen.');
      if (!String(title || '').trim()) throw new AppError(400, 'Bitte einen Betreff angeben.');
      const row = db.tx(() => {
        const d = db.insert('defects', {
          defect_no: numberFor(db, 'defects'), kind: 'reklamation', customer_id: obj.customer_id, object_id: obj.id,
          title: String(title).trim().slice(0, 200), description: String(description || '').slice(0, 3000) || null,
          reported_by: req.user.id, reported_at: nowIso(), source: 'kundenportal', status: 'offen', customer_visible: 1, priority: 'hoch',
        });
        db.insert('defect_log', { defect_id: d.id, logged_at: nowIso(), user_id: req.user.id, action: 'erstellt', note: 'Reklamation über das Kundenportal' });
        return d;
      });
      db.audit(req.user.id, 'reklamation.portal', 'defects', row.id, { nr: row.defect_no });
      res.json({ complaint: { id: row.id, defect_no: row.defect_no } });
    });
    return r;
  }

  return app;
}

function sendDocument(res, d, dirs) {
  const file = path.join(dirs.documents, d.file_name);
  if (!fs.existsSync(file)) throw new AppError(404, 'Datei nicht vorhanden.');
  const inline = d.mime === 'application/pdf' || d.mime.startsWith('image/');
  // PDFs ohne sandbox (Chrome blockiert sonst den PDF-Viewer); alle anderen Dateien isoliert
  if (d.mime !== 'application/pdf') res.setHeader('Content-Security-Policy', "sandbox; default-src 'none'; img-src 'self'; style-src 'unsafe-inline'");
  res.setHeader('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(d.original_name || d.title)}`);
  res.setHeader('Cache-Control', 'private, no-cache');
  res.type(d.mime).sendFile(file);
}

function retentionCandidates(db, months, preview) {
  const cutoff = new Date(Date.now() - months * 30.44 * 864e5).toISOString();
  // Fotos zu offenen Mängeln bleiben erhalten (Nachweis bis zur Behebung)
  const photos = db.all(`SELECT id, file_name, taken_at FROM photos WHERE deleted = 0 AND taken_at < ?
    AND (defect_id IS NULL OR defect_id NOT IN (SELECT id FROM defects WHERE status IN ('offen','in_bearbeitung')))`, cutoff);
  return preview ? { count: photos.length, cutoff } : { photos };
}
