// Interne Personalkostenrechnung (KEINE Lohnabrechnung).
// Alle Sätze stammen aus den vom Benutzer gepflegten Berechnungsmodellen
// (pay_rules) bzw. der Personalakte. Es werden keine gesetzlichen Werte angenommen.
import { RULE_KINDS, SCOPE_RANK, ABSENCE_RULES, sollMinutesForDay } from '../shared/hr.js';
import { monthRange, addDays, ymdOf, hmOf, weekday, berlinToIso } from '../shared/dates.js';

const r2 = (v) => Math.round(v * 100) / 100;
const parse = (s, d) => { try { return JSON.parse(s); } catch { return d; } };

/** Daten, die für alle Mitarbeiter eines Monats gleich sind */
export function monthContext(db, month) {
  const { start, end } = monthRange(month);
  return {
    month, start, end,
    holidays: new Set(db.all('SELECT date FROM holidays WHERE deleted = 0').map((r) => r.date)),
    rules: db.all(`SELECT * FROM pay_rules WHERE deleted = 0 AND active = 1 AND (valid_from IS NULL OR valid_from <= ?) AND (valid_to IS NULL OR valid_to >= ?)`, month, month)
      .map((r) => ({ ...r, p: parse(r.params, {}) })),
  };
}

/** Passende Regeln für einen Mitarbeiter: je (Art, Kategorie) gewinnt die speziellste, bei Gleichstand die höchste Priorität */
export function resolveRules(rules, emp) {
  const matches = (r) => {
    switch (r.scope_type) {
      case 'alle': return true;
      case 'abteilung': return r.scope_id === emp.department_id;
      case 'beschaeftigungsart': return r.scope_id === emp.employment_type_id;
      case 'position': return r.scope_id === emp.position_id;
      case 'mitarbeiter': return r.scope_id === emp.user_id;
      default: return false;
    }
  };
  const best = new Map();
  for (const r of rules) {
    if (r.scope_type === 'objekt' || !matches(r)) continue;
    const key = `${r.kind}|${r.kind === 'zeitzuschlag' ? r.category || 'sonstiges' : ''}`;
    const cur = best.get(key);
    const score = SCOPE_RANK[r.scope_type] * 1000 + (r.priority || 0);
    if (!cur || score > cur.score) best.set(key, { r, score });
  }
  const byKind = {};
  for (const { r } of best.values()) (byKind[r.kind] ||= []).push(r);
  byKind.objekt = rules.filter((r) => r.scope_type === 'objekt' && r.kind === 'objektverguetung');
  return byKind;
}

function inWindow(minuteOfDay, from, to) {
  if (!from || !to) return true;
  const a = +from.slice(0, 2) * 60 + +from.slice(3, 5);
  const b = +to.slice(0, 2) * 60 + +to.slice(3, 5);
  return a <= b ? minuteOfDay >= a && minuteOfDay < b : minuteOfDay >= a || minuteOfDay < b;
}

function roundMinutes(min, rule) {
  if (!rule) return min;
  const u = +rule.p.einheit || 1;
  const f = rule.p.modus === 'auf' ? Math.ceil : rule.p.modus === 'ab' ? Math.floor : Math.round;
  return f(min / u) * u;
}

/**
 * Berechnet einen Mitarbeiter für einen Monat.
 * Ergebnis: Stunden (Soll/Ist/Überstunden), Vergütungsbestandteile, Kosten, Verteilung auf Objekte, Hinweise.
 */
