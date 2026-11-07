# Architektur

## Überblick

```
 Geräte (EDA52, Smartphone, Tablet, PC)                 Server
 ┌──────────────────────────────────────┐   HTTPS   ┌────────────────────────────────┐
 │ PWA (Vanilla-JS-Module, kein Build)  │ ───────▶  │ Node.js + Express              │
 │  ├ Service Worker (App-Cache, Fotos)  │           │  ├ Auth (scrypt, Sessions)      │
 │  ├ IndexedDB: Datenreplikat, Outbox,  │  Befehle  │  ├ Befehle (Geschäftslogik)     │
 │  │   Foto-Blobs, Konflikte            │ ◀──────── │  ├ Zeilenrechte (scope.js)      │
 │  ├ Sync-Engine (store.js)             │  Delta    │  ├ PDF (pdfkit), QR (qrcode)    │
 │  └ Scanner: Wedge + Kamera            │           │  └ SQLite (node:sqlite, WAL)    │
 └──────────────────────────────────────┘           │     data/grbz.sqlite, uploads/  │
                                                     └────────────────────────────────┘
```

## Technologieentscheidungen

| Entscheidung | Begründung |
|---|---|
| **PWA statt nativer App** | Eine Codebasis für EDA52, iPhone, Tablet, PC, Mac; Installation ohne App-Store; Updates zentral. |
| **Vanilla-JS-ES-Module ohne Build-Schritt** | Minimaler Speicher-/CPU-Bedarf auf dem EDA52 (RAM unbekannt), keine Build-Toolchain, gut wartbar und langfristig ohne Framework-Upgrades lauffähig. |
| **Node.js + Express** | Verbreitet, gut wartbar; ein Prozess liefert API und App aus. |
| **SQLite (node:sqlite, WAL)** | Relationale Datenbank ohne eigenen Datenbankserver, ideal für ein wachsendes Kleinunternehmen (bis zu vielen Mitarbeitern problemlos). Einfache, konsistente Sicherung (`VACUUM INTO`). Das Schema ist standard-SQL und könnte bei Bedarf nach PostgreSQL migriert werden. |
| **Befehlsbasierte Schreib-API** (`POST /api/sync/push`) | Jede Änderung ist ein benannter Befehl mit eindeutiger `op_id`. Online und offline läuft dieselbe Logik; der Server ist idempotent (Wiederholungen werden erkannt). |
| **Delta-Sync per globaler Änderungsnummer `seq`** | Jede Tabellenzeile trägt `seq`; Geräte holen nur Zeilen mit `seq > Cursor`. Löschungen als Tombstone (`deleted = 1`). |
| **Server-seitige Rechte** | Rollenrechte (`shared/constants.js`) + Zeilenfilter (`server/scope.js`) für jede Ausgabe: Sync, Berichte, Dateien, QR-Auflösung. |
| **pdfkit / qrcode / jsQR** | Reine JavaScript-Bibliotheken ohne native Abhängigkeiten. |

## Datenmodell (Auszug, vollständig in `server/schema.sql`)

- `users` (Rollen admin/geschaeftsfuehrer/objektleiter/mitarbeiter/kunde), `sessions`
- `customers` → `contact_history`, `customer_services` → `services`
- `objects` (→ customers) → `object_employees` (→ users), `qr_codes`, `winter_areas`
- `checklist_templates` → `checklist_template_items`
- `recurrences` → erzeugt `orders` → `order_checklist_items`
- `photos` (→ order / checklist item / object / defect / winter operation / machine / inspection)
- `time_entries` (Arbeit/Pause) → `time_corrections` (Original-/Neuwert, Antragsteller, Entscheider, Zeitpunkte)
- `materials` → `stock_movements`; `machines` → `machine_events`
- `inspections` → `inspection_items`; `defects` → `defect_log`
- `winter_operations`, `winter_standby`; `documents`; `scans`
- `audit_log` (Änderungsprotokoll), `sync_ops` (Idempotenz), `counters` (Nummernkreise, seq), `settings`

