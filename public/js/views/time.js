import { h, ic, card, empty, badge, pageHead, btn, toast, errorToast, formDialog, modal, tabs, openUrl } from '../ui.js';
import * as store from '../store.js';
import { may, refOptions, userLabel, user, isAdmin, adminDelete } from './common.js';
import { fmtDate, fmtTime, fmtDateTime, fmtMinutes, todayYmd, ymdOf, berlinToIso, monthRange, fmtMonth, addDays } from '/shared/dates.js';
import { TIME_CORRECTION_STATUS } from '/shared/constants.js';
import { refresh } from '../app.js';

const dur = (e, nowTs = Date.now()) => ((e.end_at ? Date.parse(e.end_at) : nowTs) - Date.parse(e.start_at)) / 6e4;

function dayStats(entries) {
  const work = entries.filter((e) => e.kind === 'arbeit' && !e.voided).reduce((s, e) => s + dur(e), 0);
  const pause = entries.filter((e) => e.kind === 'pause' && !e.voided).reduce((s, e) => s + dur(e), 0);
  return { work, pause, net: work - pause };
}

function entriesOf(userId, fromYmd, toYmd) {
  const a = berlinToIso(fromYmd, '00:00'); const b = berlinToIso(addDays(toYmd, 1), '00:00');
  return store.all('time_entries', (e) => e.user_id === userId && e.start_at >= a && e.start_at < b).sort((x, y) => x.start_at.localeCompare(y.start_at));
}

