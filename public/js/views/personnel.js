// Personalplanung und -auswertung: Dienstplan, Abwesenheiten/Urlaub, Vertretung,
// Personalkosten, Berechnungsmodelle, Personal-Einstellungen, Rollen & Rechte.
import { h, ic, card, empty, row, badge, pageHead, btn, kv, toast, errorToast, modal, buildForm, formDialog, confirmDialog, tabs, openUrl } from '../ui.js';
import * as store from '../store.js';
import { api } from '../api.js';
import { may, refOptions, userLabel, user, roleLabel } from './common.js';
import { ABSENCE_KINDS, ABSENCE_STATUS, PERMISSION_LABELS, PERMISSION_GROUPS, SHIFT_STATUS } from '/shared/constants.js';
import { ENTITIES } from '/shared/entities.js';
import { RULE_KINDS, SCOPE_TYPES, DISCLAIMER, ABSENCE_RULES, sollMinutesForDay } from '/shared/hr.js';
import { fmtDate, todayYmd, addDays, weekday, fmtMoney, fmtNumber, fmtMonth, fmtMinutes, monthRange } from '/shared/dates.js';
import { refresh } from '../app.js';

const opt = (o) => Object.entries(o).map(([value, label]) => ({ value, label }));
const staffUsers = () => store.all('users', (u) => u.role !== 'kunde' && u.active).sort((a, b) => a.name.localeCompare(b.name));
const monday = (ymd) => addDays(ymd, -((weekday(ymd) + 6) % 7));
const DOW = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
const absenceOn = (userId, d) => store.all('absences', (a) => a.user_id === userId && ['genehmigt', 'beantragt'].includes(a.status) && a.start_date <= d && a.end_date >= d)[0];
const statusKind = (s) => ({ genehmigt: 'ok', beantragt: 'warn', abgelehnt: 'bad', storniert: '' })[s] || '';
const toMin = (hm) => +hm.slice(0, 2) * 60 + +hm.slice(3, 5);
const shiftMinutes = (s) => { let d = toMin(s.end_time) - toMin(s.start_time); if (d <= 0) d += 1440; return d - (s.break_minutes || 0); };

// =====================================================================
// Abwesenheiten
// =====================================================================
export async function absenceDialog(preset = {}) {
  const manager = may('absences.manage');
  const ex = preset.id ? store.get('absences', preset.id) : null;
  const fields = [
    manager ? { name: 'user_id', label: 'Mitarbeiter', type: 'ref', required: true, refOptions: refOptions('users') } : null,
    { name: 'kind', label: 'Art', type: 'select', required: true, options: opt(ABSENCE_KINDS), default: 'urlaub' },
    { name: 'start_date', label: 'Von', type: 'date', required: true, half: true },
    { name: 'end_date', label: 'Bis', type: 'date', required: true, half: true },
    { name: 'half_day', label: 'Halber Tag (nur bei eintägiger Abwesenheit)', type: 'bool' },
    manager ? { name: 'paid', label: 'Bezahlt (für die interne Kostenrechnung)', type: 'bool', help: 'Ob und wie eine Abwesenheit zu vergüten ist, bitte arbeitsrechtlich prüfen.' } : null,
    { name: 'certificate', label: 'Arbeitsunfähigkeitsbescheinigung liegt vor', type: 'bool', help: 'Nur bei Krankheit relevant.' },
    manager ? { name: 'substitute_user_id', label: 'Vertretung', type: 'ref', refOptions: refOptions('users') } : null,
    { name: 'note', label: 'Bemerkung', type: 'textarea', rows: 2 },
  ].filter(Boolean);
  const values = ex || { kind: 'urlaub', user_id: preset.user_id || user().id, start_date: preset.date || todayYmd(), end_date: preset.date || todayYmd(), paid: 1 };
  const v = await formDialog(ex ? 'Abwesenheit bearbeiten' : manager ? 'Abwesenheit erfassen' : 'Abwesenheit beantragen', fields, values, { submit: manager ? 'Speichern' : 'Beantragen', validate: (x) => (x.end_date < x.start_date ? 'Das Ende liegt vor dem Beginn.' : null) });
  if (!v) return;
  if (manager && !ex && v.paid === 1 && values.paid === 1 && ABSENCE_RULES[v.kind] && !ABSENCE_RULES[v.kind].paidDefault) v.paid = 0;
  try {
    const r = await store.command('absence.save', { id: ex?.id || store.uuid(), ...v, base_version: ex?.version });
    toast(r.queued ? 'Gespeichert – wird bei Verbindung übertragen.' : manager ? 'Abwesenheit gespeichert.' : 'Antrag gestellt.');
    for (const w of r.warnings || []) toast(w, 'warn', 7000);
  } catch (e) { errorToast(e); }
}

export function absenceRow(a, { showUser = true } = {}) {
  const manager = may('absences.manage');
  const mine = a.user_id === user().id;
  const actions = h('div', { class: 'btn-row' });
  if (manager && a.status === 'beantragt') {
    actions.append(btn('Ablehnen', { cls: 'sm danger', onclick: async () => { const v = await formDialog('Antrag ablehnen', [{ name: 'note', label: 'Begründung', type: 'textarea', required: true }], {}); if (v) store.command('absence.decide', { id: a.id, approve: false, note: v.note }).catch(errorToast); } }),
      btn('Genehmigen', { cls: 'sm primary', onclick: () => store.command('absence.decide', { id: a.id, approve: true }).then(() => toast('Genehmigt.')).catch(errorToast) }));
  }
  if ((manager && ['beantragt', 'genehmigt'].includes(a.status)) || (mine && a.status === 'beantragt')) {
    actions.append(btn('', { cls: 'sm ghost icon-btn', icon: 'trash', title: 'Stornieren', onclick: async () => { if (await confirmDialog('Abwesenheit stornieren?', { ok: 'Stornieren', danger: true })) store.command('absence.cancel', { id: a.id }).catch(errorToast); } }));
  }
  return h('div', { class: 'row', style: { cursor: 'default', flexWrap: 'wrap' } },
    h('div', { class: 'lead' }, ic(a.kind === 'urlaub' ? 'calendar' : ['krank', 'kind_krank'].includes(a.kind) ? 'alert' : 'clock')),
    h('div', { class: 'grow' }, h('div', { class: 'title' }, `${showUser ? userLabel(a.user_id) + ' · ' : ''}${ABSENCE_KINDS[a.kind]}`),
      h('div', { class: 'meta', style: { whiteSpace: 'normal' } }, [`${fmtDate(a.start_date)}${a.end_date !== a.start_date ? ' – ' + fmtDate(a.end_date) : ''}`, `${fmtNumber(a.days)} Arbeitstag(e)${a.half_day ? ' (halber Tag)' : ''}`, a.certificate ? 'AU liegt vor' : null, a.substitute_user_id ? 'Vertretung: ' + userLabel(a.substitute_user_id) : null, a.note, a.decision_note ? 'Entscheidung: ' + a.decision_note : null].filter(Boolean).join(' · '))),
    badge(ABSENCE_STATUS[a.status], statusKind(a.status)), actions);
}

