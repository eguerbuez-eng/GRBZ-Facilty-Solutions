import { h, ic, card, empty, row, badge, pageHead, btn, kv, toast, errorToast, formDialog, tabs, buildForm, openUrl, confirmDialog } from '../ui.js';
import * as store from '../store.js';
import { ENTITIES } from '/shared/entities.js';
import { may, refOptions, userLabel, pendingBadge, user, isAdmin, adminDelete } from './common.js';
import { WINTER_WEATHER, WINTER_ACTIVITIES } from '/shared/constants.js';
import { fmtDate, fmtDateTime, fmtTime, fmtMinutes, seasonOf, fmtNumber } from '/shared/dates.js';
import { takePhoto, photoGrid, signaturePad } from '../media.js';
import { refresh, go } from '../app.js';

const st = { tab: 'einsaetze', season: null };
const opt = (o) => Object.entries(o).map(([value, label]) => ({ value, label }));

export function winterView() {
  const season = st.season || seasonOf(new Date().toISOString());
  const ops = store.all('winter_operations').sort((a, b) => b.start_at.localeCompare(a.start_at));
  const seasons = [...new Set([seasonOf(new Date().toISOString()), ...ops.map((o) => o.season)])].sort().reverse();
  const el = h('div', null, pageHead('Winterdienst', { sub: `Saison ${season}`, actions: may('winter.execute') ? [btn('Einsatz starten', { icon: 'snow', cls: 'primary', href: '#/winter/einsatz/neu' })] : [] }));
  const tabList = [{ key: 'einsaetze', label: 'Einsätze' }, { key: 'bereitschaft', label: 'Bereitschaft' }];
  if (may('winter.write')) tabList.push({ key: 'saison', label: 'Saisonübersicht' });
  el.append(tabs(tabList, st.tab, (k) => { st.tab = k; refresh(); }));
  const seasonSel = h('select', { style: { width: 'auto' }, onchange: (e) => { st.season = e.target.value; refresh(); } }, seasons.map((s) => h('option', { value: s, selected: s === season }, `Saison ${s}`)));
  if (st.tab === 'einsaetze') {
    const list = ops.filter((o) => o.season === season);
    const running = list.filter((o) => o.status !== 'abgeschlossen');
    el.append(h('div', { class: 'toolbar' }, seasonSel));
    if (running.length) el.append(card('Laufende / nicht unterschriebene Einsätze', h('div', { class: 'list' }, running.map(opRow)), { iconName: 'alert' }));
    el.append(card('Einsätze', list.length ? h('div', { class: 'list' }, list.filter((o) => o.status === 'abgeschlossen').map(opRow)) : empty('Noch keine Einsätze in dieser Saison.', 'snow')));
  } else if (st.tab === 'bereitschaft') {
    const rows = store.all('winter_standby').sort((a, b) => b.start_at.localeCompare(a.start_at));
    el.append(card('Bereitschaftszeiten', rows.length ? h('div', { class: 'list' }, rows.map((s) => row({
      title: `${userLabel(s.user_id)}`, meta: `${fmtDateTime(s.start_at)} – ${fmtDateTime(s.end_at)}${s.note ? ' · ' + s.note : ''}`,
      right: new Date(s.start_at) <= new Date() && new Date(s.end_at) >= new Date() ? badge('aktiv', 'ok') : null,
      onclick: may('winter.write') ? () => editStandby(s) : undefined,
    }))) : empty('Keine Bereitschaftszeiten geplant.', 'calendar'), { iconName: 'calendar', actions: may('winter.write') ? [btn('Bereitschaft planen', { cls: 'sm', icon: 'plus', onclick: () => editStandby() })] : null }));
  } else {
    const list = ops.filter((o) => o.season === season);
    const byObj = {};
    for (const o of list) { const b = (byObj[o.object_id] ||= { n: 0, min: 0, kg: 0 }); b.n++; b.min += o.end_at ? (Date.parse(o.end_at) - Date.parse(o.start_at)) / 6e4 : 0; b.kg += o.spreading_amount_kg || 0; }
    el.append(h('div', { class: 'toolbar' }, seasonSel, btn('Saisonbericht (PDF)', { icon: 'print', onclick: () => openUrl(`/api/reports/winter-season?season=${encodeURIComponent(season)}`) })));
    el.append(card('Einsätze je Objekt', Object.keys(byObj).length ? h('div', { class: 'table-wrap' }, h('table', { class: 'data' },
      h('thead', null, h('tr', null, h('th', null, 'Objekt'), h('th', { class: 'num' }, 'Einsätze'), h('th', { class: 'num' }, 'Dauer'), h('th', { class: 'num' }, 'Streumittel'), h('th', null, ''))),
      h('tbody', null, Object.entries(byObj).map(([oid, b]) => h('tr', null, h('td', null, store.get('objects', oid)?.name || '–'), h('td', { class: 'num' }, b.n), h('td', { class: 'num' }, fmtMinutes(b.min)), h('td', { class: 'num' }, `${fmtNumber(b.kg, 1)} kg`),
        h('td', null, h('button', { class: 'btn sm', onclick: () => openUrl(`/api/reports/winter-season?season=${encodeURIComponent(season)}&object_id=${oid}`) }, ic('print'), 'PDF'))))))) : empty('Keine Einsätze.')));
  }
  return el;
}

