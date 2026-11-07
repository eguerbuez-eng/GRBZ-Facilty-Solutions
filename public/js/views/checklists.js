import { h, ic, card, empty, row, badge, pageHead, btn, toast, errorToast, buildForm } from '../ui.js';
import * as store from '../store.js';
import { refOptions } from './common.js';
import { go } from '../app.js';

export function checklistsList() {
  const rows = store.all('checklist_templates').sort((a, b) => a.purpose.localeCompare(b.purpose) || a.name.localeCompare(b.name));
  return h('div', null,
    pageHead('Checklisten', { sub: 'Vorlagen je Dienstleistung und für Qualitätskontrollen', actions: [btn('Neue Checkliste', { icon: 'plus', cls: 'primary', href: '#/checklisten/neu' })] }),
    card(null, rows.length ? h('div', { class: 'list' }, rows.map((t) => row({
      href: `#/checklisten/${t.id}`, lead: h('div', { class: 'lead' }, ic(t.purpose === 'kontrolle' ? 'shield' : 'checkCircle')), title: t.name,
      meta: [t.purpose === 'kontrolle' ? 'Qualitätskontrolle' : 'Auftrags-Checkliste', store.get('services', t.service_id)?.name, `${store.all('checklist_template_items', (i) => i.template_id === t.id).length} Punkte`].filter(Boolean).join(' · '),
      right: t.active ? null : badge('inaktiv'),
    }))) : empty('Keine Checklisten.')));
}

export function checklistEditor({ params }) {
  const ex = params[0] ? store.get('checklist_templates', params[0]) : null;
  const items = ex ? store.all('checklist_template_items', (i) => i.template_id === ex.id).sort((a, b) => a.position - b.position).map((i) => ({ ...i })) : [{ id: store.uuid(), text: '', required: 1, photo_required: 0 }];
  const head = buildForm([
    { name: 'name', label: 'Bezeichnung', type: 'text', required: true },
    { name: 'service_id', label: 'Dienstleistung', type: 'ref', refOptions: refOptions('services'), half: true, help: 'Neue Aufträge dieser Dienstleistung verwenden diese Checkliste.' },
    { name: 'purpose', label: 'Verwendung', type: 'select', required: true, half: true, options: [{ value: 'reinigung', label: 'Auftrags-Checkliste' }, { value: 'kontrolle', label: 'Qualitätskontrolle' }] },
    { name: 'active', label: 'Aktiv', type: 'bool', default: 1 },
  ], ex || { purpose: 'reinigung' });
  const listEl = h('div');
  const draw = () => {
    listEl.replaceChildren(...items.map((it, idx) => {
      const text = h('input', { value: it.text, placeholder: `Punkt ${idx + 1}`, oninput: (e) => { it.text = e.target.value; } });
      return h('div', { class: 'check-item' },
        h('div', { class: 'ci-head', style: { alignItems: 'center' } }, h('div', { class: 'ci-no' }, idx + 1), h('div', { style: { flex: 1 } }, text)),
        h('div', { class: 'ci-extra' },
          h('label', { class: 'check small' }, h('input', { type: 'checkbox', checked: !!it.required, onchange: (e) => { it.required = e.target.checked ? 1 : 0; } }), 'Pflicht'),
          h('label', { class: 'check small' }, h('input', { type: 'checkbox', checked: !!it.photo_required, onchange: (e) => { it.photo_required = e.target.checked ? 1 : 0; } }), 'Foto erforderlich'),
          h('span', { style: { flex: 1 } }),
          h('button', { class: 'btn sm ghost icon-btn', 'aria-label': 'Nach oben', disabled: idx === 0, onclick: () => { [items[idx - 1], items[idx]] = [items[idx], items[idx - 1]]; draw(); } }, ic('back', '')),
          h('button', { class: 'btn sm ghost icon-btn', 'aria-label': 'Entfernen', onclick: () => { items.splice(idx, 1); draw(); } }, ic('trash'))));
    }));
  };
  draw();
  const save = btn('Speichern', { cls: 'primary lg', icon: 'check', onclick: async () => {
    if (!head.check()) return;
    const clean = items.filter((i) => i.text.trim());
    if (!clean.length) return toast('Bitte mindestens einen Punkt erfassen.', 'bad');
    save.disabled = true;
    try {
      const id = ex?.id || store.uuid();
      await store.command('entity.save', { entity: 'checklist_templates', id, data: head.values(), base_version: ex?.version });
      const r = await store.command('template.saveItems', { template_id: id, items: clean });
      toast(r.queued ? 'Gespeichert – wird bei Verbindung übertragen.' : 'Checkliste gespeichert.');
      go('#/checklisten');
    } catch (e) { errorToast(e); } finally { save.disabled = false; }
  } });
  return h('div', null,
    pageHead(ex ? 'Checkliste bearbeiten' : 'Neue Checkliste', { back: '#/checklisten', sub: 'Änderungen gelten für neu erstellte Aufträge. Bestehende Aufträge behalten ihre Checkliste.' }),
    card(null, h('div', { class: 'card-pad' }, head.el)),
    card('Prüfpunkte', h('div', null, listEl, h('div', { class: 'card-pad' }, btn('Punkt hinzufügen', { icon: 'plus', onclick: () => { items.push({ id: store.uuid(), text: '', required: 1, photo_required: 0 }); draw(); listEl.querySelector('.check-item:last-child input')?.focus(); } }))), { iconName: 'list' }),
    h('div', { class: 'form-actions' }, btn('Abbrechen', { href: '#/checklisten' }), save));
}