const ast = { tab: 'liste', filter: 'offen', month: null };
export function absencesView() {
  const manager = may('absences.manage');
  const all = store.all('absences').sort((a, b) => b.start_date.localeCompare(a.start_date));
  const el = h('div', null, pageHead(manager ? 'Abwesenheiten & Urlaub' : 'Meine Abwesenheiten', { sub: 'Urlaub, Krankmeldungen, Sonderurlaub und Vertretungen', actions: [
    may(['absences.request', 'absences.manage']) ? btn(manager ? 'Abwesenheit erfassen' : 'Urlaub beantragen', { icon: 'plus', cls: 'primary', onclick: () => absenceDialog() }) : null,
  ].filter(Boolean) }));
  if (!manager) {
    el.append(card(null, all.length ? h('div', { class: 'list' }, all.map((a) => absenceRow(a, { showUser: false }))) : empty('Noch keine Abwesenheiten.', 'calendar')));
    return el;
  }
  const open = all.filter((a) => a.status === 'beantragt');
  el.append(tabs([{ key: 'liste', label: 'Anträge & Liste', count: open.length }, { key: 'plan', label: 'Urlaubsplan' }, { key: 'vertretung', label: 'Vertretungsplanung' }], ast.tab, (k) => { ast.tab = k; refresh(); }));
  if (ast.tab === 'liste') {
    const today = todayYmd();
    const list = all.filter((a) => (ast.filter === 'offen' ? a.status === 'beantragt' : ast.filter === 'aktuell' ? a.status === 'genehmigt' && a.end_date >= today : true));
    el.append(h('div', { class: 'toolbar' }, h('div', { class: 'chips' }, [['offen', 'Offene Anträge'], ['aktuell', 'Aktuell & geplant'], ['alle', 'Alle']].map(([k, l]) => h('button', { class: 'chip' + (ast.filter === k ? ' active' : ''), onclick: () => { ast.filter = k; refresh(); } }, l)))));
    el.append(card(null, list.length ? h('div', { class: 'list' }, list.map((a) => absenceRow(a))) : empty('Keine Einträge.', 'calendar')));
  } else if (ast.tab === 'plan') {
    el.append(vacationPlan());
  } else {
    el.append(substitutePlanning());
  }
  return el;
}

function vacationPlan() {
  const m = ast.month || todayYmd().slice(0, 7);
  const { start, end } = monthRange(m);
  const days = []; for (let d = start; d <= end; d = addDays(d, 1)) days.push(d);
  const holidays = new Set(store.all('holidays').map((x) => x.date));
  const shift = (n) => { const [y, mo] = m.split('-').map(Number); ast.month = new Date(Date.UTC(y, mo - 1 + n, 1)).toISOString().slice(0, 7); refresh(); };
  const letter = { urlaub: 'U', krank: 'K', kind_krank: 'KK', sonderurlaub: 'S', unbezahlt: 'UB', schulung: 'W', ueberstundenabbau: 'Ü', sonstiges: '•' };
  const table = h('table', { class: 'data', style: { fontSize: '.75rem' } },
    h('thead', null, h('tr', null, h('th', null, 'Mitarbeiter'), days.map((d) => h('th', { class: 'num', style: { padding: '6px 3px', background: [0, 6].includes(weekday(d)) || holidays.has(d) ? 'var(--bg)' : '' } }, `${DOW[(weekday(d) + 6) % 7]} ${+d.slice(8)}`)))),
    h('tbody', null, staffUsers().map((u) => h('tr', null, h('td', { class: 'nowrap' }, u.name), days.map((d) => {
      const a = absenceOn(u.id, d);
      return h('td', { class: 'num', style: { padding: '6px 3px', cursor: 'pointer', background: a ? (a.status === 'genehmigt' ? 'var(--accent-soft)' : 'var(--warn-soft)') : [0, 6].includes(weekday(d)) || holidays.has(d) ? 'var(--bg)' : '' }, title: a ? `${ABSENCE_KINDS[a.kind]} (${ABSENCE_STATUS[a.status]})` : 'Abwesenheit eintragen', onclick: () => (a ? absenceDialog({ id: a.id }) : absenceDialog({ user_id: u.id, date: d })) }, a ? letter[a.kind] : '');
    })))));
  return card(`Urlaubsplan ${fmtMonth(m)}`, h('div', null, h('div', { class: 'table-wrap' }, table),
    h('p', { class: 'tiny muted', style: { padding: '0 16px 12px' } }, 'U = Urlaub, K = Krank, KK = Kind krank, S = Sonderurlaub, UB = unbezahlt, W = Weiterbildung, Ü = Überstundenabbau. Grün = genehmigt, orange = beantragt. Zelle antippen zum Eintragen.')),
  { iconName: 'calendar', actions: [btn('', { cls: 'sm ghost icon-btn', icon: 'back', onclick: () => shift(-1) }), btn('', { cls: 'sm ghost icon-btn', icon: 'chevron', onclick: () => shift(1) })] });
}

