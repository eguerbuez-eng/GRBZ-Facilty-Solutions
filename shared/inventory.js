// Inventar: Gegenstandsarten und Barcode-Hilfen (Server + Client).
//
// Zwei Arten der Bestandsführung:
//  * Mengenartikel (Tabelle materials): Reinigungsmittel, Verbrauchsmaterial, Werkzeuge, Geräte, Ersatzteile …
//    → Bestand in Stück/Einheiten. „verbrauch“ = Ausgabe senkt den Bestand; „leihe“ = Ausgabe senkt nur die
//      verfügbare Menge, Rücknahme erhöht sie wieder.
//  * Einzelgegenstände (Tabelle machines): Maschinen, Reinigungsmaschinen, Einzelgeräte
//    → jede Einheit mit eigener Inventarnummer, eigenem Standort und Zustand (keine Stückzahl).

export const MATERIAL_CATEGORIES = {
  reinigungsmittel: { label: 'Reinigungsmittel', mode: 'verbrauch' },
  verbrauchsmaterial: { label: 'Verbrauchsmaterial', mode: 'verbrauch' },
  werkzeug: { label: 'Werkzeug', mode: 'leihe' },
  geraet: { label: 'Gerät (Stückartikel)', mode: 'leihe' },
  ersatzteil: { label: 'Ersatzteil', mode: 'verbrauch' },
  arbeitskleidung: { label: 'Arbeitskleidung', mode: 'verbrauch' },
  inventar: { label: 'Sonstiges Inventar', mode: 'leihe' },
};

export const MACHINE_TYPES = {
  reinigungsmaschine: 'Reinigungsmaschine',
  maschine: 'Maschine',
  geraet: 'Gerät (Einzelstück)',
};

export const MATERIAL_STATUS = { verfuegbar: 'Verfügbar', gesperrt: 'Gesperrt', nachbestellt: 'Nachbestellt', ausgemustert: 'Ausgemustert' };

export const MOVEMENT_KINDS = {
  anfangsbestand: 'Anfangsbestand', zugang: 'Zugang', verbrauch: 'Verbrauch / Entnahme', korrektur: 'Korrektur', inventur: 'Inventur',
  ausgabe: 'Ausgabe an Mitarbeiter', ruecknahme: 'Rücknahme',
};

export const categoryMode = (cat) => MATERIAL_CATEGORIES[cat]?.mode || 'verbrauch';
export const categoryLabel = (cat) => MATERIAL_CATEGORIES[cat]?.label || cat || '';

/** Barcode normalisieren (Leerzeichen/Steuerzeichen entfernen) */
export function normalizeCode(raw) {
  return String(raw ?? '').replace(/[\u0000-\u001F\u007F]/g, '').trim();
}

/** Verfügbare Menge eines Mengenartikels */
export function availableQty(m) {
  const issued = categoryMode(m.category) === 'leihe' ? +m.issued || 0 : 0;
  return Math.round((+m.stock - issued) * 1000) / 1000;
}

/**
 * Sucht einen Code im Inventar (lokal oder serverseitig, gleiche Logik).
 * rows: { materials: [], machines: [], qr_codes: [] }
 * Ergebnis: { type: 'material'|'machine', id, via } oder null
 */
export function findInventory(code, rows) {
  const c = normalizeCode(code);
  if (!c) return null;
  const lc = c.toLowerCase();
  const eq = (v) => v && String(v).trim().toLowerCase() === lc;
  for (const m of rows.materials) if (!m.deleted && (eq(m.barcode) || eq(m.article_no))) return { type: 'material', id: m.id, via: eq(m.barcode) ? 'barcode' : 'article_no' };
  for (const m of rows.machines) if (!m.deleted && (eq(m.barcode) || eq(m.inventory_no) || eq(m.serial_no))) return { type: 'machine', id: m.id, via: eq(m.barcode) ? 'barcode' : eq(m.inventory_no) ? 'inventory_no' : 'serial_no' };
  for (const q of rows.qr_codes || []) {
    if (q.deleted || !q.active) continue;
    if ((eq(q.label) || c.includes(`/q/${q.token}`) || c === q.token) && (q.material_id || q.machine_id)) {
      return q.material_id ? { type: 'material', id: q.material_id, via: 'qr' } : { type: 'machine', id: q.machine_id, via: 'qr' };
    }
  }
  return null;
}

/** Prüft, ob ein Barcode bereits einem anderen Gegenstand gehört. */
export function barcodeTaken(code, rows, self = {}) {
  const c = normalizeCode(code).toLowerCase();
  if (!c) return null;
  const eq = (v) => v && String(v).trim().toLowerCase() === c;
  for (const m of rows.materials) if (!m.deleted && !(self.type === 'material' && self.id === m.id) && (eq(m.barcode) || eq(m.article_no))) return { type: 'material', id: m.id, name: m.name };
  for (const m of rows.machines) if (!m.deleted && !(self.type === 'machine' && self.id === m.id) && (eq(m.barcode) || eq(m.inventory_no) || eq(m.serial_no))) return { type: 'machine', id: m.id, name: m.name };
  for (const q of rows.qr_codes || []) if (!q.deleted && eq(q.label)) return { type: 'qr', id: q.id, name: q.label };
  return null;
}