export function computeEmployeeMonth(db, userId, month, mctx = monthContext(db, month)) {
  const u = db.byId('users', userId);
  const profile = db.byId('employee_profiles', userId) || {};
  const emp = { ...profile, user_id: userId };
  const model = profile.work_model_id ? db.byId('work_models', profile.work_model_id) : null;
  const rules = resolveRules(mctx.rules, emp);
  const one = (k) => rules[k]?.[0] || null;
  const warnings = [];
  const sctx = { model, profile, entryDate: u.entry_date, exitDate: profile.exit_date, holidays: mctx.holidays };
  const from = berlinToIso(mctx.start, '00:00');
  const to = berlinToIso(addDays(mctx.end, 1), '00:00');

  // --- Zeiterfassung: Minuten je Tag (Berlin) inkl. Zuordnung zu Objekten und Uhrzeiten
  const entries = db.all(`SELECT * FROM time_entries WHERE user_id = ? AND deleted = 0 AND voided = 0 AND end_at IS NOT NULL AND start_at >= ? AND start_at < ? ORDER BY start_at`, userId, from, to);
  const pauseMin = new Set();
  const days = {}; // ymd → { work, pause, objects: {oid: min}, minutes: [{min, dayKey}] }
  const walk = (e, fn) => {
    let d = ymdOf(e.start_at); const hm = hmOf(e.start_at);
    let m = +hm.slice(0, 2) * 60 + +hm.slice(3, 5);
    const total = Math.round((Date.parse(e.end_at) - Date.parse(e.start_at)) / 6e4);
    for (let i = 0; i < total; i++) { fn(d, m); m++; if (m >= 1440) { m = 0; d = addDays(d, 1); } }
  };
  for (const e of entries.filter((x) => x.kind === 'pause')) walk(e, (d, m) => { pauseMin.add(`${d}|${m}`); (days[d] ||= { work: 0, pause: 0, objects: {}, mins: [] }).pause++; });
  for (const e of entries.filter((x) => x.kind === 'arbeit')) {
    walk(e, (d, m) => {
      const day = (days[d] ||= { work: 0, pause: 0, objects: {}, mins: [] });
      if (pauseMin.has(`${d}|${m}`)) return;
      day.work++;
      const oid = e.object_id || '';
      day.objects[oid] = (day.objects[oid] || 0) + 1;
      day.mins.push(m);
    });
  }
  const pauseRule = one('pausenregel'); const roundRule = one('rundung');
  let workedMin = 0; let autoPause = 0;
  const objMin = {}; const workDays = new Set(); const objDays = {};
  for (const [d, day] of Object.entries(days)) {
    if (d < mctx.start || d > mctx.end) continue;
    let net = day.work;
    if (pauseRule) {
      const steps = [[pauseRule.p.stufe2_ab, pauseRule.p.stufe2_pause], [pauseRule.p.stufe1_ab, pauseRule.p.stufe1_pause]].filter(([a, p]) => a !== undefined && a !== null && a !== '' && p);
      for (const [ab, pause] of steps) {
        if (day.work + day.pause > +ab * 60 && day.pause < +pause) { const diff = Math.min(+pause - day.pause, net); net -= diff; autoPause += diff; break; }
      }
    }
    net = Math.max(0, roundMinutes(net, roundRule));
    day.net = net;
    workedMin += net;
    if (net > 0) workDays.add(d);
    const raw = Object.values(day.objects).reduce((s, v) => s + v, 0) || 1;
    for (const [oid, v] of Object.entries(day.objects)) {
      objMin[oid] = (objMin[oid] || 0) + (net * v) / raw;
      if (oid) (objDays[oid] ||= new Set()).add(d);
    }
  }

  // --- Soll, Abwesenheiten
  const absences = db.all(`SELECT * FROM absences WHERE user_id = ? AND deleted = 0 AND status = 'genehmigt' AND start_date <= ? AND end_date >= ?`, userId, mctx.end, mctx.start);
  let sollMin = 0; let creditMin = 0; let paidAbsMin = 0; const absByKind = {};
  for (let d = mctx.start; d <= mctx.end; d = addDays(d, 1)) {
    let soll = sollMinutesForDay(d, sctx);
    const a = absences.find((x) => x.start_date <= d && x.end_date >= d);
    if (a && soll > 0) {
      const rule = ABSENCE_RULES[a.kind] || {};
      const part = a.half_day ? soll / 2 : soll;
      if (rule.reduceSoll) soll -= part;
      else if (rule.credit) { creditMin += part; if (a.paid) paidAbsMin += part; absByKind[a.kind] = (absByKind[a.kind] || 0) + part; }
      else if (a.paid) paidAbsMin += 0;
    }
    sollMin += soll;
  }
  const istMin = workedMin + creditMin;
  const overtimeMin = istMin - sollMin;

  // --- Grundvergütung
  const payType = profile.pay_type || 'keine';
  let hourly = profile.hourly_rate ?? one('stundenlohn')?.p.value ?? null;
  hourly = hourly !== null ? +hourly : null;
  const otRule = one('ueberstunden');
  const otThreshold = otRule?.p.ab_stunden ? +otRule.p.ab_stunden * 60 : 0;
  const otCountMin = Math.max(0, overtimeMin - otThreshold);
  const lines = [];
  let base = 0; let overtimePay = 0; let rate = hourly;
  if (payType === 'stunde') {
    if (hourly === null) warnings.push('Kein Stundenlohn hinterlegt (Personalakte oder Berechnungsmodell „Stundenlohn“).');
    else {
      let paidMin = workedMin + paidAbsMin;
      if (otRule?.p.behandlung === 'zeitkonto' && sollMin > 0) paidMin = Math.min(paidMin, sollMin + otThreshold);
      base = (paidMin / 60) * hourly;
      lines.push({ label: 'Grundvergütung (Stunden × Stundenlohn)', amount: r2(base), detail: `${r2(paidMin / 60)} Std. × ${hourly} €` });
      if (otRule?.p.behandlung === 'auszahlen' && otCountMin > 0 && otRule.p.value) {
        overtimePay = otRule.p.mode === 'betrag_stunde' ? (otCountMin / 60) * +otRule.p.value : (otCountMin / 60) * hourly * (+otRule.p.value / 100);
        lines.push({ label: 'Überstundenzuschlag', amount: r2(overtimePay), detail: `${r2(otCountMin / 60)} Std.` });
      }
    }
  } else if (payType === 'monat') {
    const salary = profile.monthly_salary ?? one('monatsgehalt')?.p.value ?? null;
    if (salary === null) warnings.push('Kein Monatsgehalt hinterlegt (Personalakte oder Berechnungsmodell „Monatsgehalt“).');
    else {
      // anteilig bei Ein-/Austritt im Monat (Kalendertage)
      const total = +mctx.end.slice(8, 10);
      let active = 0;
      for (let d = mctx.start; d <= mctx.end; d = addDays(d, 1)) if ((!u.entry_date || d >= u.entry_date) && (!profile.exit_date || d <= profile.exit_date)) active++;
      base = (+salary * active) / total;
      lines.push({ label: active < total ? `Monatsgehalt (anteilig ${active}/${total} Tage)` : 'Monatsgehalt', amount: r2(base) });
      rate = sollMin > 0 ? base / (sollMin / 60) : null;
      if (otRule?.p.behandlung === 'auszahlen' && otCountMin > 0) {
        if (!rate) warnings.push('Überstunden können ohne Soll-Stunden nicht bewertet werden (Arbeitszeitmodell fehlt).');
        else {
          const add = otRule.p.value ? (otRule.p.mode === 'betrag_stunde' ? +otRule.p.value : rate * (+otRule.p.value / 100)) : 0;
          overtimePay = (otCountMin / 60) * (rate + add);
          lines.push({ label: 'Überstunden (Auszahlung)', amount: r2(overtimePay), detail: `${r2(otCountMin / 60)} Std. × ${r2(rate + add)} €` });
        }
      }
    }
  } else if (workedMin > 0) warnings.push('Keine Vergütungsart in der Personalakte hinterlegt – Kosten können nicht berechnet werden.');

  // --- Zeitzuschläge (minutengenau)
  const surcharges = {};
  const zRules = rules.zeitzuschlag || [];
  if (zRules.length && rate) {
    for (const [d, day] of Object.entries(days)) {
      if (d < mctx.start || d > mctx.end || !day.net) continue;
      const wd = weekday(d); const hol = mctx.holidays.has(d);
      const factor = day.work ? day.net / day.work : 0; // Rundung/Pausenregel anteilig berücksichtigen
      for (const m of day.mins) {
        const applicable = zRules.filter((r) => (!r.p.weekdays?.length || r.p.weekdays.map(Number).includes(wd)) && (!r.p.nur_feiertage || hol) && inWindow(m, r.p.time_from, r.p.time_to));
        if (!applicable.length) continue;
        const val = (r) => (r.p.mode === 'betrag_stunde' ? +r.p.value / 60 : (rate * +r.p.value) / 100 / 60);
        const comb = applicable.filter((r) => r.p.kombinierbar !== 0 && r.p.kombinierbar !== false);
        const excl = applicable.filter((r) => !comb.includes(r)).sort((a, b) => val(b) - val(a)).slice(0, 1);
        for (const r of [...comb, ...excl]) {
          const s = (surcharges[r.id] ||= { label: r.name, minutes: 0, amount: 0 });
          s.minutes += factor; s.amount += val(r) * factor;
        }
      }
    }
  } else if (zRules.length && workedMin) warnings.push('Zeitzuschläge können ohne Stundensatz nicht berechnet werden.');
  const surchargeTotal = Object.values(surcharges).reduce((s, x) => s + x.amount, 0);
  for (const s of Object.values(surcharges)) lines.push({ label: s.label, amount: r2(s.amount), detail: `${r2(s.minutes / 60)} Std.` });

  // --- Objektbezogene Vergütung
  let objectPay = 0; const objectPayBy = {};
  for (const r of rules.objekt || []) {
    const mins = objMin[r.scope_id] || 0; const nDays = objDays[r.scope_id]?.size || 0;
    if (!mins) continue;
    let amt = 0;
    if (r.p.mode === 'zuschlag_stunde') amt = (mins / 60) * +r.p.value;
    else if (r.p.mode === 'pauschale_einsatz') amt = nDays * +r.p.value;
    else if (r.p.mode === 'stundensatz' && payType === 'stunde' && hourly !== null) amt = (mins / 60) * (+r.p.value - hourly);
    if (!amt) continue;
    objectPay += amt; objectPayBy[r.scope_id] = (objectPayBy[r.scope_id] || 0) + amt;
    lines.push({ label: `Objektvergütung: ${r.name}`, amount: r2(amt) });
  }

  // --- Fahrtkosten, Kilometer, Boni, Abzüge, Einmalbeträge
  let travel = 0;
  const ft = one('fahrtkosten');
  if (ft) { travel = ft.p.mode === 'monatlich' ? (workDays.size ? +ft.p.value : 0) : workDays.size * +ft.p.value; if (travel) lines.push({ label: 'Fahrtkosten-Pauschale', amount: r2(travel), detail: ft.p.mode === 'monatlich' ? 'monatlich' : `${workDays.size} Einsatztage` }); }
  const km = db.get('SELECT COALESCE(SUM(km),0) km FROM mileage_logs WHERE user_id = ? AND deleted = 0 AND date BETWEEN ? AND ?', userId, mctx.start, mctx.end).km;
  let mileage = 0;
  const kmRule = one('kilometer');
  if (km && kmRule) { mileage = km * +kmRule.p.value; lines.push({ label: 'Kilometerpauschale', amount: r2(mileage), detail: `${km} km × ${kmRule.p.value} €` }); }
  else if (km) warnings.push(`${km} km erfasst, aber kein Berechnungsmodell „Kilometerpauschale“ aktiv.`);
  let bonus = 0; let deduction = 0;
  for (const r of rules.bonus || []) { bonus += +r.p.value; lines.push({ label: r.name, amount: r2(+r.p.value) }); }
  for (const r of rules.abzug || []) { deduction += +r.p.value; lines.push({ label: r.name, amount: -r2(+r.p.value) }); }
  const adj = db.all('SELECT * FROM pay_adjustments WHERE user_id = ? AND month = ? AND deleted = 0', userId, month);
  const adjByObj = {};
  for (const a of adj) {
    const v = a.kind === 'abzug' ? -a.amount : a.amount;
    if (v >= 0) bonus += v; else deduction += -v;
    if (a.object_id) adjByObj[a.object_id] = (adjByObj[a.object_id] || 0) + v;
    lines.push({ label: `${a.kind === 'abzug' ? 'Abzug' : a.kind === 'zuschlag' ? 'Zuschlag' : 'Prämie'}: ${a.note || ''}`, amount: r2(v) });
  }

  const gross = base + overtimePay + surchargeTotal + objectPay + travel + mileage + bonus - deduction;
  const markupRule = one('kostenaufschlag');
  const markup = markupRule ? (gross * +markupRule.p.prozent) / 100 : 0;
  if (markup) lines.push({ label: `${markupRule.name} (${markupRule.p.prozent} %)`, amount: r2(markup) });
  const total = gross + markup;

  // --- Verteilung der Kosten auf Objekte (nach Stunden; Objektvergütung/Einmalbeträge direkt)
  const direct = objectPay + Object.values(adjByObj).reduce((s, v) => s + v, 0);
  const spread = total - direct * (1 + (markupRule ? +markupRule.p.prozent / 100 : 0));
  const perObject = {};
  const totalObjMin = Object.values(objMin).reduce((s, v) => s + v, 0);
  for (const [oid, mins] of Object.entries(objMin)) {
    const share = totalObjMin ? (spread * mins) / totalObjMin : 0;
    const d = ((objectPayBy[oid] || 0) + (adjByObj[oid] || 0)) * (1 + (markupRule ? +markupRule.p.prozent / 100 : 0));
    perObject[oid] = { minutes: Math.round(mins), cost: r2(share + d) };
  }
  if (!totalObjMin && spread) perObject[''] = { minutes: 0, cost: r2(spread) };

  return {
    user_id: userId, name: u.name, employee_no: u.employee_no, month, pay_type: payType,
    hours: {
      soll: r2(sollMin / 60), worked: r2(workedMin / 60), absence_credit: r2(creditMin / 60), ist: r2(istMin / 60),
      overtime: r2(overtimeMin / 60), auto_pause: r2(autoPause / 60), work_days: workDays.size, absences: Object.fromEntries(Object.entries(absByKind).map(([k, v]) => [k, r2(v / 60)])),
    },
    km,
    amounts: {
      base: r2(base), overtime: r2(overtimePay), surcharges: r2(surchargeTotal), object: r2(objectPay), travel: r2(travel + mileage),
      bonus: r2(bonus), deduction: r2(deduction), gross: r2(gross), markup: r2(markup), total: r2(total),
      per_hour: workedMin ? r2(total / (workedMin / 60)) : null, overtime_value: r2(Math.max(0, overtimeMin) / 60 * (rate || 0)),
    },
    lines, per_object: perObject, warnings, overtime_rule: otRule ? otRule.p.behandlung : null,
  };
}

