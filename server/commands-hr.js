// Befehle der Personalverwaltung (Personalakte, Abwesenheiten, Dienstplan, Rollen).
import { AppError, nowIso, uuid } from './db.js';
import { assertPerm } from './auth.js';
import { commands, bad, req, requireRef, checkVersion, touchOrderTree } from './commands.js';
import { can, ROLE_PERMISSIONS, EMPLOYEE_STATUS, PAY_TYPES, ABSENCE_KINDS, SHIFT_STATUS } from '../shared/constants.js';
import { ABSENCE_RULES, absenceWorkdays } from '../shared/hr.js';
import { addDays, todayYmd } from '../shared/dates.js';

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const HM = /^\d{2}:\d{2}$/;
const toMin = (hm) => +hm.slice(0, 2) * 60 + +hm.slice(3, 5);

/** Kontext zur Soll-Zeit-Berechnung eines Mitarbeiters */
export function sollContext(db, userId) {
  const u = db.byId('users', userId);
  const profile = db.byId('employee_profiles', userId);
  const model = profile?.work_model_id ? db.byId('work_models', profile.work_model_id) : null;
  const holidays = new Set(db.all('SELECT date FROM holidays WHERE deleted = 0').map((r) => r.date));
  return { model, profile, entryDate: u?.entry_date || null, exitDate: profile?.exit_date || null, holidays };
}

function vacationInfo(db, userId, year) {
  const p = db.byId('employee_profiles', userId);
  const entitlement = (p?.vacation_days || 0) + (p?.vacation_carryover || 0);
  const taken = db.get(`SELECT COALESCE(SUM(days),0) d FROM absences WHERE user_id = ? AND kind = 'urlaub' AND status IN ('genehmigt','beantragt') AND deleted = 0 AND substr(start_date,1,4) = ?`, userId, String(year)).d;
  return { entitlement, taken, remaining: entitlement - taken };
}

function cleanProfile(db, ctx, data, existing) {
  const out = {};
  const fields = ['birth_date', 'mobile', 'emergency_contact', 'exit_date', 'status', 'employment_type_id', 'position_id', 'department_id', 'supervisor_id',
    'work_model_id', 'weekly_hours', 'vacation_days', 'vacation_carryover', 'contract_note', 'hr_notes'];
  const pay = ['pay_type', 'hourly_rate', 'monthly_salary'];
  for (const k of [...fields, ...pay]) {
    if (!(k in data)) continue;
    let v = data[k];
    if (typeof v === 'string') v = v.trim();
    if (v === '' || v === undefined) v = null;
    out[k] = v;
  }
  if (pay.some((k) => k in out && String(out[k] ?? '') !== String(existing?.[k] ?? ''))) assertPerm(ctx.user, 'hr.salary');
  for (const k of ['birth_date', 'exit_date']) if (out[k] && !YMD.test(out[k])) throw bad('Ungültiges Datum.');
  if (out.status && !EMPLOYEE_STATUS[out.status]) throw bad('Ungültiger Status.');
  if (out.pay_type && !PAY_TYPES[out.pay_type]) throw bad('Ungültige Vergütungsart.');
  for (const k of ['weekly_hours', 'vacation_days', 'vacation_carryover', 'hourly_rate', 'monthly_salary']) {
    if (out[k] === null || out[k] === undefined) continue;
    const n = Number(String(out[k]).replace(',', '.'));
    if (!isFinite(n) || (n < 0 && k !== 'vacation_carryover')) throw bad('Bitte gültige, nicht negative Zahlen angeben.');
    out[k] = n;
  }
  for (const [k, t, l] of [['employment_type_id', 'employment_types', 'Die Beschäftigungsart'], ['position_id', 'positions', 'Die Position'], ['department_id', 'departments', 'Die Abteilung'], ['supervisor_id', 'users', 'Der Vorgesetzte'], ['work_model_id', 'work_models', 'Das Arbeitszeitmodell']]) {
    if (out[k]) requireRef(db, t, out[k], l);
  }
  return out;
}

function shiftInterval(s) {
  const a = toMin(s.start_time); let b = toMin(s.end_time);
  if (b <= a) b += 1440; // über Mitternacht
  return [a, b];
}

