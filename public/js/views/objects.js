import { h, ic, card, empty, row, badge, pageHead, btn, kv, searchBox, matches, toast, errorToast, formDialog, tabs, confirmDialog } from '../ui.js';
import * as store from '../store.js';
import { ENTITIES } from '/shared/entities.js';
import { may, entityFormPage, archiveToggle, historyCard, phoneLink, mapLink, orderStatusBadge, defectStatusBadge, userLabel, refOptions, user } from './common.js';
import { fmtDate, todayYmd } from '/shared/dates.js';
import { QR_AREA_TYPES } from '/shared/constants.js';
import { documentsCard } from './documents.js';
import { qrCard } from './qr.js';
import { takePhoto, photoGrid } from '../media.js';
import { refresh, go } from '../app.js';

const def = ENTITIES.objects;
const typeLabel = (v) => def.fields.find((f) => f.name === 'object_type').options.find((o) => o.value === v)?.label || '';
const state = { q: '', archived: false };

export function objectsList() {
  const el = h('div');
  el.append(pageHead(may('objects.write') ? 'Objekte' : 'Meine Objekte', { sub: 'Digitale Objektakten', actions: may('objects.write') ? [btn('Objekt anlegen', { icon: 'plus', cls: 'primary', href: '#/objekte/neu' })] : [] }));
  const box = h('div');
  const draw = () => {
    const rows = store.all('objects', (o) => !!o.archived === state.archived && (matches(o, def.search, state.q) || String(store.get('customers', o.customer_id)?.company_name || '').toLowerCase().includes(state.q)))
      .sort((a, b) => a.name.localeCompare(b.name));
    box.replaceChildren(card(null, rows.length ? h('div', { class: 'list' }, rows.map((o) => row({
      href: `#/objekte/${o.id}`, lead: h('div', { class: 'lead' }, ic('building')), title: o.name,
      meta: [o.object_no, store.get('customers', o.customer_id)?.company_name, [o.street, o.city].filter(Boolean).join(', ')].filter(Boolean).join(' · '),
      right: o.object_type ? badge(typeLabel(o.object_type), 'outline') : null,
    }))) : empty(state.q ? 'Keine Treffer.' : 'Keine Objekte vorhanden.', 'building')));
  };
  el.append(h('div', { class: 'toolbar' }, searchBox('Objekte suchen (Name, Nr., Adresse, Kunde)', (q) => { state.q = q; draw(); }, state.q),
    may('objects.write') ? h('div', { class: 'chips' }, [['Aktiv', false], ['Archiviert', true]].map(([l, v]) => h('button', { class: 'chip' + (state.archived === v ? ' active' : ''), onclick: (e) => { state.archived = v; e.target.parentNode.querySelectorAll('.chip').forEach((c) => c.classList.toggle('active', c === e.target)); draw(); } }, l))) : null));
  el.append(box);
  draw();
  return el;
}

export function objectForm({ params, query }) {
  const id = params[0];
  const fixed = !id && query.customer ? { customer_id: query.customer } : {};
  return entityFormPage('objects', id, { fixed, back: id ? `#/objekte/${id}` : (query.customer ? `#/kunden/${query.customer}` : '#/objekte'), after: (nid) => { location.hash = `#/objekte/${nid}`; } });
}

