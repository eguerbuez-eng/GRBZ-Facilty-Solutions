// Personalverwaltung: Mitarbeiterliste, Personalakte, Anlage/Bearbeitung.
import { h, ic, card, empty, row, badge, pageHead, btn, kv, toast, errorToast, modal, buildForm, searchBox, matches, tabs, formDialog, confirmDialog, openUrl } from '../ui.js';
import * as store from '../store.js';
import { api } from '../api.js';
import { may, refOptions, orderStatusBadge, phoneLink, mailLink, user, roleLabel, userLabel, historyCard } from './common.js';
import { EMPLOYEE_STATUS, PAY_TYPES, ABSENCE_KINDS, ABSENCE_STATUS, PERMISSION_LABELS } from '/shared/constants.js';
import { ENTITIES } from '/shared/entities.js';
import { DISCLAIMER } from '/shared/hr.js';
import { fmtDate, fmtDateTime, todayYmd, fmtMinutes, fmtMoney, fmtNumber, fmtMonth } from '/shared/dates.js';
import { documentsCard } from './documents.js';
import { absenceDialog, absenceRow } from './personnel.js';
import { go, refresh } from '../app.js';

const opt = (o) => Object.entries(o).map(([value, label]) => ({ value, label }));
const nameOf = (t, id) => (id ? store.get(t, id)?.name || '–' : null);
const profileOf = (id) => store.get('employee_profiles', id) || {};
const statusKind = (s) => ({ aktiv: 'ok', probezeit: 'info', beurlaubt: 'warn', elternzeit: 'warn', langzeitkrank: 'warn', ausgeschieden: '', inaktiv: '' })[s] || '';

const st = { q: '', status: 'aktiv', position: '', type: '' };
export function staffList() {
  const el = h('div', null, pageHead('Mitarbeiter', { sub: 'Personalakten, Beschäftigung, Rollen und Rechte', actions: [
    may('roles.manage') ? btn('Rollen & Rechte', { icon: 'key', href: '#/rollen' }) : null,
    may('hr.manage') ? btn('Personal-Einstellungen', { icon: 'settings', href: '#/personal/einstellungen' }) : null,
    may('users.manage') ? btn('Mitarbeiter anlegen', { icon: 'plus', cls: 'primary', href: '#/mitarbeiter/neu' }) : null,
  ].filter(Boolean) }));
  const box = h('div');
  const draw = () => {
    const rows = store.all('users', (u) => u.role !== 'kunde' && matches(u, ['name', 'email', 'employee_no'], st.q)).filter((u) => {
      const p = profileOf(u.id);
      const status = p.status || (u.active ? 'aktiv' : 'inaktiv');
      if (st.status === 'aktiv' && (['ausgeschieden', 'inaktiv'].includes(status) || !u.active)) return false;
      if (st.status === 'ehemalig' && !['ausgeschieden', 'inaktiv'].includes(status) && u.active) return false;
      return (!st.position || p.position_id === st.position) && (!st.type || p.employment_type_id === st.type);
    }).sort((a, b) => (a.employee_no || '').localeCompare(b.employee_no || ''));
    box.replaceChildren(card(null, rows.length ? h('div', { class: 'list' }, rows.map((u) => {
      const p = profileOf(u.id);
      return row({
        href: `#/mitarbeiter/${u.id}`, lead: h('div', { class: 'lead' }, u.name.split(' ').map((x) => x[0]).join('').slice(0, 2)), title: u.name,
        meta: [u.employee_no, nameOf('positions', p.position_id), nameOf('employment_types', p.employment_type_id), roleLabel(u.role)].filter(Boolean).join(' · '),
        right: p.status ? badge(EMPLOYEE_STATUS[p.status], statusKind(p.status)) : u.active ? null : badge('deaktiviert', 'bad'),
      });
    })) : empty('Keine Mitarbeiter gefunden.', 'users')));
  };
  el.append(h('div', { class: 'toolbar' }, searchBox('Suchen (Name, Personalnr., E-Mail)', (q) => { st.q = q; draw(); }, st.q),
    h('select', { style: { width: 'auto' }, onchange: (e) => { st.status = e.target.value; draw(); } }, [['aktiv', 'Aktive'], ['ehemalig', 'Ausgeschieden/Inaktiv'], ['alle', 'Alle']].map(([v, l]) => h('option', { value: v, selected: st.status === v }, l))),
    h('select', { style: { width: 'auto' }, onchange: (e) => { st.position = e.target.value; draw(); } }, h('option', { value: '' }, 'Alle Positionen'), refOptions('positions').map((o) => h('option', { value: o.value, selected: st.position === o.value }, o.label))),
    h('select', { style: { width: 'auto' }, onchange: (e) => { st.type = e.target.value; draw(); } }, h('option', { value: '' }, 'Alle Beschäftigungsarten'), refOptions('employment_types').map((o) => h('option', { value: o.value, selected: st.type === o.value }, o.label)))));
  el.append(box);
  draw();
  return el;
}

