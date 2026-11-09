// Inventar: Ergebnisanzeige nach Scan, Aktionen (Bestand, Ausgabe, Standort, Objekt, Zustand, Wartung …)
// und Neuanlage über Barcode. Wird vom Inventar-Scanbereich und den Detailseiten genutzt.
import { h, ic, card, badge, btn, kv, toast, errorToast, modal, formDialog, buildForm, openUrl } from '../ui.js';
import * as store from '../store.js';
import { may, refOptions, userLabel, formFields } from './common.js';
import { ENTITIES } from '/shared/entities.js';
import { MATERIAL_STATUS, MACHINE_TYPES, categoryLabel, categoryMode, availableQty, barcodeTaken, normalizeCode, findInventory } from '/shared/inventory.js';
import { fmtDate, fmtNumber } from '/shared/dates.js';

const condLabel = (v) => ENTITIES.machines.fields.find((f) => f.name === 'condition').options.find((o) => o.value === v)?.label || v || '–';
const objName = (id) => (id ? store.get('objects', id)?.name || '–' : null);

export function localRows() {
  return { materials: store.all('materials'), machines: store.all('machines'), qr_codes: store.all('qr_codes') };
}
export function lookupLocal(code) {
  const hit = findInventory(code, localRows());
  if (!hit) return null;
  const item = store.get(hit.type === 'material' ? 'materials' : 'machines', hit.id);
  return item ? { ...hit, item } : null;
}

// ---------- Ergebniskarte ----------
export function itemCard(type, item, { code, compact = false, onChanged } = {}) {
  if (type === 'material') return materialCard(item, { code, compact, onChanged });
  return machineCard(item, { code, compact, onChanged });
}

function materialCard(m, { code, onChanged }) {
  const mode = categoryMode(m.category);
  const avail = availableQty(m);
  const low = m.min_stock > 0 && m.stock <= m.min_stock;
  const unit = m.unit || 'Stück';
  const big = h('div', { class: 'inv-stock' },
    h('div', null, h('div', { class: 'label' }, 'Vorhandener Bestand'), h('div', { class: 'value' }, `${fmtNumber(m.stock)} ${unit}`)),
    h('div', null, h('div', { class: 'label' }, 'Verfügbar'), h('div', { class: 'value', style: { color: avail <= 0 ? 'var(--bad)' : '' } }, `${fmtNumber(avail)} ${unit}`)));
  const actions = h('div', { class: 'btn-row inv-actions' },
    btn('Öffnen', { icon: 'eye', cls: 'sm', href: `#/material/${m.id}` }),
    may('materials.write') ? btn('Bestand +', { icon: 'plus', cls: 'sm primary', onclick: () => bookDialog(m, 'zugang', onChanged) }) : null,
    may(['materials.consume', 'materials.write']) ? btn('Bestand −', { icon: 'minus', cls: 'sm', onclick: () => bookDialog(m, 'verbrauch', onChanged) }) : null,
    may('materials.write') ? btn('Ausgabe', { icon: 'user', cls: 'sm', onclick: () => bookDialog(m, 'ausgabe', onChanged) }) : null,
    may('materials.write') ? btn('Rücknahme', { icon: 'repeat', cls: 'sm', onclick: () => bookDialog(m, 'ruecknahme', onChanged) }) : null,
    may('materials.write') ? btn('Standort', { icon: 'map', cls: 'sm', onclick: () => editFields('materials', m, ['location'], 'Standort / Lagerort ändern', onChanged) }) : null,
    may('materials.write') ? btn('Objekt', { icon: 'building', cls: 'sm', onclick: () => editFields('materials', m, ['object_id'], 'Objekt zuordnen', onChanged) }) : null,
    may('materials.write') ? btn('Status', { icon: 'info', cls: 'sm', onclick: () => editFields('materials', m, ['status'], 'Status ändern', onChanged) }) : null,
    may('materials.write') ? btn('Bearbeiten', { icon: 'edit', cls: 'sm', href: `#/material/${m.id}/bearbeiten` }) : null,
    may('materials.write') && !m.barcode ? btn('Barcode erzeugen', { icon: 'qr', cls: 'sm', onclick: () => newCode('material', m, onChanged) }) : null);
  return card(null, h('div', { class: 'inv-card' },
    h('div', { class: 'inv-head' }, h('div', { class: 'lead' }, ic('box')), h('div', { class: 'grow' }, h('h2', null, m.name), h('div', { class: 'muted small' }, [m.article_no, m.barcode].filter(Boolean).join(' · '))),
      h('div', { class: 'btn-row' }, badge(mode === 'leihe' ? 'Artikel (Ausgabe/Rücknahme)' : 'Verbrauchsmaterial', 'accent'), badge(categoryLabel(m.category), 'outline'), m._pending ? badge('nicht synchronisiert', 'warn') : null)),
    low ? h('div', { class: 'notice warn' }, ic('alert'), `Mindestbestand (${fmtNumber(m.min_stock)} ${unit}) erreicht oder unterschritten.`) : null,
    big,
    kv([
      ['Artikelnummer', m.article_no || 'wird bei Sync vergeben'], ['Barcode', m.barcode || 'kein Barcode'], ['Gegenstandsart', categoryLabel(m.category)],
      ['Hersteller / Modell', [m.manufacturer, m.model].filter(Boolean).join(' · ') || null], ['Lagerort / Standort', m.location || '–'], ['Status', MATERIAL_STATUS[m.status] || 'Verfügbar'],
      ['Zugeordnetes Objekt', objName(m.object_id)], ['Ausgegeben', mode === 'leihe' && m.issued ? `${fmtNumber(m.issued)} ${unit}` : null],
      ['Gescannt', code && code !== m.barcode ? code : null],
    ]), actions));
}

