// Zentrale Scanner-Erkennung (Honeywell EDA52 und andere Keyboard-Wedge-Scanner) + Kamera-Scan.
//
// Der Hardware-Scanner „tippt“ den Code sehr schnell und schließt mit Enter ab. Die Erkennung läuft
// systemweit und ohne Klick in ein Feld:
//   1. Tastenereignisse: sehr kurze Abstände zwischen den Zeichen (Standard ≤ 45 ms) + Enter/Tab
//      → Scan. Menschliches Tippen ist deutlich langsamer und bleibt unberührt.
//   2. Texteinfügung in einem Stück (Android-„Wedge“ über InputConnection) → Scan.
//   3. Optional: festes Präfix-Zeichen (im Honeywell-Profil einstellbar) → eindeutige Erkennung.
//   4. Optional: unsichtbares Empfangsfeld, falls das Gerät Scans nur an fokussierte Felder sendet.
// Ist gerade ein Text-/Notizfeld aktiv, wird dessen ursprünglicher Inhalt nach dem Scan
// wiederhergestellt – der Scan überschreibt keine Eingaben. Felder mit data-scan-target
// (z. B. „Barcode“) erhalten den Code dagegen absichtlich.
import { h, ic, modal, toast } from './ui.js';

const DEFAULTS = { maxGap: 45, minLen: 4, dedupeMs: 1200, idleMs: 140, prefix: '', sink: false };
const KEY = 'grbz_scanner';
export function scannerConfig() {
  try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch { return { ...DEFAULTS }; }
}
export function saveScannerConfig(c) {
  try { localStorage.setItem(KEY, JSON.stringify({ ...scannerConfig(), ...c })); } catch { /* Speicher nicht verfügbar */ }
  cfg = scannerConfig();
  applySink();
}
let cfg = scannerConfig();

// ---------- Weiterleitung ----------
const observers = new Set();           // z. B. Diagnose (erhalten jeden Scan)
let defaultHandler = null;             // globale Verarbeitung (App)
let consumer = null;                   // Ansicht mit eigener Verarbeitung (z. B. Inventar)
export function onScan(fn) { observers.add(fn); return () => observers.delete(fn); }
export function setDefaultScanHandler(fn) { defaultHandler = fn; }
export function setScanConsumer(fn, opts = {}) {
  consumer = { fn, ...opts };
  return () => { if (consumer?.fn === fn) consumer = null; };
}
export const scanStats = { received: 0, duplicates: 0, last: null };

let suspended = 0;
export function suspendWedge(on) { suspended += on ? 1 : -1; }

const queue = [];
let processing = false;
let lastEmit = { code: '', t: 0 };

function emit(code, method, meta = {}) {
  code = String(code).replace(/[\u0000-\u001F\u007F]/g, '').trim();
  if (!code) return;
  const t = performance.now();
  const dup = code === lastEmit.code && t - lastEmit.t < cfg.dedupeMs;
  scanStats.last = { code, method, at: new Date().toISOString(), duplicate: dup, ...meta };
  for (const fn of observers) { try { fn(code, method, scanStats.last); } catch (e) { console.error(e); } }
  if (dup) { scanStats.duplicates++; return; } // Doppelscan (z. B. Taste zu lange gedrückt) ignorieren
  lastEmit = { code, t };
  scanStats.received++;
  queue.push({ code, method, meta });
  drain();
}

async function drain() {
  if (processing) return;
  processing = true;
  try {
    while (queue.length) {
      const { code, method, meta } = queue.shift();
      const modalOpen = document.querySelector('.modal-back');
      if (modalOpen && !(consumer?.allowInModal)) {
        toast(`Scan „${code.slice(0, 40)}“ erkannt – bitte zuerst den geöffneten Dialog schließen.`, 'warn', 3500);
        continue;
      }
      // Während in einem Formular getippt wird, die Seite nicht verlassen (Eingaben bleiben erhalten)
      if (!consumer && meta?.field === 'Eingabefeld') {
        toast(`Scan „${code.slice(0, 40)}“ erkannt. Ihre Eingabe bleibt erhalten – zum Öffnen bitte zuerst das Formular speichern oder verlassen.`, 'warn', 5000);
        continue;
      }
      navigator.vibrate?.(30);
      const fn = consumer?.fn || defaultHandler;
      try { await fn?.(code, method); } catch (e) { console.error(e); }
    }
  } finally { processing = false; }
}

