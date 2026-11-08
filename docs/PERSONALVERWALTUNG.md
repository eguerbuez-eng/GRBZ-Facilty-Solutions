# Personalverwaltung (Version 1.1)

> **Wichtig:** Die Personalkostenrechnung ist eine **interne Kalkulation** und **keine Lohnabrechnung**.
> Steuern, Sozialversicherungsbeiträge, Mindestlohn, steuer- und beitragsfreie Zuschlagsgrenzen, Pfändungen u. Ä.
> werden **nicht** berechnet. Es sind **keine gesetzlichen Werte hinterlegt** – alle Beträge, Prozentsätze,
> Pausenregeln und Rundungen legen Sie selbst fest. Die rechtsverbindliche Abrechnung erfolgt über Lohnbüro bzw. Steuerberatung.

## Übersicht der Funktionen (alle über die Oberfläche bedienbar)

| Bereich | Wo | Inhalt |
|---|---|---|
| Personalnummern | automatisch | `G-0001`, `G-0002` … fortlaufend, eindeutig (Datenbank-Unique), dauerhaft; gelöschte Mitarbeiter behalten ihre Nummer, Nummern werden nie erneut vergeben. Kundenportal-Zugänge erhalten keine Personalnummer. |
| Beschäftigungsarten | Mitarbeiter → Personal-Einstellungen | Geschäftsführer, Vollzeit, Teilzeit, Minijobber, Midijobber, Werkstudent, Aushilfe, Saisonkraft, Befristet, Sonstige – frei erweiterbar, umbenennbar, deaktivierbar |
| Positionen | ebenda | Geschäftsführer, Administrator, Bereichsleiter, Objektleiter, Vorarbeiter, Reinigungskraft, Glasreiniger, Hausmeister, Gartenpflege, Winterdienst, Springer, Verwaltung – frei erweiterbar |
| Abteilungen | ebenda | frei definierbar (für Berechnungsmodelle und Auswertung) |
| Arbeitszeitmodelle | ebenda | Soll-Stunden je Wochentag, Feiertage verringern Soll (abschaltbar) |
| Feiertage | ebenda | **selbst einzutragen** (nicht vorbelegt, da je Bundesland verschieden) |
| Personalakte | Mitarbeiter → Name | Stammdaten, Kontakt, Notfallkontakt, Personalnummer (+ frühere Nummer), Eintritt/Austritt, Status, Beschäftigungsart, Position, Abteilung, Vorgesetzter, Arbeitszeitmodell, Urlaubsanspruch, Vergütung (Stundenlohn/Monatsgehalt), Arbeitsvertrag-Hinweise, Personaldokumente, zugewiesene Objekte, Schichten, Aufträge, Urlaub/Abwesenheiten, Soll/Ist, Überstundenkonto, Vergütungsberechnung, Prämien/Abzüge, Fahrten, Notizen, Historie |
| Berechnungsmodelle | Personal → Berechnungsmodelle | Stundenlohn, Monatsgehalt, Überstunden (Auszahlung/Zeitkonto, Zuschlag), Zeitzuschläge (Nacht, Sonntag, Feiertag, Samstag, sonstige; Zeitfenster/Wochentage/Feiertage; kombinierbar oder nicht), Fahrtkosten-Pauschale, Kilometerpauschale, objektbezogene Vergütung, Bonus/Prämie, Abzug, Pausenregelung, Rundungsregel, Arbeitgeberkosten-Aufschlag – jeweils anlegen, bearbeiten, aktivieren/deaktivieren, mit Gültigkeitszeitraum |
| Geltungsbereich | je Modell | alle Mitarbeiter, Abteilung, Beschäftigungsart, Position, einzelner Mitarbeiter, Objekt (Objektvergütung) |
| Dienstplan | Personal → Dienstplan | Wochenansicht, Schichten je Mitarbeiter/Objekt, Pausen, über Mitternacht, Überschneidungsprüfung, Abwesenheiten sichtbar, Plan- vs. Soll-Stunden, Vorwoche übernehmen; Mitarbeiter sehen „Mein Dienstplan“ |
| Urlaub & Abwesenheit | Personal → Urlaub & Abwesenheit | Urlaub, Krankheit (mit AU-Vermerk), Kind krank, Sonderurlaub, unbezahlt, Schulung, Überstundenabbau, Sonstiges; Antrag → Genehmigung/Ablehnung; Arbeitstage automatisch nach Arbeitszeitmodell; Urlaubsanspruch/Rest; Urlaubsplan (Monatsraster) |
| Vertretungsplanung | ebenda, Reiter „Vertretungsplanung“ | zeigt Schichten und Aufträge abwesender Mitarbeiter, Vertretung per Auswahl zuweisen (verfügbare Mitarbeiter) |
| Soll/Ist & Überstundenkonto | Personalakte → Arbeitszeit & Überstunden | monatlich Soll, Ist (inkl. angerechneter Abwesenheit), Differenz, Buchungen (Übertrag, Auszahlung, Korrektur), Kontostand |
| Rollen & Rechte | Personal → Rollen & Rechte | Standardrollen Geschäftsführer, Administrator, Objektleiter, Vorarbeiter, Mitarbeiter, Minijobber, Aushilfe (+ Kunde); jede Rolle mit eigenen Rechten (44 Einzelrechte), eigene Rollen anlegen, Einschränkung auf zugeordnete Objekte; Änderungen wirken sofort |
| Personalkosten | Personal → Personalkosten | je Mitarbeiter, je Objekt, je Monat, Kosten je Arbeitsstunde, Überstundenkosten, Zuschläge, Verhältnis zum Objektumsatz; PDF und CSV |