// ---------- Anlegen / Bearbeiten ----------
function accountFields(ex) {
  const me = user();
  const roles = refOptions('roles', (r) => me.role === 'admin' || !['admin', 'geschaeftsfuehrer'].includes(r.role_key));
  return [
    { name: 'name', label: 'Vor- und Nachname', type: 'text', required: true },
    { name: 'email', label: 'E-Mail (Anmeldename)', type: 'email', required: true, half: true },
    { name: 'phone', label: 'Telefon', type: 'tel', half: true },
    { name: 'role', label: 'Rolle (Zugang & Rechte)', type: 'select', required: true, options: roles, half: true, readonly: ex && ex.id === me.id },
    { name: 'entry_date', label: 'Eintrittsdatum', type: 'date', half: true },
    { name: 'street', label: 'Straße', type: 'text' },
    { name: 'zip', label: 'PLZ', type: 'text', half: true },
    { name: 'city', label: 'Ort', type: 'text', half: true },
    { name: 'customer_id', label: 'Kunde (nur bei Rolle „Kunde (Portal)“)', type: 'ref', refOptions: refOptions('customers') },
    { name: 'notes', label: 'Notizen', type: 'textarea', rows: 2 },
  ];
}
function profileFields() {
  return [
    { name: 'status', label: 'Mitarbeiterstatus', type: 'select', required: true, options: opt(EMPLOYEE_STATUS), default: 'aktiv', half: true },
    { name: 'exit_date', label: 'Austrittsdatum', type: 'date', half: true },
    { name: 'employment_type_id', label: 'Beschäftigungsart', type: 'ref', refOptions: refOptions('employment_types'), half: true },
    { name: 'position_id', label: 'Position', type: 'ref', refOptions: refOptions('positions'), half: true },
    { name: 'department_id', label: 'Abteilung', type: 'ref', refOptions: refOptions('departments'), half: true },
    { name: 'supervisor_id', label: 'Vorgesetzter', type: 'ref', refOptions: refOptions('users'), half: true },
    { name: 'work_model_id', label: 'Arbeitszeitmodell', type: 'ref', refOptions: refOptions('work_models'), half: true, help: 'Bestimmt die Soll-Stunden je Wochentag.' },
    { name: 'weekly_hours', label: 'Wochenstunden (nur ohne Modell)', type: 'number', half: true },
    { name: 'vacation_days', label: 'Urlaubsanspruch (Tage/Jahr)', type: 'number', half: true },
    { name: 'vacation_carryover', label: 'Resturlaub Vorjahr (Tage)', type: 'number', half: true },
    { name: 'birth_date', label: 'Geburtsdatum', type: 'date', half: true },
    { name: 'mobile', label: 'Mobilnummer', type: 'tel', half: true },
    { name: 'emergency_contact', label: 'Notfallkontakt', type: 'text' },
    { name: 'contract_note', label: 'Arbeitsvertrag (Art, Befristung, Hinweise)', type: 'textarea', rows: 2, help: 'Den Vertrag selbst unter „Dokumente“ in der Personalakte hochladen.' },
    { name: 'hr_notes', label: 'Personalnotizen (intern)', type: 'textarea', rows: 2 },
  ];
}
const payFields = () => [
  { name: 'pay_type', label: 'Vergütungsart', type: 'select', required: true, options: opt(PAY_TYPES), default: 'keine', half: true },
  { name: 'hourly_rate', label: 'Stundenlohn (€)', type: 'money', half: true },
  { name: 'monthly_salary', label: 'Monatsgehalt (€)', type: 'money', half: true },
];

