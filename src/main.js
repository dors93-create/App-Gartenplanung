// =========================================================================
// Grünriss – Hauptlogik (Schritt 1)
// -------------------------------------------------------------------------
// Was diese Datei macht:
//   1. Sie baut eine bildschirmfüllende Karte mit MapLibre GL JS.
//   2. Als Hintergrund zeigt sie das NRW-Luftbild (DOP) über einen WMS-Dienst.
//   3. Über das Suchfeld kann man eine Adresse eingeben. Diese wird mit der
//      kostenlosen Nominatim-API (OpenStreetMap) in Koordinaten übersetzt
//      (das nennt man "Geocoding"). Danach fliegt die Karte sanft dorthin.
//
// Der Code ist bewusst einfach gehalten und ausführlich kommentiert.
// =========================================================================

// MapLibre samt zugehörigem Standard-CSS importieren.
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

// Schriftart Geist selbst einbinden (kein externer Font-Server nötig).
import "@fontsource-variable/geist";

// Unsere eigene Gestaltung.
import "./style.css";

// Logik für die Grundstücksauswahl (Schritt 2) in eigener Datei.
import { initGrundstueck } from "./grundstueck.js";

// Objekt-Editor (Schritt 3a): Garten selbst erfassen.
import { initEditor } from "./editor.js";

// -------------------------------------------------------------------------
// 1. Konfiguration
// -------------------------------------------------------------------------

// WMS-Dienst des Landes NRW mit den digitalen Orthophotos (Luftbildern).
// "nw_dop_rgb" ist der echtfarbige RGB-Layer (über GetCapabilities des
// Dienstes wms_nw_dop als der RGB-Orthophoto-Layer ausgewiesen).
//
// MapLibre lädt Rasterkacheln. Wir bauen darum eine WMS-GetMap-URL und lassen
// MapLibre den Platzhalter {bbox-epsg-3857} pro Kachel mit dem passenden
// Ausschnitt füllen. CRS EPSG:3857 = Web-Mercator (Standard für Webkarten).
//
// Bildformat JPEG: Für Fotos ist es je nach Bildinhalt etwa 6- bis 15-mal
// kleiner als PNG (gemessen z. B. 14 statt 87 kB je Kachel) – das spart
// Ladezeit und Datenvolumen am Handy.
// JPEG kennt keine Transparenz; wo es kein Luftbild gibt (außerhalb von NRW),
// füllt der Dienst die Kachel mit BGCOLOR – hier der helle Seitenhintergrund.
const DOP_WMS_URL =
  "https://www.wms.nrw.de/geobasis/wms_nw_dop" +
  "?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap" +
  "&LAYERS=nw_dop_rgb&STYLES=" +
  "&CRS=EPSG:3857&BBOX={bbox-epsg-3857}" +
  "&WIDTH=256&HEIGHT=256&FORMAT=image/jpeg&BGCOLOR=0xF5F6F7";

// Startansicht: Überblick über NRW (Längengrad, Breitengrad) und Zoomstufe.
const NRW_CENTER = [7.55, 51.45];
const NRW_ZOOM = 7;

// Zoomstufe, auf die wir bei einer gefundenen Adresse heranfliegen.
// 18 zeigt einzelne Grundstücke/Gärten gut erkennbar.
const ADDRESS_ZOOM = 18;

// Grünriss funktioniert nur in NRW: Luftbild und Kataster enden an der
// Landesgrenze. Die Adresssuche wird deshalb auf NRW begrenzt.
//  - NRW_SUCHRAHMEN: Rechteck um NRW (West, Nord, Ost, Süd in Grad). Nominatim
//    liefert damit nur Treffer aus diesem Ausschnitt.
//  - NRW_KENNUNG / NRW_NAME: Das Rechteck schließt Randgebiete der Nachbar-
//    länder ein; daran erkennen wir die Treffer, die wirklich in NRW liegen.
const NRW_SUCHRAHMEN = "5.86,52.54,9.47,50.32";
const NRW_KENNUNG = "DE-NW";
const NRW_NAME = "Nordrhein-Westfalen";

// Quellenangabe für die Adresssuche (Daten von OpenStreetMap, Lizenz ODbL).
// Sie erscheint direkt unter den Suchtreffern.
const OSM_QUELLE =
  'Adressdaten © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>-Mitwirkende';

// -------------------------------------------------------------------------
// 2. Karte aufbauen
// -------------------------------------------------------------------------

