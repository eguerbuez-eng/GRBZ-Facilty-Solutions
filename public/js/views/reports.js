import { h, ic, card, pageHead, btn, toast, errorToast, buildForm, openUrl } from '../ui.js';
import * as store from '../store.js';
import { api } from '../api.js';
import { may, refOptions, user } from './common.js';
import { todayYmd, addDays, seasonOf } from '/shared/dates.js';

function reportCard(title, desc, iconName, fields, buildUrl, { perm, saveable = true } = {}) {
  if (perm && !may(perm)) return null;
  const f = buildForm(fields, {});
  const run = async (save) => {
    if (!f.check()) return;
    const url = buildUrl(f.values());
    if (!url) return;
    if (!navigator.onLine) return toast('Berichte werden auf dem Server erstellt – bitte mit dem Internet verbinden.', 'warn');
    if (!save) return openUrl(url);
    try {
      const r = await api('GET', url + (url.includes('?') ? '&' : '?') + 'save=1');
      await store.pull().catch(() => {});
      toast(`Als Dokument „${r.document.title}“ abgelegt.`);
    } catch (e) { errorToast(e); }
  };
  return card(title, h('div', { class: 'card-pad' }, h('p', { class: 'small muted', style: { marginTop: 0 } }, desc), f.el,
    h('div', { class: 'form-actions' }, saveable && may('documents.write') ? btn('Als Dokument ablegen', { icon: 'archive', onclick: () => run(true) }) : null, btn('PDF öffnen', { icon: 'print', cls: 'primary', onclick: () => run(false) }))), { iconName });
}

export function reportsView() {
  const month = todayYmd().slice(0, 7);
  const objs = refOptions('objects');
  const el = h('div', null, pageHead('Berichte & Exporte', { sub: 'Professionelle PDF-Berichte mit GRBZ-Branding sowie CSV-Exporte' }));
  const grid = h('div', { class: 'grid two' });
  const cards = [
    reportCard('Reinigungsnachweis / Leistungsnachweis', 'Für einen einzelnen Auftrag inkl. Checkliste, Fotos und Abschlussbericht. Direkt auch in jedem Auftrag abrufbar.', 'checkCircle',
      [{ name: 'order_id', label: 'Auftrag (abgeschlossen)', type: 'ref', required: true, refOptions: store.all('orders', (o) => o.completed_at).sort((a, b) => b.completed_at.localeCompare(a.completed_at)).slice(0, 200).map((o) => ({ value: o.id, label: `${o.order_no || ''} · ${store.get('objects', o.object_id)?.name || ''} · ${o.scheduled_date.split('-').reverse().join('.')}` })) }],
      (v) => `/api/reports/order/${v.order_id}`),
    reportCard('Monatsbericht', 'Alle Einsätze eines Monats für einen Kunden oder ein Objekt mit Mängeln und Qualitätskennzahlen.', 'calendar', [
      { name: 'month', label: 'Monat (JJJJ-MM)', type: 'text', required: true, default: month, placeholder: 'z. B. 2026-11', half: true },
      { name: 'customer_id', label: 'Kunde', type: 'ref', refOptions: refOptions('customers'), half: true },
      { name: 'object_id', label: 'oder Objekt', type: 'ref', refOptions: objs },
    ], (v) => { if (!/^\d{4}-\d{2}$/.test(v.month)) { toast('Monat bitte als JJJJ-MM angeben.', 'bad'); return null; } return `/api/reports/monthly?month=${v.month}${v.object_id ? '&object_id=' + v.object_id : v.customer_id ? '&customer_id=' + v.customer_id : ''}`; }, { perm: 'customers.read' }),
    reportCard('Fotodokumentation', 'Fotos eines Objekts im Zeitraum, gruppiert nach Vorher/Nachher/Schaden/Mangel.', 'camera', [
      { name: 'object_id', label: 'Objekt', type: 'ref', required: true, refOptions: objs },
      { name: 'from', label: 'Von', type: 'date', default: addDays(todayYmd(), -30), half: true }, { name: 'to', label: 'Bis', type: 'date', default: 'today', half: true },
    ], (v) => `/api/reports/photos?object_id=${v.object_id}&from=${v.from}&to=${v.to}`, { perm: 'photos.read' }),
    reportCard('Qualitätsbericht', 'Objektkontrollen, Bewertungen, Mängel, Fristen und Maßnahmen.', 'shield', [
      { name: 'object_id', label: 'Objekt (optional)', type: 'ref', refOptions: objs },
      { name: 'from', label: 'Von', type: 'date', default: addDays(todayYmd(), -90), half: true }, { name: 'to', label: 'Bis', type: 'date', default: 'today', half: true },
    ], (v) => `/api/reports/quality?from=${v.from}&to=${v.to}${v.object_id ? '&object_id=' + v.object_id : ''}`, { perm: 'quality.read' }),
    reportCard('Winterdienst – Saisonübersicht', 'Alle Einsätze einer Saison, optional je Objekt. Einzelprotokolle im jeweiligen Einsatz.', 'snow', [
      { name: 'season', label: 'Saison', type: 'text', required: true, default: seasonOf(new Date().toISOString()), half: true },
      { name: 'object_id', label: 'Objekt (optional)', type: 'ref', refOptions: objs, half: true },
    ], (v) => `/api/reports/winter-season?season=${encodeURIComponent(v.season)}${v.object_id ? '&object_id=' + v.object_id : ''}`, { perm: 'winter.write' }),
    reportCard('Maschinenwartungsbericht', 'Maschinenakte mit allen Wartungen, Prüfungen, Reparaturen und Kosten.', 'wrench', [
      { name: 'machine_id', label: 'Maschine', type: 'ref', required: true, refOptions: refOptions('machines') },
    ], (v) => `/api/reports/machine/${v.machine_id}`, { perm: 'machines.read' }),
    reportCard('Arbeitszeitnachweis', 'Monatliche Arbeitszeit mit Pausen und Korrekturprotokoll.', 'clock', [
      { name: 'month', label: 'Monat (JJJJ-MM)', type: 'text', required: true, default: month, half: true },
      may('time.all') ? { name: 'user_id', label: 'Mitarbeiter', type: 'ref', refOptions: refOptions('users'), half: true } : null,
    ].filter(Boolean), (v) => `/api/reports/time?month=${v.month}${v.user_id ? '&user_id=' + v.user_id : ''}`, { perm: 'time.own', saveable: false }),
  ].filter(Boolean);
  grid.append(...cards);
  el.append(grid);
  const exports = [
    ['customers', 'Kunden', 'customers.read'], ['objects', 'Objekte', 'objects.write'], ['materials', 'Material & Bestand', 'materials.read'],
    ['stock_movements', 'Bestandsbewegungen', 'materials.write'], ['machines', 'Maschinen', 'machines.read'], ['defects', 'Mängel', 'quality.read'], ['scans', 'Scan-Historie', 'qr.manage'],
  ].filter(([, , p]) => may(p));
  if (exports.length) el.append(card('CSV-Exporte (Excel-kompatibel)', h('div', { class: 'card-pad btn-row' }, exports.map(([k, l]) => h('a', { class: 'btn', href: `/api/export/${k}.csv` }, ic('download'), l))), { iconName: 'download' }));
  return el;
}

export { user };
