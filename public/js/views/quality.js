import { h, ic, card, empty, row, badge, pageHead, btn, kv, toast, errorToast, formDialog, tabs, buildForm, openUrl, searchBox, matches } from '../ui.js';
import * as store from '../store.js';
import { may, refOptions, defectStatusBadge, pendingBadge, userLabel, user } from './common.js';
import { DEFECT_KINDS, DEFECT_STATUS, DEFAULT_INSPECTION_ITEMS } from '/shared/constants.js';
import { fmtDate, fmtDateTime, todayYmd, addDays, fmtNumber } from '/shared/dates.js';
import { takePhoto, photoGrid } from '../media.js';
import { refresh, go } from '../app.js';

const st = { tab: 'maengel', filter: 'offen', q: '' };
const PRIO = { niedrig: 'Niedrig', normal: 'Normal', hoch: 'Hoch', dringend: 'Dringend' };

export function qualityView() {
  const today = todayYmd();
  const el = h('div', null, pageHead('Qualitätsmanagement', { sub: 'Objektkontrollen, Mängel, Reklamationen und Maßnahmen', actions: [
    may('defects.report') ? btn('Mangel melden', { icon: 'alert', href: '#/maengel/neu' }) : null,
    may('quality.write') ? btn('Objektkontrolle', { icon: 'shield', cls: 'primary', href: '#/kontrolle/neu' }) : null,
  ].filter(Boolean) }));
  const defects = store.all('defects');
  const insp = store.all('inspections');
  if (may('quality.read')) {
    const open = defects.filter((d) => ['offen', 'in_bearbeitung'].includes(d.status));
    const scores = insp.filter((i) => i.score != null && i.inspected_at >= addDays(today, -90));
    el.append(h('div', { class: 'kpis', style: { marginBottom: '14px' } },
      h('div', { class: 'kpi warn' }, h('div', { class: 'label' }, 'Offene Mängel'), h('div', { class: 'value' }, open.length)),
      h('div', { class: 'kpi bad' }, h('div', { class: 'label' }, 'Überfällig'), h('div', { class: 'value' }, open.filter((d) => d.due_date && d.due_date < today).length)),
      h('div', { class: 'kpi' }, h('div', { class: 'label' }, 'Reklamationen offen'), h('div', { class: 'value' }, open.filter((d) => d.kind === 'reklamation').length)),
      h('div', { class: 'kpi ok' }, h('div', { class: 'label' }, 'Ø Bewertung 90 Tage'), h('div', { class: 'value' }, scores.length ? fmtNumber(scores.reduce((s, i) => s + i.score, 0) / scores.length, 0) + ' %' : '–'))));
  }
  const tabList = [{ key: 'maengel', label: 'Mängel & Reklamationen' }];
  if (may('quality.read')) tabList.push({ key: 'kontrollen', label: 'Objektkontrollen', count: insp.length });
  el.append(tabs(tabList, st.tab, (k) => { st.tab = k; refresh(); }));
  if (st.tab === 'kontrollen') {
    el.append(card(null, insp.length ? h('div', { class: 'list' }, insp.sort((a, b) => b.inspected_at.localeCompare(a.inspected_at)).map((i) => row({
      href: `#/kontrolle/${i.id}`, lead: h('div', { class: 'lead' }, ic('shield')), title: store.get('objects', i.object_id)?.name || 'Objekt',
      meta: [i.inspection_no, fmtDateTime(i.inspected_at), userLabel(i.inspector_id)].filter(Boolean).join(' · '),
      right: i.score != null ? badge(`${fmtNumber(i.score, 0)} %`, i.score >= 75 ? 'ok' : i.score >= 60 ? 'warn' : 'bad') : badge('ohne Bewertung'),
    }))) : empty('Noch keine Kontrollen durchgeführt.', 'shield')));
    return el;
  }
  const box = h('div');
  const draw = () => {
    const rows = defects.filter((d) => (st.filter === 'alle' || (st.filter === 'offen' ? ['offen', 'in_bearbeitung'].includes(d.status) : st.filter === 'ueberfaellig' ? ['offen', 'in_bearbeitung'].includes(d.status) && d.due_date && d.due_date < today : ['behoben', 'abgenommen', 'verworfen'].includes(d.status)))
      && (matches(d, ['title', 'defect_no', 'description'], st.q) || String(store.get('objects', d.object_id)?.name || '').toLowerCase().includes(st.q)))
      .sort((a, b) => (a.due_date || '9999').localeCompare(b.due_date || '9999') || b.reported_at.localeCompare(a.reported_at));
    box.replaceChildren(card(null, rows.length ? h('div', { class: 'list' }, rows.map((d) => row({
      href: `#/maengel/${d.id}`, lead: h('div', { class: 'lead' }, ic(d.kind === 'reklamation' ? 'mail' : d.kind === 'schaden' ? 'alert' : 'shield')),
      title: d.title, meta: [d.defect_no, DEFECT_KINDS[d.kind], store.get('objects', d.object_id)?.name, d.due_date ? 'Frist ' + fmtDate(d.due_date) : null, d.responsible_user_id ? userLabel(d.responsible_user_id) : null].filter(Boolean).join(' · '),
      right: h('div', { class: 'btn-row' }, pendingBadge(d), d.due_date && d.due_date < today && ['offen', 'in_bearbeitung'].includes(d.status) ? badge('überfällig', 'bad') : null, defectStatusBadge(d.status)),
    }))) : empty('Keine Einträge.', 'shield')));
  };
  el.append(h('div', { class: 'toolbar' }, searchBox('Suchen', (q) => { st.q = q; draw(); }, st.q),
    h('div', { class: 'chips' }, [['offen', 'Offen'], ['ueberfaellig', 'Überfällig'], ['erledigt', 'Erledigt'], ['alle', 'Alle']].map(([k, l]) => h('button', { class: 'chip' + (st.filter === k ? ' active' : ''), onclick: () => { st.filter = k; refresh(); } }, l)))));
  el.append(box);
  draw();
  return el;
}

