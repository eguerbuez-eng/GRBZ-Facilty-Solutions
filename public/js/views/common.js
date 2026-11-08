// Gemeinsame Bausteine für die Modulansichten.
import { h, ic, badge, buildForm, btn, toast, errorToast, pageHead, card, confirmDialog } from '../ui.js';
import * as store from '../store.js';
import { ENTITIES } from '/shared/entities.js';
import { can, ORDER_STATUS, DEFECT_STATUS, ROLES } from '/shared/constants.js';
import { fmtDate, fmtDateTime } from '/shared/dates.js';
import { go } from '../app.js';
import { scanWithCamera } from '../scanner.js';

export const user = () => store.getUser();
export const may = (p) => [].concat(p).some((x) => can(store.getUser(), x));

/** Auswahllisten für Referenzfelder aus dem lokalen Bestand */
export function refOptions(ref, filter) {
  switch (ref) {
    case 'customers': return store.all('customers', (c) => !c.archived && (!filter || filter(c))).sort((a, b) => a.company_name.localeCompare(b.company_name)).map((c) => ({ value: c.id, label: `${c.company_name}${c.customer_no ? ' (' + c.customer_no + ')' : ''}` }));
    case 'objects': return store.all('objects', (o) => !o.archived && (!filter || filter(o))).sort((a, b) => a.name.localeCompare(b.name)).map((o) => ({ value: o.id, label: `${o.name}${o.object_no ? ' · ' + o.object_no : ''}` }));
    case 'users': return store.all('users', (u) => u.active && u.role !== 'kunde' && (!filter || filter(u))).sort((a, b) => a.name.localeCompare(b.name)).map((u) => ({ value: u.id, label: u.name }));
    case 'services': return store.all('services', (s) => s.active).sort((a, b) => a.name.localeCompare(b.name)).map((s) => ({ value: s.id, label: s.name }));
    case 'templates': return store.all('checklist_templates', (t) => t.active && (!filter || filter(t))).sort((a, b) => a.name.localeCompare(b.name)).map((t) => ({ value: t.id, label: t.name }));
    case 'machines': return store.all('machines', (m) => !m.archived).sort((a, b) => a.name.localeCompare(b.name)).map((m) => ({ value: m.id, label: `${m.name}${m.inventory_no ? ' · ' + m.inventory_no : ''}` }));
    case 'materials': return store.all('materials', (m) => !m.archived).sort((a, b) => a.name.localeCompare(b.name)).map((m) => ({ value: m.id, label: `${m.name}${m.article_no ? ' · ' + m.article_no : ''}` }));
    case 'employment_types': case 'positions': case 'departments': case 'work_models':
      return store.all(ref, (x) => x.active && (!filter || filter(x))).sort((a, b) => (a.sort ?? 100) - (b.sort ?? 100) || a.name.localeCompare(b.name)).map((x) => ({ value: x.id, label: x.name }));
    case 'roles': return store.all('roles', (r) => r.active && (!filter || filter(r))).sort((a, b) => a.sort - b.sort).map((r) => ({ value: r.role_key, label: r.name }));
    default: return [];
  }
}

/** Entitätsfelder um Referenzoptionen ergänzen und nach Rechten filtern */
export function formFields(entity, { isNew = true, fixed = {} } = {}) {
  return ENTITIES[entity].fields
    .filter((f) => (!f.createOnly || isNew) && (!f.perm || may(f.perm)))
    .map((f) => ({ ...f, refOptions: f.type === 'ref' ? refOptions(f.ref) : undefined, readonly: f.name in fixed }));
}

export function orderStatusBadge(s) {
  const kind = { geplant: 'info', in_bearbeitung: 'accent', abgeschlossen: 'ok', unterbrochen: 'warn', mangel: 'bad' }[s] || '';
  return badge(ORDER_STATUS[s] || s, kind);
}

export function defectStatusBadge(s) {
  const kind = { offen: 'bad', in_bearbeitung: 'warn', behoben: 'info', abgenommen: 'ok', verworfen: '' }[s] || '';
  return badge(DEFECT_STATUS[s] || s, kind);
}

export const pendingBadge = (r) => (r?._pending || r?._local ? badge('nicht synchronisiert', 'warn') : null);

