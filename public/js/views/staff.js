import { h, ic, card, empty, row, badge, pageHead, btn, kv, toast, errorToast, modal, buildForm, searchBox, matches } from '../ui.js';
import * as store from '../store.js';
import { api } from '../api.js';
import { may, refOptions, orderStatusBadge, phoneLink, mailLink, user } from './common.js';
import { ROLES, ROLE_PERMISSIONS, PERMISSION_LABELS } from '/shared/constants.js';
import { fmtDate, fmtDateTime, todayYmd, berlinToIso, monthRange, fmtMinutes } from '/shared/dates.js';
import { go } from '../app.js';

const st = { q: '' };
export function staffList() {
  const el = h('div', null, pageHead('Mitarbeiter', { sub: 'Personal, Rollen und Berechtigungen', actions: may('users.manage') ? [btn('Mitarbeiter anlegen', { icon: 'plus', cls: 'primary', href: '#/mitarbeiter/neu' })] : [] }));
  const box = h('div');
  const draw = () => {
    const rows = store.all('users', (u) => matches(u, ['name', 'email', 'employee_no'], st.q)).sort((a, b) => b.active - a.active || a.name.localeCompare(b.name));
    box.replaceChildren(card(null, rows.length ? h('div', { class: 'list' }, rows.map((u) => row({
      href: `#/mitarbeiter/${u.id}`, lead: h('div', { class: 'lead' }, u.name.split(' ').map((x) => x[0]).join('').slice(0, 2)), title: u.name,
      meta: [u.employee_no, ROLES[u.role], u.email].filter(Boolean).join(' · '), right: u.active ? null : badge('deaktiviert', 'bad'),
    }))) : empty('Keine Mitarbeiter.')));
  };
  el.append(h('div', { class: 'toolbar' }, searchBox('Suchen', (q) => { st.q = q; draw(); }, st.q)), box);
  draw();
  el.append(card('Rollen und Berechtigungen', h('div', { class: 'table-wrap' }, h('table', { class: 'data' },
    h('thead', null, h('tr', null, h('th', null, 'Berechtigung'), Object.keys(ROLES).filter((r) => r !== 'kunde').map((r) => h('th', { class: 'num' }, ROLES[r])))),
    h('tbody', null, Object.entries(PERMISSION_LABELS).map(([p, l]) => h('tr', null, h('td', null, l), Object.keys(ROLES).filter((r) => r !== 'kunde').map((r) => h('td', { class: 'num' }, ROLE_PERMISSIONS[r].includes(p) ? '✓' : '–'))))))), { iconName: 'key' }));
  return el;
}

function userFields(ex) {
  const me = user();
  const roles = Object.entries(ROLES).filter(([k]) => me.role === 'admin' || !['admin', 'geschaeftsfuehrer'].includes(k)).map(([value, label]) => ({ value, label }));
  return [
    { name: 'name', label: 'Name', type: 'text', required: true },
    { name: 'email', label: 'E-Mail (Anmeldename)', type: 'email', required: true, half: true },
    { name: 'phone', label: 'Telefon', type: 'tel', half: true },
    { name: 'role', label: 'Rolle', type: 'select', required: true, options: roles, half: true, readonly: ex && ex.id === me.id },
    { name: 'entry_date', label: 'Eintrittsdatum', type: 'date', half: true },
    { name: 'customer_id', label: 'Kunde (nur für Kundenportal-Zugänge)', type: 'ref', refOptions: refOptions('customers') },
    { name: 'street', label: 'Straße', type: 'text' },
    { name: 'zip', label: 'PLZ', type: 'text', half: true },
    { name: 'city', label: 'Ort', type: 'text', half: true },
    { name: 'notes', label: 'Notizen', type: 'textarea' },
  ];
}

async function showPassword(pw, name) {
  await modal({ title: 'Einmalpasswort', body: h('div', null,
    h('p', null, `Zugang für ${name}. Bitte das Passwort sicher übergeben – es wird nur jetzt angezeigt. Bei der ersten Anmeldung muss ein eigenes Passwort vergeben werden.`),
    h('div', { class: 'mono', style: { fontSize: '1.4rem', textAlign: 'center', padding: '14px', background: 'var(--bg)', borderRadius: '10px', userSelect: 'all' } }, pw)),
  actions: [{ label: 'Verstanden', value: true, class: 'primary' }] });
}