export function staffForm({ params }) {
  const ex = params[0] ? store.get('users', params[0]) : null;
  const prof = ex ? profileOf(ex.id) : {};
  const canAccount = may('users.manage');
  const fa = buildForm(accountFields(ex).map((f) => ({ ...f, readonly: f.readonly || !canAccount })), ex || { role: 'mitarbeiter', entry_date: todayYmd() });
  const fp = may('hr.manage') ? buildForm(profileFields(), { status: 'aktiv', ...prof }) : null;
  const fs = may('hr.salary') ? buildForm(payFields(), { pay_type: 'keine', ...prof }) : null;
  const save = btn(ex ? 'Speichern' : 'Mitarbeiter anlegen', { cls: 'primary lg', icon: 'check', onclick: async () => {
    if (!fa.check() || (fp && !fp.check()) || (fs && !fs.check())) return;
    if (!navigator.onLine) return toast('Mitarbeiterdaten können nur online gespeichert werden.', 'warn');
    save.disabled = true;
    try {
      let id = ex?.id;
      if (canAccount) {
        const v = fa.values();
        if (ex) await api('PUT', `/api/users/${ex.id}`, v);
        else {
          const r = await api('POST', '/api/users', v);
          id = r.user.id;
          if (r.one_time_password) await showPassword(r.one_time_password, r.user.name, r.user.employee_no);
        }
      }
      if (id && (fp || fs) && fa.values().role !== 'kunde') {
        await store.pull().catch(() => {});
        const cur = store.get('employee_profiles', id);
        const data = { ...(fp ? fp.values() : {}), ...(fs ? fs.values() : {}) };
        await store.command('employee.saveProfile', { user_id: id, data, base_version: cur?.version });
      }
      await store.pull().catch(() => {});
      toast('Gespeichert.');
      go(id ? `#/mitarbeiter/${id}` : '#/mitarbeiter');
    } catch (e) { errorToast(e); } finally { save.disabled = false; }
  } });
  return h('div', null, pageHead(ex ? `${ex.name} bearbeiten` : 'Mitarbeiter anlegen', { back: ex ? `#/mitarbeiter/${ex.id}` : '#/mitarbeiter', sub: ex ? ex.employee_no : 'Die Personalnummer (G-…) wird automatisch vergeben.' }),
    !navigator.onLine ? h('div', { class: 'notice warn' }, ic('wifiOff'), 'Mitarbeiterdaten können nur online gespeichert werden.') : null,
    card('Zugang und Stammdaten', h('div', { class: 'card-pad' }, fa.el), { iconName: 'user' }),
    fp ? card('Beschäftigung', h('div', { class: 'card-pad' }, fp.el), { iconName: 'briefcase' }) : null,
    fs ? card('Vergütung', h('div', { class: 'card-pad' }, fs.el, h('p', { class: 'tiny muted' }, 'Weitere Bestandteile (Zuschläge, Überstunden, Fahrtkosten, Boni …) werden in den Berechnungsmodellen festgelegt.')), { iconName: 'chart' }) : null,
    h('div', { class: 'form-actions' }, btn('Abbrechen', { href: ex ? `#/mitarbeiter/${ex.id}` : '#/mitarbeiter' }), save));
}

async function showPassword(pw, name, no) {
  await modal({ title: 'Zugangsdaten', body: h('div', null,
    h('p', null, `Zugang für ${name}${no ? ' (' + no + ')' : ''}. Bitte das Passwort sicher übergeben – es wird nur jetzt angezeigt. Bei der ersten Anmeldung muss ein eigenes Passwort vergeben werden.`),
    h('div', { class: 'mono', style: { fontSize: '1.4rem', textAlign: 'center', padding: '14px', background: 'var(--bg)', borderRadius: '10px', userSelect: 'all' } }, pw)),
  actions: [{ label: 'Verstanden', value: true, class: 'primary' }] });
}