const tabState = {};
export function objectDetail({ params, query }) {
  const o = store.get('objects', params[0]);
  if (!o) return h('div', { class: 'notice bad' }, 'Objekt nicht gefunden, nicht synchronisiert oder Ihnen nicht zugeordnet.');
  const cust = store.get('customers', o.customer_id);
  const tab = tabState[o.id] || 'uebersicht';
  const u = user();
  const el = h('div');
  const actions = [];
  if (may('objects.write')) {
    actions.push(btn('Bearbeiten', { icon: 'edit', href: `#/objekte/${o.id}/bearbeiten` }));
    actions.push(btn(o.archived ? 'Reaktivieren' : 'Archivieren', { icon: 'archive', onclick: () => archiveToggle('objects', o) }));
  }
  el.append(pageHead(o.name, { back: may('customers.read') && cust ? `#/kunden/${cust.id}` : '#/objekte', sub: [o.object_no || 'Objekt-ID wird bei Sync vergeben', cust?.company_name].filter(Boolean).join(' · '), actions }));

  if (query.bereich) {
    el.append(h('div', { class: 'notice ok' }, ic('qr'), h('div', null, h('strong', null, `Bereich: ${query.bereich}`), h('div', { class: 'small' }, 'Über QR-Code gescannt.'))));
  }

  // Schnellaktionen (Außendienst)
  const today = todayYmd();
  const todays = store.all('orders', (x) => x.object_id === o.id && x.scheduled_date <= today && !x.completed_at && (may('orders.write') || x.assigned_user_id === u.id))
    .sort((a, b) => a.scheduled_date.localeCompare(b.scheduled_date));
  const openWork = store.all('time_entries', (e) => e.user_id === u.id && e.kind === 'arbeit' && !e.end_at && !e.voided)[0];
  const quick = h('div', { class: 'quick', style: { marginBottom: '12px' } });
  for (const x of todays.slice(0, 2)) quick.append(h('a', { href: `#/auftraege/${x.id}`, class: 'primary' }, ic('play'), `${x.scheduled_date < today ? 'Überfällig: ' : 'Heute: '}${store.get('services', x.service_id)?.name || 'Auftrag'}`));
  if (may('time.own')) {
    quick.append(h('a', { href: '#', onclick: async (e) => {
      e.preventDefault();
      try {
        if (openWork && openWork.object_id === o.id) { await store.command('time.clock', { action: 'stop' }); toast('Arbeitsende gestempelt.'); }
        else {
          if (openWork) await store.command('time.clock', { action: 'stop' });
          await store.command('time.clock', { id: store.uuid(), action: 'start', object_id: o.id });
          toast(`Arbeitsbeginn für „${o.name}“ gestempelt.`);
        }
      } catch (ex) { errorToast(ex); }
    } }, ic('clock'), openWork?.object_id === o.id ? 'Hier ausstempeln' : 'Hier einstempeln'));
  }
  if (may('photos.write')) quick.append(h('a', { href: '#', onclick: (e) => { e.preventDefault(); takePhoto({ object_id: o.id }, { category: 'sonstiges' }); } }, ic('camera'), 'Foto aufnehmen'));
  if (may('defects.report')) quick.append(h('a', { href: `#/maengel/neu?object=${o.id}` }, ic('alert'), 'Mangel melden'));
  el.append(quick);

  const orders = store.all('orders', (x) => x.object_id === o.id).sort((a, b) => b.scheduled_date.localeCompare(a.scheduled_date));
  const photos = store.all('photos', (p) => p.object_id === o.id);
  const defects = store.all('defects', (d) => d.object_id === o.id);
  const qrs = store.all('qr_codes', (q) => q.object_id === o.id);
  const tabList = [
    { key: 'uebersicht', label: 'Objektakte' }, { key: 'auftraege', label: 'Aufträge', count: orders.length },
    { key: 'qr', label: 'QR-Codes', count: qrs.length }, { key: 'fotos', label: 'Fotos', count: photos.length },
  ];
  if (may(['quality.read', 'defects.report'])) tabList.push({ key: 'maengel', label: 'Mängel', count: defects.filter((d) => ['offen', 'in_bearbeitung'].includes(d.status)).length });
  if (may('winter.read')) tabList.push({ key: 'winter', label: 'Winterdienst' });
  if (may('documents.read')) tabList.push({ key: 'dokumente', label: 'Dokumente' });
  tabList.push({ key: 'historie', label: 'Historie' });
  el.append(tabs(tabList, tab, (k) => { tabState[o.id] = k; refresh(); }));

  if (tab === 'uebersicht') {
    const assigned = store.all('object_employees', (x) => x.object_id === o.id).map((x) => store.get('users', x.user_id)).filter(Boolean);
    el.append(h('div', { class: 'grid two' },
      card('Objektdaten', kv([
        ['Objekt-ID', o.object_no], ['Objektart', typeLabel(o.object_type)], ['Kunde', cust?.company_name],
        ['Adresse', mapLink(o.street, o.zip, o.city), true], ['Ansprechpartner vor Ort', o.contact_person], ['Telefon vor Ort', phoneLink(o.contact_phone)],
        ['Fläche', o.area_sqm ? `${String(o.area_sqm).replace('.', ',')} m²` : ''], ['Etagen / Räume', [o.floors, o.rooms].some((x) => x != null) ? `${o.floors ?? '–'} / ${o.rooms ?? '–'}` : ''],
        ['Reinigungsintervall', o.cleaning_interval, true], ['Vertragsinformationen', o.contract_info, true], ['Notizen', o.notes, true],
      ]), { iconName: 'building' }),
      h('div', null,
        o.access_notes ? card('Zugangs- und Sicherheitshinweise', h('div', { class: 'card-pad', style: { whiteSpace: 'pre-line' } }, o.access_notes), { iconName: 'key' }) : null,
        card('Zugeordnete Mitarbeiter', assigned.length ? h('div', { class: 'list' }, assigned.map((a) => row({ title: a.name, meta: a.employee_no, href: may('users.read') ? `#/mitarbeiter/${a.id}` : undefined }))) : empty('Keine Mitarbeiter zugeordnet.'),
          { iconName: 'users', actions: may('objects.write') ? [btn('Ändern', { cls: 'sm', onclick: () => editEmployees(o, assigned) })] : null }))));
  } else if (tab === 'auftraege') {
    if (may('orders.write')) el.append(h('div', { class: 'btn-row', style: { marginBottom: '12px' } }, btn('Auftrag anlegen', { icon: 'plus', cls: 'primary', href: `#/auftraege/neu?object=${o.id}` }), btn('Serienauftrag', { icon: 'repeat', href: `#/serien/neu?object=${o.id}` })));
    el.append(card(null, orders.length ? h('div', { class: 'list' }, orders.slice(0, 150).map((x) => row({
      href: `#/auftraege/${x.id}`, title: `${fmtDate(x.scheduled_date)}${x.scheduled_time ? ', ' + x.scheduled_time : ''} · ${store.get('services', x.service_id)?.name || 'Auftrag'}`,
      meta: [x.order_no, userLabel(x.assigned_user_id)].filter(Boolean).join(' · '), right: orderStatusBadge(x.status),
    }))) : empty('Keine Aufträge.')));
  } else if (tab === 'qr') {
    el.append(qrCard({ object: o }));
  } else if (tab === 'fotos') {
    if (may('photos.write')) el.append(h('div', { style: { marginBottom: '12px' } }, btn('Foto aufnehmen', { icon: 'camera', cls: 'primary', onclick: () => takePhoto({ object_id: o.id }) })));
    el.append(card('Fotodokumentation', photoGrid(photos, { canRelease: may('photos.release'), onChange: refresh }), { iconName: 'image', actions: may('reports.create') && !navigator.onLine ? null : [h('a', { class: 'btn sm', href: `/api/reports/photos?object_id=${o.id}`, target: '_blank' }, ic('print'), 'PDF')] }));
  } else if (tab === 'maengel') {
    if (may('defects.report')) el.append(h('div', { style: { marginBottom: '12px' } }, btn('Mangel melden', { icon: 'alert', cls: 'primary', href: `#/maengel/neu?object=${o.id}` })));
    el.append(card(null, defects.length ? h('div', { class: 'list' }, defects.sort((a, b) => b.reported_at.localeCompare(a.reported_at)).map((d) => row({
      href: `#/maengel/${d.id}`, title: d.title, meta: [d.defect_no, fmtDate(d.reported_at), d.due_date ? 'Frist ' + fmtDate(d.due_date) : null].filter(Boolean).join(' · '), right: defectStatusBadge(d.status),
    }))) : empty('Keine Mängel erfasst.', 'shield')));
  } else if (tab === 'winter') {
    const areas = store.all('winter_areas', (a) => a.object_id === o.id).sort((a, b) => (a.priority || 9) - (b.priority || 9));
    el.append(card('Einsatzflächen', areas.length ? h('div', { class: 'list' }, areas.map((a) => row({
      title: a.name, meta: [a.kind, a.area_sqm ? `${a.area_sqm} m²` : null, a.notes].filter(Boolean).join(' · '),
      onclick: may('winter.write') ? () => editArea(o, a) : undefined,
    }))) : empty('Keine Winterdienstflächen hinterlegt.', 'snow'), { iconName: 'snow', actions: may('winter.write') ? [btn('Fläche hinzufügen', { cls: 'sm', icon: 'plus', onclick: () => editArea(o) })] : null }));
    if (may('winter.execute')) el.append(h('div', { style: { marginTop: '12px' } }, btn('Winterdiensteinsatz starten', { icon: 'snow', cls: 'primary lg', href: `#/winter/einsatz/neu?object=${o.id}` })));
  } else if (tab === 'dokumente') {
    el.append(documentsCard({ object_id: o.id, customer_id: o.customer_id }));
  } else if (tab === 'historie') {
    el.append(historyCard('objects', o.id));
  }
  return el;
}

async function editEmployees(o, assigned) {
  const options = refOptions('users');
  const v = await formDialog('Mitarbeiter zuordnen', [{ name: 'ids', label: 'Mitarbeiter mit Zugriff auf dieses Objekt', type: 'checkboxes', options }], { ids: assigned.map((a) => a.id) });
  if (!v) return;
  try { const r = await store.command('object.setEmployees', { object_id: o.id, user_ids: v.ids }); toast(r.queued ? 'Wird bei Verbindung übertragen.' : 'Zuordnung gespeichert.'); } catch (e) { errorToast(e); }
}

async function editArea(o, a) {
  const fields = ENTITIES.winter_areas.fields.filter((f) => f.name !== 'object_id');
  const v = await formDialog(a ? 'Einsatzfläche bearbeiten' : 'Einsatzfläche hinzufügen', fields, a || {});
  if (!v) return;
  try { await store.command('entity.save', { entity: 'winter_areas', id: a?.id || store.uuid(), data: { ...v, object_id: o.id }, base_version: a?.version }); toast('Gespeichert.'); } catch (e) { errorToast(e); }
}

export { QR_AREA_TYPES, go, confirmDialog };
