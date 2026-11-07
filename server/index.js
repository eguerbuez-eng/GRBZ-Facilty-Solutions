// Startpunkt: node server/index.js  (Konfiguration über Umgebungsvariablen)
import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import { createApp, VERSION } from './app.js';

const port = +(process.env.PORT || 3000);
const host = process.env.HOST || '0.0.0.0';
const dataDir = process.env.GRBZ_DATA_DIR ? path.resolve(process.env.GRBZ_DATA_DIR) : undefined;
const app = createApp({ dataDir });

let server;
if (process.env.GRBZ_TLS_CERT && process.env.GRBZ_TLS_KEY) {
  // Direkter HTTPS-Betrieb (z. B. im lokalen Netz). Produktiv empfohlen: Reverse-Proxy (Caddy/nginx).
  server = https.createServer({ cert: fs.readFileSync(process.env.GRBZ_TLS_CERT), key: fs.readFileSync(process.env.GRBZ_TLS_KEY) }, app);
} else {
  server = http.createServer(app);
}
server.listen(port, host, () => {
  console.log(`GRBZ Facility Management System ${VERSION} läuft auf ${server instanceof https.Server ? 'https' : 'http'}://${host}:${port}`);
});

const shutdown = () => { server.close(() => { app.locals.close(); process.exit(0); }); setTimeout(() => process.exit(0), 5000).unref(); };
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