// ---------- Personalakte ----------
const tabState = {};
const monthState = {};
export function staffDetail({ params }) {
  const u = store.get('users', params[0]);
  if (!u) return h('div', { class: 'notice bad' }, 'Mitarbeiter nicht gefunden.');
  const p = profileOf(u.id);
  const self = u.id === user().id;
  const tab = tabState[u.id] || 'akte';
  const actions = [];
  if (may(['users.manage', 'hr.manage'])) actions.push(btn('Bearbeiten', { icon: 'edit', href: `#/mitarbeiter/${u.id}/bearbeiten` }));
  if (may('users.manage')) {
    actions.push(btn('Passwort zurücksetzen', { icon: 'key', onclick: async () => {
      try { const r = await api('POST', `/api/users/${u.id}/reset-password`); await showPassword(r.one_time_password, u.name, u.employee_no); } catch (e) { errorToast(e); }
    } }));
    if (!self) actions.push(btn(u.active ? 'Zugang sperren' : 'Zugang entsperren', { icon: u.active ? 'slash' : 'check', onclick: async () => {
      try { await api('PUT', `/api/users/${u.id}`, { active: !u.active }); await store.pull(); toast('Gespeichert.'); } catch (e) { errorToast(e); }
    } }));
    if (!self) actions.push(btn('Löschen', { icon: 'trash', cls: 'danger', onclick: async () => {
      if (!(await confirmDialog(`${u.name} (${u.employee_no}) löschen? Der Zugang wird beendet. Zeiten, Aufträge und Historie bleiben erhalten; die Personalnummer wird nie erneut vergeben.`, { danger: true, ok: 'Löschen' }))) return;
      try { await api('DELETE', `/api/users/${u.id}`); await store.pull(true); toast('Mitarbeiter gelöscht.'); go('#/mitarbeiter'); } catch (e) { errorToast(e); }
    } }));
  }
  const el = h('div', null, pageHead(u.name, { back: '#/mitarbeiter', sub: [u.employee_no, nameOf('positions', p.position_id), nameOf('employment_types', p.employment_type_id)].filter(Boolean).join(' · '), actions }),
    h('div', { class: 'btn-row', style: { marginBottom: '12px' } }, p.status ? badge(EMPLOYEE_STATUS[p.status], statusKind(p.status)) : null, badge(roleLabel(u.role), 'outline'), u.active ? null : badge('Zugang gesperrt', 'bad')));
  const tabList = [{ key: 'akte', label: 'Personalakte' }, { key: 'objekte', label: 'Objekte' }, { key: 'abwesenheit', label: 'Urlaub & Abwesenheit' }, { key: 'zeit', label: 'Arbeitszeit & Überstunden' }];
  if (may('hr.salary')) tabList.push({ key: 'verguetung', label: 'Vergütung & Kosten' });
  if (may('hr.read')) tabList.push({ key: 'dokumente', label: 'Dokumente' }, { key: 'historie', label: 'Historie' });
  el.append(tabs(tabList, tab, (k) => { tabState[u.id] = k; refresh(); }));

  if (tab === 'akte') {
    el.append(h('div', { class: 'grid two' },
      card('Stammdaten & Kontakt', kv([
        ['Personalnummer', u.employee_no], ['Frühere Nummer', u.legacy_employee_no], ['E-Mail', mailLink(u.email)], ['Telefon', phoneLink(u.phone)],
        ['Mobil', phoneLink(p.mobile)], ['Geburtsdatum', fmtDate(p.birth_date)], ['Adresse', [u.street, [u.zip, u.city].filter(Boolean).join(' ')].filter(Boolean).join(', '), true],
        ['Notfallkontakt', p.emergency_contact, true], ['Letzte Anmeldung', fmtDateTime(u.last_login_at)],
      ]), { iconName: 'user' }),
      card('Beschäftigung', kv([
        ['Eintritt', fmtDate(u.entry_date)], ['Austritt', fmtDate(p.exit_date)], ['Status', EMPLOYEE_STATUS[p.status]],
        ['Beschäftigungsart', nameOf('employment_types', p.employment_type_id)], ['Position', nameOf('positions', p.position_id)], ['Abteilung', nameOf('departments', p.department_id)],
        ['Vorgesetzter', p.supervisor_id ? userLabel(p.supervisor_id) : null], ['Arbeitszeitmodell', nameOf('work_models', p.work_model_id) || (p.weekly_hours ? `${fmtNumber(p.weekly_hours)} Std./Woche` : 'nicht festgelegt')],
        ['Urlaubsanspruch', p.vacation_days != null ? `${fmtNumber(p.vacation_days)} Tage${p.vacation_carryover ? ' + ' + fmtNumber(p.vacation_carryover) + ' Rest' : ''}` : null],
        ['Vergütung', may('hr.salary') ? `${PAY_TYPES[p.pay_type] || '–'}${p.pay_type === 'stunde' && p.hourly_rate != null ? ': ' + fmtMoney(p.hourly_rate) + '/Std.' : ''}${p.pay_type === 'monat' && p.monthly_salary != null ? ': ' + fmtMoney(p.monthly_salary) : ''}` : null],
        ['Arbeitsvertrag', p.contract_note, true], ['Personalnotizen', may('hr.read') ? p.hr_notes : null, true], ['Notizen', u.notes, true],
      ]), { iconName: 'briefcase' })),
    card('Rolle und Rechte', h('div', { class: 'card-pad' }, h('p', { class: 'small' }, `Rolle: ${roleLabel(u.role)}`), h('div', { class: 'chips' }, roleperms(u.role).map((x) => badge(PERMISSION_LABELS[x] || x, 'outline')))), { iconName: 'key', actions: may('roles.manage') ? [btn('Rollen verwalten', { cls: 'sm', href: '#/rollen' })] : null }));
  } else if (tab === 'objekte') {
    const assigned = store.all('object_employees', (x) => x.user_id === u.id).map((x) => store.get('objects', x.object_id)).filter(Boolean);
    const upcoming = store.all('orders', (o) => o.assigned_user_id === u.id && o.scheduled_date >= todayYmd() && !o.completed_at).sort((a, b) => a.scheduled_date.localeCompare(b.scheduled_date)).slice(0, 15);
    el.append(h('div', { class: 'grid two' },
      card('Zugewiesene Objekte', assigned.length ? h('div', { class: 'list' }, assigned.map((o) => row({ href: `#/objekte/${o.id}`, title: o.name, meta: o.object_no }))) : empty('Keine Objekte zugewiesen.', 'building'),
        { iconName: 'building', actions: may('objects.write') ? [btn('Zuweisen', { cls: 'sm', icon: 'edit', onclick: () => assignObjects(u, assigned) })] : null }),
      card('Anstehende Aufträge', upcoming.length ? h('div', { class: 'list' }, upcoming.map((o) => row({ href: `#/auftraege/${o.id}`, title: `${fmtDate(o.scheduled_date)} · ${store.get('objects', o.object_id)?.name || ''}`, right: orderStatusBadge(o.status) }))) : empty('Keine offenen Aufträge.'), { iconName: 'list' })));
    const shifts = store.all('shifts', (s) => s.user_id === u.id && s.date >= todayYmd()).sort((a, b) => (a.date + a.start_time).localeCompare(b.date + b.start_time)).slice(0, 20);
    el.append(card('Geplante Schichten', shifts.length ? h('div', { class: 'list' }, shifts.map((s) => row({ title: `${fmtDate(s.date)} · ${s.start_time}–${s.end_time}`, meta: [nameOf('objects', s.object_id), s.note].filter(Boolean).join(' · ') }))) : empty('Keine Schichten geplant.'), { iconName: 'calendar', actions: may('planning.manage') ? [btn('Dienstplan', { cls: 'sm', href: '#/dienstplan' })] : null }));
  } else if (tab === 'abwesenheit') {
    const year = todayYmd().slice(0, 4);
    const list = store.all('absences', (a) => a.user_id === u.id).sort((a, b) => b.start_date.localeCompare(a.start_date));
    const vac = list.filter((a) => a.kind === 'urlaub' && ['genehmigt', 'beantragt'].includes(a.status) && a.start_date.startsWith(year));
    const entitlement = (p.vacation_days || 0) + (p.vacation_carryover || 0);
    const taken = vac.filter((a) => a.status === 'genehmigt').reduce((s, a) => s + a.days, 0);
    const planned = vac.filter((a) => a.status === 'beantragt').reduce((s, a) => s + a.days, 0);
    const sick = list.filter((a) => ['krank', 'kind_krank'].includes(a.kind) && a.status === 'genehmigt' && a.start_date.startsWith(year)).reduce((s, a) => s + a.days, 0);
    el.append(h('div', { class: 'kpis', style: { marginBottom: '12px' } },
      h('div', { class: 'kpi accent' }, h('div', { class: 'label' }, `Urlaubsanspruch ${year}`), h('div', { class: 'value' }, fmtNumber(entitlement))),
      h('div', { class: 'kpi' }, h('div', { class: 'label' }, 'Genommen / genehmigt'), h('div', { class: 'value' }, fmtNumber(taken))),
      h('div', { class: 'kpi warn' }, h('div', { class: 'label' }, 'Beantragt'), h('div', { class: 'value' }, fmtNumber(planned))),
      h('div', { class: 'kpi ok' }, h('div', { class: 'label' }, 'Resturlaub'), h('div', { class: 'value' }, fmtNumber(entitlement - taken - planned)), h('div', { class: 'hint' }, `Krankheitstage ${year}: ${fmtNumber(sick)}`))));
    const canAdd = may('absences.manage') || (self && may('absences.request'));
    el.append(card('Abwesenheiten', list.length ? h('div', { class: 'list' }, list.map((a) => absenceRow(a, { showUser: false }))) : empty('Keine Abwesenheiten.', 'calendar'),
      { iconName: 'calendar', actions: canAdd ? [btn(may('absences.manage') ? 'Erfassen' : 'Beantragen', { cls: 'sm primary', icon: 'plus', onclick: () => absenceDialog({ user_id: u.id }) })] : null }));
  } else if (tab === 'zeit') {
    el.append(timeTab(u));
  } else if (tab === 'verguetung') {
    el.append(payTab(u));
  } else if (tab === 'dokumente') {
    el.append(documentsCard({ user_id: u.id }));
  } else if (tab === 'historie') {
    el.append(historyCard('users', u.id));
  }
  return el;
}

