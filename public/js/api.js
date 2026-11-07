// HTTP-Zugriff auf die API. Netzwerkfehler werden als "offline" gekennzeichnet.
export class ApiError extends Error {
  constructor(message, { status = 0, offline = false, details, data } = {}) {
    super(message);
    Object.assign(this, { status, offline, details, data });
  }
}

export async function api(method, url, body, { timeout = 20000 } = {}) {
  const headers = { 'X-GRBZ': '1' };
  let payload;
  if (body instanceof FormData) payload = body;
  else if (body !== undefined) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeout);
  let res;
  try {
    res = await fetch(url, { method, headers, body: payload, credentials: 'same-origin', signal: ctl.signal, cache: 'no-store' });
  } catch {
    throw new ApiError('Keine Verbindung zum Server. Die Daten werden gespeichert und später übertragen.', { offline: true });
  } finally {
    clearTimeout(timer);
  }
  const type = res.headers.get('content-type') || '';
  const data = type.includes('application/json') ? await res.json().catch(() => ({})) : null;
  if (!res.ok) {
    // Service Worker meldet "offline" mit 503 + offline-Flag
    if (res.status === 503 && data?.offline) throw new ApiError('Keine Verbindung zum Server.', { offline: true, status: 503 });
    throw new ApiError(data?.error || `Fehler ${res.status}`, { status: res.status, details: data?.details, data });
  }
  return data ?? res;
}

export const get = (u) => api('GET', u);
export const post = (u, b) => api('POST', u, b ?? {});
export const put = (u, b) => api('PUT', u, b);
