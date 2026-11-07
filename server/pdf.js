// PDF-Erstellung mit GRBZ-Branding (pdfkit, Standardschrift Helvetica – enthält ä, ö, ü, ß, €).
import PDFDocument from 'pdfkit';
import fs from 'node:fs';
import { fmtDateTime } from '../shared/dates.js';

const C = { anthracite: '#2B2F33', grey: '#6B7178', light: '#E6E8EA', faint: '#F4F5F6', accent: '#0E7C7B', red: '#B42318', amber: '#B54708', green: '#067647' };

export function createPdf({ title, subtitle, company, logoPath, author }) {
  const doc = new PDFDocument({ size: 'A4', margins: { top: 90, bottom: 60, left: 50, right: 50 }, bufferPages: true, info: { Title: title, Author: author || company, Creator: 'GRBZ Facility Management System' } });
  doc._grbz = { title, subtitle, company, logoPath };
  drawHeader(doc);
  doc.on('pageAdded', () => drawHeader(doc));
  doc.font('Helvetica');
  return doc;
}

function drawHeader(doc) {
  const { title, subtitle, company, logoPath } = doc._grbz;
  const y0 = doc.y;
  doc.save();
  doc.rect(0, 0, doc.page.width, 6).fill(C.accent);
  let x = 50;
  let logoDrawn = false;
  if (logoPath && fs.existsSync(logoPath)) {
    try { doc.image(logoPath, 50, 24, { fit: [110, 40] }); logoDrawn = true; x = 170; } catch { /* ungültiges Logo ignorieren */ }
  }
  if (!logoDrawn) {
    doc.rect(50, 26, 36, 36).fill(C.anthracite);
    doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(11).text('GRBZ', 50, 39, { width: 36, align: 'center' });
    x = 96;
  }
  doc.fillColor(C.anthracite).font('Helvetica-Bold').fontSize(13).text(title, x, 28, { width: 330 });
  doc.fillColor(C.grey).font('Helvetica').fontSize(8.5).text(subtitle || company, x, 46, { width: 330 });
  doc.fillColor(C.grey).fontSize(8).text(company, 380, 30, { width: 165, align: 'right' });
  doc.moveTo(50, 72).lineTo(doc.page.width - 50, 72).lineWidth(0.5).strokeColor(C.light).stroke();
  doc.restore();
  doc.fillColor(C.anthracite).font('Helvetica').fontSize(10);
  doc.x = 50; doc.y = Math.max(y0, 90);
}

export function finalize(doc) {
  const range = doc.bufferedPageRange();
  const stamp = 'Erstellt am ' + fmtDateTime(new Date().toISOString()) + ' · GRBZ Facility Management System';
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    const bottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    doc.fontSize(7.5).fillColor(C.grey).font('Helvetica')
      .text(stamp, 50, doc.page.height - 38, { width: 380, lineBreak: false })
      .text(`Seite ${i + 1} von ${range.count}`, doc.page.width - 150, doc.page.height - 38, { width: 100, align: 'right', lineBreak: false });
    doc.page.margins.bottom = bottom;
  }
  doc.end();
}

export function ensureSpace(doc, h) {
  if (doc.y + h > doc.page.height - doc.page.margins.bottom) doc.addPage();
}

export function heading(doc, text) {
  ensureSpace(doc, 40);
  doc.moveDown(0.6);
  doc.font('Helvetica-Bold').fontSize(11.5).fillColor(C.anthracite).text(text, 50);
  const y = doc.y + 2;
  doc.moveTo(50, y).lineTo(110, y).lineWidth(1.5).strokeColor(C.accent).stroke();
  doc.moveDown(0.5);
  doc.font('Helvetica').fontSize(10);
}

/** Zweispaltige Schlüssel/Wert-Liste */
export function keyValues(doc, pairs) {
  const colW = (doc.page.width - 100) / 2;
  const list = pairs.filter(([, v]) => v !== undefined && v !== null && v !== '');
  for (let i = 0; i < list.length; i += 2) {
    ensureSpace(doc, 30);
    const y = doc.y;
    let maxY = y;
    [list[i], list[i + 1]].forEach((p, j) => {
      if (!p) return;
      const x = 50 + j * colW;
      doc.font('Helvetica').fontSize(7.5).fillColor(C.grey).text(p[0].toUpperCase(), x, y, { width: colW - 12 });
      doc.font('Helvetica').fontSize(10).fillColor(C.anthracite).text(String(p[1]), x, doc.y + 1, { width: colW - 12 });
      maxY = Math.max(maxY, doc.y);
    });
    doc.y = maxY + 6;
  }
  doc.x = 50;
}

