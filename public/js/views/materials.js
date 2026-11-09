// Inventar: Scanbereich (immer empfangsbereit), Gesamtbestand (Artikel + Maschinen), Artikelakte.
import { h, ic, card, empty, row, badge, pageHead, btn, kv, toast, errorToast, searchBox, matches, openUrl } from '../ui.js';
import * as store from '../store.js';
import { api } from '../api.js';
import { ENTITIES } from '/shared/entities.js';
import { may, entityFormPage, archiveToggle, userLabel } from './common.js';
import { isLowStock } from '/shared/rules.js';
import { MATERIAL_CATEGORIES, MACHINE_TYPES, MATERIAL_STATUS, MOVEMENT_KINDS, categoryLabel, categoryMode, availableQty, normalizeCode } from '/shared/inventory.js';
import { fmtDateTime, fmtMoney, fmtNumber } from '/shared/dates.js';
import { setScanConsumer, scanWithCamera, injectScan, scannerConfig } from '../scanner.js';
import { createQr, showQr } from './qr.js';
import { itemCard, lookupLocal, createFromBarcode, bookDialog, newCode } from './inventory-actions.js';
import { go, refresh } from '../app.js';

const def = ENTITIES.materials;
const st = { q: '', type: '', low: false };
const scans = []; // letzte Scan-Ergebnisse (neueste zuerst)
let pending = null;
let resultsBox = null;
let statusEl = null;

/** Von überall aufrufbar: Inventar öffnen und Code dort verarbeiten */
export function openInventoryScan(code) {
  if (location.hash.split('?')[0] === '#/material' && resultsBox?.isConnected) return processScan(code, 'scanner');
  pending = code;
  go('#/material');
}

async function processScan(raw, method) {
  const code = normalizeCode(raw);
  if (!code) return;
  let hit = lookupLocal(code);
  if (!hit && navigator.onLine) {
    try { const r = await api('GET', `/api/inventory/lookup?code=${encodeURIComponent(code)}`); if (r.hit) { await store.pull().catch(() => {}); hit = lookupLocal(code) || { ...r.hit, item: r.item }; } } catch { /* offline/kein Treffer */ }
  }
  const entry = { code, method, at: new Date().toISOString(), hit: hit ? { type: hit.type, id: hit.id } : null };
  scans.unshift(entry);
  scans.splice(6);
  flash(hit ? `Erkannt: ${hit.item.name}` : `Unbekannter Barcode: ${code}`, hit ? 'ok' : 'warn');
  drawResults();
  if (!hit && may(['materials.write', 'machines.write']) && !document.querySelector('.modal-back')) {
    await createFromBarcode(code, (type, id) => { entry.hit = { type, id }; drawResults(); });
  }
}

function flash(text, kind) {
  if (!statusEl) return;
  statusEl.className = `inv-status ${kind}`;
  statusEl.lastChild.textContent = text;
  clearTimeout(flash.t);
  flash.t = setTimeout(() => { if (statusEl) { statusEl.className = 'inv-status'; statusEl.lastChild.textContent = 'Scanner bereit – einfach scannen, kein Klick nötig'; } }, 2500);
}

function drawResults() {
  if (!resultsBox) return;
  if (!scans.length) { resultsBox.replaceChildren(); return; }
  resultsBox.replaceChildren(...scans.map((s, i) => {
    const item = s.hit && store.get(s.hit.type === 'material' ? 'materials' : 'machines', s.hit.id);
    const time = h('div', { class: 'tiny muted', style: { margin: i ? '14px 0 4px' : '0 0 4px' } }, `${i === 0 ? 'Letzter Scan' : 'Früherer Scan'} · ${new Date(s.at).toLocaleTimeString('de-DE')} · ${s.code}`);
    if (item) return h('div', { class: i ? 'inv-old' : '' }, time, itemCard(s.hit.type, item, { code: s.code, onChanged: drawResults }));
    return h('div', { class: i ? 'inv-old' : '' }, time, card(null, h('div', { class: 'inv-card' },
      h('div', { class: 'inv-head' }, h('div', { class: 'lead' }, ic('alert')), h('div', { class: 'grow' }, h('h2', null, 'Unbekannter Barcode'), h('div', { class: 'mono' }, s.code))),
      h('p', { class: 'small muted' }, 'Dieser Code ist keinem Inventargegenstand zugeordnet.'),
      may(['materials.write', 'machines.write']) ? h('div', { class: 'btn-row' }, btn('Inventargegenstand anlegen', { icon: 'plus', cls: 'primary', onclick: () => createFromBarcode(s.code, (type, id) => { s.hit = { type, id }; drawResults(); }) })) : h('p', { class: 'small' }, 'Für die Neuanlage fehlt Ihnen die Berechtigung.'))));
  }));
}

