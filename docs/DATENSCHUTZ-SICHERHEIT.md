# Datenschutz und Sicherheit

> Dieses Dokument beschreibt technische Maßnahmen. Es ist **keine** Rechtsberatung und **keine** Bestätigung einer
> DSGVO-Konformität oder Zertifizierung. Die DSGVO-Konformität hängt wesentlich von organisatorischen Maßnahmen,
> Verträgen und dem Betrieb ab und muss vor dem Produktiveinsatz geprüft werden (siehe Abschnitt 4).

## 1. Umgesetzte technische Maßnahmen

**Anmeldung und Sitzungen**
- Passwörter mit **scrypt** (Salt je Passwort) gehasht; Klartext wird nie gespeichert.
- Mindestens 10 Zeichen mit Buchstaben und Ziffern; Pflicht-Passwortwechsel bei Erstzugang/Zurücksetzung.
- Kontosperre (15 Min.) nach 5 Fehlversuchen, IP-Begrenzung der Anmeldeversuche, einheitliche Fehlermeldung (keine Konto-Enumeration).
- Sitzungen serverseitig, Token nur als SHA-256-Hash gespeichert; Cookie `HttpOnly`, `SameSite=Strict`, `Secure` bei HTTPS; 14 Tage gleitend.
- Bei Passwortänderung werden andere Sitzungen beendet; bei Deaktivierung/Rollenwechsel alle Sitzungen.

**Zugriffsschutz**
- Rollen- und Rechtemodell (Administrator, Geschäftsführer, Objektleiter, Mitarbeiter, Kunde), serverseitig bei jedem Zugriff geprüft.
- Zeilenrechte: Mitarbeiter sehen nur zugeordnete Objekte/Aufträge, keine Kontaktdaten der Kunden, keine Vertragsinfos, keine Kontaktdaten von Kollegen.
- Kunden (Portal) sehen ausschließlich eigene, ausdrücklich freigegebene Daten; Portal standardmäßig deaktiviert.
- Fotos und Dokumente nur über berechtigungsgeprüfte Endpunkte (keine öffentlichen Dateipfade, zufällige Dateinamen).

**QR-Codes**: enthalten nur eine zufällige 144-Bit-Kennung (keine Kunden-/Objektdaten); jede Auflösung prüft die Berechtigung; deaktivierbar.

**Übertragung und Web-Sicherheit**: HTTPS (Reverse-Proxy oder integriert), HSTS, Content-Security-Policy, X-Frame-Options, nosniff,
Referrer-Policy, CSRF-Schutz (eigener Header + SameSite), Upload-Prüfung (Typ + Dateisignatur, Größenlimit), CSV-Injection-Schutz,
keine Benutzerinhalte als HTML.

**Fotodokumentation**: Fotos werden auf dem Gerät neu kodiert → **EXIF-/GPS-Daten werden entfernt**; Kundenfreigabe nur explizit;
Hinweis: Personen möglichst nicht fotografieren.

**Nachvollziehbarkeit**: Änderungsprotokoll (`audit_log`) für Anlagen/Änderungen, Statuswechsel, QR-Neuzuordnung, Exporte, Anmeldungen.
Zeitkorrekturen mit Original- und Neuwert, Antragsteller, Entscheider, Zeitpunkt; Zeiteinträge werden nie gelöscht, nur storniert.
Mängel behalten einen vollständigen Verlauf.

**Lokale Daten auf Geräten**: IndexedDB im Browser-Sandbox-Speicher; Android 11 verschlüsselt den Gerätespeicher (Displaysperre erforderlich).
Beim Abmelden werden alle lokalen Daten gelöscht. Eine zusätzliche anwendungsseitige Verschlüsselung erfolgt **nicht** (siehe offene Punkte).

## 2. Lösch- und Aufbewahrungskonzept (Vorschlag)

| Daten | Vorschlag Aufbewahrung | Umsetzung |
|---|---|---|
| Fotos | 24 Monate (einstellbar), Fotos zu offenen Mängeln bleiben | Einstellungen → „Alte Fotos bereinigen“ |
| Kunden/Objekte | während Vertragslaufzeit, danach archivieren; Löschung nach Ablauf gesetzlicher Fristen | Archivierung umgesetzt, endgültiges Löschen: siehe offene Punkte |
| Rechnungs-/Geschäftsunterlagen (Dokumente) | gesetzliche Fristen (z. B. 6/8/10 Jahre nach HGB/AO) – steuerlich prüfen | manuelles Löschen je Dokument |
| Arbeitszeitaufzeichnungen | mind. 2 Jahre (§ 16 ArbZG), ggf. länger – arbeitsrechtlich prüfen | keine automatische Löschung |
| Änderungsprotokoll | Vorschlag 3 Jahre | keine automatische Löschung (offener Punkt) |
| Sitzungen, Sync-Protokoll | abgelaufene Sitzungen täglich, Sync-Protokoll nach 90 Tagen | automatisch bzw. bei Bereinigung |

## 3. Datensicherung
Tägliche Sicherung per `npm run backup` (Datenbank + Uploads), Aufbewahrung 14 Generationen, zusätzlich verschlüsselt außer Haus lagern; Wiederherstellung regelmäßig testen.

## 4. Vor dem Produktiveinsatz zu prüfen
1. Verzeichnis von Verarbeitungstätigkeiten (Art. 30 DSGVO) für Kunden-, Mitarbeiter-, Foto- und Zeiterfassungsdaten erstellen.
2. Auftragsverarbeitungsvertrag mit dem Server-/Hosting-Anbieter (Art. 28 DSGVO); Serverstandort (EU) festlegen.
3. Datenschutzinformationen für Mitarbeiter (Zeiterfassung, Fotos, Protokollierung) und Kunden (Portal) erstellen; ggf. Betriebsrat/Einwilligungen.
4. Fotografierrichtlinie: keine Personen, keine vertraulichen Unterlagen beim Kunden; Kundenzustimmung für Fotos in deren Räumen.
5. Aufbewahrungsfristen steuerlich/arbeitsrechtlich bestätigen lassen und Einstellungen anpassen.
6. TLS-Konfiguration, Firewall, Betriebssystem-Updates, Zugriffsschutz des Servers (SSH-Schlüssel), Überwachung einrichten.
7. Sicherungen verschlüsseln und Wiederherstellung testen.
8. Gerätemanagement: Displaysperre, Verlustprozess (Passwort zurücksetzen → Sitzungen werden beendet), ggf. MDM (Honeywell/Android Enterprise).
9. Unabhängigen Sicherheitstest (Penetrationstest) erwägen.
10. Zugangshinweise: keine Alarmcodes/Tresorcodes im Klartext speichern.