export function defectForm({ params, query }) {
  const ex = params[0] ? store.get('defects', params[0]) : null;
  const full = may('quality.write');
  const fields = [
    { name: 'kind', label: 'Art', type: 'select', required: true, options: Object.entries(DEFECT_KINDS).map(([value, label]) => ({ value, label })), half: true },
    { name: 'priority', label: 'Priorität', type: 'select', options: Object.entries(PRIO).map(([value, label]) => ({ value, label })), default: 'normal', half: true },
    { name: 'object_id', label: 'Objekt', type: 'ref', required: true, refOptions: refOptions('objects'), readonly: !!ex },
    { name: 'title', label: 'Kurzbeschreibung', type: 'text', required: true },
    { name: 'description', label: 'Beschreibung', type: 'textarea' },
    full ? { name: 'responsible_user_id', label: 'Verantwortlicher Mitarbeiter', type: 'ref', refOptions: refOptions('users'), half: true } : null,
    full ? { name: 'due_date', label: 'Frist', type: 'date', half: true, default: ex ? undefined : addDays(todayYmd(), 7) } : null,
    full ? { name: 'measures', label: 'Maßnahmen', type: 'textarea' } : null,
    full ? { name: 'customer_visible', label: 'Im Kundenportal sichtbar', type: 'bool' } : null,
  ].filter(Boolean);
  const f = buildForm(fields, ex || { kind: 'mangel', object_id: query.object || '', priority: 'normal' });
  let photoAfter = false;
  const save = btn(ex ? 'Speichern' : 'Mangel melden', { cls: 'primary lg', icon: 'check', onclick: async () => {
    if (!f.check()) return;
    const data = f.values();
    if (ex) for (const k of Object.keys(data)) if (String(data[k] ?? '') === String(ex[k] ?? '')) delete data[k];
    save.disabled = true;
    try {
      const id = ex?.id || store.uuid();
      const r = await store.command('defect.save', { id, data, base_version: ex?.version });
      toast(r.queued ? 'Gespeichert – wird bei Verbindung übertragen.' : 'Gespeichert.');
      if (photoAfter) await takePhoto({ defect_id: id }, { category: 'mangel' });
      go(`#/maengel/${id}`);
    } catch (e) { errorToast(e); } finally { save.disabled = false; }
  } });
  return h('div', null, pageHead(ex ? 'Mangel bearbeiten' : 'Mangel / Schaden melden', { back: ex ? `#/maengel/${ex.id}` : '#/qualitaet' }),
    card(null, h('div', { class: 'card-pad' }, f.el,
      !ex && may('photos.write') ? h('label', { class: 'check', style: { marginTop: '10px' } }, h('input', { type: 'checkbox', onchange: (e) => { photoAfter = e.target.checked; } }), 'Anschließend Foto aufnehmen') : null,
      h('div', { class: 'form-actions' }, btn('Abbrechen', { href: '#/qualitaet' }), save))));
}

