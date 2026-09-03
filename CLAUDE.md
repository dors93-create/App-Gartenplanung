# Grünriss

Ein **Garten-Planungstool** für Privatleute in NRW. Nutzer:innen sollen auf dem
aktuellen Luftbild ihres Grundstücks ihren Garten planen können.

Diese Datei gibt einen kurzen Überblick und hält die Konventionen fest, damit
auch Nicht-Programmierer:innen dem Projekt folgen können.

## Aktueller Stand

**Schritt 1 ist umgesetzt:**

- Bildschirmfüllende, interaktive Karte (MapLibre GL JS).
- Hintergrund: NRW-Luftbild (DOP) als WMS-Layer `nw_dop_rgb` vom Dienst
  `https://www.wms.nrw.de/geobasis/wms_nw_dop`.
- Suchfeld mit Adresssuche (Geocoding) über die kostenlose Nominatim-API,
  inkl. Vorschlägen während des Tippens. Die Karte fliegt sanft zur Adresse.
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
- Bemaßung: je Objekt die Fläche (m², bei Bäumen der Durchmesser); für das
  ausgewählte Objekt zusätzlich die Seitenlängen.
- Alles farbig und lokal im Browser gespeichert (localStorage, je Grundstück),
  übersteht das Neuladen.

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
src/style.css         Gestaltung (Design-Tokens, Suchleiste, Panel, Editor)
public/inselspiel.html  Eigenständiges Insel-Aufbauspiel (Bonus): eine einzelne
                        Datei, läuft auch ohne Server; wird mit veröffentlicht
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
```

## Veröffentlichung

Jeder Push auf den Branch wird per GitHub Actions automatisch gebaut und auf
GitHub Pages veröffentlicht (`.github/workflows/deploy.yml`). Live-Adresse:
`https://dors93-create.github.io/App-Gartenplanung/`.

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
