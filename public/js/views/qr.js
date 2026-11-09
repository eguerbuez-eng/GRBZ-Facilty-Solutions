import { h, ic, card, empty, row, badge, pageHead, btn, toast, errorToast, modal, formDialog, confirmDialog, searchBox, matches, tabs, openUrl } from '../ui.js';
import * as store from '../store.js';
import { scanWithCamera, parseToken, suspendWedge } from '../scanner.js';
import { may, refOptions, userLabel } from './common.js';
import { QR_AREA_TYPES, QR_TARGET_TYPES } from '/shared/constants.js';
import { fmtDateTime } from '/shared/dates.js';
import { go, refresh } from '../app.js';
import { findInventory } from '/shared/inventory.js';
import { openInventoryScan } from './materials.js';

// ---------- Scan-Verarbeitung ----------
function findLocal(raw) {
  const s = String(raw || '').trim();
  const token = parseToken(s);
  let qr = token ? store.all('qr_codes', (q) => q.token === token)[0] : null;
  if (!qr && /^GRBZ-QR-\d+$/i.test(s)) qr = store.all('qr_codes', (q) => q.label === s.toUpperCase())[0];
  if (qr) return { qr };
  if (/^GRBZ-OBJ-\d+$/i.test(s)) { const o = store.all('objects', (x) => x.object_no === s.toUpperCase())[0]; if (o) return { target: { type: 'object', id: o.id } }; }
  const inv = findInventory(s, { materials: store.all('materials'), machines: store.all('machines'), qr_codes: [] });
  if (inv) return { target: { type: inv.type, id: inv.id } };
  return { token };
}

function targetOf(qr) {
  if (qr.target_type === 'object' || qr.target_type === 'area') return { type: 'object', id: qr.object_id, area_name: qr.area_name };
  if (qr.target_type === 'machine') return { type: 'machine', id: qr.machine_id };
  return { type: 'material', id: qr.material_id };
}

function navigateTo(t, code) {
  if (t.type === 'object') go(`#/objekte/${t.id}${t.area_name ? '?bereich=' + encodeURIComponent(t.area_name) : ''}`);
  // Inventar (Artikel/Maschine): Ergebnis direkt im Inventar-Scanbereich anzeigen
  else openInventoryScan(code);
}

let busy = false;
export async function handleScan(raw, method = 'manuell') {
  if (busy) return;
  busy = true;
  try {
    const local = findLocal(raw);
    const id = store.uuid();
    if (local.qr) {
      if (!local.qr.active) {
        store.command('scan.log', { id, raw, method, local_result: 'inaktiv' }).catch(() => {});
        toast(`QR-Code ${local.qr.label} ist deaktiviert.`, 'bad');
        return;
      }
      const t = targetOf(local.qr);
      store.command('scan.log', { id, raw, method, local_result: 'ok' }).catch(() => {});
      navigator.vibrate?.(40);
      navigateTo(t, raw);
      return;
    }
    if (local.target) {
      store.command('scan.log', { id, raw, method, local_result: 'ok' }).catch(() => {});
      navigateTo(local.target, raw);
      return;
    }
    // Unbekannter Barcode (kein GRBZ-QR): Inventar öffnen und Neuanlage anbieten
    if (!local.token && may(['materials.write', 'machines.write'])) {
      store.command('scan.log', { id, raw, method, local_result: 'unbekannt' }).catch(() => {});
      openInventoryScan(raw);
      return;
    }
    // Nicht lokal bekannt → Server fragen (falls online)
    const r = await store.command('scan.log', { id, raw, method, local_result: 'unbekannt' });
    if (r.synced && r.result === 'ok' && r.target) { navigateTo(r.target, raw); return; }
    const msg = r.queued ? 'Code nicht in den lokalen Daten gefunden (offline). Bitte nach der nächsten Synchronisation erneut scannen.'
      : r.result === 'inaktiv' ? 'Dieser QR-Code ist deaktiviert.' : r.result === 'kein_zugriff' ? 'Für dieses Objekt haben Sie keine Berechtigung.' : `Unbekannter Code: ${String(raw).slice(0, 60)}`;
    toast(msg, 'bad', 5000);
  } catch (e) { errorToast(e); } finally { busy = false; }
}

