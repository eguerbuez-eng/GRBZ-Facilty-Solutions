import { h, ic, card, empty, row, badge, pageHead, btn, kv, searchBox, matches, toast, errorToast, modal, formDialog, confirmDialog, tabs, buildForm, openUrl } from '../ui.js';
import * as store from '../store.js';
import { may, refOptions, orderStatusBadge, pendingBadge, userLabel, phoneLink, mapLink, user } from './common.js';
import { CHECK_RESULTS, FREQUENCIES, WEEKDAYS } from '/shared/constants.js';
import { checklistProblems } from '/shared/rules.js';
import { fmtDate, fmtDateTime, todayYmd, addDays, fmtMinutes, fmtNumber } from '/shared/dates.js';
import { takePhoto, photoGrid } from '../media.js';
import { refresh, go } from '../app.js';
import { api } from '../api.js';

const st = { tab: 'heute', q: '', emp: '' };

function visibleOrders() {
  const u = user();
  return store.all('orders', (o) => may('orders.write') || o.assigned_user_id === u.id);
}

export function ordersList({ query }) {
  if (query.tab) st.tab = query.tab;
  const today = todayYmd();
  const all = visibleOrders();
  const groups = {
    heute: all.filter((o) => o.scheduled_date === today),
    kommend: all.filter((o) => o.scheduled_date > today && !o.completed_at),
    offen: all.filter((o) => !o.completed_at),
    ueberfaellig: all.filter((o) => o.scheduled_date < today && !o.completed_at),
    erledigt: all.filter((o) => o.completed_at),
  };
  const el = h('div');
  el.append(pageHead('Aufträge', {
    sub: 'Reinigungs- und Serviceaufträge',
    actions: may('orders.write') ? [btn('Serienaufträge', { icon: 'repeat', href: '#/serien' }), btn('Auftrag anlegen', { icon: 'plus', cls: 'primary', href: '#/auftraege/neu' })] : [],
  }));
  el.append(tabs([
    { key: 'heute', label: 'Heute', count: groups.heute.length }, { key: 'kommend', label: 'Geplant', count: groups.kommend.length },
    { key: 'ueberfaellig', label: 'Überfällig', count: groups.ueberfaellig.length }, { key: 'offen', label: 'Alle offenen', count: groups.offen.length },
    { key: 'erledigt', label: 'Erledigt', count: groups.erledigt.length },
  ], st.tab, (k) => { st.tab = k; history.replaceState(null, '', '#/auftraege'); refresh(); }));
  const box = h('div');
  const draw = () => {
    let rows = (groups[st.tab] || []).filter((o) => (!st.emp || o.assigned_user_id === st.emp) && (!st.q || matches(o, ['order_no', 'notes'], st.q)
      || String(store.get('objects', o.object_id)?.name || '').toLowerCase().includes(st.q) || String(store.get('customers', o.customer_id)?.company_name || '').toLowerCase().includes(st.q)));
    rows.sort((a, b) => (a.scheduled_date + (a.scheduled_time || '')).localeCompare(b.scheduled_date + (b.scheduled_time || '')));
    if (st.tab === 'erledigt') rows.reverse();
    rows = rows.slice(0, 300);
    if (!rows.length) { box.replaceChildren(card(null, empty(st.tab === 'heute' ? 'Für heute sind keine Aufträge geplant.' : 'Keine Aufträge.', 'list'))); return; }
    const frag = h('div');
    let lastDate = null; let list;
    for (const o of rows) {
      if (o.scheduled_date !== lastDate && st.tab !== 'heute') {
        lastDate = o.scheduled_date;
        list = h('div', { class: 'list' });
        frag.append(card(new Intl.DateTimeFormat('de-DE', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' }).format(new Date(o.scheduled_date + 'T12:00:00Z')), list));
      } else if (!list) { list = h('div', { class: 'list' }); frag.append(card(null, list)); }
      list.append(orderRow(o));
    }
    box.replaceChildren(frag);
  };
  el.append(h('div', { class: 'toolbar' }, searchBox('Suchen (Objekt, Kunde, Auftragsnr.)', (q) => { st.q = q; draw(); }, st.q),
    may('orders.write') ? h('select', { style: { width: 'auto' }, onchange: (e) => { st.emp = e.target.value; draw(); } }, h('option', { value: '' }, 'Alle Mitarbeiter'),
      refOptions('users').map((o) => h('option', { value: o.value, selected: st.emp === o.value }, o.label))) : null));
  el.append(box);
  draw();
  return el;
}

function orderRow(o) {
  const items = store.all('order_checklist_items', (i) => i.order_id === o.id);
  const done = items.filter((i) => i.result !== 'offen').length;
  return row({
    href: `#/auftraege/${o.id}`, lead: h('div', { class: 'lead time' }, o.scheduled_time || '–'),
    title: store.get('objects', o.object_id)?.name || 'Objekt',
    meta: [store.get('services', o.service_id)?.name, userLabel(o.assigned_user_id), items.length ? `${done}/${items.length} Punkte` : null, o.order_no].filter(Boolean).join(' · '),
    right: h('div', { class: 'btn-row' }, pendingBadge(o), orderStatusBadge(o.status)),
  });
}

// ---------- Auftrag anlegen / bearbeiten ----------
export function orderForm({ params, query }) {
  const ex = params[0] ? store.get('orders', params[0]) : null;
  if (params[0] && !ex) return h('div', { class: 'notice bad' }, 'Auftrag nicht gefunden.');
  const fields = [
    { name: 'object_id', label: 'Objekt', type: 'ref', required: true, refOptions: refOptions('objects'), readonly: ex && ex.status !== 'geplant' },
    { name: 'service_id', label: 'Dienstleistung', type: 'ref', refOptions: refOptions('services') },
    { name: 'template_id', label: 'Checkliste', type: 'ref', refOptions: refOptions('templates', (t) => t.purpose === 'reinigung'), emptyLabel: '– Standard der Dienstleistung –', help: 'Ohne Auswahl wird die Checkliste der Dienstleistung verwendet.' },
    { name: 'scheduled_date', label: 'Datum', type: 'date', required: true, default: 'today', half: true },
    { name: 'scheduled_time', label: 'Uhrzeit', type: 'time', half: true },
    { name: 'planned_minutes', label: 'Geplante Dauer (Minuten)', type: 'number', half: true },
    { name: 'assigned_user_id', label: 'Mitarbeiter', type: 'ref', refOptions: refOptions('users'), half: true },
    { name: 'notes', label: 'Bemerkungen / Hinweise für den Mitarbeiter', type: 'textarea' },
  ];
  const vals = ex ? { ...ex } : { object_id: query.object || '', scheduled_date: query.date || todayYmd() };
  const f = buildForm(fields, vals);
  const save = btn(ex ? 'Speichern' : 'Auftrag anlegen', { cls: 'primary lg', icon: 'check', onclick: async () => {
    if (!f.check()) return;
    const data = f.values();
    if (ex) for (const k of Object.keys(data)) if (String(data[k] ?? '') === String(ex[k] ?? '')) delete data[k];
    save.disabled = true;
    try {
      const id = ex?.id || store.uuid();
      const r = await store.command('order.save', { id, data, base_version: ex?.version });
      toast(r.queued ? 'Auftrag gespeichert – wird bei Verbindung übertragen.' : 'Auftrag gespeichert.');
      go(`#/auftraege/${id}`);
    } catch (e) { errorToast(e); } finally { save.disabled = false; }
  } });
  return h('div', null, pageHead(ex ? 'Auftrag bearbeiten' : 'Auftrag anlegen', { back: ex ? `#/auftraege/${ex.id}` : '#/auftraege', sub: ex?.order_no }),
    card(null, h('div', { class: 'card-pad' }, f.el, h('div', { class: 'form-actions' }, btn('Abbrechen', { href: ex ? `#/auftraege/${ex.id}` : '#/auftraege' }), save))));
}

// ---------- Auftrag ausführen ----------
const ICONS = { erledigt: 'check', nicht_erledigt: 'x', nicht_zutreffend: 'minus', mangel: 'alert' };
const SHORT = { erledigt: 'Erledigt', nicht_erledigt: 'Nicht erledigt', nicht_zutreffend: 'Entfällt', mangel: 'Mangel' };

export function orderDetail({ params }) {
  const o = store.get('orders', params[0]);
  if (!o) return h('div', { class: 'notice bad' }, 'Auftrag nicht gefunden, nicht synchronisiert oder nicht zugeordnet.');
  const obj = store.get('objects', o.object_id);
  const svc = store.get('services', o.service_id);
  const items = store.all('order_checklist_items', (i) => i.order_id === o.id).sort((a, b) => a.position - b.position);
  const photos = store.all('photos', (p) => p.order_id === o.id);
  const done = items.filter((i) => i.result !== 'offen').length;
  const canExec = may('orders.write') || (may('orders.execute') && o.assigned_user_id === user().id);
  const locked = !!o.completed_at;
  const el = h('div');
  const actions = [];
  if (may('orders.write')) {
    if (!locked) actions.push(btn('Bearbeiten', { icon: 'edit', href: `#/auftraege/${o.id}/bearbeiten` }));
    if (o.status === 'geplant' && !o.started_at) actions.push(btn('Löschen', { icon: 'trash', cls: 'danger', onclick: async () => {
      if (!(await confirmDialog('Auftrag wirklich löschen?', { danger: true, ok: 'Löschen' }))) return;
      try { await store.command('order.delete', { id: o.id }); toast('Auftrag gelöscht.'); go('#/auftraege'); } catch (e) { errorToast(e); }
    } }));
  }
  if (may('reports.create') && !o._pending) actions.push(btn('Leistungsnachweis', { icon: 'print', onclick: () => openUrl(`/api/reports/order/${o.id}`) }));
  el.append(pageHead(obj?.name || 'Auftrag', { back: '#/auftraege', sub: [svc?.name, `${fmtDate(o.scheduled_date)}${o.scheduled_time ? ', ' + o.scheduled_time + ' Uhr' : ''}`, o.order_no || 'Nr. wird bei Sync vergeben'].filter(Boolean).join(' · '), actions }));
  el.append(h('div', { class: 'btn-row', style: { marginBottom: '12px', alignItems: 'center' } }, orderStatusBadge(o.status), pendingBadge(o),
    o.assigned_user_id ? badge(userLabel(o.assigned_user_id), 'outline') : badge('nicht zugeordnet', 'warn'), o.planned_minutes ? badge(`geplant ${fmtMinutes(o.planned_minutes)}`, 'outline') : null));

  if (o.notes) el.append(h('div', { class: 'notice' }, ic('info'), h('div', { style: { whiteSpace: 'pre-line' } }, o.notes)));
  if (obj?.access_notes) el.append(h('div', { class: 'notice warn' }, ic('key'), h('div', null, h('strong', null, 'Zugang: '), h('span', { style: { whiteSpace: 'pre-line' } }, obj.access_notes))));

  // Statusaktionen
  if (canExec && !locked) {
    const bar = h('div', { class: 'btn-row stretch', style: { margin: '12px 0' } });
    if (o.status === 'geplant' || o.status === 'unterbrochen') bar.append(btn(o.status === 'geplant' ? 'Auftrag starten' : 'Fortsetzen', { icon: 'play', cls: 'primary lg', onclick: () => startOrder(o) }));
    if (o.status === 'in_bearbeitung' || o.status === 'mangel') bar.append(btn('Unterbrechen', { icon: 'pause', cls: 'lg', onclick: () => interrupt(o) }));
    if (o.status !== 'geplant' || items.length === 0) bar.append(btn('Abschließen', { icon: 'checkCircle', cls: 'dark lg', onclick: () => complete(o, items) }));
    el.append(bar);
  }
  if (locked) el.append(h('div', { class: o.status === 'mangel' ? 'notice warn' : 'notice ok' }, ic('checkCircle'), h('div', null,
    h('strong', null, `Abgeschlossen am ${fmtDateTime(o.completed_at)}${o.completed_by ? ' von ' + userLabel(o.completed_by) : ''}`),
    o.final_report ? h('div', { style: { whiteSpace: 'pre-line', marginTop: '4px' } }, o.final_report) : null)));

  // Checkliste
  const progress = h('div', { class: 'card-pad', style: { paddingBottom: '4px' } },
    h('div', { class: 'progress', role: 'progressbar', 'aria-valuenow': done, 'aria-valuemax': items.length }, h('div', { style: { width: items.length ? `${(done / items.length) * 100}%` : '0%' } })),
    h('div', { class: 'small muted', style: { marginTop: '6px' } }, `${done} von ${items.length} Punkten bearbeitet`));
  const list = h('div');
  for (const it of items) list.append(checkItem(o, it, { canExec: canExec && !locked, photos }));
  el.append(card('Checkliste', items.length ? h('div', null, progress, list) : empty('Für diesen Auftrag ist keine Checkliste hinterlegt.'), {
    iconName: 'checkCircle',
    actions: canExec && !locked ? [btn('Punkt', { cls: 'sm', icon: 'plus', onclick: () => addItem(o) })] : null,
  }));

  // Fotos
  el.append(card('Fotos', photoGrid(photos, { canRelease: may('photos.release'), onChange: refresh }), {
    iconName: 'camera',
    actions: canExec && may('photos.write') ? [btn('Vorher', { cls: 'sm', icon: 'camera', onclick: () => takePhoto({ order_id: o.id }, { category: 'vorher' }) }), btn('Nachher', { cls: 'sm', icon: 'camera', onclick: () => takePhoto({ order_id: o.id }, { category: 'nachher' }) })] : null,
  }));

  // Material & Zeiten
  const moves = store.all('stock_movements', (m) => m.order_id === o.id);
  el.append(h('div', { class: 'grid two' },
    may('materials.consume') ? card('Materialverbrauch', h('div', null,
      moves.length ? h('div', { class: 'list' }, moves.map((m) => { const mat = store.get('materials', m.material_id); return h('div', { class: 'stat-line' }, h('span', null, mat?.name || 'Artikel'), h('strong', null, `${fmtNumber(-m.qty)} ${mat?.unit || ''}`)); })) : h('div', { class: 'empty small' }, 'Kein Verbrauch erfasst.')),
    { iconName: 'box', actions: canExec ? [btn('Verbrauch buchen', { cls: 'sm', icon: 'plus', onclick: () => consume(o) })] : null }) : null,
    card('Auftragsdaten', kv([
      ['Kunde', store.get('customers', o.customer_id)?.company_name], ['Adresse', obj ? mapLink(obj.street, obj.zip, obj.city) : null],
      ['Ansprechpartner vor Ort', obj?.contact_person], ['Telefon vor Ort', phoneLink(obj?.contact_phone)],
      ['Begonnen', fmtDateTime(o.started_at)], ['Erfasste Arbeitszeit', fmtMinutes(store.all('time_entries', (e) => e.order_id === o.id && e.kind === 'arbeit' && e.end_at && !e.voided).reduce((s, e) => s + (Date.parse(e.end_at) - Date.parse(e.start_at)) / 6e4, 0))],
    ]), { iconName: 'info', actions: [h('a', { class: 'btn sm ghost', href: `#/objekte/${o.object_id}` }, 'Objektakte')] })));
  return el;
}

function checkItem(o, it, { canExec, photos }) {
  const itemPhotos = photos.filter((p) => p.checklist_item_id === it.id);
  const set = async (result) => {
    let comment = it.comment;
    if (result === 'nicht_erledigt' || result === 'mangel') {
      const v = await formDialog(result === 'mangel' ? 'Mangel beschreiben' : 'Warum nicht erledigt?', [{ name: 'comment', label: 'Kommentar', type: 'textarea', required: true }], { comment: comment || '' }, { submit: 'Übernehmen' });
      if (!v) return;
      comment = v.comment;
    }
    try { await store.command('order.checkItem', { item_id: it.id, result, comment }); if (result === 'mangel') toast('Mangel erfasst – er wird im Qualitätsmanagement nachverfolgt.', 'warn'); } catch (e) { errorToast(e); }
  };
  return h('div', { class: `check-item r-${it.result}` },
    h('div', { class: 'ci-head' }, h('div', { class: 'ci-no' }, it.result === 'offen' ? it.position + 1 : ic(ICONS[it.result])),
      h('div', { class: 'ci-text' }, it.text, !it.required ? h('span', { class: 'muted small' }, ' (optional)') : null, it.photo_required ? h('span', { class: 'badge info', style: { marginLeft: '6px' } }, ic('camera'), 'Foto') : null)),
    canExec ? h('div', { class: 'ci-actions' }, ['erledigt', 'nicht_erledigt', 'nicht_zutreffend', 'mangel'].map((r) => h('button', {
      type: 'button', class: `${r}${it.result === r ? ' on' : ''}`, 'aria-pressed': it.result === r ? 'true' : 'false', onclick: () => set(it.result === r ? 'offen' : r),
    }, ic(ICONS[r]), SHORT[r]))) : h('div', { class: 'small muted', style: { marginTop: '6px', marginLeft: '38px' } }, CHECK_RESULTS[it.result]),
    it.comment ? h('div', { class: 'ci-comment' }, it.comment) : null,
    canExec ? h('div', { class: 'ci-extra' },
      h('button', { class: 'btn sm ghost', type: 'button', onclick: async () => {
        const v = await formDialog('Kommentar', [{ name: 'comment', label: 'Kommentar', type: 'textarea' }], { comment: it.comment || '' });
        if (v) store.command('order.checkItem', { item_id: it.id, result: it.result, comment: v.comment }).catch(errorToast);
      } }, ic('edit'), 'Kommentar'),
      may('photos.write') ? h('button', { class: 'btn sm ghost', type: 'button', onclick: () => takePhoto({ order_id: o.id, checklist_item_id: it.id }, { category: it.result === 'mangel' ? 'mangel' : 'nachher' }) }, ic('camera'), `Foto${itemPhotos.length ? ' (' + itemPhotos.length + ')' : ''}`) : null) : null);
}

async function startOrder(o) {
  const u = user();
  const running = store.all('time_entries', (e) => e.user_id === u.id && e.kind === 'arbeit' && !e.end_at && !e.voided)[0];
  let stamp = false;
  if (may('time.own') && o.assigned_user_id === u.id && running?.order_id !== o.id) {
    const r = await modal({ title: 'Auftrag starten', body: h('p', null, running ? 'Sie sind bereits eingestempelt. Soll die Arbeitszeit ab jetzt diesem Auftrag zugeordnet werden?' : 'Arbeitszeit für diesen Auftrag jetzt starten?'),
      actions: [{ label: 'Nur Auftrag starten', value: 'nein' }, { label: 'Starten + Zeit erfassen', value: 'ja', class: 'primary' }] });
    if (!r) return;
    stamp = r === 'ja';
  }
  try {
    await store.command('order.setStatus', { id: o.id, status: 'in_bearbeitung', at: new Date().toISOString() });
    if (stamp) {
      if (running) await store.command('time.clock', { action: 'stop' });
      await store.command('time.clock', { id: store.uuid(), action: 'start', object_id: o.object_id, order_id: o.id });
    }
    toast('Auftrag gestartet.');
  } catch (e) { errorToast(e); }
}

async function interrupt(o) {
  const v = await formDialog('Auftrag unterbrechen', [{ name: 'note', label: 'Grund der Unterbrechung', type: 'textarea', required: true }], {});
  if (!v) return;
  try { await store.command('order.setStatus', { id: o.id, status: 'unterbrochen', note: v.note }); toast('Auftrag unterbrochen.', 'warn'); } catch (e) { errorToast(e); }
}

async function complete(o, items) {
  const problems = checklistProblems(items, (id) => store.all('photos', (p) => p.checklist_item_id === id).length > 0);
  if (problems.length) {
    await modal({ title: 'Checkliste unvollständig', body: h('div', null, h('p', null, 'Bitte vervollständigen Sie zuerst folgende Angaben:'), h('ul', null, problems.map((p) => h('li', null, p)))), actions: [{ label: 'OK', value: true, class: 'primary' }] });
    return;
  }
  const u = user();
  const running = store.all('time_entries', (e) => e.user_id === u.id && e.kind === 'arbeit' && !e.end_at && !e.voided && e.order_id === o.id)[0];
  const fields = [{ name: 'final_report', label: 'Abschlussbericht', type: 'textarea', rows: 4, placeholder: 'optional – sonst wird eine Zusammenfassung erzeugt' }];
  if (running) fields.push({ name: 'stop', label: 'Arbeitszeit für diesen Auftrag beenden', type: 'bool', default: 1 });
  const v = await formDialog('Auftrag abschließen', fields, {}, { submit: 'Abschließen' });
  if (!v) return;
  try {
    await store.command('order.complete', { id: o.id, final_report: v.final_report, at: new Date().toISOString() });
    if (running && v.stop) await store.command('time.clock', { action: 'stop' });
    toast('Auftrag abgeschlossen.');
  } catch (e) { errorToast(e); }
}

async function addItem(o) {
  const v = await formDialog('Checklistenpunkt hinzufügen', [{ name: 'text', label: 'Leistung', type: 'text', required: true }, { name: 'required', label: 'Pflichtpunkt', type: 'bool', default: 0 }], {});
  if (!v) return;
  store.command('order.addItem', { id: store.uuid(), order_id: o.id, text: v.text, required: v.required }).catch(errorToast);
}

async function consume(o) {
  const v = await formDialog('Materialverbrauch buchen', [
    { name: 'material_id', label: 'Artikel', type: 'ref', required: true, refOptions: refOptions('materials') },
    { name: 'qty', label: 'Menge', type: 'number', required: true },
  ], {});
  if (!v) return;
  try { await store.command('stock.move', { id: store.uuid(), material_id: v.material_id, qty: v.qty, kind: 'verbrauch', order_id: o.id, object_id: o.object_id }); toast('Verbrauch gebucht.'); } catch (e) { errorToast(e); }
}

// ---------- Serienaufträge ----------
export function recurrenceList() {
  const rows = store.all('recurrences').sort((a, b) => (store.get('objects', a.object_id)?.name || '').localeCompare(store.get('objects', b.object_id)?.name || ''));
  return h('div', null, pageHead('Serienaufträge', { back: '#/auftraege', sub: 'Wiederkehrende Aufträge werden automatisch für die nächsten Wochen erzeugt.', actions: [btn('Serie anlegen', { icon: 'plus', cls: 'primary', href: '#/serien/neu' })] }),
    card(null, rows.length ? h('div', { class: 'list' }, rows.map((r) => row({
      href: `#/serien/${r.id}`, lead: h('div', { class: 'lead' }, ic('repeat')), title: store.get('objects', r.object_id)?.name || 'Objekt',
      meta: [store.get('services', r.service_id)?.name, freqText(r), r.start_time, userLabel(r.assigned_user_id)].filter(Boolean).join(' · '),
      right: r.active ? badge('aktiv', 'ok') : badge('pausiert'),
    }))) : empty('Noch keine Serienaufträge.', 'repeat')));
}

export function freqText(r) {
  const days = String(r.weekdays || '').split(',').filter(Boolean).map((d) => WEEKDAYS[d]).join(', ');
  if (r.frequency === 'individuell' && r.interval_days) return `alle ${r.interval_days} Tage`;
  return `${FREQUENCIES[r.frequency] || r.frequency}${days ? ' (' + days + ')' : ''}`;
}

export function recurrenceForm({ params, query }) {
  const ex = params[0] ? store.get('recurrences', params[0]) : null;
  const fields = [
    { name: 'object_id', label: 'Objekt', type: 'ref', required: true, refOptions: refOptions('objects') },
    { name: 'service_id', label: 'Dienstleistung', type: 'ref', refOptions: refOptions('services') },
    { name: 'template_id', label: 'Checkliste', type: 'ref', refOptions: refOptions('templates', (t) => t.purpose === 'reinigung'), emptyLabel: '– Standard der Dienstleistung –' },
    { name: 'frequency', label: 'Rhythmus', type: 'select', required: true, options: Object.entries(FREQUENCIES).map(([value, label]) => ({ value, label })), default: 'woechentlich' },
    { name: 'weekdays', label: 'Wochentage', type: 'weekdays', help: 'Bei „zweimal wöchentlich“ genau zwei Tage wählen. Bei wöchentlich/zweiwöchentlich optional.' },
    { name: 'interval_days', label: 'Intervall in Tagen (nur „Individuell“)', type: 'number', half: true },
    { name: 'start_time', label: 'Uhrzeit', type: 'time', half: true },
    { name: 'start_date', label: 'Beginn', type: 'date', required: true, default: 'today', half: true },
    { name: 'end_date', label: 'Ende (optional)', type: 'date', half: true },
    { name: 'planned_minutes', label: 'Geplante Dauer (Minuten)', type: 'number', half: true },
    { name: 'assigned_user_id', label: 'Mitarbeiter', type: 'ref', refOptions: refOptions('users'), half: true },
    { name: 'notes', label: 'Hinweise', type: 'textarea' },
    { name: 'active', label: 'Aktiv (Termine werden erzeugt)', type: 'bool', default: 1 },
  ];
  const f = buildForm(fields, ex || { object_id: query.object || '' });
  const save = btn('Speichern', { cls: 'primary lg', icon: 'check', onclick: async () => {
    if (!f.check()) return;
    save.disabled = true;
    try {
      const id = ex?.id || store.uuid();
      const r = await store.command('recurrence.save', { id, data: f.values(), base_version: ex?.version });
      toast(r.queued ? 'Gespeichert – Termine werden nach der Übertragung erzeugt.' : `Gespeichert. ${r.created ?? 0} Termine erzeugt.`);
      go('#/serien');
    } catch (e) { errorToast(e); } finally { save.disabled = false; }
  } });
  const del = ex ? btn('Serie löschen', { cls: 'danger', icon: 'trash', onclick: async () => {
    if (!(await confirmDialog('Serie löschen? Zukünftige, noch nicht begonnene Termine werden entfernt. Erledigte Aufträge bleiben erhalten.', { danger: true, ok: 'Löschen' }))) return;
    try { await store.command('recurrence.delete', { id: ex.id }); toast('Serie gelöscht.'); go('#/serien'); } catch (e) { errorToast(e); }
  } }) : null;
  return h('div', null, pageHead(ex ? 'Serienauftrag bearbeiten' : 'Serienauftrag anlegen', { back: '#/serien' }),
    ex ? h('div', { class: 'notice', style: { marginBottom: '12px' } }, ic('info'), 'Beim Speichern werden zukünftige, noch nicht begonnene Termine dieser Serie neu erzeugt.') : null,
    card(null, h('div', { class: 'card-pad' }, f.el, h('div', { class: 'form-actions' }, del, btn('Abbrechen', { href: '#/serien' }), save))));
}

export { addDays, api };
