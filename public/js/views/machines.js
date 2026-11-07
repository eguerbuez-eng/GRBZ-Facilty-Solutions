import { h, ic, card, empty, row, badge, pageHead, btn, kv, toast, errorToast, formDialog, searchBox, matches, openUrl } from '../ui.js';
import * as store from '../store.js';
import { ENTITIES } from '/shared/entities.js';
import { may, entityFormPage, archiveToggle, userLabel } from './common.js';
import { fmtDate, fmtMoney, todayYmd, addDays } from '/shared/dates.js';
import { createQr, showQr } from './qr.js';
import { takePhoto, photoGrid } from '../media.js';
import { documentsCard } from './documents.js';
import { refresh } from '../app.js';

const def = ENTITIES.machines;
const condLabel = (v) => def.fields.find((f) => f.name === 'condition').options.find((o) => o.value === v)?.label || v || '';
const condKind = (v) => ({ defekt: 'bad', in_reparatur: 'warn', ausgemustert: '', neu: 'ok', gut: 'ok' })[v] || 'outline';
const st = { q: '' };
const KINDS = { wartung: 'Wartung', pruefung: 'Prüfung', reparatur: 'Reparatur', defekt: 'Defekt' };

export function machinesList() {
  const today = todayYmd();
  const el = h('div', null, pageHead('Maschinen', { sub: 'Digitale Maschinenakten, Wartungen und Reparaturen', actions: may('machines.write') ? [btn('Maschine anlegen', { icon: 'plus', cls: 'primary', href: '#/maschinen/neu' })] : [] }));
  const box = h('div');
  const draw = () => {
    const rows = store.all('machines', (m) => !m.archived && matches(m, def.search, st.q)).sort((a, b) => a.name.localeCompare(b.name));
    box.replaceChildren(card(null, rows.length ? h('div', { class: 'list' }, rows.map((m) => row({
      href: `#/maschinen/${m.id}`, lead: h('div', { class: 'lead' }, ic('wrench')), title: m.name,
      meta: [m.inventory_no, m.location, m.next_maintenance ? 'Wartung ' + fmtDate(m.next_maintenance) : null].filter(Boolean).join(' · '),
      right: h('div', { class: 'btn-row' }, m.next_maintenance && m.next_maintenance <= addDays(today, 14) ? badge('Wartung fällig', m.next_maintenance < today ? 'bad' : 'warn') : null, badge(condLabel(m.condition), condKind(m.condition))),
    }))) : empty('Keine Maschinen.', 'wrench')));
  };
  el.append(h('div', { class: 'toolbar' }, searchBox('Suchen (Name, Inventar-/Seriennr., Standort)', (q) => { st.q = q; draw(); }, st.q)), box);
  draw();
  return el;
}

export function machineForm({ params }) {
  const id = params[0];
  return entityFormPage('machines', id, { back: id ? `#/maschinen/${id}` : '#/maschinen', after: (nid) => { location.hash = `#/maschinen/${nid}`; } });
}

