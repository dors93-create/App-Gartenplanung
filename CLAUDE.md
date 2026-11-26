# Grünriss

Ein **Garten-Planungstool** für Privatleute in NRW. Nutzer:innen sollen auf dem
aktuellen Luftbild ihres Grundstücks ihren Garten planen können.

Diese Datei gibt einen kurzen Überblick und hält die Konventionen fest, damit
auch Nicht-Programmierer:innen dem Projekt folgen können.

## Aktueller Stand

**Schritt 1 ist umgesetzt:**

- Bildschirmfüllende, interaktive Karte (MapLibre GL JS).
- Hintergrund: NRW-Luftbild (DOP) als WMS-Layer `nw_dop_rgb` vom Dienst
  `https://www.wms.nrw.de/geobasis/wms_nw_dop`, angefordert als JPEG-Kacheln
  (je nach Bildinhalt etwa 6- bis 15-mal kleiner als PNG).
- Suchfeld mit Adresssuche (Geocoding) über die kostenlose Nominatim-API,
  inkl. Vorschlägen während des Tippens. Die Suche ist auf NRW begrenzt (nur
  dort gibt es Luftbild und Kataster); unter den Treffern steht die
  Quellenangabe für OpenStreetMap. Die Karte fliegt sanft zur Adresse.
- Oberfläche komplett auf Deutsch.

**Schritt 2 ist umgesetzt – Grundstück auswählen:**

- Über das untere Bedienfeld auf das eigene Grundstück tippen. Mehrere
  Flurstücke sind möglich: erneutes Antippen eines markierten Flurstücks hebt
  die Markierung wieder auf (Umschalten).
- Das amtliche Flurstück wird aus dem NRW-Kataster (ALKIS) geholt:
  WFS `wfs_nw_alkis_vereinfacht`, Objektart `ave:Flurstueck`.
  Der Dienst erlaubt direkten Browser-Zugriff (CORS) und liefert GML (XML)
  in EPSG:25832 (UTM, Meter).
- Nach „OK" wird alles außerhalb der gewählten Flurstücke weiß ausgeblendet;
  jedes Flurstück wird bemaßt (Seitenlängen in Metern) und die Gesamtfläche in
  m² angezeigt – direkt aus den UTM-Koordinaten gerechnet (amtlich genau).

**Schritt 3a ist umgesetzt – Objekt-Editor:**

- Nach „Garten erfassen" können Objekte selbst eingetragen werden:
  Flächen (Haus, Terrasse, Rasen, Weg, Beet) wahlweise frei zeichnen oder als
  Rechteck; Bäume als Kreis (Mittelpunkt + Radius).
- Bearbeiten: Objekt antippen → ziehbare Griffe (Ecken verschieben, Radius
  ändern, ganzes Objekt verschieben) als native MapLibre-Marker; rote Knöpfe
  für Abbrechen/Löschen.
- „Restfläche als Rasen": füllt den noch freien Teil des Grundstücks
  (Grundstück minus alle anderen Flächen) automatisch mit Rasen
  (Flächen-Verschneidung via `polygon-clipping`).
- Stapelfolge: Objekte liegen nach Typ übereinander (Rasen unten, Bäume oben –
  `rang` in `TYPEN`). Liegen unter einem Tipp mehrere Objekte, wird das
  kleinste gewählt; so bleibt ein Baum oder Beet auf dem Rasen erreichbar.
- Bemaßung: je Objekt die Fläche (m², bei Bäumen der Durchmesser); für das
  ausgewählte Objekt zusätzlich die Seitenlängen.
- Alles farbig und lokal im Browser gespeichert (localStorage), übersteht das
  Neuladen – siehe „Meine Gärten“.

**Meine Gärten – Pläne wiederfinden, sichern und laden:**

- Jeder Plan gehört zu einem „Garten“: Name (amtliche Lagebezeichnung, z. B.
  „Mozartstraße 3“), die gewählten Flurstücke samt Umriss und die Objekte.
  Gespeichert wird er mit dem ersten eingezeichneten Objekt.
- Beim Start steht unter der Suchleiste die Liste „Meine Gärten“. Ein Tipp
  öffnet den Garten direkt im Editor – ohne Adresssuche und Antippen; die
  Karte springt auf das Grundstück.
- Wer nach der Grundstückswahl „Garten erfassen“ drückt, landet in seinem
  vorhandenen Garten, wenn genau dieselben Flurstücke gewählt sind. Überschneidet
  sich die Auswahl nur mit einem Garten (ein Flurstück mehr oder weniger),
  fragt Grünriss nach: Garten auf die neue Auswahl umstellen, unverändert
  öffnen oder einen neuen Garten anlegen. Die Flurstücke eines Gartens werden
  nie stillschweigend geändert.
- Jeder Garten trägt einen eigenen Namen; ist ein Name schon vergeben, wird
  „(2)“, „(3)“ … angehängt.
