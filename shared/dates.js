// Datums-Hilfen (Zeitzone Europe/Berlin, Format TT.MM.JJJJ).
import { TIMEZONE } from './constants.js';

const ymdFmt = new Intl.DateTimeFormat('sv-SE', { timeZone: TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit' });
const deDate = new Intl.DateTimeFormat('de-DE', { timeZone: TIMEZONE, day: '2-digit', month: '2-digit', year: 'numeric' });
const deTime = new Intl.DateTimeFormat('de-DE', { timeZone: TIMEZONE, hour: '2-digit', minute: '2-digit' });
const hmFmt = new Intl.DateTimeFormat('de-DE', { timeZone: TIMEZONE, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

/** Heutiges Datum in Berlin als YYYY-MM-DD */
export function todayYmd(d = new Date()) {
  return ymdFmt.format(d);
}

/** ISO-Zeitstempel → YYYY-MM-DD (Berlin) */
export function ymdOf(iso) {
  return iso ? ymdFmt.format(new Date(iso)) : '';
}

export function addDays(ymd, n) {
  const d = new Date(ymd + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function weekday(ymd) {
  return new Date(ymd + 'T12:00:00Z').getUTCDay();
}

export function daysBetween(a, b) {
  return Math.round((Date.parse(b + 'T12:00:00Z') - Date.parse(a + 'T12:00:00Z')) / 864e5);
}

/** YYYY-MM-DD oder ISO → TT.MM.JJJJ */
export function fmtDate(v) {
  if (!v) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) { const [y, m, d] = v.split('-'); return `${d}.${m}.${y}`; }
  const dt = new Date(v);
  return isNaN(dt) ? String(v) : deDate.format(dt);
}

export function fmtTime(iso) {
  if (!iso) return '';
  const dt = new Date(iso);
  return isNaN(dt) ? '' : deTime.format(dt);
}

export function fmtDateTime(iso) {
  if (!iso) return '';
  return `${fmtDate(iso)}, ${fmtTime(iso)} Uhr`;
}

/** Berlin-Uhrzeit HH:MM eines ISO-Zeitstempels */
export function hmOf(iso) {
  return iso ? hmFmt.format(new Date(iso)) : '';
}

/** Lokale Berlin-Eingabe (YYYY-MM-DD + HH:MM) → ISO UTC */
export function berlinToIso(ymd, hm = '00:00') {
  // Offset iterativ bestimmen (Sommer-/Winterzeit)
  const guess = Date.parse(`${ymd}T${hm}:00Z`);
  let ts = guess;
  for (let i = 0; i < 2; i++) {
    const shown = Date.parse(`${ymdFmt.format(new Date(ts))}T${hmFmt.format(new Date(ts))}:00Z`);
    ts += guess - shown;
  }
  return new Date(ts).toISOString();
}

export function fmtMinutes(min) {
  if (min == null || isNaN(min)) return '–';
  const m = Math.round(min);
  return `${Math.floor(m / 60)}:${String(Math.abs(m % 60)).padStart(2, '0')} h`;
}

export function monthRange(ym) {
  const [y, m] = ym.split('-').map(Number);
  const start = `${ym}-01`;
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { start, end: `${ym}-${String(last).padStart(2, '0')}` };
}

export const MONTHS = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];

export function fmtMonth(ym) {
  const [y, m] = ym.split('-').map(Number);
  return `${MONTHS[m - 1]} ${y}`;
}

/** Winterdienst-Saison, z. B. "2026/27" (Juli–Juni) */
export function seasonOf(iso) {
  const ymd = ymdOf(iso);
  const y = +ymd.slice(0, 4), m = +ymd.slice(5, 7);
  const start = m >= 7 ? y : y - 1;
  return `${start}/${String((start + 1) % 100).padStart(2, '0')}`;
}

export function fmtMoney(v) {
  if (v == null || v === '') return '';
  return new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(+v);
}

export function fmtNumber(v, digits = 2) {
  if (v == null || v === '') return '';
  return new Intl.NumberFormat('de-DE', { maximumFractionDigits: digits }).format(+v);
}