function substitutePlanning() {
  const today = todayYmd();
  const absences = store.all('absences', (a) => a.status === 'genehmigt' && a.end_date >= today).sort((a, b) => a.start_date.localeCompare(b.start_date));
  const items = [];
  for (const a of absences) {
    for (const s of store.all('shifts', (x) => x.user_id === a.user_id && x.date >= a.start_date && x.date <= a.end_date && x.date >= today && x.status !== 'abgesagt')) items.push({ type: 'shift', a, id: s.id, date: s.date, label: `Schicht ${s.start_time}–${s.end_time}${s.object_id ? ' · ' + (store.get('objects', s.object_id)?.name || '') : ''}` });
    for (const o of store.all('orders', (x) => x.assigned_user_id === a.user_id && x.scheduled_date >= a.start_date && x.scheduled_date <= a.end_date && x.scheduled_date >= today && !x.completed_at)) items.push({ type: 'order', a, id: o.id, date: o.scheduled_date, label: `Auftrag ${o.order_no || ''} · ${store.get('objects', o.object_id)?.name || ''}` });
  }
  items.sort((x, y) => x.date.localeCompare(y.date));
  if (!items.length) return card('Vertretungsbedarf', empty('Keine Schichten oder Aufträge von abwesenden Mitarbeitern betroffen.', 'checkCircle'));
  return card(`Vertretungsbedarf (${items.length})`, h('div', { class: 'list' }, items.map((it) => {
    const free = staffUsers().filter((u) => u.id !== it.a.user_id && !absenceOn(u.id, it.date));
    const sel = h('select', { style: { width: 'auto', minWidth: '180px' } }, h('option', { value: '' }, '– Vertretung wählen –'), free.map((u) => h('option', { value: u.id, selected: u.id === it.a.substitute_user_id }, u.name)));
    return h('div', { class: 'row', style: { cursor: 'default', flexWrap: 'wrap' } },
      h('div', { class: 'grow' }, h('div', { class: 'title' }, `${fmtDate(it.date)} · ${it.label}`), h('div', { class: 'meta' }, `${userLabel(it.a.user_id)} – ${ABSENCE_KINDS[it.a.kind]}`)),
      sel, btn('Zuweisen', { cls: 'sm primary', onclick: async () => {
        if (!sel.value) return toast('Bitte eine Vertretung wählen.', 'bad');
        try { await store.command('substitute.assign', { absence_id: it.a.id, items: [{ type: it.type, id: it.id, user_id: sel.value }] }); toast('Vertretung zugewiesen.'); } catch (e) { errorToast(e); }
      } }));
  })), { iconName: 'users' });
}

// =====================================================================
// Dienst- und Schichtplanung
// =====================================================================
const pst = { week: null };
export function planningView() {
  const manager = may('planning.manage');
  const wk = pst.week || monday(todayYmd());
  const days = Array.from({ length: 7 }, (_, i) => addDays(wk, i));
  const holidays = new Set(store.all('holidays').map((x) => x.date));
  const el = h('div', null, pageHead(manager ? 'Dienstplan' : 'Mein Dienstplan', { sub: `Woche ${fmtDate(days[0])} – ${fmtDate(days[6])}`, actions: [
    btn('', { icon: 'back', cls: 'icon-btn', title: 'Vorwoche', onclick: () => { pst.week = addDays(wk, -7); refresh(); } }),
    btn('Heute', { onclick: () => { pst.week = null; refresh(); } }),
    btn('', { icon: 'chevron', cls: 'icon-btn', title: 'Folgewoche', onclick: () => { pst.week = addDays(wk, 7); refresh(); } }),
    manager ? btn('Vorwoche übernehmen', { icon: 'repeat', onclick: async () => {
      if (!(await confirmDialog('Alle Schichten der Vorwoche in diese Woche kopieren? Bereits vorhandene gleiche Schichten werden übersprungen.', { ok: 'Kopieren' }))) return;
      try { const r = await store.command('shift.copyWeek', { from_monday: addDays(wk, -7), to_monday: wk }); toast(r.queued ? 'Wird bei Verbindung ausgeführt.' : `${r.created} Schicht(en) übernommen${r.skipped ? ', ' + r.skipped + ' übersprungen' : ''}.`); } catch (e) { errorToast(e); }
    } }) : null,
  ].filter(Boolean) }));
  if (!manager) {
    const mine = store.all('shifts', (s) => s.user_id === user().id && s.date >= todayYmd() && s.status !== 'abgesagt').sort((a, b) => (a.date + a.start_time).localeCompare(b.date + b.start_time));
    el.firstChild.querySelector('.sub').textContent = 'Ihre kommenden Schichten';
    el.append(card(null, mine.length ? h('div', { class: 'list' }, mine.map((s) => row({
      lead: h('div', { class: 'lead time' }, s.start_time), title: `${new Intl.DateTimeFormat('de-DE', { weekday: 'long', timeZone: 'UTC' }).format(new Date(s.date + 'T12:00:00Z'))}, ${fmtDate(s.date)}`,
      meta: [`${s.start_time}–${s.end_time}`, s.break_minutes ? `${s.break_minutes} Min. Pause` : null, store.get('objects', s.object_id)?.name, s.note, s.replaces_user_id ? 'Vertretung' : null].filter(Boolean).join(' · '),
      href: s.object_id ? `#/objekte/${s.object_id}` : undefined,
    }))) : empty('Keine Schichten geplant.', 'calendar')));
    return el;
  }
  const users = staffUsers();
  const table = h('table', { class: 'data', style: { minWidth: '820px' } },
    h('thead', null, h('tr', null, h('th', null, 'Mitarbeiter'), days.map((d) => h('th', { style: { background: holidays.has(d) ? 'var(--warn-soft)' : '' } }, `${DOW[(weekday(d) + 6) % 7]} ${fmtDate(d).slice(0, 6)}`, holidays.has(d) ? h('div', { class: 'tiny' }, store.all('holidays', (x) => x.date === d)[0]?.name) : null)), h('th', { class: 'num' }, 'Plan / Soll'))),
    h('tbody', null, users.map((u) => {
      const p = store.get('employee_profiles', u.id) || {};
      const model = p.work_model_id ? store.get('work_models', p.work_model_id) : null;
      let plan = 0; let soll = 0;
      const cells = days.map((d) => {
        soll += sollMinutesForDay(d, { model, profile: p, entryDate: u.entry_date, exitDate: p.exit_date, holidays });
        const a = absenceOn(u.id, d);
        const shifts = store.all('shifts', (s) => s.user_id === u.id && s.date === d).sort((x, y) => x.start_time.localeCompare(y.start_time));
        shifts.forEach((s) => { if (s.status !== 'abgesagt') plan += shiftMinutes(s); });
        return h('td', { style: { verticalAlign: 'top', minWidth: '96px', cursor: 'pointer', background: a ? (a.status === 'genehmigt' ? 'var(--accent-soft)' : 'var(--warn-soft)') : '' }, onclick: (e) => { if (e.target === e.currentTarget) shiftDialog({ user_id: u.id, date: d }); } },
          a ? h('div', { class: 'tiny', style: { fontWeight: 700 } }, ABSENCE_KINDS[a.kind]) : null,
          shifts.map((s) => h('div', { onclick: () => shiftDialog(s), style: { background: s.status === 'abgesagt' ? 'var(--bg)' : 'var(--surface)', border: '1px solid var(--line-strong)', borderLeft: '3px solid var(--accent)', borderRadius: '6px', padding: '3px 5px', marginBottom: '3px', fontSize: '.75rem', textDecoration: s.status === 'abgesagt' ? 'line-through' : '' } },
            h('strong', null, `${s.start_time}–${s.end_time}`), s.object_id ? h('div', null, store.get('objects', s.object_id)?.name || '') : null, s.replaces_user_id ? h('div', { class: 'muted' }, `Vertr. für ${userLabel(s.replaces_user_id)}`) : null)),
          h('button', { class: 'btn ghost sm', style: { minHeight: '28px', padding: '0 6px', width: '100%' }, onclick: () => shiftDialog({ user_id: u.id, date: d }), 'aria-label': 'Schicht hinzufügen' }, ic('plus')));
      });
      return h('tr', null, h('td', { class: 'nowrap' }, h('a', { href: `#/mitarbeiter/${u.id}` }, u.name), h('div', { class: 'tiny muted' }, store.get('positions', p.position_id)?.name || '')), cells,
        h('td', { class: 'num nowrap', style: { color: soll && plan < soll ? 'var(--warn)' : '' } }, `${fmtMinutes(plan)}`, h('div', { class: 'tiny muted' }, `Soll ${fmtMinutes(soll)}`)));
    })));
  el.append(card(null, h('div', { class: 'table-wrap' }, table)));
  el.append(h('p', { class: 'tiny muted' }, 'Feld oder „+“ antippen, um eine Schicht einzutragen; Schicht antippen zum Ändern. Grün = genehmigte Abwesenheit, orange = beantragt. Soll laut Arbeitszeitmodell.'));
  return el;
}