/** Personalkosten aller Mitarbeiter + Objekte für einen Monat */
export function computeCosts(db, month) {
  const mctx = monthContext(db, month);
  const staff = db.all("SELECT id FROM users WHERE deleted = 0 AND role <> 'kunde' ORDER BY name");
  const employees = staff.map((s) => computeEmployeeMonth(db, s.id, month, mctx))
    .filter((e) => e.hours.worked || e.amounts.total || e.hours.soll);
  const objects = {};
  for (const e of employees) for (const [oid, v] of Object.entries(e.per_object)) {
    const o = (objects[oid] ||= { object_id: oid || null, minutes: 0, cost: 0 });
    o.minutes += v.minutes; o.cost = r2(o.cost + v.cost);
  }
  for (const o of Object.values(objects)) {
    if (!o.object_id) { o.name = 'Ohne Objektzuordnung'; continue; }
    const obj = db.byId('objects', o.object_id);
    o.name = obj?.name || 'Objekt'; o.object_no = obj?.object_no;
    const rev = db.get('SELECT amount FROM object_revenues WHERE object_id = ? AND month = ? AND deleted = 0', o.object_id, month);
    o.revenue = rev ? rev.amount : obj?.monthly_revenue ?? null;
    o.ratio = o.revenue ? r2((o.cost / o.revenue) * 100) : null;
    o.hours = r2(o.minutes / 60);
  }
  const sum = (f) => r2(employees.reduce((s, e) => s + f(e), 0));
  const hours = sum((e) => e.hours.worked);
  const totals = {
    total: sum((e) => e.amounts.total), gross: sum((e) => e.amounts.gross), hours, overtime_cost: sum((e) => e.amounts.overtime),
    surcharges: sum((e) => e.amounts.surcharges), overtime_hours: sum((e) => Math.max(0, e.hours.overtime)),
  };
  totals.per_hour = hours ? r2(totals.total / hours) : null;
  return { month, employees, objects: Object.values(objects).sort((a, b) => b.cost - a.cost), totals };
}

