// Personalverwaltung: gemeinsame Definitionen für Server und Client.
// WICHTIG: Alle Beträge, Prozentsätze und Schwellen legt der Benutzer selbst fest.
// Es sind bewusst KEINE gesetzlichen Werte (Mindestlohn, Zuschlagsgrenzen,
// Pausenvorgaben, Sozialabgaben …) hinterlegt.

import { weekday, addDays } from './dates.js';

export const DISCLAIMER = 'Interne Personalkostenkalkulation – keine Lohnabrechnung. Steuern, Sozialversicherung und gesetzliche Vorgaben werden nicht berechnet; die rechtsverbindliche Abrechnung erfolgt über Lohnbüro bzw. Steuerberatung.';

/** Abwesenheiten: credit = zählt als geleistete Soll-Zeit; reduceSoll = verringert die Soll-Zeit */
export const ABSENCE_RULES = {
  urlaub: { credit: true, paidDefault: true, vacation: true },
  krank: { credit: true, paidDefault: true },
  kind_krank: { credit: true, paidDefault: false },
  sonderurlaub: { credit: true, paidDefault: true },
  unbezahlt: { credit: false, reduceSoll: true, paidDefault: false },
  schulung: { credit: true, paidDefault: true },
  ueberstundenabbau: { credit: false, paidDefault: true },
  sonstiges: { credit: true, paidDefault: false },
};

export const SCOPE_TYPES = {
  alle: 'Alle Mitarbeiter',
  abteilung: 'Abteilung',
  beschaeftigungsart: 'Beschäftigungsart',
  position: 'Position',
  mitarbeiter: 'Einzelner Mitarbeiter',
  objekt: 'Objekt',
};
/** Spezifität: der speziellste passende Eintrag gewinnt */
export const SCOPE_RANK = { alle: 1, abteilung: 2, beschaeftigungsart: 3, position: 4, mitarbeiter: 5, objekt: 6 };

const num = (name, label, extra = {}) => ({ name, label, type: 'number', ...extra });
const MODE_PCT_EUR = { name: 'mode', label: 'Zuschlagsart', type: 'select', required: true, options: [{ value: 'prozent', label: 'Prozent auf den Stundensatz' }, { value: 'betrag_stunde', label: 'Fester Betrag je Stunde (€)' }] };

/**
 * Berechnungsarten. params = Eingabefelder (werden in der Oberfläche angezeigt
 * und serverseitig geprüft). Keine Vorgabewerte für Beträge.
 */