export function defectDetail({ params }) {
  const d = store.get('defects', params[0]);
  if (!d) return h('div', { class: 'notice bad' }, 'Eintrag nicht gefunden.');
  const log = store.all('defect_log', (l) => l.defect_id === d.id).sort((a, b) => b.logged_at.localeCompare(a.logged_at));
  const photos = store.all('photos', (p) => p.defect_id === d.id);
  const isResp = d.responsible_user_id === user().id;
  const full = may('quality.write');
  const setStatus = (status) => async () => {
    const needNote = ['behoben', 'verworfen'].includes(status);
    let note = '';
    if (needNote || status === 'abgenommen') {
      const v = await formDialog(status === 'behoben' ? 'Erledigungsnachweis' : status === 'verworfen' ? 'Begründung' : 'Abnahme', [{ name: 'note', label: status === 'behoben' ? 'Wie wurde der Mangel behoben?' : 'Notiz', type: 'textarea', required: needNote }], {});
      if (!v) return; note = v.note;
    }
    try { await store.command('defect.setStatus', { id: d.id, status, note }); toast(`Status: ${DEFECT_STATUS[status]}`); if (status === 'behoben' && may('photos.write')) takePhoto({ defect_id: d.id }, { category: 'nachher' }); } catch (e) { errorToast(e); }
  };
  const statusBtns = h('div', { class: 'btn-row stretch', style: { margin: '12px 0' } });
  if ((full || isResp) && d.status === 'offen') statusBtns.append(btn('In Bearbeitung', { icon: 'play', onclick: setStatus('in_bearbeitung') }));
  if ((full || isResp) && ['offen', 'in_bearbeitung'].includes(d.status)) statusBtns.append(btn('Als behoben melden', { icon: 'check', cls: 'primary', onclick: setStatus('behoben') }));
  if (full && d.status === 'behoben') statusBtns.append(btn('Abnehmen', { icon: 'checkCircle', cls: 'primary', onclick: setStatus('abgenommen') }), btn('Wieder öffnen', { onclick: setStatus('offen') }));
  if (full && ['offen', 'in_bearbeitung'].includes(d.status)) statusBtns.append(btn('Verwerfen', { cls: 'danger', onclick: setStatus('verworfen') }));
  return h('div', null,
    pageHead(d.title, { back: '#/qualitaet', sub: [d.defect_no || 'Nr. wird vergeben', DEFECT_KINDS[d.kind]].join(' · '), actions: full ? [btn('Bearbeiten', { icon: 'edit', href: `#/maengel/${d.id}/bearbeiten` })] : [] }),
    h('div', { class: 'btn-row' }, defectStatusBadge(d.status), d.priority && d.priority !== 'normal' ? badge(PRIO[d.priority], d.priority === 'dringend' ? 'bad' : 'warn') : null, pendingBadge(d)),
    statusBtns,
    h('div', { class: 'grid two' },
      card('Details', kv([
        ['Objekt', store.get('objects', d.object_id)?.name], ['Kunde', store.get('customers', d.customer_id)?.company_name],
        ['Gemeldet', `${fmtDateTime(d.reported_at)} · ${userLabel(d.reported_by)}`], ['Quelle', { intern: 'Intern', checkliste: 'Auftrags-Checkliste', kontrolle: 'Qualitätskontrolle', kundenportal: 'Kundenportal' }[d.source] || d.source],
        ['Verantwortlich', d.responsible_user_id ? userLabel(d.responsible_user_id) : 'nicht festgelegt'], ['Frist', fmtDate(d.due_date)],
        ['Beschreibung', d.description, true], ['Maßnahmen', d.measures, true], ['Erledigungsnachweis', d.resolution_note ? `${d.resolution_note} (${fmtDateTime(d.resolved_at)})` : null, true],
        ['Auftrag', d.order_id ? h('a', { href: `#/auftraege/${d.order_id}` }, store.get('orders', d.order_id)?.order_no || 'Auftrag öffnen') : null],
      ]), { iconName: 'info' }),
      card('Verlauf', h('div', null, log.length ? h('ul', { class: 'timeline' }, log.map((l) => h('li', null, h('div', null, logText(l)), l.note ? h('div', { class: 'small' }, l.note) : null, h('div', { class: 'tl-when' }, `${fmtDateTime(l.logged_at)} · ${userLabel(l.user_id)}`)))) : h('div', { class: 'empty small' }, 'Noch kein Verlauf.')),
        { iconName: 'history', actions: [btn('Kommentar', { cls: 'sm', icon: 'plus', onclick: async () => {
          const v = await formDialog('Kommentar', [{ name: 'note', label: 'Kommentar', type: 'textarea', required: true }], {});
          if (v) store.command('defect.comment', { id: store.uuid(), defect_id: d.id, note: v.note }).catch(errorToast);
        } })] })),
    card('Fotos (Mangel- und Erledigungsnachweis)', photoGrid(photos, { canRelease: may('photos.release'), onChange: refresh }), { iconName: 'camera', actions: may('photos.write') ? [btn('Foto', { cls: 'sm', icon: 'camera', onclick: () => takePhoto({ defect_id: d.id }, { category: 'mangel' }) })] : null }));
}

