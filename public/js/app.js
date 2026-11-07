// App-Shell: Anmeldung, Navigation, Router, Sync-Anzeige.
import { h, ic, clear, toast, errorToast, loading, modal, buildForm } from './ui.js';
import * as store from './store.js';
import { api } from './api.js';
import { installWedge, onScan } from './scanner.js';
import { can, ROLES } from '/shared/constants.js';
import { fmtDateTime } from '/shared/dates.js';
import { handleScan } from './views/qr.js';
import { routes } from './routes.js';

const app = document.getElementById('app');
let settings = { company_name: 'GRBZ Facility Solutions', has_logo: false };
let mainEl; let syncEl; let navEls = [];
let current = { path: null, render: null };

export const NAV = [
  { group: 'Arbeit' },
  { href: '#/', label: 'Start', icon: 'home', perm: 'dashboard.view' },
  { href: '#/auftraege', label: 'Aufträge', icon: 'list', perm: 'orders.read' },
  { href: '#/scan', label: 'QR-Code scannen', icon: 'scan', perm: 'qr.scan' },
  { href: '#/zeit', label: 'Zeiterfassung', icon: 'clock', perm: 'time.own' },
  { href: '#/qualitaet', label: 'Qualität & Mängel', icon: 'shield', perm: ['quality.read', 'defects.report'] },
  { href: '#/winter', label: 'Winterdienst', icon: 'snow', perm: 'winter.read' },
  { group: 'Stammdaten' },
  { href: '#/kunden', label: 'Kunden', icon: 'briefcase', perm: 'customers.read' },
  { href: '#/objekte', label: 'Objekte', icon: 'building', perm: 'objects.read' },
  { href: '#/qr', label: 'QR-Codes', icon: 'qr', perm: 'qr.manage' },
  { href: '#/mitarbeiter', label: 'Mitarbeiter', icon: 'users', perm: 'users.read' },
  { href: '#/material', label: 'Material', icon: 'box', perm: 'materials.read' },
  { href: '#/maschinen', label: 'Maschinen', icon: 'wrench', perm: 'machines.read' },
  { group: 'Planung & Auswertung' },
  { href: '#/serien', label: 'Serienaufträge', icon: 'repeat', perm: 'orders.write' },
  { href: '#/checklisten', label: 'Checklisten', icon: 'checkCircle', perm: 'checklists.manage' },
  { href: '#/dokumente', label: 'Dokumente', icon: 'file', perm: 'documents.read' },
  { href: '#/berichte', label: 'Berichte & Exporte', icon: 'chart', perm: 'reports.create' },
  { group: 'System' },
  { href: '#/einstellungen', label: 'Einstellungen', icon: 'settings', perm: 'settings.manage' },
  { href: '#/protokoll', label: 'Änderungsprotokoll', icon: 'history', perm: 'audit.read' },
  { href: '#/sync', label: 'Synchronisation', icon: 'sync' },
  { href: '#/konto', label: 'Mein Konto', icon: 'user' },
];

export const allowed = (item) => !item.perm || [].concat(item.perm).some((p) => can(store.getUser(), p));
export const getSettings = () => settings;

async function boot() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch((e) => console.warn('Service Worker:', e));
    navigator.serviceWorker.addEventListener('controllerchange', () => { if (window.__swReloaded) return; window.__swReloaded = true; });
  }
  if (navigator.storage?.persist) navigator.storage.persist().catch(() => {});
  await store.init();
  installWedge();
  onScan((code, method) => { if (store.getUser() && store.getUser().role !== 'kunde') handleScan(code, method); });
  try { settings = await api('GET', '/api/settings/public'); localStorage.setItem('grbz_settings', JSON.stringify(settings)); } catch {
    try { settings = JSON.parse(localStorage.getItem('grbz_settings')) || settings; } catch { /* Standard */ }
  }
  document.title = 'GRBZ Facility Management System';

  // QR-Link /q/<token> (z. B. Scan mit der normalen Handykamera)
  const qm = location.pathname.match(/^\/q\/([A-Za-z0-9_-]+)/);
  if (qm) { history.replaceState(null, '', '/#/q/' + qm[1]); }

  let user = store.getUser();
  try {
    const me = await api('GET', '/api/auth/me');
    user = me.user;
    await store.setUser(user);
  } catch (e) {
    if (!e.offline) user = null; // Sitzung abgelaufen → Anmeldung
  }
  if (!user) return showLogin();
  start();
}