function machineCard(m, { code, onChanged }) {
  const actions = h('div', { class: 'btn-row inv-actions' },
    btn('Öffnen', { icon: 'eye', cls: 'sm', href: `#/maschinen/${m.id}` }),
    may('machines.write') ? btn('Standort', { icon: 'map', cls: 'sm', onclick: () => machineAssign(m, 'standort', onChanged) }) : null,
    may('machines.write') ? btn('Objekt', { icon: 'building', cls: 'sm', onclick: () => machineAssign(m, 'objekt', onChanged) }) : null,
    may('machines.write') ? (m.issued_to_user_id ? btn('Rücknahme', { icon: 'repeat', cls: 'sm', onclick: () => machineAssign(m, 'ruecknahme', onChanged) }) : btn('Ausgabe', { icon: 'user', cls: 'sm', onclick: () => machineAssign(m, 'ausgabe', onChanged) })) : null,
    may('machines.write') ? btn('Zustand', { icon: 'info', cls: 'sm', onclick: () => machineEvent(m, 'zustand', onChanged) }) : null,
    may('machines.write') ? btn('Wartung', { icon: 'wrench', cls: 'sm', onclick: () => machineEvent(m, 'wartung', onChanged) }) : null,
    may('machines.write') ? btn('Reparatur', { icon: 'check', cls: 'sm', onclick: () => machineEvent(m, 'reparatur', onChanged) }) : null,
    may('machines.read') ? btn('Defekt melden', { icon: 'alert', cls: 'sm', onclick: () => machineEvent(m, 'defekt', onChanged) }) : null,
    may('machines.write') ? btn('Bearbeiten', { icon: 'edit', cls: 'sm', href: `#/maschinen/${m.id}/bearbeiten` }) : null,
    may('machines.write') && !m.barcode ? btn('Barcode erzeugen', { icon: 'qr', cls: 'sm', onclick: () => newCode('machine', m, onChanged) }) : null);
  const bad = ['defekt', 'in_reparatur', 'ausgemustert'].includes(m.condition);
  return card(null, h('div', { class: 'inv-card' },
    h('div', { class: 'inv-head' }, h('div', { class: 'lead' }, ic('wrench')), h('div', { class: 'grow' }, h('h2', null, m.name), h('div', { class: 'muted small' }, [m.inventory_no, m.barcode].filter(Boolean).join(' · '))),
      h('div', { class: 'btn-row' }, badge(MACHINE_TYPES[m.machine_type] || 'Maschine', 'accent'), badge('Einzelstück', 'outline'), m._pending ? badge('nicht synchronisiert', 'warn') : null)),
    h('div', { class: 'inv-stock' },
      h('div', null, h('div', { class: 'label' }, 'Inventarnummer'), h('div', { class: 'value' }, m.inventory_no || '–')),
      h('div', null, h('div', { class: 'label' }, 'Zustand'), h('div', { class: 'value', style: { color: bad ? 'var(--bad)' : 'var(--ok)' } }, condLabel(m.condition)))),
    kv([
      ['Barcode', m.barcode || 'kein Barcode'], ['Gegenstandsart', MACHINE_TYPES[m.machine_type] || 'Maschine'], ['Hersteller / Modell', [m.manufacturer, m.model].filter(Boolean).join(' · ') || null],
      ['Seriennummer', m.serial_no], ['Standort', m.location || '–'], ['Zugeordnetes Objekt', objName(m.object_id) || '–'],
      ['Ausgegeben an', m.issued_to_user_id ? userLabel(m.issued_to_user_id) : 'nicht ausgegeben'], ['Verantwortlich', m.responsible_user_id ? userLabel(m.responsible_user_id) : null],
      ['Nächste Wartung', m.next_maintenance ? fmtDate(m.next_maintenance) : null], ['Gescannt', code && code !== m.barcode ? code : null],
    ]), actions));
}

