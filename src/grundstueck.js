// =========================================================================
// Grünriss – Grundstücksauswahl (Schritt 2)
// -------------------------------------------------------------------------
// Ablauf für die Nutzer:in:
//   1. Adresse suchen (das passiert in main.js).
//   2. "Grundstück auswählen" -> auf das eigene Grundstück tippen.
//   3. Das amtliche Flurstück (NRW-Kataster, ALKIS) wird abgerufen und farbig
//      hervorgehoben; Seitenlängen und Fläche werden angezeigt.
//   4. "OK, übernehmen" -> alles außerhalb des Grundstücks wird weiß
//      ausgeblendet; nur das Grundstück bleibt sichtbar – mit Bemaßung.
//
// Technischer Hintergrund (siehe auch CLAUDE.md):
//   - Daten vom WFS "wfs_nw_alkis_vereinfacht" (Objektart Flurstueck).
//   - Der Dienst liefert GML (XML) in EPSG:25832 (UTM, Meter). Wir lesen die
//     Eckpunkte aus dem XML, rechnen Längen/Fläche direkt in Metern (amtlich
//     genau) und rechnen für die Karte mit proj4 nach Lat/Lon (EPSG:4326) um.
// =========================================================================

import maplibregl from "maplibre-gl";
import proj4 from "proj4";

// -------------------------------------------------------------------------
// Konfiguration
// -------------------------------------------------------------------------

// Adresse des NRW-Kataster-Dienstes (amtliche Flurstücke).
const WFS_URL = "https://www.wfs.nrw.de/geobasis/wfs_nw_alkis_vereinfacht";

// EPSG:25832 (UTM-Zone 32N) für proj4 bekannt machen. EPSG:4326 (Lat/Lon)
// kennt proj4 bereits von Haus aus.
proj4.defs(
  "EPSG:25832",
  "+proj=utm +zone=32 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs",
);

// Lat/Lon -> UTM32 (Meter). Rückgabe: [ostwert, nordwert]
const nach25832 = (lng, lat) => proj4("EPSG:4326", "EPSG:25832", [lng, lat]);
// UTM32 (Meter) -> Lat/Lon. Rückgabe: [lng, lat]
const nachLngLat = (e, n) => proj4("EPSG:25832", "EPSG:4326", [e, n]);

// IDs der Karten-Quellen/-Ebenen, die wir anlegen.
const SRC_FLUR = "gp-flurstueck"; // das gewählte Flurstück (Vieleck)
const SRC_MASKE = "gp-maske"; // weiße Maske mit „Loch“ = Grundstück
const LAYER_MASKE = "gp-maske-fill";
const LAYER_FILL = "gp-flurstueck-fill";
const LAYER_LINIE = "gp-flurstueck-linie";

// -------------------------------------------------------------------------
// Hilfsfunktionen: Zahlen hübsch auf Deutsch formatieren
// -------------------------------------------------------------------------

// Längen: z. B. 12,3 m
const meter = (wert) =>
  wert.toLocaleString("de-DE", { maximumFractionDigits: 1 }) + " m";
// Flächen: z. B. 540 m²
const quadratmeter = (wert) =>
  Math.round(wert).toLocaleString("de-DE") + " m²";