function start() {
  const user = store.getUser();
  if (user.must_change_password) return showPasswordChange(true);
  if (user.role === 'kunde') { location.hash = '#/portal'; renderShell(true); route(); return; }
  renderShell();
  store.on((kind) => {
    if (kind === 'auth') return showLogin('Ihre Sitzung ist abgelaufen. Bitte erneut anmelden – nicht übertragene Daten bleiben erhalten.');
    renderSync();
    if (kind === 'data') rerenderSoon();
  });
  window.addEventListener('hashchange', route);
  route();
  if (!store.hasData()) store.pull(true).catch((e) => { if (!e.offline) errorToast(e); });
  else store.flush();
}

// ---------- Anmeldung ----------
function brandBlock() {
  return h('div', { class: 'login-brand' },
    settings.has_logo ? h('img', { src: '/api/branding/logo', alt: settings.company_name }) : h('div', { class: 'brand-mark' }, 'GRBZ'),
    h('div', { class: 't' }, 'Facility Management System'), h('div', { class: 's' }, settings.company_name || 'GRBZ Facility Solutions'));
}

function showLogin(message) {
  clear(app);
  const email = h('input', { type: 'email', autocomplete: 'username', placeholder: 'name@firma.de', required: true, id: 'login-email' });
  const pw = h('input', { type: 'password', autocomplete: 'current-password', required: true, id: 'login-pw' });
  const err = h('div', { class: 'notice bad hidden' });
  const submit = h('button', { class: 'btn primary block lg', type: 'submit' }, 'Anmelden');
  const form = h('form', {
    onsubmit: async (e) => {
      e.preventDefault();
      submit.disabled = true; err.classList.add('hidden');
      try {
        await store.login(email.value.trim(), pw.value);
        location.reload();
      } catch (ex) {
        err.textContent = ex.offline ? 'Keine Verbindung zum Server. Für die erste Anmeldung wird eine Internetverbindung benötigt.' : ex.message;
        err.classList.remove('hidden');
      } finally { submit.disabled = false; }
    },
  },
  h('div', { class: 'form' },
    h('div', { class: 'field' }, h('label', { for: 'login-email' }, 'E-Mail-Adresse'), email),
    h('div', { class: 'field' }, h('label', { for: 'login-pw' }, 'Passwort'), pw)),
  h('div', { style: { marginTop: '16px' } }, err), h('div', { style: { marginTop: '16px' } }, submit));
  app.append(h('div', { class: 'login' }, h('div', { class: 'login-card' }, brandBlock(),
    message ? h('div', { class: 'notice warn', style: { marginBottom: '14px' } }, message) : null, form,
    h('p', { class: 'tiny muted', style: { textAlign: 'center', marginTop: '18px' } }, 'Zugang nur für berechtigte Personen. Anmeldungen werden protokolliert.'))));
}

