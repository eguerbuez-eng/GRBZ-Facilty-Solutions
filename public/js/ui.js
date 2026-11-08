// DOM-Helfer, Dialoge, Toasts und der generische Formularbaukasten.
// Nutzerdaten werden ausschließlich als Text eingefügt (kein innerHTML) → Schutz vor XSS.
import { icon } from './icons.js';
import { fmtDate, fmtDateTime, fmtMoney, fmtNumber, todayYmd, hmOf, ymdOf, berlinToIso } from '/shared/dates.js';

export { fmtDate, fmtDateTime, fmtMoney, fmtNumber };

/** Element erzeugen: h('div', {class:'x', onclick}, 'Text', child, [children]) */
export function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  if (attrs && (typeof attrs !== 'object' || attrs instanceof Node || Array.isArray(attrs))) { children.unshift(attrs); attrs = null; }
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k === 'value') el.value = v;
    else if (k === 'checked' || k === 'disabled' || k === 'selected' || k === 'multiple' || k === 'required') el[k] = !!v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

/** Vertrauenswürdiges, internes SVG-Icon als Element */
export function ic(name, cls) {
  const t = document.createElement('template');
  t.innerHTML = icon(name, cls);
  return t.content.firstChild;
}

export function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); return el; }

// ---------- Toasts ----------
let toastBox;
export function toast(msg, type = 'ok', ms = 3500) {
  if (!toastBox) { toastBox = h('div', { class: 'toasts', role: 'status', 'aria-live': 'polite' }); document.body.append(toastBox); }
  const t = h('div', { class: `toast ${type}` }, ic(type === 'bad' ? 'alert' : type === 'warn' ? 'info' : 'checkCircle'), h('div', null, msg));
  toastBox.append(t);
  setTimeout(() => t.remove(), ms);
}

export function errorToast(e) {
  const details = e?.details?.length ? '\n' + e.details.slice(0, 4).join('\n') : '';
  toast((e?.message || 'Unbekannter Fehler.') + details, 'bad', 6000);
}

