// =========================================================================
// Grünriss – Grundstücksauswahl (Schritt 2)
// -------------------------------------------------------------------------
// Ablauf für die Nutzer:in:
//   1. Adresse suchen (das passiert in main.js).
//   2. "Grundstück auswählen" -> auf das eigene Grundstück tippen.
//      Es können MEHRERE Flurstücke gewählt werden: erneutes Tippen auf ein
//      bereits markiertes Flurstück hebt die Markierung wieder auf.
//   3. Die gewählten Flurstücke (NRW-Kataster, ALKIS) werden farbig
//      hervorgehoben.
//   4. "OK, übernehmen" -> alles außerhalb der gewählten Flurstücke wird weiß
//      ausgeblendet; jedes Flurstück wird bemaßt (Seitenlängen + Gesamtfläche).
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

// Fertige Abfrage des Dienstes, die ein Flurstück über sein Kennzeichen
// liefert (für gespeicherte Gärten, deren Umriss noch fehlt).
const ABFRAGE_NACH_KENNZEICHEN =
  "http://repository.gdi-de.org/query/adv/produkt/alkis-vereinfacht/2.0/flst-by-kennzeichen";

// Ein Tipp, der so kurz nach dem vorigen und so nah an derselben Stelle kommt,
// gilt als zweiter Teil eines Doppeltipps und wird ignoriert.
const DOPPELTIPP_MS = 600; // Millisekunden
const DOPPELTIPP_PIXEL = 30; // Bildschirm-Pixel

// So lange nach einem Wechsel des Bedienfelds ignorieren wir Klicks auf seine
// Knöpfe. Bei einem Doppelklick träfe der zweite Klick sonst den Knopf, der
// inzwischen an derselben Stelle erschienen ist (z. B. „Abbrechen“).
const KNOPF_SPERRE_MS = 400;

