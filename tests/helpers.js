import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { createApp } from '../server/app.js';

export const ADMIN = { email: 'admin@test.local', password: 'Start-Passwort-2026' };

export async function startServer() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'grbz-test-'));
  process.env.GRBZ_ADMIN_EMAIL = ADMIN.email;
  process.env.GRBZ_ADMIN_PASSWORD = ADMIN.password;
  const app = createApp({ dataDir, log: () => {}, startTimers: false });
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    app, base, dataDir, db: app.locals.db,
    async stop() { await new Promise((r) => server.close(r)); app.locals.close(); fs.rmSync(dataDir, { recursive: true, force: true }); },
  };
}

export class Client {
  constructor(base) { this.base = base; this.cookie = ''; }
  async req(method, url, body, { raw = false, headers = {} } = {}) {
    const h = { 'X-GRBZ': '1', ...headers };
    if (this.cookie) h.Cookie = this.cookie;
    let payload;
    if (body instanceof FormData) payload = body;
    else if (body !== undefined) { h['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
    const res = await fetch(this.base + url, { method, headers: h, body: payload, redirect: 'manual' });
    const sc = res.headers.get('set-cookie');
    if (sc) this.cookie = sc.split(';')[0];
    if (raw) return res;
    const text = await res.text();
    let data; try { data = JSON.parse(text); } catch { data = text; }
    return { status: res.status, data };
  }
  get(u) { return this.req('GET', u); }
  post(u, b) { return this.req('POST', u, b ?? {}); }
  put(u, b) { return this.req('PUT', u, b); }
  async login(email, password) {
    const r = await this.post('/api/auth/login', { email, password });
    if (r.status !== 200) throw new Error('Login fehlgeschlagen: ' + JSON.stringify(r.data));
    return r.data.user;
  }
  async loginAdmin() {
    const u = await this.login(ADMIN.email, ADMIN.password);
    if (u.must_change_password) {
      const r = await this.post('/api/auth/password', { current: ADMIN.password, next: ADMIN.password + 'X1' });
      if (r.status !== 200) throw new Error(JSON.stringify(r.data));
      ADMIN.password += 'X1';
    }
    return u;
  }
  /** Einzelnen Befehl über den Sync-Endpunkt ausführen */
  async cmd(type, payload, opId = crypto.randomUUID()) {
    const r = await this.post('/api/sync/push', { ops: [{ op_id: opId, type, payload }] });
    if (r.status !== 200) throw new Error(JSON.stringify(r.data));
    return r.data.results[0];
  }
  async ok(type, payload) {
    const r = await this.cmd(type, payload);
    if (r.status !== 'ok') throw new Error(`${type}: ${r.error} ${JSON.stringify(r.details || '')}`);
    return r.result;
  }
}

export async function makeEmployee(admin, { email = `ma${Date.now()}${Math.random().toString(36).slice(2, 6)}@test.local`, role = 'mitarbeiter', customer_id } = {}) {
  const r = await admin.post('/api/users', { name: 'Test ' + role, email, role, password: 'Mitarbeiter-2026', customer_id });
  if (r.status !== 200) throw new Error(JSON.stringify(r.data));
  return { user: r.data.user, email, password: 'Mitarbeiter-2026' };
}

export async function loginAs(base, emp) {
  const c = new Client(base);
  await c.login(emp.email, emp.password);
  // Pflicht-Passwortwechsel beim ersten Login
  const r = await c.post('/api/auth/password', { current: emp.password, next: emp.password + 'N1' });
  if (r.status !== 200) throw new Error(JSON.stringify(r.data));
  emp.password += 'N1';
  return c;
}

export const uid = () => crypto.randomUUID();
