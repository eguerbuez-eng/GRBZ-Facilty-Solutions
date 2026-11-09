# Testprotokoll

## Version 1.3 – Inventar & systemweiter Scanner (09.11.2026)

`npm test`: **72 von 72** (62 bisherige + 10 in `tests/inventory.test.js`). `npm run test:e2e`: **11/11, 10/10, 9/9** (bisherige) + **14/14** (`tests-e2e/inventar.mjs`).

| Ihre Testanforderung | Umsetzung im Test | Ergebnis |
|---|---|---|
| 1. Bekannten Artikel scannen | Scan ohne Fokus → Name, Artikelnr., Barcode, Art, Bestand, Verfügbar, Lagerort | ✓ |
| 2. Unbekannten Barcode scannen | Neuanlage öffnet automatisch, Barcode übernommen und gesperrt | ✓ |
| 3. Neue Maschine über Barcode | Maschine angelegt (MAS-…), Barcode dauerhaft zugeordnet, Einzelstück-Anzeige | ✓ |
| 4. Verbrauchsmaterial scannen, Bestand anzeigen | „24 Stück“, Lagerort, Status | ✓ |
| 5. Bestand erhöhen und reduzieren | +6 → 30, −4 → 26, protokolliert; negativer Bestand wird abgefangen | ✓ |
| 6. Maschine einem Objekt zuordnen | Zuordnung gespeichert, angezeigt, Historie | ✓ |
| 7. Mehrere Barcodes hintereinander | zwei Codes direkt nacheinander → zwei Ergebnisse; dritter identischer Code (Doppelscan) ignoriert | ✓ |
| 8. Ohne vorher ein Feld anzuklicken | alle Scans im Test ohne Fokus | ✓ |
| 9. Während ein Textfeld aktiv ist | Suchfeld „Müll“ und Kundenname „Müller GmbH“ bleiben unverändert; Formular wird nicht verlassen; Weitertippen funktioniert | ✓ |
| 10. Offline | Scan + Entnahme offline, Anzeige 25 Stück, Server unverändert; nach Verbindung synchronisiert | ✓ |
| 11. EDA52 mit tatsächlicher Konfiguration | **nicht durchgeführt – kein Gerät verfügbar.** Simuliert: schnelle Tastenanschläge + Enter, Texteinfügung in einem Stück, Android-Tastencode 229, Präfix-Modus. Prüfliste: HONEYWELL-EDA52.md | offen |
| Zusätzlich | eindeutige Barcodes (Artikel/Maschine/Artikelnummer), eigene GRBZ-INV-Codes + Etiketten-PDF, Ausgabe/Rücknahme (Werkzeug vs. Verbrauchsmaterial), Rechte (Mitarbeiterin: Entnahme ja, Zubuchen/Neuanlage nein), Admin-Löschung einer Ausgabe korrigiert verfügbare Menge | ✓ |

Ein beim Testen gefundener und behobener Fehler: In aktiven Eingabefeldern wurden Scannerzeichen doppelt erfasst. Ebenfalls korrigiert:
Einfügen eines ganzen Textes (Autovervollständigung, Passwortmanager) wird nur noch dann als Scan gewertet, wenn unmittelbar Enter folgt.

---

## Version 1.2 – Administratorrechte (08.11.2026)

`npm test`: **62 von 62** bestanden (51 bisherige unverändert + 11 neue in `tests/admin.test.js`).
`npm run test:e2e`: **11/11** Offline-Ablauf, **10/10** Personalverwaltung (beide unverändert) + **9/9** Administrator (`tests-e2e/admin.mjs`).

