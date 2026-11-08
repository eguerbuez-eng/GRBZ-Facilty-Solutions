import { h, ic, card, empty, row, badge, pageHead } from '../ui.js';
import * as store from '../store.js';
import { api } from '../api.js';
import { may, orderStatusBadge, auditText, user } from './common.js';
import { todayYmd, fmtDate, fmtDateTime, fmtNumber } from '/shared/dates.js';
import { ROLES } from '/shared/constants.js';

export async function dashboardView() {
  let data; let stale = null;
  try {
    data = await api('GET', '/api/dashboard');
    store.cacheSet('dashboard', data);
  } catch (e) {
    if (!e.offline) throw e;
    const c = await store.cacheGet('dashboard');
    data = c?.value; stale = c?.at;
  }
  const u = user();
  const today = todayYmd();
  const hour = new Date().getHours();
  const greet = hour < 11 ? 'Guten Morgen' : hour < 18 ? 'Guten Tag' : 'Guten Abend';
  const el = h('div');
  el.append(pageHead(`${greet}, ${u.name.split(' ')[0]}`, { sub: `${new Intl.DateTimeFormat('de-DE', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric', timeZone: 'Europe/Berlin' }).format(new Date())} · ${u.role_name || ROLES[u.role] || u.role}` }));
  if (stale) el.append(h('div', { class: 'notice warn' }, ic('wifiOff'), `Offline – Kennzahlen vom ${fmtDateTime(stale)}. Aufträge und Objektakten sind lokal verfügbar.`));
  else if (!data) el.append(h('div', { class: 'notice warn' }, ic('wifiOff'), 'Offline – Kennzahlen sind erst nach der ersten Verbindung verfügbar.'));

  // Schnellzugriffe
  const quick = h('div', { class: 'quick', style: { marginTop: '12px' } });
  if (may('qr.scan')) quick.append(h('a', { href: '#/scan', class: 'primary' }, ic('scan'), 'QR-Code scannen'));
  if (may('orders.read')) quick.append(h('a', { href: '#/auftraege' }, ic('list'), 'Heutige Aufträge'));
  if (may('time.own')) quick.append(h('a', { href: '#/zeit' }, ic('clock'), clockLabel()));
  if (may('defects.report')) quick.append(h('a', { href: '#/maengel/neu' }, ic('alert'), 'Mangel melden'));
  if (may('orders.write')) quick.append(h('a', { href: '#/auftraege/neu' }, ic('plus'), 'Auftrag anlegen'));
  if (may('customers.write')) quick.append(h('a', { href: '#/kunden/neu' }, ic('briefcase'), 'Kunde anlegen'));
  if (may('winter.execute')) quick.append(h('a', { href: '#/winter/einsatz/neu' }, ic('snow'), 'Winterdiensteinsatz'));
  el.append(quick);

  if (data) {
    const k = h('div', { class: 'kpis wide', style: { marginTop: '16px' } });
    const kpi = (label, value, { href, kind = '', hint } = {}) => h(href ? 'a' : 'div', { class: `kpi ${kind}`, href }, h('div', { class: 'label' }, label), h('div', { class: 'value' }, value ?? '–'), hint ? h('div', { class: 'hint' }, hint) : null);
    if (data.customers !== undefined) k.append(kpi('Kunden', data.customers, { href: '#/kunden' }));
    k.append(kpi(data.scoped ? 'Meine Objekte' : 'Aktive Objekte', data.objects, { href: '#/objekte' }));
    k.append(kpi('Heutige Einsätze', data.orders.today, { href: '#/auftraege', kind: 'accent', hint: `${data.orders.today_done} erledigt` }));
    k.append(kpi('Offene Aufträge', data.orders.open, { href: '#/auftraege?tab=offen' }));
    k.append(kpi('Erledigte Aufträge', data.orders.done, { href: '#/auftraege?tab=erledigt', kind: 'ok', hint: `${data.orders.done_month} in diesem Monat` }));
    k.append(kpi('Überfällig', data.orders.overdue + (data.defects?.overdue || 0), { href: '#/auftraege?tab=ueberfaellig', kind: data.orders.overdue + data.defects.overdue ? 'bad' : '', hint: `${data.orders.overdue} Aufträge · ${data.defects.overdue} Mängel` }));
    k.append(kpi('Offene Mängel', data.defects.open, { href: '#/qualitaet', kind: data.defects.open ? 'warn' : '' }));
    if (data.materials) k.append(kpi('Materialwarnungen', data.materials.low.length, { href: '#/material?filter=niedrig', kind: data.materials.low.length ? 'warn' : '', hint: `${data.materials.total} Artikel` }));
    if (data.maintenance) k.append(kpi('Anstehende Wartungen', data.maintenance.length, { href: '#/maschinen', kind: data.maintenance.some((m) => m.next_maintenance < today) ? 'bad' : '', hint: data.machines_defect ? `${data.machines_defect} Maschine(n) defekt` : 'nächste 30 Tage' }));
    if (data.corrections_pending) k.append(kpi('Zeitkorrekturen', data.corrections_pending, { href: '#/zeit/uebersicht', kind: 'warn', hint: 'warten auf Genehmigung' }));
    el.append(k);
  }

  // Heutige Einsätze (lokal → offline verfügbar)
  const todays = store.all('orders', (o) => o.scheduled_date === today && (!data?.scoped || o.assigned_user_id === u.id))
    .sort((a, b) => (a.scheduled_time || '99').localeCompare(b.scheduled_time || '99'));
  const grid = h('div', { class: 'grid two', style: { marginTop: '16px' } });
  grid.append(card('Heutige Einsätze', todays.length ? h('div', { class: 'list' }, todays.slice(0, 12).map((o) => row({
    href: `#/auftraege/${o.id}`, lead: h('div', { class: 'lead time' }, o.scheduled_time || '–'),
    title: store.get('objects', o.object_id)?.name || 'Objekt', meta: [store.get('services', o.service_id)?.name, store.userName(o.assigned_user_id)].filter(Boolean).join(' · '),
    right: orderStatusBadge(o.status),
  }))) : empty('Für heute sind keine Einsätze geplant.', 'calendar'), { iconName: 'calendar', actions: [h('a', { class: 'btn sm ghost', href: '#/auftraege' }, 'Alle')] }));

  if (data?.staff) {
    grid.append(card('Mitarbeiterübersicht', h('div', { class: 'list' }, data.staff.map((s) => row({
      href: `#/mitarbeiter/${s.id}`, lead: h('div', { class: 'lead' }, s.name.split(' ').map((x) => x[0]).join('').slice(0, 2)),
      title: s.name, meta: `${s.role_label} · ${s.today} Einsätze heute`,
      right: badge(s.status === 'aktiv' ? 'im Einsatz' : s.status === 'pause' ? 'Pause' : 'nicht eingestempelt', s.status === 'aktiv' ? 'ok' : s.status === 'pause' ? 'warn' : ''),
    }))), { iconName: 'users' }));
  }
  if (data?.materials?.low.length) {
    grid.append(card('Materialbestand unter Mindestmenge', h('div', { class: 'list' }, data.materials.low.map((m) => row({
      href: `#/material/${m.id}`, title: m.name, meta: `Mindestbestand ${fmtNumber(m.min_stock)} ${m.unit || ''}`, right: badge(`${fmtNumber(m.stock)} ${m.unit || ''}`, 'warn'),
    }))), { iconName: 'box' }));
  }
  if (data?.maintenance?.length) {
    grid.append(card('Anstehende Wartungen', h('div', { class: 'list' }, data.maintenance.map((m) => row({
      href: `#/maschinen/${m.id}`, title: m.name, meta: m.inventory_no, right: badge(fmtDate(m.next_maintenance), m.next_maintenance < today ? 'bad' : 'warn'),
    }))), { iconName: 'wrench' }));
  }
  if (data?.activity) {
    grid.append(card('Letzte Aktivitäten', data.activity.length ? h('ul', { class: 'timeline' }, data.activity.map((a) => h('li', null,
      h('div', null, auditText(a)), h('div', { class: 'tl-when' }, `${fmtDateTime(a.at)} · ${a.user_name || 'System'}`)))) : empty('Noch keine Aktivitäten.'), { iconName: 'history' }));
  }
  el.append(grid);
  return el;
}

function clockLabel() {
  const u = user();
  const open = store.all('time_entries', (e) => e.user_id === u.id && e.kind === 'arbeit' && !e.end_at && !e.voided);
  return open.length ? 'Eingestempelt – Zeiterfassung' : 'Arbeitsbeginn stempeln';
}
