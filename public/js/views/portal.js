// Kundenportal (optional, in den Einstellungen deaktivierbar). Nur online.
import { h, ic, card, empty, row, badge, pageHead, btn, toast, errorToast, formDialog, tabs, modal, openUrl } from '../ui.js';
import { api } from '../api.js';
import * as store from '../store.js';
import { fmtDate, fmtDateTime, fmtNumber } from '/shared/dates.js';
import { DEFECT_STATUS, PHOTO_CATEGORIES } from '/shared/constants.js';
import { refresh, showPasswordChange } from '../app.js';
import { DOC_KINDS } from './documents.js';

const st = { tab: 'leistungen' };
export async function portalView() {
  const d = await api('GET', '/api/portal/overview');
  const objName = (id) => d.objects.find((o) => o.id === id)?.name || '';
  const el = h('div', null, pageHead(d.customer.company_name, { sub: `Kundennummer ${d.customer.customer_no || '–'} · Kundenportal GRBZ Facility Solutions` }));
  el.append(h('div', { class: 'kpis', style: { marginBottom: '14px' } },
    h('div', { class: 'kpi accent' }, h('div', { class: 'label' }, 'Objekte'), h('div', { class: 'value' }, d.objects.length)),
    h('div', { class: 'kpi ok' }, h('div', { class: 'label' }, 'Erledigte Einsätze'), h('div', { class: 'value' }, d.orders.length)),
    h('div', { class: 'kpi' }, h('div', { class: 'label' }, 'Dokumente'), h('div', { class: 'value' }, d.documents.length)),
    h('div', { class: 'kpi warn' }, h('div', { class: 'label' }, 'Offene Reklamationen'), h('div', { class: 'value' }, d.complaints.filter((c) => ['offen', 'in_bearbeitung'].includes(c.status)).length))));
  el.append(tabs([
    { key: 'leistungen', label: 'Leistungsnachweise' }, { key: 'objekte', label: 'Objekte' }, { key: 'fotos', label: 'Fotos' },
    { key: 'qualitaet', label: 'Qualitätsberichte' }, { key: 'dokumente', label: 'Dokumente' }, { key: 'reklamationen', label: 'Reklamationen' },
  ], st.tab, (k) => { st.tab = k; refresh(); }));
  if (st.tab === 'leistungen') {
    el.append(card(null, d.orders.length ? h('div', { class: 'list' }, d.orders.map((o) => row({
      title: `${fmtDate(o.scheduled_date)} · ${objName(o.object_id)}`, meta: [o.service, o.order_no, o.final_report].filter(Boolean).join(' · '),
      right: btn('PDF', { cls: 'sm', icon: 'print', onclick: (e) => { e.stopPropagation(); openUrl(`/api/portal/orders/${o.id}/report.pdf`); } }),
    }))) : empty('Noch keine erledigten Einsätze.')));
  } else if (st.tab === 'objekte') {
    el.append(card(null, d.objects.length ? h('div', { class: 'list' }, d.objects.map((o) => row({ lead: h('div', { class: 'lead' }, ic('building')), title: o.name, meta: [o.object_no, [o.street, o.zip, o.city].filter(Boolean).join(' ')].filter(Boolean).join(' · ') }))) : empty('Keine Objekte.')));
  } else if (st.tab === 'fotos') {
    el.append(card(null, d.photos.length ? h('div', { class: 'photos' }, d.photos.map((p) => h('div', { class: 'photo', onclick: () => modal({ title: PHOTO_CATEGORIES[p.category], wide: true, body: h('div', { class: 'photo-view' }, h('img', { src: `/api/portal/photos/${p.id}`, alt: '' }), h('p', { class: 'small muted' }, `${fmtDateTime(p.taken_at)} · ${objName(p.object_id)}`), p.comment ? h('p', null, p.comment) : null), actions: [{ label: 'Schließen' }] }) },
      h('img', { src: `/api/portal/photos/${p.id}?thumb=1`, alt: '', loading: 'lazy' }), h('span', { class: 'ph-tag' }, PHOTO_CATEGORIES[p.category])))) : empty('Keine freigegebenen Fotos.')));
  } else if (st.tab === 'qualitaet') {
    el.append(card(null, d.inspections.length ? h('div', { class: 'list' }, d.inspections.map((i) => row({
      title: `${fmtDate(i.inspected_at)} · ${objName(i.object_id)}`, meta: i.inspection_no, right: h('div', { class: 'btn-row' }, i.score != null ? badge(`${fmtNumber(i.score, 0)} %`, 'ok') : null, btn('PDF', { cls: 'sm', icon: 'print', onclick: () => openUrl(`/api/portal/inspections/${i.id}/report.pdf`) })),
    }))) : empty('Keine freigegebenen Qualitätsberichte.')));
  } else if (st.tab === 'dokumente') {
    el.append(card(null, d.documents.length ? h('div', { class: 'list' }, d.documents.map((x) => row({ lead: h('div', { class: 'lead' }, ic('file')), title: x.title, meta: `${DOC_KINDS[x.kind] || x.kind} · ${fmtDate(x.created_at)}`, onclick: () => openUrl(`/api/portal/documents/${x.id}`) }))) : empty('Keine Dokumente freigegeben.')));
  } else {
    el.append(h('div', { style: { marginBottom: '12px' } }, btn('Reklamation melden', { icon: 'plus', cls: 'primary', onclick: async () => {
      const v = await formDialog('Reklamation melden', [
        { name: 'object_id', label: 'Objekt', type: 'select', required: true, options: d.objects.map((o) => ({ value: o.id, label: o.name })) },
        { name: 'title', label: 'Betreff', type: 'text', required: true }, { name: 'description', label: 'Beschreibung', type: 'textarea' },
      ], {});
      if (!v) return;
      try { const r = await api('POST', '/api/portal/complaints', v); toast(`Reklamation ${r.complaint.defect_no} wurde übermittelt.`); refresh(); } catch (e) { errorToast(e); }
    } })));
    el.append(card(null, d.complaints.length ? h('div', { class: 'list' }, d.complaints.map((c) => row({
      title: c.title, meta: [c.defect_no, fmtDate(c.reported_at), objName(c.object_id), c.resolution_note ? 'Erledigung: ' + c.resolution_note : null].filter(Boolean).join(' · '),
      right: badge(DEFECT_STATUS[c.status], ['behoben', 'abgenommen'].includes(c.status) ? 'ok' : 'warn'),
    }))) : empty('Keine Reklamationen.')));
  }
  return el;
}

export function portalAccount() {
  const u = store.getUser();
  return h('div', null, pageHead('Mein Zugang', { back: '#/portal', sub: u.email }),
    card(null, h('div', { class: 'card-pad btn-row' }, btn('Passwort ändern', { icon: 'key', onclick: () => showPasswordChange(false) }),
      btn('Abmelden', { icon: 'logout', cls: 'danger', onclick: async () => { await store.logout(true); location.reload(); } }))));
}