| Geprüft | Ergebnis |
|---|---|
| Abgeschlossener Auftrag: Admin korrigiert Checkliste und plant um; Mitarbeiter und Objektleiter werden abgewiesen | ✓ |
| Abgeschlossenen Auftrag löschen nur Admin; Abschluss trotz unvollständiger Checkliste nur Admin (mit Protokoll) | ✓ |
| Unterschriebener Winterdienst: Admin korrigiert und öffnet wieder; andere Rollen nicht | ✓ |
| Entschiedene Zeitkorrektur durch Admin zurückgenommen → Originalzeit wiederhergestellt; Abwesenheit umentschieden | ✓ |
| Datenverwaltung serverseitig nur für Admin (Geschäftsführer und Objektleiter: 403) | ✓ |
| Direkte Feldänderung mit Protokoll alt/neu; gesperrte Felder (Passwort, ID) werden ignoriert | ✓ |
| Löschen → Papierkorb → Wiederherstellen → endgültig löschen (nur mit Bestätigung, abhängige Einträge mitgelöscht) | ✓ |
| Bestandsbewegung löschen korrigiert Bestand; Schutz vor Selbstaussperrung | ✓ |
| Sicherung erstellen, Wiederherstellung nur mit Bestätigung, vorherige Sicherung automatisch, Geräte laden neu, Download | ✓ |
| Oberfläche: Erzwungener Abschluss, Korrektur/Wiedereröffnung, Löschen/Papierkorb/Wiederherstellen, Direktbearbeitung, endgültiges Löschen nur mit eingegebener Bestätigung, Sicherung/Wiederherstellung, Protokoll, GF ohne Zugriff | ✓ |

---

## Version 1.1 – Personalverwaltung (08.11.2026)

`npm test`: **51 von 51** bestanden (40 bisherige unverändert + 11 neue in `tests/personnel.test.js`).
`npm run test:e2e`: **11/11** (bestehender Offline-Ablauf, unverändert) + **10/10** (`tests-e2e/personal.mjs`).

| Geprüft | Ergebnis |
|---|---|
| Personalnummern G-0001 ff., kein Doppel, keine Wiedervergabe nach Löschen, Kunden ohne Nummer | ✓ |
| Migration einer Datenbank der Version 1.0: Sicherung, Übernahme aller Daten, Umnummerierung mit alter Nummer, Fremdschlüssel, kein zweiter Lauf | ✓ |
| Eigene Beschäftigungsarten/Positionen anlegen und umbenennen, Arbeitszeitmodell-Validierung | ✓ |
| Personalakte; Lohnfelder nur mit Lohnrecht änderbar und sichtbar | ✓ |
| Eigene Rolle wirkt sofort; Administratorrolle geschützt; keine Rechteausweitung; Minijobber auf zugeordnete Objekte beschränkt | ✓ |
| Urlaubsantrag → Genehmigung, Arbeitstage nach Modell, Überschneidung abgelehnt, Resturlaub | ✓ |
| Schichten: Überschneidung, über Mitternacht, Abwesenheitswarnung, Woche kopieren, Vertretung, Mitarbeiter sieht nur eigene | ✓ |
| Kostenrechnung gegen Handrechnung: 12,5 Std. × 15 € = 187,50; Überstunden 25 % = 46,88; Nacht 25 % (2 Std.) = 7,50; Sonntag 50 % (4 Std.) = 30,00; Objektzulage 2 €/Std. (8,5 Std.) = 17,00; Fahrt 2 × 5 € = 10,00; Brutto 298,88; +20 % = 358,65; 28,69 €/Std.; mitarbeiterspezifische Regel ersetzt allgemeine | ✓ |
| Pausenregel (Abzug fehlender Pause), Rundung, Krankheitsgutschrift, Monatsgehalt, Zeitkonto mit Buchung | ✓ |
| Personalkosten je Objekt = Gesamtkosten, Umsatzverhältnis, Rechte (Mitarbeiter sieht eigene Stunden, keine Beträge), CSV und PDF mit Hinweis „keine Lohnabrechnung“ | ✓ |
| Oberfläche (Browser): Mitarbeiter anlegen inkl. Beschäftigung und Lohn, alle Reiter der Akte, Berechnungsmodell per Dialog, Schicht im Dienstplan, Urlaub → Vertretung zuweisen, Personalkosten, Kategorien/Feiertag/Arbeitszeitmodell, eigene Rolle, Minijobber-Login mit Urlaubsantrag und gesperrten Personalkosten | ✓ |

Nicht getestet: echtes Gerät (EDA52/iPhone), Safari, große Datenmengen, Zeitumstellungstage.

---

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
