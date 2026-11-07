# Testprotokoll

Stand: 07.11.2026 · Umgebung: Linux, Node.js 22.23, Chromium (Playwright, headless), Viewport 400×800 (Smartphone/EDA52-Größe) und 1280×800.

## 1. Integrationstests (`npm test`) – 40 von 40 bestanden

Echte SQLite-Datenbank und echter HTTP-Server je Testlauf.

| Bereich | Geprüft | Ergebnis |
|---|---|---|
| Anmeldung | falsches Passwort (deutsche Meldung), Zugriff ohne Anmeldung, Pflicht-Passwortwechsel, Passwortregeln, CSRF-Header, Kontosperre nach 5 Fehlversuchen | ✓ |
| Kundenanlage | Pflichtfeldprüfung, Kundennummer, Konflikterkennung (veraltete Version), Archivierung | ✓ |
| Objektanlage | Objekt-ID `GRBZ-OBJ-xxxx`, automatischer QR-Code, Token ohne Kundendaten, Zahlen mit Komma | ✓ |
| QR-Code-Erstellung/-Scanning | Scan per URL, Label, Objektnummer; unbekannter Code; Bereichs-QR; Deaktivierung; Neuzuordnung + Protokoll; SVG; Etiketten-PDF; `/q/`-Weiterleitung; Scan-Historie | ✓ |
| Auftragserstellung | Checkliste aus Dienstleistung übernommen, Auftragsnummer, Kunde abgeleitet | ✓ |
| Checklistenabschluss | Abschluss blockiert bei offenen Pflichtpunkten, fehlendem Kommentar, fehlendem Pflichtfoto; Mangel erzeugt automatisch Mangelvorgang | ✓ |
| Fotoupload | idempotent (kein Duplikat bei Wiederholung), Berechtigung (fremder Mitarbeiter: 404), Dateisignaturprüfung | ✓ |
| Berechtigungen | Zeilenfilter Mitarbeiter, keine Kundenkontaktdaten/Vertragsinfos/Passworthashes, Scan fremder Objekte, keine Benutzer-/Kundenverwaltung, Objektleiter darf keine Admins anlegen | ✓ |
| Synchronisation | doppelte `op_id` wird nicht erneut ausgeführt, offline erstellte Aufträge mit Client-ID, Delta-Pull, neu zugeordnetes Objekt erscheint im Delta | ✓ |
| Zeiterfassung | Beginn/Pause/Ende, Doppelstempel, Zukunftsschutz, Offline-Kennzeichnung, Korrekturantrag → Genehmigung mit Original-/Neuwert, PDF/CSV, fremde Zeiten gesperrt | ✓ |
| Material/Maschinen | Mindestbestandswarnung, Inventur, Wartungsintervall, Defektmeldung, Wartungsbericht | ✓ |
| Qualität | Bewertung (Score/Note), Mangel bis Abnahme mit Verlauf, Erledigungsnachweis Pflicht, Kontroll- und Qualitätsbericht | ✓ |
| Winterdienst | Einsatz, Unterschrift erst nach Ende/Tätigkeit, Sperre nach Unterschrift, Protokoll-PDF | ✓ |
| PDF-Erstellung | Leistungsnachweis, Ablage als Dokument, Monatsbericht, Fotodokumentation | ✓ |
| Kundenportal | deaktiviert → kein Login; aktiviert → nur eigene, freigegebene Daten, keine interne API, Reklamation nur für eigene Objekte | ✓ |
| Serienaufträge | Termine an gewählten Wochentagen, Neuerzeugung bei Änderung, Validierung | ✓ |
| Administration | Änderungsprotokoll, Datenbank-Backup | ✓ |
| PWA | alle App-Dateien im Offline-Cache, Manifest/Icons | ✓ |

## 2. Browser-End-to-End-Test (`npm run test:e2e`) – 11 von 11 Schritten bestanden

1. Anmeldung mit Pflicht-Passwortwechsel ✓
2. Service Worker aktiv, Manifest installierbar ✓
3. Kunde über Formular anlegen (Kundennummer nach Sync) ✓
4. Objekt anlegen → Objekt-ID, QR-Grafik lädt ✓
5. **Scanner-Simulation (Keyboard-Wedge, schnelle Tastatureingabe + Enter)** öffnet Objektakte, Scan protokolliert ✓
6. Auftrag mit Checkliste anlegen ✓
7. **Offline**: Auftrag starten inkl. Zeiterfassung, 6 Checklistenpunkte, Foto über Kamera-Eingabe, Abschluss ✓
8. **Offline**: Neustart der App aus dem Service-Worker-Cache, lokaler Stand erhalten ✓
9. **Wieder online**: automatische Synchronisation – Auftrag, Checkliste, Foto, Zeiteintrag auf dem Server; zweiter Sync ohne Duplikate ✓
10. PDF-Leistungsnachweis ✓
11. Materialverbrauch mit Mindestbestandswarnung ✓

Zusätzlich manuell geprüft (Screenshots): alle 32 Hauptansichten ohne JavaScript-Fehler, Darstellung Smartphone/Desktop, Leistungsnachweis- und Etiketten-PDF.

## 3. Nicht getestet
- **Physischer Honeywell EDA52** (Android 11, Hardware-Scanner, Kamera, Speicher) – Checkliste für den Gerätetest:
  - [ ] PWA-Installation über Chrome
  - [ ] Scanner-Test unter *Mein Konto* (Wedge mit Enter-Suffix)
  - [ ] Objekt-QR scannen → Objektakte
  - [ ] Kamera-Scan und Foto (13 MP → komprimiert)
  - [ ] Flugmodus: Auftrag bearbeiten, Foto, Stempeln; danach WLAN → Synchronisation
  - [ ] Hoch- und Querformat
- iPhone/Safari, Windows-Edge, macOS-Safari (die App nutzt Standard-Webtechnik; Kamera-Scan auf iOS über jsQR).
- Last-/Performancetest mit großen Datenmengen.
