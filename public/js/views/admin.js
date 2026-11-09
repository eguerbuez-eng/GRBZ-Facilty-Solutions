import { h, ic, card, empty, row, badge, pageHead, btn, kv, toast, errorToast, modal, buildForm, confirmDialog, formDialog } from '../ui.js';
import * as store from '../store.js';
import { api } from '../api.js';
import { may, auditText, user } from './common.js';
import { ROLES } from '/shared/constants.js';
import { fmtDateTime } from '/shared/dates.js';
import { NAV, allowed, showPasswordChange, getSettings, refresh } from '../app.js';
import { onScan, setScanConsumer, scannerConfig, saveScannerConfig, scanStats } from '../scanner.js';

export function menuView() {
  const tiles = h('div', { class: 'tiles' });
  for (const item of NAV) if (!item.group && allowed(item)) tiles.append(h('a', { class: 'tile', href: item.href }, ic(item.icon), h('div', null, item.label)));
  const u = user();
  return h('div', null, pageHead('Menü', { sub: `${u.name} · ${u.role_name || ROLES[u.role] || u.role}` }), tiles);
}

// ---------- Synchronisation ----------
export async function syncView() {
  const s = store.status;
  const failed = await store.listFailed();
  const conflicts = await store.listConflicts();
  const el = h('div', null, pageHead('Synchronisation', { sub: 'Offline-Daten, Warteschlange und Konflikte' }));
  el.append(card('Status', kv([
    ['Verbindung', s.online && navigator.onLine ? badge('online', 'ok') : badge('offline', 'warn')],
    ['Letzte Synchronisation', s.lastSync ? fmtDateTime(s.lastSync) : 'noch nie'],
    ['Nicht übertragene Vorgänge', String(s.pending)], ['Abgelehnte Vorgänge', String(failed.length)], ['Konflikte', String(conflicts.length)],
    ['Letzter Fehler', s.lastError || '–'],
  ]), { iconName: 'sync', actions: [btn('Jetzt synchronisieren', { cls: 'sm primary', icon: 'sync', onclick: async () => { await store.flush(); toast(store.status.online ? 'Synchronisiert.' : 'Keine Verbindung.', store.status.online ? 'ok' : 'warn'); refresh(); } })] }));
  if (conflicts.length) {
    el.append(card('Konflikte', h('div', { class: 'list' }, conflicts.map((c) => h('div', { class: 'row', style: { cursor: 'default', flexWrap: 'wrap' } },
      h('div', { class: 'grow' }, h('div', { class: 'title' }, opText(c.op)), h('div', { class: 'meta', style: { whiteSpace: 'normal' } }, `${c.error} · ${fmtDateTime(c.at)}`)),
      h('div', { class: 'btn-row' }, btn('Serverstand übernehmen', { cls: 'sm', onclick: async () => { await store.resolveConflict(c.id, 'server'); refresh(); } }),
        btn('Meine Änderung erzwingen', { cls: 'sm danger', onclick: async () => { if (await confirmDialog('Ihre Änderung überschreibt die zwischenzeitliche Änderung des anderen Geräts. Fortfahren?', { danger: true, ok: 'Überschreiben' })) { await store.resolveConflict(c.id, 'mine'); refresh(); } } }))))), { iconName: 'alert' }));
  }
  if (failed.length) {
    el.append(card('Vom Server abgelehnte Vorgänge', h('div', { class: 'list' }, failed.map((f) => h('div', { class: 'row', style: { cursor: 'default', flexWrap: 'wrap' } },
      h('div', { class: 'grow' }, h('div', { class: 'title' }, f.photo ? 'Foto-Upload' : opText(f.op)), h('div', { class: 'meta', style: { whiteSpace: 'normal', color: 'var(--bad)' } }, [f.error, ...(f.details || [])].join(' · ')), h('div', { class: 'meta' }, fmtDateTime(f.at))),
      h('div', { class: 'btn-row' }, btn('Erneut versuchen', { cls: 'sm', onclick: async () => { await store.retryFailed(f.id); refresh(); } }),
        btn('Verwerfen', { cls: 'sm danger', onclick: async () => { if (await confirmDialog('Diesen Vorgang endgültig verwerfen?', { danger: true, ok: 'Verwerfen' })) { await store.discardFailed(f.id); refresh(); } } }))))), { iconName: 'alert' }));
  }
  el.append(card('Werkzeuge', h('div', { class: 'card-pad btn-row' },
    btn('Vollständig neu laden', { icon: 'download', onclick: async () => { try { await store.pull(true); toast('Lokaler Datenbestand neu geladen.'); refresh(); } catch (e) { errorToast(e); } } }),
    btn('Speicherbelegung', { icon: 'info', onclick: async () => {
      const est = await navigator.storage?.estimate?.();
      const persisted = await navigator.storage?.persisted?.();
      await modal({ title: 'Lokaler Speicher', body: kv([['Belegt', est ? `${(est.usage / 1048576).toFixed(1)} MB` : 'unbekannt'], ['Verfügbar', est ? `${(est.quota / 1048576).toFixed(0)} MB` : 'unbekannt'], ['Dauerhaft gespeichert', persisted ? 'ja' : 'nein (Browser kann Daten bei Speichermangel löschen)']]), actions: [{ label: 'OK', value: true }] });
    } })),
    { iconName: 'settings' }));
  el.append(h('div', { class: 'notice' }, ic('info'), 'Alle Eingaben werden zuerst auf diesem Gerät gespeichert und automatisch übertragen, sobald eine Verbindung besteht. Wiederholte Übertragungen erzeugen keine doppelten Datensätze.'));
  return el;
}

