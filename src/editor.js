// =========================================================================
// Grünriss – Objekt-Editor (Schritt 3a)
// -------------------------------------------------------------------------
// Nach der Grundstücksauswahl erfasst die Nutzer:in hier ihren Garten:
//
//   Flächen (Haus, Terrasse, Rasen, Weg, Beet):
//     - "Frei zeichnen": Ecken nacheinander antippen, dann "Fläche fertig".
//     - "Rechteck": zwei gegenüberliegende Ecken antippen.
//   Bäume: als Kreis (ein Tipp setzt Mittelpunkt mit Standard-Radius).
//
//   Bearbeiten: Objekt antippen -> es erscheinen ziehbare Griffe.
//     - Eckpunkte verschieben (Flächen), Radius/Mittelpunkt ziehen (Bäume),
//       ganzes Objekt am gefüllten Griff verschieben.
//     - "Löschen" (rot) entfernt das Objekt.
//
// Die Griffe sind native, ziehbare MapLibre-Marker – das funktioniert
// zuverlässig auf Touch (Handy) und Maus.
//
// Alles wird lokal im Browser gespeichert (localStorage, je Grundstück).
// Die spätere automatische Bestandsaufnahme (3b) befüllt dasselbe Modell.
// =========================================================================

import maplibregl from "maplibre-gl";

// -------------------------------------------------------------------------
// Objekt-Typen: Name, Art (Fläche oder Kreis) und Farben.
// -------------------------------------------------------------------------
const TYPEN = {
  haus: { name: "Haus", art: "flaeche", farbe: "#9aa0a6", rand: "#6b7280" },
  terrasse: { name: "Terrasse", art: "flaeche", farbe: "#caa472", rand: "#a07d4e" },
  rasen: { name: "Rasen", art: "flaeche", farbe: "#8cc06a", rand: "#5fa03f" },
  weg: { name: "Weg", art: "flaeche", farbe: "#cdbb98", rand: "#a3916f" },
  beet: { name: "Beet", art: "flaeche", farbe: "#caa6d6", rand: "#9a6fb0" },
  baum: { name: "Baum", art: "kreis", farbe: "#3f9b46", rand: "#2f7a34" },
};

const BAUM_RADIUS = 3; // Standard-Radius eines neuen Baums in Metern

// IDs der Karten-Quellen/-Ebenen.
const SRC_OBJ = "ed-objekte";
const SRC_SEL = "ed-auswahl";
const SRC_PROG = "ed-fortschritt";
const LAYER_FILL = "ed-fill";

// -------------------------------------------------------------------------
// Kleine Geometrie-Helfer
// -------------------------------------------------------------------------

