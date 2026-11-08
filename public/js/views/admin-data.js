// Administrator: Datenverwaltung (alle Tabellen), Papierkorb, Sicherungen.
import { h, ic, card, empty, row, badge, pageHead, btn, toast, errorToast, modal, tabs, searchBox } from '../ui.js';
import * as store from '../store.js';
import { api } from '../api.js';
import { isAdmin } from './common.js';
import { fmtDateTime } from '/shared/dates.js';
import { refresh } from '../app.js';

export const TABLE_NAMES = {
  customers: 'Kunden', contact_history: 'Kontakthistorie', objects: 'Objekte', object_employees: 'Objekt-Zuordnungen', qr_codes: 'QR-Codes',
  orders: 'Aufträge', order_checklist_items: 'Auftrags-Checklistenpunkte', recurrences: 'Serienaufträge', checklist_templates: 'Checklisten-Vorlagen',
  checklist_template_items: 'Checklisten-Vorlagenpunkte', services: 'Dienstleistungen', customer_services: 'Kunden-Dienstleistungen', photos: 'Fotos', documents: 'Dokumente',
  users: 'Benutzer / Mitarbeiter', employee_profiles: 'Personalakten', roles: 'Rollen', employment_types: 'Beschäftigungsarten', positions: 'Positionen', departments: 'Abteilungen',
  work_models: 'Arbeitszeitmodelle', holidays: 'Feiertage', time_entries: 'Zeiteinträge', time_corrections: 'Zeitkorrekturen', absences: 'Abwesenheiten', shifts: 'Schichten',
  pay_rules: 'Berechnungsmodelle', pay_adjustments: 'Einmalbeträge', mileage_logs: 'Fahrten', overtime_adjustments: 'Zeitkonto-Buchungen', object_revenues: 'Objektumsätze',
  materials: 'Material', stock_movements: 'Bestandsbewegungen', machines: 'Maschinen', machine_events: 'Maschinenereignisse',
  inspections: 'Qualitätskontrollen', inspection_items: 'Kontrollpunkte', defects: 'Mängel & Reklamationen', defect_log: 'Mangel-Verlauf',
  winter_areas: 'Winterdienstflächen', winter_standby: 'Bereitschaften', winter_operations: 'Winterdiensteinsätze', scans: 'Scan-Historie',
};
const titleOf = (r) => r.name || r.company_name || r.title || r.order_no || r.operation_no || r.defect_no || r.inspection_no || r.label || r.text || r.reason || r.subject || r.note || r.date || r.start_at || r.id;
const metaOf = (r) => [r.customer_no, r.object_no, r.employee_no, r.article_no, r.inventory_no, r.status, r.scheduled_date || r.start_date || r.month, r.updated_at ? 'geändert ' + fmtDateTime(r.updated_at) : null].filter(Boolean).join(' · ');

const st = { tab: 'daten', table: 'customers', q: '' };

export async function adminDataView() {
  if (!isAdmin()) return h('div', { class: 'notice bad' }, ic('alert'), 'Die Datenverwaltung ist dem Administrator vorbehalten.');
  const el = h('div', null, pageHead('Datenverwaltung', { sub: 'Administrator: alle Datensätze bearbeiten, löschen, wiederherstellen und sichern. Jede Aktion wird protokolliert.' }));
  el.append(tabs([{ key: 'daten', label: 'Datensätze' }, { key: 'papierkorb', label: 'Papierkorb' }, { key: 'sicherungen', label: 'Sicherung & Wiederherstellung' }], st.tab, (k) => { st.tab = k; refresh(); }));
  if (!navigator.onLine) { el.append(h('div', { class: 'notice warn' }, ic('wifiOff'), 'Die Datenverwaltung benötigt eine Internetverbindung.')); return el; }
  if (st.tab === 'sicherungen') { el.append(await backupsPanel()); return el; }
  const deleted = st.tab === 'papierkorb';
  if (deleted) {
    const t = await api('GET', '/api/admin/trash');
    el.append(h('div', { class: 'chips', style: { marginBottom: '12px' } }, t.tables.length ? t.tables.map((x) => h('button', { class: 'chip' + (x.table === st.table ? ' active' : ''), onclick: () => { st.table = x.table; refresh(); } }, `${TABLE_NAMES[x.table] || x.table} (${x.count})`)) : h('span', { class: 'muted' }, 'Der Papierkorb ist leer.')));
    if (!t.tables.length) return el;
    if (!t.tables.some((x) => x.table === st.table)) st.table = t.tables[0].table;
  }
  const sel = h('select', { style: { width: 'auto' }, onchange: (e) => { st.table = e.target.value; refresh(); } },
    Object.entries(TABLE_NAMES).sort((a, b) => a[1].localeCompare(b[1])).map(([k, v]) => h('option', { value: k, selected: k === st.table }, v)));
  const box = h('div');
  const load = async () => {
    box.replaceChildren(h('div', { class: 'loading' }, h('span', { class: 'spinner' })));
    try {
      const r = await api('GET', `/api/admin/records?table=${st.table}&deleted=${deleted ? 1 : 0}&q=${encodeURIComponent(st.q)}`);
      box.replaceChildren(card(`${TABLE_NAMES[st.table] || st.table} – ${deleted ? r.counts.geloescht || 0 : r.counts.aktiv || 0} ${deleted ? 'im Papierkorb' : 'Datensätze'}${r.rows.length >= 200 ? ' (erste 200 angezeigt)' : ''}`,
        r.rows.length ? h('div', { class: 'list' }, r.rows.map((x) => row({ title: String(titleOf(x)).slice(0, 120), meta: metaOf(x), onclick: () => recordDialog(r, x, deleted, load) }))) : empty('Keine Datensätze.')));
    } catch (e) { box.replaceChildren(h('div', { class: 'notice bad' }, e.message)); }
  };
  el.append(h('div', { class: 'toolbar' }, deleted ? null : sel, searchBox('In dieser Tabelle suchen …', (q) => { st.q = q; load(); }, st.q)), box);
  load();
  return el;
}

