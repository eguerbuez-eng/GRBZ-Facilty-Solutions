// Fotoaufnahme (Gerätekamera), Komprimierung und Unterschriftenfeld.
import { h, ic, modal, toast, buildForm } from './ui.js';
import { PHOTO_CATEGORIES } from '/shared/constants.js';
import * as store from './store.js';

const MAX = 1600;    // längste Kante (ressourcenschonend, ausreichend für Dokumentation)
const THUMB = 360;

/** Bild verkleinern und als JPEG neu kodieren. Entfernt dabei auch EXIF-/GPS-Daten (Datenschutz). */
export async function compress(file, max = MAX, quality = 0.82) {
  let bmp;
  try {
    bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    bmp = await new Promise((res, rej) => { const img = new Image(); img.onload = () => res(img); img.onerror = rej; img.src = URL.createObjectURL(file); });
  }
  const w0 = bmp.width; const h0 = bmp.height;
  const s = Math.min(1, max / Math.max(w0, h0));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(w0 * s); canvas.height = Math.round(h0 * s);
  canvas.getContext('2d').drawImage(bmp, 0, 0, canvas.width, canvas.height);
  bmp.close?.();
  return new Promise((res) => canvas.toBlob((b) => res(b), 'image/jpeg', quality));
}

function pickFile() {
  return new Promise((resolve) => {
    const input = h('input', { type: 'file', accept: 'image/*', capture: 'environment', style: { display: 'none' } });
    input.addEventListener('change', () => { resolve(input.files[0] || null); input.remove(); });
    document.body.append(input);
    input.click();
  });
}

/**
 * Foto aufnehmen, Kategorie/Kommentar erfassen und (offlinefähig) speichern.
 * link: { order_id, checklist_item_id, object_id, defect_id, winter_operation_id, machine_id, inspection_id }
 */
export async function takePhoto(link, { category = 'nachher', askMeta = true } = {}) {
  const file = await pickFile();
  if (!file) return null;
  let blob, thumb;
  try {
    blob = await compress(file);
    thumb = await compress(file, THUMB, 0.7);
  } catch {
    toast('Das Bild konnte nicht verarbeitet werden.', 'bad');
    return null;
  }
  let meta = { category, comment: '' };
  if (askMeta) {
    const preview = h('img', { src: URL.createObjectURL(thumb), style: { width: '100%', maxHeight: '220px', objectFit: 'contain', borderRadius: '8px', background: '#eee', marginBottom: '12px' }, alt: 'Vorschau' });
    const f = buildForm([
      { name: 'category', label: 'Art des Fotos', type: 'select', required: true, options: Object.entries(PHOTO_CATEGORIES).map(([value, label]) => ({ value, label })) },
      { name: 'comment', label: 'Kommentar', type: 'textarea', rows: 2, placeholder: 'optional' },
    ], meta);
    const r = await modal({ title: 'Foto speichern', body: h('div', null, preview, f.el), actions: [{ label: 'Verwerfen', value: null }, { label: 'Speichern', class: 'primary', onClick: () => f.values() }] });
    if (!r) return null;
    meta = r;
  }
  const row = await store.addPhoto({ ...link, ...meta, taken_at: new Date().toISOString() }, blob, thumb);
  toast(navigator.onLine ? 'Foto gespeichert.' : 'Foto offline gespeichert – wird später übertragen.', 'ok');
  return row;
}

/** Fotoraster mit Vergrößerung */
export function photoGrid(photos, { onChange, canRelease = false } = {}) {
  const grid = h('div', { class: 'photos' });
  if (!photos.length) return h('div', { class: 'empty small' }, 'Noch keine Fotos.');
  for (const p of photos.sort((a, b) => (a.taken_at || '').localeCompare(b.taken_at || ''))) {
    const img = h('img', { alt: PHOTO_CATEGORIES[p.category] || 'Foto', loading: 'lazy' });
    store.photoUrl(p, true).then((u) => { img.src = u; });
    grid.append(h('div', { class: 'photo', onclick: () => viewPhoto(p, { onChange, canRelease }) }, img,
      h('span', { class: 'ph-tag' }, PHOTO_CATEGORIES[p.category] || 'Foto'), p._local ? h('span', { class: 'ph-pending' }, 'offline') : null,
      p.customer_visible ? h('span', { class: 'ph-pending', style: { background: 'var(--accent)' } }, 'Kunde') : null));
  }
  return grid;
}

export async function viewPhoto(p, { onChange, canRelease } = {}) {
  const img = h('img', { alt: 'Foto' });
  store.photoUrl(p, false).then((u) => { img.src = u; });
  const { fmtDateTime } = await import('/shared/dates.js');
  const actions = [{ label: 'Schließen', value: null }];
  if (canRelease && !p._local) actions.unshift({ label: p.customer_visible ? 'Freigabe entziehen' : 'Für Kunden freigeben', icon: 'eye', onClick: async () => { await store.command('photo.update', { id: p.id, customer_visible: !p.customer_visible }); onChange?.(); } });
  await modal({
    title: PHOTO_CATEGORIES[p.category] || 'Foto', wide: true,
    body: h('div', { class: 'photo-view' }, img, h('p', { class: 'small muted' }, `${fmtDateTime(p.taken_at)} · ${store.userName(p.user_id)}`), p.comment ? h('p', null, p.comment) : null),
    actions,
  });
}

/** Unterschriftenfeld (Canvas, Touch/Maus/Stift) */
export function signaturePad() {
  const canvas = h('canvas', { class: 'sigpad', 'aria-label': 'Unterschriftenfeld' });
  const ctx = canvas.getContext('2d');
  let drawing = false; let dirty = false; let lastPt = null;
  const size = () => {
    const r = canvas.getBoundingClientRect();
    const ratio = window.devicePixelRatio || 1;
    canvas.width = r.width * ratio; canvas.height = r.height * ratio;
    ctx.scale(ratio, ratio); ctx.lineWidth = 2.4; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#1F2328';
  };
  requestAnimationFrame(size);
  const pt = (e) => { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  canvas.addEventListener('pointerdown', (e) => { drawing = true; lastPt = pt(e); canvas.setPointerCapture(e.pointerId); });
  canvas.addEventListener('pointermove', (e) => {
    if (!drawing) return;
    const p = pt(e);
    ctx.beginPath(); ctx.moveTo(lastPt.x, lastPt.y); ctx.lineTo(p.x, p.y); ctx.stroke();
    lastPt = p; dirty = true;
  });
  const end = () => { drawing = false; };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
  const clearBtn = h('button', { class: 'btn sm ghost', type: 'button', onclick: () => { ctx.clearRect(0, 0, canvas.width, canvas.height); dirty = false; } }, ic('trash'), 'Löschen');
  return {
    el: h('div', null, canvas, h('div', { class: 'btn-row', style: { justifyContent: 'flex-end', marginTop: '6px' } }, clearBtn)),
    isEmpty: () => !dirty,
    toDataUrl() {
      // auf 600 px Breite reduzieren
      const out = document.createElement('canvas');
      const w = 600; out.width = w; out.height = Math.round((canvas.height / canvas.width) * w);
      const o = out.getContext('2d'); o.fillStyle = '#fff'; o.fillRect(0, 0, out.width, out.height);
      o.drawImage(canvas, 0, 0, out.width, out.height);
      return out.toDataURL('image/png');
    },
  };
}
