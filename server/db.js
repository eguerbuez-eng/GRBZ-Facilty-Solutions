// Datenbankzugriff (SQLite über das in Node.js integrierte Modul node:sqlite).
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { SYNC_TABLES } from '../shared/entities.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const nowIso = () => new Date().toISOString();
export const uuid = () => crypto.randomUUID();

export class AppError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    Object.assign(this, extra);
  }
}

export function openDb(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON;');
  db.exec(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));
  for (const t of SYNC_TABLES) db.exec(`CREATE INDEX IF NOT EXISTS idx_${t}_seq ON ${t}(seq)`);
  db.prepare("INSERT OR IGNORE INTO counters(name, value) VALUES ('seq', 0)").run();
  return wrap(db);
}

const columnCache = new Map();

function wrap(db) {
  const stmtCache = new Map();
  const prep = (sql) => {
    let s = stmtCache.get(sql);
    if (!s) { s = db.prepare(sql); stmtCache.set(sql, s); }
    return s;
  };
  const api = {
    raw: db,
    all: (sql, ...p) => prep(sql).all(...p),
    get: (sql, ...p) => prep(sql).get(...p),
    run: (sql, ...p) => prep(sql).run(...p),
    exec: (sql) => db.exec(sql),
    columns(table) {
      if (!columnCache.has(table)) columnCache.set(table, db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name));
      return columnCache.get(table);
    },
    nextSeq() {
      return prep("UPDATE counters SET value = value + 1 WHERE name = 'seq' RETURNING value").get().value;
    },
    nextNumber(name) {
      prep('INSERT OR IGNORE INTO counters(name, value) VALUES (?, 0)').run(name);
      return prep('UPDATE counters SET value = value + 1 WHERE name = ? RETURNING value').get(name).value;
    },
    tx(fn) {
      if (api._inTx) return fn();
      db.exec('BEGIN IMMEDIATE');
      api._inTx = true;
      try {
        const r = fn();
        db.exec('COMMIT');
        return r;
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      } finally {
        api._inTx = false;
      }
    },
    insert(table, row) {
      const cols = api.columns(table);
      const t = nowIso();
      const data = { id: row.id || uuid(), created_at: t, updated_at: t, version: 1, ...pick(row, cols), seq: api.nextSeq() };
      data.created_at = data.created_at || t;
      const keys = Object.keys(data).filter((k) => cols.includes(k));
      prep(`INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`).run(...keys.map((k) => norm(data[k])));
      return api.get(`SELECT * FROM ${table} WHERE id = ?`, data.id);
    },
    update(table, id, patch) {
      const cols = api.columns(table);
      const data = pick(patch, cols);
      delete data.id; delete data.created_at; delete data.version; delete data.seq;
      data.updated_at = nowIso();
      const keys = Object.keys(data);
      prep(`UPDATE ${table} SET ${keys.map((k) => `${k} = ?`).join(', ')}, version = version + 1, seq = ? WHERE id = ?`)
        .run(...keys.map((k) => norm(data[k])), api.nextSeq(), id);
      return api.get(`SELECT * FROM ${table} WHERE id = ?`, id);
    },
    byId(table, id) {
      return api.get(`SELECT * FROM ${table} WHERE id = ?`, id);
    },
    setting(key, fallback = null) {
      const r = api.get('SELECT value FROM settings WHERE key = ?', key);
      return r ? r.value : fallback;
    },
    setSetting(key, value) {
      api.run('INSERT INTO settings(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, value == null ? null : String(value));
    },
    audit(userId, action, entity = null, entityId = null, details = null, ip = null) {
      api.run('INSERT INTO audit_log(at, user_id, action, entity, entity_id, details, ip) VALUES (?,?,?,?,?,?,?)',
        nowIso(), userId, action, entity, entityId, details ? JSON.stringify(details) : null, ip);
    },
    close: () => db.close(),
  };
  return api;
}

function pick(obj, cols) {
  const out = {};
  for (const k of Object.keys(obj || {})) if (cols.includes(k) && obj[k] !== undefined) out[k] = obj[k];
  return out;
}

function norm(v) {
  if (v === undefined) return null;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (v !== null && typeof v === 'object') return JSON.stringify(v);
  return v;
}

export function pad(n, len) {
  return String(n).padStart(len, '0');
}
