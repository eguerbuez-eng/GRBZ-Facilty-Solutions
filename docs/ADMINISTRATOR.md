# Administrator – uneingeschränkte Systemrechte (Version 1.2)

Der **Administrator** ist die höchste Berechtigungsstufe. Er besitzt immer alle Rechte; seine Rolle kann nicht eingeschränkt werden.
Alle Prüfungen erfolgen **serverseitig** (Rolle `admin`). Ausgeblendete Schaltflächen sind nur Komfort, keine Sicherheitsmaßnahme.
Andere Rollen (auch Geschäftsführer) erhalten ausschließlich die Rechte, die ihrer Rolle unter **Rollen & Rechte** zugewiesen sind.

## Was nur der Administrator darf

| Bereich | Funktion |
|---|---|
| Abgeschlossene Aufträge | Checkliste korrigieren, umplanen (Datum, Mitarbeiter, Objekt, Checkliste), wieder öffnen, löschen |
| Unvollständige Checkliste | Auftrag trotzdem abschließen (Sicherheitsabfrage, wird protokolliert) |
| Winterdienst | unterschriebene Einsätze korrigieren, wieder öffnen (Unterschrift wird entfernt, Grund ist Pflicht), löschen |
| Entschiedene Anträge | Zeitkorrekturen umentscheiden (Ablehnung einer genehmigten Korrektur stellt die Originalzeiten wieder her), Abwesenheiten umentscheiden |
| Zeiterfassung | Zeiteinträge löschen (Papierkorb) |
| Löschen | beliebige Datensätze aller Module (Kunden, Objekte, Aufträge, Material, Maschinen, Dokumente, Rollen, Personaldaten …) – auch Daten, die sonst nicht löschbar sind |
| Datenverwaltung | jede Tabelle durchsuchen und jeden Datensatz direkt bearbeiten (mit Bestätigung; alt/neu wird protokolliert) |
| Papierkorb | gelöschte Datensätze wiederherstellen oder **endgültig löschen** (nur aus dem Papierkorb, Bestätigung durch Eingabe von „ENDGÜLTIG LÖSCHEN“; abhängige Einträge wie Checklistenpunkte werden mitgelöscht) |
| Sicherung & Wiederherstellung | Sicherung (Datenbank + Dateien) erstellen, herunterladen, hochladen, wiederherstellen (Bestätigung „WIEDERHERSTELLEN“; der aktuelle Stand wird vorher automatisch gesichert; alle Geräte laden danach neu) |
| Standardrollen | auch Standardrollen löschen (außer Administrator und Kundenportal) |

Bereits vorher hatte der Administrator alle Rechte für Stammdaten, Einstellungen, Benutzer, Rollen, Arbeitszeiten, Einsatzpläne,
Abwesenheiten, Abrechnungsdaten, Dokumente, Checklisten, Material, Maschinen, Berichte und Exporte.

## Bewusst beibehaltene Schutzmechanismen
Diese verhindern, dass sich das System selbst unbrauchbar macht – sie schränken die Verwaltung nicht ein:
- Der Administrator kann sein **eigenes Konto** nicht löschen/sperren und den **letzten aktiven Administrator** nicht entfernen.
- Die Rollen „Administrator“ und „Kunde (Portal)“ können nicht gelöscht werden.
- **Benutzer** werden nur als gelöscht markiert (nie physisch entfernt), damit Zeiten, Historie und Personalnummern nachvollziehbar bleiben.
- Endgültiges Löschen ist nur aus dem Papierkorb möglich; existieren noch Verweise anderer Daten (z. B. Aufträge eines Objekts), wird das mit einer verständlichen Meldung abgelehnt.
- Die direkte Bearbeitung sperrt technische Felder (ID, Versions-/Synchronisationsfelder, Passwort-Hash, QR-Token).

## Protokollierung
Jede administrative Aktion wird im **Änderungsprotokoll** mit Zeitpunkt, Benutzer und Details gespeichert:
`admin.geaendert` (alte und neue Werte), `admin.geloescht` (vollständiger Datensatz), `admin.wiederhergestellt`, `admin.endgueltig_geloescht`
(Datensatz + mitgelöschte Einträge), `admin.korrektur_abgeschlossen`, `admin.abschluss_erzwungen`, `admin.winterdienst_geoeffnet`,
`admin.sicherung_erstellt`, `admin.sicherung_hochgeladen`, `admin.wiederhergestellt_sicherung`, sowie Lösch- und Entscheidungsvorgänge mit Vermerk „admin“.

## Wiederherstellung älterer Sicherungen
Über die Oberfläche können Sicherungen derselben Datenbankversion wiederhergestellt werden. Eine ältere Sicherung (z. B. aus Version 1.0):
Dienst stoppen, Datei als `data/grbz.sqlite` einsetzen, Dienst starten – die Datenbank wird dabei automatisch migriert (mit Sicherung vorher).
