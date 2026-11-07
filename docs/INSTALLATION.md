# Installation und Betrieb

## 1. Voraussetzungen

- Server oder PC mit Linux (empfohlen), Windows oder macOS
- **Node.js 22.13 oder neuer** (LTS). Prüfen: `node -v`
- Für den Produktivbetrieb: eine Domain (z. B. `fms.grbz-solutions.com`) und ein TLS-Zertifikat (z. B. kostenlos über Let's Encrypt)

Es wird **keine separate Datenbank** benötigt. Alle Daten liegen in `data/` (SQLite-Datei `grbz.sqlite` + Ordner `uploads/`).

## 2. Installation

```bash
git clone <repository> grbz-fms
cd grbz-fms
npm install --omit=dev
npm start
```

### Umgebungsvariablen

| Variable | Standard | Bedeutung |
|---|---|---|
| `PORT` | `3000` | HTTP-Port |
| `HOST` | `0.0.0.0` | Bind-Adresse (hinter Reverse-Proxy: `127.0.0.1`) |
| `GRBZ_DATA_DIR` | `./data` | Speicherort für Datenbank, Uploads, Sicherungen |
| `GRBZ_ADMIN_EMAIL` | `admin@grbz.local` | E-Mail des ersten Administrators (nur beim allerersten Start) |
| `GRBZ_ADMIN_PASSWORD` | zufällig | Startpasswort; ohne Angabe → `data/ERSTZUGANG.txt` |
| `GRBZ_TRUST_PROXY` | – | `1`, wenn hinter einem Reverse-Proxy betrieben (korrekte IP + HTTPS-Erkennung) |
| `GRBZ_TLS_CERT` / `GRBZ_TLS_KEY` | – | Pfade zu Zertifikat/Schlüssel für direkten HTTPS-Betrieb |
| `GRBZ_BACKUP_DIR` / `GRBZ_BACKUP_KEEP` | `data/backups` / `14` | Sicherungsziel und Anzahl aufbewahrter Sicherungen |

## 3. Produktivbetrieb (empfohlen: Reverse-Proxy mit HTTPS)

Beispiel mit **Caddy** (holt Zertifikate automatisch):

```
fms.grbz-solutions.com {
    reverse_proxy 127.0.0.1:3000
    request_body max_size 30MB
}
```

Dienst einrichten (systemd, `/etc/systemd/system/grbz-fms.service`):

```ini
[Unit]
Description=GRBZ Facility Management System
After=network.target

[Service]
WorkingDirectory=/opt/grbz-fms
Environment=PORT=3000 HOST=127.0.0.1 GRBZ_TRUST_PROXY=1 GRBZ_DATA_DIR=/var/lib/grbz-fms
ExecStart=/usr/bin/node --disable-warning=ExperimentalWarning server/index.js
User=grbz
Restart=always

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable --now grbz-fms
```

Danach in der App unter **Einstellungen → Öffentliche Adresse** `https://fms.grbz-solutions.com` eintragen.
**Wichtig:** Diese Adresse wird in die QR-Codes gedruckt. Sie muss vor dem Drucken der ersten Etiketten feststehen.

## 4. Test im lokalen Netz (ohne Domain)

Kamera und Service Worker benötigen HTTPS. Für einen Test mit dem EDA52 im WLAN:

```bash
# selbstsigniertes Zertifikat (nur für Tests)
openssl req -x509 -newkey rsa:2048 -nodes -days 365 -keyout key.pem -out cert.pem -subj "/CN=grbz-test" \
  -addext "subjectAltName=IP:192.168.1.50"
GRBZ_TLS_CERT=cert.pem GRBZ_TLS_KEY=key.pem PORT=8443 npm start
```

Auf dem Gerät `https://192.168.1.50:8443` öffnen und die Zertifikatswarnung bestätigen.
Hinweis: Mit selbstsignierten Zertifikaten installiert Chrome die PWA teilweise nur als Verknüpfung, und der Service Worker kann blockiert sein.
Für einen vollständigen Test (inkl. Offline) wird ein gültiges Zertifikat empfohlen (z. B. über eine echte Subdomain).

## 5. Ersteinrichtung in der App

1. Mit dem Erstzugang anmelden, eigenes Passwort vergeben.
2. **Einstellungen**: Firmenname, Adresse, öffentliche Adresse, Logo hochladen (PNG/JPEG).
3. **Mitarbeiter**: eigenen Benutzer als Geschäftsführer/Administrator anlegen; ggf. weitere Mitarbeiter (Einmalpasswörter werden einmalig angezeigt).
4. **Checklisten** prüfen/anpassen (Vorlagen für Unterhalts-, Treppenhaus-, Büro-, Kita-Reinigung und Hausmeisterservice sind angelegt).
5. **Kunden** und **Objekte** anlegen → je Objekt entsteht automatisch ein QR-Code.
6. **QR-Codes** drucken (Etikettenbogen oder A4 groß) und am Objekt anbringen.
7. Aufträge bzw. Serienaufträge planen.
8. Kundenportal nur bei Bedarf unter Einstellungen aktivieren.

## 6. Datensicherung

```bash
npm run backup        # erstellt data/backups/grbz-JJJJ-MM-TT-hh-mm/ (Datenbank + Uploads)
```

Empfohlen: täglich per Zeitplan, z. B. cron `30 2 * * * cd /opt/grbz-fms && npm run backup`.
Sicherungen zusätzlich **außer Haus** ablegen (z. B. verschlüsselt auf einen zweiten Server/Cloud-Speicher).

Wiederherstellung: Dienst stoppen, `grbz.sqlite` und `uploads/` aus der Sicherung nach `GRBZ_DATA_DIR` kopieren, Dienst starten.
Wiederherstellung regelmäßig testen.

## 7. Updates

```bash
git pull && npm install --omit=dev && sudo systemctl restart grbz-fms
```

Das Datenbankschema wird beim Start automatisch ergänzt (`CREATE … IF NOT EXISTS`). Die Geräte laden die neue App-Version
automatisch (der Service Worker erhält eine neue Versionskennung); nicht übertragene Offline-Daten bleiben erhalten.
Vor Updates immer eine Sicherung erstellen.