function scanPanel() {
  const input = h('input', { type: 'text', placeholder: 'Code manuell eingeben', autocomplete: 'off', 'aria-label': 'Barcode manuell eingeben', inputmode: 'text', dataset: { scanInput: '1' } });
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && input.value.trim()) { e.preventDefault(); const v = input.value; input.value = ''; injectScan(v, 'manuell'); } });
  statusEl = h('div', { class: 'inv-status' }, h('span', { class: 'dot' }), h('span', null, 'Scanner bereit – einfach scannen, kein Klick nötig'));
  const cfg = scannerConfig();
  return card(null, h('div', { class: 'inv-scan' },
    statusEl,
    h('div', { class: 'input-with-btn' }, input, btn('Suchen', { onclick: () => { if (input.value.trim()) { injectScan(input.value, 'manuell'); input.value = ''; } } }), btn('', { icon: 'camera', cls: 'icon-btn', title: 'Mit Kamera scannen', onclick: async () => { const c = await scanWithCamera({ title: 'Barcode scannen' }); if (c) injectScan(c, 'kamera'); } })),
    h('div', { class: 'tiny muted' }, `Honeywell-Scanner: Scantaste drücken. Barcodes, EAN, Artikel-/Inventar-/Seriennummern und GRBZ-QR-Codes werden erkannt.${cfg.prefix ? ' Präfix-Modus aktiv.' : ''}`)));
}

export function materialsList({ query }) {
  if (query.filter === 'niedrig') st.low = true;
  const el = h('div', null, pageHead('Inventar', { sub: 'Scannen, Bestand, Maschinen, Ausgabe und Rücknahme', actions: [
    h('a', { class: 'btn', href: '/api/export/materials.csv' }, ic('download'), 'CSV'),
    may('machines.write') ? btn('Maschine anlegen', { icon: 'wrench', href: '#/maschinen/neu' }) : null,
    may('materials.write') ? btn('Artikel anlegen', { icon: 'plus', cls: 'primary', href: '#/material/neu' }) : null,
  ].filter(Boolean) }));
  el.append(scanPanel());
  resultsBox = h('div', { class: 'inv-results' });
  el.append(resultsBox);
  drawResults();
  // Scanner: solange das Inventar geöffnet ist, gehen alle Scans hierher
  const off = setScanConsumer((code, method) => processScan(code, method));
  const leave = () => { if (location.hash.split('?')[0] !== '#/material') { off(); statusEl = null; resultsBox = null; window.removeEventListener('hashchange', leave); } };
  window.addEventListener('hashchange', leave);
  if (pending) { const c = pending; pending = null; setTimeout(() => processScan(c, 'scanner'), 0); }

  // Gesamtbestand
  const box = h('div');
  const draw = () => {
    const mats = (st.type === 'maschinen' ? [] : store.all('materials', (m) => !m.archived && (!st.type || m.category === st.type) && (!st.low || isLowStock(m)) && matches(m, def.search, st.q)))
      .map((m) => ({ type: 'material', row: m }));
    const machs = (st.type && st.type !== 'maschinen') || st.low || !may('machines.read') ? [] : store.all('machines', (m) => !m.archived && matches(m, ENTITIES.machines.search, st.q)).map((m) => ({ type: 'machine', row: m }));
    const rows = [...mats, ...machs].sort((a, b) => a.row.name.localeCompare(b.row.name));
    box.replaceChildren(card(`Bestand (${rows.length})`, rows.length ? h('div', { class: 'list' }, rows.slice(0, 400).map(({ type, row: m }) => (type === 'material' ? row({
      href: `#/material/${m.id}`, lead: h('div', { class: 'lead' }, ic('box')), title: m.name,
      meta: [m.article_no, categoryLabel(m.category), m.location, m.barcode].filter(Boolean).join(' · '),
      right: h('div', { class: 'btn-row' }, categoryMode(m.category) === 'leihe' && m.issued ? badge(`${fmtNumber(availableQty(m))} verfügbar`, 'outline') : null, badge(`${fmtNumber(m.stock)} ${m.unit || ''}`, isLowStock(m) ? 'warn' : 'outline')),
    }) : row({
      href: `#/maschinen/${m.id}`, lead: h('div', { class: 'lead' }, ic('wrench')), title: m.name,
      meta: [m.inventory_no, MACHINE_TYPES[m.machine_type] || 'Maschine', m.location, m.barcode].filter(Boolean).join(' · '),
      right: badge(m.issued_to_user_id ? `bei ${userLabel(m.issued_to_user_id)}` : 'Einzelstück', m.condition === 'defekt' ? 'bad' : 'outline'),
    })))) : empty('Keine Gegenstände gefunden.', 'box'), { iconName: 'box' }));
  };
  el.append(h('div', { class: 'toolbar', style: { marginTop: '16px' } }, searchBox('Bestand durchsuchen (Name, Nummer, Barcode, Lagerort)', (q) => { st.q = q; draw(); }, st.q),
    h('select', { style: { width: 'auto' }, onchange: (e) => { st.type = e.target.value; draw(); } }, h('option', { value: '' }, 'Alle Gegenstandsarten'),
      Object.entries(MATERIAL_CATEGORIES).map(([v, c]) => h('option', { value: v, selected: st.type === v }, c.label)), h('option', { value: 'maschinen', selected: st.type === 'maschinen' }, 'Maschinen & Einzelgeräte')),
    h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: st.low, onchange: (e) => { st.low = e.target.checked; draw(); } }), 'Nur unter Mindestbestand')));
  el.append(box);
  draw();
  return el;
}