/** Code programmgesteuert einspeisen (manuelle Eingabe, Kamera, Tests) */
export function injectScan(code, method = 'manuell') { emit(code, method); }

// ---------- Erkennung ----------
function editableOf(el) {
  if (!el || el === document.body) return null;
  if (el.tagName === 'TEXTAREA' || el.isContentEditable) return el;
  if (el.tagName === 'INPUT' && !['checkbox', 'radio', 'button', 'submit', 'file', 'range', 'color'].includes(el.type)) return el;
  return null;
}
const isTargetField = (el) => !!el?.dataset?.scanTarget;

let burst = null;  // { chars, last, gaps, el, snap, src }
let idleTimer = null;
let bulk = null;   // Texteinfügung in einem Stück (wartet ggf. auf Enter)
let capture = null; // Präfix-Modus
let lastUnidentified = -1e9; // Zeitpunkt des letzten Tastenereignisses ohne Zeichen (Android/IME)

function snapshot(el) {
  if (!el || el.dataset.sink) return null;
  try { return { value: el.value, ss: el.selectionStart, se: el.selectionEnd }; } catch { return { value: el.value }; }
}
function restore(el, snap) {
  if (!el || !snap || !document.contains(el)) return;
  if (el.value === snap.value) return;
  el.value = snap.value;
  try { if (snap.ss != null) el.setSelectionRange(snap.ss, snap.se); } catch { /* nicht unterstützt */ }
  el.dispatchEvent(new Event('input', { bubbles: true }));
}
const qualifies = (b, minLen = cfg.minLen) => b && b.chars.length >= minLen && b.gaps.every((g) => g <= cfg.maxGap);

function feed(ch, t, el) {
  if (!burst || t - burst.last > cfg.maxGap) {
    burst = { chars: '', last: t, gaps: [], el, snap: snapshot(el) };
  } else burst.gaps.push(t - burst.last);
  burst.chars += ch;
  burst.last = t;
  clearTimeout(idleTimer);
  // Scanner ohne Enter-Suffix: nach kurzer Pause abschließen (etwas strengere Mindestlänge)
  idleTimer = setTimeout(() => { if (qualifies(burst, cfg.minLen + 2)) finish('scanner'); else burst = null; }, cfg.idleMs);
}

function finish(method) {
  clearTimeout(idleTimer);
  const b = burst; burst = null;
  if (!b) return;
  if (b.el && !isTargetField(b.el)) restore(b.el, b.snap);
  if (b.el?.dataset?.sink) b.el.value = '';
  emit(b.chars, method, { gaps: b.gaps.length ? Math.round(Math.max(...b.gaps)) : 0, field: b.el ? (b.el.dataset.sink ? 'Empfangsfeld' : b.el.dataset.scanInput ? 'Scanfeld' : 'Eingabefeld') : 'ohne Fokus' });
}

function onKeydown(e) {
  if (suspended > 0 || e.isComposing) return;
  const el = editableOf(document.activeElement);
  if (isTargetField(el)) return; // Barcode-Feld: Scan geht bewusst ins Feld
  const t = e.timeStamp || performance.now();

  // Präfix-Modus: alles zwischen Präfix und Enter wird abgefangen (nichts landet im Feld)
  if (cfg.prefix) {
    if (capture) {
      if (t - capture.last > 400) { abortCapture(); }
      else if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); e.stopImmediatePropagation(); const c = capture.chars; capture = null; emit(c, 'scanner', { field: 'Präfix' }); return; }
      else if (e.key.length === 1) { e.preventDefault(); e.stopImmediatePropagation(); capture.chars += e.key; capture.last = t; return; }
    }
    if (!capture && e.key === cfg.prefix) { e.preventDefault(); e.stopImmediatePropagation(); capture = { chars: '', last: t, el }; return; }
  }

  if (e.key === 'Enter' || e.key === 'Tab') {
    if (bulk && t - bulk.t < 250) {
      e.preventDefault(); e.stopImmediatePropagation();
      const b = bulk; clearTimeout(b.timer); bulk = null;
      if (b.el && b.snap) restore(b.el, b.snap);
      if (b.el?.dataset?.sink) b.el.value = '';
      emit(b.code, 'scanner', { field: b.el && !b.el.dataset.scanInput && !b.el.dataset.sink ? 'Eingabefeld' : 'Scanfeld', bulk: true });
      return;
    }
    bulk = null;
    if (qualifies(burst) && t - burst.last <= Math.max(cfg.maxGap * 3, 150)) { e.preventDefault(); e.stopImmediatePropagation(); finish('scanner'); }
    else burst = null;
    return;
  }
  if (e.key === 'Unidentified' || e.key === 'Process' || e.keyCode === 229) { lastUnidentified = t; return; } // Zeichen kommt über beforeinput
  if (e.key.length !== 1 || e.ctrlKey || e.altKey || e.metaKey) return;
  feed(e.key, t, el);
  if (el?.dataset?.sink) e.preventDefault();
}