const OP_LABELS = {
  'entity.save': 'Datensatz speichern', 'order.save': 'Auftrag speichern', 'order.checkItem': 'Checklistenpunkt', 'order.complete': 'Auftrag abschließen', 'order.setStatus': 'Auftragsstatus',
  'time.clock': 'Zeitstempel', 'time.correction': 'Zeitkorrektur', 'stock.move': 'Bestandsbuchung', 'defect.save': 'Mangel', 'defect.setStatus': 'Mangelstatus', 'winter.save': 'Winterdiensteinsatz',
  'winter.sign': 'Winterdienst-Unterschrift', 'scan.log': 'Scan', 'inspection.save': 'Qualitätskontrolle', 'machine.event': 'Maschinenereignis',
};
function opText(op) { return `${OP_LABELS[op.type] || op.type}${op.payload?.entity ? ' (' + op.payload.entity + ')' : ''}`; }

// ---------- Konto ----------
export function accountView() {
  const u = user();
  const scanOut = h('div', { class: 'mono small', style: { minHeight: '22px', marginTop: '8px' } }, '–');
  // Scanner-Test: Scans werden hier nur angezeigt (nicht weiterverarbeitet)
  const keyLog = h('div', { class: 'mono tiny muted', style: { marginTop: '6px', wordBreak: 'break-all' } });
  const off = onScan((code, method, meta) => { scanOut.textContent = `${meta?.duplicate ? '(Doppelscan ignoriert) ' : ''}${method === 'scanner' ? 'Scanner' : method}: ${code}${meta?.field ? ' · Empfang: ' + meta.field : ''}${meta?.gaps ? ' · max. Zeichenabstand ' + meta.gaps + ' ms' : ''}`; });
  const offConsumer = setScanConsumer(() => {}, { allowInModal: true });
  const raw = []; let lastT = 0;
  const kd = (e) => { const t = e.timeStamp; raw.push(`${e.key === 'Unidentified' ? '⍰' : e.key.length === 1 ? e.key : '[' + e.key + ']'}${lastT ? '+' + Math.round(t - lastT) : ''}`); lastT = t; raw.splice(0, Math.max(0, raw.length - 40)); keyLog.textContent = 'Tastenereignisse (Zeichen+ms): ' + raw.join(' '); };
  window.addEventListener('keydown', kd, true);
  setTimeout(() => { const chk = setInterval(() => { if (!scanOut.isConnected) { off(); offConsumer(); window.removeEventListener('keydown', kd, true); clearInterval(chk); } }, 1000); }, 100);
  const sc = scannerConfig();
  const cfgForm = buildForm([
    { name: 'maxGap', label: 'Max. Zeichenabstand eines Scans (ms)', type: 'number', half: true, help: 'Standard 45. Menschliches Tippen ist langsamer.' },
    { name: 'minLen', label: 'Mindestlänge eines Codes', type: 'number', half: true },
    { name: 'prefix', label: 'Präfix-Zeichen (optional)', type: 'text', half: true, help: 'Nur wenn im Honeywell-Profil ein Präfix eingestellt ist, z. B. „§“.' },
    { name: 'dedupeMs', label: 'Doppelscan-Sperre (ms)', type: 'number', half: true },
    { name: 'sink', label: 'Empfangsfeld-Modus (falls Scans ohne aktives Feld nicht ankommen)', type: 'bool' },
  ], { ...sc, sink: sc.sink ? 1 : 0 });
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  return h('div', null,
    pageHead('Mein Konto', { sub: `${u.name} · ${u.role_name || ROLES[u.role] || u.role}` }),
    card('Benutzer', kv([['Name', u.name], ['E-Mail', u.email], ['Personalnummer', u.employee_no], ['Rolle', u.role_name || ROLES[u.role]]]), { iconName: 'user' }),
    card('Sicherheit', h('div', { class: 'card-pad btn-row' },
      btn('Passwort ändern', { icon: 'key', onclick: () => showPasswordChange(false) }),
      btn('Abmelden', { icon: 'logout', cls: 'danger', onclick: async () => {
        try { await store.logout(false); location.reload(); } catch (e) {
          if (e.data?.pending) {
            if (await confirmDialog(`${e.data.pending} Vorgänge sind noch nicht übertragen und gehen beim Abmelden verloren. Trotzdem abmelden?`, { danger: true, ok: 'Trotzdem abmelden' })) { await store.logout(true); location.reload(); }
          } else errorToast(e);
        }
      } })), { iconName: 'shield' }),
    card('Gerät & App', h('div', null, kv([
      ['Installiert als App', standalone ? 'ja' : 'nein – im Browsermenü „Zum Startbildschirm hinzufügen“ / „App installieren“ wählen'],
      ['Kamera-Scanning', 'BarcodeDetector' in window ? 'BarcodeDetector (nativ)' : 'jsQR (Software)'], ['Offline-Speicher', 'indexedDB' in window ? 'verfügbar' : 'nicht verfügbar'],
      ['Version', getSettings().version || '–'],
    ]), h('div', { class: 'card-pad' }, h('strong', null, 'Scanner-Test'), h('p', { class: 'small muted' }, 'Hardware-Scantaste drücken (Honeywell EDA52) – der erkannte Code erscheint hier, ohne verarbeitet zu werden. Erscheint nichts, bitte die Keyboard-Wedge-Einstellung prüfen (siehe Handbuch).'), scanOut, keyLog,
      h('p', { class: 'tiny muted' }, `Seit App-Start erkannt: ${scanStats.received}, Doppelscans ignoriert: ${scanStats.duplicates}`))), { iconName: 'scan' }),
    card('Scanner-Einstellungen (dieses Gerät)', h('div', { class: 'card-pad' }, cfgForm.el, h('div', { class: 'form-actions' },
      btn('Standard', { onclick: () => { saveScannerConfig({ maxGap: 45, minLen: 4, prefix: '', dedupeMs: 1200, sink: false }); toast('Standardwerte gesetzt.'); refresh(); } }),
      btn('Speichern', { cls: 'primary', icon: 'check', onclick: () => { const v = cfgForm.values(); saveScannerConfig({ maxGap: Math.max(10, +v.maxGap || 45), minLen: Math.max(1, +v.minLen || 4), prefix: (v.prefix || '').slice(0, 1), dedupeMs: Math.max(0, +v.dedupeMs || 0), sink: !!v.sink }); toast('Scanner-Einstellungen gespeichert.'); } }))), { iconName: 'settings' }));
}