// ---------- Modal ----------
export function modal({ title, body, actions = [], wide = false, onClose }) {
  return new Promise((resolve) => {
    const back = h('div', { class: 'modal-back' });
    const close = (val) => { back.remove(); document.removeEventListener('keydown', esc); onClose?.(); resolve(val); };
    const esc = (e) => { if (e.key === 'Escape') close(null); };
    document.addEventListener('keydown', esc);
    const foot = actions.length ? h('div', { class: 'modal-foot' }, actions.map((a) => h('button', {
      class: `btn ${a.class || ''}`, type: 'button', onclick: async (ev) => {
        if (a.onClick) {
          const btn = ev.currentTarget; btn.disabled = true;
          try { const r = await a.onClick(); if (r !== false) close(r === undefined ? a.value : r); } catch (e) { errorToast(e); } finally { btn.disabled = false; }
        } else close(a.value);
      },
    }, a.icon ? ic(a.icon) : null, a.label))) : null;
    const m = h('div', { class: `modal ${wide ? 'wide' : ''}`, role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
      h('div', { class: 'modal-head' }, h('h2', null, title), h('button', { class: 'btn ghost icon-btn', 'aria-label': 'Schließen', onclick: () => close(null) }, ic('x'))),
      h('div', { class: 'modal-body' }, body), foot);
    back.append(m);
    back.addEventListener('click', (e) => { if (e.target === back) close(null); });
    document.body.append(back);
    const first = m.querySelector('input, select, textarea');
    if (first && !matchMedia('(pointer: coarse)').matches) setTimeout(() => first.focus(), 50);
    back._close = close;
  });
}

export function confirmDialog(text, { ok = 'Bestätigen', danger = false, title = 'Bitte bestätigen' } = {}) {
  return modal({ title, body: h('p', null, text), actions: [{ label: 'Abbrechen', value: false }, { label: ok, value: true, class: danger ? 'danger solid' : 'primary' }] });
}

/** Formular im Dialog, liefert Werte oder null */
export function formDialog(title, fields, values = {}, { submit = 'Speichern', validate } = {}) {
  const f = buildForm(fields, values);
  return modal({
    title, body: f.el,
    actions: [{ label: 'Abbrechen', value: null }, {
      label: submit, class: 'primary', onClick: () => {
        const v = f.values();
        if (!f.check()) return false;
        const err = validate?.(v);
        if (err) { toast(err, 'bad'); return false; }
        return v;
      },
    }],
  });
}

// ---------- Formulare ----------
/**
 * fields: [{name,label,type,options,required,help,placeholder,half,third,refOptions,scan,min,max,step}]
 * type: text|textarea|number|money|date|time|datetime|select|ref|bool|email|tel|password|weekdays|checkboxes
 */
export function buildForm(fields, values = {}, { onScan } = {}) {
  const inputs = {};
  const errs = {};
  const el = h('div', { class: 'form' });
  for (const f of fields) {
    if (f.hidden) continue;
    const id = 'f_' + f.name + '_' + Math.random().toString(36).slice(2, 7);
    let v = values[f.name] ?? (f.default === 'today' ? todayYmd() : f.default ?? '');
    let input;
    switch (f.type) {
      case 'textarea': input = h('textarea', { id, placeholder: f.placeholder, rows: f.rows || 3 }); input.value = v ?? ''; break;
      case 'select': case 'ref': {
        const opts = f.type === 'ref' ? (f.refOptions || []) : f.options;
        input = h('select', { id }, f.required && f.type !== 'ref' ? null : h('option', { value: '' }, f.emptyLabel || '– bitte wählen –'),
          opts.map((o) => h('option', { value: o.value, selected: String(o.value) === String(v) }, o.label)));
        if (f.required && f.type === 'ref' && !v) input.prepend(h('option', { value: '', selected: true }, '– bitte wählen –'));
        break;
      }
      case 'bool': input = h('input', { id, type: 'checkbox', checked: v === 1 || v === true || v === '1' }); break;
      case 'number': case 'money': input = h('input', { id, type: 'text', inputmode: 'decimal', placeholder: f.placeholder, value: v === null || v === '' ? '' : String(v).replace('.', ',') }); break;
      case 'datetime': {
        const d = h('input', { type: 'date', value: v ? ymdOf(v) : '' });
        const t = h('input', { type: 'time', value: v ? hmOf(v) : '' });
        input = h('div', { class: 'input-with-btn', id }, d, t);
        input._get = () => (d.value ? berlinToIso(d.value, t.value || '00:00') : '');
        break;
      }
      case 'month':
        input = h('input', { id, type: 'month', placeholder: 'JJJJ-MM', value: v ?? '', pattern: '\\d{4}-\\d{2}' });
        break;
      case 'dayhours': {
        // Soll-Stunden je Wochentag (Speicherung in Minuten)
        let arr = [0, 0, 0, 0, 0, 0, 0];
        try { arr = Array.isArray(v) ? v : JSON.parse(v || '[0,0,0,0,0,0,0]'); } catch { /* Standard */ }
        const cells = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'].map((lab, i) => {
          const inp = h('input', { type: 'text', inputmode: 'decimal', value: String(Math.round(((+arr[i] || 0) / 60) * 100) / 100).replace('.', ','), 'aria-label': lab, style: { textAlign: 'center', padding: '8px 4px' } });
          return { inp, el: h('label', { style: { display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '.8rem', fontWeight: 650, textAlign: 'center' } }, lab, inp) };
        });
        const sum = h('div', { class: 'help' });
        const upd = () => { const t = cells.reduce((s2, c) => s2 + (+c.inp.value.replace(',', '.') || 0), 0); sum.textContent = `Summe: ${String(Math.round(t * 100) / 100).replace('.', ',')} Std./Woche`; };
        cells.forEach((c) => c.inp.addEventListener('input', upd)); upd();
        input = h('div', { id }, h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '6px' } }, cells.map((c) => c.el)), sum);
        input._get = () => cells.map((c) => Math.round((+c.inp.value.replace(',', '.') || 0) * 60));
        break;
      }
      case 'weekdays': {
        const set = new Set(String(v || '').split(',').filter(Boolean).map(Number));
        input = h('div', { class: 'weekday-picker', id });
        for (const [num, lab] of [[1, 'Mo'], [2, 'Di'], [3, 'Mi'], [4, 'Do'], [5, 'Fr'], [6, 'Sa'], [0, 'So']]) {
          const cb = h('input', { type: 'checkbox', value: num, checked: set.has(num) });
          const l = h('label', { class: set.has(num) ? 'on' : '' }, cb, lab);
          cb.addEventListener('change', () => l.classList.toggle('on', cb.checked));
          input.append(l);
        }
        input._get = () => [...input.querySelectorAll('input:checked')].map((c) => +c.value);
        break;
      }
      case 'checkboxes': {
        const set = new Set(Array.isArray(v) ? v : []);
        input = h('div', { id, style: { display: 'flex', flexDirection: 'column' } },
          (f.options || []).map((o) => h('label', { class: 'check' }, h('input', { type: 'checkbox', value: o.value, checked: set.has(o.value) }), o.label)));
        if (!f.options?.length) input.append(h('span', { class: 'muted small' }, f.emptyText || 'Keine Einträge vorhanden.'));
        input._get = () => [...input.querySelectorAll('input:checked')].map((c) => c.value);
        break;
      }
      default:
        input = h('input', { id, type: f.type === 'tel' ? 'tel' : f.type === 'email' ? 'email' : f.type === 'password' ? 'password' : f.type === 'date' ? 'date' : f.type === 'time' ? 'time' : 'text', placeholder: f.placeholder, value: v ?? '', autocomplete: f.autocomplete || 'off', inputmode: f.inputmode });
        if (f.scan) input.dataset.scanTarget = '1';
    }
    if (f.readonly) input.disabled = true;
    inputs[f.name] = input;
    const err = h('div', { class: 'err hidden' });
    errs[f.name] = err;
    let control = input;
    if (f.scan && onScan) control = h('div', { class: 'input-with-btn' }, input, h('button', { class: 'btn icon-btn', type: 'button', title: 'Mit Kamera scannen', onclick: () => onScan(input) }, ic('scan')));
    if (f.type === 'bool') {
      el.append(h('div', { class: 'field' + (f.half ? ' half' : '') }, h('label', { class: 'check', for: id }, input, f.label), f.help ? h('div', { class: 'help' }, f.help) : null));
    } else {
      el.append(h('div', { class: 'field' + (f.half ? ' half' : '') + (f.third ? ' third' : '') },
        h('label', { for: id }, f.label, f.required ? h('span', { class: 'req' }, ' *') : null), control,
        f.help ? h('div', { class: 'help' }, f.help) : null, err));
    }
  }
  const read = (f) => {
    const i = inputs[f.name];
    if (!i) return undefined;
    if (i._get) return i._get();
    if (f.type === 'bool') return i.checked ? 1 : 0;
    if (f.type === 'number' || f.type === 'money') { let s = i.value.trim(); if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.'); return s === '' ? null : Number(s); }
    return i.value.trim();
  };
  return {
    el, inputs,
    values() { const o = {}; for (const f of fields) if (!f.hidden && inputs[f.name]) o[f.name] = read(f); return o; },
    check() {
      let ok = true;
      for (const f of fields) {
        if (f.hidden || !inputs[f.name]) continue;
        const v = read(f);
        let msg = '';
        if (f.required && (v === '' || v === null || (Array.isArray(v) && !v.length))) msg = 'Pflichtfeld';
        else if ((f.type === 'number' || f.type === 'money') && v !== null && !isFinite(v)) msg = 'Bitte eine Zahl eingeben';
        else if (f.type === 'email' && v && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) msg = 'Ungültige E-Mail-Adresse';
        errs[f.name].textContent = msg;
        errs[f.name].classList.toggle('hidden', !msg);
        if (msg) ok = false;
      }
      if (!ok) toast('Bitte prüfen Sie die markierten Felder.', 'bad');
      return ok;
    },
  };
}