export const RULE_KINDS = {
  stundenlohn: {
    label: 'Stundenlohn (Standard)', group: 'Grundvergütung',
    help: 'Stundensatz für Mitarbeiter ohne eigenen Stundenlohn in der Personalakte.',
    params: [num('value', 'Stundenlohn (€)', { required: true })],
  },
  monatsgehalt: {
    label: 'Monatsgehalt (Standard)', group: 'Grundvergütung',
    help: 'Monatsgehalt für Mitarbeiter mit Vergütungsart „Monatsgehalt“ ohne eigenen Betrag in der Personalakte.',
    params: [num('value', 'Monatsgehalt (€)', { required: true })],
  },
  ueberstunden: {
    label: 'Überstunden', group: 'Zeit & Zuschläge',
    help: 'Überstunden = Ist-Stunden über Soll-Stunden im Monat. Behandlung: Auszahlung oder Zeitkonto.',
    params: [
      { name: 'behandlung', label: 'Behandlung', type: 'select', required: true, options: [{ value: 'auszahlen', label: 'Auszahlen' }, { value: 'zeitkonto', label: 'Auf Zeitkonto buchen (nicht auszahlen)' }] },
      { ...MODE_PCT_EUR, required: false, help: 'Zuschlag nur bei Auszahlung' },
      num('value', 'Zuschlag (% bzw. €/Std.)'),
      num('ab_stunden', 'Erst ab … Überstunden im Monat zählen'),
    ],
  },
  zeitzuschlag: {
    label: 'Zeitzuschlag (Nacht, Sonntag, Feiertag …)', group: 'Zeit & Zuschläge',
    help: 'Zuschlag für Arbeitszeit in einem Zeitfenster, an Wochentagen oder an hinterlegten Feiertagen. Die Kategorie bestimmt, welche Regeln sich gegenseitig ersetzen (speziellste gewinnt); verschiedene Kategorien werden addiert.',
    categories: { nacht: 'Nachtzuschlag', sonntag: 'Sonntagszuschlag', feiertag: 'Feiertagszuschlag', samstag: 'Samstagszuschlag', sonstiges: 'Sonstiger Zeitzuschlag' },
    params: [
      MODE_PCT_EUR, num('value', 'Zuschlag (% bzw. €/Std.)', { required: true }),
      { name: 'weekdays', label: 'Wochentage (leer = alle)', type: 'weekdays' },
      { name: 'time_from', label: 'Uhrzeit von (leer = ganzer Tag)', type: 'time', half: true },
      { name: 'time_to', label: 'Uhrzeit bis', type: 'time', half: true },
      { name: 'nur_feiertage', label: 'Nur an hinterlegten Feiertagen', type: 'bool' },
      { name: 'kombinierbar', label: 'Mit anderen Zuschlägen kombinierbar', type: 'bool', default: 1, help: 'Nicht kombinierbare Zuschläge: pro Minute gilt nur der höchste davon.' },
    ],
  },
  fahrtkosten: {
    label: 'Fahrtkosten-Pauschale', group: 'Fahrt & Objekt',
    params: [{ name: 'mode', label: 'Berechnung', type: 'select', required: true, options: [{ value: 'pro_einsatztag', label: 'Je Einsatztag (€)' }, { value: 'monatlich', label: 'Monatlich (€)' }] }, num('value', 'Betrag (€)', { required: true })],
  },
  kilometer: {
    label: 'Kilometerpauschale', group: 'Fahrt & Objekt',
    help: 'Berechnet aus den erfassten Fahrten (Personalakte → Fahrten).',
    params: [num('value', 'Betrag je km (€)', { required: true })],
  },
  objektverguetung: {
    label: 'Objektbezogene Vergütung', group: 'Fahrt & Objekt',
    help: 'Gilt für die am gewählten Objekt geleisteten Stunden (Geltungsbereich „Objekt“).',
    params: [{ name: 'mode', label: 'Berechnung', type: 'select', required: true, options: [{ value: 'zuschlag_stunde', label: 'Zuschlag je Stunde (€)' }, { value: 'stundensatz', label: 'Eigener Stundensatz für dieses Objekt (€)' }, { value: 'pauschale_einsatz', label: 'Pauschale je Einsatztag (€)' }] }, num('value', 'Betrag (€)', { required: true })],
  },
  bonus: {
    label: 'Bonus / Prämie (monatlich)', group: 'Boni & Abzüge',
    help: 'Wiederkehrender Betrag je Monat. Einmalige Prämien in der Personalakte erfassen.',
    params: [num('value', 'Betrag je Monat (€)', { required: true })],
  },
  abzug: {
    label: 'Abzug (monatlich)', group: 'Boni & Abzüge',
    help: 'Wiederkehrender interner Abzug je Monat (z. B. Arbeitskleidung, Vorschuss).',
    params: [num('value', 'Betrag je Monat (€)', { required: true })],
  },
  pausenregel: {
    label: 'Pausenregelung', group: 'Zeitregeln',
    help: 'Wurde an einem Tag weniger Pause gestempelt als hier festgelegt, wird die Differenz von der Arbeitszeit abgezogen. Werte bitte selbst festlegen (z. B. nach Prüfung des Arbeitszeitgesetzes).',
    params: [num('stufe1_ab', 'Stufe 1: ab Arbeitszeit (Std.)', { half: true }), num('stufe1_pause', 'Stufe 1: Mindestpause (Min.)', { half: true }), num('stufe2_ab', 'Stufe 2: ab Arbeitszeit (Std.)', { half: true }), num('stufe2_pause', 'Stufe 2: Mindestpause (Min.)', { half: true })],
  },
  rundung: {
    label: 'Rundungsregel', group: 'Zeitregeln',
    help: 'Rundet die tägliche Netto-Arbeitszeit.',
    params: [num('einheit', 'Rundungseinheit (Minuten)', { required: true }), { name: 'modus', label: 'Rundungsart', type: 'select', required: true, options: [{ value: 'kaufmaennisch', label: 'Kaufmännisch' }, { value: 'auf', label: 'Aufrunden' }, { value: 'ab', label: 'Abrunden' }] }],
  },
  kostenaufschlag: {
    label: 'Arbeitgeberkosten-Aufschlag', group: 'Kosten',
    help: 'Eigener Schätzwert in % auf die Bruttovergütung (z. B. für Arbeitgeberanteile, Umlagen). Wird nur für die Kostenrechnung verwendet.',
    params: [num('prozent', 'Aufschlag (%)', { required: true })],
  },
};