// -------------------------------------------------------------------------
// Hauptfunktion: richtet die gesamte Grundstücks-Logik ein.
// Wird von main.js mit der fertigen Karte aufgerufen und gibt eine kleine
// Steuerung zurück ({ zeigeStart }).
// -------------------------------------------------------------------------
export function initGrundstueck(map) {
  // Verweise auf das untere Bedienfeld und seine Knöpfe.
  const panel = document.getElementById("gp-panel");
  const panelText = document.getElementById("gp-text");
  const btnAktion = document.getElementById("gp-aktion"); // grüner Hauptknopf
  const btnZurueck = document.getElementById("gp-zurueck"); // dezenter Knopf

  // Zustand der Auswahl: "aus" | "bereit" | "auswaehlen" | "vorschau" | "fertig"
  let zustand = "aus";
  // Das aktuell hervorgehobene Flurstück (Ergebnis eines Klicks).
  let aktuell = null;
  // Liste der Maß-Beschriftungen (HTML-Marker), damit wir sie aufräumen können.
  let masseMarker = [];

  // -----------------------------------------------------------------------
  // Karten-Ebenen einmalig anlegen (leer); später füllen wir sie mit Daten.
  // -----------------------------------------------------------------------
  function ebenenSicherstellen() {
    if (map.getSource(SRC_FLUR)) return; // schon angelegt

    const leer = { type: "FeatureCollection", features: [] };
    map.addSource(SRC_FLUR, { type: "geojson", data: leer });
    map.addSource(SRC_MASKE, { type: "geojson", data: leer });

    // Reihenfolge (unten -> oben): Luftbild, weiße Maske, grüne Füllung, Umriss.
    map.addLayer({
      id: LAYER_MASKE,
      type: "fill",
      source: SRC_MASKE,
      layout: { visibility: "none" },
      paint: { "fill-color": "#ffffff", "fill-opacity": 1 },
    });
    map.addLayer({
      id: LAYER_FILL,
      type: "fill",
      source: SRC_FLUR,
      layout: { visibility: "none" },
      paint: { "fill-color": "#16a34a", "fill-opacity": 0.25 },
    });
    map.addLayer({
      id: LAYER_LINIE,
      type: "line",
      source: SRC_FLUR,
      layout: { visibility: "none", "line-join": "round" },
      paint: { "line-color": "#16a34a", "line-width": 3 },
    });
  }

  // Sichtbarkeit einer Ebene bequem schalten.
  function zeige(layerId, sichtbar) {
    map.setLayoutProperty(layerId, "visibility", sichtbar ? "visible" : "none");
  }

  // Alle Maß-Beschriftungen von der Karte entfernen.
  function masseLoeschen() {
    masseMarker.forEach((m) => m.remove());
    masseMarker = [];
  }

  // -----------------------------------------------------------------------
  // GML (XML) des Dienstes auswerten -> Liste von Flurstücken.
  // Jedes Flurstück: { ring25832: [[e,n],...], ringLngLat: [[lng,lat],...],
  //                    info: "Gemarkung …, Flur …, Flurstück …" }
  // -----------------------------------------------------------------------
  function leseFlurstuecke(xmlText) {
    const xml = new DOMParser().parseFromString(xmlText, "application/xml");
    const ergebnisse = [];

    // Jedes <wfs:member> enthält genau ein Flurstück.
    const member = xml.getElementsByTagNameNS("*", "member");
    for (const m of member) {
      // Den äußeren Umriss als Punktliste lesen (erste <gml:posList>).
      const posListe = m.getElementsByTagNameNS("*", "posList")[0];
      if (!posListe) continue;

      // Die Punktliste ist "ost nord ost nord …" (Meter, EPSG:25832).
      const zahlen = posListe.textContent.trim().split(/\s+/).map(Number);
      const ring25832 = [];
      for (let i = 0; i + 1 < zahlen.length; i += 2) {
        ring25832.push([zahlen[i], zahlen[i + 1]]);
      }
      if (ring25832.length < 4) continue; // kein gültiges Vieleck

      // Für die Karte: jeden Punkt nach Lat/Lon umrechnen.
      const ringLngLat = ring25832.map(([e, n]) => nachLngLat(e, n));

      // Beschreibende Angaben (falls vorhanden) zusammenstellen.
      const feld = (name) => {
        const el = m.getElementsByTagNameNS("*", name)[0];
        return el ? el.textContent.trim() : "";
      };
      const teile = [];
      if (feld("gemarkung")) teile.push("Gemarkung " + feld("gemarkung"));
      if (feld("flur")) teile.push("Flur " + feld("flur"));
      if (feld("flstnrzae")) teile.push("Flurstück " + feld("flstnrzae"));

      ergebnisse.push({
        ring25832,
        ringLngLat,
        info: teile.join(", "),
      });
    }
    return ergebnisse;
  }

  // Punkt-in-Vieleck-Test (Strahl-Methode), in Metern (EPSG:25832).
  function punktImRing(e, n, ring) {
    let drin = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [ei, ni] = ring[i];
      const [ej, nj] = ring[j];
      const schneidet =
        ni > n !== nj > n &&
        e < ((ej - ei) * (n - ni)) / (nj - ni) + ei;
      if (schneidet) drin = !drin;
    }
    return drin;
  }

  // -----------------------------------------------------------------------
  // Maße berechnen: Seitenlängen (Meter) und Fläche (m²) – direkt in UTM,
  // also amtlich genau, ohne Verzerrung durch Lat/Lon.
  // -----------------------------------------------------------------------
  function berechneMasse(ring25832) {
    const seiten = [];
    let flaeche2 = 0; // doppelte Fläche (Gauß'sche Trapezformel)
    for (let i = 0; i < ring25832.length - 1; i++) {
      const [e1, n1] = ring25832[i];
      const [e2, n2] = ring25832[i + 1];
      seiten.push({ laenge: Math.hypot(e2 - e1, n2 - n1) });
      flaeche2 += e1 * n2 - e2 * n1;
    }
    return { seiten, flaeche: Math.abs(flaeche2) / 2 };
  }

  // -----------------------------------------------------------------------
  // Ein Flurstück am angeklickten Punkt vom Kataster-Dienst holen.
  // -----------------------------------------------------------------------
  async function holeFlurstueck(lng, lat) {
    // Klickpunkt nach UTM32 umrechnen und eine kleine Box (±1 m) bilden.
    const [e, n] = nach25832(lng, lat);
    const d = 1;
    const bbox = `${e - d},${n - d},${e + d},${n + d},urn:ogc:def:crs:EPSG::25832`;

    const url =
      `${WFS_URL}?SERVICE=WFS&VERSION=2.0.0&REQUEST=GetFeature` +
      `&TYPENAMES=ave:Flurstueck&COUNT=5` +
      `&SRSNAME=urn:ogc:def:crs:EPSG::25832&BBOX=${bbox}`;

    const antwort = await fetch(url);
    if (!antwort.ok) throw new Error("WFS-Status " + antwort.status);
    const text = await antwort.text();

    const liste = leseFlurstuecke(text);
    if (liste.length === 0) return null;

    // Falls die kleine Box mehrere Flurstücke berührt (z. B. an einer Grenze):
    // dasjenige nehmen, in dem der Klickpunkt wirklich liegt.
    const treffer = liste.find((f) => punktImRing(e, n, f.ring25832));
    return treffer || liste[0];
  }

  // -----------------------------------------------------------------------
  // Anzeige: gewähltes Flurstück als Vorschau (grün) auf der Karte zeigen.
  // -----------------------------------------------------------------------
  function zeigeVorschau(flurstueck) {
    ebenenSicherstellen();
    const feature = {
      type: "Feature",
      geometry: { type: "Polygon", coordinates: [flurstueck.ringLngLat] },
    };
    map.getSource(SRC_FLUR).setData(feature);
    zeige(LAYER_FILL, true);
    zeige(LAYER_LINIE, true);
    zeige(LAYER_MASKE, false);
    masseLoeschen();
  }

  // -----------------------------------------------------------------------
  // OK: Umgebung weiß ausblenden und das Grundstück bemaßen.
  // -----------------------------------------------------------------------
  function uebernehmen(flurstueck) {
    // Weiße Maske = ganze Welt mit einem „Loch“ in Form des Grundstücks.
    const welt = [
      [-180, -85],
      [180, -85],
      [180, 85],
      [-180, 85],
      [-180, -85],
    ];
    const maske = {
      type: "Feature",
      geometry: {
        type: "Polygon",
        coordinates: [welt, flurstueck.ringLngLat], // 2. Ring = Loch
      },
    };
    map.getSource(SRC_MASKE).setData(maske);

    zeige(LAYER_MASKE, true); // Umgebung weiß
    zeige(LAYER_FILL, false); // grüne Füllung weg (freier Blick aufs Grundstück)
    zeige(LAYER_LINIE, true); // Umriss bleibt

    // Bemaßung anlegen.
    const { seiten, flaeche } = berechneMasse(flurstueck.ring25832);
    masseLoeschen();

    // Seitenlängen: je ein Etikett in der Mitte jeder Kante.
    const ring = flurstueck.ringLngLat;
    seiten.forEach((seite, i) => {
      const [lng1, lat1] = ring[i];
      const [lng2, lat2] = ring[i + 1];
      const mitte = [(lng1 + lng2) / 2, (lat1 + lat2) / 2];
      masseMarker.push(etikett(mitte, meter(seite.laenge), "masslabel"));
    });

    // Fläche: ein hervorgehobenes Etikett im Schwerpunkt.
    masseMarker.push(
      etikett(schwerpunkt(ring), quadratmeter(flaeche), "masslabel masslabel--flaeche"),
    );
  }

  // Ein HTML-Etikett als Karten-Marker an einer Lat/Lon-Position erzeugen.
  function etikett(lngLat, text, klasse) {
    const el = document.createElement("div");
    el.className = klasse;
    el.textContent = text;
    return new maplibregl.Marker({ element: el }).setLngLat(lngLat).addTo(map);
  }

  // Einfacher Schwerpunkt (Mittel aller Eckpunkte) – genügt zum Beschriften.
  function schwerpunkt(ring) {
    let lng = 0,
      lat = 0;
    const n = ring.length - 1; // letzter Punkt = erster, nicht doppelt zählen
    for (let i = 0; i < n; i++) {
      lng += ring[i][0];
      lat += ring[i][1];
    }
    return [lng / n, lat / n];
  }

  // -----------------------------------------------------------------------
  // Alles zurücksetzen (Grafik + Maße entfernen).
  // -----------------------------------------------------------------------
  function aufraeumen() {
    aktuell = null;
    masseLoeschen();
    if (map.getSource(SRC_FLUR)) {
      const leer = { type: "FeatureCollection", features: [] };
      map.getSource(SRC_FLUR).setData(leer);
      map.getSource(SRC_MASKE).setData(leer);
      zeige(LAYER_FILL, false);
      zeige(LAYER_LINIE, false);
      zeige(LAYER_MASKE, false);
    }
  }

  // -----------------------------------------------------------------------
  // Zustands-Wechsel: passt Bedienfeld, Cursor und Karte an.
  // -----------------------------------------------------------------------
  function setze(neuerZustand) {
    zustand = neuerZustand;

    // Fadenkreuz nur während des Auswählens.
    map.getContainer().classList.toggle(
      "gp-auswahl-cursor",
      zustand === "auswaehlen",
    );

    if (zustand === "bereit") {
      panel.hidden = false;
      panelText.textContent = "Wähle dein Grundstück auf der Karte aus.";
      btnAktion.textContent = "Grundstück auswählen";
      btnZurueck.hidden = true;
    } else if (zustand === "auswaehlen") {
      panel.hidden = false;
      panelText.textContent = "Tippe auf dein Grundstück.";
      btnAktion.hidden = true;
      btnZurueck.hidden = false;
      btnZurueck.textContent = "Abbrechen";
    } else if (zustand === "vorschau") {
      panel.hidden = false;
      btnAktion.hidden = false;
      panelText.textContent = aktuell.info
        ? aktuell.info + " – passt das?"
        : "Grundstück gefunden – passt das?";
      btnAktion.textContent = "OK, übernehmen";
      btnZurueck.hidden = false;
      btnZurueck.textContent = "Anderes wählen";
    } else if (zustand === "fertig") {
      panel.hidden = false;
      btnAktion.hidden = true;
      panelText.textContent = aktuell.info
        ? "Übernommen: " + aktuell.info + "."
        : "Grundstück übernommen.";
      btnZurueck.hidden = false;
      btnZurueck.textContent = "Neu beginnen";
    }
  }

  // -----------------------------------------------------------------------
  // Klick auf die Karte: nur während Auswahl/Vorschau ein Flurstück holen.
  // -----------------------------------------------------------------------
  map.on("click", async (e) => {
    if (zustand !== "auswaehlen" && zustand !== "vorschau") return;

    panelText.textContent = "Suche Flurstück …";
    try {
      const flurstueck = await holeFlurstueck(e.lngLat.lng, e.lngLat.lat);
      if (!flurstueck) {
        panelText.textContent =
          "Hier wurde kein Flurstück gefunden. Bitte direkt auf das Grundstück tippen.";
        return;
      }
      aktuell = flurstueck;
      zeigeVorschau(flurstueck);
      setze("vorschau");
    } catch (fehler) {
      console.error(fehler);
      panelText.textContent = "Kataster-Dienst gerade nicht erreichbar.";
    }
  });

  // -----------------------------------------------------------------------
  // Knöpfe im Bedienfeld
  // -----------------------------------------------------------------------
  btnAktion.addEventListener("click", () => {
    if (zustand === "bereit") {
      setze("auswaehlen"); // los geht's: auf das Grundstück tippen
    } else if (zustand === "vorschau") {
      uebernehmen(aktuell); // weiß ausblenden + bemaßen
      setze("fertig");
    }
  });

  btnZurueck.addEventListener("click", () => {
    if (zustand === "auswaehlen") {
      setze("bereit"); // Auswahl abgebrochen
    } else if (zustand === "vorschau") {
      aufraeumen();
      setze("auswaehlen"); // erneut tippen
    } else if (zustand === "fertig") {
      aufraeumen();
      setze("bereit"); // ganz von vorn
    }
  });

  // -----------------------------------------------------------------------
  // Nach außen: main.js ruft das auf, sobald eine Adresse gefunden wurde.
  // -----------------------------------------------------------------------
  return {
    zeigeStart() {
      aufraeumen();
      setze("bereit");
    },
  };
}
