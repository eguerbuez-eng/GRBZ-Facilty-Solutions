// Administrator: uneingeschränkte Datenverwaltung (bearbeiten, löschen, wiederherstellen,
// endgültig löschen) für alle Tabellen sowie Sicherung/Wiederherstellung.
// Jede Aktion wird serverseitig auf die Rolle „admin“ geprüft und vollständig protokolliert.
import express from 'express';
import multer from 'multer';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { AppError, nowIso } from './db.js';
import { commands, bad, req, isAdmin } from './commands.js';
import { SYNC_TABLES } from '../shared/entities.js';
import { SCHEMA_VERSION } from './migrations.js';
import { categoryMode } from '../shared/inventory.js';

/** Wirkung einer Bestandsbewegung umkehren (sign = -1) bzw. wieder anwenden (sign = +1) */
function applyMovement(db, mv, sign) {
  const m = db.byId('materials', mv.material_id);
  if (!m) return;
  if (['ausgabe', 'ruecknahme'].includes(mv.kind) && categoryMode(m.category) === 'leihe') {
    db.update('materials', m.id, { issued: Math.max(0, Math.round(((m.issued || 0) - sign * mv.qty) * 1000) / 1000) });
  } else {
    db.update('materials', m.id, { stock: Math.round((m.stock + sign * mv.qty) * 1000) / 1000 });
  }
}

const LOCKED_COLS = ['id', 'created_at', 'updated_at', 'version', 'seq', 'deleted', 'password_hash', 'token'];
const ADMIN_TABLES = SYNC_TABLES; // alle fachlichen Tabellen
// Abhängige Datensätze, die beim endgültigen Löschen mit entfernt werden
const CASCADE = {
  orders: [['order_checklist_items', 'order_id']],
  checklist_templates: [['checklist_template_items', 'template_id']],
  inspections: [['inspection_items', 'inspection_id']],
  defects: [['defect_log', 'defect_id']],
  customers: [['contact_history', 'customer_id'], ['customer_services', 'customer_id']],
  objects: [['object_employees', 'object_id'], ['winter_areas', 'object_id'], ['qr_codes', 'object_id']],
  machines: [['machine_events', 'machine_id']],
  time_entries: [['time_corrections', 'entry_id']],
};

function assertAdmin(user) {
  if (!isAdmin(user)) throw new AppError(403, 'Diese Funktion ist dem Administrator vorbehalten.');
}
function assertTable(t) {
  if (!ADMIN_TABLES.includes(t)) throw bad('Unbekannte Tabelle.');
}
/** Kompakter Schnappschuss für das Protokoll (ohne Passwort, lange Werte gekürzt) */
function snapshot(row) {
  const out = {};
  for (const [k, v] of Object.entries(row || {})) {
    if (k === 'password_hash') continue;
    out[k] = typeof v === 'string' && v.length > 500 ? v.slice(0, 60) + '… (gekürzt)' : v;
  }
  return out;
}

export function tableColumns(db, table) {
  return db.raw.prepare(`PRAGMA table_info(${table})`).all().map((c) => ({ name: c.name, type: (c.type || 'TEXT').toUpperCase(), notnull: !!c.notnull }));
}