async function shiftDialog(s) {
  const ex = s.id ? store.get('shifts', s.id) : null;
  const fields = [
    { name: 'user_id', label: 'Mitarbeiter', type: 'ref', required: true, refOptions: refOptions('users') },
    { name: 'date', label: 'Datum', type: 'date', required: true },
    { name: 'object_id', label: 'Objekt', type: 'ref', refOptions: refOptions('objects') },
    { name: 'start_time', label: 'Beginn', type: 'time', required: true, half: true },
    { name: 'end_time', label: 'Ende', type: 'time', required: true, half: true, help: 'Ende vor Beginn = über Mitternacht.' },
    { name: 'break_minutes', label: 'Pause (Minuten)', type: 'number', half: true },
    { name: 'status', label: 'Status', type: 'select', required: true, options: opt(SHIFT_STATUS), default: 'geplant', half: true },
    { name: 'note', label: 'Hinweis', type: 'text' },
  ];
  const f = buildForm(fields, ex || { start_time: '08:00', end_time: '16:00', break_minutes: 0, status: 'geplant', ...s });
  const actions = [{ label: 'Abbrechen', value: null }];
  if (ex) actions.unshift({ label: 'Löschen', class: 'danger', icon: 'trash', onClick: async () => { await store.command('shift.delete', { id: ex.id }); toast('Schicht gelöscht.'); return true; } });
  actions.push({ label: 'Speichern', class: 'primary', onClick: async () => {
    if (!f.check()) return false;
    const r = await store.command('shift.save', { id: ex?.id || store.uuid(), ...f.values() });
    toast(r.queued ? 'Gespeichert – wird bei Verbindung übertragen.' : 'Schicht gespeichert.');
    for (const w of r.warnings || []) toast(w, 'warn', 7000);
    return true;
  } });
  await modal({ title: ex ? 'Schicht bearbeiten' : 'Schicht eintragen', body: f.el, actions });
}

