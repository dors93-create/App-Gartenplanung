# Automatisierung: Kegelpegel-Olympiade – Live-Punktestand

*Erfasst am 27.09.2026 · Quelle: Entwicklungs-Session vom 03.09.2026 · Repository `dors93-create/App-Gartenplanung`*

> **Einordnung vorab:** Dies war ein privates Freizeitprojekt, kein betrieblicher Prozess. Ein
> Mengengerüst „Fälle pro Tag/Monat" und gemessene Zeit- oder Fehlergewinne **existieren nicht**.
> Die entsprechenden Felder sind unten als *nicht erhoben* markiert statt geschätzt zu werden.

## 1. Automatisierter Prozess

Punktestandsführung einer Kegel-Olympiade (zwei Teams, zehn Spiele). Drei Ebenen:

| Ebene | Vorher | Nachher |
|---|---|---|
| **Berechnung** | Kopfrechnen/Zettel: Sieger → Punkte, Unentschieden → halbe Punkte, Restpunkte | Aus dem gesetzten Sieger automatisch abgeleitet |
| **Verteilung** | Stand mündlich oder per Chat-Nachricht nach jedem Spiel | Ein Link; offene Seiten aktualisieren sich in ~1 s selbst |
| **Auslieferung** | – | Push → Build → Veröffentlichung ohne manuellen Schritt |

Zusätzlich automatisiert: die stufenweise **Freigabe der Spielnamen** (bis zur Freigabe zeigt die
Seite Platzhalter, aber bereits Punktzahl und Teamgrößen).

## 2. Eingesetzte Werkzeuge

| Zweck | Werkzeug |
|---|---|
| Entwicklung | Claude Code (Agent) + Git/GitHub |
| Anwendung | Reines HTML/CSS/JavaScript, kein Framework (1 Datei, 1.761 Zeilen) |
| Speicher & Synchronisation | Firebase Realtime Database (`europe-west1`), Schreibregeln serverseitig |
| Zugangsschutz | PBKDF2-Fingerabdruck im Quelltext (clientseitig; **kein** echter Auth-Dienst) |
| CI/CD | GitHub Actions → GitHub Pages |
| Test | Playwright/Chromium: Ablauftest (Login, Freigabe, Wertung, Neuladen), Breitentests 360–1440 px |
| Bildaufbereitung | Python/Pillow: Banner-Zuschnitt, Link-Vorschaubild 1200×630 |

## 3. Datenquellen und Dokumenttypen

**Keine Dokumentenverarbeitung.** Es gibt keine eingelesenen Dateien, keine OCR, keine Extraktion.
Sämtliche Eingaben erfolgen manuell über ein Web-Formular. Verarbeitet wird ein einziges
Zustandsobjekt (JSON als String, ~2 KB). Statische Artefakte: 1 HTML-Datei, 1 JPG (50 KB),
1 PNG (195 KB), 1 Markdown-Anleitung (189 Zeilen).

## 4. Mengengerüst

| Größe | Wert |
|---|---|
| Veranstaltungen | 1 (einmaliges Ereignis) |
| Spiele / Personen / Teams / Punkte | 10 / 9 / 2 / 55 |
| Schreibvorgänge je Veranstaltung | ~20 (10 Freigaben + 10 Wertungen) |
| Lesende Geräte | 9 |
| Entwicklung | 5 Commits, 5 Pipeline-Läufe, ~1 Arbeitstag |
| **Fälle pro Tag/Monat** | **entfällt – kein laufender Betrieb** |

## 5. Zeit- und Fehlergewinn

**Nicht gemessen.** Es wurde weder ein Vorher-Wert erhoben noch ein Nachher-Wert: Die
Veranstaltung hatte zum Zeitpunkt der Entwicklung noch nicht stattgefunden.

*Erwartet* (qualitativ, unbelegt): Wegfall des erneuten Link-Versands nach jedem Spiel; eine
gemeinsame Zahl statt paralleler Zettel; Wegfall von Additionsfehlern, insbesondere bei halben
Punkten. *Belegt* ist allein, dass ein automatisierter Testdurchlauf die Punktelogik bestätigt
(3 gewertete Spiele → Rot 5, Schwarz 1, 49 offen).

## 6. Anfallende Daten

| Datum | Ort | Anmerkung |
|---|---|---|
| Teamnamen (2), Spielnamen, Punktzahlen, Besetzung, Freigabe-Status, Sieger (10×) | Firebase RTDB | öffentlich lesbar |
| **Klarnamen (9) + Teamzuordnung** | Firebase RTDB | **personenbezogen, für jeden mit Link lesbar → DSGVO-relevant** |
| Zeitstempel der letzten Änderung | Firebase RTDB | Konfliktauflösung |
| Kopie des Zustands | `localStorage` je Gerät | Offline-Betrieb |
| Anmelde-Zeitstempel (60 Tage gültig) | `localStorage` des Leitungsgeräts | |
| Commits, Pipeline-Protokolle | GitHub | öffentliches Repository |

Kein Tracking, keine Analyse-Daten. Firebase Analytics ist im Projekt aktiviert, wird von der
Seite aber nicht angesprochen.

## 7. Eignung als Masterarbeits-Thema

Als Fallstudie ist der Fall **zu klein**: eine Veranstaltung, keine Messreihe, keine Vergleichsgruppe.
Tragfähig wären daraus abgeleitete Fragestellungen:

- **Backendlose Zustandssynchronisation:** Konfliktverhalten, Latenz und Ausfallverhalten bei
  „Last write wins" mit Zeitstempel gegenüber CRDT-Ansätzen.
- **Agentengestützte Entwicklung kleiner Fachanwendungen:** Aufwand, erreichte Testabdeckung,
  Fehlerklassen – hier dokumentiert an fünf nachvollziehbaren Commits.
- **Scheinsicherheit clientseitiger Authentifizierung:** Passwortprüfung im ausgelieferten
  Quelltext plus offene Schreibregeln, bei gleichzeitig personenbezogenen Daten.

Um den Fall quantitativ zu machen, müssten erhoben werden: Zeit je Wertung vorher/nachher,
Fehlerrate manueller Addition, Anzahl der Rückfragen zum Punktestand während der Veranstaltung.