// ---------- Aktionen ----------
const KIND_TITLE = { zugang: 'Bestand erhöhen (Zugang)', verbrauch: 'Bestand reduzieren (Verbrauch / Entnahme)', ausgabe: 'Ausgabe an Mitarbeiter', ruecknahme: 'Rücknahme' };

export async function bookDialog(m, kind, onChanged) {
  const unit = m.unit || 'Stück';
  const mode = categoryMode(m.category);
  const fields = [
    { name: 'qty', label: `Menge (${unit})`, type: 'number', required: true, default: 1 },
    ['ausgabe', 'ruecknahme'].includes(kind) ? { name: 'recipient_user_id', label: kind === 'ausgabe' ? 'Ausgabe an Mitarbeiter' : 'Rücknahme von Mitarbeiter', type: 'ref', required: kind === 'ausgabe', refOptions: refOptions('users') } : null,
    kind === 'verbrauch' ? { name: 'object_id', label: 'Für Objekt (optional)', type: 'ref', refOptions: refOptions('objects') } : null,
    { name: 'note', label: 'Bemerkung', type: 'text' },
  ].filter(Boolean);
  const info = `Aktuell: ${fmtNumber(m.stock)} ${unit} vorhanden, ${fmtNumber(availableQty(m))} ${unit} verfügbar.${['ausgabe', 'ruecknahme'].includes(kind) ? (mode === 'leihe' ? ' Ausgabe/Rücknahme ändert nur die verfügbare Menge.' : ' Bei Verbrauchsmaterial verringert die Ausgabe den Bestand.') : ''}`;
  const f = buildForm(fields, { qty: 1 });
  const v = await modal({ title: `${KIND_TITLE[kind]}: ${m.name}`, body: h('div', null, h('p', { class: 'small muted', style: { marginTop: 0 } }, info), f.el), actions: [{ label: 'Abbrechen', value: null }, { label: 'Buchen', class: 'primary', onClick: () => (f.check() ? f.values() : false) }] });
  if (!v) return;
  if (!(v.qty > 0)) return toast('Die Menge muss größer als 0 sein.', 'bad');
  // Schutz vor versehentlicher Doppelbuchung (gleiche Buchung innerhalb von 20 Sekunden)
  const recent = store.all('stock_movements', (x) => x.material_id === m.id && x.kind === kind && x.user_id === store.getUser().id && Math.abs(Math.abs(x.qty) - v.qty) < 1e-9 && Date.now() - Date.parse(x.moved_at || x.created_at) < 20000);
  if (recent.length && !(await modal({ title: 'Doppelte Buchung?', body: h('p', null, `Die gleiche Buchung (${KIND_TITLE[kind]}, ${fmtNumber(v.qty)} ${unit}) wurde gerade erst erfasst. Wirklich noch einmal buchen?`), actions: [{ label: 'Abbrechen', value: false }, { label: 'Erneut buchen', value: true, class: 'danger solid' }] }))) return;
  const cur = store.get('materials', m.id) || m;
  let allow = false;
  const after = kind === 'zugang' || (kind === 'ruecknahme' && mode !== 'leihe') ? cur.stock + v.qty : kind === 'verbrauch' || (kind === 'ausgabe' && mode !== 'leihe') ? cur.stock - v.qty : cur.stock;
  const availAfter = kind === 'ausgabe' && mode === 'leihe' ? availableQty(cur) - v.qty : 0;
  if (after < 0 || availAfter < 0) {
    allow = await modal({ title: 'Bestand würde negativ werden', body: h('div', { class: 'notice bad' }, ic('alert'), `Nach dieser Buchung wäre der ${availAfter < 0 ? 'verfügbare ' : ''}Bestand ${fmtNumber(availAfter < 0 ? availAfter : after)} ${unit}. Bitte Menge prüfen oder zuerst einen Zugang/eine Inventur buchen.`),
      actions: [{ label: 'Abbrechen', value: false, class: 'primary' }, may('materials.write') ? { label: 'Trotzdem buchen (wird protokolliert)', value: true, class: 'danger' } : null].filter(Boolean) });
    if (!allow) return;
  }
  try {
    const r = await store.command('stock.move', { id: store.uuid(), material_id: m.id, kind, qty: v.qty, recipient_user_id: v.recipient_user_id || null, object_id: v.object_id || null, note: v.note || null, allow_negative: allow || undefined });
    const now = store.get('materials', m.id);
    toast(`${KIND_TITLE[kind]} gebucht. Bestand: ${fmtNumber(now?.stock)} ${unit}, verfügbar: ${fmtNumber(availableQty(now || m))}${r.queued ? ' (offline gespeichert)' : ''}.`);
    if (now && now.min_stock > 0 && now.stock <= now.min_stock) toast('Achtung: Mindestbestand erreicht oder unterschritten!', 'warn', 6000);
    onChanged?.();
  } catch (e) { errorToast(e); }
}