Gemeinsame Spalten: `id` (UUID, auch clientseitig erzeugt), `version` (optimistisches Sperren), `seq` (Sync), `deleted`, `created_at`, `updated_at`.

Nummernkreise: Kunden `K-00001`, Objekte `GRBZ-OBJ-0001`, Aufträge `A-2026-00001`, Mängel `M-2026-0001`, Kontrollen `QK-2026-0001`,
Winterdienst `WD-2026-0001`, Artikel `ART-00001`, Maschinen `MAS-0001`, Mitarbeiter `MA-001`, QR-Etiketten `GRBZ-QR-000001`.
Nummern vergibt ausschließlich der Server (offline angelegte Datensätze zeigen „wird bei Sync vergeben“).

## Synchronisationslogik

1. **Lesen:** Nach der Anmeldung lädt das Gerät alle sichtbaren Daten (`GET /api/sync/pull?since=0`) in IndexedDB; danach nur Deltas.
   Alle 12 Stunden erfolgt ein vollständiger Abgleich. Für Mitarbeiter liefert der Server zusätzlich die Liste aktuell sichtbarer
   Objekte/Aufträge – nicht mehr zugeordnete Daten werden lokal entfernt. Neu zugeordnete Daten erhalten eine neue `seq` und erscheinen im nächsten Delta.
2. **Schreiben:** Ein Befehl wird lokal sofort angewendet (optimistisch, mit denselben Prüfregeln wie auf dem Server, z. B.
   Checklisten-Vollständigkeit aus `shared/rules.js`). Online wird er direkt gesendet; bei Ablehnung wird die lokale Änderung zurückgenommen
   und eine verständliche Meldung angezeigt. Offline landet er in der **Outbox**.
3. **Übertragen:** Die Outbox wird in Originalreihenfolge gesendet (Fotos als eigener, idempotenter Upload vor nachfolgenden Befehlen,
   damit z. B. Pflichtfotos vor dem Auftragsabschluss vorhanden sind). Danach folgt ein Delta-Pull.
4. **Doppelte Datensätze / wiederholte Uploads:** `op_id` je Befehl und Client-UUIDs je Datensatz/Foto. Der Server speichert das Ergebnis
   jeder `op_id` und liefert es bei Wiederholung erneut, ohne den Befehl erneut auszuführen.
5. **Konflikte:** Stammdatenänderungen senden die gelesene `version` mit. Weicht sie ab, lehnt der Server ab → Eintrag unter „Synchronisation“
   mit Wahl „Serverstand übernehmen“ oder „Meine Änderung erzwingen“. Feldarbeitsdaten (Checklistenpunkte, Zeitstempel, Bestandsbuchungen als
   Mengen-Deltas, Scans, Fotos) sind so modelliert, dass sie ohne Konflikt zusammengeführt werden.
6. **Fehler:** Vom Server abgelehnte Vorgänge (4xx) werden nicht endlos wiederholt, sondern dem Benutzer zum erneuten Versuch/Verwerfen angezeigt;
   bei Server-/Netzfehlern bleibt die Outbox erhalten und wird später erneut gesendet.
7. **Offline erstellte Aufträge** behalten ihre Client-ID; auch die IDs der Checklistenpunkte werden vom Client vorgegeben, sodass der Auftrag
   offline sofort bearbeitet werden kann.

## Wichtige Dateien

| Datei | Inhalt |
|---|---|
| `server/app.js` | HTTP-Routen, Upload, Portal, Sicherheits-Header |
| `server/commands.js` | Gesamte Schreib-Geschäftslogik |
| `server/scope.js` | Zeilenbasierte Zugriffsrechte |
| `server/reports.js`, `server/pdf.js` | PDF-Berichte, QR-Etiketten, CSV |
| `public/js/store.js` | Lokale Datenbank, Outbox, Sync, optimistische Logik |
| `public/js/scanner.js` | Keyboard-Wedge-Erkennung, Kamera-Scan |
| `public/sw.js` | Service Worker (Offline-Start, Foto-Cache) |