export function machineDetail({ params }) {
  const m = store.get('machines', params[0]);
  if (!m) return h('div', { class: 'notice bad' }, 'Maschine nicht gefunden.');
  const events = store.all('machine_events', (e) => e.machine_id === m.id).sort((a, b) => b.event_date.localeCompare(a.event_date));
  const qrs = store.all('qr_codes', (q) => q.machine_id === m.id);
  const photos = store.all('photos', (p) => p.machine_id === m.id);
  const actions = [btn('Wartungsbericht', { icon: 'print', onclick: () => openUrl(`/api/reports/machine/${m.id}`) })];
  if (may('machines.write')) actions.unshift(btn('Bearbeiten', { icon: 'edit', href: `#/maschinen/${m.id}/bearbeiten` }), btn('Archivieren', { icon: 'archive', onclick: () => archiveToggle('machines', m) }));
  const addEvent = (kind) => async () => {
    const fields = [
      { name: 'event_date', label: 'Datum', type: 'date', required: true, default: 'today', half: true },
      kind !== 'defekt' ? { name: 'cost', label: 'Kosten (€)', type: 'money', half: true } : null,
      { name: 'description', label: kind === 'defekt' ? 'Beschreibung des Defekts' : 'Durchgeführte Arbeiten', type: 'textarea', required: true },
      kind !== 'defekt' ? { name: 'performed_by', label: 'Durchgeführt von (Firma/Person)', type: 'text' } : null,
      ['wartung', 'pruefung'].includes(kind) ? { name: 'next_due', label: 'Nächste Wartung (leer = nach Intervall)', type: 'date' } : null,
    ].filter(Boolean);
    const v = await formDialog(`${KINDS[kind]} dokumentieren`, fields, {});
    if (!v) return;
    try { await store.command('machine.event', { id: store.uuid(), machine_id: m.id, kind, ...v }); toast('Gespeichert.'); } catch (e) { errorToast(e); }
  };
  return h('div', null,
    pageHead(m.name, { back: '#/maschinen', sub: [m.inventory_no || 'Nr. wird vergeben', m.manufacturer, m.model].filter(Boolean).join(' · '), actions }),
    m.condition === 'defekt' ? h('div', { class: 'notice bad' }, ic('alert'), 'Diese Maschine ist als defekt gemeldet.') : null,
    h('div', { class: 'quick', style: { marginBottom: '12px' } },
      h('a', { href: '#', onclick: (e) => { e.preventDefault(); addEvent('defekt')(); } }, ic('alert'), 'Defekt melden'),
      may('machines.write') ? h('a', { href: '#', onclick: (e) => { e.preventDefault(); addEvent('wartung')(); } }, ic('wrench'), 'Wartung') : null,
      may('machines.write') ? h('a', { href: '#', onclick: (e) => { e.preventDefault(); addEvent('reparatur')(); } }, ic('check'), 'Reparatur') : null,
      may('photos.write') ? h('a', { href: '#', onclick: (e) => { e.preventDefault(); takePhoto({ machine_id: m.id }, { category: 'sonstiges' }); } }, ic('camera'), 'Foto') : null),
    h('div', { class: 'grid two' },
      card('Maschinenakte', kv([
        ['Inventarnummer', m.inventory_no], ['Zustand', badge(condLabel(m.condition), condKind(m.condition))], ['Hersteller', m.manufacturer], ['Modell', m.model],
        ['Seriennummer', m.serial_no], ['Standort', m.location], ['Kaufdatum', fmtDate(m.purchase_date)], ['Kaufpreis', fmtMoney(m.purchase_price)],
        ['Verantwortlich', m.responsible_user_id ? userLabel(m.responsible_user_id) : null], ['Wartungsintervall', m.maintenance_interval_days ? `${m.maintenance_interval_days} Tage` : null],
        ['Nächste Wartung', fmtDate(m.next_maintenance)], ['Notizen', m.notes, true],
      ]), { iconName: 'wrench' }),
      card('QR-Codes', qrs.length ? h('div', { class: 'list' }, qrs.map((q) => row({ title: q.label || 'QR-Code', onclick: () => showQr(q), right: q.active ? null : badge('deaktiviert', 'bad') }))) : empty('Kein QR-Code.'),
        { iconName: 'qr', actions: may('qr.manage') ? [btn('QR erstellen', { cls: 'sm', icon: 'plus', onclick: () => createQr({ target_type: 'machine', machine_id: m.id }) })] : null })),
    card('Wartungen, Reparaturen & Defekte', events.length ? h('div', { class: 'list' }, events.map((e) => h('div', { class: 'row', style: { cursor: 'default' } },
      h('div', { class: 'lead' }, ic(e.kind === 'defekt' ? 'alert' : e.kind === 'reparatur' ? 'check' : 'wrench')),
      h('div', { class: 'grow' }, h('div', { class: 'title' }, `${fmtDate(e.event_date)} · ${KINDS[e.kind]}`), h('div', { class: 'meta', style: { whiteSpace: 'normal' } }, [e.description, e.performed_by, e.cost ? fmtMoney(e.cost) : null, userLabel(e.user_id)].filter(Boolean).join(' · '))),
      e.kind === 'defekt' ? badge(e.status === 'offen' ? 'offen' : 'behoben', e.status === 'offen' ? 'bad' : 'ok') : null))) : empty('Noch keine Einträge.'), { iconName: 'history' }),
    card('Fotos', photoGrid(photos, { canRelease: false, onChange: refresh }), { iconName: 'camera' }),
    may('documents.read') ? documentsCard({ machine_id: m.id }) : null);
}