async function recordDialog(meta, rec, deleted, reload) {
  const inputs = {};
  const body = h('div', { class: 'form' });
  for (const c of meta.columns) {
    const locked = meta.locked.includes(c.name);
    const v = rec[c.name];
    const long = typeof v === 'string' && (v.length > 80 || v.includes('\n'));
    const inp = long ? h('textarea', { rows: 3 }) : h('input', { type: 'text' });
    inp.value = v === null || v === undefined ? '' : typeof v === 'string' && v.startsWith('data:image') ? '(Bild)' : String(v);
    if (locked || inp.value === '(Bild)') inp.disabled = true;
    inputs[c.name] = inp;
    body.append(h('div', { class: 'field half' }, h('label', null, c.name, h('span', { class: 'muted tiny' }, ` ${c.type}${locked ? ' · gesperrt' : ''}`)), inp));
  }
  const save = async () => {
    const data = {};
    for (const c of meta.columns) if (!inputs[c.name].disabled) { const nv = inputs[c.name].value; if (nv !== String(rec[c.name] ?? '')) data[c.name] = nv; }
    if (!Object.keys(data).length) return true;
    const ok = await modal({ title: 'Änderung bestätigen', body: h('div', null, h('p', null, 'Folgende Felder werden direkt in der Datenbank geändert (ohne fachliche Prüfung). Die Änderung wird mit altem und neuem Wert protokolliert:'), h('ul', null, Object.entries(data).map(([k, v]) => h('li', null, `${k}: „${rec[k] ?? ''}“ → „${v}“`)))), actions: [{ label: 'Abbrechen', value: false }, { label: 'Ändern', value: true, class: 'danger solid' }] });
    if (!ok) return false;
    await store.command('admin.update', { table: meta.table, id: rec.id, data, base_version: rec.version });
    toast('Geändert und protokolliert.'); reload(); return true;
  };
  const actions = deleted ? [
    { label: 'Endgültig löschen', class: 'danger', icon: 'trash', onClick: async () => { if (await hardDelete(meta.table, rec)) { reload(); return true; } return false; } },
    { label: 'Wiederherstellen', class: 'primary', icon: 'repeat', onClick: async () => { await store.command('admin.restore', { table: meta.table, id: rec.id }); toast('Wiederhergestellt.'); reload(); return true; } },
  ] : [
    { label: 'Löschen', class: 'danger', icon: 'trash', onClick: async () => {
      const ok = await modal({ title: 'Administrator: Löschen', body: h('p', null, `„${titleOf(rec)}“ löschen? Der Datensatz wird in den Papierkorb verschoben und kann wiederhergestellt werden.`), actions: [{ label: 'Abbrechen', value: false }, { label: 'Löschen', value: true, class: 'danger solid' }] });
      if (!ok) return false;
      await store.command('admin.delete', { table: meta.table, id: rec.id }); toast('In den Papierkorb verschoben.'); reload(); return true;
    } },
    { label: 'Speichern', class: 'primary', icon: 'check', onClick: save },
  ];
  await modal({ title: `${TABLE_NAMES[meta.table] || meta.table}: ${String(titleOf(rec)).slice(0, 60)}`, wide: true, body: h('div', null, h('div', { class: 'notice warn', style: { marginBottom: '12px' } }, ic('alert'), 'Direkte Bearbeitung auf Datenbankebene. Bitte nur für Korrekturen verwenden – im Normalfall die jeweilige Fachansicht nutzen.'), body), actions: [{ label: 'Schließen', value: null }, ...actions] });
}

