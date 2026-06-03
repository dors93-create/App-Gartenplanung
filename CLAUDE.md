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
- Suchfeld mit Adresssuche (Geocoding) über die kostenlose Nominatim-API.
  Die Karte fliegt sanft zur gefundenen Adresse.
- Oberfläche komplett auf Deutsch.

**Geplant (jeweils als eigener, späterer Schritt):**

- Grundstück zeichnen
- Elemente platzieren (Beete, Bäume, Wege …)

## Technik

- **Build-Tool:** [Vite](https://vitejs.dev/) (schneller Dev-Server + Build).
- **Karte:** [MapLibre GL JS](https://maplibre.org/) (freie Karten-Bibliothek).
- **Geocoding:** [Nominatim](https://nominatim.org/) (OpenStreetMap, kostenlos).
- **Schrift:** Geist (über `@fontsource-variable/geist` selbst gehostet).
- Reines JavaScript (kein Framework), damit der Code leicht lesbar bleibt.

## Projektstruktur

```
index.html        Grundgerüst der Seite (Karte + Suchleiste)
src/main.js       Gesamte Logik: Karte, Luftbild-Layer, Adresssuche
src/style.css     Gestaltung (Design-Tokens, Suchleiste, Marker)
CLAUDE.md         Diese Übersicht
```

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
