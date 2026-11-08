// Ersteinrichtung: Stammdaten (Dienstleistungen, Checklisten) und Administratorzugang.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { hashPassword } from './auth.js';
import { DEFAULT_SERVICES, DEFAULT_CHECKLISTS, DEFAULT_INSPECTION_ITEMS, COMPANY, ROLES, ROLE_PERMISSIONS, SCOPED_ROLES, DEFAULT_EMPLOYMENT_TYPES, DEFAULT_POSITIONS, DEFAULT_DEPARTMENTS } from '../shared/constants.js';
import { fmtPersonnelNo } from '../shared/hr.js';

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

    // Personalverwaltung: Standardrollen und Kategorien (nur beim ersten Mal; danach frei änderbar)
    if (!db.get('SELECT id FROM roles LIMIT 1')) {
      Object.entries(ROLES).forEach(([key, name], i) => db.insert('roles', {
        role_key: key, name, permissions: JSON.stringify(ROLE_PERMISSIONS[key] || []), scoped: SCOPED_ROLES.includes(key) ? 1 : 0,
        system: 1, active: 1, sort: i * 10,
      }));
    }
    for (const [table, list] of [['employment_types', DEFAULT_EMPLOYMENT_TYPES], ['positions', DEFAULT_POSITIONS], ['departments', DEFAULT_DEPARTMENTS]]) {
      if (!db.get(`SELECT id FROM ${table} LIMIT 1`)) list.forEach((name, i) => db.insert(table, { name, active: 1, sort: i * 10 }));
    }
    if (!db.get('SELECT id FROM work_models LIMIT 1')) {
      // Beispielmodelle ohne gesetzliche Annahmen – Stunden frei anpassbar
      db.insert('work_models', { name: 'Montag–Freitag, 8 Std./Tag', day_minutes: JSON.stringify([480, 480, 480, 480, 480, 0, 0]), holidays_reduce: 1, active: 1 });
      db.insert('work_models', { name: 'Montag–Freitag, 4 Std./Tag', day_minutes: JSON.stringify([240, 240, 240, 240, 240, 0, 0]), holidays_reduce: 1, active: 1 });
      db.insert('work_models', { name: 'Flexibel (keine feste Soll-Zeit)', day_minutes: JSON.stringify([0, 0, 0, 0, 0, 0, 0]), holidays_reduce: 0, active: 1 });
    }
    // Personalakte für jeden Mitarbeiter ohne Akte (auch Bestandsdaten nach Migration)
    for (const u of db.all("SELECT id, active FROM users WHERE role <> 'kunde' AND id NOT IN (SELECT user_id FROM employee_profiles)")) {
      db.insert('employee_profiles', { id: u.id, user_id: u.id, status: u.active ? 'aktiv' : 'inaktiv', pay_type: 'keine' });
    }
  });

  if (!db.get("SELECT id FROM users WHERE role = 'admin' AND deleted = 0 LIMIT 1")) {
    const email = process.env.GRBZ_ADMIN_EMAIL || 'admin@grbz.local';
    const password = process.env.GRBZ_ADMIN_PASSWORD || generatePassword();
    db.tx(() => {
      db.insert('users', {
        employee_no: fmtPersonnelNo(db.nextNumber('personnel')), name: 'Administrator', email, role: 'admin',
        password_hash: hashPassword(password), must_change_password: 1, active: 1,
      });
      const a = db.get("SELECT id FROM users WHERE email = ?", email);
      if (!db.byId('employee_profiles', a.id)) db.insert('employee_profiles', { id: a.id, user_id: a.id, status: 'aktiv', pay_type: 'keine' });
    });
    db.audit(null, 'ersteinrichtung.admin', 'users', null, { email });
    if (!process.env.GRBZ_ADMIN_PASSWORD && dataDir) {
      const file = path.join(dataDir, 'ERSTZUGANG.txt');
      fs.writeFileSync(file, `GRBZ Facility Management System – Erstzugang\n\nE-Mail:   ${email}\nPasswort: ${password}\n\nDas Passwort muss bei der ersten Anmeldung geändert werden.\nDiese Datei nach der Ersteinrichtung löschen!\n`, { mode: 0o600 });
      // Einmalpasswort auch im Startprotokoll ausgeben (z. B. Render-Logs), da auf
      // gehosteten Servern die Datei oft nicht zugänglich ist. Muss beim ersten Login geändert werden.
      log(`\n  Administratorzugang angelegt\n  E-Mail:   ${email}\n  Passwort: ${password}\n  (Einmalpasswort – muss bei der ersten Anmeldung geändert werden; auch gespeichert in ${file})\n`);
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
