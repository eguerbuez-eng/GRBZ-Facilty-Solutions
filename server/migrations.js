// Versionierte Datenbank-Migrationen. Vor jeder Migration einer bestehenden
// Datenbank wird automatisch eine Sicherung erstellt (data/backups/vor-migration-…).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fmtPersonnelNo } from '../shared/hr.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const SCHEMA_VERSION = 3;

function ensureColumn(db, table, column, ddl) {
  const cols = db.raw.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
  if (!cols.includes(column)) db.raw.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
}

function backup(db, file, label, log) {
  if (!file || file === ':memory:') return null;
  const dir = path.join(path.dirname(file), 'backups');
  fs.mkdirSync(dir, { recursive: true });
  const target = path.join(dir, `vor-migration-${label}-${new Date().toISOString().replace(/[:.]/g, '-')}.sqlite`);
  db.raw.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`);
  log?.(`Datensicherung vor Migration erstellt: ${target}`);
  return target;
}

export function migrate(db, file, log = console.log) {
  db.raw.prepare("INSERT OR IGNORE INTO counters(name, value) VALUES ('personnel', 0)").run();
  const row = db.raw.prepare("SELECT value FROM counters WHERE name = 'schema_version'").get();
  const hasUsers = db.raw.prepare('SELECT COUNT(*) c FROM users').get().c > 0;
  let version = row ? row.value : hasUsers ? 1 : 0;
  const result = { from: version, to: SCHEMA_VERSION, backup: null };

  if (version > 0 && version < SCHEMA_VERSION) result.backup = backup(db, file, `v${version}-zu-v${SCHEMA_VERSION}`, log);

  // --- v2: Personalverwaltung ---
  if (version < 2) {
    const usersSql = db.raw.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'users'").get().sql;
    if (/CHECK \(role IN/.test(usersSql)) {
      // Rollen-Einschränkung entfernen (frei definierbare Rollen) → Tabelle neu aufbauen, Daten übernehmen
      const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
      const create = schema.match(/CREATE TABLE IF NOT EXISTS users \([\s\S]*?\n\);/)[0].replace('CREATE TABLE IF NOT EXISTS users', 'CREATE TABLE users_neu');
      const oldCols = db.raw.prepare('PRAGMA table_info(users)').all().map((c) => c.name);
      db.raw.exec('PRAGMA foreign_keys = OFF');
      db.raw.exec('BEGIN IMMEDIATE');
      try {
        db.raw.exec(create);
        const newCols = db.raw.prepare('PRAGMA table_info(users_neu)').all().map((c) => c.name);
        const common = oldCols.filter((c) => newCols.includes(c)).join(', ');
        db.raw.exec(`INSERT INTO users_neu (${common}) SELECT ${common} FROM users`);
        db.raw.exec('DROP TABLE users');
        db.raw.exec('ALTER TABLE users_neu RENAME TO users');
        db.raw.exec('COMMIT');
      } catch (e) {
        db.raw.exec('ROLLBACK');
        throw e;
      } finally {
        db.raw.exec('PRAGMA foreign_keys = ON');
      }
    }
  }

  // Spalten, die bestehenden Tabellen hinzugefügt werden (idempotent)
  ensureColumn(db, 'users', 'legacy_employee_no', 'TEXT');
  ensureColumn(db, 'objects', 'monthly_revenue', 'REAL');
  ensureColumn(db, 'documents', 'user_id', 'TEXT');
  // v3: Inventar-Scanner
  ensureColumn(db, 'materials', 'manufacturer', 'TEXT');
  ensureColumn(db, 'materials', 'model', 'TEXT');
  ensureColumn(db, 'materials', 'status', "TEXT NOT NULL DEFAULT 'verfuegbar'");
  ensureColumn(db, 'materials', 'object_id', 'TEXT');
  ensureColumn(db, 'materials', 'issued', 'REAL NOT NULL DEFAULT 0');
  ensureColumn(db, 'machines', 'barcode', 'TEXT');
  ensureColumn(db, 'machines', 'machine_type', "TEXT NOT NULL DEFAULT 'maschine'");
  ensureColumn(db, 'machines', 'object_id', 'TEXT');
  ensureColumn(db, 'machines', 'issued_to_user_id', 'TEXT');
  ensureColumn(db, 'stock_movements', 'recipient_user_id', 'TEXT');
  ensureColumn(db, 'stock_movements', 'stock_after', 'REAL');
  // Eindeutige Barcodes je Tabelle (nur aktive Datensätze). Bestehende Dubletten blockieren den Start nicht.
  for (const [t, col] of [['materials', 'barcode'], ['machines', 'barcode']]) {
    try { db.raw.exec(`CREATE UNIQUE INDEX IF NOT EXISTS uq_${t}_${col} ON ${t}(${col}) WHERE ${col} IS NOT NULL AND ${col} <> '' AND deleted = 0`); }
    catch (e) { log?.(`Hinweis: doppelte Barcodes in ${t} vorhanden – bitte bereinigen (${e.message})`); }
  }

  if (version < 2) {
    db.tx(() => {
      // Personalnummern G-0001 … in Anlagereihenfolge; alte Nummer bleibt erhalten
      const users = db.raw.prepare('SELECT id, employee_no, role FROM users ORDER BY created_at, rowid').all();
      for (const u of users) {
        if (u.employee_no && u.employee_no.startsWith('G-')) continue;
        if (u.role === 'kunde') {
          db.raw.prepare('UPDATE users SET legacy_employee_no = ?, employee_no = NULL, seq = ? WHERE id = ?').run(u.employee_no, db.nextSeq(), u.id);
        } else {
          const no = fmtPersonnelNo(db.nextNumber('personnel'));
          db.raw.prepare('UPDATE users SET legacy_employee_no = ?, employee_no = ?, seq = ? WHERE id = ?').run(u.employee_no, no, db.nextSeq(), u.id);
        }
      }
    });
  }
  db.raw.prepare("INSERT INTO counters(name, value) VALUES ('schema_version', ?) ON CONFLICT(name) DO UPDATE SET value = excluded.value").run(SCHEMA_VERSION);
  if (result.from !== SCHEMA_VERSION && result.from > 0) log?.(`Datenbank migriert: Version ${result.from} → ${SCHEMA_VERSION}`);
  return result;
}
