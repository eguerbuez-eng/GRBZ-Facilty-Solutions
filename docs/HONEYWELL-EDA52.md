# Honeywell ScanPal EDA52 – Einrichtung, Scanner und Offline-Betrieb

> Hinweis zur Verlässlichkeit: Die Menüpfade der Honeywell-Einstellungen unterscheiden sich je nach Firmware-Stand.
> Die unten genannten Bezeichnungen entsprechen den üblichen Honeywell-Android-Einstellungen („Honeywell Settings“ → „Scanning“),
> wurden aber **nicht an einem physischen EDA52 verifiziert**. Bitte bei Abweichungen in der Honeywell-Dokumentation zum
> jeweiligen Firmware-Stand nachsehen. Die RAM-Größe des Geräts ist unbekannt; die App ist ressourcenschonend gebaut
> (kein Framework, keine Build-Bibliotheken, Fotos werden auf max. 1600 px verkleinert).

## 1. Grundeinrichtung des Geräts

1. Android-Updates und **Google Chrome** über den Play Store aktualisieren (Chrome ist die empfohlene Laufzeitumgebung der App).
2. Datum, Uhrzeit und Zeitzone automatisch beziehen (Zeitzone Europe/Berlin). Zeitstempel der Zeiterfassung stammen
   bei Offline-Erfassung von der Geräteuhr – eine falsche Uhr führt zu falschen Zeiten (der Server lehnt Zeiten in der Zukunft ab).
3. Displaysperre (PIN) aktivieren. Android 11 verschlüsselt den Gerätespeicher; damit sind die lokal gespeicherten Daten geschützt, solange das Gerät gesperrt ist.
4. Energiesparen: Chrome in „Akku → App-Akkunutzung“ nicht einschränken, damit die Synchronisation zügig läuft.

## 2. App installieren (PWA)

1. In Chrome die Adresse des Systems öffnen, z. B. `https://fms.grbz-solutions.com`.
2. Anmelden (beim ersten Mal eigenes Passwort vergeben).
3. Chrome-Menü (⋮) → **„App installieren“** bzw. **„Zum Startbildschirm hinzufügen“**.
4. Die App „GRBZ FMS“ startet danach im Vollbild wie eine normale App.
5. Kamera-Berechtigung beim ersten Kamera-Scan bzw. ersten Foto erlauben.

## 3. Hardware-Scanner (Keyboard Wedge) einrichten

Eine Web-App kann die Honeywell-Scanner-Schnittstelle (Data Collection SDK / Intents) **nicht direkt** ansprechen.
Die App unterstützt deshalb den Standardweg für Web-Anwendungen: Der Scanner gibt den gelesenen Code **als Tastatureingabe**
aus („Keyboard Wedge“) und schließt mit **Enter** ab. Die App erkennt solche sehr schnellen Eingaben automatisch – auf jeder Seite.

Einstellungen am EDA52 (sinngemäß):

1. **Einstellungen → Honeywell Settings → Scanning → Internal Scanner → Default profile** (bzw. ein eigenes Profil für Chrome/die installierte App).
2. **Data Processing Settings**:
   - **Wedge**: aktiviert
   - **Wedge Method / Wedge as keys**: „Keyboard“ bzw. „Standard“ (Tastenanschläge, *nicht* „Intent“ und *nicht* „Clipboard“)
   - **Suffix**: `\n` (Enter / LF). Ohne Enter-Suffix erkennt die App das Codeende nicht.
   - **Prefix**: leer
3. **Symbology Settings**: **QR Code** aktivieren; zusätzlich EAN-13/EAN-8, Code 128 (für Hersteller-Barcodes von Artikeln).
4. Optional: **Scan-Taste** auf „Scan“ belegt lassen; „Good read“-Ton/Vibration nach Wunsch.

**Funktionstest:** In der App *Mein Konto → Scanner-Test* öffnen und die Scantaste drücken. Angezeigt werden der Code,
der Empfangsweg (ohne Fokus / Eingabefeld / Texteinfügung / Präfix / Empfangsfeld) und der größte Zeichenabstand in Millisekunden.
Darunter stehen die rohen Tastenereignisse. Im Test-Modus werden Scans nicht verarbeitet.

**So erkennt die App den Scanner (Version 1.3)**
- Ohne Klick in ein Feld: Zeichen mit ≤ 45 ms Abstand + Enter = Scan. Menschliches Tippen ist langsamer und bleibt unberührt.
- In einem aktiven Text-/Notizfeld: Der Scan wird erkannt und der vorherige Feldinhalt sofort wiederhergestellt.
- Sendet das Gerät den Code als Text in einem Stück (Android-„InputConnection“) gefolgt von Enter, wird das ebenfalls erkannt.
- Ohne Enter-Suffix: Nach 140 ms Pause wird ein schneller Zeichenblock (ab 6 Zeichen) als Scan gewertet. **Empfohlen bleibt das Enter-Suffix.**