async function editFields(entity, row, names, title, onChanged) {
  const fields = formFields(entity, { isNew: false }).filter((f) => names.includes(f.name));
  const v = await formDialog(`${title}: ${row.name}`, fields, row);
  if (!v) return;
  const cur = store.get(ENTITIES[entity].table, row.id) || row;
  try { await store.command('entity.save', { entity, id: row.id, data: v, base_version: cur._pending ? undefined : cur.version }); toast('Gespeichert.'); onChanged?.(); } catch (e) { errorToast(e); }
}

export async function machineAssign(m, action, onChanged) {
  let payload = { id: m.id, action };
  if (action === 'objekt') {
    const v = await formDialog(`Objekt zuordnen: ${m.name}`, [{ name: 'object_id', label: 'Objekt (leer = Zuordnung entfernen)', type: 'ref', refOptions: refOptions('objects') }, { name: 'note', label: 'Bemerkung', type: 'text' }], { object_id: m.object_id || '' });
    if (!v) return; payload = { ...payload, ...v };
  } else if (action === 'standort') {
    const v = await formDialog(`Standort ändern: ${m.name}`, [{ name: 'location', label: 'Neuer Standort', type: 'text', required: true }, { name: 'note', label: 'Bemerkung', type: 'text' }], { location: m.location || '' });
    if (!v) return; payload = { ...payload, ...v };
  } else if (action === 'ausgabe') {
    const v = await formDialog(`Ausgabe: ${m.name}`, [{ name: 'user_id', label: 'An Mitarbeiter', type: 'ref', required: true, refOptions: refOptions('users') }, { name: 'note', label: 'Bemerkung', type: 'text' }], {});
    if (!v) return; payload = { ...payload, ...v };
  } else if (action === 'ruecknahme') {
    const v = await formDialog(`Rücknahme: ${m.name}`, [{ name: 'note', label: 'Bemerkung (z. B. Zustand bei Rückgabe)', type: 'text' }], {});
    if (!v) return; payload = { ...payload, ...v };
  }
  try { const r = await store.command('machine.assign', payload); toast(r.queued ? 'Gespeichert – wird bei Verbindung übertragen.' : 'Gespeichert.'); onChanged?.(); } catch (e) { errorToast(e); }
}

const EV = { wartung: 'Wartung', reparatur: 'Reparatur', defekt: 'Defekt', zustand: 'Zustand dokumentieren' };
export async function machineEvent(m, kind, onChanged) {
  const condOpts = ENTITIES.machines.fields.find((f) => f.name === 'condition').options;
  const fields = [
    kind === 'zustand' ? { name: 'condition', label: 'Zustand', type: 'select', required: true, options: condOpts } : null,
    { name: 'event_date', label: 'Datum', type: 'date', required: true, default: 'today', half: true },
    ['wartung', 'reparatur'].includes(kind) ? { name: 'cost', label: 'Kosten (€)', type: 'money', half: true } : null,
    { name: 'description', label: kind === 'defekt' ? 'Beschreibung des Defekts' : kind === 'zustand' ? 'Beschreibung des Zustands' : 'Durchgeführte Arbeiten', type: 'textarea', required: true },
    ['wartung', 'reparatur'].includes(kind) ? { name: 'performed_by', label: 'Durchgeführt von', type: 'text' } : null,
  ].filter(Boolean);
  const v = await formDialog(`${EV[kind]}: ${m.name}`, fields, { condition: m.condition });
  if (!v) return;
  try { await store.command('machine.event', { id: store.uuid(), machine_id: m.id, kind, ...v }); toast('Gespeichert.'); onChanged?.(); } catch (e) { errorToast(e); }
}