/** Generische Bearbeitungsseite (Anlegen/Ändern) für einfache Stammdaten */
export function entityFormPage(entity, id, { back, after, fixed = {}, title } = {}) {
  const def = ENTITIES[entity];
  const ex = id ? store.get(def.table, id) : null;
  if (id && !ex) return h('div', { class: 'notice bad' }, `${def.label} nicht gefunden.`);
  const fields = formFields(entity, { isNew: !ex, fixed });
  const values = { ...(ex || {}), ...fixed };
  const f = buildForm(fields, values, { onScan: async (input) => { const c = await scanWithCamera({ title: 'Code scannen' }); if (c) input.value = c; } });
  const save = btn(ex ? 'Speichern' : 'Anlegen', {
    cls: 'primary lg', icon: 'check', onclick: async () => {
      if (!f.check()) return;
      const data = { ...f.values(), ...fixed };
      if (ex) for (const k of Object.keys(data)) if (String(data[k] ?? '') === String(ex[k] ?? '')) delete data[k];
      save.disabled = true;
      try {
        const newId = ex ? ex.id : store.uuid();
        const r = await store.command('entity.save', { entity, id: newId, data, base_version: ex?.version });
        toast(r.queued ? 'Gespeichert – wird bei Verbindung übertragen.' : 'Gespeichert.');
        if (after) after(newId); else go(back || '#/');
      } catch (e) { errorToast(e); } finally { save.disabled = false; }
    },
  });
  return h('div', null,
    pageHead(title || (ex ? `${def.label} bearbeiten` : `${def.label} anlegen`), { back, sub: ex ? def.title(ex) : null }),
    card(null, h('div', { class: 'card-pad' }, f.el, h('div', { class: 'form-actions' }, btn('Abbrechen', { href: back || '#/' }), save))));
}

export async function archiveToggle(entity, row) {
  const def = ENTITIES[entity];
  const ok = await confirmDialog(row.archived ? `${def.label} wieder aktivieren?` : `${def.label} „${def.title(row)}“ archivieren? Archivierte Einträge bleiben erhalten, werden aber in Listen ausgeblendet.`, { ok: row.archived ? 'Aktivieren' : 'Archivieren' });
  if (!ok) return;
  try { await store.command('entity.archive', { entity, id: row.id, archived: !row.archived }); toast(row.archived ? 'Reaktiviert.' : 'Archiviert.'); } catch (e) { errorToast(e); }
}

/** Historie (Änderungsprotokoll) einer Akte – benötigt Verbindung */
export function historyCard(entity, id) {
  const body = h('div', { class: 'empty small' }, 'Historie wird geladen …');
  const el = card('Historie', body, { iconName: 'history' });
  import('../api.js').then(({ api }) => api('GET', `/api/history/${entity}/${id}`)).then((res) => {
    body.replaceWith(res.history.length ? h('ul', { class: 'timeline' }, res.history.slice(0, 50).map((a) => h('li', null,
      h('div', null, auditText(a)), h('div', { class: 'tl-when' }, `${fmtDateTime(a.at)} · ${a.user_name || 'System'}`)))) : h('div', { class: 'empty small' }, 'Noch keine Einträge.'));
  }).catch((e) => { body.textContent = e.offline ? 'Historie ist offline nicht verfügbar.' : e.message; });
  return el;
}