**Falls Scans nicht ankommen oder falsch erkannt werden** (Mein Konto → Scanner-Einstellungen):
1. *Max. Zeichenabstand* erhöhen (z. B. 80 ms), wenn im Scanner-Test größere Abstände angezeigt werden
   (Honeywell-Einstellung „Inter-character delay“ möglichst 0).
2. *Präfix-Zeichen*: Im Honeywell-Profil unter Data Processing → **Prefix** ein selten genutztes Zeichen eintragen (z. B. `~`)
   und dasselbe Zeichen in der App setzen. Dann ist die Erkennung unabhängig von der Geschwindigkeit eindeutig.
3. *Empfangsfeld-Modus* einschalten, wenn Scans nur ankommen, solange ein Eingabefeld aktiv ist
   (manche Wedge-Methoden senden nur an fokussierte Felder). Die App hält dann ein unsichtbares Feld ohne Bildschirmtastatur bereit.

**Prüfliste für den Gerätetest am EDA52 (bitte einmal durchführen)**
- [ ] Scanner-Test: EAN-13-Barcode eines Produkts → Code korrekt, Empfangsweg „ohne Fokus“
- [ ] QR-Code (GRBZ-Etikett) → korrekt
- [ ] Code-128-Inventaretikett (GRBZ-INV-…) → korrekt
- [ ] Inventar öffnen, ohne Klick scannen → Ergebnis erscheint
- [ ] In ein Notizfeld tippen, dann scannen → Text bleibt erhalten
- [ ] Zwei Codes direkt hintereinander → beide Ergebnisse
- [ ] Scantaste lange halten / doppelt drücken → nur ein Ergebnis
- [ ] Flugmodus: scannen und „Bestand −“ buchen → nach WLAN synchronisiert

## 4. Kamera-Scanning (alle Geräte)

„Mit Kamera scannen“ nutzt die Rückkamera. Unterstützt Chrome die **BarcodeDetector**-API (auf Android mit Google-Play-Diensten
üblich), wird sie verwendet; andernfalls die Software-Erkennung **jsQR** (nur QR-Codes). Taschenlampe, falls vom Gerät unterstützt.
iPhone/iPad (Safari): Software-Erkennung jsQR. Ebenso funktioniert der Scan eines GRBZ-QR-Codes mit der normalen
Handykamera: der Link öffnet die App/den Browser, nach Anmeldung wird die Akte geöffnet (Berechtigung wird serverseitig geprüft).

## 5. Offline-Funktion einrichten

1. Gerät **einmal online** anmelden. Dabei lädt die App alle für den Benutzer freigegebenen Daten (Objektakten, Aufträge,
   Checklisten, QR-Zuordnungen, Material, Maschinen …) in den lokalen Speicher. Die Anzeige oben rechts zeigt „Synchron“.
2. Prüfen unter **Synchronisation → Speicherbelegung**, ob „Dauerhaft gespeichert: ja“ angezeigt wird. Bei installierter App gewährt Chrome dies in der Regel.
3. Ab jetzt funktionieren offline: Objektakten, Aufträge, Checklisten, QR-Scan (lokale Zuordnung), Fotos, Zeitstempel,
   Materialbuchungen, Mängel melden, Winterdienstprotokolle, Qualitätskontrollen.
4. Offline erfasste Daten werden **automatisch** übertragen, sobald wieder Verbindung besteht (zusätzlich alle 60 Sekunden
   und beim Öffnen der App). Status: „Offline · 3“ = 3 Vorgänge warten.
5. **Nicht offline verfügbar**: PDF-Berichte, Dokument-Upload/-Ansicht, Benutzerverwaltung, Einstellungen, Änderungsprotokoll,
   Dashboard-Kennzahlen (es wird der letzte Stand angezeigt), noch nie angesehene Fotos anderer Geräte.
6. **Vor dem Abmelden** immer synchronisieren – beim Abmelden werden lokale Daten aus Datenschutzgründen gelöscht.
   Die App warnt, wenn noch nicht übertragene Vorgänge vorhanden sind.
7. Ein Gerät sollte einem Mitarbeiter fest zugeordnet sein. Meldet sich ein anderer Benutzer an, werden die lokalen Daten
   des Vorgängers gelöscht (nur möglich, wenn alles übertragen ist).

Konflikte (dieselbe Akte wurde auf zwei Geräten geändert) und vom Server abgelehnte Vorgänge (z. B. fehlende Berechtigung)
erscheinen unter **Synchronisation** und können dort übernommen, erneut gesendet oder verworfen werden.

## 6. Bekannte Grenzen auf Android 11 / im Browser

- Direkter Zugriff auf Honeywell-Scanner-SDK, NFC-Lesen von Tags (Web NFC funktioniert nur in Chrome für Android und ist nicht integriert) – siehe OFFENE-PUNKTE.md.
- Hintergrund-Synchronisation bei geschlossener App ist nicht zuverlässig möglich; synchronisiert wird beim Öffnen/Nutzen der App.
- Browser können lokale Daten bei extremem Speichermangel löschen, wenn kein dauerhafter Speicher gewährt wurde.
