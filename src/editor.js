// =========================================================================
// Grünriss – Objekt-Editor (Schritt 3a)
// -------------------------------------------------------------------------
// Nach der Grundstücksauswahl kann die Nutzer:in hier ihren Garten erfassen:
//   - Flächen zeichnen: Haus, Terrasse, Rasen, Weg, Beet
//     (auf die Ecken tippen, dann „Fläche fertig“).
//   - Bäume als einzelne Punkte setzen.
//   - Objekte antippen und löschen.
// Alles wird lokal im Browser gespeichert (localStorage) und übersteht so das
// Neuladen der Seite.
//
// Die spätere automatische Bestandsaufnahme (Schritt 3b) wird dasselbe
// Objekt-Modell befüllen, sodass erkannte Bereiche hier korrigierbar sind.
// =========================================================================

// -------------------------------------------------------------------------
// Objekt-Typen: Name, Art (Fläche oder Punkt) und Farben.
// Wer einen Typ ergänzen will, fügt hier einfach eine Zeile hinzu.
// -------------------------------------------------------------------------
const TYPEN = {
  haus: { name: "Haus", art: "flaeche", farbe: "#9aa0a6", rand: "#6b7280" },
  terrasse: { name: "Terrasse", art: "flaeche", farbe: "#caa472", rand: "#a07d4e" },
  rasen: { name: "Rasen", art: "flaeche", farbe: "#8cc06a", rand: "#5fa03f" },
  weg: { name: "Weg", art: "flaeche", farbe: "#cdbb98", rand: "#a3916f" },
  beet: { name: "Beet", art: "flaeche", farbe: "#caa6d6", rand: "#9a6fb0" },
  baum: { name: "Baum", art: "punkt", farbe: "#3f9b46", rand: "#2f7a34" },
};

// IDs der Karten-Quellen/-Ebenen des Editors.
const SRC_OBJ = "ed-objekte"; // alle fertigen Objekte
const SRC_SEL = "ed-auswahl"; // das gerade ausgewählte Objekt (Hervorhebung)
const SRC_PROG = "ed-fortschritt"; // die Fläche, die gerade gezeichnet wird
const LAYER_FILL = "ed-fill";
const LAYER_LINIE = "ed-linie";
const LAYER_BAUM = "ed-baum";