export function staffForm({ params }) {
  const ex = params[0] ? store.get('users', params[0]) : null;
  const f = buildForm(userFields(ex), ex || { role: 'mitarbeiter', entry_date: todayYmd() });
  const save = btn(ex ? 'Speichern' : 'Anlegen', { cls: 'primary lg', icon: 'check', onclick: async () => {
    if (!f.check()) return;
    save.disabled = true;
    try {
      const v = f.values();
      if (ex) { await api('PUT', `/api/users/${ex.id}`, v); toast('Gespeichert.'); }
      else {
        const r = await api('POST', '/api/users', v);
        if (r.one_time_password) await showPassword(r.one_time_password, r.user.name);
      }
      await store.pull().catch(() => {});
      go(ex ? `#/mitarbeiter/${ex.id}` : '#/mitarbeiter');
    } catch (e) { errorToast(e.offline ? { message: 'Benutzerverwaltung erfordert eine Internetverbindung.' } : e); } finally { save.disabled = false; }
  } });
  return h('div', null, pageHead(ex ? 'Mitarbeiter bearbeiten' : 'Mitarbeiter anlegen', { back: ex ? `#/mitarbeiter/${ex.id}` : '#/mitarbeiter' }),
    !navigator.onLine ? h('div', { class: 'notice warn' }, ic('wifiOff'), 'Benutzerverwaltung ist nur online möglich.') : null,
    card(null, h('div', { class: 'card-pad' }, f.el, h('div', { class: 'form-actions' }, btn('Abbrechen', { href: '#/mitarbeiter' }), save))));
}

export function staffDetail({ params }) {
  const u = store.get('users', params[0]);
  if (!u) return h('div', { class: 'notice bad' }, 'Mitarbeiter nicht gefunden.');
  const today = todayYmd();
  const objects = store.all('object_employees', (x) => x.user_id === u.id).map((x) => store.get('objects', x.object_id)).filter(Boolean);
  const orders = store.all('orders', (o) => o.assigned_user_id === u.id && o.scheduled_date >= today && !o.completed_at).sort((a, b) => a.scheduled_date.localeCompare(b.scheduled_date)).slice(0, 15);
  const { start, end } = monthRange(today.slice(0, 7));
  const a = berlinToIso(start, '00:00');
  const month = store.all('time_entries', (e) => e.user_id === u.id && !e.voided && e.end_at && e.start_at >= a);
  const net = month.reduce((s, e) => s + (e.kind === 'arbeit' ? 1 : -1) * (Date.parse(e.end_at) - Date.parse(e.start_at)) / 6e4, 0);
  const actions = [];
  if (may('users.manage')) {
    actions.push(btn('Bearbeiten', { icon: 'edit', href: `#/mitarbeiter/${u.id}/bearbeiten` }));
    actions.push(btn('Passwort zurücksetzen', { icon: 'key', onclick: async () => {
      try { const r = await api('POST', `/api/users/${u.id}/reset-password`); await showPassword(r.one_time_password, u.name); } catch (e) { errorToast(e); }
    } }));
    if (u.id !== user().id) actions.push(btn(u.active ? 'Deaktivieren' : 'Aktivieren', { icon: u.active ? 'slash' : 'check', cls: u.active ? 'danger' : '', onclick: async () => {
      try { await api('PUT', `/api/users/${u.id}`, { active: !u.active }); await store.pull(); toast('Gespeichert.'); } catch (e) { errorToast(e); }
    } }));
  }
  return h('div', null,
    pageHead(u.name, { back: '#/mitarbeiter', sub: [u.employee_no, ROLES[u.role]].filter(Boolean).join(' · '), actions }),
    !u.active ? h('div', { class: 'notice bad' }, 'Dieses Konto ist deaktiviert.') : null,
    h('div', { class: 'grid two' },
      card('Stammdaten', kv([
        ['Mitarbeiter-ID', u.employee_no], ['Rolle', ROLES[u.role]], ['E-Mail', mailLink(u.email)], ['Telefon', phoneLink(u.phone)],
        ['Adresse', [u.street, [u.zip, u.city].filter(Boolean).join(' ')].filter(Boolean).join(', ')], ['Eintrittsdatum', fmtDate(u.entry_date)],
        ['Letzte Anmeldung', fmtDateTime(u.last_login_at)], ['Kunde (Portal)', u.customer_id ? store.get('customers', u.customer_id)?.company_name : null], ['Notizen', u.notes, true],
      ]), { iconName: 'user' }),
      card('Berechtigungen', h('div', { class: 'card-pad' }, h('div', { class: 'chips' }, (ROLE_PERMISSIONS[u.role] || []).map((p) => badge(PERMISSION_LABELS[p], 'outline')))), { iconName: 'key' })),
    h('div', { class: 'grid two' },
      card('Zugeordnete Objekte', objects.length ? h('div', { class: 'list' }, objects.map((o) => row({ href: `#/objekte/${o.id}`, title: o.name, meta: o.object_no }))) : empty('Keine Objekte zugeordnet.'), { iconName: 'building' }),
      card('Anstehende Aufträge', orders.length ? h('div', { class: 'list' }, orders.map((o) => row({ href: `#/auftraege/${o.id}`, title: `${fmtDate(o.scheduled_date)} · ${store.get('objects', o.object_id)?.name || ''}`, right: orderStatusBadge(o.status) }))) : empty('Keine offenen Aufträge.'), { iconName: 'list' })),
    may('time.all') ? card('Arbeitszeit aktueller Monat', h('div', { class: 'stat-line' }, h('span', null, 'Netto erfasst'), h('strong', null, fmtMinutes(net))), { iconName: 'clock', actions: [btn('Details', { cls: 'sm', href: '#/zeit/uebersicht' })] }) : null);
}
