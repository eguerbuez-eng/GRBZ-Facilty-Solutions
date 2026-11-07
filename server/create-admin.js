// Notfallzugang: neuen Administrator anlegen oder Passwort eines Kontos zurücksetzen.
// Aufruf: npm run create-admin -- admin@example.com
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { openDb } from './db.js';
import { hashPassword } from './auth.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = process.env.GRBZ_DATA_DIR ? path.resolve(process.env.GRBZ_DATA_DIR) : path.join(ROOT, 'data');
const email = process.argv[2];
if (!email) { console.error('Aufruf: npm run create-admin -- <email>'); process.exit(1); }
const db = openDb(path.join(dataDir, 'grbz.sqlite'));
const pw = crypto.randomBytes(9).toString('base64url') + '7a';
const ex = db.get('SELECT * FROM users WHERE email = ?', email);
db.tx(() => {
  if (ex) db.update('users', ex.id, { password_hash: hashPassword(pw), must_change_password: 1, active: 1, failed_logins: 0, locked_until: null, deleted: 0 });
  else db.insert('users', { name: 'Administrator', email, role: 'admin', employee_no: 'MA-' + String(db.nextNumber('employee')).padStart(3, '0'), password_hash: hashPassword(pw), must_change_password: 1, active: 1 });
});
db.audit(null, ex ? 'notfall.passwort_zurueckgesetzt' : 'notfall.admin_erstellt', 'users', ex?.id || null, { email });
console.log(`${ex ? 'Passwort zurückgesetzt' : 'Administrator angelegt'}: ${email}\nEinmalpasswort: ${pw}`);
db.close();