const map = new maplibregl.Map({
  container: "map", // die <div id="map"> aus index.html
  // Wir definieren den Kartenstil direkt hier (kein externer Style nötig).
  style: {
    version: 8,
    sources: {
      // Das NRW-Luftbild als Raster-Quelle.
      "nrw-dop": {
        type: "raster",
        tiles: [DOP_WMS_URL],
        tileSize: 256,
        // Pflicht-Quellenangabe für die NRW-Geobasisdaten.
        attribution:
          '© <a href="https://www.geoportal.nrw" target="_blank" rel="noopener">Geobasis NRW</a> (DOP)',
      },
    },
    layers: [
      // Heller Untergrund, solange das Luftbild noch lädt.
      {
        id: "hintergrund",
        type: "background",
        paint: { "background-color": "#f5f6f7" },
      },
      // Das Luftbild selbst.
      { id: "nrw-dop", type: "raster", source: "nrw-dop" },
    ],
  },
  center: NRW_CENTER,
  zoom: NRW_ZOOM,
  // DOP deckt nur NRW ab – wir lassen aber freie Navigation zu.
  attributionControl: false, // wir fügen das Control unten bewusst kompakt hinzu
});

// Bedienelemente: Zoom-Buttons (unten rechts) und kompakte Quellenangabe.
map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-right");
map.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-right");

// Ein einzelner Marker, den wir bei jeder Suche wiederverwenden.
let marker = null;

// Objekt-Editor (Schritt 3a) einrichten.
const editor = initEditor(map);

// Steuerung der Grundstücksauswahl (Schritt 2) einrichten. Beim Klick auf
// „Garten erfassen“ öffnet sich der Editor; „Neu beginnen“ räumt ihn mit auf.
const grundstueck = initGrundstueck(map, {
  beimErfassen: (parcels) => editor.starten(parcels),
  beimNeustart: () => editor.leeren(),
});

// -------------------------------------------------------------------------
// 3. Verweise auf die HTML-Elemente der Suchleiste
// -------------------------------------------------------------------------

const form = document.getElementById("search-form");
const input = document.getElementById("search-input");
const spinner = document.getElementById("search-spinner");
const resultsList = document.getElementById("search-results");
const hint = document.getElementById("search-hint");

// -------------------------------------------------------------------------
// 4. Kleine Hilfsfunktionen für die Oberfläche
// -------------------------------------------------------------------------

// Spinner ein-/ausblenden (zeigt an, dass gerade gesucht wird).
function setLoading(isLoading) {
  spinner.hidden = !isLoading;
}

// Einen Hinweis bzw. eine Fehlermeldung unter dem Suchfeld anzeigen.
function showHint(text, isError = false) {
  hint.textContent = text;
  hint.classList.toggle("is-error", isError);
  hint.hidden = false;
}

// Suchtext, zu dem die gerade angezeigte Trefferliste gehört ("" = keine Liste).
// Damit übernimmt Enter nie einen Treffer, der noch von einer früheren
// Eingabe stammt.
let trefferFuer = "";

// Trefferliste leeren und verstecken.
function clearResults() {
  resultsList.innerHTML = "";
  resultsList.hidden = true;
  trefferFuer = "";
}

// -------------------------------------------------------------------------
// 5. Geocoding über Nominatim (OpenStreetMap)
// -------------------------------------------------------------------------

// Fragt Nominatim nach einer Adresse und gibt eine Liste von Treffern zurück.
// "signal" erlaubt es, eine laufende Anfrage abzubrechen (für die Vorschläge
// während des Tippens, damit nicht veraltete Treffer ankommen).
async function geocode(query, signal) {
  // Wir bauen die Anfrage-URL zusammen:
  //  - format=json   -> maschinenlesbare Antwort
  //  - addressdetails -> liefert strukturierte Adressbestandteile
  //  - limit=5        -> höchstens 5 Vorschläge
  //  - countrycodes=de-> nur Deutschland
  //  - viewbox+bounded-> nur Treffer im Rechteck um NRW (siehe NRW_SUCHRAHMEN)
  //
  // Zusätzlich hängen wir das Bundesland an den Suchtext. Ohne diesen Zusatz
  // füllt Nominatim die 5 Vorschläge bei häufigen Straßennamen („Hauptstraße
  // 1“) leicht mit Treffern aus dem Rand der Nachbarländer – und aus NRW
  // bliebe keiner übrig.
  const mitLand = query.toLowerCase().includes(NRW_NAME.toLowerCase())
    ? query
    : query + ", " + NRW_NAME;

  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("q", mitLand);
  url.searchParams.set("format", "json");
  url.searchParams.set("addressdetails", "1");
  url.searchParams.set("limit", "5");
  url.searchParams.set("countrycodes", "de");
  url.searchParams.set("viewbox", NRW_SUCHRAHMEN);
  url.searchParams.set("bounded", "1");

  const response = await fetch(url, {
    signal, // erlaubt das Abbrechen der Anfrage
    headers: {
      // Antworten auf Deutsch anfordern (Ortsnamen; auch liegtInNrw vergleicht
      // ersatzweise den deutschen Namen des Bundeslands).
      "Accept-Language": "de",
    },
  });

  if (!response.ok) {
    throw new Error("Nominatim antwortet mit Status " + response.status);
  }

  // Zur Sicherheit nur die Treffer behalten, die wirklich in NRW liegen (das
  // Such-Rechteck enthält auch Randgebiete der Nachbarländer).
  const treffer = await response.json();
  return treffer.filter(liegtInNrw);
}

