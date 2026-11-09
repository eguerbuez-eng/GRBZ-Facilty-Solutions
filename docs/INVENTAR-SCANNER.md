# Inventar & systemweiter Barcode-Scanner (Version 1.3)

## Bedienung in Kürze
- **Scannen ohne Klick:** Die App ist überall empfangsbereit. Scantaste des Honeywell EDA52 drücken – fertig.
- **Menü „Inventar“:** oben der Scanbereich („Scanner bereit – einfach scannen“). Jeder Scan zeigt sofort den Gegenstand
  mit Bestand, verfügbarer Menge, Lagerort, Status, Objekt und passenden Aktionen. Die letzten Scans bleiben darunter sichtbar.
- **Scan an anderer Stelle der App** (z. B. Startseite): Bekannte Inventarcodes öffnen das Inventar mit dem Ergebnis,
  GRBZ-QR-Codes von Objekten öffnen wie bisher die Objektakte.
- **Unbekannter Barcode:** Die Neuanlage öffnet sich sofort (Artikel/Material oder Maschine/Einzelgerät), der Barcode ist
  bereits eingetragen und gesperrt. Bezeichnung, Gegenstandsart und – bei Artikeln – der tatsächliche Anfangsbestand müssen
  erfasst werden; es werden keine Daten oder Mengen erfunden.
- **Während Sie tippen** (Name, Notiz, Suche …): Der Scan überschreibt nichts. Der Feldinhalt bleibt exakt erhalten.
  Im Inventar wird der Scan trotzdem verarbeitet; in anderen Formularen erscheint nur ein Hinweis, damit ungespeicherte Eingaben nicht verloren gehen.
- **Barcode-Felder** (z. B. „Barcode / EAN“ beim Anlegen): Hier landet der Scan absichtlich im Feld.

## Gegenstandsarten

| Art | Datensatz | Bestandsführung |
|---|---|---|
| Reinigungsmittel, Verbrauchsmaterial, Ersatzteile, Arbeitskleidung | Artikel | Stückzahl; Ausgabe an Mitarbeiter **senkt den Bestand**, Rücknahme erhöht ihn |
| Werkzeuge, Geräte (Stückartikel), Sonstiges Inventar | Artikel | Stückzahl; Ausgabe senkt nur die **verfügbare** Menge, Rücknahme erhöht sie wieder |
| Reinigungsmaschinen, Maschinen, Einzelgeräte | Maschine | **keine Stückzahl** – jede Einheit mit eigener Inventarnummer, Standort, Objekt, Zustand, Ausgabe an Mitarbeiter, Wartungs-/Reparaturhistorie |

## Aktionen nach dem Scan (je nach Recht)
Artikel: Öffnen · Bestand + (Zugang) · Bestand − (Verbrauch) · Ausgabe · Rücknahme · Standort · Objekt · Status · Bearbeiten · Barcode erzeugen · Inventur (in der Artikelakte).
Maschinen: Öffnen · Standort · Objekt · Ausgabe/Rücknahme · Zustand · Wartung · Reparatur · Defekt melden · Bearbeiten · Barcode erzeugen.

Rechte: Zubuchen, Ausgabe/Rücknahme, Standort/Objekt/Status und Neuanlage erfordern „Material verwalten“ bzw. „Maschinen verwalten“;
Entnahme („Bestand −“) erlaubt bereits „Materialverbrauch buchen“; „Defekt melden“ darf jeder mit „Maschinen ansehen“. Alles wird serverseitig geprüft.

## Sicherheit der Bestandsführung
- Jede Bewegung wird mit Art, Menge, Bestand danach, Mitarbeiter, Empfänger, Objekt, Zeitpunkt und Bemerkung gespeichert und zusätzlich im Änderungsprotokoll erfasst.
- **Negativer Bestand** wird abgelehnt. Nur Benutzer mit „Material verwalten“ können ihn nach ausdrücklicher Warnung erzwingen (protokolliert).
- Ausgabe nur bis zur verfügbaren Menge, Rücknahme nur bis zur ausgegebenen Menge.
- **Doppelscan-Sperre:** derselbe Code innerhalb von 1,2 s wird ignoriert (einstellbar).
- **Doppelbuchungen:** gleiche Buchung innerhalb von 20 s → Rückfrage; jede Buchung trägt eine eindeutige Vorgangs-ID (Wiederholungen bei schlechter Verbindung werden nicht doppelt gebucht).
- **Eindeutige Barcodes:** Ein Barcode kann nur einem Gegenstand gehören und darf keiner fremden Artikel-, Inventar- oder Seriennummer entsprechen (Server und Datenbank-Index).

## Eigene Inventarbarcodes
„Barcode erzeugen“ vergibt einen eindeutigen Code `GRBZ-INV-000001 …` (vom Server, daher online). Etiketten (Code 128 + QR mit demselben Inhalt)
gibt es als PDF in der Artikel-/Maschinenakte („Etikett“). Der EDA52 liest beide Codearten.

## Offline
Alle für den Benutzer freigegebenen Artikel und Maschinen liegen auf dem Gerät. Scannen, Anzeigen, Buchen, Ausgabe/Rücknahme,
Standort/Objekt und Neuanlage funktionieren offline und werden später synchronisiert. Ausnahmen: eigene Barcodes erzeugen und Etiketten drucken.
Bei gleichzeitigen Offline-Buchungen mehrerer Geräte prüft der Server den Bestand erneut; würde er negativ, wird der Vorgang abgelehnt und erscheint
unter „Synchronisation“ (nicht unbemerkt).

## Scanner-Erkennung und Einstellungen
Siehe [HONEYWELL-EDA52.md](HONEYWELL-EDA52.md) – Abschnitt 3. Einstellungen je Gerät unter **Mein Konto → Scanner-Einstellungen**,
Diagnose unter **Mein Konto → Scanner-Test** (zeigt erkannten Code, Empfangsweg und Zeichenabstände).