## Neue Rechte

| Recht | Bedeutung | Standardmäßig bei |
|---|---|---|
| Personalakten ansehen / bearbeiten | Akten, Kategorien, Fahrten, Zeitkonto | GF, Admin (ansehen auch Objektleiter) |
| Löhne, Gehälter und Personalkosten | Vergütungsfelder, Kostenrechnung, Umsätze | GF, Admin |
| Berechnungsmodelle verwalten | Modelle anlegen/ändern | GF, Admin |
| Rollen und Rechte verwalten | Rollen bearbeiten | GF, Admin |
| Dienst- und Schichtplanung | Dienstplan, Vertretungen | GF, Admin, Objektleiter |
| Abwesenheiten genehmigen und erfassen | Urlaub/Krankheit verwalten | GF, Admin, Objektleiter |
| Eigenen Dienstplan ansehen / Eigene Abwesenheiten beantragen | Self-Service | alle Mitarbeiterrollen |

Sicherheit: Nicht-Administratoren können keine Rechte vergeben, die sie selbst nicht besitzen. Lohndaten werden ohne Recht „Löhne, Gehälter …“
nicht an Geräte übertragen. Personaldokumente sind nur mit „Personalakten ansehen“ sichtbar.

## Rechenweg der internen Kostenrechnung (je Mitarbeiter und Monat)

1. **Arbeitszeit:** gestempelte Arbeitszeit minus gestempelte Pausen, je Tag. Falls eine **Pausenregel** aktiv ist und weniger Pause gestempelt wurde als festgelegt, wird die Differenz abgezogen. Danach **Rundung** je Tag (falls Regel aktiv).
2. **Soll:** Arbeitszeitmodell je Wochentag zwischen Ein- und Austritt; hinterlegte Feiertage verringern das Soll (wenn im Modell aktiviert).
3. **Abwesenheiten (genehmigt):** Urlaub, Krankheit, Kind krank, Sonderurlaub, Schulung, Sonstiges werden mit dem Tages-Soll als Ist angerechnet; „unbezahlt“ verringert das Soll; „Überstundenabbau“ wird nicht angerechnet (verringert das Zeitkonto). Ob eine Abwesenheit vergütet wird, ist je Eintrag einstellbar (Feld „bezahlt“) – bitte arbeitsrechtlich prüfen.
4. **Grundvergütung:** Stundenlohn × (gearbeitete + bezahlte Abwesenheitsstunden) bzw. Monatsgehalt (anteilig bei Ein-/Austritt im Monat). Stundenlohn/Gehalt aus der Personalakte, sonst aus einem passenden Berechnungsmodell.
5. **Überstunden** = Ist − Soll (nach optionaler Schwelle). „Auszahlen“: Zuschlag (bzw. bei Monatsgehalt Stunden × Gehalt/Soll-Stunden + Zuschlag). „Zeitkonto“: keine Auszahlung, bei Stundenlohn wird nur bis zum Soll vergütet.
6. **Zeitzuschläge** minutengenau nach Zeitfenster, Wochentag, Feiertag; Prozent vom Stundensatz oder € je Stunde. Gleiche Kategorie: speziellste Regel gilt; verschiedene Kategorien werden addiert; „nicht kombinierbar“ → nur der höchste.
7. **Objektvergütung, Fahrtkosten, Kilometer, Boni, Abzüge, Einmalbeträge** gemäß Modellen bzw. Erfassung.
8. **Bruttovergütung (intern)** = Summe; **Personalkosten** = Brutto + Arbeitgeberkosten-Aufschlag (eigener Schätzwert).
9. **Objekte:** Kosten nach Stunden verteilt, objektbezogene Beträge direkt; Verhältnis zum Monatsumsatz des Objekts.

Bekannte Vereinfachungen: Bei der Sommer-/Winterzeitumstellung kann die Zuordnung zu Zuschlagsfenstern um eine Stunde abweichen. Schichtplanung und Zeiterfassung sind getrennt (Kosten basieren auf erfasster Zeit, nicht auf Planung).

## Datenmigration

Beim ersten Start der Version 1.1 wird eine bestehende Datenbank automatisch migriert:
1. **Sicherung** nach `data/backups/vor-migration-v1-zu-v2-<Zeitstempel>.sqlite`
2. Benutzertabelle wird ohne feste Rollenliste neu aufgebaut (alle Daten werden übernommen)
3. Personalnummern: bisherige `MA-001 …` werden in Anlagereihenfolge zu `G-0001 …`; die alte Nummer bleibt als „Frühere Nummer“ sichtbar
4. Neue Tabellen (Rollen, Kategorien, Akte, Abwesenheiten, Schichten, Modelle …) und Standardwerte werden angelegt; jede Person erhält eine Personalakte

Die Migration ist automatisch getestet (alte Datenbank → neue Version, Fremdschlüssel geprüft, zweiter Start ohne erneute Migration).
