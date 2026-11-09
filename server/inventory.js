// Inventar-API: Barcode-Suche (online) und Etiketten (Code 128 + QR) für eigene Inventarbarcodes.
import express from 'express';
import path from 'node:path';
import bwipjs from 'bwip-js';
import QRCode from 'qrcode';
import { AppError } from './db.js';
import { requirePerm } from './auth.js';
import { can } from '../shared/constants.js';
import { findInventory, normalizeCode, categoryLabel, MACHINE_TYPES } from '../shared/inventory.js';
import { createPdf, finalize, pdfToBuffer, PDF_COLORS } from './pdf.js';

export function inventoryRouter({ db, dirs }) {
  const r = express.Router();

  // Server-Suche (z. B. wenn ein Gerät noch nicht synchronisiert ist)
  r.get('/lookup', requirePerm('materials.read', 'machines.read'), (req, res) => {
    const code = normalizeCode(req.query.code);
    if (!code) throw new AppError(400, 'Kein Code angegeben.');
    const hit = findInventory(code, {
      materials: can(req.user, 'materials.read') ? db.all('SELECT * FROM materials WHERE deleted = 0') : [],
      machines: can(req.user, 'machines.read') ? db.all('SELECT * FROM machines WHERE deleted = 0') : [],
      qr_codes: db.all('SELECT * FROM qr_codes WHERE deleted = 0'),
    });
    res.json({ code, hit, item: hit ? db.byId(hit.type === 'material' ? 'materials' : 'machines', hit.id) : null });
  });

  // Etiketten: items=material:<id>,machine:<id>
  r.get('/labels.pdf', requirePerm('materials.write', 'machines.write'), async (req, res) => {
    const items = String(req.query.items || '').split(',').filter(Boolean).slice(0, 120).map((x) => {
      const [type, id] = x.split(':');
      const row = db.byId(type === 'machine' ? 'machines' : 'materials', id);
      return row && !row.deleted && row.barcode ? { type, row } : null;
    }).filter(Boolean);
    if (!items.length) throw new AppError(400, 'Keine Gegenstände mit Barcode ausgewählt.');
    const logo = db.setting('logo_file');
    const doc = createPdf({ title: 'Inventar-Etiketten', subtitle: `${items.length} Etikett(en)`, company: db.setting('company_name'), logoPath: logo ? path.join(dirs.branding, logo) : null });
    const cols = 2; const rows = 5; const cellW = (doc.page.width - 100) / cols; const cellH = 135;
    let i = 0;
    for (const { type, row } of items) {
      const pos = i % (cols * rows);
      if (i > 0 && pos === 0) doc.addPage();
      const x = 50 + (pos % cols) * cellW; const y = 95 + Math.floor(pos / cols) * cellH;
      doc.save().roundedRect(x + 4, y, cellW - 8, cellH - 10, 6).lineWidth(0.6).dash(3, { space: 3 }).strokeColor('#B8BDC2').stroke().undash().restore();
      const bar = await bwipjs.toBuffer({ bcid: 'code128', text: row.barcode, scale: 3, height: 11, includetext: false, paddingwidth: 2 });
      const qr = await QRCode.toBuffer(row.barcode, { errorCorrectionLevel: 'M', margin: 1, width: 300 });
      doc.image(qr, x + 12, y + 10, { width: 62 });
      doc.image(bar, x + 82, y + 12, { fit: [cellW - 100, 42] });
      doc.font('Helvetica-Bold').fontSize(9).fillColor(PDF_COLORS.anthracite).text(row.barcode, x + 82, y + 58, { width: cellW - 100 });
      doc.font('Helvetica-Bold').fontSize(9.5).text(row.name, x + 12, y + 80, { width: cellW - 24, height: 24, ellipsis: true });
      const kind = type === 'machine' ? `${MACHINE_TYPES[row.machine_type] || 'Maschine'} · ${row.inventory_no || ''}` : `${categoryLabel(row.category)} · ${row.article_no || ''}`;
      doc.font('Helvetica').fontSize(7.5).fillColor(PDF_COLORS.grey).text(`${kind} · ${db.setting('company_name')}`, x + 12, y + 106, { width: cellW - 24 });
      i++;
    }
    db.audit(req.user.id, 'inventar.etiketten_gedruckt', null, null, { anzahl: items.length });
    finalize(doc);
    res.type('application/pdf').setHeader('Content-Disposition', 'inline; filename="Inventar-Etiketten.pdf"');
    res.send(await pdfToBuffer(doc));
  });

  return r;
}