function opRow(o) {
  return row({
    href: `#/winter/einsatz/${o.id}`, lead: h('div', { class: 'lead time' }, fmtTime(o.start_at)),
    title: store.get('objects', o.object_id)?.name || 'Objekt', meta: [fmtDate(o.start_at), o.operation_no, WINTER_WEATHER[o.weather], WINTER_ACTIVITIES[o.activity], userLabel(o.user_id)].filter(Boolean).join(' · '),
    right: h('div', { class: 'btn-row' }, pendingBadge(o), o.status === 'abgeschlossen' ? badge('unterschrieben', 'ok') : badge(o.end_at ? 'Unterschrift fehlt' : 'läuft', 'warn')),
  });
}

async function editStandby(s) {
  const fields = ENTITIES.winter_standby.fields.map((f) => (f.type === 'ref' ? { ...f, refOptions: refOptions('users') } : f));
  const v = await formDialog(s ? 'Bereitschaft bearbeiten' : 'Bereitschaft planen', fields, s || {});
  if (!v) return;
  try { await store.command('entity.save', { entity: 'winter_standby', id: s?.id || store.uuid(), data: v, base_version: s?.version }); toast('Gespeichert.'); } catch (e) { errorToast(e); }
}

export async function winterNew({ query }) {
  let objectId = query.object;
  if (!objectId) {
    const withAreas = new Set(store.all('winter_areas').map((a) => a.object_id));
    const v = await formDialog('Winterdiensteinsatz starten', [{ name: 'object_id', label: 'Objekt', type: 'ref', required: true, refOptions: refOptions('objects', (o) => withAreas.has(o.id) || true) }], {}, { submit: 'Einsatz beginnen' });
    if (!v) { go('#/winter'); return h('div'); }
    objectId = v.object_id;
  }
  const id = store.uuid();
  try {
    await store.command('winter.save', { id, data: { object_id: objectId, start_at: new Date().toISOString() } });
    toast('Einsatzbeginn erfasst.');
    setTimeout(() => go(`#/winter/einsatz/${id}`), 10);
  } catch (e) { errorToast(e); go('#/winter'); }
  return h('div', { class: 'loading' }, h('span', { class: 'spinner' }));
}