// =====================================================================
// Personalkosten
// =====================================================================
const cst = { month: null };
export async function costsView() {
  const m = cst.month || todayYmd().slice(0, 7);
  const shift = (n) => { const [y, mo] = m.split('-').map(Number); cst.month = new Date(Date.UTC(y, mo - 1 + n, 1)).toISOString().slice(0, 7); refresh(); };
  const c = await api('GET', `/api/personnel/costs?month=${m}`);
  const el = h('div', null, pageHead('Personalkosten', { sub: fmtMonth(m), actions: [
    btn('', { icon: 'back', cls: 'icon-btn', title: 'Vormonat', onclick: () => shift(-1) }), btn('', { icon: 'chevron', cls: 'icon-btn', title: 'Folgemonat', onclick: () => shift(1) }),
    btn('PDF', { icon: 'print', onclick: () => openUrl(`/api/reports/personalkosten?month=${m}`) }), h('a', { class: 'btn', href: `/api/export/personalkosten.csv?month=${m}` }, ic('download'), 'CSV'),
    may('hr.rules') ? btn('Berechnungsmodelle', { icon: 'settings', href: '#/lohnmodelle' }) : null,
  ].filter(Boolean) }));
  el.append(h('div', { class: 'notice warn' }, ic('info'), c.disclaimer));
  const k = (label, value, hint, kind = '') => h('div', { class: `kpi ${kind}` }, h('div', { class: 'label' }, label), h('div', { class: 'value', style: { fontSize: '1.5rem' } }, value), hint ? h('div', { class: 'hint' }, hint) : null);
  el.append(h('div', { class: 'kpis wide', style: { margin: '12px 0' } },
    k('Personalkosten', fmtMoney(c.totals.total), `Brutto intern ${fmtMoney(c.totals.gross)}`, 'accent'), k('Arbeitsstunden', fmtNumber(c.totals.hours)),
    k('Kosten je Stunde', c.totals.per_hour != null ? fmtMoney(c.totals.per_hour) : '–'), k('Überstundenkosten', fmtMoney(c.totals.overtime_cost), `${fmtNumber(c.totals.overtime_hours)} Überstunden`, 'warn'),
    k('Zuschläge', fmtMoney(c.totals.surcharges))));
  const warnCount = c.employees.reduce((s, e) => s + e.warnings.length, 0);
  if (warnCount) el.append(h('div', { class: 'notice warn' }, ic('alert'), `${warnCount} Hinweis(e): Bei einigen Mitarbeitern fehlen Angaben (z. B. Stundenlohn). Details per Klick auf den Mitarbeiter.`));
  el.append(card('Je Mitarbeiter', c.employees.length ? h('div', { class: 'table-wrap' }, h('table', { class: 'data' },
    h('thead', null, h('tr', null, ['Mitarbeiter', 'Soll', 'Ist', 'Überstd.', 'Grund', 'Überstd. €', 'Zuschläge', 'Sonstiges', 'Kosten', '€/Std.'].map((t, i) => h('th', { class: i ? 'num' : '' }, t)))),
    h('tbody', null, c.employees.map((e) => h('tr', { class: 'click', onclick: () => employeeBreakdown(e) },
      h('td', null, e.name, h('div', { class: 'tiny muted' }, e.employee_no), e.warnings.length ? badge('Angaben fehlen', 'warn') : null),
      ...[e.hours.soll, e.hours.ist, e.hours.overtime].map((v) => h('td', { class: 'num' }, fmtNumber(v))),
      ...[e.amounts.base, e.amounts.overtime, e.amounts.surcharges, e.amounts.object + e.amounts.travel + e.amounts.bonus - e.amounts.deduction + e.amounts.markup, e.amounts.total].map((v) => h('td', { class: 'num nowrap' }, fmtMoney(v))),
      h('td', { class: 'num nowrap' }, e.amounts.per_hour != null ? fmtMoney(e.amounts.per_hour) : '–')))))) : empty('Keine Daten in diesem Monat.'), { iconName: 'users' }));
  el.append(card('Je Objekt (im Verhältnis zum Umsatz)', c.objects.length ? h('div', { class: 'table-wrap' }, h('table', { class: 'data' },
    h('thead', null, h('tr', null, ['Objekt', 'Stunden', 'Personalkosten', 'Umsatz', 'Anteil', ''].map((t, i) => h('th', { class: i ? 'num' : '' }, t)))),
    h('tbody', null, c.objects.map((o) => h('tr', null, h('td', null, o.name, o.object_no ? h('div', { class: 'tiny muted' }, o.object_no) : null), h('td', { class: 'num' }, fmtNumber(o.hours ?? o.minutes / 60)),
      h('td', { class: 'num nowrap' }, fmtMoney(o.cost)), h('td', { class: 'num nowrap' }, o.revenue != null ? fmtMoney(o.revenue) : '–'),
      h('td', { class: 'num' }, o.ratio != null ? badge(`${fmtNumber(o.ratio, 1)} %`, o.ratio > 100 ? 'bad' : o.ratio > 70 ? 'warn' : 'ok') : '–'),
      h('td', { class: 'num' }, o.object_id ? btn('Umsatz', { cls: 'sm', onclick: () => revenueDialog(o, m) }) : null)))))) : empty('Keine objektbezogenen Stunden.'), { iconName: 'building' }));
  el.append(h('p', { class: 'tiny muted' }, 'Kosten werden nach geleisteten Stunden auf Objekte verteilt; objektbezogene Vergütungen und Einmalbeträge mit Objekt direkt. Umsatz: Monatswert je Objekt oder Standard-Monatsumsatz.'));
  return el;
}

async function employeeBreakdown(e) {
  await modal({ title: `${e.name} · ${fmtMonth(e.month)}`, wide: true, body: h('div', null,
    e.warnings.map((w) => h('div', { class: 'notice warn' }, ic('alert'), w)),
    kv([['Soll', `${fmtNumber(e.hours.soll)} Std.`], ['Gearbeitet', `${fmtNumber(e.hours.worked)} Std.`], ['Abwesenheit angerechnet', `${fmtNumber(e.hours.absence_credit)} Std.`], ['Über-/Unterstunden', `${fmtNumber(e.hours.overtime)} Std.`]]),
    h('div', { class: 'list' }, e.lines.map((l) => h('div', { class: 'stat-line' }, h('span', null, l.label, l.detail ? h('span', { class: 'muted small' }, ` (${l.detail})`) : null), h('span', { class: 'nowrap' }, fmtMoney(l.amount))))),
    h('div', { class: 'stat-line', style: { fontWeight: 700 } }, h('span', null, 'Personalkosten'), h('span', null, fmtMoney(e.amounts.total)))),
  actions: [{ label: 'Personalakte', onClick: () => { location.hash = `#/mitarbeiter/${e.user_id}`; return true; } }, { label: 'Schließen', class: 'primary' }] });
}