// ---------- Einstellungen ----------
export async function settingsView() {
  const { settings } = await api('GET', '/api/settings');
  const f = buildForm([
    { name: 'company_name', label: 'Firmenname', type: 'text', required: true },
    { name: 'company_address', label: 'Firmenadresse (für Berichte)', type: 'text' },
    { name: 'company_phone', label: 'Telefon', type: 'tel', half: true }, { name: 'company_email', label: 'E-Mail', type: 'email', half: true },
    { name: 'public_url', label: 'Öffentliche Adresse der Anwendung', type: 'text', placeholder: 'https://fms.grbz-solutions.com', help: 'Wird in QR-Codes verwendet. Vor dem Drucken von Etiketten festlegen und danach nicht mehr ändern!' },
    { name: 'recurrence_horizon_days', label: 'Serienaufträge: Planungshorizont (Tage)', type: 'number', half: true },
    { name: 'photo_retention_months', label: 'Aufbewahrung Fotos (Monate)', type: 'number', half: true },
    { name: 'portal_enabled', label: 'Kundenportal aktivieren', type: 'bool', help: 'Kunden mit eigenem Zugang sehen ausschließlich ihre eigenen, freigegebenen Daten.' },
  ], settings);
  const logoInput = h('input', { type: 'file', accept: 'image/png,image/jpeg' });
  const services = store.all('services').sort((a, b) => a.name.localeCompare(b.name));
  return h('div', null,
    pageHead('Einstellungen', { sub: 'Unternehmen, Branding, Kundenportal, Datensicherung' }),
    card('Unternehmen & System', h('div', { class: 'card-pad' }, f.el, h('div', { class: 'form-actions' }, btn('Speichern', { cls: 'primary', icon: 'check', onclick: async () => {
      if (!f.check()) return;
      try { await api('PUT', '/api/settings', f.values()); toast('Einstellungen gespeichert.'); } catch (e) { errorToast(e); }
    } }))), { iconName: 'settings' }),
    card('Logo', h('div', { class: 'card-pad' },
      getSettings().has_logo ? h('img', { src: '/api/branding/logo?' + Date.now(), alt: 'Logo', style: { maxHeight: '70px', marginBottom: '12px', display: 'block' } }) : h('p', { class: 'muted' }, 'Noch kein Logo hinterlegt – es wird die GRBZ-Wortmarke verwendet.'),
      h('div', { class: 'input-with-btn' }, logoInput, btn('Hochladen', { icon: 'upload', onclick: async () => {
        if (!logoInput.files[0]) return toast('Bitte eine PNG- oder JPEG-Datei wählen.', 'bad');
        const fd = new FormData(); fd.append('file', logoInput.files[0]);
        try { await api('POST', '/api/settings/logo', fd); toast('Logo gespeichert. Die App wird neu geladen.'); setTimeout(() => location.reload(), 800); } catch (e) { errorToast(e); }
      } })), h('p', { class: 'tiny muted' }, 'Empfohlen: PNG mit transparentem Hintergrund, max. 2 MB. Das Logo erscheint in der App und in allen PDF-Berichten.')), { iconName: 'image' }),
    card('Dienstleistungen', h('div', { class: 'list' }, services.map((s) => row({ title: s.name, meta: s.description, right: s.active ? null : badge('inaktiv'), onclick: () => editService(s) }))),
      { iconName: 'list', actions: [btn('Neu', { cls: 'sm', icon: 'plus', onclick: () => editService() })] }),
    card('Datensicherung & Aufbewahrung', h('div', { class: 'card-pad' },
      h('p', { class: 'small' }, 'Die vollständige Sicherung (Datenbank + Dateien) erfolgt serverseitig per „npm run backup“ (täglich per Zeitplan empfohlen). Hier kann zusätzlich eine Datenbankkopie heruntergeladen werden.'),
      h('div', { class: 'btn-row' }, h('a', { class: 'btn', href: '/api/admin/backup' }, ic('download'), 'Datenbank herunterladen'),
        btn('Alte Fotos bereinigen', { icon: 'trash', cls: 'danger', onclick: () => retention(settings.photo_retention_months) }))), { iconName: 'archive' }));
}