// -------------------------------------------------------------------------
// Hauptfunktion: richtet den Editor ein. Rückgabe: { starten, leeren }.
// -------------------------------------------------------------------------
export function initEditor(map) {
  // HTML-Elemente der Werkzeugleiste.
  const toolbar = document.getElementById("ed-toolbar");
  const chipBox = document.getElementById("ed-chips");
  const hint = document.getElementById("ed-hint");
  const btnUndo = document.getElementById("ed-undo"); // letzten Punkt zurück
  const btnFinish = document.getElementById("ed-finish"); // Fläche fertig
  const btnDelete = document.getElementById("ed-delete"); // Objekt löschen
  const btnDone = document.getElementById("ed-done"); // Editor verlassen
  const suchleiste = document.querySelector(".search");
  const gpPanel = document.getElementById("gp-panel");

  // Zustand
  let aktiv = false; // ist der Editor gerade offen?
  let aktiverTyp = null; // gewählter Objekt-Typ (oder null = Auswahl-/Löschmodus)
  let punkte = []; // Ecken der gerade gezeichneten Fläche ([lng,lat], …)
  let objekte = []; // alle erfassten Objekte
  let selektiertId = null; // angetipptes Objekt (zum Löschen)
  let planKey = "gruenriss:plan:default"; // Speicher-Schlüssel (je Grundstück)
  let chipEls = []; // die Typ-Schaltflächen

  // -----------------------------------------------------------------------
  // Werkzeugleiste: für jeden Typ einen „Chip“ erzeugen.
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

    // Farb-Zuordnung je Typ als „match“-Ausdruck aufbauen.
    const fuellFarbe = ["match", ["get", "typ"]];
    const randFarbe = ["match", ["get", "typ"]];
    Object.entries(TYPEN).forEach(([k, t]) => {
      if (t.art === "flaeche") {
        fuellFarbe.push(k, t.farbe);
        randFarbe.push(k, t.rand);
      }
    });
    fuellFarbe.push("#cccccc"); // Standardfarbe
    randFarbe.push("#999999");

    // Flächen: farbige Füllung + Umriss.
    map.addLayer({
      id: LAYER_FILL,
      type: "fill",
      source: SRC_OBJ,
      filter: ["==", ["geometry-type"], "Polygon"],
      paint: { "fill-color": fuellFarbe, "fill-opacity": 0.5 },
    });
    map.addLayer({
      id: LAYER_LINIE,
      type: "line",
      source: SRC_OBJ,
      filter: ["==", ["geometry-type"], "Polygon"],
      paint: { "line-color": randFarbe, "line-width": 2 },
    });
    // Bäume: grüne Kreise.
    map.addLayer({
      id: LAYER_BAUM,
      type: "circle",
      source: SRC_OBJ,
      filter: ["==", ["geometry-type"], "Point"],
      paint: {
        "circle-radius": 8,
        "circle-color": TYPEN.baum.farbe,
        "circle-stroke-color": "#ffffff",
        "circle-stroke-width": 2,
      },
    });

    // Hervorhebung des ausgewählten Objekts.
    map.addLayer({
      id: "ed-sel-linie",
      type: "line",
      source: SRC_SEL,
      filter: ["==", ["geometry-type"], "Polygon"],
      paint: { "line-color": "#16a34a", "line-width": 4 },
    });
    map.addLayer({
      id: "ed-sel-kreis",
      type: "circle",
      source: SRC_SEL,
      filter: ["==", ["geometry-type"], "Point"],
      paint: {
        "circle-radius": 11,
        "circle-opacity": 0,
        "circle-stroke-color": "#16a34a",
        "circle-stroke-width": 3,
      },
    });

    // Gerade gezeichnete Fläche: gestrichelte Linie + Eck-Punkte.
    map.addLayer({
      id: "ed-prog-linie",
      type: "line",
      source: SRC_PROG,
      filter: ["==", ["geometry-type"], "LineString"],
      paint: {
        "line-color": "#16a34a",
        "line-width": 2,
        "line-dasharray": [2, 1],
      },
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

  // Ein Objekt in ein GeoJSON-Feature umwandeln.
  function alsFeature(o) {
    return {
      type: "Feature",
      properties: { id: o.id, typ: o.typ },
      geometry:
        o.art === "flaeche"
          ? { type: "Polygon", coordinates: [o.coords] }
          : { type: "Point", coordinates: o.coords },
    };
  }

  // Alle Objekte auf die Karte zeichnen.
  function zeichneObjekte() {
    ebenenSicherstellen();
    map.getSource(SRC_OBJ).setData({
      type: "FeatureCollection",
      features: objekte.map(alsFeature),
    });
  }

  // Die gerade entstehende Fläche zeichnen.
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
  // Speichern / Laden (localStorage, im Browser der Nutzer:in).
  // -----------------------------------------------------------------------
  function speichere() {
    try {
      localStorage.setItem(planKey, JSON.stringify(objekte));
    } catch (e) {
      // Speicher voll/gesperrt – nicht schlimm, dann eben nur diese Sitzung.
      console.warn("Konnte Plan nicht speichern:", e);
    }
  }
  function lade() {
    try {
      objekte = JSON.parse(localStorage.getItem(planKey)) || [];
    } catch {
      objekte = [];
    }
  }

  // Eindeutige ID für ein neues Objekt.
  const neueId = () =>
    Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 7);

  // -----------------------------------------------------------------------
  // Auswahl eines vorhandenen Objekts (zum Löschen).
  // -----------------------------------------------------------------------
  function selektiere(id) {
    selektiertId = id || null;
    const obj = objekte.find((o) => o.id === selektiertId);
    map.getSource(SRC_SEL).setData(
      obj
        ? { type: "FeatureCollection", features: [alsFeature(obj)] }
        : { type: "FeatureCollection", features: [] },
    );
    aktualisiere();
  }

  // -----------------------------------------------------------------------
  // Einen Objekt-Typ wählen (oder durch erneutes Tippen abwählen).
  // -----------------------------------------------------------------------
  function waehleTyp(schluessel) {
    selektiere(null);
    punkte = [];
    zeichneFortschritt();
    aktiverTyp = aktiverTyp === schluessel ? null : schluessel;
    chipEls.forEach((c) =>
      c.classList.toggle("is-active", c.dataset.typ === aktiverTyp),
    );
    aktualisiere();
  }

  // -----------------------------------------------------------------------
  // Knöpfe und Hinweistext an den aktuellen Modus anpassen.
  // -----------------------------------------------------------------------
  function aktualisiere() {
    const t = aktiverTyp;
    const istFlaeche = t && TYPEN[t].art === "flaeche";

    btnUndo.hidden = !(istFlaeche && punkte.length > 0);
    btnFinish.hidden = !(istFlaeche && punkte.length >= 3);
    btnDelete.hidden = !selektiertId;

    if (!t) {
      hint.textContent = selektiertId
        ? "Objekt ausgewählt – „Löschen“ entfernt es."
        : "Wähle oben ein Objekt zum Zeichnen – oder tippe ein vorhandenes an.";
    } else if (istFlaeche) {
      hint.textContent =
        punkte.length === 0
          ? `Tippe die Ecken für „${TYPEN[t].name}“.`
          : `${punkte.length} Punkt(e) – weiter tippen oder „Fläche fertig“.`;
    } else {
      hint.textContent = `Tippe auf die Karte, um „${TYPEN[t].name}“ zu setzen.`;
    }
  }

  // -----------------------------------------------------------------------
  // Klick auf die Karte (nur wenn der Editor offen ist).
  // -----------------------------------------------------------------------
  map.on("click", (e) => {
    if (!aktiv) return;

    // Kein Typ gewählt -> Auswahl-/Löschmodus: vorhandenes Objekt antippen.
    if (!aktiverTyp) {
      const treffer = map.queryRenderedFeatures(e.point, {
        layers: [LAYER_FILL, LAYER_BAUM],
      });
      selektiere(treffer[0] ? treffer[0].properties.id : null);
      return;
    }

    const lngLat = [e.lngLat.lng, e.lngLat.lat];

    if (TYPEN[aktiverTyp].art === "punkt") {
      // Baum direkt setzen.
      objekte.push({ id: neueId(), typ: aktiverTyp, art: "punkt", coords: lngLat });
      speichere();
      zeichneObjekte();
    } else {
      // Eine weitere Ecke der Fläche.
      punkte.push(lngLat);
      zeichneFortschritt();
      aktualisiere();
    }
  });

  // -----------------------------------------------------------------------
  // Knöpfe
  // -----------------------------------------------------------------------
  btnUndo.addEventListener("click", () => {
    punkte.pop();
    zeichneFortschritt();
    aktualisiere();
  });

  btnFinish.addEventListener("click", () => {
    if (punkte.length >= 3) {
      const ring = [...punkte, punkte[0]]; // Vieleck schließen
      objekte.push({ id: neueId(), typ: aktiverTyp, art: "flaeche", coords: ring });
      speichere();
      zeichneObjekte();
    }
    punkte = [];
    zeichneFortschritt();
    aktualisiere(); // gleicher Typ bleibt aktiv – nächste Fläche kann folgen
  });

  btnDelete.addEventListener("click", () => {
    if (!selektiertId) return;
    objekte = objekte.filter((o) => o.id !== selektiertId);
    speichere();
    zeichneObjekte();
    selektiere(null);
  });

  btnDone.addEventListener("click", () => beenden());

  // -----------------------------------------------------------------------
  // Editor schließen (Objekte bleiben gespeichert und sichtbar).
  // -----------------------------------------------------------------------
  function beenden() {
    aktiv = false;
    aktiverTyp = null;
    punkte = [];
    selektiere(null);
    zeichneFortschritt();
    chipEls.forEach((c) => c.classList.remove("is-active"));
    toolbar.hidden = true;
    if (suchleiste) suchleiste.hidden = false;
    if (gpPanel) gpPanel.hidden = false;
  }

  // -----------------------------------------------------------------------
  // Nach außen
  // -----------------------------------------------------------------------
  return {
    // Editor öffnen. "parcels" dient als Speicher-Schlüssel je Grundstück.
    starten(parcels) {
      planKey =
        "gruenriss:plan:" +
        ((parcels || []).map((p) => p.id).sort().join("|") || "default");
      lade();
      ebenenSicherstellen();
      zeichneObjekte();

      aktiv = true;
      aktiverTyp = null;
      punkte = [];
      selektiere(null);
      zeichneFortschritt();

      if (suchleiste) suchleiste.hidden = true; // aufgeräumte Oberfläche
      if (gpPanel) gpPanel.hidden = true;
      toolbar.hidden = false;
      aktualisiere();
    },

    // Alle Editor-Objekte von der Karte entfernen (bei „Neu beginnen“).
    leeren() {
      objekte = [];
      punkte = [];
      selektiertId = null;
      if (map.getSource(SRC_OBJ)) {
        const leer = { type: "FeatureCollection", features: [] };
        map.getSource(SRC_OBJ).setData(leer);
        map.getSource(SRC_SEL).setData(leer);
        map.getSource(SRC_PROG).setData(leer);
      }
    },
  };
}