// ---------- Bausteine ----------
export function pageHead(title, { sub, back, actions = [] } = {}) {
  return h('div', null,
    back ? h('a', { class: 'back-link', href: back }, ic('back'), 'Zurück') : null,
    h('div', { class: 'page-head' }, h('div', { class: 'titles' }, h('h1', null, title), sub ? h('div', { class: 'sub' }, sub) : null),
      actions.length ? h('div', { class: 'actions' }, actions) : null));
}

export function btn(label, { icon: i, cls = '', onclick, href, title, disabled } = {}) {
  if (href) return h('a', { class: `btn ${cls}`, href, title }, i ? ic(i) : null, label);
  return h('button', { class: `btn ${cls}`, type: 'button', onclick, title, disabled }, i ? ic(i) : null, label);
}

export function card(title, content, { actions, iconName } = {}) {
  return h('div', { class: 'card' },
    title ? h('div', { class: 'card-head' }, h('h2', null, iconName ? ic(iconName) : null, title), actions ? h('div', { class: 'btn-row' }, actions) : null) : null,
    content);
}

export function empty(text, iconName = 'info') {
  return h('div', { class: 'empty' }, ic(iconName), text);
}

export function row({ title, meta, lead, right, href, onclick }) {
  const inner = [lead ?? null, h('div', { class: 'grow' }, h('div', { class: 'title' }, title), meta ? h('div', { class: 'meta' }, meta) : null), right ?? null, href || onclick ? ic('chevron', 'chev') : null];
  return href ? h('a', { class: 'row', href }, inner) : h('div', { class: 'row', onclick, role: onclick ? 'button' : null, tabindex: onclick ? '0' : null }, inner);
}

export function badge(text, kind = '') { return h('span', { class: `badge ${kind}` }, text); }

export function kv(pairs) {
  return h('div', { class: 'kv' }, pairs.filter((p) => p && p[1] !== undefined && p[1] !== null && p[1] !== '').map(([k, v, full]) =>
    h('div', { class: full ? 'full' : '' }, h('div', { class: 'k' }, k), h('div', { class: 'v' }, v))));
}

export function tabs(list, active, onSelect) {
  return h('div', { class: 'tabs', role: 'tablist' }, list.map((t) => h('button', {
    class: t.key === active ? 'active' : '', role: 'tab', 'aria-selected': t.key === active ? 'true' : 'false', onclick: () => onSelect(t.key),
  }, t.label, t.count !== undefined ? h('span', { class: 'count' }, t.count) : null)));
}

export function loading(text = 'Wird geladen …') { return h('div', { class: 'loading' }, h('span', { class: 'spinner' }), text); }

export function searchBox(placeholder, oninput, value = '') {
  const i = h('input', { type: 'search', placeholder, value, 'aria-label': placeholder });
  let t;
  i.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => oninput(i.value.trim().toLowerCase()), 120); });
  return h('div', { class: 'search' }, ic('search'), i);
}

export function matches(row, fields, q) {
  if (!q) return true;
  return fields.some((f) => String(row[f] ?? '').toLowerCase().includes(q));
}

export function openUrl(url) { window.open(url, '_blank', 'noopener'); }