/** Überstunden-/Zeitkonto über ein Jahr (monatlich + manuelle Buchungen) */
export function timeAccount(db, userId, year) {
  const months = [];
  let balance = 0;
  const u = db.byId('users', userId);
  const nowMonth = new Date().toISOString().slice(0, 7);
  // Übertrag: alle Buchungen und Monate vor dem Jahr (ab Eintritt bzw. erstem Zeiteintrag)
  const first = db.get('SELECT MIN(start_at) s FROM time_entries WHERE user_id = ? AND deleted = 0', userId).s;
  let startMonth = [u.entry_date, first && ymdOf(first)].filter(Boolean).sort()[0]?.slice(0, 7) || `${year}-01`;
  for (let m = startMonth; m < `${year}-01`; m = nextMonth(m)) { const c = computeEmployeeMonth(db, userId, m); balance += c.hours.overtime * 60 - paidOutMin(c); }
  balance += db.get('SELECT COALESCE(SUM(minutes),0) m FROM overtime_adjustments WHERE user_id = ? AND deleted = 0 AND date < ?', userId, `${year}-01-01`).m;
  const carry = balance;
  for (let i = 1; i <= 12; i++) {
    const m = `${year}-${String(i).padStart(2, '0')}`;
    if (m > nowMonth) break;
    const c = computeEmployeeMonth(db, userId, m);
    const adj = db.get('SELECT COALESCE(SUM(minutes),0) m FROM overtime_adjustments WHERE user_id = ? AND deleted = 0 AND substr(date,1,7) = ?', userId, m).m;
    const paidOut = paidOutMin(c);
    balance += c.hours.overtime * 60 + adj - paidOut;
    months.push({ month: m, soll: c.hours.soll, ist: c.hours.ist, overtime: c.hours.overtime, adjustments: r2(adj / 60), paid_out: r2(paidOut / 60), balance: r2(balance / 60) });
  }
  return { year, carry_over: r2(carry / 60), months, balance: r2(balance / 60) };
}

/** Ausgezahlte Überstunden (Minuten) – sie werden nicht auf dem Zeitkonto gutgeschrieben */
function paidOutMin(c) {
  const paid = c.overtime_rule === 'auszahlen' || (c.pay_type === 'stunde' && c.overtime_rule !== 'zeitkonto');
  return paid ? Math.max(0, c.hours.overtime) * 60 : 0;
}

function nextMonth(m) { const [y, mo] = m.split('-').map(Number); return mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, '0')}`; }

export { RULE_KINDS };