function abortCapture() {
  // Präfix war doch ein normales Zeichen → Eingabe nachholen
  const c = capture; capture = null;
  if (c?.el && !c.el.dataset.sink && document.contains(c.el)) {
    try { c.el.focus(); document.execCommand('insertText', false, cfg.prefix + c.chars); } catch { /* ignorieren */ }
  }
}

function onBeforeInput(e) {
  if (suspended > 0) return;
  const el = editableOf(e.target);
  if (!el || isTargetField(el)) return;
  const t = e.timeStamp || performance.now();
  if (e.inputType === 'insertText' && e.data) {
    if (e.data.length >= cfg.minLen && !/\s{2,}/.test(e.data)) {
      if (el.dataset.sink) {
        // eigenes Empfangsfeld: alles ist Scannereingabe
        e.preventDefault(); el.value = '';
        clearTimeout(bulk?.timer);
        const code = e.data;
        bulk = { code, t, el, snap: null, timer: setTimeout(() => { if (bulk?.code === code) { bulk = null; emit(code, 'scanner', { field: 'Scanfeld', bulk: true }); } }, cfg.idleMs) };
        return;
      }
      // Text in einem Stück (Android-Wedge, aber auch Autovervollständigung/Einfügen):
      // zunächst normal einfügen; nur wenn sofort Enter folgt, ist es ein Scan → Feld wird zurückgesetzt.
      bulk = { code: e.data, t, el, snap: snapshot(el) };
      return;
    }
    // Nur Zeichen ohne vorheriges echtes Tastenereignis zählen (sonst doppelt)
    if (t - lastUnidentified < 100) for (const ch of e.data) feed(ch, t, el);
    if (el.dataset.sink) e.preventDefault();
  } else if ((e.inputType === 'insertLineBreak' || e.inputType === 'insertParagraph') && qualifies(burst)) {
    e.preventDefault(); finish('scanner');
  }
}

// ---------- Empfangsfeld (optional) ----------
let sinkEl = null;
function applySink() {
  if (cfg.sink && !sinkEl) {
    sinkEl = h('input', { type: 'text', inputmode: 'none', autocomplete: 'off', 'aria-hidden': 'true', tabindex: '-1', dataset: { sink: '1' },
      style: { position: 'fixed', left: '-9999px', top: '0', width: '1px', height: '1px', opacity: '0' } });
    document.body.append(sinkEl);
    const refocus = () => setTimeout(() => { if (cfg.sink && sinkEl && !editableOf(document.activeElement) && !document.querySelector('.modal-back')) sinkEl.focus({ preventScroll: true }); }, 60);
    document.addEventListener('focusout', refocus);
    document.addEventListener('click', refocus);
    refocus();
  } else if (!cfg.sink && sinkEl) { sinkEl.remove(); sinkEl = null; }
}

export function installWedge() {
  window.addEventListener('keydown', onKeydown, true);
  window.addEventListener('beforeinput', onBeforeInput, true);
  applySink();
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
        const want = ['qr_code', 'ean_13', 'ean_8', 'code_128', 'code_39', 'data_matrix', 'upc_a', 'upc_e', 'itf'].filter((f) => formats.includes(f));
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
              if (code) { result = code; navigator.vibrate?.(60); document.querySelector('.modal-back')?._close?.(code); return; }
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