// Liegt ein Nominatim-Treffer in NRW? (Bundesland steht in den Adressdetails.)
function liegtInNrw(place) {
  const adresse = place.address || {};
  return (
    adresse["ISO3166-2-lvl4"] === NRW_KENNUNG || adresse.state === NRW_NAME
  );
}

// Zerlegt einen Treffer in Titel (fett) und Zusatz (grau darunter).
// Nominatim stellt bei Hausadressen die Hausnummer voran („3, Mozartstraße,
// Rheda, …“). Dann setzen wir Straße und Hausnummer zu einem lesbaren Titel
// zusammen („Mozartstraße 3“) statt nur „3“ zu zeigen.
function trefferTexte(place) {
  const teile = place.display_name.split(",").map((teil) => teil.trim());
  const adresse = place.address || {};

  if (
    adresse.house_number &&
    teile[0] === adresse.house_number &&
    teile.length > 1
  ) {
    const rest = teile.slice(1);
    // Die Straße steht in den Adressdetails. Fehlt sie (Häuser in Weilern
    // sind oft nur nach dem Ortsteil benannt), steht der passende Name gleich
    // hinter der Hausnummer.
    const strasse = adresse.road || rest[0];
    const stelle = rest.indexOf(strasse);
    if (stelle >= 0) rest.splice(stelle, 1); // steht schon im Titel
    return {
      titel: strasse + " " + adresse.house_number,
      zusatz: rest.join(", "),
    };
  }

  // Sonst wie bisher: markantester Teil vorn, der Rest als Kontext.
  return { titel: teile[0], zusatz: teile.slice(1).join(", ") };
}

// -------------------------------------------------------------------------
// 6. Treffer anzeigen und auswählen
// -------------------------------------------------------------------------

// Baut die klickbare Trefferliste aus den Nominatim-Ergebnissen.
// „query“ ist der Suchtext, zu dem die Treffer gehören.
function renderResults(results, query) {
  clearResults();
  trefferFuer = query;

  results.forEach((place) => {
    const item = document.createElement("li");
    item.className = "results__item";

    const texte = trefferTexte(place);

    // Erste Zeile: der markanteste Teil (Straße + Hausnummer bzw. Name).
    const title = document.createElement("div");
    title.className = "results__title";
    title.textContent = texte.titel;

    // Zweite Zeile: der restliche Adresstext als Kontext.
    const subtitle = document.createElement("div");
    subtitle.className = "results__subtitle";
    subtitle.textContent = texte.zusatz;

    item.append(title, subtitle);

    // Bei Klick: zu diesem Ort fliegen.
    item.addEventListener("click", () => selectPlace(place));

    resultsList.append(item);
  });

  // Quellenangabe unter den Treffern (kein Treffer zum Anklicken).
  if (results.length > 0) {
    const quelle = document.createElement("li");
    quelle.className = "results__quelle";
    quelle.innerHTML = OSM_QUELLE; // feste Zeichenkette von oben, kein fremder Text
    resultsList.append(quelle);
  }

  resultsList.hidden = results.length === 0;
}

