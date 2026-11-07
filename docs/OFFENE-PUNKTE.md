# Offene Punkte und bekannte Einschränkungen

Alle im README als implementiert aufgeführten Funktionen sind mit echter Datenbank umgesetzt. Folgende Punkte sind **nicht** oder nur teilweise umgesetzt:

## Nicht umgesetzt
| Punkt | Hinweis / Alternative |
|---|---|
| **Test auf einem physischen Honeywell EDA52** | Entwickelt und getestet in Chromium (Desktop + mobiles Viewport). Scanner-Erkennung per simulierter Tastatureingabe getestet. Ein Test am echten Gerät steht aus – Checkliste in `HONEYWELL-EDA52.md`. |
| Native Honeywell-Scanner-Anbindung (SDK/Intents) | Für Web-Apps nicht verfügbar; gelöst über Keyboard-Wedge. Eine native Hülle (z. B. Capacitor) wäre ein späterer Schritt. |
| NFC-Tags | Nicht integriert (Web NFC nur Chrome/Android). |
| Rechnungsstellung/Buchhaltung, Angebotserstellung | Rechnungen/Angebote können nur als Dokumente abgelegt werden. |
| E-Mail-Versand (Berichte, Passwort-vergessen) | Passwort-Zurücksetzen erfolgt durch Administrator (Einmalpasswort) oder `npm run create-admin`. |
| Kalender-/Disponentenansicht (Drag & Drop) | Planung über Auftragslisten nach Datum und Serienaufträge. |
| Kundenunterschrift auf Leistungsnachweis | Unterschrift aktuell nur im Winterdienst (Mitarbeiter). |
| Endgültiges Löschen von Kunden/Objekten (DSGVO-Löschung) | Archivierung vorhanden; physisches Löschen inkl. abhängiger Daten fehlt. |
| Automatische Löschung von Protokoll-/Zeitdaten nach Fristen | Nur Foto-Bereinigung umgesetzt. |
| Anwendungsseitige Verschlüsselung der Offline-Daten | Schutz über Geräteverschlüsselung/Displaysperre. |
| Zwei-Faktor-Anmeldung | Nicht umgesetzt. |
| Push-Benachrichtigungen, Hintergrund-Sync bei geschlossener App | Sync beim Öffnen/Nutzen und alle 60 s. |
| Mehrsprachigkeit | Nur Deutsch (gefordert). |
| Kundenportal: Fotos/Dokumente offline | Portal ist nur online nutzbar. |

## Einschränkungen
- Datumseingabefelder zeigen das Format der Browser-/Gerätesprache (auf deutschen Geräten TT.MM.JJJJ).
- Dokumente und PDF-Berichte erfordern eine Verbindung; offline ist nur die Dokumentliste sichtbar.
- Monatsbericht/Qualitätsbericht berücksichtigen Kalendermonate in Berlin-Zeit; Zeiträume über Jahresgrenzen bitte einzeln erzeugen.
- Konfliktauflösung ist datensatzbezogen (nicht feldgenau).
- SQLite eignet sich für ein Unternehmen mit vielen Mitarbeitern; für mehrere Server-Instanzen wäre eine Migration auf PostgreSQL nötig.
- `node:sqlite` ist in Node 22 als „experimentell“ gekennzeichnet (stabil nutzbar; die Warnung wird beim Start unterdrückt). Bei Node-Updates Tests ausführen.