function logText(l) {
  if (l.action === 'erstellt') return 'Erfasst';
  if (l.action === 'kommentar') return 'Kommentar';
  if (l.action === 'geaendert') return 'Geändert';
  if (l.action.startsWith('status:')) return `Status: ${DEFECT_STATUS[l.action.slice(7)] || l.action.slice(7)}`;
  return l.action;
}

// ---------- Objektkontrolle ----------
export function inspectionForm({ query }) {
  const objSel = buildForm([
    { name: 'object_id', label: 'Objekt', type: 'ref', required: true, refOptions: refOptions('objects') },
    { name: 'template_id', label: 'Kontroll-Checkliste', type: 'ref', refOptions: refOptions('templates', (t) => t.purpose === 'kontrolle'), emptyLabel: '– Standardpunkte –' },
  ], { object_id: query.object || '', template_id: refOptions('templates', (t) => t.purpose === 'kontrolle')[0]?.value || '' });
  const itemsBox = h('div');
  let items = [];
  const loadItems = () => {
    const tpl = objSel.values().template_id;
    const texts = tpl ? store.all('checklist_template_items', (i) => i.template_id === tpl).sort((a, b) => a.position - b.position).map((i) => i.text) : DEFAULT_INSPECTION_ITEMS;
    items = texts.map((text) => ({ id: store.uuid(), text, rating: null, comment: '', create_defect: false }));
    drawItems();
  };
  const drawItems = () => {
    itemsBox.replaceChildren(...items.map((it) => {
      const btns = h('div', { class: 'chips', style: { marginTop: '8px' } }, [0, 1, 2, 3, 4, 5].map((n) => h('button', { class: 'chip' + (it.rating === n ? ' active' : ''), type: 'button', style: { minWidth: '44px' }, onclick: () => { it.rating = it.rating === n ? null : n; if (n <= 2 && it.rating === n) it.create_defect = true; drawItems(); } }, String(n))),
        h('button', { class: 'chip' + (it.rating === null ? ' active' : ''), type: 'button', onclick: () => { it.rating = null; drawItems(); } }, 'n. b.'));
      return h('div', { class: 'check-item' }, h('div', { class: 'ci-text' }, it.text), btns,
        h('input', { placeholder: 'Kommentar', value: it.comment, style: { marginTop: '8px' }, oninput: (e) => { it.comment = e.target.value; } }),
        h('label', { class: 'check small' }, h('input', { type: 'checkbox', checked: it.create_defect, onchange: (e) => { it.create_defect = e.target.checked; } }), 'Als Mangel zur Nachverfolgung anlegen'));
    }));
  };
  objSel.inputs.template_id.addEventListener('change', loadItems);
  loadItems();
  const extra = buildForm([
    { name: 'notes', label: 'Gesamtanmerkungen', type: 'textarea' },
    { name: 'responsible_user_id', label: 'Verantwortlich für Mängel', type: 'ref', refOptions: refOptions('users'), half: true },
    { name: 'due_date', label: 'Frist für Mängel', type: 'date', half: true, default: addDays(todayYmd(), 7) },
    { name: 'customer_visible', label: 'Bericht im Kundenportal freigeben', type: 'bool' },
  ], {});
  const save = btn('Kontrolle speichern', { cls: 'primary lg', icon: 'check', onclick: async () => {
    if (!objSel.check()) return;
    save.disabled = true;
    try {
      const id = store.uuid();
      const r = await store.command('inspection.save', { id, ...objSel.values(), ...extra.values(), items });
      toast(r.queued ? 'Kontrolle offline gespeichert.' : 'Kontrolle gespeichert.');
      go(`#/kontrolle/${id}`);
    } catch (e) { errorToast(e); } finally { save.disabled = false; }
  } });
  return h('div', null, pageHead('Objektkontrolle', { back: '#/qualitaet', sub: 'Bewertung je Prüfpunkt: 0 = mangelhaft … 5 = sehr gut' }),
    card(null, h('div', { class: 'card-pad' }, objSel.el)), card('Prüfpunkte', itemsBox, { iconName: 'list' }), card(null, h('div', { class: 'card-pad' }, extra.el)),
    h('div', { class: 'form-actions' }, btn('Abbrechen', { href: '#/qualitaet' }), save));
}