- „Als Datei sichern“ lädt den Garten als kleine Datei herunter (Sicherung,
  Mitnehmen auf ein anderes Gerät); „Garten aus Datei laden“ holt ihn zurück.
- Was aus dem Speicher oder einer Datei kommt, wird geprüft: Ein beschädigter
  Eintrag blockiert nichts, unlesbare Objekte werden ausgelassen und gemeldet.
  Schlägt das Speichern fehl, erscheint eine Warnung im Editor.
- Pläne aus der ersten Version (Schlüssel `gruenriss:plan:…`) werden beim
  Start einmalig übernommen; das Original bleibt im Archiv
  (`gruenriss:archiv:…`). Logik und Speicherformat: `src/gaerten.js`.

**Schritt 3b ist begonnen – Automatische Bestandsaufnahme:**

- Im (leeren) Editor „Automatisch erfassen": amtliche Gebäude (ALKIS,
  Objektart `ave:GebaeudeBauwerk`) werden als Haus eingetragen und die
  Restfläche als Rasen ergänzt. Alles bleibt editierbar.
- Logik in `src/bestand.js` (WFS-Abruf, GML auslesen, EPSG:25832 → Lat/Lon).

**Geplant (jeweils als eigener, späterer Schritt):**

- Schritt 3b (Teil 2) – Luftbild-/Nutzungs-Analyse für Terrasse/Wege/Bäume
  (z. B. ALKIS `ave:Nutzung` und Farb-/Textur-Auswertung des Luftbilds).

## Technik