/** Arbeitszeitmodell: Soll-Minuten je Wochentag (Index 0 = Montag … 6 = Sonntag) */
export function dayMinutes(model) {
  try { const a = JSON.parse(model?.day_minutes || '[]'); return Array.from({ length: 7 }, (_, i) => +a[i] || 0); } catch { return [0, 0, 0, 0, 0, 0, 0]; }
}

/** Soll-Minuten eines Tages (ymd) für ein Profil/Modell */
export function sollMinutesForDay(ymd, { model, profile, entryDate, exitDate, holidays }) {
  if (entryDate && ymd < entryDate) return 0;
  if (exitDate && ymd > exitDate) return 0;
  const wd = (weekday(ymd) + 6) % 7; // 0 = Montag
  let min;
  if (model) {
    min = dayMinutes(model)[wd];
    if (model.holidays_reduce && holidays?.has(ymd)) min = 0;
  } else if (profile?.weekly_hours) {
    min = wd < 5 ? Math.round((profile.weekly_hours * 60) / 5) : 0;
    if (holidays?.has(ymd)) min = 0;
  } else min = 0;
  return min;
}

/** Arbeitstage einer Abwesenheit (Tage mit Soll-Zeit > 0) */
export function absenceWorkdays(start, end, ctx, halfDay = false) {
  let days = 0;
  for (let d = start; d <= end; d = addDays(d, 1)) if (sollMinutesForDay(d, ctx) > 0) days++;
  if (halfDay && start === end) return days ? 0.5 : 0;
  return days;
}

export function validateRuleParams(kind, params) {
  const def = RULE_KINDS[kind];
  if (!def) return 'Unbekannte Berechnungsart.';
  for (const p of def.params) {
    const v = params?.[p.name];
    if (p.required && (v === undefined || v === null || v === '')) return `Bitte „${p.label}“ angeben.`;
    if (p.type === 'number' && v !== undefined && v !== null && v !== '') {
      if (!isFinite(+v)) return `„${p.label}“ muss eine Zahl sein.`;
      if (+v < 0) return `„${p.label}“ darf nicht negativ sein.`;
    }
    if (p.type === 'select' && v && !p.options.some((o) => o.value === v)) return `Ungültige Auswahl für „${p.label}“.`;
    if (p.type === 'time' && v && !/^\d{2}:\d{2}$/.test(v)) return `„${p.label}“ ist keine gültige Uhrzeit.`;
  }
  if (kind === 'rundung' && !(+params.einheit >= 1 && +params.einheit <= 60)) return 'Die Rundungseinheit muss zwischen 1 und 60 Minuten liegen.';
  if (kind === 'ueberstunden' && params.behandlung === 'auszahlen' && params.value && !params.mode) return 'Bitte die Berechnungsart des Überstundenzuschlags wählen.';
  return null;
}

export function fmtPersonnelNo(n) { return 'G-' + String(n).padStart(4, '0'); }