// ---------- Scan-Seite ----------
export function scanView() {
  const input = h('input', { class: 'wedge-input', placeholder: 'Scanner-Eingabe oder Code eintippen', autocomplete: 'off', 'aria-label': 'Code', dataset: { scanInput: '1' } });
  const submit = () => { const v = input.value.trim(); if (v) { input.value = ''; handleScan(v, 'manuell'); } };
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } });
  const mine = store.all('scans', (s) => s.user_id === store.getUser().id).sort((a, b) => b.scanned_at.localeCompare(a.scanned_at)).slice(0, 8);
  const el = h('div', null,
    pageHead('QR-Code scannen', { sub: 'Objekt, Bereich, Maschine oder Artikel' }),
    card(null, h('div', { class: 'scan-hero' }, ic('qr'),
      h('p', { class: 'muted' }, 'Honeywell EDA52: seitliche Scantaste drücken. Andere Geräte: Kamera verwenden.'),
      h('div', { style: { maxWidth: '420px', margin: '0 auto' } },
        btn('Mit Kamera scannen', { icon: 'camera', cls: 'primary lg block', onclick: async () => { const c = await scanWithCamera(); if (c) handleScan(c, 'kamera'); } }),
        h('div', { class: 'input-with-btn', style: { marginTop: '12px' } }, input, btn('Öffnen', { onclick: submit }))))),
    card('Zuletzt gescannt', mine.length ? h('div', { class: 'list' }, mine.map((s) => row({
      title: s.raw?.includes('/q/') ? (store.all('qr_codes', (q) => s.raw.includes(q.token))[0]?.label || 'QR-Code') : s.raw,
      meta: `${fmtDateTime(s.scanned_at)} · ${s.method}`, right: badge(s.result === 'ok' ? 'OK' : s.result, s.result === 'ok' ? 'ok' : s.result === 'offline' ? 'warn' : 'bad'),
      onclick: () => handleScan(s.raw, 'manuell'),
    }))) : h('div', { class: 'empty small' }, 'Noch keine Scans.'), { iconName: 'history' }));
  // Fokus auf Scanner-Feld (Hardware-Scanner tippt hinein), ohne Bildschirmtastatur auf Touchgeräten
  setTimeout(() => { if (!matchMedia('(pointer: coarse)').matches) input.focus(); }, 100);
  return el;
}

export async function qTokenView({ params }) {
  setTimeout(() => handleScan('/q/' + params[0], 'link'), 50);
  return h('div', { class: 'loading' }, h('span', { class: 'spinner' }), 'QR-Code wird geöffnet …');
}

// ---------- QR-Verwaltung ----------
export function describeQr(q) {
  if (q.target_type === 'object') return { title: store.get('objects', q.object_id)?.name || 'Objekt', sub: 'Objekt' };
  if (q.target_type === 'area') return { title: store.get('objects', q.object_id)?.name || 'Objekt', sub: `${QR_AREA_TYPES[q.area_type] || 'Bereich'}${q.area_name && q.area_name !== QR_AREA_TYPES[q.area_type] ? ': ' + q.area_name : ''}` };
  if (q.target_type === 'machine') return { title: store.get('machines', q.machine_id)?.name || 'Maschine', sub: 'Maschine' };
  return { title: store.get('materials', q.material_id)?.name || 'Artikel', sub: 'Inventar / Material' };
}

export async function showQr(q) {
  const d = describeQr(q);
  const img = h('img', { class: 'qr-img', alt: `QR-Code ${q.label}`, src: `/api/qr/${q.id}.svg` });
  img.onerror = () => img.replaceWith(h('div', { class: 'notice warn' }, 'QR-Bild ist offline nicht verfügbar.'));
  const actions = [{ label: 'Schließen', value: null }];
  if (may('qr.manage')) {
    actions.unshift(
      { label: 'PDF-Etikett', icon: 'print', onClick: () => { openUrl(`/api/qr-labels.pdf?ids=${q.id}&size=gross`); return false; } },
      { label: 'PNG', icon: 'download', onClick: () => { openUrl(`/api/qr/${q.id}.png`); return false; } },
    );
  }
  const body = h('div', null, img,
    h('div', { style: { textAlign: 'center', marginTop: '10px' } }, h('div', { class: 'mono', style: { fontWeight: 700 } }, q.label || '(wird vergeben)'), h('div', null, d.title), h('div', { class: 'muted small' }, d.sub),
      q.active ? badge('aktiv', 'ok') : badge('deaktiviert', 'bad')),
    may('qr.manage') ? h('div', { class: 'btn-row stretch', style: { marginTop: '16px' } },
      btn('Neu zuordnen', { icon: 'repeat', onclick: () => { document.querySelector('.modal-back')?._close(); reassign(q); } }),
      btn(q.active ? 'Deaktivieren' : 'Aktivieren', { icon: q.active ? 'slash' : 'check', cls: q.active ? 'danger' : '', onclick: async () => {
        if (q.active && !(await confirmDialog('QR-Code deaktivieren? Scans dieses Codes öffnen danach keine Akte mehr.', { danger: true, ok: 'Deaktivieren' }))) return;
        try { await store.command('qr.setActive', { id: q.id, active: !q.active }); toast('Gespeichert.'); document.querySelector('.modal-back')?._close(); } catch (e) { errorToast(e); }
      } })) : null,
    h('p', { class: 'tiny muted', style: { marginTop: '12px' } }, 'Der QR-Code enthält nur eine zufällige, nicht erratbare Kennung – keine Kunden- oder Objektdaten. Zugriff wird bei jedem Scan serverseitig geprüft.'));
  await modal({ title: 'QR-Code', body, actions });
}