- **Build-Tool:** [Vite](https://vitejs.dev/) (schneller Dev-Server + Build).
- **Karte:** [MapLibre GL JS](https://maplibre.org/) (freie Karten-Bibliothek).
- **Geocoding:** [Nominatim](https://nominatim.org/) (OpenStreetMap, kostenlos).
- **Kataster:** WFS `wfs_nw_alkis_vereinfacht` (Geobasis NRW) für Flurstücke.
- **Umrechnung:** [proj4](https://github.com/proj4js/proj4js) (EPSG:25832 ↔ 4326).
- **Schrift:** Geist (über `@fontsource-variable/geist` selbst gehostet).
- Reines JavaScript (kein Framework), damit der Code leicht lesbar bleibt.

## Projektstruktur

```
index.html            Grundgerüst (Karte, Suchleiste, Panel, Editor-Leiste)
src/main.js           Karte, Luftbild-Layer, Adresssuche/-vervollständigung
src/grundstueck.js    Schritt 2: Flurstück abrufen, ausblenden, bemaßen
src/editor.js         Schritt 3a: Objekte zeichnen/setzen, bemaßen, speichern
src/bestand.js        Schritt 3b: amtliche Gebäude automatisch erfassen
src/gaerten.js        „Meine Gärten“: Speicherformat, Prüfung, Sichern/Laden
                      als Datei, Übernahme alter Pläne (ohne Karte/Oberfläche)
src/rueckfrage.js     Rückfrage-Fenster mit beschrifteten Knöpfen (wenn eine
                      Entscheidung mehr als „Ja/Nein“ braucht)
tests/                Automatische Tests (siehe Abschnitt „Tests“)
src/style.css         Gestaltung (Design-Tokens, Suchleiste, Panel, Editor)
public/inselspiel.html  Eigenständiges Insel-Aufbauspiel (Bonus): eine einzelne
                        Datei, läuft auch ohne Server; wird mit veröffentlicht.
                        Lässt sich als App auf den Homescreen laden (PWA) und
                        läuft dann im Vollbild, auch ohne Internet. Ziel: als
                        Erste:r 1500 Siedler. Beim ersten Start erscheint eine
                        kurze, überspringbare Anleitung (später über ❓).
public/manifest.webmanifest
                        App-Beschreibung für die Installation (Name, Icons,
                        Startseite, Vollbildmodus)
public/sw.js            Service Worker: legt das Spiel im Zwischenspeicher ab,
                        damit es offline startet. Fängt bewusst nur die
                        Spiel-Dateien ab, nicht die Gartenplanung
public/icon-192.png · icon-512.png · apple-touch-icon.png
                        App-Symbole für Android und iOS
public/weisswein.html   Weißwein-Kompass (Bonus): 16 Rebsorten in einer
                        interaktiven Kreuzmatrix (Süße, Körper, Säure, Frucht,
                        Duft), Filter nach Herkunft und Essen; ebenfalls eine
                        einzelne Datei
public/weisswein-vorschau.png
                        Vorschaubild, das erscheint, wenn der Link zum
                        Weißwein-Kompass in einem Chat geteilt wird
public/kegelpegel.html  Punktestand der Kegelpegel-Olympiade (Bonus): zwei
                        Teams, zehn Spiele, Login unten für die Spielleitung.
                        Ebenfalls eine einzelne Datei; teilt den Stand über
                        Firebase live mit allen. Anleitung: KEGELPEGEL.md
public/kegelpegel-banner.jpg
                        Wappen des Kegelpegel (Kopf der Seite)
public/kegelpegel-vorschau.png
                        Vorschaubild für geteilte Links
CLAUDE.md             Diese Übersicht
KEGELPEGEL.md         Bedienung und Einrichtung des Olympiade-Punktestands
MEHRSPIELER.md        Zu zweit im Inselspiel: Code vergeben, beitreten,
                      Firebase-Freigabe
```

## Veröffentlichung

Jeder Push auf den Branch wird per GitHub Actions automatisch gebaut und auf
GitHub Pages veröffentlicht (`.github/workflows/deploy.yml`). Live-Adresse:
`https://dors93-create.github.io/App-Gartenplanung/`.

Arbeitsweise (so vereinbart am 24.11.2026): Änderungen entstehen auf einem
eigenen Zweig und werden im Browser getestet. Sind die Tests bestanden, kommen
sie ohne weitere Rückfrage in den Live-Branch
`claude/grunriss-initial-setup-Fawpx` – und sind damit veröffentlicht.

## Tests

Vor jeder Veröffentlichung laufen die automatischen Tests:

```bash
npm test               # Speicher-Baustein (gaerten.js), ohne Browser, Sekunden
npm run test:browser   # alle Browser-Tests, rund 11 Minuten
npm run test:browser -- gaerten   # nur einen davon: ablauf, feinheiten, gaerten
                                  # (Gartenplaner) oder inselspiel, zuzweit,
                                  # zuzweit-verbindung (Inselspiel)
```

- Die Browser-Tests (`tests/*.test.cjs`) bedienen die App wie ein Mensch – am
  Desktop und im Handy-Format – und prüfen jeden Schritt. `tests/browser.cjs`
  startet dafür die App lokal und beendet sie danach wieder.
- Sie brauchen Playwright mit Chromium (in den Claude-Sitzungen vorinstalliert,
  bewusst nicht in `package.json`) und Netzzugriff auf `www.wfs.nrw.de`: Das
  Kataster wird echt abgefragt (wenige Anfragen). Luftbild und Adresssuche
  werden in den Tests nicht belastet.
- Neue Funktionen bekommen eigene Prüfungen; ein Fehler, der einmal gefunden
  wurde, bekommt eine Prüfung, damit er nicht zurückkommt.
- Ein Seitenfehler oder ein unerwartetes Browser-Fenster lässt den Test
  scheitern – auch wenn sonst alles stimmt.
- Der Garten-Test (`tests/gaerten.test.cjs`) besteht aus Teilen mit je einer
  frischen Seite; jede Kataster-Abfrage geht dabei nur einmal hinaus.
- Das Inselspiel hat drei eigene Browser-Tests im Handy-Format: `inselspiel`
  (kurze Anleitung, Siegziel, Spielstände), `zuzweit` (gemeinsamer Start, Tempo
  und Pause vom Gastgeber, ruhige Fahrt beim Gast, kein Spielstand geht
  verloren) und `zuzweit-verbindung` (Eröffnen, Beitreten, Meldungen bei
  fehlender Freigabe oder Funkstille). Sie spielen zu zweit in zwei Fenstern
  über die echten Knöpfe. Die Firebase-Datenbank ist dabei nachgebaut
  (`tests/firebase-nachbau.cjs`): Es geht nichts ins Netz und nichts in die
  echte Datenbank – die echte Firebase-Strecke prüfen sie also nicht.
- Bildschirmfotos der Tests landen in `tests/ausgabe/` (nicht im Git).

## Lokal starten

```bash
npm install   # einmalig: Abhängigkeiten installieren
npm run dev   # Dev-Server starten – URL erscheint im Terminal (z. B. http://localhost:5173)
```

Im Browser die angezeigte Adresse öffnen. Mit `Strg + C` im Terminal stoppen.

Produktions-Build erzeugen: `npm run build` (Ergebnis liegt in `dist/`),
Vorschau davon: `npm run preview`.

## Design-Konventionen

- **Hell & ruhig:** weißer/sehr heller Hintergrund, viel Weißraum.
- **Genau EINE Akzentfarbe:** ein frisches Grün (`--accent: #16a34a`),
  sparsam eingesetzt; sonst neutrale Grautöne.
- **Sanfte Schatten statt harter Rahmen,** dezent abgerundete Ecken.
- **Mobile-first:** funktioniert sauber auf Handy und Desktop.
- Farben, Schatten und Radien stehen als CSS-Variablen oben in `src/style.css`.

## Code-Konventionen

- Code und Kommentare auf Deutsch, ausführlich kommentiert.
- Einfachheit vor Cleverness – verständlich für Nicht-Programmierer:innen.
- Konfigurierbare Werte (URLs, Zoomstufen) stehen gesammelt oben in `main.js`.
- Ein- und Ausblenden läuft über das HTML-Attribut `hidden`. Eine Regel oben in
  `style.css` gibt ihm Vorrang vor eigenen `display`-Angaben – nicht entfernen.