// Antwortet der Kataster-Dienst nicht, brechen wir die Abfrage nach dieser
// Zeit ab und melden es (statt endlos „Suche Flurstück …“ zu zeigen).
const ABFRAGE_ZEITLIMIT_MS = 15000;

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
const SRC_FLUR = "gp-flurstueck"; // die gewählten Flurstücke (Vielecke)
const SRC_MASKE = "gp-maske"; // weiße Maske mit „Löchern“ = Grundstück
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
export function initGrundstueck(map, optionen = {}) {
  // Verweise auf das untere Bedienfeld und seine Knöpfe.
  const panel = document.getElementById("gp-panel");
  const panelText = document.getElementById("gp-text");
  const btnAktion = document.getElementById("gp-aktion"); // grüner Hauptknopf
  const btnZurueck = document.getElementById("gp-zurueck"); // dezenter Knopf

  // Zustand der Auswahl: "aus" | "bereit" | "auswaehlen" | "fertig"
  let zustand = "aus";
  // Liste der aktuell gewählten Flurstücke (Mehrfachauswahl möglich).
  let auswahl = [];
  // Liste der Maß-Beschriftungen (HTML-Marker), damit wir sie aufräumen können.
  let masseMarker = [];
  // Alle gerade laufenden Kataster-Abfragen (je ein AbortController). Mehrere
  // zugleich sind möglich, z. B. wenn zügig zwei Flurstücke angetippt werden.
  // Über diese Liste können wir Abfragen verwerfen, die nicht mehr gebraucht
  // werden (Abbrechen, OK, neue Adresse).
  const offeneAbfragen = new Set();
  // Zeitpunkt und Stelle des letzten Tipps – zum Erkennen eines Doppeltipps.
  let letzterTipp = { zeit: -Infinity, x: 0, y: 0 };
  // Die Tipps werden durchgezählt. Je Flurstück merken wir, welcher Tipp
  // zuletzt über es entschieden hat: Eine verspätete Antwort auf einen älteren
  // Tipp darf einen neueren nicht überstimmen.
  let tippNr = 0;
  const zuletztEntschieden = new Map(); // Flurstücks-Kennung -> Nummer des Tipps
  // Zeitpunkt des letzten Zustandswechsels (siehe KNOPF_SPERRE_MS).
  let zustandSeit = -Infinity;

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
  // Jedes Flurstück: { id, ring25832: [[e,n],...], ringLngLat: [[lng,lat],...],
  //                    info: "Gemarkung …, Flur …, Flurstück …",
  //                    lage: "Mozartstraße 3" (amtliche Lagebezeichnung),
  //                    amtlicheFlaeche: 2149 (m² laut Kataster) }
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
        // Eindeutige Kennung (Flurstückskennzeichen) – damit wir beim erneuten
        // Antippen erkennen, ob ein Flurstück schon gewählt ist.
        id: feld("flstkennz") || feld("oid") || ring25832[0].join(","),
        ring25832,
        ringLngLat,
        info: teile.join(", "),
        lage: feld("lagebeztxt"),
        amtlicheFlaeche: Number(feld("flaeche")) || null,
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
  // Maße eines Flurstücks: Seitenlängen (Meter) und Fläche (m²) – direkt in
  // UTM, also amtlich genau, ohne Verzerrung durch Lat/Lon.
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
  // „signal“ erlaubt es, die Abfrage abzubrechen (siehe abfragenAbbrechen).
  // -----------------------------------------------------------------------
  async function holeFlurstueck(lng, lat, signal) {
    // Klickpunkt nach UTM32 umrechnen und eine kleine Box (±1 m) bilden.
    const [e, n] = nach25832(lng, lat);
    const d = 1;
    const bbox = `${e - d},${n - d},${e + d},${n + d},urn:ogc:def:crs:EPSG::25832`;

    const url =
      `${WFS_URL}?SERVICE=WFS&VERSION=2.0.0&REQUEST=GetFeature` +
      `&TYPENAMES=ave:Flurstueck&COUNT=5` +
      `&SRSNAME=urn:ogc:def:crs:EPSG::25832&BBOX=${bbox}`;

    const antwort = await fetch(url, { signal });
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
  // Ein Flurstück gezielt über sein Kennzeichen holen (für gespeicherte
  // Gärten, deren Umriss noch nicht gespeichert ist).
  // -----------------------------------------------------------------------
  async function holeNachKennzeichen(kennzeichen) {
    const url =
      `${WFS_URL}?SERVICE=WFS&VERSION=2.0.0&REQUEST=GetFeature` +
      `&STOREDQUERY_ID=${ABFRAGE_NACH_KENNZEICHEN}` +
      `&CRS=urn:ogc:def:crs:EPSG::25832` +
      `&kennzeichen=${encodeURIComponent(kennzeichen)}`;

    // Antwortet der Dienst nicht, geben wir nach dem Zeitlimit auf.
    const abfrage = new AbortController();
    const zeitlimit = setTimeout(() => abfrage.abort(), ABFRAGE_ZEITLIMIT_MS);
    try {
      const antwort = await fetch(url, { signal: abfrage.signal });
      if (!antwort.ok) throw new Error("WFS-Status " + antwort.status);
      return leseFlurstuecke(await antwort.text())[0] || null;
    } finally {
      clearTimeout(zeitlimit);
    }
  }

  // -----------------------------------------------------------------------
  // Anzeige: alle gewählten Flurstücke als Vorschau (grün) auf der Karte.
  // -----------------------------------------------------------------------
  function zeigeAuswahl() {
    ebenenSicherstellen();
    const fc = {
      type: "FeatureCollection",
      features: auswahl.map((f) => ({
        type: "Feature",
        geometry: { type: "Polygon", coordinates: [f.ringLngLat] },
      })),
    };
    map.getSource(SRC_FLUR).setData(fc);

    const hatAuswahl = auswahl.length > 0;
    zeige(LAYER_FILL, hatAuswahl);
    zeige(LAYER_LINIE, hatAuswahl);
    zeige(LAYER_MASKE, false);
    masseLoeschen();
  }

  // -----------------------------------------------------------------------
  // OK: Umgebung weiß ausblenden und alle gewählten Flurstücke bemaßen.
  // Gibt die Gesamtfläche (m²) zurück.
  // -----------------------------------------------------------------------
  function uebernehmen() {
    // Weiße Maske = ganze Welt mit einem „Loch“ je gewähltem Flurstück.
    const welt = [
      [-180, -85],
      [180, -85],
      [180, 85],
      [-180, 85],
      [-180, -85],
    ];
    const loecher = auswahl.map((f) => f.ringLngLat);
    const maske = {
      type: "Feature",
      geometry: { type: "Polygon", coordinates: [welt, ...loecher] },
    };
    map.getSource(SRC_MASKE).setData(maske);

    zeige(LAYER_MASKE, true); // Umgebung weiß
    zeige(LAYER_FILL, false); // grüne Füllung weg (freier Blick aufs Grundstück)
    zeige(LAYER_LINIE, true); // Umrisse bleiben

    // Bemaßung: je Flurstück die Seitenlängen, dazu eine Gesamtfläche.
    masseLoeschen();
    let gesamtflaeche = 0;
    auswahl.forEach((f) => {
      const { seiten, flaeche } = berechneMasse(f.ring25832);
      gesamtflaeche += flaeche;
      const ring = f.ringLngLat;
      seiten.forEach((seite, i) => {
        const [lng1, lat1] = ring[i];
        const [lng2, lat2] = ring[i + 1];
        const mitte = [(lng1 + lng2) / 2, (lat1 + lat2) / 2];
        masseMarker.push(etikett(mitte, meter(seite.laenge), "masslabel"));
      });
    });

    // Gesamtfläche: ein hervorgehobenes Etikett im (flächengewichteten) Mittel.
    masseMarker.push(
      etikett(
        gesamtSchwerpunkt(auswahl),
        quadratmeter(gesamtflaeche),
        "masslabel masslabel--flaeche",
      ),
    );

    return gesamtflaeche;
  }

  // Ein HTML-Etikett als Karten-Marker an einer Lat/Lon-Position erzeugen.
  function etikett(lngLat, text, klasse) {
    const el = document.createElement("div");
    el.className = klasse;
    el.textContent = text;
    return new maplibregl.Marker({ element: el }).setLngLat(lngLat).addTo(map);
  }

  // Einfacher Schwerpunkt eines Rings (Mittel aller Eckpunkte).
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

  // Gemeinsamer Schwerpunkt mehrerer Flurstücke (nach Fläche gewichtet),
  // damit das Flächen-Etikett sinnvoll platziert ist.
  function gesamtSchwerpunkt(flurstuecke) {
    let lng = 0,
      lat = 0,
      gewicht = 0;
    flurstuecke.forEach((f) => {
      const [cx, cy] = schwerpunkt(f.ringLngLat);
      const a = berechneMasse(f.ring25832).flaeche || 1;
      lng += cx * a;
      lat += cy * a;
      gewicht += a;
    });
    return [lng / gewicht, lat / gewicht];
  }

  // -----------------------------------------------------------------------
  // Alle noch laufenden Kataster-Abfragen verwerfen. Ihre Antworten kämen
  // sonst verspätet an und würden die Auswahl verändern, obwohl inzwischen
  // z. B. „Abbrechen“ oder „OK, übernehmen“ gedrückt wurde.
  // -----------------------------------------------------------------------
  function abfragenAbbrechen() {
    const offene = [...offeneAbfragen];
    offeneAbfragen.clear(); // zuerst leeren – daran erkennt der Klick-Code „verworfen“
    offene.forEach((abfrage) => abfrage.abort());
  }

  // -----------------------------------------------------------------------
  // Alles zurücksetzen (Auswahl + Grafik + Maße entfernen).
  // -----------------------------------------------------------------------
  function aufraeumen() {
    abfragenAbbrechen();
    zuletztEntschieden.clear();
    auswahl = [];
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
  // Während des Auswählens: Text + Hauptknopf an die Anzahl anpassen.
  // -----------------------------------------------------------------------
  function aktualisiereAuswahlText() {
    const n = auswahl.length;
    if (n === 0) {
      panelText.textContent = "Tippe auf dein Grundstück (mehrere möglich).";
      btnAktion.hidden = true; // ohne Auswahl gibt es nichts zu übernehmen
    } else {
      panelText.textContent =
        n === 1
          ? "1 Flurstück gewählt – tippe für weitere oder bestätige mit „OK“."
          : n +
            " Flurstücke gewählt – tippe zum Hinzufügen/Entfernen oder „OK“.";
      btnAktion.hidden = false;
      btnAktion.textContent = "OK, übernehmen";
    }
  }

  // -----------------------------------------------------------------------
  // Zustands-Wechsel: passt Bedienfeld, Cursor und Karte an.
  // -----------------------------------------------------------------------
  function setze(neuerZustand, gesamtflaeche) {
    zustand = neuerZustand;
    zustandSeit = performance.now();

    // Fadenkreuz nur während des Auswählens.
    map.getContainer().classList.toggle(
      "gp-auswahl-cursor",
      zustand === "auswaehlen",
    );

    // Während des Auswählens soll ein Doppeltipp nicht in die Karte
    // hineinzoomen – er gilt hier dem Grundstück (siehe istDoppeltipp).
    if (zustand === "auswaehlen") {
      map.doubleClickZoom.disable();
    } else {
      map.doubleClickZoom.enable();
    }

    if (zustand === "bereit") {
      panel.hidden = false;
      panelText.textContent = "Wähle dein Grundstück auf der Karte aus.";
      btnAktion.hidden = false;
      btnAktion.textContent = "Grundstück auswählen";
      btnZurueck.hidden = true;
    } else if (zustand === "auswaehlen") {
      panel.hidden = false;
      btnZurueck.hidden = false;
      btnZurueck.textContent = "Abbrechen";
      aktualisiereAuswahlText();
    } else if (zustand === "fertig") {
      panel.hidden = false;
      // Hauptknopf führt jetzt weiter in den Objekt-Editor (Schritt 3a).
      btnAktion.hidden = false;
      btnAktion.textContent = "Garten erfassen";
      btnZurueck.hidden = false;
      btnZurueck.textContent = "Neu beginnen";
      const n = auswahl.length;
      panelText.textContent =
        (n === 1 ? "1 Flurstück" : n + " Flurstücke") +
        " übernommen – Fläche " +
        quadratmeter(gesamtflaeche || 0) +
        ".";
    }
  }

  // -----------------------------------------------------------------------
  // Ist dieser Tipp der zweite Teil eines Doppeltipps? Dann soll er das
  // gerade gewählte Flurstück nicht gleich wieder abwählen. Erkannt wird er an
  // Zeit und Ort: kurz nach dem vorigen Tipp und an fast derselben Stelle.
  // Auch ignorierte Tipps zählen als „voriger Tipp“ – wer ungeduldig mehrmals
  // auf dieselbe Stelle tippt, löst also nur eine Abfrage aus. Der Preis: Ein
  // bewusster zweiter Tipp (abwählen) braucht eine kurze Pause.
  // -----------------------------------------------------------------------
  function istDoppeltipp(e) {
    // Zeitstempel des Ereignisses nehmen (nicht „jetzt“): Zeichnet die Karte
    // gerade neu, kommt ein Tipp mit Verzögerung hier an.
    const zeit = e.originalEvent ? e.originalEvent.timeStamp : performance.now();
    const abstand = Math.hypot(
      e.point.x - letzterTipp.x,
      e.point.y - letzterTipp.y,
    );
    const doppelt =
      zeit - letzterTipp.zeit < DOPPELTIPP_MS && abstand < DOPPELTIPP_PIXEL;
    letzterTipp = { zeit, x: e.point.x, y: e.point.y };
    return doppelt;
  }

  // -----------------------------------------------------------------------
  // Klick auf die Karte: nur während des Auswählens. Ein Flurstück wird
  // hinzugefügt – oder, wenn es schon gewählt ist, wieder entfernt (Umschalten).
  // -----------------------------------------------------------------------
  map.on("click", async (e) => {
    if (zustand !== "auswaehlen") return;
    if (istDoppeltipp(e)) return;

    // Was war beim Tippen schon gewählt? Daran erkennen wir später, was der
    // Tipp bezwecken sollte (hinzufügen oder entfernen) – auch wenn die
    // Antwort des Katasters auf sich warten lässt und inzwischen ungeduldig
    // noch einmal getippt wurde.
    const vorherGewaehlt = new Set(auswahl.map((f) => f.id));
    const nr = ++tippNr; // laufende Nummer dieses Tipps

    const abfrage = new AbortController();
    offeneAbfragen.add(abfrage);
    const zeitlimit = setTimeout(() => abfrage.abort(), ABFRAGE_ZEITLIMIT_MS);

    panelText.textContent = "Suche Flurstück …";
    let hinweis = ""; // Meldung, falls kein Flurstück geliefert wurde
    try {
      const flurstueck = await holeFlurstueck(
        e.lngLat.lng,
        e.lngLat.lat,
        abfrage.signal,
      );
      // Wurde die Abfrage inzwischen verworfen (Abbrechen, OK, neue Adresse)?
      // Dann gehört die Antwort nicht mehr hierher.
      if (!offeneAbfragen.has(abfrage)) return;

      if (!flurstueck) {
        hinweis =
          "Hier wurde kein Flurstück gefunden. Bitte direkt auf das Grundstück tippen.";
      } else if ((zuletztEntschieden.get(flurstueck.id) || 0) < nr) {
        // (Hat inzwischen ein späterer Tipp über dieses Flurstück entschieden,
        // bleibt es dabei – diese Antwort kommt dann zu spät.)
        zuletztEntschieden.set(flurstueck.id, nr);

        // Umschalten: War das Flurstück beim Tippen schon gewählt, wird es
        // entfernt – sonst hinzugefügt. Zwei Tipps auf dasselbe, noch nicht
        // gewählte Flurstück wählen es also nur einmal.
        const index = auswahl.findIndex((f) => f.id === flurstueck.id);
        if (vorherGewaehlt.has(flurstueck.id)) {
          if (index >= 0) auswahl.splice(index, 1);
        } else if (index < 0) {
          auswahl.push(flurstueck);
        }
        zeigeAuswahl();
      }
    } catch (fehler) {
      // Bewusst verworfene Abfrage (siehe abfragenAbbrechen): nichts melden.
      if (!offeneAbfragen.has(abfrage)) return;
      console.error(fehler);
      hinweis = "Kataster-Dienst gerade nicht erreichbar.";
    } finally {
      clearTimeout(zeitlimit);
      offeneAbfragen.delete(abfrage);
    }

    // Bedienfeld nachführen. Läuft noch eine weitere Abfrage, bleibt der
    // Such-Hinweis stehen, bis auch sie beantwortet ist.
    if (hinweis && offeneAbfragen.size === 0) {
      panelText.textContent = hinweis;
      return;
    }
    aktualisiereAuswahlText();
    if (offeneAbfragen.size > 0) panelText.textContent = "Suche Flurstück …";
  });

  // -----------------------------------------------------------------------
  // Knöpfe im Bedienfeld
  // -----------------------------------------------------------------------
  // Kurz nach einem Wechsel des Bedienfelds zählt ein Klick noch nicht – er
  // ist dann meist der zweite Teil eines Doppelklicks auf den vorigen Knopf.
  const zuFrueh = () => performance.now() - zustandSeit < KNOPF_SPERRE_MS;

  btnAktion.addEventListener("click", () => {
    if (zuFrueh()) return;
    if (zustand === "bereit") {
      setze("auswaehlen"); // los geht's: auf das/die Grundstück(e) tippen
    } else if (zustand === "auswaehlen" && auswahl.length > 0) {
      abfragenAbbrechen(); // noch ausstehende Antworten zählen jetzt nicht mehr
      const gesamt = uebernehmen(); // weiß ausblenden + bemaßen
      setze("fertig", gesamt);
    } else if (zustand === "fertig") {
      // Weiter in den Objekt-Editor – die gewählten Flurstücke mitgeben.
      if (optionen.beimErfassen) optionen.beimErfassen(auswahl);
    }
  });

  btnZurueck.addEventListener("click", () => {
    if (zuFrueh()) return;
    if (zustand === "auswaehlen") {
      aufraeumen();
      setze("bereit"); // Auswahl abgebrochen
    } else if (zustand === "fertig") {
      aufraeumen();
      if (optionen.beimNeustart) optionen.beimNeustart(); // Editor mit aufräumen
      setze("bereit"); // ganz von vorn
    }
  });

  // -----------------------------------------------------------------------
  // Nach außen: main.js ruft das auf, sobald eine Adresse gefunden wurde.
  // -----------------------------------------------------------------------
  return {
    zeigeStart() {
      aufraeumen();
      // Auch den Editor leeren – sonst blieben Objekte und Etiketten des zuvor
      // geöffneten Plans auf der Karte stehen. (Der Plan selbst bleibt
      // gespeichert und erscheint wieder, sobald für sein Grundstück erneut
      // „Garten erfassen“ gewählt wird.)
      if (optionen.beimNeustart) optionen.beimNeustart();
      setze("bereit");
    },

    // Einen gespeicherten Garten wieder aufschlagen: Seine Flurstücke werden
    // ohne Antippen übernommen (weiße Maske, Bemaßung – wie nach „OK,
    // übernehmen“). Fehlt einem Flurstück der Umriss, holen wir ihn über das
    // Kennzeichen vom Kataster. Rückgabe: die vollständigen Flurstücke.
    // Wirft einen Fehler, wenn der Dienst nicht antwortet oder ein Flurstück
    // nicht mehr gefunden wird (dann mit dem Namen „FlurstueckFehlt“).
    async oeffne(gespeicherte) {
      const flurstuecke = [];
      for (const g of gespeicherte) {
        if (g.ring25832) {
          flurstuecke.push({
            ...g,
            ringLngLat: g.ring25832.map(([e, n]) => nachLngLat(e, n)),
          });
        } else {
          const geholt = await holeNachKennzeichen(g.id);
          if (!geholt) {
            // Der Dienst hat geantwortet, kennt das Flurstück aber nicht mehr
            // (z. B. nach einer Teilung) – das ist kein Verbindungsfehler.
            const fehler = new Error("Flurstück nicht gefunden: " + g.id);
            fehler.name = "FlurstueckFehlt";
            throw fehler;
          }
          flurstuecke.push(geholt);
        }
      }

      aufraeumen();
      if (optionen.beimNeustart) optionen.beimNeustart();
      auswahl = flurstuecke;
      zeigeAuswahl(); // legt bei Bedarf auch die Karten-Ebenen an
      const gesamt = uebernehmen();
      setze("fertig", gesamt);
      return flurstuecke;
    },
  };
}
