// Datensicherung: konsistente Kopie der Datenbank (VACUUM INTO) + Upload-Dateien.
// Aufruf: npm run backup   (z. B. täglich per cron/systemd-Timer)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = process.env.GRBZ_DATA_DIR ? path.resolve(process.env.GRBZ_DATA_DIR) : path.join(ROOT, 'data');
const target = process.env.GRBZ_BACKUP_DIR ? path.resolve(process.env.GRBZ_BACKUP_DIR) : path.join(dataDir, 'backups');
const keep = +(process.env.GRBZ_BACKUP_KEEP || 14);

const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 16);
const dir = path.join(target, `grbz-${stamp}`);
fs.mkdirSync(dir, { recursive: true });
const db = new DatabaseSync(path.join(dataDir, 'grbz.sqlite'));
db.exec(`VACUUM INTO '${path.join(dir, 'grbz.sqlite').replace(/'/g, "''")}'`);
db.close();
const uploads = path.join(dataDir, 'uploads');
if (fs.existsSync(uploads)) fs.cpSync(uploads, path.join(dir, 'uploads'), { recursive: true });
console.log('Sicherung erstellt:', dir);

// Alte Sicherungen entfernen
const all = fs.readdirSync(target).filter((d) => d.startsWith('grbz-')).sort();
for (const old of all.slice(0, Math.max(0, all.length - keep))) {
  fs.rmSync(path.join(target, old), { recursive: true, force: true });
  console.log('Alte Sicherung entfernt:', old);
}