Object.assign(commands, {
  'admin.update'(ctx, { table, id, data = {}, base_version }) {
    const { db, user } = ctx;
    assertAdmin(user); assertTable(table);
    const ex = req(db.byId(table, id), 'Datensatz nicht gefunden.');
    if (base_version != null && ex.version !== +base_version) throw new AppError(409, 'Der Datensatz wurde zwischenzeitlich geändert.', { conflict: true, server: ex });
    const cols = tableColumns(db, table);
    const patch = {};
    for (const [k, raw] of Object.entries(data)) {
      const c = cols.find((x) => x.name === k);
      if (!c || LOCKED_COLS.includes(k)) continue;
      let v = raw === '' || raw === undefined ? null : raw;
      if (v !== null && /INT|REAL/.test(c.type)) {
        const n = Number(String(v).replace(',', '.'));
        if (!isFinite(n)) throw bad(`„${k}“ muss eine Zahl sein.`);
        v = c.type.includes('INT') ? Math.round(n) : n;
      }
      if (v === null && c.notnull) throw bad(`„${k}“ darf nicht leer sein.`);
      if (String(v ?? '') !== String(ex[k] ?? '')) patch[k] = v;
    }
    if (!Object.keys(patch).length) return { row: ex };
    let row;
    try { row = db.update(table, id, patch); } catch (e) { throw bad('Änderung nicht möglich: ' + e.message); }
    db.audit(user.id, 'admin.geaendert', table, id, { alt: snapshot(Object.fromEntries(Object.keys(patch).map((k) => [k, ex[k]]))), neu: snapshot(patch) });
    return { row };
  },

  'admin.delete'(ctx, { table, id }) {
    const { db, user } = ctx;
    assertAdmin(user); assertTable(table);
    const ex = req(db.byId(table, id), 'Datensatz nicht gefunden.');
    if (table === 'users') {
      if (id === user.id) throw bad('Sie können Ihr eigenes Konto nicht löschen.');
      if (ex.role === 'admin' && db.get("SELECT COUNT(*) c FROM users WHERE role = 'admin' AND active = 1 AND deleted = 0 AND id <> ?", id).c < 1) throw bad('Es muss mindestens ein aktiver Administrator bestehen bleiben.');
      db.update('users', id, { deleted: 1, active: 0 });
      db.run('DELETE FROM sessions WHERE user_id = ?', id);
    } else if (table === 'roles' && ['admin', 'kunde'].includes(ex.role_key)) {
      throw bad('Diese Rolle ist für den Systembetrieb erforderlich.');
    } else {
      db.update(table, id, { deleted: 1 });
    }
    // Bestand bei gelöschter Bestandsbewegung korrigieren
    if (table === 'stock_movements' && !ex.deleted) applyMovement(db, ex, -1);
    db.audit(user.id, 'admin.geloescht', table, id, { datensatz: snapshot(ex) });
    return {};
  },

  'admin.restore'(ctx, { table, id }) {
    const { db, user } = ctx;
    assertAdmin(user); assertTable(table);
    const ex = req(db.byId(table, id), 'Datensatz nicht gefunden.');
    if (!ex.deleted) return { row: ex };
    const row = db.update(table, id, { deleted: 0 });
    if (table === 'stock_movements') applyMovement(db, ex, +1);
    db.audit(user.id, 'admin.wiederhergestellt', table, id, { datensatz: snapshot(ex) });
    return { row };
  },

  'admin.hardDelete'(ctx, { table, id, confirm }) {
    const { db, user } = ctx;
    assertAdmin(user); assertTable(table);
    if (confirm !== 'ENDGÜLTIG LÖSCHEN') throw bad('Bitte die Sicherheitsabfrage bestätigen.');
    const ex = req(db.byId(table, id), 'Datensatz nicht gefunden.');
    if (!ex.deleted) throw bad('Bitte den Datensatz zuerst löschen (Papierkorb); endgültiges Löschen ist nur aus dem Papierkorb möglich.');
    if (table === 'users') throw bad('Benutzer bleiben zur Nachvollziehbarkeit (Zeiten, Personalnummer) als gelöscht erhalten und können nicht endgültig entfernt werden.');
    const removed = [];
    try {
      for (const [t, col] of CASCADE[table] || []) {
        const n = db.get(`SELECT COUNT(*) c FROM ${t} WHERE ${col} = ?`, id).c;
        if (n) { db.run(`DELETE FROM ${t} WHERE ${col} = ?`, id); removed.push(`${t}: ${n}`); }
      }
      db.run(`DELETE FROM ${table} WHERE id = ?`, id);
    } catch (e) {
      if (/FOREIGN KEY/i.test(e.message)) throw bad('Es gibt noch abhängige Datensätze (z. B. Aufträge, Zeiten oder Bewegungen), die auf diesen Eintrag verweisen. Diese bitte zuerst löschen.');
      throw e;
    }
    if (table === 'photos') ctx.removeFiles?.push(['photos', ex.file_name], ['thumbs', ex.file_name]);
    if (table === 'documents') ctx.removeFiles?.push(['documents', ex.file_name]);
    db.audit(user.id, 'admin.endgueltig_geloescht', table, id, { datensatz: snapshot(ex), abhaengige: removed });
    return { removed };
  },

  'winter.reopen'(ctx, { id, reason }) {
    const { db, user } = ctx;
    assertAdmin(user);
    const op = req(db.byId('winter_operations', id), 'Einsatz nicht gefunden.');
    if (!String(reason || '').trim()) throw bad('Bitte einen Grund angeben.');
    const row = db.update('winter_operations', id, { status: 'offen', signature: null, signed_at: null });
    db.audit(user.id, 'admin.winterdienst_geoeffnet', 'winter_operations', id, { nr: op.operation_no, grund: reason, signiert_am: op.signed_at });
    return { row };
  },
});