Object.assign(commands, {
  // ---------- Personalakte ----------
  'employee.saveProfile'(ctx, { user_id, data = {}, base_version }) {
    const { db, user } = ctx;
    assertPerm(user, 'hr.manage');
    const u = db.byId('users', user_id);
    if (!u || u.deleted || u.role === 'kunde') throw bad('Mitarbeiter nicht gefunden.');
    const ex = db.byId('employee_profiles', user_id);
    const clean = cleanProfile(db, ctx, data, ex);
    if (clean.supervisor_id === user_id) throw bad('Ein Mitarbeiter kann nicht sein eigener Vorgesetzter sein.');
    if (clean.exit_date && u.entry_date && clean.exit_date < u.entry_date) throw bad('Der Austritt liegt vor dem Eintritt.');
    let row;
    if (ex) { checkVersion(ex, base_version); row = db.update('employee_profiles', ex.id, clean); }
    else row = db.insert('employee_profiles', { id: user_id, user_id, status: 'aktiv', pay_type: 'keine', ...clean });
    db.audit(user.id, 'personal.akte_geaendert', 'users', user_id, { felder: Object.keys(clean) });
    return { row };
  },

  // ---------- Abwesenheiten ----------
  'absence.save'(ctx, p) {
    const { db, user } = ctx;
    const userId = p.user_id || user.id;
    const manager = can(user, 'absences.manage');
    if (userId !== user.id && !manager) throw new AppError(403, 'Sie dürfen nur eigene Abwesenheiten beantragen.');
    if (!manager) assertPerm(user, 'absences.request');
    requireRef(db, 'users', userId, 'Der Mitarbeiter');
    if (!ABSENCE_KINDS[p.kind]) throw bad('Bitte die Art der Abwesenheit wählen.');
    if (!YMD.test(p.start_date || '') || !YMD.test(p.end_date || '')) throw bad('Bitte Beginn und Ende angeben.');
    if (p.end_date < p.start_date) throw bad('Das Ende liegt vor dem Beginn.');
    const halfDay = p.half_day && p.start_date === p.end_date ? 1 : 0;
    const ex = p.id ? db.byId('absences', p.id) : null;
    if (ex && !manager && (ex.user_id !== user.id || ex.status !== 'beantragt')) throw new AppError(403, 'Nur offene, eigene Anträge können geändert werden.');
    const overlap = db.get(`SELECT id FROM absences WHERE user_id = ? AND deleted = 0 AND status IN ('beantragt','genehmigt') AND id <> ? AND start_date <= ? AND end_date >= ?`, userId, p.id || '', p.end_date, p.start_date);
    if (overlap) throw bad('In diesem Zeitraum ist bereits eine Abwesenheit eingetragen.');
    const days = absenceWorkdays(p.start_date, p.end_date, sollContext(db, userId), !!halfDay);
    const data = {
      user_id: userId, kind: p.kind, start_date: p.start_date, end_date: p.end_date, half_day: halfDay, days,
      paid: manager && p.paid !== undefined ? (p.paid ? 1 : 0) : ABSENCE_RULES[p.kind].paidDefault ? 1 : 0,
      certificate: p.certificate ? 1 : 0, note: p.note ? String(p.note).slice(0, 1000) : null,
      substitute_user_id: manager ? p.substitute_user_id || null : ex?.substitute_user_id || null,
    };
    if (data.substitute_user_id) requireRef(db, 'users', data.substitute_user_id, 'Die Vertretung');
    let row;
    if (ex) { checkVersion(ex, p.base_version); row = db.update('absences', ex.id, data); }
    else {
      const status = manager ? 'genehmigt' : 'beantragt';
      row = db.insert('absences', { id: p.id || uuid(), ...data, status, requested_by: user.id, decided_by: manager ? user.id : null, decided_at: manager ? nowIso() : null });
    }
    db.audit(user.id, ex ? 'abwesenheit.geaendert' : row.status === 'genehmigt' ? 'abwesenheit.erfasst' : 'abwesenheit.beantragt', 'absences', row.id, { art: p.kind, von: p.start_date, bis: p.end_date });
    const warnings = [];
    if (p.kind === 'urlaub') {
      const v = vacationInfo(db, userId, p.start_date.slice(0, 4));
      if (v.entitlement && v.remaining < 0) warnings.push(`Der Urlaubsanspruch ist um ${-v.remaining} Tag(e) überschritten.`);
    }
    const shifts = db.get(`SELECT COUNT(*) c FROM shifts WHERE user_id = ? AND deleted = 0 AND status <> 'abgesagt' AND date BETWEEN ? AND ?`, userId, p.start_date, p.end_date).c;
    if (shifts) warnings.push(`${shifts} geplante Schicht(en) betroffen – bitte Vertretung planen.`);
    return { row, warnings };
  },

  'absence.decide'(ctx, { id, approve, note }) {
    const { db, user } = ctx;
    assertPerm(user, 'absences.manage');
    const a = req(db.byId('absences', id), 'Abwesenheit nicht gefunden.');
    if (a.status !== 'beantragt') throw bad('Dieser Antrag wurde bereits entschieden.');
    const row = db.update('absences', id, { status: approve ? 'genehmigt' : 'abgelehnt', decided_by: user.id, decided_at: nowIso(), decision_note: note || null });
    db.audit(user.id, approve ? 'abwesenheit.genehmigt' : 'abwesenheit.abgelehnt', 'absences', id);
    return { row };
  },

  'absence.cancel'(ctx, { id }) {
    const { db, user } = ctx;
    const a = req(db.byId('absences', id), 'Abwesenheit nicht gefunden.');
    if (!can(user, 'absences.manage') && !(a.user_id === user.id && a.status === 'beantragt')) throw new AppError(403, 'Nur offene, eigene Anträge können zurückgezogen werden.');
    const row = db.update('absences', id, { status: 'storniert' });
    db.audit(user.id, 'abwesenheit.storniert', 'absences', id);
    return { row };
  },

  // ---------- Dienst- und Schichtplanung ----------
  'shift.save'(ctx, p) {
    const { db, user } = ctx;
    assertPerm(user, 'planning.manage');
    requireRef(db, 'users', req(p.user_id, 'Bitte einen Mitarbeiter wählen.'), 'Der Mitarbeiter');
    if (p.object_id) requireRef(db, 'objects', p.object_id, 'Das Objekt');
    if (!YMD.test(p.date || '')) throw bad('Bitte ein Datum angeben.');
    if (!HM.test(p.start_time || '') || !HM.test(p.end_time || '')) throw bad('Bitte Beginn und Ende (HH:MM) angeben.');
    if (p.start_time === p.end_time) throw bad('Beginn und Ende dürfen nicht gleich sein.');
    if (p.status && !SHIFT_STATUS[p.status]) throw bad('Ungültiger Status.');
    const brk = Math.max(0, Math.round(+p.break_minutes || 0));
    const [a, b] = shiftInterval(p);
    if (brk >= b - a) throw bad('Die Pause ist länger als die Schicht.');
    for (const o of db.all(`SELECT * FROM shifts WHERE user_id = ? AND date = ? AND deleted = 0 AND status <> 'abgesagt' AND id <> ?`, p.user_id, p.date, p.id || '')) {
      const [c, d] = shiftInterval(o);
      if (a < d && c < b) throw bad(`Überschneidung mit einer anderen Schicht (${o.start_time}–${o.end_time}).`);
    }
    const data = { user_id: p.user_id, object_id: p.object_id || null, date: p.date, start_time: p.start_time, end_time: p.end_time, break_minutes: brk, status: p.status || 'geplant', note: p.note || null };
    const ex = p.id ? db.byId('shifts', p.id) : null;
    const row = ex ? db.update('shifts', ex.id, data) : db.insert('shifts', { id: p.id || uuid(), ...data });
    const warnings = [];
    const abs = db.get(`SELECT kind FROM absences WHERE user_id = ? AND deleted = 0 AND status = 'genehmigt' AND start_date <= ? AND end_date >= ?`, p.user_id, p.date, p.date);
    if (abs) warnings.push(`Achtung: Der Mitarbeiter ist an diesem Tag abwesend (${ABSENCE_KINDS[abs.kind]}).`);
    return { row, warnings };
  },

  'shift.delete'(ctx, { id }) {
    assertPerm(ctx.user, 'planning.manage');
    ctx.db.update('shifts', id, { deleted: 1 });
    return {};
  },

  'shift.copyWeek'(ctx, { from_monday, to_monday }) {
    const { db, user } = ctx;
    assertPerm(user, 'planning.manage');
    if (!YMD.test(from_monday || '') || !YMD.test(to_monday || '')) throw bad('Ungültige Woche.');
    let created = 0; let skipped = 0;
    for (let i = 0; i < 7; i++) {
      const src = addDays(from_monday, i); const dst = addDays(to_monday, i);
      for (const s of db.all(`SELECT * FROM shifts WHERE date = ? AND deleted = 0 AND status <> 'abgesagt'`, src)) {
        if (db.get('SELECT id FROM shifts WHERE user_id = ? AND date = ? AND start_time = ? AND deleted = 0', s.user_id, dst, s.start_time)) { skipped++; continue; }
        db.insert('shifts', { user_id: s.user_id, object_id: s.object_id, date: dst, start_time: s.start_time, end_time: s.end_time, break_minutes: s.break_minutes, status: 'geplant', note: s.note });
        created++;
      }
    }
    db.audit(user.id, 'dienstplan.kopiert', 'shifts', null, { von: from_monday, nach: to_monday, anzahl: created });
    return { created, skipped };
  },

  // ---------- Vertretung ----------
  'substitute.assign'(ctx, { items = [], absence_id }) {
    const { db, user } = ctx;
    let n = 0;
    for (const it of items) {
      requireRef(db, 'users', req(it.user_id, 'Bitte eine Vertretung wählen.'), 'Die Vertretung');
      if (it.type === 'shift') {
        assertPerm(user, 'planning.manage');
        const s = req(db.byId('shifts', it.id), 'Schicht nicht gefunden.');
        db.update('shifts', s.id, { user_id: it.user_id, replaces_user_id: s.replaces_user_id || s.user_id });
        n++;
      } else if (it.type === 'order') {
        commands['order.save'](ctx, { id: it.id, data: { assigned_user_id: it.user_id } });
        touchOrderTree(db, it.id);
        n++;
      }
    }
    if (absence_id && items[0]) db.update('absences', absence_id, { substitute_user_id: items[0].user_id });
    db.audit(user.id, 'vertretung.zugewiesen', 'absences', absence_id || null, { anzahl: n });
    return { assigned: n };
  },

  'object.setRevenue'(ctx, { object_id, monthly_revenue }) {
    const { db, user } = ctx;
    assertPerm(user, 'hr.salary');
    requireRef(db, 'objects', object_id, 'Das Objekt');
    const v = monthly_revenue === null || monthly_revenue === '' || monthly_revenue === undefined ? null : Number(String(monthly_revenue).replace(',', '.'));
    if (v !== null && (!isFinite(v) || v < 0)) throw bad('Bitte einen gültigen Umsatz angeben.');
    db.update('objects', object_id, { monthly_revenue: v });
    db.audit(user.id, 'objekt.umsatz', 'objects', object_id);
    return {};
  },

  // ---------- Rollen & Rechte ----------
  'role.save'(ctx, { id, data = {}, base_version }) {
    const { db, user } = ctx;
    assertPerm(user, 'roles.manage');
    const ex = id ? db.byId('roles', id) : null;
    if (ex?.role_key === 'admin') throw bad('Die Administratorrolle hat immer alle Rechte und kann nicht geändert werden.');
    if (ex?.role_key === 'kunde') throw bad('Die Kundenportal-Rolle kann nicht geändert werden.');
    const name = String(data.name ?? ex?.name ?? '').trim();
    if (!name) throw bad('Bitte einen Namen angeben.');
    const perms = Array.isArray(data.permissions) ? [...new Set(data.permissions)] : ex ? JSON.parse(ex.permissions) : [];
    const unknown = perms.filter((p) => !ROLE_PERMISSIONS.admin.includes(p));
    if (unknown.length) throw bad('Unbekannte Berechtigung: ' + unknown.join(', '));
    if (user.role !== 'admin') {
      const extra = perms.filter((p) => !can(user, p));
      if (extra.length) throw new AppError(403, 'Sie können keine Rechte vergeben, die Sie selbst nicht besitzen.');
    }
    const row = { name: name.slice(0, 60), permissions: JSON.stringify(perms), scoped: data.scoped ? 1 : 0, active: data.active === undefined ? 1 : data.active ? 1 : 0, description: data.description || null, sort: +data.sort || ex?.sort || 100 };
    let saved;
    if (ex) { checkVersion(ex, base_version); saved = db.update('roles', ex.id, row); }
    else {
      let key = name.toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 30) || 'rolle';
      let k = key; let i = 2;
      while (db.get('SELECT id FROM roles WHERE role_key = ?', k)) k = `${key}_${i++}`;
      saved = db.insert('roles', { id: id || uuid(), role_key: k, ...row, system: 0 });
    }
    // Sitzungen bleiben gültig; neue Rechte gelten ab der nächsten Anfrage.
    db.audit(user.id, ex ? 'rolle.geaendert' : 'rolle.erstellt', 'roles', saved.id, { name: saved.name, rechte: perms.length });
    return { row: saved };
  },

  'role.delete'(ctx, { id }) {
    const { db, user } = ctx;
    assertPerm(user, 'roles.manage');
    const r = req(db.byId('roles', id), 'Rolle nicht gefunden.');
    if (r.system) throw bad('Standardrollen können nicht gelöscht werden (deaktivieren ist möglich).');
    const n = db.get('SELECT COUNT(*) c FROM users WHERE role = ? AND deleted = 0', r.role_key).c;
    if (n) throw bad(`Die Rolle ist noch ${n} Benutzer(n) zugewiesen.`);
    db.update('roles', id, { deleted: 1 });
    db.audit(user.id, 'rolle.geloescht', 'roles', id, { name: r.name });
    return {};
  },
});

export { vacationInfo, todayYmd };