export function showPasswordChange(forced) {
  clear(app);
  const f = buildForm([
    { name: 'current', label: 'Aktuelles Passwort', type: 'password', required: true, autocomplete: 'current-password' },
    { name: 'next', label: 'Neues Passwort', type: 'password', required: true, autocomplete: 'new-password', help: 'Mindestens 10 Zeichen, Buchstaben und Ziffern.' },
    { name: 'next2', label: 'Neues Passwort wiederholen', type: 'password', required: true, autocomplete: 'new-password' },
  ]);
  const btnSave = h('button', { class: 'btn primary block lg', type: 'button', onclick: async () => {
    if (!f.check()) return;
    const v = f.values();
    if (v.next !== v.next2) return toast('Die neuen Passwörter stimmen nicht überein.', 'bad');
    btnSave.disabled = true;
    try {
      await api('POST', '/api/auth/password', { current: v.current, next: v.next });
      toast('Passwort geändert.');
      await store.setUser({ ...store.getUser(), must_change_password: false });
      location.reload();
    } catch (e) { errorToast(e); } finally { btnSave.disabled = false; }
  } }, 'Passwort speichern');
  app.append(h('div', { class: 'login' }, h('div', { class: 'login-card' }, brandBlock(),
    forced ? h('div', { class: 'notice warn', style: { marginBottom: '14px' } }, 'Bitte vergeben Sie vor der ersten Nutzung ein eigenes Passwort.') : null,
    f.el, h('div', { style: { marginTop: '18px' } }, btnSave),
    h('div', { style: { marginTop: '10px' } }, h('button', { class: 'btn ghost block', onclick: async () => { await store.logout(true).catch(() => {}); location.reload(); } }, 'Abmelden')))));
}

// ---------- Layout ----------
function renderShell(portal = false) {
  clear(app);
  const user = store.getUser();
  syncEl = h('button', { class: 'top-btn', 'aria-label': 'Synchronisationsstatus', onclick: () => { location.hash = '#/sync'; } });
  const top = h('header', { class: 'topbar' },
    h('a', { class: 'brand', href: portal ? '#/portal' : '#/' },
      settings.has_logo ? h('img', { class: 'brand-logo', src: '/api/branding/logo', alt: '' }) : h('span', { class: 'brand-mark' }, 'GRBZ'),
      h('span', { class: 'brand-title' }, portal ? 'Kundenportal' : 'Facility Management')),
    portal ? null : syncEl,
    portal ? null : (can(user, 'qr.scan') ? h('a', { class: 'top-btn', href: '#/scan', 'aria-label': 'Scannen' }, ic('scan')) : null),
    h('a', { class: 'top-btn', href: portal ? '#/portal/konto' : '#/konto', 'aria-label': 'Mein Konto' }, ic('user')));
  mainEl = h('main', { class: 'main', id: 'main', tabindex: '-1' });
  navEls = [];
  const side = h('nav', { class: 'sidebar', 'aria-label': 'Hauptnavigation' });
  if (!portal) {
    let pendingGroup = null;
    for (const item of NAV) {
      if (item.group) { pendingGroup = item.group; continue; }
      if (!allowed(item)) continue;
      if (pendingGroup) { side.append(h('div', { class: 'nav-group' }, pendingGroup)); pendingGroup = null; }
      const a = h('a', { href: item.href }, ic(item.icon), item.label);
      navEls.push(a); side.append(a);
    }
    side.append(h('div', { class: 'tiny muted', style: { padding: '16px 12px 4px' } }, `${user.name} · ${ROLES[user.role]}`));
  }
  const bottom = portal ? null : h('nav', { class: 'bottomnav', 'aria-label': 'Schnellnavigation' },
    navLink('#/', 'Start', 'home'),
    can(user, 'orders.read') ? navLink('#/auftraege', 'Aufträge', 'list') : navLink('#/objekte', 'Objekte', 'building'),
    can(user, 'qr.scan') ? h('a', { href: '#/scan', class: 'scan-btn' }, h('span', { class: 'circle' }, ic('scan')), 'Scannen') : navLink('#/sync', 'Sync', 'sync'),
    can(user, 'time.own') ? navLink('#/zeit', 'Zeit', 'clock') : navLink('#/qualitaet', 'Qualität', 'shield'),
    navLink('#/menu', 'Menü', 'menu'));
  app.append(h('div', { class: 'shell' }, top, h('div', { class: 'body' }, side, mainEl), bottom));
  renderSync();
}

function navLink(href, label, iconName) {
  const a = h('a', { href }, ic(iconName), label);
  navEls.push(a);
  return a;
}