function targetFields(values = {}) {
  return [
    { name: 'target_type', label: 'Zuordnung', type: 'select', required: true, options: Object.entries(QR_TARGET_TYPES).map(([value, label]) => ({ value, label })) },
    { name: 'object_id', label: 'Objekt (bei Objekt/Bereich)', type: 'ref', refOptions: refOptions('objects') },
    { name: 'area_type', label: 'Bereich', type: 'select', options: Object.entries(QR_AREA_TYPES).map(([value, label]) => ({ value, label })) },
    { name: 'area_name', label: 'Bereichsbezeichnung (optional)', type: 'text', placeholder: 'z. B. Treppenhaus Haus B' },
    { name: 'machine_id', label: 'Maschine', type: 'ref', refOptions: refOptions('machines') },
    { name: 'material_id', label: 'Artikel / Inventar', type: 'ref', refOptions: refOptions('materials') },
  ].map((f) => ({ ...f, default: values[f.name] }));
}

function validateTarget(v) {
  if (['object', 'area'].includes(v.target_type) && !v.object_id) return 'Bitte ein Objekt auswählen.';
  if (v.target_type === 'area' && !v.area_type) return 'Bitte einen Bereich auswählen.';
  if (v.target_type === 'machine' && !v.machine_id) return 'Bitte eine Maschine auswählen.';
  if (v.target_type === 'material' && !v.material_id) return 'Bitte einen Artikel auswählen.';
  return null;
}

export async function createQr(preset = {}) {
  const v = await formDialog('QR-Code erstellen', targetFields(preset), preset, { submit: 'Erstellen', validate: validateTarget });
  if (!v) return;
  try {
    const r = await store.command('qr.create', { id: store.uuid(), ...v });
    toast(r.queued ? 'Wird erstellt, sobald eine Verbindung besteht.' : `QR-Code ${r.row.label} erstellt.`);
    if (r.row) showQr(r.row);
  } catch (e) { errorToast(e); }
}

async function reassign(q) {
  const v = await formDialog(`QR-Code ${q.label} neu zuordnen`, targetFields(q), q, { submit: 'Zuordnen', validate: validateTarget });
  if (!v) return;
  try { await store.command('qr.reassign', { id: q.id, ...v }); toast('QR-Code neu zugeordnet.'); } catch (e) { errorToast(e); }
}

export function qrCard({ object }) {
  const qrs = store.all('qr_codes', (q) => q.object_id === object.id).sort((a, b) => (a.target_type === 'object' ? -1 : 1) - (b.target_type === 'object' ? -1 : 1) || (a.label || '').localeCompare(b.label || ''));
  const actions = may('qr.manage') ? [
    btn('Bereich-QR', { cls: 'sm', icon: 'plus', onclick: () => createQr({ target_type: 'area', object_id: object.id }) }),
    qrs.length ? btn('Alle drucken', { cls: 'sm', icon: 'print', onclick: () => openUrl(`/api/qr-labels.pdf?ids=${qrs.filter((q) => q.active).map((q) => q.id).join(',')}`) }) : null,
  ].filter(Boolean) : null;
  return card('QR-Codes', qrs.length ? h('div', { class: 'list' }, qrs.map((q) => { const d = describeQr(q); return row({
    lead: h('div', { class: 'lead' }, ic('qr')), title: d.sub, meta: q.label || 'wird vergeben', right: q.active ? null : badge('deaktiviert', 'bad'), onclick: () => showQr(q),
  }); })) : empty('Keine QR-Codes.'), { iconName: 'qr', actions });
}