async function revenueDialog(o, month) {
  const ex = store.all('object_revenues', (r) => r.object_id === o.object_id && r.month === month)[0];
  const obj = store.get('objects', o.object_id);
  const v = await formDialog(`Umsatz ${o.name}`, [
    { name: 'amount', label: `Umsatz netto ${fmtMonth(month)} (€)`, type: 'money' },
    { name: 'default', label: 'Standard-Monatsumsatz für alle Monate ohne eigenen Wert (€)', type: 'money' },
  ], { amount: ex?.amount ?? '', default: obj?.monthly_revenue ?? '' });
  if (!v) return;
  try {
    if (v.amount !== null) await store.command('entity.save', { entity: 'object_revenues', id: ex?.id || store.uuid(), data: { object_id: o.object_id, month, amount: v.amount }, base_version: ex?.version });
    else if (ex) await store.command('entity.delete', { entity: 'object_revenues', id: ex.id });
    if (String(v.default ?? '') !== String(obj?.monthly_revenue ?? '')) await store.command('object.setRevenue', { object_id: o.object_id, monthly_revenue: v.default });
    toast('Umsatz gespeichert.'); refresh();
  } catch (e) { errorToast(e); }
}

// =====================================================================
// Berechnungsmodelle
// =====================================================================
export function rulesView() {
  const rules = store.all('pay_rules');
  const groups = {};
  for (const [k, d] of Object.entries(RULE_KINDS)) (groups[d.group] ||= []).push(k);
  const el = h('div', null, pageHead('Berechnungsmodelle', { sub: 'Eigene Regeln für Löhne, Zuschläge, Überstunden, Fahrtkosten, Boni, Abzüge, Pausen und Rundung', actions: [btn('Neues Modell', { icon: 'plus', cls: 'primary', onclick: () => ruleDialog() })] }));
  el.append(h('div', { class: 'notice' }, ic('info'), h('div', null, 'Jedes Modell gilt für alle Mitarbeiter, eine Abteilung, Beschäftigungsart, Position, einen einzelnen Mitarbeiter oder (Objektvergütung) ein Objekt. Gibt es mehrere passende Modelle gleicher Art, gilt das speziellste (Mitarbeiter vor Position vor Beschäftigungsart vor Abteilung vor alle), bei Gleichstand die höhere Priorität. ', h('strong', null, 'Es sind keine gesetzlichen Werte vorbelegt – alle Beträge und Prozentsätze legen Sie selbst fest.'))));
  for (const [g, kinds] of Object.entries(groups)) {
    const list = rules.filter((r) => kinds.includes(r.kind)).sort((a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name));
    el.append(card(g, list.length ? h('div', { class: 'list' }, list.map((r) => row({
      title: r.name, onclick: () => ruleDialog(r),
      meta: [RULE_KINDS[r.kind].label, scopeText(r), paramText(r), r.valid_from || r.valid_to ? `gültig ${r.valid_from || '…'} bis ${r.valid_to || '…'}` : null].filter(Boolean).join(' · '),
      right: h('div', { class: 'btn-row' }, r.active ? badge('aktiv', 'ok') : badge('inaktiv'), h('button', { class: 'btn sm', onclick: (e) => { e.stopPropagation(); store.command('entity.save', { entity: 'pay_rules', id: r.id, data: fullRule(r, { active: r.active ? 0 : 1 }), base_version: r.version }).catch(errorToast); } }, r.active ? 'Deaktivieren' : 'Aktivieren')),
    }))) : h('div', { class: 'empty small' }, 'Noch keine Modelle.'), { iconName: 'settings', actions: [btn('Hinzufügen', { cls: 'sm', icon: 'plus', onclick: () => ruleDialog(null, kinds[0]) })] }));
  }
  return el;
}

const fullRule = (r, patch = {}) => ({ name: r.name, kind: r.kind, category: r.category, scope_type: r.scope_type, scope_id: r.scope_id, params: JSON.parse(r.params || '{}'), priority: r.priority, valid_from: r.valid_from, valid_to: r.valid_to, active: r.active, description: r.description, ...patch });

function scopeText(r) {
  const t = { abteilung: 'departments', beschaeftigungsart: 'employment_types', position: 'positions', objekt: 'objects' }[r.scope_type];
  const name = r.scope_type === 'mitarbeiter' ? userLabel(r.scope_id) : t ? store.get(t, r.scope_id)?.name : '';
  return `${SCOPE_TYPES[r.scope_type]}${name ? ': ' + name : ''}`;
}
function paramText(r) {
  let p = {}; try { p = JSON.parse(r.params || '{}'); } catch { /* leer */ }
  const v = p.value ?? p.prozent;
  if (r.kind === 'zeitzuschlag') return `${p.mode === 'betrag_stunde' ? fmtMoney(v) + '/Std.' : fmtNumber(v) + ' %'}${p.time_from ? ` ${p.time_from}–${p.time_to}` : ''}${p.weekdays?.length ? ' ' + p.weekdays.map((d) => DOW[(d + 6) % 7]).join(',') : ''}${p.nur_feiertage ? ' Feiertage' : ''}`;
  if (r.kind === 'ueberstunden') return `${p.behandlung === 'zeitkonto' ? 'Zeitkonto' : 'Auszahlung'}${p.value ? ', ' + (p.mode === 'betrag_stunde' ? fmtMoney(p.value) + '/Std.' : fmtNumber(p.value) + ' %') : ''}`;
  if (r.kind === 'pausenregel') return [p.stufe1_ab ? `ab ${fmtNumber(p.stufe1_ab)} Std. ${p.stufe1_pause} Min.` : null, p.stufe2_ab ? `ab ${fmtNumber(p.stufe2_ab)} Std. ${p.stufe2_pause} Min.` : null].filter(Boolean).join(', ');
  if (r.kind === 'rundung') return `${p.einheit} Min. ${p.modus}`;
  if (r.kind === 'kostenaufschlag') return `${fmtNumber(v)} %`;
  if (r.kind === 'kilometer') return `${fmtMoney(v)}/km`;
  return v !== undefined ? fmtMoney(v) : '';
}