export async function newCode(type, row, onChanged) {
  if (!navigator.onLine) return toast('Eigene Inventarbarcodes werden vom Server vergeben – bitte online erneut versuchen.', 'warn');
  try {
    const r = await store.command('inventory.newCode', { type, id: row.id });
    toast(`Barcode ${r.code} zugeordnet.`);
    const print = await modal({ title: 'Barcode erzeugt', body: h('p', null, `„${row.name}“ hat jetzt den eindeutigen Barcode ${r.code}. Etikett jetzt drucken?`), actions: [{ label: 'Später', value: false }, { label: 'Etikett drucken', value: true, class: 'primary', icon: 'print' }] });
    if (print) openUrl(`/api/inventory/labels.pdf?items=${type}:${row.id}`);
    onChanged?.();
  } catch (e) { errorToast(e); }
}

// ---------- Neuanlage über Barcode ----------
export async function createFromBarcode(code, onCreated) {
  const c = normalizeCode(code);
  const canMat = may('materials.write'); const canMach = may('machines.write');
  if (!canMat && !canMach) return toast('Unbekannter Barcode. Für die Neuanlage fehlt Ihnen die Berechtigung.', 'warn', 5000);
  let type = canMat && !canMach ? 'material' : !canMat ? 'machine' : null;
  if (!type) {
    type = await modal({ title: `Unbekannter Barcode ${c}`, body: h('div', null, h('p', null, 'Dieser Barcode ist noch keinem Inventargegenstand zugeordnet. Was möchten Sie anlegen?'),
      h('div', { class: 'grid two' },
        h('div', { class: 'notice' }, ic('box'), h('div', null, h('strong', null, 'Artikel / Material'), h('div', { class: 'small' }, 'Reinigungsmittel, Verbrauchsmaterial, Werkzeuge, Geräte, Ersatzteile – mit Stückzahl.'))),
        h('div', { class: 'notice' }, ic('wrench'), h('div', null, h('strong', null, 'Maschine / Einzelgerät'), h('div', { class: 'small' }, 'Einzelnes Gerät mit eigener Inventarnummer, Standort und Zustand.'))))),
    actions: [{ label: 'Abbrechen', value: null }, { label: 'Maschine / Einzelgerät', value: 'machine', icon: 'wrench' }, { label: 'Artikel / Material', value: 'material', icon: 'box', class: 'primary' }] });
    if (!type) return;
  }
  const entity = type === 'material' ? 'materials' : 'machines';
  const fields = formFields(entity, { isNew: true }).map((f) => (f.name === 'barcode' ? { ...f, readonly: true, help: 'Aus dem Scan übernommen.' } : f));
  const f = buildForm(fields, { barcode: c });
  const ok = await modal({ title: type === 'material' ? 'Neuer Artikel' : 'Neue Maschine / Einzelgerät', wide: true,
    body: h('div', null, h('div', { class: 'notice', style: { marginBottom: '12px' } }, ic('qr'), `Barcode ${c} wird diesem Gegenstand dauerhaft zugeordnet. Bitte die fehlenden Angaben erfassen.`), f.el),
    actions: [{ label: 'Abbrechen', value: null }, { label: 'Anlegen', class: 'primary', icon: 'check', onClick: async () => {
      if (!f.check()) return false;
      const taken = barcodeTaken(c, localRows());
      if (taken) { toast(`Barcode bereits vergeben an „${taken.name}“.`, 'bad'); return false; }
      const id = store.uuid();
      const r = await store.command('entity.save', { entity, id, data: { ...f.values(), barcode: c } });
      toast(r.queued ? 'Angelegt – wird bei Verbindung übertragen.' : 'Angelegt.');
      return { id };
    } }] });
  if (ok) onCreated?.(type, ok.id);
}