const ACTIONS = {
  'customers.erstellt': 'Kunde angelegt', 'customers.geaendert': 'Kundendaten geändert', 'customers.archiviert': 'Kunde archiviert', 'customers.reaktiviert': 'Kunde reaktiviert',
  'customers.dienstleistungen': 'Dienstleistungen geändert', 'objects.erstellt': 'Objekt angelegt', 'objects.geaendert': 'Objektdaten geändert',
  'objects.archiviert': 'Objekt archiviert', 'objects.mitarbeiter': 'Mitarbeiterzuordnung geändert', 'auftrag.erstellt': 'Auftrag erstellt',
  'auftrag.geaendert': 'Auftrag geändert', 'auftrag.status': 'Auftragsstatus geändert', 'auftrag.abgeschlossen': 'Auftrag abgeschlossen', 'auftrag.geloescht': 'Auftrag gelöscht',
  'qr.erstellt': 'QR-Code erstellt', 'qr.deaktiviert': 'QR-Code deaktiviert', 'qr.aktiviert': 'QR-Code aktiviert', 'qr.neu_zugeordnet': 'QR-Code neu zugeordnet', 'qr.gedruckt': 'QR-Etiketten gedruckt',
  'foto.hochgeladen': 'Foto hochgeladen', 'foto.geloescht': 'Foto gelöscht', 'foto.freigegeben': 'Foto für Kunden freigegeben',
  'zeit.beginn': 'Arbeitsbeginn gestempelt', 'zeit.ende': 'Arbeitsende gestempelt', 'zeit.korrektur_beantragt': 'Zeitkorrektur beantragt',
  'zeit.korrektur_genehmigt': 'Zeitkorrektur genehmigt', 'zeit.korrektur_abgelehnt': 'Zeitkorrektur abgelehnt', 'mangel.erstellt': 'Mangel gemeldet', 'mangel.status': 'Mangelstatus geändert',
  'kontrolle.erstellt': 'Qualitätskontrolle durchgeführt', 'winterdienst.erstellt': 'Winterdiensteinsatz begonnen', 'winterdienst.unterschrieben': 'Winterdiensteinsatz unterschrieben',
  'dokument.hochgeladen': 'Dokument hochgeladen', 'dokument.geloescht': 'Dokument gelöscht', 'bericht.archiviert': 'Bericht abgelegt',
  'materials.erstellt': 'Artikel angelegt', 'machines.erstellt': 'Maschine angelegt', 'maschine.wartung': 'Wartung dokumentiert', 'maschine.defekt': 'Defekt gemeldet', 'maschine.reparatur': 'Reparatur dokumentiert',
  'benutzer.erstellt': 'Benutzer angelegt', 'benutzer.geaendert': 'Benutzer geändert', 'benutzer.passwort_zurueckgesetzt': 'Passwort zurückgesetzt',
  'serie.erstellt': 'Serienauftrag angelegt', 'serie.geaendert': 'Serienauftrag geändert', 'checkliste.gespeichert': 'Checkliste gespeichert',
  'personal.akte_geaendert': 'Personalakte geändert', 'benutzer.geloescht': 'Mitarbeiter gelöscht', 'abwesenheit.beantragt': 'Abwesenheit beantragt',
  'abwesenheit.erfasst': 'Abwesenheit erfasst', 'abwesenheit.genehmigt': 'Abwesenheit genehmigt', 'abwesenheit.abgelehnt': 'Abwesenheit abgelehnt', 'abwesenheit.storniert': 'Abwesenheit storniert',
  'abwesenheit.geaendert': 'Abwesenheit geändert', 'dienstplan.kopiert': 'Dienstplan-Woche kopiert', 'vertretung.zugewiesen': 'Vertretung zugewiesen',
  'rolle.erstellt': 'Rolle angelegt', 'rolle.geaendert': 'Rolle/Rechte geändert', 'rolle.geloescht': 'Rolle gelöscht', 'pay_rules.erstellt': 'Berechnungsmodell angelegt',
  'pay_rules.geaendert': 'Berechnungsmodell geändert', 'pay_adjustments.erstellt': 'Einmalbetrag erfasst', 'export.personalkosten': 'Personalkosten exportiert', 'bericht.personalkosten': 'Personalkostenbericht erstellt',
  'einstellungen.geaendert': 'Einstellungen geändert', 'einstellungen.logo': 'Logo geändert', 'passwort.geaendert': 'Passwort geändert',
  'ersteinrichtung.admin': 'Ersteinrichtung: Administrator angelegt', 'login.gesperrt': 'Konto nach Fehlversuchen gesperrt', 'export.zeit': 'Arbeitszeit exportiert',
  'backup.heruntergeladen': 'Datensicherung heruntergeladen', 'aufbewahrung.bereinigt': 'Alte Fotos bereinigt', 'dokument.geaendert': 'Dokument geändert',
  'serie.geloescht': 'Serienauftrag gelöscht', 'foto.freigabe_entzogen': 'Fotofreigabe entzogen', 'contact_history.erstellt': 'Kontakt erfasst',
  'services.erstellt': 'Dienstleistung angelegt', 'services.geaendert': 'Dienstleistung geändert', 'materials.geaendert': 'Artikel geändert', 'machines.geaendert': 'Maschine geändert',
  'checklist_templates.erstellt': 'Checkliste angelegt', 'checklist_templates.geaendert': 'Checkliste geändert', 'winter_areas.erstellt': 'Winterdienstfläche angelegt',
  'winter_standby.erstellt': 'Bereitschaft geplant', 'maschine.pruefung': 'Prüfung dokumentiert', 'notfall.admin_erstellt': 'Notfall-Administrator angelegt', 'login': 'Anmeldung', 'logout': 'Abmeldung', 'login.fehlgeschlagen': 'Fehlgeschlagene Anmeldung', 'reklamation.portal': 'Reklamation über Kundenportal',
};
export function auditText(a) {
  let t = ACTIONS[a.action] || (a.action.startsWith('export.') ? 'Export: ' + a.action.slice(7) : a.action);
  const d = a.details || {};
  if (d.nr) t += ` (${d.nr})`;
  if (d.label) t += ` (${d.label})`;
  if (d.titel) t += `: ${d.titel}`;
  if (a.action === 'auftrag.status' && d.nach) t += `: ${ORDER_STATUS[d.von] || d.von} → ${ORDER_STATUS[d.nach] || d.nach}`;
  return t;
}

export function userLabel(id) {
  const u = store.get('users', id);
  return u ? u.name : '–';
}
export const roleLabel = (r) => store.all('roles', (x) => x.role_key === r)[0]?.name || ROLES[r] || r;

export function phoneLink(v) { return v ? h('a', { href: 'tel:' + v.replace(/[^\d+]/g, '') }, v) : null; }
export function mailLink(v) { return v ? h('a', { href: 'mailto:' + v }, v) : null; }
export function mapLink(street, zip, city) {
  const a = [street, [zip, city].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  return a ? h('a', { href: 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(a), target: '_blank', rel: 'noopener' }, a) : null;
}

export { ic };