const st = { tab: 'codes', q: '', type: '', sel: new Set() };
export function qrManagement() {
  const el = h('div');
  el.append(pageHead('QR-Codes', { sub: 'Erstellen, drucken, zuordnen und deaktivieren', actions: [btn('QR-Code erstellen', { icon: 'plus', cls: 'primary', onclick: () => createQr() })] }));
  el.append(tabs([{ key: 'codes', label: 'QR-Codes' }, { key: 'scans', label: 'Scan-Historie' }], st.tab, (k) => { st.tab = k; refresh(); }));
  if (st.tab === 'scans') {
    const scans = store.all('scans').sort((a, b) => b.scanned_at.localeCompare(a.scanned_at)).slice(0, 300);
    el.append(card('Scan-Historie (letzte 90 Tage)', scans.length ? h('div', { class: 'table-wrap' }, h('table', { class: 'data' },
      h('thead', null, h('tr', null, ['Zeitpunkt', 'Code', 'Mitarbeiter', 'Methode', 'Ergebnis'].map((t) => h('th', null, t)))),
      h('tbody', null, scans.map((s) => h('tr', null, h('td', { class: 'nowrap' }, fmtDateTime(s.scanned_at)), h('td', null, store.get('qr_codes', s.qr_code_id)?.label || String(s.raw || '').slice(0, 40)),
        h('td', null, userLabel(s.user_id)), h('td', null, s.method), h('td', null, badge(s.result, s.result === 'ok' ? 'ok' : 'bad'))))))) : empty('Noch keine Scans.'),
    { actions: [h('a', { class: 'btn sm', href: '/api/export/scans.csv' }, ic('download'), 'CSV')] }));
    return el;
  }
  const box = h('div');
  const printBtn = btn('Auswahl drucken', { icon: 'print', disabled: true, onclick: async () => {
    const size = await modal({ title: 'Etiketten drucken', body: h('p', null, `${st.sel.size} QR-Code(s) als PDF.`), actions: [{ label: 'Klein (12 pro A4)', value: 'klein' }, { label: 'Groß (1 pro A4)', value: 'gross', class: 'primary' }] });
    if (size) openUrl(`/api/qr-labels.pdf?ids=${[...st.sel].join(',')}&size=${size}`);
  } });
  const draw = () => {
    const rows = store.all('qr_codes', (q) => (!st.type || q.target_type === st.type) && (matches(q, ['label', 'area_name'], st.q) || describeQr(q).title.toLowerCase().includes(st.q)))
      .sort((a, b) => (b.label || '').localeCompare(a.label || ''));
    printBtn.disabled = !st.sel.size;
    printBtn.lastChild.textContent = st.sel.size ? `Auswahl drucken (${st.sel.size})` : 'Auswahl drucken';
    box.replaceChildren(card(null, rows.length ? h('div', { class: 'list' }, rows.map((q) => {
      const d = describeQr(q);
      const cb = h('input', { type: 'checkbox', checked: st.sel.has(q.id), 'aria-label': 'Auswählen', onclick: (e) => { e.stopPropagation(); cb.checked ? st.sel.add(q.id) : st.sel.delete(q.id); draw(); } });
      return h('div', { class: 'row', onclick: () => showQr(q) }, h('label', { onclick: (e) => e.stopPropagation(), style: { padding: '8px' } }, cb),
        h('div', { class: 'grow' }, h('div', { class: 'title' }, `${d.title}`), h('div', { class: 'meta' }, `${q.label || '–'} · ${d.sub}`)),
        q.active ? badge(QR_TARGET_TYPES[q.target_type], 'outline') : badge('deaktiviert', 'bad'), ic('chevron', 'chev'));
    })) : empty('Keine QR-Codes gefunden.', 'qr')));
  };
  el.append(h('div', { class: 'toolbar' }, searchBox('Suchen (Label, Objekt, Bereich)', (q) => { st.q = q; draw(); }, st.q),
    h('select', { style: { width: 'auto' }, onchange: (e) => { st.type = e.target.value; draw(); } }, h('option', { value: '' }, 'Alle Typen'),
      Object.entries(QR_TARGET_TYPES).map(([v, l]) => h('option', { value: v, selected: st.type === v }, l))), printBtn));
  el.append(box);
  draw();
  return el;
}

export { suspendWedge };