async function ruleDialog(r, presetKind) {
  const body = h('div');
  const p0 = r ? JSON.parse(r.params || '{}') : {};
  const head = buildForm([
    { name: 'kind', label: 'Berechnungsart', type: 'select', required: true, options: Object.entries(RULE_KINDS).map(([value, d]) => ({ value, label: `${d.group}: ${d.label}` })) },
  ], { kind: r?.kind || presetKind || 'zeitzuschlag' });
  head.inputs.kind.disabled = !!r;
  let main; let params; let scopeSel;
  const draw = () => {
    const kind = head.inputs.kind.value;
    const def = RULE_KINDS[kind];
    const cats = def.categories ? Object.entries(def.categories).map(([value, label]) => ({ value, label })) : null;
    main = buildForm([
      { name: 'name', label: 'Bezeichnung', type: 'text', required: true, placeholder: def.label },
      cats ? { name: 'category', label: 'Kategorie', type: 'select', required: true, options: cats } : null,
      { name: 'scope_type', label: 'Gilt für', type: 'select', required: true, options: Object.entries(SCOPE_TYPES).filter(([k]) => (kind === 'objektverguetung' ? k === 'objekt' : k !== 'objekt')).map(([value, label]) => ({ value, label })) },
    ].filter(Boolean), r ? { name: r.name, category: r.category, scope_type: r.scope_type } : { scope_type: kind === 'objektverguetung' ? 'objekt' : 'alle', category: cats?.[0].value });
    scopeSel = h('div');
    const drawScope = () => {
      const t = main.inputs.scope_type.value;
      const ref = { abteilung: 'departments', beschaeftigungsart: 'employment_types', position: 'positions', mitarbeiter: 'users', objekt: 'objects' }[t];
      scopeSel._f = ref ? buildForm([{ name: 'scope_id', label: 'Auswahl', type: 'ref', required: true, refOptions: refOptions(ref) }], { scope_id: r?.scope_type === t ? r.scope_id : '' }) : null;
      scopeSel.replaceChildren(scopeSel._f ? scopeSel._f.el : '');
    };
    main.inputs.scope_type.addEventListener('change', drawScope);
    drawScope();
    params = buildForm(def.params, r?.kind === kind ? p0 : {});
    const meta = buildForm([
      { name: 'priority', label: 'Priorität (bei Gleichstand)', type: 'number', third: true },
      { name: 'valid_from', label: 'Gültig ab (Monat)', type: 'month', third: true },
      { name: 'valid_to', label: 'Gültig bis (Monat)', type: 'month', third: true },
      { name: 'active', label: 'Aktiv', type: 'bool', default: 1 },
      { name: 'description', label: 'Notiz', type: 'textarea', rows: 2 },
    ], r || { priority: 0, active: 1 });
    body._meta = meta;
    body.replaceChildren(head.el, def.help ? h('div', { class: 'notice', style: { margin: '12px 0' } }, ic('info'), def.help) : null, main.el, scopeSel,
      h('h3', { style: { margin: '16px 0 8px' } }, 'Werte'), params.el, h('h3', { style: { margin: '16px 0 8px' } }, 'Gültigkeit'), meta.el);
  };
  head.inputs.kind.addEventListener('change', draw);
  draw();
  const actions = [{ label: 'Abbrechen', value: null }];
  if (r) actions.unshift({ label: 'Löschen', class: 'danger', icon: 'trash', onClick: async () => { if (!(await confirmDialog('Modell löschen? (Alternativ deaktivieren)', { danger: true, ok: 'Löschen' }))) return false; await store.command('entity.delete', { entity: 'pay_rules', id: r.id }); toast('Gelöscht.'); return true; } });
  actions.push({ label: 'Speichern', class: 'primary', onClick: async () => {
    if (!main.check() || !params.check() || (scopeSel._f && !scopeSel._f.check()) || !body._meta.check()) return false;
    const pv = params.values();
    for (const [k, v] of Object.entries(pv)) if (v === '' || v === null || (Array.isArray(v) && !v.length)) delete pv[k];
    const data = { kind: head.inputs.kind.value, ...main.values(), scope_id: scopeSel._f ? scopeSel._f.values().scope_id : null, params: pv, ...body._meta.values() };
    if (!data.category) data.category = null;
    if (!data.priority) data.priority = 0;
    await store.command('entity.save', { entity: 'pay_rules', id: r?.id || store.uuid(), data, base_version: r?.version });
    toast('Berechnungsmodell gespeichert.');
    return true;
  } });
  await modal({ title: r ? 'Berechnungsmodell bearbeiten' : 'Neues Berechnungsmodell', body, actions, wide: true });
}