async function editService(s) {
  const v = await formDialog(s ? 'Dienstleistung bearbeiten' : 'Neue Dienstleistung', [
    { name: 'name', label: 'Bezeichnung', type: 'text', required: true }, { name: 'description', label: 'Beschreibung', type: 'textarea' }, { name: 'active', label: 'Aktiv', type: 'bool', default: 1 },
  ], s || {});
  if (!v) return;
  try { await store.command('entity.save', { entity: 'services', id: s?.id || store.uuid(), data: v, base_version: s?.version }); toast('Gespeichert.'); refresh(); } catch (e) { errorToast(e); }
}

async function retention(months) {
  try {
    const r = await api('GET', `/api/admin/retention?months=${months || 24}`);
    if (!(await confirmDialog(`${r.count} Foto(s) sind älter als ${r.months} Monate (vor ${fmtDateTime(r.cutoff)}) und gehören nicht zu offenen Mängeln. Endgültig löschen? Dies kann nicht rückgängig gemacht werden.`, { danger: true, ok: 'Endgültig löschen' }))) return;
    const d = await api('POST', '/api/admin/retention', { months: r.months });
    toast(`${d.deleted} Foto(s) gelöscht.`);
  } catch (e) { errorToast(e); }
}

// ---------- Protokoll ----------
export async function auditView() {
  const box = h('div');
  let before = null;
  let q = '';
  const load = async (append) => {
    const r = await api('GET', `/api/audit?limit=100${before ? '&before=' + before : ''}${q ? '&q=' + encodeURIComponent(q) : ''}`);
    if (r.entries.length) before = r.entries[r.entries.length - 1].id;
    const rows = r.entries.map((a) => h('tr', null, h('td', { class: 'nowrap' }, fmtDateTime(a.at)), h('td', null, a.user_name || 'System'), h('td', null, auditText({ ...a, details: a.details ? JSON.parse(a.details) : null })), h('td', { class: 'small muted' }, a.ip || '')));
    if (!append) box.replaceChildren(card(null, h('div', { class: 'table-wrap' }, h('table', { class: 'data' }, h('thead', null, h('tr', null, ['Zeitpunkt', 'Benutzer', 'Aktion', 'IP'].map((t) => h('th', null, t)))), h('tbody', null, rows)))));
    else box.querySelector('tbody').append(...rows);
    more.classList.toggle('hidden', r.entries.length < 100);
  };
  const more = btn('Ältere laden', { onclick: () => load(true) });
  const search = h('input', { type: 'search', placeholder: 'Aktion oder Detail suchen …' });
  search.addEventListener('change', () => { q = search.value.trim(); before = null; load(false); });
  await load(false);
  return h('div', null, pageHead('Änderungsprotokoll', { sub: 'Nachvollziehbarkeit aller wichtigen Änderungen und Anmeldungen' }), h('div', { class: 'toolbar' }, search), box, h('div', { style: { marginTop: '12px' } }, more));
}