async function hardDelete(table, rec) {
  const inp = h('input', { type: 'text', placeholder: 'ENDGÜLTIG LÖSCHEN' });
  const ok = await modal({ title: 'Endgültig löschen', body: h('div', null, h('div', { class: 'notice bad' }, ic('alert'), `„${titleOf(rec)}“ wird unwiderruflich aus der Datenbank entfernt (einschließlich abhängiger Einträge wie Checklistenpunkte oder Verlauf). Dies kann nicht rückgängig gemacht werden.`),
    h('p', null, 'Zur Bestätigung bitte ', h('strong', null, 'ENDGÜLTIG LÖSCHEN'), ' eingeben:'), inp),
  actions: [{ label: 'Abbrechen', value: false }, { label: 'Endgültig löschen', class: 'danger solid', onClick: () => { if (inp.value.trim() !== 'ENDGÜLTIG LÖSCHEN') { toast('Bitte die Bestätigung exakt eingeben.', 'bad'); return false; } return true; } }] });
  if (!ok) return false;
  try { const r = await store.command('admin.hardDelete', { table, id: rec.id, confirm: 'ENDGÜLTIG LÖSCHEN' }); toast(`Endgültig gelöscht${r.removed?.length ? ' (inkl. ' + r.removed.join(', ') + ')' : ''}.`); return true; } catch (e) { errorToast(e); return false; }
}

async function backupsPanel() {
  const { backups } = await api('GET', '/api/admin/backups');
  const size = (b) => (b > 1048576 ? `${(b / 1048576).toFixed(1).replace('.', ',')} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);
  const fileInp = h('input', { type: 'file', accept: '.sqlite' });
  const wrap = h('div');
  wrap.append(card('Sicherung erstellen', h('div', { class: 'card-pad' },
    h('p', { class: 'small' }, 'Erstellt eine vollständige Sicherung der Datenbank einschließlich Fotos und Dokumenten auf dem Server. Zusätzlich empfohlen: regelmäßige Sicherungen außer Haus (siehe Installationsanleitung).'),
    h('div', { class: 'btn-row' }, btn('Jetzt sichern', { icon: 'archive', cls: 'primary', onclick: async () => { try { const r = await api('POST', '/api/admin/backups'); toast(`Sicherung ${r.name} erstellt.`); refresh(); } catch (e) { errorToast(e); } } }))), { iconName: 'archive' }));
  wrap.append(card('Vorhandene Sicherungen', backups.length ? h('div', { class: 'list' }, backups.map((b) => h('div', { class: 'row', style: { cursor: 'default', flexWrap: 'wrap' } },
    h('div', { class: 'grow' }, h('div', { class: 'title' }, b.name), h('div', { class: 'meta' }, `${fmtDateTime(b.created_at)} · ${size(b.size)}${b.with_uploads ? ' · inkl. Dateien' : ''}`)),
    h('div', { class: 'btn-row' }, h('a', { class: 'btn sm', href: `/api/admin/backups/${encodeURIComponent(b.name)}/download` }, ic('download'), 'Herunterladen'),
      btn('Wiederherstellen', { cls: 'sm danger', icon: 'repeat', onclick: () => restore(b.name) }))))) : empty('Noch keine Sicherungen.'), { iconName: 'history' }));
  wrap.append(card('Sicherungsdatei hochladen', h('div', { class: 'card-pad' }, h('p', { class: 'small' }, 'Z. B. eine heruntergeladene Sicherung von einem anderen Server. Sie erscheint danach in der Liste und kann wiederhergestellt werden.'),
    h('div', { class: 'input-with-btn' }, fileInp, btn('Hochladen', { icon: 'upload', onclick: async () => {
      if (!fileInp.files[0]) return toast('Bitte eine .sqlite-Datei wählen.', 'bad');
      const fd = new FormData(); fd.append('file', fileInp.files[0]);
      try { const r = await api('POST', '/api/admin/backups/upload', fd, { timeout: 600000 }); toast(`Hochgeladen als ${r.name}.`); refresh(); } catch (e) { errorToast(e); }
    } }))), { iconName: 'upload' }));
  return wrap;
}

async function restore(name) {
  const inp = h('input', { type: 'text', placeholder: 'WIEDERHERSTELLEN' });
  const ok = await modal({ title: 'Sicherung wiederherstellen', body: h('div', null,
    h('div', { class: 'notice bad' }, ic('alert'), `Alle aktuellen Daten werden durch den Stand der Sicherung „${name}“ ersetzt. Der aktuelle Stand wird vorher automatisch gesichert. Alle Geräte laden danach die Daten neu; nicht übertragene Offline-Eingaben anderer Geräte können verloren gehen.`),
    h('p', null, 'Zur Bestätigung bitte ', h('strong', null, 'WIEDERHERSTELLEN'), ' eingeben:'), inp),
  actions: [{ label: 'Abbrechen', value: false }, { label: 'Wiederherstellen', class: 'danger solid', onClick: () => { if (inp.value.trim() !== 'WIEDERHERSTELLEN') { toast('Bitte die Bestätigung exakt eingeben.', 'bad'); return false; } return true; } }] });
  if (!ok) return;
  try {
    const r = await api('POST', '/api/admin/backups/restore', { name, confirm: 'WIEDERHERSTELLEN' }, { timeout: 600000 });
    toast(`Wiederhergestellt. Vorheriger Stand gesichert als ${r.safety}.`, 'ok', 8000);
    await store.pull(true).catch(() => {});
    refresh();
  } catch (e) { errorToast(e); }
}