export function winterDetail({ params }) {
  const op = store.get('winter_operations', params[0]);
  if (!op) return h('div', { class: 'notice bad' }, 'Einsatz nicht gefunden.');
  const obj = store.get('objects', op.object_id);
  const areas = store.all('winter_areas', (a) => a.object_id === op.object_id).sort((a, b) => (a.priority || 9) - (b.priority || 9));
  const photos = store.all('photos', (p) => p.winter_operation_id === op.id);
  const signed = op.status === 'abgeschlossen';
  const canEdit = !signed && (op.user_id === user().id || may('winter.write'));
  const adminBtns = isAdmin() ? [
    signed ? btn('Wieder öffnen', { icon: 'repeat', onclick: async () => {
      const v = await formDialog('Einsatz wieder öffnen (Administrator)', [{ name: 'reason', label: 'Grund (die Unterschrift wird entfernt)', type: 'textarea', required: true }], {}, { submit: 'Wieder öffnen' });
      if (v) store.command('winter.reopen', { id: op.id, reason: v.reason }).then(() => toast('Einsatz wieder geöffnet.')).catch(errorToast);
    } }) : null,
    btn('Löschen', { icon: 'trash', cls: 'danger', onclick: () => adminDelete('winter_operations', op.id, `Winterdiensteinsatz ${op.operation_no || ''}`, () => go('#/winter')) }),
  ].filter(Boolean) : [];
  const selAreas = (() => { try { return JSON.parse(op.area_ids || '[]'); } catch { return []; } })();
  const el = h('div', null, pageHead(`Winterdienst · ${obj?.name || ''}`, { back: '#/winter', sub: [op.operation_no || 'Nr. wird vergeben', `Saison ${op.season}`, userLabel(op.user_id)].join(' · '),
    actions: [...(!op._pending ? [btn('Protokoll (PDF)', { icon: 'print', onclick: () => openUrl(`/api/reports/winter/${op.id}`) })] : []), ...adminBtns] }));
  if (signed) {
    el.append(h('div', { class: 'notice ok' }, ic('checkCircle'), `Unterschrieben am ${fmtDateTime(op.signed_at)} – Einsatz abgeschlossen.`));
    el.append(card('Einsatzprotokoll', kv([
      ['Beginn', fmtDateTime(op.start_at)], ['Ende', fmtDateTime(op.end_at)], ['Dauer', op.end_at ? fmtMinutes((Date.parse(op.end_at) - Date.parse(op.start_at)) / 6e4) : ''],
      ['Wetter', WINTER_WEATHER[op.weather]], ['Temperatur', op.temperature != null ? `${fmtNumber(op.temperature, 1)} °C` : ''], ['Schneehöhe', op.snow_cm != null ? `${fmtNumber(op.snow_cm, 1)} cm` : ''],
      ['Tätigkeit', WINTER_ACTIVITIES[op.activity]], ['Streumittel', [op.spreading_material, op.spreading_amount_kg != null ? `${fmtNumber(op.spreading_amount_kg, 1)} kg` : ''].filter(Boolean).join(' · ')],
      ['Flächen', areas.filter((a) => selAreas.includes(a.id)).map((a) => a.name).join(', '), true], ['Bemerkungen', op.notes, true],
    ]), { iconName: 'snow' }));
    if (op.signature) el.append(card('Unterschrift Mitarbeiter', h('div', { class: 'card-pad' }, h('img', { src: op.signature, alt: 'Unterschrift', style: { maxWidth: '300px', width: '100%' } }))));
    el.append(card('Fotos', photoGrid(photos, { onChange: refresh }), { iconName: 'camera' }));
    return el;
  }
  const f = buildForm([
    { name: 'start_at', label: 'Einsatzbeginn', type: 'datetime', required: true },
    { name: 'end_at', label: 'Einsatzende', type: 'datetime' },
    { name: 'weather', label: 'Wetterbedingungen', type: 'select', options: opt(WINTER_WEATHER), half: true },
    { name: 'activity', label: 'Tätigkeit', type: 'select', options: opt(WINTER_ACTIVITIES), half: true },
    { name: 'temperature', label: 'Temperatur (°C)', type: 'number', third: true },
    { name: 'snow_cm', label: 'Schneehöhe (cm)', type: 'number', third: true },
    { name: 'spreading_amount_kg', label: 'Streumenge (kg)', type: 'number', third: true },
    { name: 'spreading_material', label: 'Streumittel', type: 'text', placeholder: 'z. B. Splitt, Sole, Granulat (kein Salz, falls kommunal untersagt)' },
    { name: 'area_ids', label: 'Bearbeitete Flächen (Räumleistung)', type: 'checkboxes', options: areas.map((a) => ({ value: a.id, label: `${a.name}${a.area_sqm ? ' (' + a.area_sqm + ' m²)' : ''}` })), emptyText: 'Für dieses Objekt sind keine Flächen hinterlegt (Objektakte → Winterdienst).' },
    { name: 'notes', label: 'Bemerkungen', type: 'textarea' },
  ], { ...op, area_ids: selAreas });
  const save = async (extra = {}) => {
    const v = { ...f.values(), ...extra };
    const data = {};
    const cur = store.get('winter_operations', op.id) || op;
    for (const [k, val] of Object.entries(v)) {
      if (k === 'area_ids') { if (JSON.stringify(val) !== JSON.stringify(selAreas)) data[k] = val; continue; }
      const a = String(val ?? ''); const b = String(cur[k] ?? '');
      if (k.endsWith('_at') ? a.slice(0, 16) !== b.slice(0, 16) : a !== b) data[k] = val === '' ? null : val;
    }
    if (!Object.keys(data).length) return true;
    await store.command('winter.save', { id: op.id, data, base_version: cur._pending ? undefined : cur.version });
    return true;
  };
  el.append(card('Einsatzdaten', h('div', { class: 'card-pad' }, f.el,
    h('div', { class: 'form-actions' },
      !op.end_at ? btn('Jetzt beenden', { icon: 'stop', onclick: async () => { try { await save({ end_at: new Date().toISOString() }); toast('Einsatzende erfasst.'); } catch (e) { errorToast(e); } } }) : null,
      btn('Zwischenspeichern', { icon: 'check', cls: 'primary', onclick: async () => { try { await save(); toast('Gespeichert.'); } catch (e) { errorToast(e); } } }))), { iconName: 'snow' }));
  el.append(card('Fotos', photoGrid(photos, { onChange: refresh }), { iconName: 'camera', actions: may('photos.write') ? [btn('Foto', { cls: 'sm', icon: 'camera', onclick: () => takePhoto({ winter_operation_id: op.id }, { category: 'sonstiges' }) })] : null }));
  if (canEdit) {
    const pad = signaturePad();
    el.append(card('Unterschrift des Mitarbeiters', h('div', { class: 'card-pad' },
      h('p', { class: 'small muted' }, 'Mit der Unterschrift bestätigen Sie die Richtigkeit der Angaben. Danach ist das Protokoll gesperrt.'), pad.el,
      h('div', { class: 'form-actions' }, btn('Unterschreiben & abschließen', { icon: 'pen', cls: 'dark lg', onclick: async () => {
        if (pad.isEmpty()) return toast('Bitte unterschreiben.', 'bad');
        try {
          await save();
          if (!(await confirmDialog('Einsatz jetzt unterschreiben und abschließen? Danach sind keine Änderungen mehr möglich.', { ok: 'Abschließen' }))) return;
          await store.command('winter.sign', { id: op.id, signature: pad.toDataUrl() });
          toast('Einsatz abgeschlossen.');
        } catch (e) { errorToast(e); }
      } }))), { iconName: 'pen' }));
  }
  return el;
}