export function adminRouter({ db, dirs, log }) {
  const r = express.Router();
  r.use((req2, _res, next) => {
    if (['/backup', '/retention'].includes(req2.path)) return next('router'); // bestehende Endpunkte (Recht „Systemeinstellungen“)
    try { assertAdmin(req2.user); next(); } catch (e) { next(e); }
  });

  // Datensätze einer Tabelle (inkl. gelöschter = Papierkorb)
  r.get('/records', (q, res) => {
    const table = String(q.query.table || '');
    assertTable(table);
    const cols = tableColumns(db, table);
    const deleted = q.query.deleted === '1' ? 1 : 0;
    const limit = Math.min(500, +q.query.limit || 200);
    const search = String(q.query.q || '').trim();
    const textCols = cols.filter((c) => c.type.includes('TEXT') && !['password_hash', 'signature', 'params', 'permissions'].includes(c.name)).map((c) => c.name);
    let where = 'deleted = ?'; const params = [deleted];
    if (search) { where += ` AND (${textCols.map((c) => `IFNULL(${c},'') LIKE ?`).join(' OR ')})`; textCols.forEach(() => params.push(`%${search}%`)); }
    const rows = db.all(`SELECT * FROM ${table} WHERE ${where} ORDER BY updated_at DESC LIMIT ?`, ...params, limit).map((x) => { delete x.password_hash; return x; });
    res.json({ table, columns: cols.filter((c) => c.name !== 'password_hash'), locked: LOCKED_COLS, rows, counts: db.get(`SELECT SUM(deleted = 0) aktiv, SUM(deleted = 1) geloescht FROM ${table}`) });
  });

  r.get('/trash', (_q, res) => {
    res.json({ tables: ADMIN_TABLES.map((t) => ({ table: t, count: db.get(`SELECT COUNT(*) c FROM ${t} WHERE deleted = 1`).c })).filter((x) => x.count) });
  });

  // ---------- Sicherungen ----------
  const listBackups = () => {
    if (!fs.existsSync(dirs.backups)) return [];
    return fs.readdirSync(dirs.backups).map((name) => {
      const p = path.join(dirs.backups, name);
      const st = fs.statSync(p);
      const file = st.isDirectory() ? path.join(p, 'grbz.sqlite') : p;
      if (!fs.existsSync(file) || !/\.sqlite$/.test(file)) return null;
      return { name, file, size: fs.statSync(file).size, created_at: st.mtime.toISOString(), with_uploads: st.isDirectory() && fs.existsSync(path.join(p, 'uploads')) };
    }).filter(Boolean).sort((a, b) => b.created_at.localeCompare(a.created_at));
  };

  function createBackup(label = 'manuell', withUploads = true) {
    const dir = path.join(dirs.backups, `grbz-${label}-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}`);
    fs.mkdirSync(dir, { recursive: true });
    db.raw.exec(`VACUUM INTO '${path.join(dir, 'grbz.sqlite').replace(/'/g, "''")}'`);
    const uploads = path.dirname(dirs.photos);
    if (withUploads && fs.existsSync(uploads)) fs.cpSync(uploads, path.join(dir, 'uploads'), { recursive: true });
    return dir;
  }

  r.get('/backups', (_q, res) => res.json({ backups: listBackups().map(({ file, ...b }) => b) }));

  r.post('/backups', (q, res) => {
    const dir = createBackup('manuell');
    db.audit(q.user.id, 'admin.sicherung_erstellt', 'settings', null, { ordner: path.basename(dir) });
    res.json({ name: path.basename(dir) });
  });

  r.get('/backups/:name/download', (q, res) => {
    const b = listBackups().find((x) => x.name === q.params.name);
    if (!b) throw new AppError(404, 'Sicherung nicht gefunden.');
    db.audit(q.user.id, 'backup.heruntergeladen', 'settings', null, { name: b.name });
    res.download(b.file, `${b.name}.sqlite`);
  });

  const up = multer({ storage: multer.memoryStorage(), limits: { fileSize: 500 * 1024 * 1024, files: 1 } });
  r.post('/backups/upload', up.single('file'), (q, res) => {
    const f = q.file;
    if (!f || f.buffer.subarray(0, 15).toString() !== 'SQLite format 3') throw bad('Bitte eine gültige Datenbanksicherung (.sqlite) hochladen.');
    const name = `hochgeladen-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.sqlite`;
    fs.mkdirSync(dirs.backups, { recursive: true });
    fs.writeFileSync(path.join(dirs.backups, name), f.buffer);
    db.audit(q.user.id, 'admin.sicherung_hochgeladen', 'settings', null, { name, groesse: f.size });
    res.json({ name });
  });

  // Wiederherstellung: aktueller Stand wird vorher gesichert; Daten werden tabellenweise ersetzt
  r.post('/backups/restore', (q, res) => {
    const { name, confirm } = q.body || {};
    if (confirm !== 'WIEDERHERSTELLEN') throw bad('Bitte die Sicherheitsabfrage bestätigen.');
    const b = listBackups().find((x) => x.name === name);
    if (!b) throw new AppError(404, 'Sicherung nicht gefunden.');
    const src = new DatabaseSync(b.file, { readOnly: true });
    let version;
    try { version = src.prepare("SELECT value FROM counters WHERE name = 'schema_version'").get()?.value || 1; } catch { version = 0; } finally { src.close(); }
    if (version !== SCHEMA_VERSION) throw bad(`Diese Sicherung hat Datenbankversion ${version}, das System Version ${SCHEMA_VERSION}. Ältere Sicherungen bitte über einen Neustart mit der Sicherungsdatei einspielen (siehe Dokumentation).`);
    const safety = createBackup('vor-wiederherstellung');
    const tables = [...ADMIN_TABLES, 'settings', 'counters', 'audit_log', 'sync_ops'];
    const me = q.user.id;
    db.raw.exec(`ATTACH DATABASE '${b.file.replace(/'/g, "''")}' AS quelle`);
    try {
      db.raw.exec('PRAGMA foreign_keys = OFF');
      db.raw.exec('BEGIN IMMEDIATE');
      for (const t of tables) {
        const cols = db.raw.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name);
        const srcCols = db.raw.prepare(`PRAGMA quelle.table_info(${t})`).all().map((c) => c.name);
        const common = cols.filter((c) => srcCols.includes(c)).join(', ');
        db.raw.exec(`DELETE FROM main.${t}`);
        if (common) db.raw.exec(`INSERT INTO main.${t} (${common}) SELECT ${common} FROM quelle.${t}`);
      }
      // Alle Geräte erhalten den kompletten Stand neu
      const seq = db.raw.prepare("SELECT value FROM counters WHERE name = 'seq'").get().value + 1;
      for (const t of ADMIN_TABLES) db.raw.prepare(`UPDATE ${t} SET seq = ?`).run(seq);
      db.raw.prepare("UPDATE counters SET value = ? WHERE name = 'seq'").run(seq);
      db.raw.prepare("INSERT INTO settings(key, value) VALUES ('data_epoch', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(crypto.randomUUID());
      db.raw.exec('COMMIT');
    } catch (e) {
      db.raw.exec('ROLLBACK');
      throw bad('Wiederherstellung fehlgeschlagen, es wurde nichts verändert: ' + e.message);
    } finally {
      db.raw.exec('PRAGMA foreign_keys = ON');
      db.raw.exec('DETACH DATABASE quelle');
    }
    const dataDir = path.dirname(dirs.backups);
    const bdir = path.join(dirs.backups, name, 'uploads');
    if (fs.existsSync(bdir)) fs.cpSync(bdir, path.join(dataDir, 'uploads'), { recursive: true, force: true });
    db.run('DELETE FROM sessions WHERE user_id NOT IN (SELECT id FROM users WHERE deleted = 0 AND active = 1)');
    db.audit(me, 'admin.wiederhergestellt_sicherung', 'settings', null, { sicherung: name, vorher_gesichert: path.basename(safety) });
    log?.(`Datenbank aus Sicherung ${name} wiederhergestellt (vorheriger Stand: ${path.basename(safety)})`);
    res.json({ ok: true, safety: path.basename(safety) });
  });

  return r;
}

export { nowIso };