export function materialForm({ params }) {
  const id = params[0];
  return entityFormPage('materials', id, { back: id ? `#/material/${id}` : '#/material', after: (nid) => { location.hash = `#/material/${nid}`; } });
}

export function materialDetail({ params, query }) {
  const m = store.get('materials', params[0]);
  if (!m) return h('div', { class: 'notice bad' }, 'Artikel nicht gefunden.');
  const moves = store.all('stock_movements', (x) => x.material_id === m.id).sort((a, b) => (b.moved_at || '').localeCompare(a.moved_at || '')).slice(0, 100);
  const qrs = store.all('qr_codes', (q) => q.material_id === m.id);
  const actions = [];
  if (may('materials.write')) {
    if (m.barcode) actions.push(btn('Etikett', { icon: 'print', onclick: () => openUrl(`/api/inventory/labels.pdf?items=material:${m.id}`) }));
    actions.push(btn('Archivieren', { icon: 'archive', onclick: () => archiveToggle('materials', m) }));
  }
  const book = (kind) => () => bookDialog(m, kind, refresh);
  return h('div', null,
    pageHead(m.name, { back: '#/material', sub: [m.article_no || 'Nr. wird vergeben', categoryLabel(m.category)].join(' · '), actions }),
    query.scan ? h('div', { class: 'notice ok' }, ic('scan'), 'Artikel per Scan geöffnet.') : null,
    itemCard('material', m, { onChanged: refresh }),
    may('materials.write') ? h('div', { class: 'btn-row', style: { margin: '12px 0' } }, btn('Inventur (Zählbestand)', { cls: 'sm', onclick: () => inventurDialog(m) })) : null,
    h('div', { class: 'grid two' },
      card('Weitere Angaben', kv([
        ['Einheit', m.unit], ['Mindestbestand', fmtNumber(m.min_stock)], ['Einkaufspreis', fmtMoney(m.purchase_price)], ['Lieferant', m.supplier],
        ['Bestandswert', m.purchase_price ? fmtMoney(m.purchase_price * m.stock) : null], ['Notizen', m.notes, true],
      ]), { iconName: 'info' }),
      card('QR-Codes', qrs.length ? h('div', { class: 'list' }, qrs.map((q) => row({ title: q.label || 'QR-Code', onclick: () => showQr(q), right: q.active ? null : badge('deaktiviert', 'bad') }))) : empty('Kein QR-Code. Hersteller-Barcode oder eigener Inventarbarcode genügen zum Scannen.'),
        { iconName: 'qr', actions: may('qr.manage') ? [btn('QR erstellen', { cls: 'sm', icon: 'plus', onclick: () => createQr({ target_type: 'material', material_id: m.id }) })] : null })),
    card('Bestandsbewegungen (Protokoll)', moves.length ? h('div', { class: 'list' }, moves.map((x) => h('div', { class: 'row', style: { cursor: 'default' } },
      h('div', { class: 'grow' }, h('div', { class: 'title' }, `${MOVEMENT_KINDS[x.kind] || x.kind}${x.recipient_user_id ? ' · ' + userLabel(x.recipient_user_id) : ''}${x.object_id ? ' · ' + (store.get('objects', x.object_id)?.name || '') : ''}`),
        h('div', { class: 'meta' }, [fmtDateTime(x.moved_at), userLabel(x.user_id), x.stock_after != null ? `Bestand danach ${fmtNumber(x.stock_after)}` : null, x.note].filter(Boolean).join(' · '))),
      h('strong', { style: { color: x.qty < 0 ? 'var(--bad)' : 'var(--ok)' } }, `${x.qty > 0 ? '+' : ''}${fmtNumber(x.qty)}`)))) : empty('Noch keine Bewegungen.'), { iconName: 'history' }));
}

async function inventurDialog(m) {
  const { formDialog } = await import('../ui.js');
  const v = await formDialog(`Inventur: ${m.name}`, [{ name: 'qty', label: `Gezählter Bestand (${m.unit || 'Stück'})`, type: 'number', required: true }, { name: 'note', label: 'Notiz', type: 'text' }], {});
  if (!v) return;
  try { await store.command('stock.move', { id: store.uuid(), material_id: m.id, qty: v.qty, kind: 'inventur', note: v.note }); toast('Inventur gebucht.'); } catch (e) { errorToast(e); }
}

export { newCode, MATERIAL_STATUS };
