// Zeilenbasierte Zugriffsrechte. Jede Datenausgabe (Sync, Berichte, Dateien)
// läuft über diese Regeln – der Client wird nie als vertrauenswürdig betrachtet.
import { can, SCOPED_ROLES } from '../shared/constants.js';
import { AppError } from './db.js';

const MY_OBJECTS = `(SELECT object_id FROM object_employees WHERE user_id = $uid AND deleted = 0
  UNION SELECT object_id FROM orders WHERE assigned_user_id = $uid AND deleted = 0)`;
const MY_ORDERS = `(SELECT id FROM orders WHERE assigned_user_id = $uid AND deleted = 0)`;

const USER_PUBLIC = ['id', 'name', 'role', 'employee_no', 'active', 'created_at', 'updated_at', 'version', 'seq', 'deleted'];
const USER_FULL = ['id', 'employee_no', 'name', 'email', 'phone', 'street', 'zip', 'city', 'entry_date', 'role', 'customer_id',
  'active', 'last_login_at', 'notes', 'created_at', 'updated_at', 'version', 'seq', 'deleted'];
const CUSTOMER_PUBLIC = ['id', 'customer_no', 'company_name', 'created_at', 'updated_at', 'version', 'seq', 'deleted'];

export const isScoped = (user) => (user.scoped !== undefined ? !!user.scoped : SCOPED_ROLES.includes(user.role));

/**
 * Liefert {cols, where} für eine Tabelle oder null, wenn kein Zugriff besteht.
 * where ist ein SQL-Fragment mit dem benannten Parameter $uid.
 */