export function timeView() {
  const u = user();
  const work = store.all('time_entries', (e) => e.user_id === u.id && e.kind === 'arbeit' && !e.end_at && !e.voided)[0];
  const pause = store.all('time_entries', (e) => e.user_id === u.id && e.kind === 'pause' && !e.end_at && !e.voided)[0];
  const today = entriesOf(u.id, todayYmd(), todayYmd());
  const big = h('div', { class: 'big' }, '0:00');
  const tick = () => {
    if (!big.isConnected && big.dataset.started) return clearInterval(timer);
    big.dataset.started = '1';
    const s = dayStats(today);
    const m = Math.max(0, Math.floor(s.net));
    big.textContent = `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;
  };
  const timer = setInterval(tick, 15000);
  tick();
  const stateText = pause ? `Pause seit ${fmtTime(pause.start_at)} Uhr` : work ? `Im Einsatz seit ${fmtTime(work.start_at)} Uhr` : 'Nicht eingestempelt';
  const obj = work?.object_id ? store.get('objects', work.object_id) : null;
  const act = (action, extra = {}) => async () => {
    try {
      const r = await store.command('time.clock', { id: store.uuid(), action, at: new Date().toISOString(), ...extra });
      toast({ start: 'Arbeitsbeginn', pause: 'Pausenbeginn', resume: 'Pausenende', stop: 'Arbeitsende' }[action] + ` gestempelt${r.queued ? ' (offline gespeichert)' : ''}.`);
    } catch (e) { errorToast(e); }
  };
  const startWithObject = async () => {
    const v = await formDialog('Arbeitsbeginn', [{ name: 'object_id', label: 'Objekt (optional)', type: 'ref', refOptions: refOptions('objects'), emptyLabel: '– ohne Objekt –' }], {}, { submit: 'Einstempeln' });
    if (v) act('start', { object_id: v.object_id || null })();
  };
  const buttons = h('div', { class: 'btn-row stretch', style: { marginTop: '14px' } });
  if (!work) buttons.append(btn('Arbeitsbeginn', { icon: 'play', cls: 'primary lg', onclick: startWithObject }));
  else {
    buttons.append(pause ? btn('Pause beenden', { icon: 'play', cls: 'primary lg', onclick: act('resume') }) : btn('Pause', { icon: 'pause', cls: 'lg', onclick: act('pause') }));
    buttons.append(btn('Arbeitsende', { icon: 'stop', cls: 'dark lg', onclick: act('stop') }));
  }
  const s = dayStats(today);
  const el = h('div', null,
    pageHead('Zeiterfassung', { sub: 'Arbeitsbeginn, Pausen und Arbeitsende – auch offline', actions: may('time.all') ? [btn('Team-Übersicht', { icon: 'users', href: '#/zeit/uebersicht' })] : [] }),
    card(null, h('div', { class: `clock ${pause ? 'paused' : work ? 'working' : ''}` },
      h('div', { class: 'state' }, stateText), big, h('div', { class: 'muted small' }, `Netto heute · Pausen ${fmtMinutes(s.pause)}`),
      obj ? h('div', { style: { marginTop: '6px' } }, badge(obj.name, 'accent')) : null, buttons)),
    h('div', { class: 'notice', style: { marginTop: '12px' } }, ic('info'), 'Zeitstempel werden unveränderbar gespeichert. Fehler bitte über „Korrektur beantragen“ melden – Änderungen werden mit Originalwert, Bearbeiter und Zeitpunkt protokolliert.'));
  el.append(monthCard(u.id, false));
  el.append(correctionsCard(u.id, false));
  return el;
}

const monthState = {};
function monthCard(userId, manager) {
  const key = userId;
  const month = monthState[key] || todayYmd().slice(0, 7);
  const { start, end } = monthRange(month);
  const entries = entriesOf(userId, start, end);
  const byDay = {};
  for (const e of entries) (byDay[ymdOf(e.start_at)] ||= []).push(e);
  const days = Object.keys(byDay).sort();
  const total = days.reduce((s, d) => s + dayStats(byDay[d]).net, 0);
  const shift = (n) => { const [y, m] = month.split('-').map(Number); const d = new Date(Date.UTC(y, m - 1 + n, 1)); monthState[key] = d.toISOString().slice(0, 7); refresh(); };
  const body = h('div');
  if (!days.length) body.append(empty('Keine Zeiteinträge in diesem Monat.', 'clock'));
  for (const d of days) {
    const st = dayStats(byDay[d]);
    body.append(h('div', { class: 'stat-line', style: { background: 'var(--surface-2)', fontWeight: 650 } }, h('span', null, new Intl.DateTimeFormat('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit', timeZone: 'UTC' }).format(new Date(d + 'T12:00:00Z'))), h('span', null, `${fmtMinutes(st.net)} netto`)));
    for (const e of byDay[d]) {
      const o = e.object_id ? store.get('objects', e.object_id)?.name : null;
      body.append(h('div', { class: 'row', onclick: () => requestCorrection(e, manager) },
        h('div', { class: 'lead' }, ic(e.kind === 'pause' ? 'pause' : 'clock')),
        h('div', { class: 'grow' }, h('div', { class: 'title', style: { textDecoration: e.voided ? 'line-through' : '' } }, `${e.kind === 'pause' ? 'Pause' : 'Arbeit'} ${fmtTime(e.start_at)} – ${e.end_at ? fmtTime(e.end_at) : 'läuft'}`),
          h('div', { class: 'meta' }, [o, e.end_at ? fmtMinutes(dur(e)) : null, e.source !== 'stempel' ? { offline: 'offline erfasst', korrigiert: 'korrigiert', nachtrag: 'Nachtrag' }[e.source] : null, e.voided ? 'storniert/ungültig' : null].filter(Boolean).join(' · '))),
        e._pending ? badge('offline', 'warn') : null,
        isAdmin() ? h('button', { class: 'btn ghost icon-btn', 'aria-label': 'Eintrag löschen', title: 'Löschen (Administrator)', onclick: (ev) => { ev.stopPropagation(); adminDelete('time_entries', e.id, 'Zeiteintrag'); } }, ic('trash')) : null,
        ic('edit', 'chev')));
    }
  }
  const qs = `month=${month}${manager ? '&user_id=' + userId : ''}`;
  return card(`${fmtMonth(month)} · ${fmtMinutes(total)}`, body, {
    iconName: 'calendar',
    actions: [btn('', { cls: 'sm ghost icon-btn', icon: 'back', onclick: () => shift(-1), title: 'Vormonat' }), btn('', { cls: 'sm ghost icon-btn', icon: 'chevron', onclick: () => shift(1), title: 'Folgemonat' }),
      btn('PDF', { cls: 'sm', icon: 'print', onclick: () => openUrl(`/api/reports/time?${qs}`) }), h('a', { class: 'btn sm', href: `/api/export/time.csv?${qs}` }, ic('download'), 'CSV'),
      btn('Nachtrag', { cls: 'sm', icon: 'plus', onclick: () => requestMissing(userId, manager) })],
  });
}

async function requestCorrection(e, manager) {
  const toHm = (iso) => (iso ? new Intl.DateTimeFormat('de-DE', { timeZone: 'Europe/Berlin', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso)) : '');
  const day = ymdOf(e.start_at);
  const v = await formDialog(manager && may('time.approve') ? 'Zeiteintrag korrigieren' : 'Korrektur beantragen', [
    { name: 'start', label: 'Beginn', type: 'time', required: true, half: true },
    { name: 'end', label: 'Ende', type: 'time', half: true },
    { name: 'void', label: 'Eintrag stornieren (ungültig)', type: 'bool' },
    { name: 'reason', label: 'Begründung', type: 'textarea', required: true },
  ], { start: toHm(e.start_at), end: toHm(e.end_at), void: e.voided });
  if (!v) return;
  let endIso = v.end ? berlinToIso(day, v.end) : null;
  if (endIso && v.end < v.start) endIso = berlinToIso(addDays(day, 1), v.end);
  try {
    const r = await store.command('time.correction', { id: store.uuid(), entry_id: e.id, new_start_at: berlinToIso(day, v.start), new_end_at: endIso, void: !!v.void, reason: v.reason });
    toast(may('time.approve') ? 'Korrektur gespeichert und protokolliert.' : r.queued ? 'Antrag gespeichert – wird bei Verbindung übertragen.' : 'Korrektur beantragt.');
  } catch (ex) { errorToast(ex); }
}

async function requestMissing(userId) {
  const v = await formDialog('Fehlende Zeit nachtragen', [
    { name: 'day', label: 'Datum', type: 'date', required: true, default: 'today' },
    { name: 'start', label: 'Beginn', type: 'time', required: true, half: true },
    { name: 'end', label: 'Ende', type: 'time', required: true, half: true },
    { name: 'kind', label: 'Art', type: 'select', required: true, options: [{ value: 'arbeit', label: 'Arbeitszeit' }, { value: 'pause', label: 'Pause' }] },
    { name: 'object_id', label: 'Objekt', type: 'ref', refOptions: refOptions('objects') },
    { name: 'reason', label: 'Begründung', type: 'textarea', required: true },
  ], { kind: 'arbeit' });
  if (!v) return;
  const s = berlinToIso(v.day, v.start);
  const e = berlinToIso(v.end < v.start ? addDays(v.day, 1) : v.day, v.end);
  try {
    await store.command('time.correction', { id: store.uuid(), new_entry_id: store.uuid(), user_id: userId, kind: v.kind, object_id: v.object_id || null, new_start_at: s, new_end_at: e, reason: v.reason });
    toast(may('time.approve') ? 'Nachtrag gespeichert.' : 'Nachtrag beantragt – gilt nach Genehmigung.');
  } catch (ex) { errorToast(ex); }
}

function correctionsCard(userId, manager) {
  const entryIds = new Set(store.all('time_entries', (e) => !userId || e.user_id === userId).map((e) => e.id));
  const rows = store.all('time_corrections', (c) => entryIds.has(c.entry_id) && (!manager || c.status === 'beantragt')).sort((a, b) => b.requested_at.localeCompare(a.requested_at)).slice(0, 30);
  const span = (a, b) => (a ? `${fmtTime(a)}–${b ? fmtTime(b) : '…'}` : '–');
  return card(manager ? 'Offene Korrekturanträge' : 'Meine Korrekturen', rows.length ? h('div', { class: 'list' }, rows.map((c) => {
    const e = store.get('time_entries', c.entry_id);
    return h('div', { class: 'row', style: { cursor: 'default', flexWrap: 'wrap' } },
      h('div', { class: 'grow' }, h('div', { class: 'title' }, `${e ? fmtDate(e.start_at) : ''} · ${c.old_start_at ? span(c.old_start_at, c.old_end_at) + ' → ' : 'Nachtrag '}${c.new_voided ? 'storniert' : span(c.new_start_at || c.old_start_at, c.new_end_at || c.old_end_at)}`),
        h('div', { class: 'meta' }, `${userLabel(c.requested_by)} · ${fmtDateTime(c.requested_at)} · „${c.reason}“${c.decided_by ? ' · entschieden von ' + userLabel(c.decided_by) : ''}`)),
      manager && may('time.approve') && c.status === 'beantragt' ? h('div', { class: 'btn-row' },
        btn('Ablehnen', { cls: 'sm danger', onclick: () => decide(c, false) }), btn('Genehmigen', { cls: 'sm primary', onclick: () => decide(c, true) }))
        : badge(TIME_CORRECTION_STATUS[c.status], c.status === 'genehmigt' ? 'ok' : c.status === 'abgelehnt' ? 'bad' : 'warn'));
  })) : empty(manager ? 'Keine offenen Anträge.' : 'Keine Korrekturen.'), { iconName: 'history' });
}

async function decide(c, approve) {
  let comment = '';
  if (!approve) { const v = await formDialog('Antrag ablehnen', [{ name: 'comment', label: 'Begründung', type: 'textarea', required: true }], {}); if (!v) return; comment = v.comment; }
  try { await store.command('time.decide', { id: c.id, approve, comment }); toast(approve ? 'Genehmigt.' : 'Abgelehnt.'); } catch (e) { errorToast(e); }
}

const teamState = { user: null };
export function timeTeamView() {
  const users = refOptions('users');
  teamState.user ||= users[0]?.value;
  const el = h('div', null, pageHead('Arbeitszeiten – Team', { back: '#/zeit', sub: 'Monatsübersichten, Korrekturen und Genehmigungen' }));
  el.append(correctionsCard(null, true));
  el.append(h('div', { class: 'toolbar', style: { marginTop: '16px' } }, h('select', { onchange: (e) => { teamState.user = e.target.value; refresh(); } }, users.map((o) => h('option', { value: o.value, selected: o.value === teamState.user }, o.label)))));
  const active = new Set(store.all('time_entries', (e) => e.kind === 'arbeit' && !e.end_at && !e.voided).map((e) => e.user_id));
  if (teamState.user) {
    el.append(h('div', { style: { marginBottom: '10px' } }, active.has(teamState.user) ? badge('derzeit eingestempelt', 'ok') : badge('nicht eingestempelt')));
    el.append(monthCard(teamState.user, true));
  }
  return el;
}

export { modal };