export function inspectionDetail({ params }) {
  const i = store.get('inspections', params[0]);
  if (!i) return h('div', { class: 'notice bad' }, 'Kontrolle nicht gefunden.');
  const items = store.all('inspection_items', (x) => x.inspection_id === i.id).sort((a, b) => a.position - b.position);
  const defects = store.all('defects', (d) => d.inspection_id === i.id);
  const photos = store.all('photos', (p) => p.inspection_id === i.id);
  return h('div', null,
    pageHead(`Kontrolle ${store.get('objects', i.object_id)?.name || ''}`, { back: '#/qualitaet', sub: [i.inspection_no || 'Nr. wird vergeben', fmtDateTime(i.inspected_at), userLabel(i.inspector_id)].join(' · '),
      actions: !i._pending ? [btn('PDF-Bericht', { icon: 'print', onclick: () => openUrl(`/api/reports/inspection/${i.id}`) }), may('quality.write') ? btn(i.customer_visible ? 'Kundenfreigabe entziehen' : 'Für Kunden freigeben', { icon: 'eye', onclick: () => store.command('inspection.update', { id: i.id, customer_visible: !i.customer_visible }).catch(errorToast) }) : null].filter(Boolean) : [] }),
    card(null, h('div', { class: 'clock' }, h('div', { class: 'state' }, 'Ergebnis'), h('div', { class: 'big' }, i.score != null ? `${fmtNumber(i.score, 1)} %` : '–'), h('div', { class: 'muted' }, i.rating || ''))),
    card('Prüfpunkte', h('div', { class: 'list' }, items.map((x) => h('div', { class: 'stat-line' }, h('span', null, x.text, x.comment ? h('div', { class: 'small muted' }, x.comment) : null), h('strong', null, x.rating == null ? 'n. b.' : `${x.rating}/5`)))), { iconName: 'list' }),
    i.notes ? card('Anmerkungen', h('div', { class: 'card-pad', style: { whiteSpace: 'pre-line' } }, i.notes)) : null,
    card('Daraus entstandene Mängel', defects.length ? h('div', { class: 'list' }, defects.map((d) => row({ href: `#/maengel/${d.id}`, title: d.title, right: defectStatusBadge(d.status) }))) : empty('Keine Mängel angelegt.'), { iconName: 'alert' }),
    card('Fotos', photoGrid(photos, { onChange: refresh }), { iconName: 'camera', actions: may('photos.write') && !i._pending ? [btn('Foto', { cls: 'sm', icon: 'camera', onclick: () => takePhoto({ inspection_id: i.id, object_id: i.object_id }) })] : null }));
}
