import { h, ic, card, empty, row, badge, pageHead, btn, kv, toast, errorToast, formDialog, searchBox, matches } from '../ui.js';
import * as store from '../store.js';
import { ENTITIES } from '/shared/entities.js';
import { may, entityFormPage, archiveToggle, refOptions, userLabel } from './common.js';
import { isLowStock } from '/shared/rules.js';
import { fmtDateTime, fmtMoney, fmtNumber } from '/shared/dates.js';
import { createQr, showQr } from './qr.js';

const def = ENTITIES.materials;
const catLabel = (v) => def.fields.find((f) => f.name === 'category').options.find((o) => o.value === v)?.label || v;
const st = { q: '', cat: '', low: false };

export function materialsList({ query }) {
  if (query.filter === 'niedrig') st.low = true;
  const el = h('div', null, pageHead('Material & Inventar', { sub: 'Reinigungsmittel, Verbrauchsmaterial, Werkzeuge, Arbeitskleidung, Ersatzteile', actions: [
    h('a', { class: 'btn', href: '/api/export/materials.csv' }, ic('download'), 'CSV'),
    may('materials.write') ? btn('Artikel anlegen', { icon: 'plus', cls: 'primary', href: '#/material/neu' }) : null,
  ].filter(Boolean) }));
  const box = h('div');
  const draw = () => {
    const rows = store.all('materials', (m) => !m.archived && (!st.cat || m.category === st.cat) && (!st.low || isLowStock(m)) && matches(m, def.search, st.q)).sort((a, b) => a.name.localeCompare(b.name));
    box.replaceChildren(card(null, rows.length ? h('div', { class: 'list' }, rows.map((m) => row({
      href: `#/material/${m.id}`, lead: h('div', { class: 'lead' }, ic('box')), title: m.name,
      meta: [m.article_no, catLabel(m.category), m.location].filter(Boolean).join(' · '),
      right: badge(`${fmtNumber(m.stock)} ${m.unit || ''}`, isLowStock(m) ? 'warn' : 'outline'),
    }))) : empty('Keine Artikel gefunden.', 'box')));
  };
  el.append(h('div', { class: 'toolbar' }, searchBox('Suchen (Name, Artikelnr., Barcode, Lieferant)', (q) => { st.q = q; draw(); }, st.q),
    h('select', { style: { width: 'auto' }, onchange: (e) => { st.cat = e.target.value; draw(); } }, h('option', { value: '' }, 'Alle Kategorien'), def.fields.find((f) => f.name === 'category').options.map((o) => h('option', { value: o.value, selected: st.cat === o.value }, o.label))),
    h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: st.low, onchange: (e) => { st.low = e.target.checked; draw(); } }), 'Nur unter Mindestbestand')));
  el.append(box);
  draw();
  return el;
}

export function materialForm({ params }) {
  const id = params[0];
  return entityFormPage('materials', id, { back: id ? `#/material/${id}` : '#/material', after: (nid) => { location.hash = `#/material/${nid}`; } });
}

const KINDS = { verbrauch: 'Verbrauch', zugang: 'Zugang', korrektur: 'Korrektur', inventur: 'Inventur', anfangsbestand: 'Anfangsbestand' };

