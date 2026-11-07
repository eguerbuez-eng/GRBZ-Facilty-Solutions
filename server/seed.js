// Ersteinrichtung: Stammdaten (Dienstleistungen, Checklisten) und Administratorzugang.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { hashPassword } from './auth.js';
import { DEFAULT_SERVICES, DEFAULT_CHECKLISTS, DEFAULT_INSPECTION_ITEMS, COMPANY } from '../shared/constants.js';

export function seed(db, { dataDir, log = console.log } = {}) {
  db.tx(() => {
    const defaults = { company_name: COMPANY, portal_enabled: '0', recurrence_horizon_days: '28', photo_retention_months: '24', public_url: '' };
    for (const [k, v] of Object.entries(defaults)) if (db.setting(k) === null) db.setSetting(k, v);

    if (!db.get('SELECT id FROM services LIMIT 1')) {
      for (const name of DEFAULT_SERVICES) db.insert('services', { name, active: 1 });
    }
    if (!db.get('SELECT id FROM checklist_templates LIMIT 1')) {
      for (const [svcName, items] of Object.entries(DEFAULT_CHECKLISTS)) {
        const svc = db.get('SELECT id FROM services WHERE name = ?', svcName);
        const t = db.insert('checklist_templates', { name: svcName, service_id: svc?.id || null, purpose: 'reinigung', active: 1 });
        items.forEach((text, i) => db.insert('checklist_template_items', { template_id: t.id, position: i, text, required: 1, photo_required: 0 }));
      }
      const q = db.insert('checklist_templates', { name: 'Standard-Objektkontrolle', purpose: 'kontrolle', active: 1 });
      DEFAULT_INSPECTION_ITEMS.forEach((text, i) => db.insert('checklist_template_items', { template_id: q.id, position: i, text, required: 1 }));
    }
  });

  if (!db.get("SELECT id FROM users WHERE role = 'admin' AND deleted = 0 LIMIT 1")) {
    const email = process.env.GRBZ_ADMIN_EMAIL || 'admin@grbz.local';
    const password = process.env.GRBZ_ADMIN_PASSWORD || generatePassword();
    db.tx(() => {
      db.insert('users', {
        employee_no: 'MA-' + String(db.nextNumber('employee')).padStart(3, '0'), name: 'Administrator', email, role: 'admin',
        password_hash: hashPassword(password), must_change_password: 1, active: 1,
      });
    });
    db.audit(null, 'ersteinrichtung.admin', 'users', null, { email });
    if (!process.env.GRBZ_ADMIN_PASSWORD && dataDir) {
      const file = path.join(dataDir, 'ERSTZUGANG.txt');
      fs.writeFileSync(file, `GRBZ Facility Management System – Erstzugang\n\nE-Mail:   ${email}\nPasswort: ${password}\n\nDas Passwort muss bei der ersten Anmeldung geändert werden.\nDiese Datei nach der Ersteinrichtung löschen!\n`, { mode: 0o600 });
      log(`\n  Administratorzugang angelegt: ${email}\n  Einmalpasswort steht in: ${file}\n`);
    }
  }
}

function generatePassword() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  const bytes = crypto.randomBytes(14);
  let s = '';
  for (const b of bytes) s += alphabet[b % alphabet.length];
  return s.slice(0, 7) + '-' + s.slice(7) + '7';
}
