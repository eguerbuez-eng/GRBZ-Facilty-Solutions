import { h, ic, card, empty, row, badge, pageHead, btn, kv, searchBox, matches, toast, errorToast, formDialog, confirmDialog, tabs } from '../ui.js';
import * as store from '../store.js';
import { ENTITIES } from '/shared/entities.js';
import { may, entityFormPage, archiveToggle, historyCard, phoneLink, mailLink, mapLink, orderStatusBadge, pendingBadge, userLabel } from './common.js';
import { fmtDate } from '/shared/dates.js';
import { documentsCard } from './documents.js';
import { refresh } from '../app.js';

const def = ENTITIES.customers;
const opt = (name, v) => def.fields.find((f) => f.name === name).options.find((o) => o.value === v)?.label || v || '';
const state = { q: '', archived: false };

export function customersList() {
  const el = h('div');
  el.append(pageHead('Kunden', { sub: 'Digitale Kundenakten', actions: may('customers.write') ? [btn('Kunde anlegen', { icon: 'plus', cls: 'primary', href: '#/kunden/neu' })] : [] }));
  const listBox = h('div');
  const draw = () => {
    const rows = store.all('customers', (c) => !!c.archived === state.archived && matches(c, def.search, state.q)).sort((a, b) => a.company_name.localeCompare(b.company_name));
    listBox.replaceChildren(card(null, rows.length ? h('div', { class: 'list' }, rows.map((c) => {
      const objs = store.all('objects', (o) => o.customer_id === c.id && !o.archived).length;
      return row({
        href: `#/kunden/${c.id}`, lead: h('div', { class: 'lead' }, ic(c.customer_type === 'privat' ? 'user' : 'briefcase')),
        title: c.company_name, meta: [c.customer_no, c.contact_person, c.billing_city, `${objs} Objekt(e)`].filter(Boolean).join(' · '),
        right: h('div', { class: 'btn-row' }, pendingBadge(c), badge(opt('contract_status', c.contract_status), c.contract_status === 'aktiv' ? 'ok' : '')),
      });
    })) : empty(state.q ? 'Keine Treffer.' : 'Noch keine Kunden angelegt.', 'briefcase')));
  };
  el.append(h('div', { class: 'toolbar' }, searchBox('Kunden suchen (Name, Nr., Ort …)', (q) => { state.q = q; draw(); }, state.q),
    h('div', { class: 'chips' }, [['Aktiv', false], ['Archiviert', true]].map(([l, v]) => h('button', { class: 'chip' + (state.archived === v ? ' active' : ''), onclick: (e) => { state.archived = v; e.target.parentNode.querySelectorAll('.chip').forEach((c) => c.classList.toggle('active', c === e.target)); draw(); } }, l)))));
  el.append(listBox);
  draw();
  return el;
}

export function customerForm({ params }) {
  const id = params[0];
  return entityFormPage('customers', id, { back: id ? `#/kunden/${id}` : '#/kunden', after: (nid) => { location.hash = `#/kunden/${nid}`; } });
}