// =====================================================================
// Personal-Einstellungen (Kategorien, Arbeitszeitmodelle, Feiertage)
// =====================================================================
const sst = { tab: 'employment_types', year: null };
export function hrSettingsView() {
  const el = h('div', null, pageHead('Personal-Einstellungen', { back: '#/mitarbeiter', sub: 'Beschäftigungsarten, Positionen, Abteilungen, Arbeitszeitmodelle und Feiertage' }));
  const tabList = ['employment_types', 'positions', 'departments', 'work_models', 'holidays'].map((k) => ({ key: k, label: ENTITIES[k].plural }));
  el.append(tabs(tabList, sst.tab, (k) => { sst.tab = k; refresh(); }));
  const def = ENTITIES[sst.tab];
  const edit = async (x) => {
    const fields = def.fields;
    const v = await formDialog(x ? `${def.label} bearbeiten` : `${def.label} anlegen`, fields, x || {});
    if (!v) return;
    try { await store.command('entity.save', { entity: sst.tab, id: x?.id || store.uuid(), data: v, base_version: x?.version }); toast('Gespeichert.'); } catch (e) { errorToast(e); }
  };
  if (sst.tab === 'holidays') {
    const y = sst.year || todayYmd().slice(0, 4);
    const list = store.all('holidays', (x) => x.date.startsWith(y)).sort((a, b) => a.date.localeCompare(b.date));
    el.append(h('div', { class: 'notice warn' }, ic('info'), 'Feiertage sind nicht vorbelegt, da sie je Bundesland abweichen. Bitte die für Sie geltenden Feiertage selbst eintragen. Sie verringern die Soll-Zeit (je nach Arbeitszeitmodell) und können für Feiertagszuschläge verwendet werden.'));
    el.append(card(`Feiertage ${y}`, list.length ? h('div', { class: 'list' }, list.map((x) => h('div', { class: 'row', style: { cursor: 'default' } },
      h('div', { class: 'grow' }, h('div', { class: 'title' }, x.name), h('div', { class: 'meta' }, fmtDate(x.date))),
      h('button', { class: 'btn ghost icon-btn', 'aria-label': 'Löschen', onclick: () => store.command('entity.delete', { entity: 'holidays', id: x.id }).catch(errorToast) }, ic('trash'))))) : empty('Keine Feiertage eingetragen.', 'calendar'),
    { iconName: 'calendar', actions: [btn('', { cls: 'sm ghost icon-btn', icon: 'back', onclick: () => { sst.year = String(+y - 1); refresh(); } }), btn('', { cls: 'sm ghost icon-btn', icon: 'chevron', onclick: () => { sst.year = String(+y + 1); refresh(); } }), btn('Feiertag', { cls: 'sm primary', icon: 'plus', onclick: () => edit(null) })] }));
    return el;
  }
  const list = store.all(sst.tab).sort((a, b) => (a.sort ?? 100) - (b.sort ?? 100) || a.name.localeCompare(b.name));
  const usage = (x) => {
    const col = { employment_types: 'employment_type_id', positions: 'position_id', departments: 'department_id', work_models: 'work_model_id' }[sst.tab];
    return store.all('employee_profiles', (p) => p[col] === x.id).length;
  };
  el.append(card(def.plural, list.length ? h('div', { class: 'list' }, list.map((x) => row({
    title: x.name, onclick: () => edit(x),
    meta: [sst.tab === 'work_models' ? `${fmtNumber(JSON.parse(x.day_minutes || '[]').reduce((s, m) => s + m, 0) / 60)} Std./Woche` : null, `${usage(x)} Mitarbeiter`, x.description].filter(Boolean).join(' · '),
    right: x.active ? null : badge('inaktiv'),
  }))) : empty('Keine Einträge.'), { iconName: 'list', actions: [btn('Neu', { cls: 'sm primary', icon: 'plus', onclick: () => edit(null) })] }));
  el.append(h('p', { class: 'tiny muted' }, 'Nicht mehr benötigte Einträge bitte deaktivieren statt löschen – bestehende Zuordnungen bleiben dadurch erhalten.'));
  return el;
}

// =====================================================================
// Rollen & Rechte
// =====================================================================
export function rolesView() {
  const roles = store.all('roles').sort((a, b) => a.sort - b.sort);
  const count = (k) => store.all('users', (u) => u.role === k).length;
  const el = h('div', null, pageHead('Rollen & Rechte', { back: '#/mitarbeiter', sub: 'Zugänge für Geschäftsführung, Verwaltung, Objektleitung, Vorarbeiter, Mitarbeiter, Minijobber, Aushilfen …', actions: [btn('Neue Rolle', { icon: 'plus', cls: 'primary', onclick: () => roleDialog() })] }));
  el.append(card(null, h('div', { class: 'list' }, roles.map((r) => row({
    title: r.name, onclick: () => roleDialog(r),
    meta: [`${JSON.parse(r.permissions).length} Rechte`, `${count(r.role_key)} Benutzer`, r.scoped ? 'nur zugeordnete Objekte/Aufträge' : 'alle Daten (gemäß Rechten)', r.description].filter(Boolean).join(' · '),
    right: h('div', { class: 'btn-row' }, r.system ? badge('Standard', 'outline') : null, r.active ? null : badge('inaktiv')),
  })))));
  el.append(h('p', { class: 'tiny muted' }, 'Änderungen an Rechten gelten sofort für alle Benutzer der Rolle. Die Administratorrolle besitzt immer alle Rechte. Sie können nur Rechte vergeben, die Sie selbst besitzen.'));
  return el;
}

async function roleDialog(r) {
  if (r && ['admin', 'kunde'].includes(r.role_key)) {
    await modal({ title: r.name, body: h('p', null, r.role_key === 'admin' ? 'Die Administratorrolle besitzt immer alle Rechte und kann nicht eingeschränkt werden.' : 'Die Kundenportal-Rolle hat ausschließlich Zugriff auf das Kundenportal.'), actions: [{ label: 'OK', class: 'primary' }] });
    return;
  }
  const perms = new Set(r ? JSON.parse(r.permissions) : []);
  const head = buildForm([
    { name: 'name', label: 'Name der Rolle', type: 'text', required: true },
    { name: 'scoped', label: 'Nur zugeordnete Objekte und Aufträge sehen (für Außendienst-Rollen)', type: 'bool' },
    { name: 'active', label: 'Aktiv', type: 'bool', default: 1 },
    { name: 'description', label: 'Beschreibung', type: 'text' },
  ], r || { active: 1, scoped: 1 });
  const groups = PERMISSION_GROUPS.map(([g, list]) => h('div', { style: { marginTop: '14px' } }, h('h3', { style: { marginBottom: '6px' } }, g),
    list.map((p) => h('label', { class: 'check', style: { minHeight: '40px', opacity: may(p) || user().role === 'admin' ? 1 : 0.5 } },
      h('input', { type: 'checkbox', checked: perms.has(p), disabled: !(may(p) || user().role === 'admin'), onchange: (e) => (e.target.checked ? perms.add(p) : perms.delete(p)) }), PERMISSION_LABELS[p]))));
  const actions = [{ label: 'Abbrechen', value: null }];
  if (r && !r.system) actions.unshift({ label: 'Löschen', class: 'danger', icon: 'trash', onClick: async () => { await store.command('role.delete', { id: r.id }); toast('Rolle gelöscht.'); return true; } });
  actions.push({ label: 'Speichern', class: 'primary', onClick: async () => {
    if (!head.check()) return false;
    await store.command('role.save', { id: r?.id || store.uuid(), data: { ...head.values(), permissions: [...perms] }, base_version: r?.version });
    toast('Rolle gespeichert.');
    return true;
  } });
  await modal({ title: r ? `Rolle „${r.name}“` : 'Neue Rolle', wide: true, body: h('div', null, head.el, groups), actions });
}

export { roleLabel };
