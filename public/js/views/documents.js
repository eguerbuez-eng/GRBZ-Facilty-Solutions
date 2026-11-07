import { h, ic, card, empty, row, badge, pageHead, btn, toast, errorToast, modal, buildForm, confirmDialog, searchBox, matches, formDialog } from '../ui.js';
import * as store from '../store.js';
import { api } from '../api.js';
import { may, refOptions, userLabel } from './common.js';
import { fmtDate } from '/shared/dates.js';

export const DOC_KINDS = {
  vertrag: 'Vertrag', angebot: 'Angebot', auftragsbestaetigung: 'Auftragsbestätigung', checkliste: 'Checkliste', leistungsnachweis: 'Leistungsnachweis',
  rechnung: 'Rechnung', wartungsprotokoll: 'Wartungsprotokoll', schadensbericht: 'Schadensbericht', korrespondenz: 'Kundenkorrespondenz',
  monatsbericht: 'Monatsbericht', kontrollbericht: 'Kontrollbericht', qualitaetsbericht: 'Qualitätsbericht', fotodokumentation: 'Fotodokumentation',
  winterdienstprotokoll: 'Winterdienstprotokoll', arbeitszeitnachweis: 'Arbeitszeitnachweis', bericht: 'Bericht', sonstiges: 'Sonstiges',
};
const kindOpts = Object.entries(DOC_KINDS).map(([value, label]) => ({ value, label }));
const size = (b) => (b > 1048576 ? `${(b / 1048576).toFixed(1).replace('.', ',')} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

export async function uploadDialog(link = {}) {
  if (!navigator.onLine) return toast('Das Hochladen von Dokumenten erfordert eine Internetverbindung.', 'warn');
  const file = h('input', { type: 'file', accept: '.pdf,.jpg,.jpeg,.png,.webp,.doc,.docx,.xls,.xlsx,.txt,.csv' });
  const f = buildForm([
    { name: 'title', label: 'Titel', type: 'text', required: true },
    { name: 'kind', label: 'Dokumentart', type: 'select', required: true, options: kindOpts, default: 'vertrag' },
    { name: 'customer_id', label: 'Kunde', type: 'ref', refOptions: refOptions('customers'), readonly: !!link.customer_id },
    { name: 'object_id', label: 'Objekt', type: 'ref', refOptions: refOptions('objects'), readonly: !!link.object_id },
    { name: 'notes', label: 'Notiz', type: 'textarea', rows: 2 },
    { name: 'customer_visible', label: 'Im Kundenportal sichtbar', type: 'bool' },
  ], link);
  file.addEventListener('change', () => { if (file.files[0] && !f.inputs.title.value) f.inputs.title.value = file.files[0].name.replace(/\.[^.]+$/, ''); });
  await modal({
    title: 'Dokument hochladen', body: h('div', null, h('div', { class: 'field', style: { marginBottom: '14px' } }, h('label', null, 'Datei (max. 25 MB)'), file), f.el),
    actions: [{ label: 'Abbrechen', value: null }, { label: 'Hochladen', class: 'primary', icon: 'upload', onClick: async () => {
      if (!file.files[0]) { toast('Bitte eine Datei auswählen.', 'bad'); return false; }
      if (!f.check()) return false;
      const v = f.values();
      const fd = new FormData();
      fd.append('id', store.uuid());
      for (const [k, val] of Object.entries({ ...v, ...link })) if (val !== null && val !== undefined && val !== '') fd.append(k, String(val));
      fd.append('file', file.files[0]);
      await api('POST', '/api/documents', fd, { timeout: 180000 });
      await store.pull().catch(() => {});
      toast('Dokument hochgeladen.');
      return true;
    } }],
  });
}

function docRow(d) {
  return h('div', { class: 'row', onclick: () => window.open(`/api/documents/${d.id}/file`, '_blank', 'noopener') },
    h('div', { class: 'lead' }, ic('file')),
    h('div', { class: 'grow' }, h('div', { class: 'title' }, d.title),
      h('div', { class: 'meta' }, [DOC_KINDS[d.kind] || d.kind, fmtDate(d.created_at), d.size ? size(d.size) : null, store.get('objects', d.object_id)?.name || store.get('customers', d.customer_id)?.company_name, userLabel(d.uploaded_by)].filter(Boolean).join(' · '))),
    d.customer_visible ? badge('Kunde', 'accent') : null,
    may('documents.write') ? h('button', { class: 'btn ghost icon-btn', 'aria-label': 'Bearbeiten', onclick: (e) => { e.stopPropagation(); editDoc(d); } }, ic('edit')) : null);
}

async function editDoc(d) {
  const v = await formDialog('Dokument bearbeiten', [
    { name: 'title', label: 'Titel', type: 'text', required: true },
    { name: 'kind', label: 'Dokumentart', type: 'select', required: true, options: kindOpts },
    { name: 'customer_id', label: 'Kunde', type: 'ref', refOptions: refOptions('customers') },
    { name: 'object_id', label: 'Objekt', type: 'ref', refOptions: refOptions('objects') },
    { name: 'customer_visible', label: 'Im Kundenportal sichtbar', type: 'bool' },
    { name: 'delete', label: 'Dokument löschen', type: 'bool' },
  ], d);
  if (!v) return;
  try {
    if (v.delete) {
      if (await confirmDialog(`Dokument „${d.title}“ endgültig löschen?`, { danger: true, ok: 'Löschen' })) await store.command('document.delete', { id: d.id });
    } else {
      delete v.delete;
      await store.command('document.update', { id: d.id, data: v });
    }
    toast('Gespeichert.');
  } catch (e) { errorToast(e); }
}

export function documentsCard(link) {
  const docs = store.all('documents', (d) => (!link.object_id || d.object_id === link.object_id) && (link.object_id || !link.customer_id || d.customer_id === link.customer_id) && (!link.machine_id || d.machine_id === link.machine_id))
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
  return card('Dokumente', docs.length ? h('div', { class: 'list' }, docs.map(docRow)) : empty('Keine Dokumente.', 'file'),
    { iconName: 'file', actions: may('documents.write') ? [btn('Hochladen', { cls: 'sm', icon: 'upload', onclick: () => uploadDialog(link) })] : null });
}

const st = { q: '', kind: '' };
export function documentsView() {
  const el = h('div', null, pageHead('Dokumente', { sub: 'Verträge, Angebote, Nachweise, Protokolle und Korrespondenz', actions: may('documents.write') ? [btn('Hochladen', { icon: 'upload', cls: 'primary', onclick: () => uploadDialog({}) })] : [] }));
  const box = h('div');
  const draw = () => {
    const rows = store.all('documents', (d) => (!st.kind || d.kind === st.kind) && (matches(d, ['title', 'original_name', 'notes'], st.q)
      || String(store.get('customers', d.customer_id)?.company_name || '').toLowerCase().includes(st.q) || String(store.get('objects', d.object_id)?.name || '').toLowerCase().includes(st.q)))
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
    box.replaceChildren(card(null, rows.length ? h('div', { class: 'list' }, rows.map(docRow)) : empty('Keine Dokumente gefunden.', 'file')));
  };
  el.append(h('div', { class: 'toolbar' }, searchBox('Suchen (Titel, Kunde, Objekt)', (q) => { st.q = q; draw(); }, st.q),
    h('select', { style: { width: 'auto' }, onchange: (e) => { st.kind = e.target.value; draw(); } }, h('option', { value: '' }, 'Alle Arten'), kindOpts.map((o) => h('option', { value: o.value, selected: st.kind === o.value }, o.label)))));
  el.append(box, h('p', { class: 'tiny muted', style: { marginTop: '10px' } }, 'Dokumente werden auf dem Server gespeichert und sind offline nur als Liste sichtbar. Berichte können unter „Berichte“ direkt als Dokument abgelegt werden.'));
  draw();
  return el;
}