const tabState = {};
export function customerDetail({ params }) {
  const c = store.get('customers', params[0]);
  if (!c) return h('div', { class: 'notice bad' }, 'Kunde nicht gefunden oder nicht synchronisiert.');
  const tab = tabState[c.id] || 'akte';
  const el = h('div');
  const actions = [];
  if (may('customers.write')) {
    actions.push(btn('Bearbeiten', { icon: 'edit', href: `#/kunden/${c.id}/bearbeiten` }));
    actions.push(btn(c.archived ? 'Reaktivieren' : 'Archivieren', { icon: 'archive', onclick: () => archiveToggle('customers', c) }));
  }
  el.append(pageHead(c.company_name, { back: '#/kunden', sub: [c.customer_no || 'Nr. wird bei Sync vergeben', opt('customer_type', c.customer_type)].join(' · '), actions }));
  if (c.archived) el.append(h('div', { class: 'notice warn' }, ic('archive'), 'Dieser Kunde ist archiviert.'));
  const objects = store.all('objects', (o) => o.customer_id === c.id).sort((a, b) => a.name.localeCompare(b.name));
  const orders = store.all('orders', (o) => o.customer_id === c.id).sort((a, b) => b.scheduled_date.localeCompare(a.scheduled_date));
  const contacts = store.all('contact_history', (x) => x.customer_id === c.id).sort((a, b) => b.contact_date.localeCompare(a.contact_date));
  el.append(tabs([
    { key: 'akte', label: 'Kundenakte' }, { key: 'objekte', label: 'Objekte', count: objects.length },
    { key: 'kontakte', label: 'Kontakthistorie', count: contacts.length }, { key: 'auftraege', label: 'Aufträge', count: orders.length },
    { key: 'dokumente', label: 'Dokumente' }, { key: 'historie', label: 'Historie' },
  ], tab, (k) => { tabState[c.id] = k; refresh(); }));

  if (tab === 'akte') {
    const svcIds = new Set(store.all('customer_services', (cs) => cs.customer_id === c.id).map((cs) => cs.service_id));
    const services = store.all('services', (s) => svcIds.has(s.id));
    el.append(h('div', { class: 'grid two' },
      card('Stammdaten', kv([
        ['Kundennummer', c.customer_no], ['Kundenart', opt('customer_type', c.customer_type)], ['Ansprechpartner', c.contact_person],
        ['Telefon', phoneLink(c.phone)], ['E-Mail', mailLink(c.email)],
        ['Rechnungsadresse', mapLink(c.billing_street, c.billing_zip, c.billing_city), true], ['Vertragsstatus', opt('contract_status', c.contract_status)],
        ['Notizen', c.notes, true],
      ]), { iconName: 'briefcase' }),
      card('Zugeordnete Dienstleistungen', h('div', { class: 'card-pad' }, services.length ? h('div', { class: 'chips' }, services.map((s) => badge(s.name, 'accent'))) : h('span', { class: 'muted' }, 'Keine Dienstleistungen zugeordnet.')),
        { iconName: 'checkCircle', actions: may('customers.write') ? [btn('Ändern', { cls: 'sm', onclick: () => editServices(c, svcIds) })] : null })));
    el.append(h('div', { class: 'grid two' },
      card('Objekte', objects.length ? h('div', { class: 'list' }, objects.slice(0, 6).map(objRow)) : empty('Keine Objekte.'), { iconName: 'building', actions: may('objects.write') ? [btn('Objekt anlegen', { cls: 'sm', icon: 'plus', href: `#/objekte/neu?customer=${c.id}` })] : null }),
      card('Letzte Kontakte', contacts.length ? h('div', { class: 'list' }, contacts.slice(0, 4).map(contactRow)) : empty('Noch keine Kontakte erfasst.'), { iconName: 'phone' })));
  } else if (tab === 'objekte') {
    el.append(card(null, objects.length ? h('div', { class: 'list' }, objects.map(objRow)) : empty('Keine Objekte.'), {}));
    if (may('objects.write')) el.append(h('div', { style: { marginTop: '12px' } }, btn('Objekt anlegen', { icon: 'plus', cls: 'primary', href: `#/objekte/neu?customer=${c.id}` })));
  } else if (tab === 'kontakte') {
    el.append(card('Kontakthistorie', contacts.length ? h('div', { class: 'list' }, contacts.map((x) => contactRow(x, true))) : empty('Noch keine Kontakte erfasst.'),
      { iconName: 'phone', actions: may('customers.write') ? [btn('Kontakt erfassen', { cls: 'sm primary', icon: 'plus', onclick: () => addContact(c) })] : null }));
  } else if (tab === 'auftraege') {
    el.append(card(null, orders.length ? h('div', { class: 'list' }, orders.slice(0, 100).map((o) => row({
      href: `#/auftraege/${o.id}`, title: `${fmtDate(o.scheduled_date)} · ${store.get('objects', o.object_id)?.name || ''}`,
      meta: [o.order_no, store.get('services', o.service_id)?.name, userLabel(o.assigned_user_id)].filter(Boolean).join(' · '), right: orderStatusBadge(o.status),
    }))) : empty('Keine Aufträge.')));
  } else if (tab === 'dokumente') {
    el.append(documentsCard({ customer_id: c.id }));
  } else if (tab === 'historie') {
    el.append(historyCard('customers', c.id));
  }
  return el;
}

function objRow(o) {
  return row({ href: `#/objekte/${o.id}`, lead: h('div', { class: 'lead' }, ic('building')), title: o.name, meta: [o.object_no, [o.street, o.city].filter(Boolean).join(', ')].filter(Boolean).join(' · '), right: o.archived ? badge('archiviert') : null });
}

const CHANNELS = { telefon: 'Telefon', email: 'E-Mail', vor_ort: 'Vor Ort', brief: 'Brief', sonstiges: 'Sonstiges' };
function contactRow(x, withDelete) {
  return h('div', { class: 'row', style: { cursor: 'default' } },
    h('div', { class: 'lead' }, ic(x.channel === 'email' ? 'mail' : x.channel === 'vor_ort' ? 'map' : 'phone')),
    h('div', { class: 'grow' }, h('div', { class: 'title' }, x.subject), h('div', { class: 'meta' }, `${fmtDate(x.contact_date)} · ${CHANNELS[x.channel] || ''}${x.user_id ? ' · ' + userLabel(x.user_id) : ''}`),
      x.notes ? h('div', { class: 'small', style: { marginTop: '4px', whiteSpace: 'pre-line' } }, x.notes) : null),
    withDelete && may('customers.write') ? h('button', { class: 'btn ghost icon-btn', 'aria-label': 'Löschen', onclick: async () => {
      if (await confirmDialog('Kontakteintrag löschen?', { danger: true, ok: 'Löschen' })) await store.command('entity.delete', { entity: 'contact_history', id: x.id }).catch(errorToast);
    } }, ic('trash')) : null);
}

async function addContact(c) {
  const fields = ENTITIES.contact_history.fields.filter((f) => f.name !== 'customer_id');
  const v = await formDialog('Kontakt erfassen', fields, {});
  if (!v) return;
  try { await store.command('entity.save', { entity: 'contact_history', id: store.uuid(), data: { ...v, customer_id: c.id } }); toast('Kontakt gespeichert.'); } catch (e) { errorToast(e); }
}

async function editServices(c, current) {
  const options = store.all('services', (s) => s.active).sort((a, b) => a.name.localeCompare(b.name)).map((s) => ({ value: s.id, label: s.name }));
  const v = await formDialog('Dienstleistungen zuordnen', [{ name: 'ids', label: 'Dienstleistungen', type: 'checkboxes', options }], { ids: [...current] });
  if (!v) return;
  try {
    const r = await store.command('customer.setServices', { customer_id: c.id, service_ids: v.ids });
    toast(r.queued ? 'Wird bei Verbindung übertragen.' : 'Gespeichert.');
  } catch (e) { errorToast(e); }
}