export function materialDetail({ params, query }) {
  const m = store.get('materials', params[0]);
  if (!m) return h('div', { class: 'notice bad' }, 'Artikel nicht gefunden.');
  const moves = store.all('stock_movements', (x) => x.material_id === m.id).sort((a, b) => b.moved_at.localeCompare(a.moved_at)).slice(0, 100);
  const qrs = store.all('qr_codes', (q) => q.material_id === m.id);
  const actions = [];
  if (may('materials.write')) {
    actions.push(btn('Bearbeiten', { icon: 'edit', href: `#/material/${m.id}/bearbeiten` }));
    actions.push(btn('Archivieren', { icon: 'archive', onclick: () => archiveToggle('materials', m) }));
  }
  const book = (kind) => async () => {
    const labels = { verbrauch: 'Verbrauch buchen', zugang: 'Wareneingang buchen', inventur: 'Inventur (gezählter Bestand)', korrektur: 'Bestandskorrektur (±)' };
    const v = await formDialog(labels[kind], [
      { name: 'qty', label: kind === 'inventur' ? `Gezählter Bestand (${m.unit || ''})` : `Menge (${m.unit || ''})`, type: 'number', required: true },
      kind === 'verbrauch' ? { name: 'object_id', label: 'Objekt (optional)', type: 'ref', refOptions: refOptions('objects') } : null,
      { name: 'note', label: kind === 'korrektur' ? 'Grund (Pflicht)' : 'Notiz', type: 'text', required: kind === 'korrektur' },
    ].filter(Boolean), {});
    if (!v) return;
    try {
      const r = await store.command('stock.move', { id: store.uuid(), material_id: m.id, qty: v.qty, kind, object_id: v.object_id || null, note: v.note });
      const after = store.get('materials', m.id);
      toast(`Gebucht. Neuer Bestand: ${fmtNumber(after?.stock)} ${m.unit || ''}${r.queued ? ' (offline)' : ''}`);
      if (after && isLowStock(after)) toast('Achtung: Mindestbestand erreicht oder unterschritten!', 'warn', 6000);
    } catch (e) { errorToast(e); }
  };
  return h('div', null,
    pageHead(m.name, { back: '#/material', sub: [m.article_no || 'Nr. wird vergeben', catLabel(m.category)].join(' · '), actions }),
    query.scan ? h('div', { class: 'notice ok' }, ic('scan'), 'Artikel per Scan geöffnet.') : null,
    isLowStock(m) ? h('div', { class: 'notice warn' }, ic('alert'), `Mindestbestand (${fmtNumber(m.min_stock)} ${m.unit || ''}) erreicht oder unterschritten – bitte nachbestellen${m.supplier ? ' bei ' + m.supplier : ''}.`) : null,
    card(null, h('div', { class: 'clock' }, h('div', { class: 'state' }, 'Aktueller Bestand'), h('div', { class: 'big' }, `${fmtNumber(m.stock)}`), h('div', { class: 'muted' }, `${m.unit || ''} · Mindestbestand ${fmtNumber(m.min_stock)}`),
      h('div', { class: 'btn-row stretch', style: { marginTop: '14px' } },
        may(['materials.consume', 'materials.write']) ? btn('Verbrauch', { icon: 'minus', cls: 'primary lg', onclick: book('verbrauch') }) : null,
        may('materials.write') ? btn('Zugang', { icon: 'plus', cls: 'lg', onclick: book('zugang') }) : null),
      may('materials.write') ? h('div', { class: 'btn-row stretch', style: { marginTop: '8px' } }, btn('Inventur', { cls: 'sm', onclick: book('inventur') }), btn('Korrektur', { cls: 'sm', onclick: book('korrektur') })) : null)),
    h('div', { class: 'grid two' },
      card('Artikeldaten', kv([
        ['Artikelnummer', m.article_no], ['Barcode / EAN', m.barcode], ['Kategorie', catLabel(m.category)], ['Einheit', m.unit],
        ['Einkaufspreis', fmtMoney(m.purchase_price)], ['Lieferant', m.supplier], ['Lagerort', m.location], ['Bestandswert', m.purchase_price ? fmtMoney(m.purchase_price * m.stock) : null], ['Notizen', m.notes, true],
      ]), { iconName: 'info' }),
      card('QR-Codes', qrs.length ? h('div', { class: 'list' }, qrs.map((q) => row({ title: q.label || 'QR-Code', onclick: () => showQr(q), right: q.active ? null : badge('deaktiviert', 'bad') }))) : empty('Kein QR-Code. Alternativ kann der Hersteller-Barcode gescannt werden.'),
        { iconName: 'qr', actions: may('qr.manage') ? [btn('QR erstellen', { cls: 'sm', icon: 'plus', onclick: () => createQr({ target_type: 'material', material_id: m.id }) })] : null })),
    card('Bestandsbewegungen', moves.length ? h('div', { class: 'list' }, moves.map((x) => h('div', { class: 'row', style: { cursor: 'default' } },
      h('div', { class: 'grow' }, h('div', { class: 'title' }, `${KINDS[x.kind] || x.kind}${x.object_id ? ' · ' + (store.get('objects', x.object_id)?.name || '') : ''}`),
        h('div', { class: 'meta' }, [fmtDateTime(x.moved_at), userLabel(x.user_id), x.note].filter(Boolean).join(' · '))),
      h('strong', { style: { color: x.qty < 0 ? 'var(--bad)' : 'var(--ok)' } }, `${x.qty > 0 ? '+' : ''}${fmtNumber(x.qty)}`)))) : empty('Noch keine Bewegungen.'), { iconName: 'history' }));
}