// Abstand zweier Punkte [lng,lat] in Metern (Haversine).
function abstandMeter(a, b) {
  const R = 6371000;
  const rad = Math.PI / 180;
  const dLat = (b[1] - a[1]) * rad;
  const dLng = (b[0] - a[0]) * rad;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a[1] * rad) * Math.cos(b[1] * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

// Kreis (Mittelpunkt + Radius in Metern) als Vieleck-Ring [lng,lat] annähern.
function kreisRing(center, radiusMeter, ecken = 48) {
  const ring = [];
  const latRad = (center[1] * Math.PI) / 180;
  for (let i = 0; i <= ecken; i++) {
    const theta = (2 * Math.PI * i) / ecken;
    const dx = radiusMeter * Math.cos(theta);
    const dy = radiusMeter * Math.sin(theta);
    const dLng = dx / (111320 * Math.cos(latRad));
    const dLat = dy / 111320;
    ring.push([center[0] + dLng, center[1] + dLat]);
  }
  return ring;
}

// Punkt „radius Meter östlich“ des Mittelpunkts (Position des Radius-Griffs).
function radiusPunkt(center, radiusMeter) {
  const latRad = (center[1] * Math.PI) / 180;
  return [center[0] + radiusMeter / (111320 * Math.cos(latRad)), center[1]];
}

// Mittelpunkt (Schwerpunkt) eines geschlossenen Rings.
function ringMitte(ring) {
  let lng = 0,
    lat = 0;
  const n = ring.length - 1; // letzter Punkt = erster
  for (let i = 0; i < n; i++) {
    lng += ring[i][0];
    lat += ring[i][1];
  }
  return [lng / n, lat / n];
}

// -------------------------------------------------------------------------
// Hauptfunktion: richtet den Editor ein. Rückgabe: { starten, leeren }.
// -------------------------------------------------------------------------
export function initEditor(map) {
  // HTML-Elemente
  const toolbar = document.getElementById("ed-toolbar");
  const chipBox = document.getElementById("ed-chips");
  const formBox = document.getElementById("ed-form");
  const btnFormFrei = document.getElementById("ed-form-frei");
  const btnFormRechteck = document.getElementById("ed-form-rechteck");
  const hint = document.getElementById("ed-hint");
  const btnUndo = document.getElementById("ed-undo");
  const btnFinish = document.getElementById("ed-finish");
  const btnConfirm = document.getElementById("ed-confirm");
  const btnDelete = document.getElementById("ed-delete");
  const btnCancel = document.getElementById("ed-cancel");
  const btnClose = document.getElementById("ed-close");
  const suchleiste = document.querySelector(".search");
  const gpPanel = document.getElementById("gp-panel");

  // Zustand
  let aktiv = false; // Editor offen?
  let modus = "neutral"; // "neutral"|"frei"|"rechteck"|"baum"|"bearbeiten"
  let aktiverTyp = null; // gewählter Typ beim Zeichnen
  let formModus = "frei"; // "frei"|"rechteck" (für Flächen)
  let punkte = []; // Ecken der gerade gezeichneten Fläche
  let objekte = []; // alle erfassten Objekte
  let selektiertId = null; // gerade ausgewähltes Objekt
  let griffe = []; // ziehbare Marker des ausgewählten Objekts
  let planKey = "gruenriss:plan:default";
  let chipEls = [];

  // -----------------------------------------------------------------------
  // Werkzeugleiste: Chips je Typ erzeugen.
  // -----------------------------------------------------------------------
  Object.entries(TYPEN).forEach(([schluessel, typ]) => {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "chip";
    chip.dataset.typ = schluessel;
    chip.innerHTML =
      `<span class="chip__farbe" style="background:${typ.farbe}"></span>` +
      typ.name;
    chip.addEventListener("click", () => waehleTyp(schluessel));
    chipBox.append(chip);
    chipEls.push(chip);
  });

  // -----------------------------------------------------------------------
  // Karten-Ebenen einmalig anlegen.
  // -----------------------------------------------------------------------
  function ebenenSicherstellen() {
    if (map.getSource(SRC_OBJ)) return;

    const leer = { type: "FeatureCollection", features: [] };
    map.addSource(SRC_OBJ, { type: "geojson", data: leer });
    map.addSource(SRC_SEL, { type: "geojson", data: leer });
    map.addSource(SRC_PROG, { type: "geojson", data: leer });

    // Farb-Zuordnung je Typ (alle Objekte sind Vielecke).
    const fuellFarbe = ["match", ["get", "typ"]];
    const randFarbe = ["match", ["get", "typ"]];
    Object.entries(TYPEN).forEach(([k, t]) => {
      fuellFarbe.push(k, t.farbe);
      randFarbe.push(k, t.rand);
    });
    fuellFarbe.push("#cccccc");
    randFarbe.push("#999999");

    map.addLayer({
      id: LAYER_FILL,
      type: "fill",
      source: SRC_OBJ,
      paint: { "fill-color": fuellFarbe, "fill-opacity": 0.5 },
    });
    map.addLayer({
      id: "ed-linie",
      type: "line",
      source: SRC_OBJ,
      paint: { "line-color": randFarbe, "line-width": 2 },
    });

    // Hervorhebung des ausgewählten Objekts.
    map.addLayer({
      id: "ed-sel-linie",
      type: "line",
      source: SRC_SEL,
      paint: { "line-color": "#16a34a", "line-width": 4 },
    });

    // Gerade gezeichnete Fläche.
    map.addLayer({
      id: "ed-prog-linie",
      type: "line",
      source: SRC_PROG,
      filter: ["==", ["geometry-type"], "LineString"],
      paint: { "line-color": "#16a34a", "line-width": 2, "line-dasharray": [2, 1] },
    });
    map.addLayer({
      id: "ed-prog-punkte",
      type: "circle",
      source: SRC_PROG,
      filter: ["==", ["geometry-type"], "Point"],
      paint: {
        "circle-radius": 5,
        "circle-color": "#16a34a",
        "circle-stroke-color": "#ffffff",
        "circle-stroke-width": 2,
      },
    });
  }

  // Ein Objekt -> GeoJSON-Feature (immer ein Vieleck).
  function alsFeature(o) {
    const ring = o.art === "kreis" ? kreisRing(o.center, o.radius) : o.coords;
    return {
      type: "Feature",
      properties: { id: o.id, typ: o.typ },
      geometry: { type: "Polygon", coordinates: [ring] },
    };
  }

  function zeichneObjekte() {
    ebenenSicherstellen();
    map.getSource(SRC_OBJ).setData({
      type: "FeatureCollection",
      features: objekte.map(alsFeature),
    });
    // Auswahl-Hervorhebung mitführen.
    const sel = objekte.find((o) => o.id === selektiertId);
    map.getSource(SRC_SEL).setData(
      sel
        ? { type: "FeatureCollection", features: [alsFeature(sel)] }
        : { type: "FeatureCollection", features: [] },
    );
  }

  function zeichneFortschritt() {
    ebenenSicherstellen();
    const features = [];
    if (punkte.length >= 2) {
      features.push({
        type: "Feature",
        geometry: { type: "LineString", coordinates: punkte },
      });
    }
    punkte.forEach((p) =>
      features.push({ type: "Feature", geometry: { type: "Point", coordinates: p } }),
    );
    map.getSource(SRC_PROG).setData({ type: "FeatureCollection", features });
  }

  // -----------------------------------------------------------------------
  // Speichern / Laden
  // -----------------------------------------------------------------------
  function speichere() {
    try {
      localStorage.setItem(planKey, JSON.stringify(objekte));
    } catch (e) {
      console.warn("Konnte Plan nicht speichern:", e);
    }
  }
  function lade() {
    try {
      objekte = JSON.parse(localStorage.getItem(planKey)) || [];
    } catch {
      objekte = [];
    }
    // Ältere Bäume (als Punkt gespeichert) in Kreise umwandeln.
    objekte.forEach((o) => {
      if (o.art === "punkt") {
        o.art = "kreis";
        o.center = o.coords;
        o.radius = BAUM_RADIUS;
        delete o.coords;
      }
    });
  }

  const neueId = () =>
    Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 7);

  // -----------------------------------------------------------------------
  // Bearbeitungs-Griffe (ziehbare Marker) anlegen/entfernen
  // -----------------------------------------------------------------------
  function griffeWeg() {
    griffe.forEach((g) => g.remove());
    griffe = [];
  }

  // Einen ziehbaren Marker erzeugen.
  function griff(lngLat, klasse) {
    const el = document.createElement("div");
    el.className = "ed-griff " + (klasse || "");
    return new maplibregl.Marker({ element: el, draggable: true })
      .setLngLat(lngLat)
      .addTo(map);
  }

  function griffeZeigen(obj) {
    griffeWeg();
    if (!obj) return;

    if (obj.art === "kreis") {
      // Mittelpunkt-Griff (verschiebt den ganzen Baum).
      const mitte = griff(obj.center, "ed-griff--move");
      // Radius-Griff (verändert die Größe).
      const rand = griff(radiusPunkt(obj.center, obj.radius), "ed-griff--radius");

      mitte.on("drag", () => {
        obj.center = mitte.getLngLat().toArray();
        rand.setLngLat(radiusPunkt(obj.center, obj.radius));
        zeichneObjekte();
      });
      mitte.on("dragend", speichere);

      rand.on("drag", () => {
        obj.radius = Math.max(0.5, abstandMeter(obj.center, rand.getLngLat().toArray()));
        zeichneObjekte();
      });
      rand.on("dragend", speichere);

      griffe.push(mitte, rand);
      return;
    }

    // Fläche: ein Griff je Eckpunkt + ein Verschiebe-Griff in der Mitte.
    const ring = obj.coords;
    const n = ring.length - 1; // letzter Punkt = erster

    for (let i = 0; i < n; i++) {
      const g = griff(ring[i]);
      g.on("drag", () => {
        const p = g.getLngLat().toArray();
        ring[i] = p;
        if (i === 0) ring[n] = p; // Ring geschlossen halten
        zeichneObjekte();
      });
      g.on("dragend", speichere);
      griffe.push(g);
    }

    // Verschiebe-Griff: bewegt alle Eckpunkte gemeinsam.
    const move = griff(ringMitte(ring), "ed-griff--move");
    let startRef, startRing;
    move.on("dragstart", () => {
      startRef = move.getLngLat().toArray();
      startRing = ring.map((p) => [...p]); // Kopie der Ausgangslage
    });
    move.on("drag", () => {
      const jetzt = move.getLngLat().toArray();
      const dLng = jetzt[0] - startRef[0];
      const dLat = jetzt[1] - startRef[1];
      for (let i = 0; i < ring.length; i++) {
        ring[i] = [startRing[i][0] + dLng, startRing[i][1] + dLat];
      }
      // Eckpunkt-Griffe mitziehen.
      for (let i = 0; i < n; i++) griffe[i].setLngLat(ring[i]);
      zeichneObjekte();
    });
    move.on("dragend", speichere);
    griffe.push(move);
  }

  // -----------------------------------------------------------------------
  // Auswahl eines Objekts (zum Bearbeiten/Löschen)
  // -----------------------------------------------------------------------
  function selektiere(id) {
    selektiertId = id || null;
    const obj = objekte.find((o) => o.id === selektiertId);
    if (obj) {
      modus = "bearbeiten";
      aktiverTyp = null;
      chipEls.forEach((c) => c.classList.remove("is-active"));
      griffeZeigen(obj);
    } else {
      modus = "neutral";
      griffeWeg();
    }
    zeichneObjekte();
    aktualisiere();
  }

  // -----------------------------------------------------------------------
  // Einen Objekt-Typ wählen (oder durch erneutes Tippen abwählen)
  // -----------------------------------------------------------------------
  function waehleTyp(schluessel) {
    griffeWeg();
    selektiertId = null;
    punkte = [];
    zeichneFortschritt();
    zeichneObjekte();

    aktiverTyp = aktiverTyp === schluessel ? null : schluessel;
    chipEls.forEach((c) =>
      c.classList.toggle("is-active", c.dataset.typ === aktiverTyp),
    );

    if (!aktiverTyp) {
      modus = "neutral";
    } else if (TYPEN[aktiverTyp].art === "kreis") {
      modus = "baum";
    } else {
      modus = formModus; // "frei" oder "rechteck"
    }
    aktualisiere();
  }

  // -----------------------------------------------------------------------
  // Knöpfe und Hinweistext an den Modus anpassen
  // -----------------------------------------------------------------------
  function aktualisiere() {
    const istFlaeche = aktiverTyp && TYPEN[aktiverTyp].art === "flaeche";

    btnUndo.hidden = !(modus === "frei" && punkte.length > 0);
    btnFinish.hidden = !(modus === "frei" && punkte.length >= 3);
    btnCancel.hidden = !(modus === "frei" || modus === "rechteck" || modus === "baum");
    btnConfirm.hidden = modus !== "bearbeiten";
    btnDelete.hidden = modus !== "bearbeiten";
    formBox.hidden = !istFlaeche;

    btnFormFrei.classList.toggle("is-active", formModus === "frei");
    btnFormRechteck.classList.toggle("is-active", formModus === "rechteck");

    if (modus === "neutral") {
      hint.textContent =
        "Wähle oben ein Objekt zum Zeichnen – oder tippe ein vorhandenes an, um es zu bearbeiten.";
    } else if (modus === "frei") {
      hint.textContent =
        punkte.length === 0
          ? `„${TYPEN[aktiverTyp].name}“: Ecken nacheinander antippen.`
          : `${punkte.length} Punkt(e) – weiter tippen oder „Fläche fertig“.`;
    } else if (modus === "rechteck") {
      hint.textContent =
        punkte.length === 0
          ? `„${TYPEN[aktiverTyp].name}“: erste Ecke antippen.`
          : "Gegenüberliegende Ecke antippen.";
    } else if (modus === "baum") {
      hint.textContent = "Tippe auf die Karte, um einen Baum zu setzen.";
    } else if (modus === "bearbeiten") {
      hint.textContent = "Griffe ziehen zum Anpassen. „Fertig“ schließt die Bearbeitung ab.";
    }
  }

  // -----------------------------------------------------------------------
  // Ein neues Objekt anlegen und gleich zum Bearbeiten auswählen.
  // -----------------------------------------------------------------------
  function neuesObjekt(obj) {
    objekte.push(obj);
    speichere();
    punkte = [];
    zeichneFortschritt();
    selektiere(obj.id); // direkt anpassbar
  }

  // -----------------------------------------------------------------------
  // Klick auf die Karte
  // -----------------------------------------------------------------------
  map.on("click", (e) => {
    if (!aktiv) return;
    const p = [e.lngLat.lng, e.lngLat.lat];

    if (modus === "frei") {
      punkte.push(p);
      zeichneFortschritt();
      aktualisiere();
    } else if (modus === "rechteck") {
      punkte.push(p);
      if (punkte.length === 2) {
        const [a, c] = punkte;
        const ring = [
          [a[0], a[1]],
          [c[0], a[1]],
          [c[0], c[1]],
          [a[0], c[1]],
          [a[0], a[1]],
        ];
        neuesObjekt({ id: neueId(), typ: aktiverTyp, art: "flaeche", coords: ring });
      } else {
        zeichneFortschritt();
        aktualisiere();
      }
    } else if (modus === "baum") {
      neuesObjekt({
        id: neueId(),
        typ: aktiverTyp,
        art: "kreis",
        center: p,
        radius: BAUM_RADIUS,
      });
    } else {
      // neutral oder bearbeiten: vorhandenes Objekt antippen/auswählen.
      const treffer = map.queryRenderedFeatures(e.point, { layers: [LAYER_FILL] });
      selektiere(treffer[0] ? treffer[0].properties.id : null);
    }
  });

  // -----------------------------------------------------------------------
  // Knöpfe
  // -----------------------------------------------------------------------
  btnFormFrei.addEventListener("click", () => {
    formModus = "frei";
    if (aktiverTyp && TYPEN[aktiverTyp].art === "flaeche") {
      punkte = [];
      zeichneFortschritt();
      modus = "frei";
    }
    aktualisiere();
  });
  btnFormRechteck.addEventListener("click", () => {
    formModus = "rechteck";
    if (aktiverTyp && TYPEN[aktiverTyp].art === "flaeche") {
      punkte = [];
      zeichneFortschritt();
      modus = "rechteck";
    }
    aktualisiere();
  });

  btnUndo.addEventListener("click", () => {
    punkte.pop();
    zeichneFortschritt();
    aktualisiere();
  });

  btnFinish.addEventListener("click", () => {
    if (punkte.length >= 3) {
      neuesObjekt({
        id: neueId(),
        typ: aktiverTyp,
        art: "flaeche",
        coords: [...punkte, punkte[0]],
      });
    }
  });

  btnConfirm.addEventListener("click", () => selektiere(null)); // Bearbeitung fertig

  btnDelete.addEventListener("click", () => {
    if (!selektiertId) return;
    objekte = objekte.filter((o) => o.id !== selektiertId);
    speichere();
    selektiere(null);
  });

  btnCancel.addEventListener("click", () => {
    // Laufende Zeichnung verwerfen, zurück in den neutralen Modus.
    punkte = [];
    zeichneFortschritt();
    aktiverTyp = null;
    chipEls.forEach((c) => c.classList.remove("is-active"));
    modus = "neutral";
    aktualisiere();
  });

  btnClose.addEventListener("click", () => beenden());

  // -----------------------------------------------------------------------
  // Editor schließen (alles bleibt gespeichert und sichtbar).
  // -----------------------------------------------------------------------
  function beenden() {
    aktiv = false;
    modus = "neutral";
    aktiverTyp = null;
    punkte = [];
    selektiertId = null;
    griffeWeg();
    zeichneFortschritt();
    zeichneObjekte();
    chipEls.forEach((c) => c.classList.remove("is-active"));
    toolbar.hidden = true;
    if (suchleiste) suchleiste.hidden = false;
    if (gpPanel) gpPanel.hidden = false;
  }

  // -----------------------------------------------------------------------
  // Nach außen
  // -----------------------------------------------------------------------
  return {
    starten(parcels) {
      planKey =
        "gruenriss:plan:" +
        ((parcels || []).map((p) => p.id).sort().join("|") || "default");
      lade();
      ebenenSicherstellen();

      aktiv = true;
      modus = "neutral";
      aktiverTyp = null;
      punkte = [];
      selektiertId = null;
      griffeWeg();
      zeichneObjekte();
      zeichneFortschritt();

      if (suchleiste) suchleiste.hidden = true;
      if (gpPanel) gpPanel.hidden = true;
      toolbar.hidden = false;
      aktualisiere();
    },

    leeren() {
      objekte = [];
      punkte = [];
      selektiertId = null;
      griffeWeg();
      if (map.getSource(SRC_OBJ)) {
        const leer = { type: "FeatureCollection", features: [] };
        map.getSource(SRC_OBJ).setData(leer);
        map.getSource(SRC_SEL).setData(leer);
        map.getSource(SRC_PROG).setData(leer);
      }
    },
  };
}
