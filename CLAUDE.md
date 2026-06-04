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
  Flächen (Haus, Terrasse, Rasen, Weg, Beet) durch Antippen der Ecken zeichnen,
  Bäume als Punkte setzen.
- Objekte sind farbig, antippbar und löschbar; alles wird lokal im Browser
  gespeichert (localStorage, je Grundstück) und übersteht das Neuladen.

**Geplant (jeweils als eigener, späterer Schritt):**

- Schritt 3b – Indikative Bestandsaufnahme (automatisch): Haus aus amtlichen
  Daten + Luftbild-Analyse für Rasen/Terrasse/Bäume, befüllt den Editor vor.

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
src/editor.js         Schritt 3a: Objekte zeichnen/setzen, speichern
src/style.css         Gestaltung (Design-Tokens, Suchleiste, Panel, Editor)
CLAUDE.md             Diese Übersicht
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
