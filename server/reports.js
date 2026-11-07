// Berichte (PDF), QR-Etiketten und Exporte (CSV).
import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import QRCode from 'qrcode';
import { AppError, uuid } from './db.js';
import { requirePerm, assertPerm } from './auth.js';
import { assertSee, canSee, selectScoped } from './scope.js';
import { createPdf, finalize, heading, keyValues, paragraph, table, images, signatureBlock, ensureSpace, pdfToBuffer, PDF_COLORS } from './pdf.js';
import {
  COMPANY, ORDER_STATUS, CHECK_RESULTS, PHOTO_CATEGORIES, QR_AREA_TYPES, QR_TARGET_TYPES, DEFECT_STATUS, DEFECT_KINDS,
  WINTER_WEATHER, WINTER_ACTIVITIES, can,
} from '../shared/constants.js';
import { fmtDate, fmtDateTime, fmtTime, fmtMinutes, fmtMonth, monthRange, fmtMoney, fmtNumber, berlinToIso, ymdOf, addDays, todayYmd } from '../shared/dates.js';

export function publicBaseUrl(db, req) {
  const configured = db.setting('public_url', '');
  if (configured) return configured.replace(/\/+$/, '');
  return `${req.protocol}://${req.get('host')}`;
}

export function reportsRouter({ db, dirs }) {
  const r = express.Router();
  const companyName = () => db.setting('company_name', COMPANY);
  const logoPath = () => { const f = db.setting('logo_file'); return f ? path.join(dirs.branding, f) : null; };
  const userName = (id) => (id && db.get('SELECT name FROM users WHERE id = ?', id)?.name) || '–';
  const photoPath = (p) => path.join(dirs.photos, p.file_name || '');
  const start = (title, subtitle) => createPdf({ title, subtitle, company: companyName(), logoPath: logoPath() });

  async function send(req, res, doc, fileName, link = {}) {
    finalize(doc);
    const buf = await pdfToBuffer(doc);
    if (req.query.save === '1') {
      assertPerm(req.user, 'documents.write');
      const file = `${uuid()}.pdf`;
      fs.writeFileSync(path.join(dirs.documents, file), buf);
      const row = db.tx(() => db.insert('documents', {
        title: fileName.replace(/\.pdf$/, ''), kind: link.kind || 'bericht', customer_id: link.customer_id || null, object_id: link.object_id || null,
        order_id: link.order_id || null, machine_id: link.machine_id || null, file_name: file, original_name: fileName, mime: 'application/pdf',
        size: buf.length, sha256: crypto.createHash('sha256').update(buf).digest('hex'), uploaded_by: req.user.id,
      }));
      db.audit(req.user.id, 'bericht.archiviert', 'documents', row.id, { titel: row.title });
      return res.json({ document: row });
    }
    db.audit(req.user.id, 'bericht.erstellt', null, null, { datei: fileName });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${fileName.replace(/[^\w.\-äöüÄÖÜß ]/g, '_')}"`);
    res.send(buf);
  }

  const orderTitle = (o) => {
    const obj = db.byId('objects', o.object_id);
    return `${o.order_no || 'Auftrag'} · ${obj?.name || ''}`;
  };

  // ---------- Reinigungsnachweis ----------
  r.get('/reports/order/:id', requirePerm('reports.create', 'orders.read'), async (req, res) => {
    assertSee(db, req.user, 'orders', req.params.id);
    const o = db.byId('orders', req.params.id);
    res.locals.pdf = await orderReport(o, req, res);
  });

  async function orderReport(o, req, res, portal = false) {
    const cust = db.byId('customers', o.customer_id);
    const obj = db.byId('objects', o.object_id);
    const svc = o.service_id ? db.byId('services', o.service_id) : null;
    const doc = start('Leistungsnachweis / Reinigungsnachweis', orderTitle(o));
    heading(doc, 'Auftrag');
    keyValues(doc, [
      ['Auftragsnummer', o.order_no], ['Status', ORDER_STATUS[o.status]],
      ['Kunde', `${cust?.company_name || ''} (${cust?.customer_no || ''})`], ['Objekt', `${obj?.name || ''} (${obj?.object_no || ''})`],
      ['Adresse', [obj?.street, [obj?.zip, obj?.city].filter(Boolean).join(' ')].filter(Boolean).join(', ')], ['Dienstleistung', svc?.name],
      ['Geplant', `${fmtDate(o.scheduled_date)}${o.scheduled_time ? ', ' + o.scheduled_time + ' Uhr' : ''}`], ['Geplante Dauer', o.planned_minutes ? fmtMinutes(o.planned_minutes) : ''],
      ['Mitarbeiter', userName(o.assigned_user_id)], ['Begonnen', fmtDateTime(o.started_at)],
      ['Abgeschlossen', fmtDateTime(o.completed_at)], ['Abgeschlossen von', o.completed_by ? userName(o.completed_by) : ''],
    ]);
    const items = db.all('SELECT * FROM order_checklist_items WHERE order_id = ? AND deleted = 0 ORDER BY position', o.id);
    heading(doc, 'Checkliste');
    const resColor = (it) => ({ erledigt: PDF_COLORS.green, mangel: PDF_COLORS.red, nicht_erledigt: PDF_COLORS.amber })[it.result] || PDF_COLORS.anthracite;
    table(doc, [
      { label: 'Nr.', width: 30, get: (it) => it.position + 1 },
      { label: 'Leistung', get: (it) => it.text + (it.required ? '' : ' (optional)') },
      { label: 'Ergebnis', width: 110, get: (it) => CHECK_RESULTS[it.result], color: resColor },
      { label: 'Kommentar', width: 150, get: (it) => it.comment || '' },
    ], items, { empty: 'Für diesen Auftrag ist keine Checkliste hinterlegt.' });
    const mins = db.get(`SELECT SUM((julianday(end_at) - julianday(start_at)) * 1440) m FROM time_entries WHERE order_id = ? AND kind = 'arbeit' AND voided = 0 AND deleted = 0 AND end_at IS NOT NULL`, o.id)?.m;
    if (mins) paragraph(doc, `Erfasste Arbeitszeit für diesen Auftrag: ${fmtMinutes(mins)}`, { size: 9, color: PDF_COLORS.grey });
    if (o.final_report) { heading(doc, 'Abschlussbericht'); paragraph(doc, o.final_report); }
    if (o.notes && !portal) { heading(doc, 'Bemerkungen'); paragraph(doc, o.notes); }
    const photos = db.all(`SELECT * FROM photos WHERE order_id = ? AND deleted = 0 ${portal ? 'AND customer_visible = 1' : ''} ORDER BY taken_at`, o.id);
    if (photos.length) {
      heading(doc, 'Fotodokumentation');
      images(doc, photos.map((p) => ({ path: photoPath(p), caption: `${PHOTO_CATEGORIES[p.category] || ''} · ${fmtDateTime(p.taken_at)}${p.comment ? '\n' + p.comment : ''}` })));
    }
    await send(req, res, doc, `Leistungsnachweis ${o.order_no || o.id}.pdf`, { kind: 'leistungsnachweis', customer_id: o.customer_id, object_id: o.object_id, order_id: o.id });
  }
  r.orderReport = orderReport;

  // ---------- Objektkontrollbericht ----------
  r.get('/reports/inspection/:id', requirePerm('quality.read'), async (req, res) => {
    const ins = db.byId('inspections', req.params.id);
    if (!ins || ins.deleted) throw new AppError(404, 'Kontrolle nicht gefunden.');
    await inspectionReport(ins, req, res);
  });

  async function inspectionReport(ins, req, res) {
    const obj = db.byId('objects', ins.object_id);
    const cust = db.byId('customers', obj.customer_id);
    const doc = start('Objektkontrollbericht', `${ins.inspection_no} · ${obj.name}`);
    heading(doc, 'Kontrolle');
    keyValues(doc, [
      ['Kontrollnummer', ins.inspection_no], ['Datum', fmtDateTime(ins.inspected_at)],
      ['Kunde', cust?.company_name], ['Objekt', `${obj.name} (${obj.object_no})`],
      ['Prüfer', userName(ins.inspector_id)], ['Ergebnis', ins.score != null ? `${fmtNumber(ins.score, 1)} % – ${ins.rating}` : 'ohne Bewertung'],
    ]);
    const items = db.all('SELECT * FROM inspection_items WHERE inspection_id = ? AND deleted = 0 ORDER BY position', ins.id);
    heading(doc, 'Prüfpunkte');
    table(doc, [
      { label: 'Prüfpunkt', get: (i) => i.text },
      { label: 'Bewertung (0–5)', width: 90, align: 'center', get: (i) => (i.rating == null ? 'n. b.' : i.rating) },
      { label: 'Kommentar', width: 180, get: (i) => i.comment || '' },
    ], items);
    if (ins.notes) { heading(doc, 'Anmerkungen'); paragraph(doc, ins.notes); }
    const defects = db.all('SELECT * FROM defects WHERE inspection_id = ? AND deleted = 0', ins.id);
    if (defects.length) {
      heading(doc, 'Festgestellte Mängel');
      table(doc, [
        { label: 'Nr.', width: 80, key: 'defect_no' }, { label: 'Mangel', key: 'title' },
        { label: 'Frist', width: 70, get: (d) => fmtDate(d.due_date) }, { label: 'Status', width: 80, get: (d) => DEFECT_STATUS[d.status] },
      ], defects);
    }
    const photos = db.all('SELECT * FROM photos WHERE inspection_id = ? AND deleted = 0', ins.id);
    if (photos.length) { heading(doc, 'Fotos'); images(doc, photos.map((p) => ({ path: photoPath(p), caption: p.comment || '' }))); }
    signatureBlock(doc, 'Prüfer', null, userName(ins.inspector_id));
    await send(req, res, doc, `Objektkontrolle ${ins.inspection_no}.pdf`, { kind: 'kontrollbericht', customer_id: obj.customer_id, object_id: obj.id });
  }
  r.inspectionReport = inspectionReport;

  // ---------- Monatsbericht ----------
  r.get('/reports/monthly', requirePerm('reports.create'), async (req, res) => {
    const month = /^\d{4}-\d{2}$/.test(req.query.month || '') ? req.query.month : todayYmd().slice(0, 7);
    const { start: from, end: to } = monthRange(month);
    let where = 'scheduled_date BETWEEN ? AND ? AND deleted = 0';
    const params = [from, to];
    let title = 'Monatsbericht';
    let link = {};
    if (req.query.object_id) {
      assertSee(db, req.user, 'objects', req.query.object_id);
      const obj = db.byId('objects', req.query.object_id);
      where += ' AND object_id = ?'; params.push(obj.id); title += ` – ${obj.name}`; link = { object_id: obj.id, customer_id: obj.customer_id };
    } else if (req.query.customer_id) {
      assertPerm(req.user, 'customers.read');
      const c = db.byId('customers', req.query.customer_id);
      if (!c) throw new AppError(404, 'Kunde nicht gefunden.');
      where += ' AND customer_id = ?'; params.push(c.id); title += ` – ${c.company_name}`; link = { customer_id: c.id };
    } else assertPerm(req.user, 'customers.read');
    const orders = db.all(`SELECT * FROM orders WHERE ${where} ORDER BY scheduled_date, scheduled_time`, ...params)
      .filter((o) => canSee(db, req.user, 'orders', o.id));
    const doc = start(title, fmtMonth(month));
    heading(doc, 'Zusammenfassung');
    const done = orders.filter((o) => o.completed_at);
    const defectsWhere = req.query.object_id ? 'object_id = ?' : req.query.customer_id ? 'customer_id = ?' : '1=1';
    const dParams = req.query.object_id ? [req.query.object_id] : req.query.customer_id ? [req.query.customer_id] : [];
    const defects = can(req.user, 'quality.read') ? db.all(`SELECT * FROM defects WHERE ${defectsWhere} AND deleted = 0 AND substr(reported_at,1,7) = ?`, ...dParams, month) : [];
    const inspWhere = req.query.object_id ? 'object_id = ?' : req.query.customer_id ? 'object_id IN (SELECT id FROM objects WHERE customer_id = ?)' : '1=1';
    const insp = can(req.user, 'quality.read') ? db.all(`SELECT * FROM inspections WHERE ${inspWhere} AND deleted = 0 AND substr(inspected_at,1,7) = ?`, ...dParams, month) : [];
    const scores = insp.filter((i) => i.score != null);
    keyValues(doc, [
      ['Zeitraum', `${fmtDate(from)} – ${fmtDate(to)}`], ['Geplante Einsätze', orders.length],
      ['Durchgeführt', done.length], ['Offen / nicht durchgeführt', orders.length - done.length],
      ['Mängel / Reklamationen im Monat', defects.length], ['Ø Qualitätsbewertung', scores.length ? fmtNumber(scores.reduce((s, i) => s + i.score, 0) / scores.length, 1) + ' %' : '–'],
    ]);
    heading(doc, 'Einsätze');
    table(doc, [
      { label: 'Datum', width: 62, get: (o) => fmtDate(o.scheduled_date) },
      { label: 'Auftrag', width: 82, key: 'order_no' },
      { label: 'Objekt', get: (o) => db.byId('objects', o.object_id)?.name },
      { label: 'Leistung', get: (o) => (o.service_id ? db.byId('services', o.service_id)?.name : '') },
      { label: 'Mitarbeiter', width: 90, get: (o) => userName(o.assigned_user_id) },
      { label: 'Status', width: 80, get: (o) => ORDER_STATUS[o.status] },
    ], orders);
    if (defects.length) {
      heading(doc, 'Mängel und Reklamationen');
      table(doc, [
        { label: 'Nr.', width: 80, key: 'defect_no' }, { label: 'Art', width: 70, get: (d) => DEFECT_KINDS[d.kind] },
        { label: 'Beschreibung', key: 'title' }, { label: 'Status', width: 80, get: (d) => DEFECT_STATUS[d.status] },
      ], defects);
    }
    await send(req, res, doc, `Monatsbericht ${month}${link.object_id ? ' ' + db.byId('objects', link.object_id).object_no : ''}.pdf`, { kind: 'monatsbericht', ...link });
  });

  // ---------- Fotodokumentation ----------
  r.get('/reports/photos', requirePerm('reports.create', 'photos.read'), async (req, res) => {
    let rows; let subtitle; let link = {};
    if (req.query.order_id) {
      assertSee(db, req.user, 'orders', req.query.order_id);
      const o = db.byId('orders', req.query.order_id);
      rows = selectScoped(db, req.user, 'photos', 'order_id = $oid AND deleted = 0', { oid: o.id });
      subtitle = orderTitle(o); link = { order_id: o.id, object_id: o.object_id, customer_id: o.customer_id };
    } else if (req.query.object_id) {
      assertSee(db, req.user, 'objects', req.query.object_id);
      const obj = db.byId('objects', req.query.object_id);
      const from = req.query.from || addDays(todayYmd(), -30); const to = req.query.to || todayYmd();
      rows = selectScoped(db, req.user, 'photos', `deleted = 0 AND (object_id = $oid OR order_id IN (SELECT id FROM orders WHERE object_id = $oid)) AND taken_at BETWEEN $f AND $t`,
        { oid: obj.id, f: berlinToIso(from, '00:00'), t: berlinToIso(addDays(to, 1), '00:00') });
      subtitle = `${obj.name} · ${fmtDate(from)} – ${fmtDate(to)}`; link = { object_id: obj.id, customer_id: obj.customer_id };
    } else throw new AppError(400, 'Bitte Auftrag oder Objekt angeben.');
    rows.sort((a, b) => a.taken_at.localeCompare(b.taken_at));
    const doc = start('Fotodokumentation', subtitle);
    for (const cat of Object.keys(PHOTO_CATEGORIES)) {
      const list = rows.filter((p) => p.category === cat);
      if (!list.length) continue;
      heading(doc, `${PHOTO_CATEGORIES[cat]} (${list.length})`);
      images(doc, list.map((p) => ({ path: photoPath(p), caption: `${fmtDateTime(p.taken_at)} · ${userName(p.user_id)}${p.comment ? '\n' + p.comment : ''}` })), { width: 240, height: 180 });
    }
    if (!rows.length) paragraph(doc, 'Keine Fotos im gewählten Zeitraum.');
    await send(req, res, doc, 'Fotodokumentation.pdf', { kind: 'fotodokumentation', ...link });
  });

  // ---------- Qualitätsbericht ----------
  r.get('/reports/quality', requirePerm('quality.read'), async (req, res) => {
    const from = req.query.from || addDays(todayYmd(), -90); const to = req.query.to || todayYmd();
    const objFilter = req.query.object_id ? 'AND object_id = ?' : '';
    const p = req.query.object_id ? [req.query.object_id] : [];
    const insp = db.all(`SELECT * FROM inspections WHERE deleted = 0 AND substr(inspected_at,1,10) BETWEEN ? AND ? ${objFilter} ORDER BY inspected_at`, from, to, ...p);
    const defects = db.all(`SELECT * FROM defects WHERE deleted = 0 AND (substr(reported_at,1,10) BETWEEN ? AND ? OR status IN ('offen','in_bearbeitung')) ${objFilter} ORDER BY reported_at`, from, to, ...p);
    const obj = req.query.object_id ? db.byId('objects', req.query.object_id) : null;
    const doc = start('Qualitätsbericht', `${obj ? obj.name + ' · ' : ''}${fmtDate(from)} – ${fmtDate(to)}`);
    const scores = insp.filter((i) => i.score != null);
    heading(doc, 'Kennzahlen');
    const overdue = defects.filter((d) => ['offen', 'in_bearbeitung'].includes(d.status) && d.due_date && d.due_date < todayYmd());
    keyValues(doc, [
      ['Kontrollen', insp.length], ['Ø Bewertung', scores.length ? fmtNumber(scores.reduce((s, i) => s + i.score, 0) / scores.length, 1) + ' %' : '–'],
      ['Mängel / Reklamationen', defects.length], ['Davon offen', defects.filter((d) => ['offen', 'in_bearbeitung'].includes(d.status)).length],
      ['Davon überfällig', overdue.length], ['Davon behoben/abgenommen', defects.filter((d) => ['behoben', 'abgenommen'].includes(d.status)).length],
    ]);
    heading(doc, 'Objektkontrollen');
    table(doc, [
      { label: 'Datum', width: 65, get: (i) => fmtDate(i.inspected_at) }, { label: 'Nr.', width: 80, key: 'inspection_no' },
      { label: 'Objekt', get: (i) => db.byId('objects', i.object_id)?.name }, { label: 'Prüfer', width: 90, get: (i) => userName(i.inspector_id) },
      { label: 'Ergebnis', width: 90, get: (i) => (i.score != null ? `${fmtNumber(i.score, 1)} % (${i.rating})` : '–') },
    ], insp);
    heading(doc, 'Mängel und Reklamationen');
    table(doc, [
      { label: 'Nr.', width: 75, key: 'defect_no' }, { label: 'Art', width: 60, get: (d) => DEFECT_KINDS[d.kind] },
      { label: 'Beschreibung', get: (d) => `${d.title}${d.measures ? '\nMaßnahmen: ' + d.measures : ''}${d.resolution_note ? '\nErledigung: ' + d.resolution_note : ''}` },
      { label: 'Verantwortlich', width: 80, get: (d) => userName(d.responsible_user_id) },
      { label: 'Frist', width: 58, get: (d) => fmtDate(d.due_date), color: (d) => (overdue.includes(d) ? PDF_COLORS.red : null) },
      { label: 'Status', width: 65, get: (d) => DEFECT_STATUS[d.status] },
    ], defects);
    await send(req, res, doc, `Qualitätsbericht ${from} bis ${to}.pdf`, { kind: 'qualitaetsbericht', object_id: obj?.id, customer_id: obj?.customer_id });
  });

  // ---------- Winterdienst ----------
  r.get('/reports/winter/:id', requirePerm('reports.create'), async (req, res) => {
    assertSee(db, req.user, 'winter_operations', req.params.id);
    const op = db.byId('winter_operations', req.params.id);
    const obj = db.byId('objects', op.object_id);
    const cust = db.byId('customers', obj.customer_id);
    const doc = start('Winterdienstprotokoll', `${op.operation_no} · ${obj.name}`);
    heading(doc, 'Einsatz');
    const mins = op.end_at ? (Date.parse(op.end_at) - Date.parse(op.start_at)) / 6e4 : null;
    keyValues(doc, [
      ['Einsatznummer', op.operation_no], ['Saison', op.season],
      ['Kunde', cust?.company_name], ['Objekt', `${obj.name} (${obj.object_no})`],
      ['Adresse', [obj.street, [obj.zip, obj.city].filter(Boolean).join(' ')].filter(Boolean).join(', ')], ['Mitarbeiter', userName(op.user_id)],
      ['Beginn', fmtDateTime(op.start_at)], ['Ende', fmtDateTime(op.end_at)],
      ['Dauer', mins != null ? fmtMinutes(mins) : ''], ['Wetter', WINTER_WEATHER[op.weather]],
      ['Temperatur', op.temperature != null ? `${fmtNumber(op.temperature, 1)} °C` : ''], ['Schneehöhe', op.snow_cm != null ? `${fmtNumber(op.snow_cm, 1)} cm` : ''],
      ['Tätigkeit', WINTER_ACTIVITIES[op.activity]], ['Streumittel', op.spreading_material],
      ['Streumenge', op.spreading_amount_kg != null ? `${fmtNumber(op.spreading_amount_kg, 1)} kg` : ''], ['Status', op.status === 'abgeschlossen' ? 'Abgeschlossen (unterschrieben)' : 'Offen'],
    ]);
    const areaIds = JSON.parse(op.area_ids || '[]');
    const areas = areaIds.length ? db.all(`SELECT * FROM winter_areas WHERE id IN (${areaIds.map(() => '?').join(',')})`, ...areaIds) : [];
    heading(doc, 'Bearbeitete Flächen (Räumleistung)');
    table(doc, [{ label: 'Fläche', key: 'name' }, { label: 'Art', width: 100, key: 'kind' }, { label: 'm²', width: 70, align: 'right', get: (a) => fmtNumber(a.area_sqm, 0) }], areas, { empty: 'Keine Flächen ausgewählt.' });
    const sum = areas.reduce((s, a) => s + (a.area_sqm || 0), 0);
    if (sum) paragraph(doc, `Gesamtfläche: ${fmtNumber(sum, 0)} m²`, { bold: true, size: 9 });
    if (op.notes) { heading(doc, 'Bemerkungen'); paragraph(doc, op.notes); }
    const photos = db.all('SELECT * FROM photos WHERE winter_operation_id = ? AND deleted = 0', op.id);
    if (photos.length) { heading(doc, 'Fotos'); images(doc, photos.map((p) => ({ path: photoPath(p), caption: fmtDateTime(p.taken_at) }))); }
    signatureBlock(doc, 'Unterschrift Mitarbeiter', op.signature, op.signed_at ? `${userName(op.user_id)}, ${fmtDateTime(op.signed_at)}` : 'nicht unterschrieben');
    await send(req, res, doc, `Winterdienstprotokoll ${op.operation_no}.pdf`, { kind: 'winterdienstprotokoll', object_id: obj.id, customer_id: obj.customer_id });
  });

  r.get('/reports/winter-season', requirePerm('winter.write'), async (req, res) => {
    const season = req.query.season || '';
    const objFilter = req.query.object_id ? 'AND object_id = ?' : '';
    const p = req.query.object_id ? [req.query.object_id] : [];
    const ops = db.all(`SELECT * FROM winter_operations WHERE deleted = 0 AND season = ? ${objFilter} ORDER BY start_at`, season, ...p);
    const obj = req.query.object_id ? db.byId('objects', req.query.object_id) : null;
    const doc = start('Winterdienst – Saisonübersicht', `Saison ${season}${obj ? ' · ' + obj.name : ''}`);
    const totalMin = ops.reduce((s, o) => s + (o.end_at ? (Date.parse(o.end_at) - Date.parse(o.start_at)) / 6e4 : 0), 0);
    heading(doc, 'Zusammenfassung');
    keyValues(doc, [
      ['Einsätze', ops.length], ['Gesamtdauer', fmtMinutes(totalMin)],
      ['Streumittel gesamt', fmtNumber(ops.reduce((s, o) => s + (o.spreading_amount_kg || 0), 0), 1) + ' kg'], ['Unterschrieben', ops.filter((o) => o.status === 'abgeschlossen').length],
    ]);
    heading(doc, 'Einsätze');
    table(doc, [
      { label: 'Datum', width: 85, get: (o) => `${fmtDate(o.start_at)} ${fmtTime(o.start_at)}` }, { label: 'Nr.', width: 80, key: 'operation_no' },
      { label: 'Objekt', get: (o) => db.byId('objects', o.object_id)?.name }, { label: 'Wetter', width: 70, get: (o) => WINTER_WEATHER[o.weather] || '' },
      { label: 'Tätigkeit', width: 85, get: (o) => WINTER_ACTIVITIES[o.activity] || '' },
      { label: 'Dauer', width: 45, get: (o) => (o.end_at ? fmtMinutes((Date.parse(o.end_at) - Date.parse(o.start_at)) / 6e4) : '') },
      { label: 'Streu kg', width: 45, align: 'right', get: (o) => fmtNumber(o.spreading_amount_kg, 1) },
    ], ops);
    await send(req, res, doc, `Winterdienst Saison ${season.replace('/', '-')}.pdf`, { kind: 'winterdienstprotokoll', object_id: obj?.id, customer_id: obj?.customer_id });
  });

  // ---------- Maschinenwartungsbericht ----------
  r.get('/reports/machine/:id', requirePerm('machines.read'), async (req, res) => {
    const m = db.byId('machines', req.params.id);
    if (!m || m.deleted) throw new AppError(404, 'Maschine nicht gefunden.');
    const events = db.all('SELECT * FROM machine_events WHERE machine_id = ? AND deleted = 0 ORDER BY event_date DESC', m.id);
    const doc = start('Maschinenwartungsbericht', `${m.inventory_no} · ${m.name}`);
    heading(doc, 'Maschinenakte');
    keyValues(doc, [
      ['Inventarnummer', m.inventory_no], ['Bezeichnung', m.name], ['Hersteller', m.manufacturer], ['Modell', m.model],
      ['Seriennummer', m.serial_no], ['Kaufdatum', fmtDate(m.purchase_date)], ['Kaufpreis', fmtMoney(m.purchase_price)],
      ['Zustand', m.condition], ['Standort', m.location], ['Verantwortlich', userName(m.responsible_user_id)],
      ['Wartungsintervall', m.maintenance_interval_days ? `${m.maintenance_interval_days} Tage` : ''], ['Nächste Wartung', fmtDate(m.next_maintenance)],
    ]);
    heading(doc, 'Wartungen, Prüfungen, Reparaturen und Defekte');
    const kinds = { wartung: 'Wartung', reparatur: 'Reparatur', defekt: 'Defekt', pruefung: 'Prüfung' };
    table(doc, [
      { label: 'Datum', width: 65, get: (e) => fmtDate(e.event_date) }, { label: 'Art', width: 65, get: (e) => kinds[e.kind] },
      { label: 'Beschreibung', key: 'description' }, { label: 'Durchgeführt von', width: 95, get: (e) => e.performed_by || userName(e.user_id) },
      { label: 'Kosten', width: 60, align: 'right', get: (e) => fmtMoney(e.cost) }, { label: 'Status', width: 55, key: 'status' },
    ], events);
    const total = events.reduce((s, e) => s + (e.cost || 0), 0);
    if (total) paragraph(doc, `Summe Kosten: ${fmtMoney(total)}`, { bold: true, size: 9 });
    await send(req, res, doc, `Wartungsbericht ${m.inventory_no}.pdf`, { kind: 'wartungsprotokoll', machine_id: m.id });
  });

  // ---------- Arbeitszeit ----------
  function timeData(req) {
    const month = /^\d{4}-\d{2}$/.test(req.query.month || '') ? req.query.month : todayYmd().slice(0, 7);
    const userId = req.query.user_id || req.user.id;
    if (userId !== req.user.id) assertPerm(req.user, 'time.all'); else assertPerm(req.user, 'time.own');
    const u = db.byId('users', userId);
    if (!u) throw new AppError(404, 'Mitarbeiter nicht gefunden.');
    const { start: from, end: to } = monthRange(month);
    const entries = db.all(`SELECT * FROM time_entries WHERE user_id = ? AND deleted = 0 AND start_at >= ? AND start_at < ? ORDER BY start_at`,
      userId, berlinToIso(from, '00:00'), berlinToIso(addDays(to, 1), '00:00'));
    const valid = entries.filter((e) => !e.voided);
    const dur = (e) => (e.end_at ? (Date.parse(e.end_at) - Date.parse(e.start_at)) / 6e4 : 0);
    const days = {};
    for (const e of valid) {
      const d = ymdOf(e.start_at);
      days[d] ||= { date: d, work: 0, pause: 0, first: e.start_at, last: e.end_at, objects: new Set() };
      if (e.kind === 'arbeit') { days[d].work += dur(e); if (e.object_id) days[d].objects.add(db.byId('objects', e.object_id)?.name); }
      else days[d].pause += dur(e);
      if (e.end_at && (!days[d].last || e.end_at > days[d].last)) days[d].last = e.end_at;
    }
    const corrections = db.all(`SELECT c.* FROM time_corrections c JOIN time_entries t ON t.id = c.entry_id WHERE t.user_id = ? AND t.start_at >= ? AND t.start_at < ? AND c.deleted = 0 ORDER BY c.requested_at`,
      userId, berlinToIso(from, '00:00'), berlinToIso(addDays(to, 1), '00:00'));
    return { month, u, entries, valid, days: Object.values(days), corrections, dur };
  }

  r.get('/reports/time', requirePerm('time.own', 'time.all'), async (req, res) => {
    const { month, u, days, corrections } = timeData(req);
    const doc = start('Arbeitszeitnachweis', `${u.name} (${u.employee_no || ''}) · ${fmtMonth(month)}`);
    const net = days.reduce((s, d) => s + d.work - d.pause, 0);
    heading(doc, 'Übersicht');
    keyValues(doc, [['Mitarbeiter', u.name], ['Monat', fmtMonth(month)], ['Arbeitstage', days.length], ['Netto-Arbeitszeit', fmtMinutes(net)]]);
    heading(doc, 'Tage');
    table(doc, [
      { label: 'Datum', width: 65, get: (d) => fmtDate(d.date) }, { label: 'Beginn', width: 45, get: (d) => fmtTime(d.first) },
      { label: 'Ende', width: 45, get: (d) => fmtTime(d.last) }, { label: 'Brutto', width: 50, get: (d) => fmtMinutes(d.work) },
      { label: 'Pause', width: 50, get: (d) => fmtMinutes(d.pause) }, { label: 'Netto', width: 50, get: (d) => fmtMinutes(d.work - d.pause) },
      { label: 'Objekte', get: (d) => [...d.objects].filter(Boolean).join(', ') },
    ], days);
    heading(doc, 'Korrekturprotokoll');
    table(doc, [
      { label: 'Beantragt', width: 80, get: (c) => fmtDateTime(c.requested_at) }, { label: 'Von', width: 70, get: (c) => userName(c.requested_by) },
      { label: 'Ursprünglich', width: 95, get: (c) => (c.old_start_at ? `${fmtTime(c.old_start_at)}–${fmtTime(c.old_end_at)}` : 'Nachtrag') },
      { label: 'Neu', width: 75, get: (c) => (c.new_voided ? 'storniert' : `${fmtTime(c.new_start_at)}–${fmtTime(c.new_end_at)}`) },
      { label: 'Begründung', key: 'reason' },
      { label: 'Status', width: 85, get: (c) => `${c.status}${c.decided_by ? ' (' + userName(c.decided_by) + ')' : ''}` },
    ], corrections, { empty: 'Keine Korrekturen in diesem Monat.' });
    signatureBlock(doc, 'Unterschrift Mitarbeiter', null, '');
    await send(req, res, doc, `Arbeitszeit ${u.name} ${month}.pdf`, { kind: 'arbeitszeitnachweis' });
  });

  r.get('/export/time.csv', requirePerm('time.own', 'time.all'), (req, res) => {
    const { month, u, entries, dur } = timeData(req);
    const rows = [['Mitarbeiter', 'Datum', 'Art', 'Beginn', 'Ende', 'Dauer (Min.)', 'Objekt', 'Auftrag', 'Quelle', 'Storniert', 'Notiz']];
    for (const e of entries) {
      rows.push([u.name, fmtDate(e.start_at), e.kind, fmtTime(e.start_at), fmtTime(e.end_at), Math.round(dur(e)),
        e.object_id ? db.byId('objects', e.object_id)?.name : '', e.order_id ? db.byId('orders', e.order_id)?.order_no : '', e.source, e.voided ? 'ja' : 'nein', e.note || '']);
    }
    db.audit(req.user.id, 'export.zeit', 'users', u.id, { monat: month });
    sendCsv(res, `Arbeitszeit_${u.name}_${month}.csv`, rows);
  });

  r.get('/export/:what.csv', (req, res) => {
    const map = {
      customers: { perm: 'customers.read', sql: 'SELECT customer_no, company_name, customer_type, contact_person, phone, email, billing_street, billing_zip, billing_city, contract_status FROM customers WHERE deleted = 0 ORDER BY customer_no' },
      objects: { perm: 'objects.write', sql: 'SELECT o.object_no, o.name, c.company_name AS kunde, o.street, o.zip, o.city, o.object_type, o.area_sqm, o.floors, o.rooms FROM objects o JOIN customers c ON c.id = o.customer_id WHERE o.deleted = 0 ORDER BY o.object_no' },
      materials: { perm: 'materials.read', sql: 'SELECT article_no, barcode, name, category, unit, stock, min_stock, purchase_price, supplier, location FROM materials WHERE deleted = 0 ORDER BY article_no' },
      stock_movements: { perm: 'materials.write', sql: 'SELECT s.moved_at, m.article_no, m.name, s.kind, s.qty, s.note, u.name AS mitarbeiter FROM stock_movements s JOIN materials m ON m.id = s.material_id LEFT JOIN users u ON u.id = s.user_id WHERE s.deleted = 0 ORDER BY s.moved_at DESC' },
      machines: { perm: 'machines.read', sql: 'SELECT inventory_no, name, manufacturer, model, serial_no, purchase_date, purchase_price, condition, location, next_maintenance FROM machines WHERE deleted = 0 ORDER BY inventory_no' },
      defects: { perm: 'quality.read', sql: 'SELECT defect_no, kind, title, status, reported_at, due_date, resolved_at FROM defects WHERE deleted = 0 ORDER BY reported_at DESC' },
      scans: { perm: 'qr.manage', sql: "SELECT s.scanned_at, q.label, s.raw, s.method, s.result, u.name AS mitarbeiter FROM scans s LEFT JOIN qr_codes q ON q.id = s.qr_code_id LEFT JOIN users u ON u.id = s.user_id ORDER BY s.scanned_at DESC LIMIT 5000" },
    };
    const def = map[req.params.what];
    if (!def) throw new AppError(404, 'Unbekannter Export.');
    assertPerm(req.user, def.perm);
    const data = db.all(def.sql);
    const head = data.length ? Object.keys(data[0]) : ['keine_daten'];
    db.audit(req.user.id, 'export.' + req.params.what);
    sendCsv(res, `${req.params.what}_${todayYmd()}.csv`, [head, ...data.map((r) => head.map((h) => r[h]))]);
  });

  // ---------- QR-Codes ----------
  function qrForUser(req) {
    const qr = db.byId('qr_codes', req.params.id);
    if (!qr || qr.deleted) throw new AppError(404, 'QR-Code nicht gefunden.');
    if (!can(req.user, 'qr.manage') && !canSee(db, req.user, 'qr_codes', qr.id)) throw new AppError(404, 'QR-Code nicht gefunden.');
    return qr;
  }
  const qrUrl = (req, qr) => `${publicBaseUrl(db, req)}/q/${qr.token}`;

  r.get('/qr/:id.svg', requirePerm('qr.scan', 'qr.manage'), async (req, res) => {
    const qr = qrForUser(req);
    res.type('image/svg+xml').send(await QRCode.toString(qrUrl(req, qr), { type: 'svg', errorCorrectionLevel: 'M', margin: 2 }));
  });
  r.get('/qr/:id.png', requirePerm('qr.manage'), async (req, res) => {
    const qr = qrForUser(req);
    res.type('image/png');
    res.setHeader('Content-Disposition', `attachment; filename="${qr.label}.png"`);
    res.send(await QRCode.toBuffer(qrUrl(req, qr), { errorCorrectionLevel: 'M', margin: 2, width: 1024 }));
  });

  r.get('/qr-labels.pdf', requirePerm('qr.manage'), async (req, res) => {
    const ids = String(req.query.ids || '').split(',').filter(Boolean).slice(0, 200);
    if (!ids.length) throw new AppError(400, 'Keine QR-Codes ausgewählt.');
    const list = ids.map((id) => db.byId('qr_codes', id)).filter((q) => q && !q.deleted);
    const big = req.query.size === 'gross';
    const doc = createPdf({ title: 'QR-Code-Etiketten', subtitle: `${list.length} Etikett(en)`, company: companyName(), logoPath: logoPath() });
    const describe = (q) => {
      if (q.target_type === 'object' || q.target_type === 'area') {
        const o = db.byId('objects', q.object_id);
        return [o?.object_no || '', q.target_type === 'area' ? `${QR_AREA_TYPES[q.area_type] || ''}${q.area_name && q.area_name !== QR_AREA_TYPES[q.area_type] ? ': ' + q.area_name : ''}` : 'Objekt'];
      }
      if (q.target_type === 'machine') { const m = db.byId('machines', q.machine_id); return [m?.inventory_no || '', m?.name || 'Maschine']; }
      const m = db.byId('materials', q.material_id); return [m?.article_no || '', m?.name || 'Inventar'];
    };
    const cols = big ? 1 : 3; const rowsPer = big ? 1 : 4;
    const cellW = (doc.page.width - 100) / cols; const cellH = big ? 600 : 165;
    let i = 0;
    for (const q of list) {
      const pos = i % (cols * rowsPer);
      if (i > 0 && pos === 0) doc.addPage();
      const x = 50 + (pos % cols) * cellW; const y = 95 + Math.floor(pos / cols) * cellH;
      const size = big ? 330 : 110;
      const png = await QRCode.toBuffer(qrUrl(req, q), { errorCorrectionLevel: 'M', margin: 1, width: big ? 1200 : 600 });
      doc.save().roundedRect(x + 4, y, cellW - 8, cellH - 10, 6).lineWidth(0.6).dash(3, { space: 3 }).strokeColor('#B8BDC2').stroke().undash().restore();
      doc.image(png, x + (cellW - size) / 2, y + 10, { width: size });
      const [nr, desc] = describe(q);
      const ty = y + 14 + size;
      doc.font('Helvetica-Bold').fontSize(big ? 22 : 9).fillColor(PDF_COLORS.anthracite).text(nr, x + 8, ty, { width: cellW - 16, align: 'center' });
      doc.font('Helvetica').fontSize(big ? 16 : 8).fillColor(PDF_COLORS.anthracite).text(desc, x + 8, doc.y + 1, { width: cellW - 16, align: 'center', height: big ? 60 : 20, ellipsis: true });
      doc.font('Helvetica').fontSize(big ? 11 : 6.5).fillColor(PDF_COLORS.grey).text(`${q.label} · ${companyName()}`, x + 8, doc.y + 2, { width: cellW - 16, align: 'center' });
      i++;
    }
    db.audit(req.user.id, 'qr.gedruckt', 'qr_codes', null, { anzahl: list.length });
    finalize(doc);
    const buf = await pdfToBuffer(doc);
    res.type('application/pdf').setHeader('Content-Disposition', 'inline; filename="QR-Etiketten.pdf"');
    res.send(buf);
  });

  return r;
}

function sendCsv(res, name, rows) {
  const esc = (v) => {
    if (v == null) return '';
    let s = String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; // CSV-Injection verhindern
    return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  // Semikolon + BOM: öffnet korrekt in deutschem Excel
  const csv = '﻿' + rows.map((r) => r.map(esc).join(';')).join('\r\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${name.replace(/[^\w.\-äöüÄÖÜß]/g, '_')}"`);
  res.send(csv);
}

export { sendCsv };
