// Prüft, dass alle App-Dateien im Offline-Cache des Service Workers enthalten sind.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const sw = fs.readFileSync(path.join(root, 'public/sw.js'), 'utf8');
const walk = (d, base) => fs.readdirSync(d, { withFileTypes: true }).flatMap((f) => (f.isDirectory() ? walk(path.join(d, f.name), `${base}/${f.name}`) : [`${base}/${f.name}`]));

test('alle JS-/Shared-Dateien sind im Service-Worker-Precache', () => {
  const files = [...walk(path.join(root, 'public/js'), '/js'), ...walk(path.join(root, 'shared'), '/shared'), '/css/app.css', '/index.html', '/vendor/jsQR.js'];
  for (const f of files) assert.ok(sw.includes(`'${f}'`), `${f} fehlt in public/sw.js (PRECACHE)`);
});

test('Manifest ist für Installation als App geeignet', () => {
  const m = JSON.parse(fs.readFileSync(path.join(root, 'public/manifest.webmanifest'), 'utf8'));
  assert.equal(m.display, 'standalone');
  assert.equal(m.lang, 'de-DE');
  assert.ok(m.icons.some((i) => i.sizes === '512x512' && i.purpose === 'maskable'));
  for (const i of m.icons) assert.ok(fs.existsSync(path.join(root, 'public', i.src)), i.src);
});
