// Routing-Tabelle (Hash-Routing → funktioniert offline ohne Server-Unterstützung).
import { dashboardView } from './views/dashboard.js';
import { customersList, customerDetail, customerForm } from './views/customers.js';
import { objectsList, objectDetail, objectForm } from './views/objects.js';
import { scanView, qTokenView, qrManagement } from './views/qr.js';
import { ordersList, orderDetail, orderForm, recurrenceList, recurrenceForm } from './views/orders.js';
import { checklistsList, checklistEditor } from './views/checklists.js';
import { timeView, timeTeamView } from './views/time.js';
import { staffList, staffDetail, staffForm } from './views/staff.js';
import { materialsList, materialDetail, materialForm } from './views/materials.js';
import { machinesList, machineDetail, machineForm } from './views/machines.js';
import { qualityView, defectForm, defectDetail, inspectionForm, inspectionDetail } from './views/quality.js';
import { winterView, winterNew, winterDetail } from './views/winter.js';
import { documentsView } from './views/documents.js';
import { reportsView } from './views/reports.js';
import { menuView, syncView, accountView, settingsView, auditView } from './views/admin.js';
import { portalView, portalAccount } from './views/portal.js';
import { planningView, absencesView, costsView, rulesView, hrSettingsView, rolesView } from './views/personnel.js';

const ID = '([0-9a-fA-F-]{36})';
const r = (pattern, view, perm, opts = {}) => ({ re: new RegExp('^' + pattern + '$'), view, perm, ...opts });

export const routes = [
  r('/', dashboardView, 'dashboard.view'),
  r('/menu', menuView),
  r('/scan', scanView, 'qr.scan', { live: false }),
  r('/q/([A-Za-z0-9_-]+)', qTokenView, null, { live: false }),
  r('/kunden', customersList, 'customers.read'),
  r('/kunden/neu', customerForm, 'customers.write', { live: false }),
  r(`/kunden/${ID}/bearbeiten`, customerForm, 'customers.write', { live: false }),
  r(`/kunden/${ID}`, customerDetail, 'customers.read'),
  r('/objekte', objectsList, 'objects.read'),
  r('/objekte/neu', objectForm, 'objects.write', { live: false }),
  r(`/objekte/${ID}/bearbeiten`, objectForm, 'objects.write', { live: false }),
  r(`/objekte/${ID}`, objectDetail, 'objects.read'),
  r('/qr', qrManagement, 'qr.manage'),
  r('/auftraege', ordersList, 'orders.read'),
  r('/auftraege/neu', orderForm, 'orders.write', { live: false }),
  r(`/auftraege/${ID}/bearbeiten`, orderForm, 'orders.write', { live: false }),
  r(`/auftraege/${ID}`, orderDetail, 'orders.read'),
  r('/serien', recurrenceList, 'orders.write'),
  r('/serien/neu', recurrenceForm, 'orders.write', { live: false }),
  r(`/serien/${ID}`, recurrenceForm, 'orders.write', { live: false }),
  r('/checklisten', checklistsList, 'checklists.manage'),
  r('/checklisten/neu', checklistEditor, 'checklists.manage', { live: false }),
  r(`/checklisten/${ID}`, checklistEditor, 'checklists.manage', { live: false }),
  r('/zeit', timeView, 'time.own'),
  r('/zeit/uebersicht', timeTeamView, 'time.all'),
  r('/mitarbeiter', staffList, ['users.read', 'hr.read']),
  r('/mitarbeiter/neu', staffForm, 'users.manage', { live: false }),
  r(`/mitarbeiter/${ID}/bearbeiten`, staffForm, ['users.manage', 'hr.manage'], { live: false }),
  r(`/mitarbeiter/${ID}`, staffDetail, ['users.read', 'hr.read']),
  r('/dienstplan', planningView, ['planning.manage', 'shifts.own']),
  r('/abwesenheiten', absencesView, ['absences.manage', 'absences.request']),
  r('/personalkosten', costsView, 'hr.salary', { live: false }),
  r('/lohnmodelle', rulesView, 'hr.rules'),
  r('/personal/einstellungen', hrSettingsView, 'hr.manage'),
  r('/rollen', rolesView, 'roles.manage'),
  r('/material', materialsList, 'materials.read'),
  r('/material/neu', materialForm, 'materials.write', { live: false }),
  r(`/material/${ID}/bearbeiten`, materialForm, 'materials.write', { live: false }),
  r(`/material/${ID}`, materialDetail, 'materials.read'),
  r('/maschinen', machinesList, 'machines.read'),
  r('/maschinen/neu', machineForm, 'machines.write', { live: false }),
  r(`/maschinen/${ID}/bearbeiten`, machineForm, 'machines.write', { live: false }),
  r(`/maschinen/${ID}`, machineDetail, 'machines.read'),
  r('/qualitaet', qualityView, ['quality.read', 'defects.report']),
  r('/maengel/neu', defectForm, 'defects.report', { live: false }),
  r(`/maengel/${ID}/bearbeiten`, defectForm, 'quality.write', { live: false }),
  r(`/maengel/${ID}`, defectDetail, ['quality.read', 'defects.report']),
  r('/kontrolle/neu', inspectionForm, 'quality.write', { live: false }),
  r(`/kontrolle/${ID}`, inspectionDetail, 'quality.read'),
  r('/winter', winterView, 'winter.read'),
  r('/winter/einsatz/neu', winterNew, ['winter.execute', 'winter.write'], { live: false }),
  r(`/winter/einsatz/${ID}`, winterDetail, 'winter.read'),
  r('/dokumente', documentsView, 'documents.read'),
  r('/berichte', reportsView, 'reports.create', { live: false }),
  r('/einstellungen', settingsView, 'settings.manage', { live: false }),
  r('/protokoll', auditView, 'audit.read', { live: false }),
  r('/sync', syncView),
  r('/konto', accountView, null, { live: false }),
  r('/portal', portalView, null, { live: false }),
  r('/portal/konto', portalAccount, null, { live: false }),
];