// Fliegt sanft zum gewählten Ort und setzt dort einen Marker.
function selectPlace(place) {
  // Nominatim liefert lat/lon als Text – in Zahlen umwandeln.
  const lngLat = [parseFloat(place.lon), parseFloat(place.lat)];

  // Vorhandenen Marker wiederverwenden oder neu anlegen.
  if (!marker) {
    const el = document.createElement("div");
    el.className = "marker";
    marker = new maplibregl.Marker({ element: el, anchor: "bottom" });
  }
  marker.setLngLat(lngLat).addTo(map);

  // Sanfter, geschwungener Flug zum Ziel.
  map.flyTo({
    center: lngLat,
    zoom: ADDRESS_ZOOM,
    speed: 1.2, // Fluggeschwindigkeit
    curve: 1.4, // wie stark die Kamera "ausholt"
    essential: true, // auch bei reduzierter Bewegung ausführen
  });

  // Oberfläche aufräumen: noch geplante/laufende Vorschlagssuche stoppen,
  // Eingabe übernehmen, Liste schließen.
  clearTimeout(debounceTimer);
  if (laufendeSuche) laufendeSuche.abort();
  input.value = trefferTexte(place).titel;
  clearResults();
  showHint("Gefunden. Wähle als Nächstes dein Grundstück aus.");

  // Schritt 2 anbieten: das untere Bedienfeld erscheint.
  grundstueck.zeigeStart();
}

// -------------------------------------------------------------------------
// 7. Adressvervollständigung (Vorschläge während des Tippens)
// -------------------------------------------------------------------------

// Damit wir den kostenlosen Nominatim-Dienst schonen, fragen wir nicht bei
// jedem Tastendruck an, sondern erst nach einer kurzen Tipp-Pause.
const DEBOUNCE_MS = 400; // Wartezeit nach dem letzten Tastendruck
const MIN_ZEICHEN = 3; // erst ab dieser Eingabelänge suchen

let debounceTimer = null; // Timer für die Tipp-Pause
let laufendeSuche = null; // AbortController der aktuellen Anfrage
let sucheLaeuftFuer = ""; // Suchtext der gerade laufenden Anfrage ("" = keine)

// Startet (verzögert) eine Vorschlagssuche zur aktuellen Eingabe.
function planeVorschlaege() {
  const query = input.value.trim();

  clearTimeout(debounceTimer); // alte, noch nicht gestartete Suche verwerfen

  // Zu wenige Zeichen: Liste leeren und Start-Hinweis zeigen.
  if (query.length < MIN_ZEICHEN) {
    if (laufendeSuche) laufendeSuche.abort();
    clearResults();
    showHint("Gib deine Adresse ein, um zu starten.");
    return;
  }

  debounceTimer = setTimeout(() => sucheVorschlaege(query), DEBOUNCE_MS);
}

// Holt die Vorschläge und zeigt sie als Trefferliste an.
async function sucheVorschlaege(query) {
  // Eine eventuell noch laufende Anfrage abbrechen.
  if (laufendeSuche) laufendeSuche.abort();
  const suche = new AbortController();
  laufendeSuche = suche;
  sucheLaeuftFuer = query;

  setLoading(true);
  try {
    const results = await geocode(query, suche.signal);
    if (results.length === 0) {
      clearResults();
      showHint(
        "Keine Adresse in NRW gefunden. Bitte Eingabe prüfen – Grünriss gibt es bisher nur für Nordrhein-Westfalen.",
        true,
      );
    } else {
      renderResults(results, query);
      hint.hidden = true;
    }
  } catch (error) {
    if (error.name === "AbortError") return; // bewusst abgebrochen – ignorieren
    console.error(error);
    clearResults(); // keine veralteten Treffer neben der Fehlermeldung stehen lassen
    showHint("Die Adresssuche ist gerade nicht erreichbar.", true);
  } finally {
    // Spinner nur ausblenden, wenn nicht schon eine neuere Suche läuft.
    if (laufendeSuche === suche) {
      setLoading(false);
      sucheLaeuftFuer = "";
    }
  }
}

// Bei jeder Eingabe eine (verzögerte) Vorschlagssuche planen.
input.addEventListener("input", planeVorschlaege);

// Enter (Formular absenden): den ersten Vorschlag übernehmen, sonst direkt suchen.
form.addEventListener("submit", (event) => {
  event.preventDefault(); // kein Neuladen der Seite
  clearTimeout(debounceTimer);
  const query = input.value.trim();

  // Gibt es bereits Vorschläge zu genau dieser Eingabe? Dann den obersten wählen.
  const ersterTreffer = resultsList.querySelector(".results__item");
  if (!resultsList.hidden && ersterTreffer && trefferFuer === query) {
    ersterTreffer.click();
    return;
  }

  // Sonst (sehr schnelles Tippen + Enter, oder die Liste gehört noch zu einer
  // früheren Eingabe): alte Treffer weg und sofort nach der Eingabe suchen.
  clearResults();
  if (sucheLaeuftFuer === query) return; // genau diese Suche läuft schon
  if (query.length >= MIN_ZEICHEN) sucheVorschlaege(query);
});