export function tableScope(user, table) {
  const scoped = isScoped(user);
  const all = { cols: '*', where: '1=1' };
  switch (table) {
    case 'users':
      return { cols: (can(user, 'users.read') ? USER_FULL : USER_PUBLIC).join(','), where: '1=1' };
    case 'customers':
      if (can(user, 'customers.read')) return all;
      if (can(user, 'objects.read')) return { cols: CUSTOMER_PUBLIC.join(','), where: `id IN (SELECT customer_id FROM objects WHERE id IN ${MY_OBJECTS})` };
      return null;
    case 'contact_history':
    case 'customer_services':
      return can(user, 'customers.read') ? all : null;
    case 'services':
      return all;
    case 'objects':
      if (!can(user, 'objects.read')) return null;
      if (scoped) return { cols: '*', where: `id IN ${MY_OBJECTS}`, hide: ['contract_info', 'monthly_revenue'] };
      return { ...all, hide: [...(can(user, 'customers.read') ? [] : ['contract_info']), ...(can(user, 'hr.salary') ? [] : ['monthly_revenue'])] };
    case 'object_employees':
      if (!can(user, 'objects.read')) return null;
      return scoped ? { cols: '*', where: 'user_id = $uid' } : all;
    case 'qr_codes':
      if (!can(user, 'qr.scan') && !can(user, 'qr.manage')) return null;
      return scoped ? { cols: '*', where: `(object_id IS NULL OR object_id IN ${MY_OBJECTS})` } : all;
    case 'checklist_templates':
    case 'checklist_template_items':
      return can(user, 'orders.read') ? all : null;
    case 'recurrences':
      return can(user, 'orders.write') ? all : null;
    case 'orders':
      if (!can(user, 'orders.read')) return null;
      return scoped ? { cols: '*', where: 'assigned_user_id = $uid' } : all;
    case 'order_checklist_items':
      if (!can(user, 'orders.read')) return null;
      return scoped ? { cols: '*', where: `order_id IN ${MY_ORDERS}` } : all;
    case 'photos':
      if (!can(user, 'photos.read')) return null;
      return scoped ? { cols: '*', where: `(user_id = $uid OR order_id IN ${MY_ORDERS})` } : all;
    case 'time_entries':
      return can(user, 'time.all') ? all : can(user, 'time.own') ? { cols: '*', where: 'user_id = $uid' } : null;
    case 'time_corrections':
      return can(user, 'time.all') ? all : can(user, 'time.own')
        ? { cols: '*', where: 'entry_id IN (SELECT id FROM time_entries WHERE user_id = $uid)' } : null;
    case 'materials':
      return can(user, 'materials.read') ? all : null;
    case 'stock_movements':
      return can(user, 'materials.write') ? all : can(user, 'materials.consume') ? { cols: '*', where: 'user_id = $uid' } : null;
    case 'machines':
    case 'machine_events':
      return can(user, 'machines.read') ? all : null;
    case 'inspections':
    case 'inspection_items':
      return can(user, 'quality.read') ? all : null;
    case 'defects':
      if (can(user, 'quality.read')) return all;
      return can(user, 'defects.report') ? { cols: '*', where: '(reported_by = $uid OR responsible_user_id = $uid)' } : null;
    case 'defect_log':
      if (can(user, 'quality.read')) return all;
      return can(user, 'defects.report')
        ? { cols: '*', where: 'defect_id IN (SELECT id FROM defects WHERE reported_by = $uid OR responsible_user_id = $uid)' } : null;
    case 'winter_areas':
      if (!can(user, 'winter.read')) return null;
      return scoped ? { cols: '*', where: `object_id IN ${MY_OBJECTS}` } : all;
    case 'winter_standby':
    case 'winter_operations':
      if (can(user, 'winter.write')) return all;
      return can(user, 'winter.read') ? { cols: '*', where: 'user_id = $uid' } : null;
    case 'documents':
      // Personaldokumente (user_id gesetzt) nur mit Recht hr.read
      if (can(user, 'documents.read') && can(user, 'hr.read')) return all;
      if (can(user, 'documents.read')) return { cols: '*', where: 'user_id IS NULL' };
      if (can(user, 'hr.read')) return { cols: '*', where: 'user_id IS NOT NULL' };
      return null;
    // ---------- Personalverwaltung ----------
    case 'roles':
    case 'employment_types':
    case 'positions':
    case 'departments':
    case 'work_models':
    case 'holidays':
      return all;
    case 'employee_profiles': {
      const pay = ['pay_type', 'hourly_rate', 'monthly_salary'];
      if (can(user, 'hr.read')) return { cols: '*', where: '1=1', hide: can(user, 'hr.salary') ? [] : pay };
      return { cols: '*', where: 'user_id = $uid', hide: pay };
    }
    case 'absences':
      if (can(user, 'absences.manage') || can(user, 'hr.read') || can(user, 'planning.manage')) return all;
      return { cols: '*', where: 'user_id = $uid' };
    case 'shifts':
      if (can(user, 'planning.manage') || can(user, 'hr.read')) return all;
      return can(user, 'shifts.own') ? { cols: '*', where: '(user_id = $uid OR replaces_user_id = $uid)' } : null;
    case 'pay_rules':
      return can(user, 'hr.rules') || can(user, 'hr.salary') ? all : null;
    case 'pay_adjustments':
    case 'object_revenues':
      return can(user, 'hr.salary') ? all : null;
    case 'mileage_logs':
    case 'overtime_adjustments':
      return can(user, 'hr.read') ? all : { cols: '*', where: 'user_id = $uid' };
    case 'scans':
      return can(user, 'qr.manage') ? { cols: '*', where: "scanned_at > datetime('now','-90 days')" } : { cols: '*', where: 'user_id = $uid' };
    default:
      return null;
  }
}

export function selectScoped(db, user, table, extraWhere = '1=1', extraParams = {}) {
  const sc = tableScope(user, table);
  if (!sc) return [];
  const sql = `SELECT ${sc.cols} FROM ${table} WHERE (${sc.where}) AND (${extraWhere})`;
  const rows = db.raw.prepare(sql).all(named(sql, { uid: user.id, ...extraParams }));
  if (sc.hide?.length) for (const r of rows) for (const h of sc.hide) delete r[h];
  return rows;
}

export function canSee(db, user, table, id) {
  if (!id) return false;
  return selectScoped(db, user, table, 'id = $id', { id }).length > 0;
}

export function assertSee(db, user, table, id, msg = 'Datensatz nicht gefunden oder kein Zugriff.') {
  if (!canSee(db, user, table, id)) throw new AppError(404, msg);
}

// node:sqlite lehnt unbekannte benannte Parameter ab – nur verwendete übergeben.
export function named(sql, params) {
  const out = {};
  for (const [k, v] of Object.entries(params)) if (sql.includes('$' + k)) out[k] = v;
  return out;
}
