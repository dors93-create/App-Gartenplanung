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

// „Meine Gärten“: gespeicherte Pläne wiederfinden, sichern und laden.
import {
  alleGaerten,
  ladeGarten,
  speichereGarten,
  loescheGarten,
  neuerGarten,
  alsGespeichertesFlurstueck,
  findeGartenFuer,
  flaecheVon,
  alsDateiText,
  dateiName,
  ausDateiText,
  uebernehmeAltePlaene,
} from "./gaerten.js";

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

// Wird erfüllt, sobald der Kartenstil geladen ist – erst dann lassen sich
// Ebenen anlegen. Das dauert nur einen Augenblick nach dem Seitenaufruf.
const karteBereit = new Promise((weiter) => map.once("styledata", weiter));

// Objekt-Editor (Schritt 3a) einrichten. Wird er geschlossen, kann sich die
// Liste „Meine Gärten“ geändert haben (neuer Garten, neues Änderungsdatum).
const editor = initEditor(map, {
  beimSchliessen: () => aktualisiereGaertenAnzeige(),
});

// Steuerung der Grundstücksauswahl (Schritt 2) einrichten. Beim Klick auf
// „Garten erfassen“ öffnet sich der Editor mit dem passenden Garten;
// „Neu beginnen“ räumt ihn mit auf.
const grundstueck = initGrundstueck(map, {
  beimErfassen: (parcels) => oeffneEditorFuer(parcels),
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
  aktualisiereGaertenAnzeige(); // ohne Trefferliste ist wieder Platz dafür
}

// -------------------------------------------------------------------------
// 5. Geocoding über Nominatim (OpenStreetMap)
// -------------------------------------------------------------------------

// Fragt Nominatim nach einer Adresse und gibt die Treffer in NRW zurück.
// "signal" erlaubt es, eine laufende Anfrage abzubrechen (für die Vorschläge
// während des Tippens, damit nicht veraltete Treffer ankommen).
async function geocode(query, signal) {
  const beginn = performance.now();

  // Zuerst genau so fragen, wie getippt wurde. Zur Sicherheit nur die Treffer
  // behalten, die wirklich in NRW liegen (das Such-Rechteck enthält auch
  // Randgebiete der Nachbarländer).
  const roh = await frageNominatim(query, signal);
  let treffer = roh.filter(liegtInNrw);

  // Bei häufigen Straßennamen ohne Ort („Hauptstraße 1“) kommen die 5
  // Vorschläge leicht alle aus dem Rand der Nachbarländer, und aus NRW bleibt
  // keiner übrig. Dann fragen wir EINMAL nach – mit angehängtem Bundesland.
  // (Bewusst nicht von vornherein: Schreibweisen wie „Köln Hauptstraße 1“
  // oder „…, Deutschland“ versteht der Dienst mit dem Zusatz nicht mehr.)
  const nenntLand = query.toLowerCase().includes(NRW_NAME.toLowerCase());
  if (roh.length > 0 && treffer.length === 0 && !nenntLand) {
    // Den kostenlosen Dienst schonen: höchstens eine Anfrage pro Sekunde.
    await warte(1000 - (performance.now() - beginn), signal);
    const mitLand = query.replace(/[,\s]+$/, "") + ", " + NRW_NAME;
    treffer = (await frageNominatim(mitLand, signal)).filter(liegtInNrw);
  }

  return treffer;
}

// Wartet die angegebene Zeit (Millisekunden). Wird die Suche inzwischen
// verworfen ("signal"), endet das Warten sofort mit einem Abbruch.
function warte(ms, signal) {
  return new Promise((weiter, abbruch) => {
    const abgebrochen = () =>
      abbruch(new DOMException("Suche abgebrochen", "AbortError"));
    if (signal.aborted) return abgebrochen();
    const timer = setTimeout(weiter, Math.max(0, ms));
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        abgebrochen();
      },
      { once: true },
    );
  });
}

