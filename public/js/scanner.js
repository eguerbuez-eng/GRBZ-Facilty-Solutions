// QR-/Barcode-Erfassung:
//  1) Hardware-Scanner (Honeywell EDA52 u. a.) im „Keyboard Wedge“-Modus:
//     Der Scanner tippt den Code als Tastatureingabe und schließt mit Enter ab.
//     Erkennung über sehr schnelle Tastenfolgen (< 60 ms zwischen Zeichen).
//  2) Gerätekamera: BarcodeDetector-API (Chrome/Android), sonst jsQR als Fallback.
import { h, ic, modal, toast } from './ui.js';

const listeners = new Set();
export function onScan(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function emitScan(code, method) { for (const fn of listeners) fn(code, method); }

// ---------- Keyboard-Wedge ----------
let buf = '';
let last = 0;
let fastCount = 0;
let suspended = 0;
export function suspendWedge(on) { suspended += on ? 1 : -1; }

function isEditable(el) {
  return el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
}

export function installWedge() {
  document.addEventListener('keydown', (e) => {
    if (suspended > 0) return;
    const t = performance.now();
    const target = document.activeElement;
    // Eingabefelder mit data-scan-target bekommen den Scan direkt (z. B. Barcode-Feld)
    if (isEditable(target) && !target.dataset.wedge) { buf = ''; return; }
    if (e.key === 'Enter' || e.key === 'Tab') {
      const code = buf.trim();
      const isScanner = code.length >= 4 && fastCount >= Math.min(code.length - 1, 3);
      buf = ''; fastCount = 0;
      if (isScanner) {
        e.preventDefault();
        if (target?.dataset.wedge) target.value = '';
        emitScan(code, 'scanner');
      }
      return;
    }
    if (e.key.length !== 1 || e.ctrlKey || e.altKey || e.metaKey) return;
    if (t - last > 300) { buf = ''; fastCount = 0; }
    else if (t - last < 60) fastCount++;
    last = t;
    buf += e.key;
    if (buf.length > 300) buf = buf.slice(-300);
  }, true);
}

// ---------- Kamera ----------
let jsQrLoading;
function loadJsQr() {
  if (window.jsQR) return Promise.resolve(window.jsQR);
  jsQrLoading ||= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = '/vendor/jsQR.js';
    s.onload = () => resolve(window.jsQR);
    s.onerror = () => reject(new Error('QR-Erkennung konnte nicht geladen werden.'));
    document.head.append(s);
  });
  return jsQrLoading;
}

async function makeDetector() {
  if ('BarcodeDetector' in window) {
    try {
      const formats = await window.BarcodeDetector.getSupportedFormats();
      if (formats.includes('qr_code')) {
        const want = ['qr_code', 'ean_13', 'ean_8', 'code_128', 'code_39', 'data_matrix', 'upc_a'].filter((f) => formats.includes(f));
        const det = new window.BarcodeDetector({ formats: want });
        return async (video) => { const r = await det.detect(video); return r[0]?.rawValue || null; };
      }
    } catch { /* Fallback */ }
  }
  const jsQR = await loadJsQr();
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  return async (video) => {
    const w = 480; const hgt = Math.round((video.videoHeight / video.videoWidth) * w) || 360;
    canvas.width = w; canvas.height = hgt;
    ctx.drawImage(video, 0, 0, w, hgt);
    const img = ctx.getImageData(0, 0, w, hgt);
    return jsQR(img.data, w, hgt, { inversionAttempts: 'dontInvert' })?.data || null;
  };
}

/** Öffnet die Kamera und liefert den ersten erkannten Code (oder null bei Abbruch). */
export function scanWithCamera({ title = 'QR-Code scannen' } = {}) {
  return new Promise((resolve) => {
    if (!navigator.mediaDevices?.getUserMedia) {
      toast('Die Kamera ist in diesem Browser nicht verfügbar (HTTPS erforderlich).', 'bad', 6000);
      return resolve(null);
    }
    const video = h('video', { playsinline: true, muted: true, autoplay: true });
    const hint = h('div', { class: 'muted small', style: { marginTop: '10px', textAlign: 'center' } }, 'Code in den Rahmen halten …');
    let stream; let stopped = false; let torchOn = false;
    const torchBtn = h('button', { class: 'btn sm hidden', type: 'button' }, ic('flash'), 'Licht');
    const body = h('div', null, h('div', { class: 'scanner-video' }, video, h('div', { class: 'frame' }), h('div', { class: 'laser' })), hint,
      h('div', { class: 'btn-row', style: { justifyContent: 'center', marginTop: '10px' } }, torchBtn));
    const stop = () => { stopped = true; stream?.getTracks().forEach((t) => t.stop()); };
    let result = null;
    const p = modal({ title, body, actions: [{ label: 'Abbrechen', value: null }], onClose: stop });
    p.then(() => resolve(result));
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
        if (stopped) return stop();
        video.srcObject = stream;
        await video.play().catch(() => {});
        const track = stream.getVideoTracks()[0];
        if (track.getCapabilities?.().torch) {
          torchBtn.classList.remove('hidden');
          torchBtn.onclick = () => { torchOn = !torchOn; track.applyConstraints({ advanced: [{ torch: torchOn }] }).catch(() => {}); };
        }
        const detect = await makeDetector();
        const loop = async () => {
          if (stopped) return;
          if (video.readyState >= 2) {
            try {
              const code = await detect(video);
              if (code) {
                result = code;
                navigator.vibrate?.(60);
                document.querySelector('.modal-back')?._close?.(code);
                return;
              }
            } catch { /* nächster Versuch */ }
          }
          setTimeout(loop, 180);
        };
        loop();
      } catch (e) {
        hint.textContent = e.name === 'NotAllowedError' ? 'Kamerazugriff verweigert. Bitte in den Browser-Einstellungen erlauben.' : 'Kamera konnte nicht gestartet werden: ' + (e.message || e.name);
        hint.style.color = 'var(--bad)';
      }
    })();
  });
}

/** Extrahiert das QR-Token aus einer gescannten URL oder einem Rohwert */
export function parseToken(raw) {
  const s = String(raw || '').trim();
  const m = s.match(/\/q\/([A-Za-z0-9_-]{16,64})/);
  if (m) return m[1];
  if (/^[A-Za-z0-9_-]{24}$/.test(s)) return s;
  return null;
}