function renderSync() {
  if (!syncEl) return;
  const s = store.status;
  let cls = ''; let text;
  if (!s.online || !navigator.onLine) { cls = 'offline'; text = s.pending ? `Offline · ${s.pending}` : 'Offline'; }
  else if (s.syncing) { cls = 'busy'; text = 'Sync …'; }
  else if (s.failed || s.conflicts || s.lastError) { cls = 'error'; text = `Prüfen${s.failed + s.conflicts ? ' · ' + (s.failed + s.conflicts) : ''}`; }
  else if (s.pending) { cls = 'busy'; text = `${s.pending} offen`; }
  else text = 'Synchron';
  clear(syncEl).append(h('span', { class: `sync-pill ${cls}`, title: s.lastSync ? 'Letzte Synchronisation: ' + fmtDateTime(s.lastSync) : '' }, h('span', { class: 'dot' }), text));
}

// ---------- Router ----------
let rerenderTimer;
function rerenderSoon() {
  clearTimeout(rerenderTimer);
  rerenderTimer = setTimeout(() => {
    // nicht stören, während der Benutzer tippt oder ein Dialog offen ist
    const a = document.activeElement;
    if (document.querySelector('.modal-back') || (a && ['INPUT', 'TEXTAREA', 'SELECT'].includes(a.tagName) && !a.dataset.wedge)) return rerenderSoon();
    if (current.live) render(true);
  }, 300);
}

function matchRoute(path) {
  for (const r of routes) {
    const m = path.match(r.re);
    if (m) return { r, params: m.slice(1).map(decodeURIComponent) };
  }
  return null;
}

function route() {
  const hash = location.hash.slice(1) || '/';
  const [path, qs] = hash.split('?');
  current = { path, query: Object.fromEntries(new URLSearchParams(qs || '')), live: true };
  for (const a of navEls) {
    const href = a.getAttribute('href').slice(1);
    a.classList.toggle('active', href === '/' ? path === '/' : path.startsWith(href));
  }
  render(false);
  // Bei Navigation Daten auffrischen, wenn die letzte Synchronisation > 30 s zurückliegt
  const last = store.status.lastSync ? Date.parse(store.status.lastSync) : 0;
  if (navigator.onLine && Date.now() - last > 30000 && store.getUser()?.role !== 'kunde') store.flush();
}

async function render(keepScroll) {
  const found = matchRoute(current.path);
  const y = window.scrollY;
  const token = (current.token = Symbol('render'));
  if (!found) { clear(mainEl).append(h('div', { class: 'empty' }, 'Seite nicht gefunden.')); return; }
  if (found.r.perm && ![].concat(found.r.perm).some((p) => can(store.getUser(), p))) {
    clear(mainEl).append(h('div', { class: 'notice bad' }, ic('alert'), 'Für diesen Bereich fehlt Ihnen die Berechtigung.'));
    return;
  }
  if (!keepScroll) clear(mainEl).append(loading());
  try {
    const el = await found.r.view({ params: found.params, query: current.query, ctx: current });
    if (token !== current.token) return;
    current.live = found.r.live !== false;
    clear(mainEl).append(el);
    if (keepScroll) window.scrollTo(0, y); else window.scrollTo(0, 0);
  } catch (e) {
    console.error(e);
    if (token !== current.token) return;
    clear(mainEl).append(h('div', { class: 'notice bad' }, ic('alert'), e.offline ? 'Diese Ansicht benötigt eine Internetverbindung.' : (e.message || 'Fehler beim Laden.')));
  }
}

export function refresh() { render(true); }
export function go(hash) { if (location.hash === hash) render(false); else location.hash = hash; }
export function stopLive() { current.live = false; }

boot().catch((e) => {
  console.error(e);
  clear(app).append(h('div', { class: 'login' }, h('div', { class: 'login-card' }, h('div', { class: 'notice bad' }, 'Die Anwendung konnte nicht gestartet werden: ' + e.message))));
});

export { modal };
