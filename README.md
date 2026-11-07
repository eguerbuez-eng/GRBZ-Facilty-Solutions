# GRBZ Facility Management System

Unternehmenssoftware für **GRBZ Facility Solutions** (Gebäudereinigung & Facility Management).
Installierbare, offlinefähige Progressive Web App (PWA) – optimiert für den **Honeywell ScanPal EDA52**, nutzbar auf Android, iPhone, Tablet, Windows-PC und Mac.

Alles auf Deutsch · Euro · Datum TT.MM.JJJJ · Zeitzone Europe/Berlin.

## Funktionsumfang (implementiert)

| Modul | Inhalt |
|---|---|
| Dashboard | Kennzahlen aus der Datenbank (Kunden, Objekte, offene/erledigte/heutige/überfällige Aufträge, Mängel, Mitarbeiterstatus, Materialwarnungen, Wartungen, Zeitkorrekturen), Schnellzugriffe, letzte Aktivitäten |
| Kunden (CRM) | Kundenakte, Kundennummer, Vertragsstatus, Dienstleistungen, Kontakthistorie, Objekte, Aufträge, Dokumente, Änderungshistorie, Archivierung, Suche |
| Objekte | Objektakte mit Objekt-ID `GRBZ-OBJ-0001`, Zugangshinweise, Mitarbeiterzuordnung, Aufträge, QR-Codes, Fotos, Mängel, Winterdienstflächen, Dokumente, Historie |
| QR-Code-System | Automatischer Objekt-QR, Bereichs-QR (Eingang, Treppenhaus, Keller …), Maschinen-/Inventar-QR, SVG/PNG-Download, PDF-Etiketten (klein/groß), Neuzuordnung, Deaktivierung, Scan-Historie, nicht erratbare Kennungen, serverseitige Rechteprüfung |
| Scannen | Hardware-Scanner (Keyboard-Wedge, EDA52) und Kamera (BarcodeDetector bzw. jsQR); auch Hersteller-Barcodes (EAN) von Artikeln |
| Aufträge | Auftragsnummer, Status (Geplant, In Bearbeitung, Abgeschlossen, Unterbrochen, Mangel festgestellt), Serienaufträge (täglich, 2× wöchentlich, wöchentlich, 14-tägig, monatlich, individuell) |
| Checklisten | Editor je Dienstleistung, Pflichtpunkte, Pflichtfotos; Ergebnisse Erledigt / Nicht erledigt / Nicht zutreffend / Mangel + Kommentar + Foto; Abschluss erst bei vollständigen Angaben |
| Fotos | Vorher/Nachher/Schaden/Mangel, Kommentar, Zeitstempel, Zuordnung zu Objekt/Auftrag/Checklistenpunkt/Mangel/Einsatz/Maschine; offline gespeichert, später hochgeladen; EXIF/GPS wird entfernt; Kundenfreigabe |
| Personal | Mitarbeiter-ID, Rollen (Administrator, Geschäftsführer, Objektleiter, Mitarbeiter), Rechtematrix, Objektzuordnung, Einmalpasswörter |
| Zeiterfassung | Beginn/Pause/Ende (auch offline), objekt- und auftragsbezogen, Monatsübersicht, Korrekturantrag mit Genehmigung und lückenlosem Protokoll, PDF/CSV |
| Material | Artikel, Barcode, Bestand, Mindestbestand mit Warnung, Preise, Lieferant, Lagerort, Bewegungen (Verbrauch, Zugang, Inventur, Korrektur) |
| Maschinen | Maschinenakte, Wartungen, Prüfungen, Reparaturen, Defektmeldungen, automatische Wartungsfälligkeit, Fotos, Wartungsbericht |
| Qualität | Objektkontrollen mit Bewertung (0–5 → %), Mängel/Reklamationen/Schäden mit Verantwortlichem, Frist, Maßnahmen, Erledigungsnachweis, Abnahme, vollständigem Verlauf |
| Winterdienst | Einsatzflächen, Bereitschaftszeiten, Einsatzprotokoll (Beginn/Ende, Wetter, Temperatur, Schneehöhe, Flächen, Streumittel/-menge, Fotos), Unterschrift, Saisonübersicht |
| Dokumente | Upload (PDF, Bilder, Office), Zuordnung zu Kunde/Objekt/Maschine, Kundenfreigabe, Berichte direkt als Dokument ablegen |
| Berichte | PDF mit GRBZ-Branding: Leistungsnachweis, Objektkontrollbericht, Monatsbericht, Fotodokumentation, Qualitätsbericht, Winterdienstprotokoll + Saison, Maschinenwartungsbericht, Arbeitszeitnachweis; CSV-Exporte |
| Kundenportal | Optional (standardmäßig **deaktiviert**): eigene Objekte, Leistungsnachweise, freigegebene Fotos/Berichte/Dokumente, Reklamationen |
| Offline & Sync | Lokales Datenreplikat (IndexedDB), Warteschlange, automatische Synchronisation, Duplikatschutz, Konflikterkennung, Statusanzeige |