// Schickt EINE Anfrage an Nominatim und gibt die Treffer unverändert zurück.
async function frageNominatim(suchtext, signal) {
  // Wir bauen die Anfrage-URL zusammen:
  //  - format=json   -> maschinenlesbare Antwort
  //  - addressdetails -> liefert strukturierte Adressbestandteile
  //  - limit=5        -> höchstens 5 Vorschläge
  //  - countrycodes=de-> nur Deutschland
  //  - viewbox+bounded-> nur Treffer im Rechteck um NRW (siehe NRW_SUCHRAHMEN)
  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("q", suchtext);
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

  return response.json();
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
  resultsList.scrollTop = 0; // neue Treffer immer von oben zeigen
  aktualisiereGaertenAnzeige(); // Trefferliste und Gartenliste nie zugleich
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
  gaertenOffen = false; // jetzt geht es um eine neue Adresse
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
const SUCHE_ZEITLIMIT_MS = 15000; // antwortet der Dienst so lange nicht: aufgeben

let debounceTimer = null; // Timer für die Tipp-Pause
let laufendeSuche = null; // AbortController der aktuellen Anfrage
let sucheLaeuftFuer = ""; // Suchtext der gerade laufenden Anfrage ("" = keine)

// Startet (verzögert) eine Vorschlagssuche zur aktuellen Eingabe.
function planeVorschlaege() {
  const query = input.value.trim();

  clearTimeout(debounceTimer); // alte, noch nicht gestartete Suche verwerfen

  // Wer eine Adresse tippt, braucht die Liste „Meine Gärten“ gerade nicht.
  if (query !== "" && gaertenOffen) {
    gaertenOffen = false;
    aktualisiereGaertenAnzeige();
  }

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

  // Antwortet der Dienst nicht, geben wir nach einer Weile auf und melden es
  // (statt den Spinner endlos drehen zu lassen).
  let zuLangsam = false;
  const zeitlimit = setTimeout(() => {
    zuLangsam = true;
    suche.abort();
  }, SUCHE_ZEITLIMIT_MS);

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
    // Bewusst abgebrochen (neue Eingabe, Treffer gewählt) – ignorieren.
    // Ein Abbruch durch das Zeitlimit dagegen wird wie ein Fehler gemeldet.
    if (error.name === "AbortError" && !zuLangsam) return;
    console.error(error);
    clearResults(); // keine veralteten Treffer neben der Fehlermeldung stehen lassen
    showHint("Die Adresssuche ist gerade nicht erreichbar.", true);
  } finally {
    clearTimeout(zeitlimit);
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

// -------------------------------------------------------------------------
// 8. Meine Gärten: gespeicherte Pläne wiederfinden, sichern und laden
// -------------------------------------------------------------------------
// Jeder Plan gehört zu einem „Garten“ (Name, Flurstücke, Objekte – siehe
// gaerten.js). Unter der Suchleiste steht die Liste aller Gärten: Ein Tipp
// öffnet den Garten wieder genau dort, wo man aufgehört hat.

const gaertenKnopf = document.getElementById("gaerten-knopf");
const gaertenBox = document.getElementById("gaerten");
const gaertenListe = document.getElementById("gaerten-liste");
const gaertenLaden = document.getElementById("gaerten-laden");
const gaertenDatei = document.getElementById("gaerten-datei");

// Soll die Liste „Meine Gärten“ zu sehen sein? Beim Start ja; sobald eine
// Adresse getippt oder ein Garten geöffnet wird, macht sie Platz.
let gaertenOffen = true;
// Wird gerade ein Garten geöffnet? Dann zählen weitere Tipps auf die Liste nicht.
let gartenWirdGeoeffnet = false;

// Flächen hübsch auf Deutsch, z. B. „2.146 m²“.
const alsFlaeche = (m2) => Math.round(m2).toLocaleString("de-DE") + " m²";

// Namen, die nur als Platzhalter vergeben wurden (übernommene alte Pläne
// heißen zunächst „Flurstück 544“). Sie weichen der Adresse, sobald wir sie kennen.
const istPlatzhalter = (name) =>
  name === "Mein Garten" || /^Flurstück \d/.test(name);

// Ein Namensvorschlag für den Garten: die amtliche Lagebezeichnung des
// Grundstücks („Mozartstraße 3“), sonst die gesuchte Adresse.
function vorschlagName(parcels) {
  const mitLage = parcels.find((p) => p.lage);
  if (mitLage) return mitLage.lage;
  return input.value.trim() || "Mein Garten";
}

// Kurzbeschreibung für die Liste: „2.146 m² · 12 Objekte · geändert am 24.11.2026“.
function beschreibeGarten(garten) {
  const teile = [];
  const flaeche = flaecheVon(garten);
  if (flaeche != null) teile.push(alsFlaeche(flaeche));
  const anzahl = garten.objekte.length;
  teile.push(
    anzahl === 0 ? "noch leer" : anzahl === 1 ? "1 Objekt" : anzahl + " Objekte",
  );
  teile.push(
    "geändert am " + new Date(garten.geaendert).toLocaleDateString("de-DE"),
  );
  return teile.join(" · ");
}

// Baut die Liste der Gärten: je Garten ein großer Knopf zum Weiterplanen und
// darunter klein „Weiter planen“, „Als Datei sichern“ und „Löschen“.
function zeigeGaertenListe(gaerten) {
  gaertenListe.innerHTML = "";
  gaerten.forEach((garten) => {
    const zeile = document.createElement("li");
    zeile.className = "garten";

    const oeffnen = document.createElement("button");
    oeffnen.type = "button";
    oeffnen.className = "garten__oeffnen";
    const name = document.createElement("div");
    name.className = "garten__name";
    name.textContent = garten.name;
    const info = document.createElement("div");
    info.className = "garten__info";
    info.textContent = beschreibeGarten(garten);
    oeffnen.append(name, info);
    oeffnen.addEventListener("click", () => oeffneGarten(garten.id));

    const aktionen = document.createElement("div");
    aktionen.className = "garten__aktionen";
    // „Weiter planen“ sagt ausdrücklich, was ein Tipp auf den Garten bewirkt.
    const weiter = document.createElement("button");
    weiter.type = "button";
    weiter.className = "garten__aktion garten__aktion--weiter";
    weiter.textContent = "Weiter planen";
    weiter.addEventListener("click", () => oeffneGarten(garten.id));
    const sichern = document.createElement("button");
    sichern.type = "button";
    sichern.className = "garten__aktion garten__aktion--sichern";
    sichern.textContent = "Als Datei sichern";
    sichern.addEventListener("click", () => sichereAlsDatei(garten));
    const loeschen = document.createElement("button");
    loeschen.type = "button";
    loeschen.className = "garten__aktion garten__aktion--loeschen";
    loeschen.textContent = "Löschen";
    loeschen.addEventListener("click", () => loescheNachRueckfrage(garten));
    aktionen.append(weiter, sichern, loeschen);

    zeile.append(oeffnen, aktionen);
    gaertenListe.append(zeile);
  });
}

// Liste und Knopf passend ein- bzw. ausblenden. Die Liste erscheint nur,
// wenn es Gärten gibt und gerade keine Suchtreffer angezeigt werden.
function aktualisiereGaertenAnzeige() {
  const gaerten = alleGaerten();
  const listeSichtbar =
    gaertenOffen && gaerten.length > 0 && resultsList.hidden;

  gaertenBox.hidden = !listeSichtbar;
  if (listeSichtbar) zeigeGaertenListe(gaerten);

  // Der kleine Knopf holt die Liste zurück. Gibt es noch keinen Garten,
  // führt er direkt zur Dateiauswahl (gesicherten Garten laden).
  gaertenKnopf.hidden = listeSichtbar || !resultsList.hidden;
  gaertenKnopf.textContent =
    gaerten.length > 0 ? "Meine Gärten" : "Garten aus Datei laden";
}

gaertenKnopf.addEventListener("click", () => {
  if (alleGaerten().length === 0) {
    gaertenDatei.click();
    return;
  }
  gaertenOffen = true;
  clearResults(); // blendet dabei auch die Liste ein
});

// Rückt die Karte so, dass das Grundstück über der Werkzeugleiste des Editors
// ganz zu sehen ist. Ohne Flug-Animation: Die würde auf dem Weg viele
// Luftbild-Kacheln laden, die niemand braucht.
function passeKarteEin(parcels) {
  const rahmen = new maplibregl.LngLatBounds();
  parcels.forEach((p) => p.ringLngLat.forEach((punkt) => rahmen.extend(punkt)));

  const hoehe = map.getContainer().clientHeight;
  const leiste = document.getElementById("ed-toolbar");
  const unten = Math.min((leiste ? leiste.offsetHeight : 0) + 40, hoehe * 0.55);
  const kamera = map.cameraForBounds(rahmen, {
    padding: { top: 40, bottom: unten, left: 30, right: 30 },
    maxZoom: 20,
  });
  // Passt das Grundstück bei diesen Rändern gar nicht aufs Bild, wenigstens
  // seine Mitte zeigen.
  map.jumpTo(kamera || { center: rahmen.getCenter(), zoom: ADDRESS_ZOOM });
}

// Einen gespeicherten Garten wieder aufschlagen („Weiter planen“).
async function oeffneGarten(id) {
  if (gartenWirdGeoeffnet) return;
  const garten = ladeGarten(id);
  if (!garten) {
    aktualisiereGaertenAnzeige(); // der Eintrag ist inzwischen weg
    return;
  }

  gartenWirdGeoeffnet = true;
  setLoading(true);
  try {
    await karteBereit;
    // Maske und Bemaßung wie nach „OK, übernehmen“. Fehlt der Umriss noch
    // (übernommener alter Plan), wird er dabei vom Kataster geholt.
    const parcels = await grundstueck.oeffne(garten.flurstuecke);

    // Was das Kataster nachgeliefert hat, gleich mitspeichern.
    const vorher = JSON.stringify(garten.flurstuecke) + garten.name;
    garten.flurstuecke = parcels.map(alsGespeichertesFlurstueck);
    if (istPlatzhalter(garten.name)) garten.name = vorschlagName(parcels);
    if (JSON.stringify(garten.flurstuecke) + garten.name !== vorher) {
      speichereGarten(garten);
    }

    // Oberfläche: Stecknadel einer früheren Suche weg, Name ins Suchfeld.
    clearTimeout(debounceTimer);
    if (laufendeSuche) laufendeSuche.abort();
    if (marker) marker.remove();
    input.value = garten.name;
    gaertenOffen = false;
    clearResults();
    hint.hidden = true;

    editor.starten(parcels, garten);
    passeKarteEin(parcels);
  } catch (fehler) {
    console.error(fehler);
    showHint(
      fehler.name === "FlurstueckFehlt"
        ? "Das Flurstück dieses Gartens ist im Kataster nicht mehr zu finden – der Garten lässt sich so nicht öffnen."
        : "Der Garten lässt sich gerade nicht öffnen (Kataster-Dienst nicht erreichbar).",
      true,
    );
  } finally {
    gartenWirdGeoeffnet = false;
    setLoading(false);
  }
}

// „Garten erfassen“ nach der Grundstückswahl: den Garten zu den gewählten
// Flurstücken öffnen – einen vorhandenen, falls es schon einen gibt.
function oeffneEditorFuer(parcels) {
  let garten = findeGartenFuer(parcels.map((p) => p.id));
  if (garten) {
    // Flurstücke auf den Stand der aktuellen Auswahl bringen (Umriss, Lage –
    // oder ein Flurstück mehr bzw. weniger als beim letzten Mal).
    const vorher = JSON.stringify(garten.flurstuecke) + garten.name;
    garten.flurstuecke = parcels.map(alsGespeichertesFlurstueck);
    if (istPlatzhalter(garten.name)) garten.name = vorschlagName(parcels);
    if (JSON.stringify(garten.flurstuecke) + garten.name !== vorher) {
      speichereGarten(garten);
    }
  } else {
    // Neuer Garten. Gespeichert wird er erst mit dem ersten Objekt – sonst
    // stünde jedes nur angesehene Grundstück in der Liste.
    garten = neuerGarten(parcels, vorschlagName(parcels));
  }
  gaertenOffen = false;
  editor.starten(parcels, garten);
}

// „Als Datei sichern“: Der Browser lädt den Garten als kleine Datei herunter.
// Sie ist die Sicherung für den Fall, dass die Browserdaten verloren gehen,
// und der Weg, einen Garten auf ein anderes Gerät mitzunehmen.
function sichereAlsDatei(garten) {
  const inhalt = new Blob([alsDateiText(garten)], { type: "application/json" });
  const adresse = URL.createObjectURL(inhalt);
  const link = document.createElement("a");
  link.href = adresse;
  link.download = dateiName(garten);
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(adresse), 1000);
}

function loescheNachRueckfrage(garten) {
  const sicher = window.confirm(
    `Garten „${garten.name}“ wirklich löschen? Das lässt sich nicht rückgängig machen.`,
  );
  if (!sicher) return;
  loescheGarten(garten.id);
  aktualisiereGaertenAnzeige();
}

// „Garten aus Datei laden“: gesicherte Datei auswählen, prüfen, übernehmen.
gaertenLaden.addEventListener("click", () => gaertenDatei.click());

gaertenDatei.addEventListener("change", async () => {
  const datei = gaertenDatei.files[0];
  gaertenDatei.value = ""; // dieselbe Datei soll sich erneut wählen lassen
  if (!datei) return;

  let text;
  try {
    text = await new Response(datei).text();
  } catch (fehler) {
    console.error(fehler);
    showHint("Die Datei lässt sich nicht lesen.", true);
    return;
  }

  const { garten, fehler } = ausDateiText(text);
  if (fehler) {
    showHint(fehler, true);
    return;
  }

  const vorhanden = ladeGarten(garten.id);
  if (
    vorhanden &&
    !window.confirm(
      `Den Garten „${vorhanden.name}“ gibt es hier schon. Durch den Stand aus der Datei ersetzen?`,
    )
  ) {
    return;
  }

  if (!speichereGarten(garten)) {
    showHint(
      "Der Garten konnte nicht gespeichert werden – der Speicher des Browsers ist voll oder gesperrt.",
      true,
    );
    return;
  }
  gaertenOffen = true;
  clearResults(); // zeigt die Liste mit dem neuen Garten
  showHint(`„${garten.name}“ wurde geladen. Tippe darauf, um weiterzuplanen.`);
});

// Beim Start: Pläne aus der ersten Version übernehmen und die Liste zeigen.
uebernehmeAltePlaene();
aktualisiereGaertenAnzeige();
