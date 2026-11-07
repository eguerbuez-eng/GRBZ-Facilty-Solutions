// Minimaler IndexedDB-Wrapper (lokaler Offline-Speicher).
import { SYNC_TABLES } from '/shared/entities.js';

const NAME = 'grbz-fms';
const VERSION = 1;
let dbp;

export function openIdb() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open(NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const t of SYNC_TABLES) if (!db.objectStoreNames.contains(t)) db.createObjectStore(t, { keyPath: 'id' });
      if (!db.objectStoreNames.contains('outbox')) db.createObjectStore('outbox', { keyPath: 'n', autoIncrement: true });
      for (const s of ['blobs', 'conflicts', 'failed']) if (!db.objectStoreNames.contains(s)) db.createObjectStore(s, { keyPath: 'id' });
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'key' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbp;
}

function wrap(r) { return new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); }

export async function idbAll(store) {
  const db = await openIdb();
  return wrap(db.transaction(store).objectStore(store).getAll());
}
export async function idbGet(store, key) {
  const db = await openIdb();
  return wrap(db.transaction(store).objectStore(store).get(key));
}
export async function idbPut(store, value) {
  const db = await openIdb();
  return wrap(db.transaction(store, 'readwrite').objectStore(store).put(value));
}
export async function idbDel(store, key) {
  const db = await openIdb();
  return wrap(db.transaction(store, 'readwrite').objectStore(store).delete(key));
}
export async function idbClear(store) {
  const db = await openIdb();
  return wrap(db.transaction(store, 'readwrite').objectStore(store).clear());
}
/** Mehrere Schreib-/Löschvorgänge in einer Transaktion: ops = [[store, 'put'|'del', value|key]] */
export async function idbBatch(ops) {
  if (!ops.length) return;
  const db = await openIdb();
  const stores = [...new Set(ops.map((o) => o[0]))];
  const tx = db.transaction(stores, 'readwrite');
  for (const [s, kind, v] of ops) kind === 'put' ? tx.objectStore(s).put(v) : tx.objectStore(s).delete(v);
  return new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = () => rej(tx.error); tx.onabort = () => rej(tx.error); });
}
export async function metaGet(key, fallback = null) { const r = await idbGet('meta', key); return r ? r.value : fallback; }
export async function metaSet(key, value) { return idbPut('meta', { key, value }); }