function roleperms(key) {
  const r = store.all('roles', (x) => x.role_key === key)[0];
  try { return r ? JSON.parse(r.permissions) : []; } catch { return []; }
}

async function assignObjects(u, assigned) {
  const v = await formDialog(`Objekte für ${u.name}`, [{ name: 'ids', label: 'Zugewiesene Objekte', type: 'checkboxes', options: refOptions('objects') }], { ids: assigned.map((o) => o.id) });
  if (!v) return;
  const before = new Set(assigned.map((o) => o.id)); const after = new Set(v.ids);
  try {
    for (const oid of new Set([...before, ...after])) {
      if (before.has(oid) === after.has(oid)) continue;
      const users = store.all('object_employees', (x) => x.object_id === oid).map((x) => x.user_id).filter((x) => x !== u.id);
      if (after.has(oid)) users.push(u.id);
      await store.command('object.setEmployees', { object_id: oid, user_ids: users });
    }
    toast('Zuweisung gespeichert.');
  } catch (e) { errorToast(e); }
}

function monthPicker(key, onChange) {
  const m = monthState[key] || todayYmd().slice(0, 7);
  const shift = (n) => { const [y, mo] = m.split('-').map(Number); const d = new Date(Date.UTC(y, mo - 1 + n, 1)); monthState[key] = d.toISOString().slice(0, 7); onChange(); };
  return { month: m, el: h('div', { class: 'btn-row', style: { alignItems: 'center' } }, btn('', { cls: 'sm ghost icon-btn', icon: 'back', onclick: () => shift(-1), title: 'Vormonat' }), h('strong', null, fmtMonth(m)), btn('', { cls: 'sm ghost icon-btn', icon: 'chevron', onclick: () => shift(1), title: 'Folgemonat' })) };
}