export function paragraph(doc, text, opts = {}) {
  if (!text) return;
  ensureSpace(doc, 24);
  doc.font(opts.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(opts.size || 10).fillColor(opts.color || C.anthracite).text(String(text), 50, doc.y, { width: doc.page.width - 100 });
  doc.moveDown(0.3);
}

/** Einfache Tabelle: columns = [{label, width, key|get, align}] */
export function table(doc, columns, rows, opts = {}) {
  const total = doc.page.width - 100;
  const fixed = columns.reduce((s, c) => s + (c.width || 0), 0);
  const flex = columns.filter((c) => !c.width).length;
  const widths = columns.map((c) => c.width || (total - fixed) / Math.max(flex, 1));
  const drawHead = () => {
    ensureSpace(doc, 40);
    const y = doc.y;
    doc.rect(50, y, total, 18).fill(C.anthracite);
    let x = 50;
    columns.forEach((c, i) => {
      doc.font('Helvetica-Bold').fontSize(8).fillColor('#FFFFFF').text(c.label, x + 4, y + 5, { width: widths[i] - 8, align: c.align || 'left', lineBreak: false, ellipsis: true });
      x += widths[i];
    });
    doc.y = y + 20;
  };
  drawHead();
  if (!rows.length) { paragraph(doc, opts.empty || 'Keine Einträge vorhanden.', { color: C.grey, size: 9 }); return; }
  rows.forEach((r, ri) => {
    const vals = columns.map((c) => { const v = c.get ? c.get(r) : r[c.key]; return v == null ? '' : String(v); });
    doc.font('Helvetica').fontSize(8.5);
    const h = Math.max(...vals.map((v, i) => doc.heightOfString(v, { width: widths[i] - 8 }))) + 8;
    if (doc.y + h > doc.page.height - doc.page.margins.bottom) { doc.addPage(); drawHead(); }
    const y = doc.y;
    if (ri % 2 === 1) doc.rect(50, y, total, h).fill(C.faint);
    let x = 50;
    vals.forEach((v, i) => {
      const color = columns[i].color ? columns[i].color(rows[ri]) : C.anthracite;
      doc.font('Helvetica').fontSize(8.5).fillColor(color || C.anthracite).text(v, x + 4, y + 4, { width: widths[i] - 8, align: columns[i].align || 'left' });
      x += widths[i];
    });
    doc.y = y + h;
  });
  doc.x = 50;
  doc.moveDown(0.4);
}

export function images(doc, list, opts = {}) {
  // list: [{path, caption}]
  const w = opts.width || 160, h = opts.height || 120, gap = 12;
  const perRow = Math.floor((doc.page.width - 100 + gap) / (w + gap));
  for (let i = 0; i < list.length; i += perRow) {
    ensureSpace(doc, h + 40);
    const y = doc.y;
    let rowMax = y;
    list.slice(i, i + perRow).forEach((im, j) => {
      const x = 50 + j * (w + gap);
      try {
        doc.image(im.path, x, y, { fit: [w, h], align: 'center', valign: 'center' });
      } catch {
        doc.rect(x, y, w, h).strokeColor(C.light).stroke();
        doc.fontSize(8).fillColor(C.grey).text('Bild nicht verfügbar', x, y + h / 2 - 4, { width: w, align: 'center' });
      }
      doc.fontSize(7.5).fillColor(C.grey).text(im.caption || '', x, y + h + 3, { width: w });
      rowMax = Math.max(rowMax, doc.y);
    });
    doc.y = rowMax + 10;
  }
  doc.x = 50;
}

export function signatureBlock(doc, label, dataUrl, signedText) {
  ensureSpace(doc, 110);
  doc.moveDown(0.8);
  const y = doc.y;
  if (dataUrl && dataUrl.startsWith('data:image/png;base64,')) {
    try { doc.image(Buffer.from(dataUrl.split(',')[1], 'base64'), 50, y, { fit: [200, 70] }); } catch { /* ignorieren */ }
  }
  doc.moveTo(50, y + 74).lineTo(260, y + 74).lineWidth(0.5).strokeColor(C.grey).stroke();
  doc.fontSize(8).fillColor(C.grey).text(label + (signedText ? ` – ${signedText}` : ''), 50, y + 78, { width: 300 });
  doc.y = y + 96;
  doc.x = 50;
}

export const PDF_COLORS = C;

export function pdfToBuffer(doc) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });
}