Offene Punkte und Einschränkungen: [`docs/OFFENE-PUNKTE.md`](docs/OFFENE-PUNKTE.md).

## Schnellstart

Voraussetzung: **Node.js ≥ 22.13** (enthält die verwendete SQLite-Datenbank `node:sqlite`). Keine weitere Datenbank nötig.

```bash
npm install
npm start            # http://localhost:3000
```

Beim ersten Start wird ein Administratorzugang angelegt. Das Einmalpasswort steht in `data/ERSTZUGANG.txt`
(E-Mail `admin@grbz.local`). Alternativ vorgeben:

```bash
GRBZ_ADMIN_EMAIL=e.guerbuez@grbz-solutions.com GRBZ_ADMIN_PASSWORD='Sicheres-Startpasswort-1' npm start
```

Das Passwort muss bei der ersten Anmeldung geändert werden. Die Datei `ERSTZUGANG.txt` danach löschen.
Notfallzugang: `npm run create-admin -- name@firma.de`.

Wichtig: Kamera, Service Worker und Installation als App funktionieren nur über **HTTPS** (Ausnahme: `localhost`).
Für Tests mit dem EDA52 im lokalen Netz siehe [`docs/INSTALLATION.md`](docs/INSTALLATION.md).

## Dokumentation

| Dokument | Inhalt |
|---|---|
| [docs/INSTALLATION.md](docs/INSTALLATION.md) | Serverbetrieb, HTTPS, Reverse-Proxy, Datensicherung, Updates, Ersteinrichtung |
| [docs/HONEYWELL-EDA52.md](docs/HONEYWELL-EDA52.md) | Einrichtung des EDA52, App-Installation, **Scanner-Konfiguration (Keyboard Wedge)**, **Offline-Einrichtung** |
| [docs/ARCHITEKTUR.md](docs/ARCHITEKTUR.md) | Architektur, Technologieentscheidungen, Datenbankmodell, Synchronisationslogik |
| [docs/DATENSCHUTZ-SICHERHEIT.md](docs/DATENSCHUTZ-SICHERHEIT.md) | Umgesetzte Maßnahmen, Lösch-/Aufbewahrungskonzept, Prüfpunkte vor dem Produktivbetrieb |
| [docs/TESTPROTOKOLL.md](docs/TESTPROTOKOLL.md) | Automatisierte Tests und Ergebnisse |
| [docs/OFFENE-PUNKTE.md](docs/OFFENE-PUNKTE.md) | Noch nicht umgesetzte Funktionen und bekannte Einschränkungen |
| [server/schema.sql](server/schema.sql) | Datenbankstruktur |

## Tests

```bash
npm test             # 40 API-/Integrationstests (echte Datenbank, echter HTTP-Server)
npm run test:e2e     # Browser-End-to-End inkl. Offline-Ablauf (benötigt Playwright + Chromium)
```

## Projektstruktur

```
server/   Backend (Express, SQLite, Befehle, Rechte, Berichte)
shared/   Gemeinsamer Code Server/Client (Rollen, Regeln, Datumsformate, Entitäten)
public/   PWA (ohne Build-Schritt): index.html, sw.js, css/, js/, js/views/
tests/    Integrationstests (node:test)
tests-e2e/ Browser-Test (Playwright)
docs/     Dokumentation
data/     Laufzeitdaten: Datenbank, Uploads, Sicherungen (nicht im Git)
```