function timeTab(u) {
  const wrap = h('div');
  const mp = monthPicker('t' + u.id, refresh);
  const year = mp.month.slice(0, 4);
  const monthBox = h('div', null, h('div', { class: 'loading' }, h('span', { class: 'spinner' })));
  const accBox = h('div', null, h('div', { class: 'loading' }, h('span', { class: 'spinner' })));
  wrap.append(card('Soll / Ist', monthBox, { iconName: 'clock', actions: [mp.el] }));
  wrap.append(card(`Überstundenkonto ${year}`, accBox, { iconName: 'chart', actions: may('hr.manage') ? [btn('Buchung', { cls: 'sm', icon: 'plus', onclick: () => otAdjust(u) })] : null }));
  api('GET', `/api/personnel/${u.id}/month?month=${mp.month}`).then((r) => {
    monthBox.replaceChildren(kv([
      ['Soll-Stunden', `${fmtNumber(r.hours.soll)} Std.`], ['Gearbeitet', `${fmtNumber(r.hours.worked)} Std.`],
      ['Abwesenheit (angerechnet)', r.hours.absence_credit ? `${fmtNumber(r.hours.absence_credit)} Std.` : null], ['Ist-Stunden', `${fmtNumber(r.hours.ist)} Std.`],
      ['Über-/Unterstunden', `${r.hours.overtime > 0 ? '+' : ''}${fmtNumber(r.hours.overtime)} Std.`], ['Einsatztage', r.hours.work_days],
      ['Automatisch abgezogene Pause', r.hours.auto_pause ? `${fmtNumber(r.hours.auto_pause)} Std.` : null],
    ]));
  }).catch((e) => monthBox.replaceChildren(h('div', { class: 'empty small' }, e.offline ? 'Auswertung ist offline nicht verfügbar.' : e.message)));
  api('GET', `/api/personnel/${u.id}/account?year=${year}`).then((r) => {
    const adj = store.all('overtime_adjustments', (a) => a.user_id === u.id).sort((a, b) => b.date.localeCompare(a.date));
    accBox.replaceChildren(h('div', null,
      h('div', { class: 'stat-line' }, h('span', null, 'Übertrag aus Vorjahren'), h('strong', null, `${fmtNumber(r.carry_over)} Std.`)),
      h('div', { class: 'table-wrap' }, h('table', { class: 'data' }, h('thead', null, h('tr', null, ['Monat', 'Soll', 'Ist', 'Differenz', 'Buchungen', 'Ausgezahlt', 'Kontostand'].map((t, i) => h('th', { class: i ? 'num' : '' }, t)))),
        h('tbody', null, r.months.map((m) => h('tr', null, h('td', null, fmtMonth(m.month)), ...[m.soll, m.ist, m.overtime, m.adjustments, m.paid_out, m.balance].map((v) => h('td', { class: 'num' }, fmtNumber(v)))))))),
      h('div', { class: 'stat-line' }, h('strong', null, 'Aktueller Kontostand'), h('strong', null, `${r.balance > 0 ? '+' : ''}${fmtNumber(r.balance)} Std.`)),
      adj.length ? h('div', { class: 'list' }, adj.map((a) => h('div', { class: 'row', style: { cursor: 'default' } }, h('div', { class: 'grow' }, h('div', { class: 'title' }, `${fmtDate(a.date)} · ${a.minutes > 0 ? '+' : ''}${fmtMinutes(a.minutes)}`), h('div', { class: 'meta' }, a.reason)),
        may('hr.manage') ? h('button', { class: 'btn ghost icon-btn', 'aria-label': 'Löschen', onclick: () => store.command('entity.delete', { entity: 'overtime_adjustments', id: a.id }).catch(errorToast) }, ic('trash')) : null))) : null));
  }).catch((e) => accBox.replaceChildren(h('div', { class: 'empty small' }, e.offline ? 'Zeitkonto ist offline nicht verfügbar.' : e.message)));
  return wrap;
}

