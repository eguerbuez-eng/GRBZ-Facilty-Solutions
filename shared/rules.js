// Geschäftsregeln, die Server UND Client (offline) identisch prüfen.

/**
 * Prüft, ob eine Auftrags-Checkliste abgeschlossen werden darf.
 * @param items Checklistenpunkte des Auftrags
 * @param hasPhoto (itemId) => boolean
 * @returns Liste deutscher Fehlermeldungen (leer = vollständig)
 */
export function checklistProblems(items, hasPhoto) {
  const problems = [];
  for (const it of items) {
    if (it.required && it.result === 'offen') problems.push(`„${it.text}“ ist noch offen.`);
    if (['nicht_erledigt', 'mangel'].includes(it.result) && !String(it.comment || '').trim()) problems.push(`„${it.text}“: Bitte einen Kommentar angeben.`);
    if (it.photo_required && it.result === 'erledigt' && !hasPhoto(it.id)) problems.push(`„${it.text}“: Foto erforderlich.`);
  }
  return problems;
}

export function autoReport(items) {
  const count = (r) => items.filter((i) => i.result === r).length;
  const parts = [`${count('erledigt')} von ${items.length} Punkten erledigt`];
  if (count('nicht_zutreffend')) parts.push(`${count('nicht_zutreffend')} nicht zutreffend`);
  if (count('nicht_erledigt')) parts.push(`${count('nicht_erledigt')} nicht erledigt`);
  if (count('mangel')) parts.push(`${count('mangel')} Mangel/Mängel festgestellt`);
  return parts.join(', ') + '.';
}

export function isLowStock(m) {
  return m.min_stock > 0 && m.stock <= m.min_stock;
}