async function otAdjust(u) {
  const f = ENTITIES.overtime_adjustments.fields.filter((x) => x.name !== 'user_id').map((x) => (x.name === 'minutes' ? { ...x, label: 'Stunden (+ Gutschrift / − Abzug oder Auszahlung)', name: 'hours' } : x));
  const v = await formDialog('Zeitkonto-Buchung', f, {});
  if (!v) return;
  if (!v.hours) return toast('Bitte Stunden angeben.', 'bad');
  try { await store.command('entity.save', { entity: 'overtime_adjustments', id: store.uuid(), data: { user_id: u.id, date: v.date, reason: v.reason, minutes: Math.round(v.hours * 60) } }); toast('Gebucht.'); refresh(); } catch (e) { errorToast(e); }
}

function payTab(u) {
  const wrap = h('div', null, h('div', { class: 'notice warn' }, ic('info'), DISCLAIMER));
  const mp = monthPicker('p' + u.id, refresh);
  const box = h('div', null, h('div', { class: 'loading' }, h('span', { class: 'spinner' })));
  wrap.append(card('Berechnung (intern)', box, { iconName: 'chart', actions: [mp.el] }));
  api('GET', `/api/personnel/${u.id}/month?month=${mp.month}`).then((r) => {
    box.replaceChildren(h('div', null,
      r.warnings.length ? h('div', { class: 'card-pad' }, r.warnings.map((w) => h('div', { class: 'notice warn' }, ic('alert'), w))) : null,
      h('div', { class: 'list' }, r.lines.map((l) => h('div', { class: 'stat-line' }, h('span', null, l.label, l.detail ? h('span', { class: 'muted small' }, ` (${l.detail})`) : null), h('span', { class: 'nowrap' }, fmtMoney(l.amount))))),
      h('div', { class: 'stat-line', style: { fontWeight: 700 } }, h('span', null, 'Bruttovergütung (intern)'), h('span', null, fmtMoney(r.amounts.gross))),
      h('div', { class: 'stat-line', style: { fontWeight: 700, background: 'var(--accent-soft)' } }, h('span', null, 'Personalkosten gesamt'), h('span', null, fmtMoney(r.amounts.total))),
      h('div', { class: 'stat-line' }, h('span', null, 'Kosten je Arbeitsstunde'), h('span', null, r.amounts.per_hour != null ? fmtMoney(r.amounts.per_hour) : '–')),
      Object.keys(r.per_object).length ? h('div', { class: 'card-pad' }, h('h3', null, 'Verteilung auf Objekte'), ...Object.entries(r.per_object).map(([oid, v]) => h('div', { class: 'stat-line' }, h('span', null, oid ? nameOf('objects', oid) : 'Ohne Objekt', h('span', { class: 'muted small' }, ` (${fmtMinutes(v.minutes)})`)), h('span', null, fmtMoney(v.cost))))) : null));
  }).catch((e) => box.replaceChildren(h('div', { class: 'empty small' }, e.offline ? 'Berechnung ist offline nicht verfügbar.' : e.message)));
  const adj = store.all('pay_adjustments', (a) => a.user_id === u.id).sort((a, b) => b.month.localeCompare(a.month));
  const KIND = { praemie: 'Prämie', zuschlag: 'Zuschlag', abzug: 'Abzug' };
  wrap.append(card('Einmalige Prämien, Zuschläge und Abzüge', adj.length ? h('div', { class: 'list' }, adj.map((a) => h('div', { class: 'row', style: { cursor: 'default' } },
    h('div', { class: 'grow' }, h('div', { class: 'title' }, `${fmtMonth(a.month)} · ${KIND[a.kind]}: ${a.kind === 'abzug' ? '−' : ''}${fmtMoney(a.amount)}`), h('div', { class: 'meta' }, [a.note, nameOf('objects', a.object_id)].filter(Boolean).join(' · '))),
    h('button', { class: 'btn ghost icon-btn', 'aria-label': 'Löschen', onclick: () => store.command('entity.delete', { entity: 'pay_adjustments', id: a.id }).catch(errorToast) }, ic('trash'))))) : empty('Keine Einmalbeträge.'),
  { iconName: 'plus', actions: [btn('Erfassen', { cls: 'sm', icon: 'plus', onclick: async () => {
    const v = await formDialog('Einmalbetrag erfassen', ENTITIES.pay_adjustments.fields.filter((x) => x.name !== 'user_id').map((x) => ({ ...x, refOptions: x.type === 'ref' ? refOptions(x.ref) : undefined })), { month: mp.month });
    if (v) store.command('entity.save', { entity: 'pay_adjustments', id: store.uuid(), data: { ...v, user_id: u.id } }).then(() => toast('Gespeichert.')).catch(errorToast);
  } })] }));
  const miles = store.all('mileage_logs', (m) => m.user_id === u.id).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 50);
  wrap.append(card('Fahrten (Kilometer)', miles.length ? h('div', { class: 'list' }, miles.map((m) => h('div', { class: 'row', style: { cursor: 'default' } },
    h('div', { class: 'grow' }, h('div', { class: 'title' }, `${fmtDate(m.date)} · ${fmtNumber(m.km)} km`), h('div', { class: 'meta' }, [nameOf('objects', m.object_id), m.note].filter(Boolean).join(' · '))),
    may('hr.manage') ? h('button', { class: 'btn ghost icon-btn', 'aria-label': 'Löschen', onclick: () => store.command('entity.delete', { entity: 'mileage_logs', id: m.id }).catch(errorToast) }, ic('trash')) : null))) : empty('Keine Fahrten erfasst.'),
  { iconName: 'map', actions: may('hr.manage') ? [btn('Fahrt', { cls: 'sm', icon: 'plus', onclick: async () => {
    const v = await formDialog('Fahrt erfassen', ENTITIES.mileage_logs.fields.filter((x) => x.name !== 'user_id').map((x) => ({ ...x, refOptions: x.type === 'ref' ? refOptions(x.ref) : undefined })), {});
    if (v) store.command('entity.save', { entity: 'mileage_logs', id: store.uuid(), data: { ...v, user_id: u.id } }).then(() => toast('Gespeichert.')).catch(errorToast);
  } })] : null }));
  return wrap;
}

export { openUrl, ABSENCE_KINDS, ABSENCE_STATUS };
