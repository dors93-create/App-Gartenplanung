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
  sucheGaertenFuer,
  freierName,
  flaecheVon,
  alsDateiText,
  dateiName,
  ausDateiText,
  uebernehmeAltePlaene,
  altePlaeneUebrig,
} from "./gaerten.js";

// Rückfrage-Fenster für Entscheidungen mit mehr als zwei Möglichkeiten.
import { frage } from "./rueckfrage.js";

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

// Der Hinweis unter dem leeren Suchfeld.
const START_HINWEIS = "Gib deine Adresse ein, um zu starten.";

// Taugt die gesuchte Adresse als Name für einen neuen Garten? Nur, wenn sie
// bei den gewählten Flurstücken liegt – höchstens so viele Meter daneben.
const ADRESSE_NAH_METER = 100;

// Nach „Als Datei sichern“ halten wir die erzeugte Datei noch so lange bereit
// (Millisekunden). Manche Browser – vor allem auf dem iPhone – beginnen den
// Download erst nach einer Rückfrage; gäben wir die Datei gleich wieder frei,
// käme er nicht zustande.
const SICHERUNG_FREIGABE_MS = 60000;

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
  beimSchliessen: () => {
    // Das Bedienfeld erscheint wieder. Seine Knöpfe zählen einen Moment lang
    // noch nicht: Der zweite Tipp eines Doppeltipps auf „Schließen“ träfe
    // sonst „Neu beginnen“ an derselben Stelle.
    grundstueck.sperreKnoepfeKurz();
    aktualisiereGaertenAnzeige();
  },
});

// Steuerung der Grundstücksauswahl (Schritt 2) einrichten. Beim Klick auf
// „Garten erfassen“ öffnet sich der Editor mit dem passenden Garten;
// „Neu beginnen“ räumt ihn mit auf.
const grundstueck = initGrundstueck(map, {
  beimErfassen: (parcels) => oeffneEditorFuer(parcels).catch(console.error),
  // Beim Antippen der Flurstücke stört die Liste „Meine Gärten“ nur – am
  // Handy verdeckt sie die halbe Karte.
  beimAuswaehlen: () => {
    gaertenOffen = false;
    aktualisiereGaertenAnzeige();
  },
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
  vorgangNr++; // ein Garten, der gerade noch geöffnet wird, gilt nicht mehr
  gewaehlteAdresse = { titel: trefferTexte(place).titel, lngLat };
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
    showHint(START_HINWEIS);
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
// Laufende Nummer dessen, was zuletzt begonnen wurde (Adresse gewählt, Garten
// geöffnet). Muss beim Öffnen eines Gartens erst das Kataster befragt werden
// und wurde inzwischen etwas anderes begonnen, erkennen wir das an der Nummer
// – und lassen das verspätete Öffnen fallen.
let vorgangNr = 0;
// Die zuletzt in der Suche gewählte Adresse: { titel, lngLat } – oder null.
// Sie dient als Namensvorschlag für einen neuen Garten.
let gewaehlteAdresse = null;

// Suchleiste (samt Gartenliste) und Bedienfeld – beide werden gesperrt,
// solange ein Garten geöffnet wird.
const suchleiste = document.querySelector(".search");
const bedienfeld = document.getElementById("gp-panel");

// Flächen hübsch auf Deutsch, z. B. „2.146 m²“.
const alsFlaeche = (m2) => Math.round(m2).toLocaleString("de-DE") + " m²";

// Namen, die nur als Platzhalter vergeben wurden („Mein Garten“; übernommene
// alte Pläne heißen zunächst „Flurstück 544“). Sie weichen der amtlichen
// Lagebezeichnung, sobald wir sie kennen.
const istPlatzhalter = (name) =>
  /^Mein Garten( \(\d+\))?$/.test(name) || /^Flurstück \d/.test(name);

// Die amtliche Lagebezeichnung der Flurstücke („Mozartstraße 3“) – oder "",
// wenn das Kataster für keines eine nennt. (Auf 70 Zeichen gekürzt: Namen
// dürfen höchstens 80 lang sein, und für „ (2)“ soll noch Platz bleiben.)
function lageVon(parcels) {
  const mitLage = parcels.find((p) => p.lage);
  return mitLage ? mitLage.lage.trim().slice(0, 70) : "";
}

// Liegt die zuletzt gesuchte Adresse bei den gewählten Flurstücken? (Wer nach
// der Suche die Karte weit verschiebt und anderswo ein Grundstück wählt, soll
// dafür nicht den Namen der gesuchten Adresse bekommen.)
function adresseLiegtBei(parcels) {
  if (!gewaehlteAdresse) return false;
  // Rechteck um alle gewählten Flurstücke …
  const rahmen = new maplibregl.LngLatBounds();
  parcels.forEach((p) => p.ringLngLat.forEach((punkt) => rahmen.extend(punkt)));
  // … die Adresse darf von seiner Mitte höchstens so weit entfernt sein, wie
  // das Rechteck reicht, plus ADRESSE_NAH_METER.
  const reichweite =
    rahmen.getSouthWest().distanceTo(rahmen.getNorthEast()) / 2;
  const abstand = maplibregl.LngLat.convert(gewaehlteAdresse.lngLat).distanceTo(
    rahmen.getCenter(),
  );
  return abstand <= reichweite + ADRESSE_NAH_METER;
}

// Ein Namensvorschlag für einen neuen Garten: die amtliche Lagebezeichnung
// des Grundstücks („Mozartstraße 3“), sonst die gesuchte Adresse (wenn sie
// dort liegt), sonst der Platzhalter „Mein Garten“. Bewusst nie das, was
// gerade im Suchfeld steht – das kann irgendein angefangener Text sein.
function vorschlagName(parcels) {
  const lage = lageVon(parcels);
  if (lage) return lage;
  if (adresseLiegtBei(parcels)) return gewaehlteAdresse.titel;
  return "Mein Garten";
}

// Umfasst der Garten genau diese Flurstücke (die Reihenfolge ist egal)?
function gleicheFlurstuecke(garten, parcels) {
  const eigene = new Set(garten.flurstuecke.map((f) => f.id));
  const andere = new Set(parcels.map((p) => p.id));
  return (
    eigene.size === andere.size && [...eigene].every((id) => andere.has(id))
  );
}

// Bringt die gespeicherten Flurstücke eines Gartens auf den Stand der
// übergebenen (Umriss, Lage, amtliche Fläche) und ersetzt einen Platzhalter-
// Namen durch die Lagebezeichnung. Gespeichert wird nur, wenn sich dabei
// etwas geändert hat.
function aktualisiereFlurstuecke(garten, parcels) {
  const vorher = JSON.stringify(garten.flurstuecke) + garten.name;
  garten.flurstuecke = parcels.map(alsGespeichertesFlurstueck);
  const lage = lageVon(parcels);
  if (lage && istPlatzhalter(garten.name)) {
    garten.name = freierName(lage, garten.id);
  }
  if (JSON.stringify(garten.flurstuecke) + garten.name !== vorher) {
    speichereGarten(garten);
  }
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

// Bedienung sperren oder wieder freigeben: Suchleiste (samt Gartenliste) und
// Bedienfeld reagieren dann weder auf Tippen noch auf die Tastatur.
function sperreBedienung(gesperrt) {
  suchleiste.toggleAttribute("inert", gesperrt);
  bedienfeld.toggleAttribute("inert", gesperrt);
}

// Einen gespeicherten Garten wieder aufschlagen („Weiter planen“).
//
// Das geht in zwei Abschnitten. Erst werden seine Flurstücke vervollständigt:
// Fehlt ein Umriss, wird das Kataster gefragt – das kann einige Sekunden
// dauern. In dieser Zeit ist die Bedienung gesperrt, und an Karte und Speicher
// ändert sich nichts. Erst danach – und nur, wenn das Öffnen dann noch
// erwünscht ist und es den Garten noch gibt – wird er angezeigt.
async function oeffneGarten(id) {
  if (gartenWirdGeoeffnet) return;
  const gespeichert = ladeGarten(id);
  if (!gespeichert) {
    aktualisiereGaertenAnzeige(); // der Eintrag ist inzwischen weg
    return;
  }

  gartenWirdGeoeffnet = true;
  const nr = ++vorgangNr; // Nummer dieses Vorgangs (siehe vorgangNr)
  // Eine noch geplante oder laufende Vorschlagssuche stoppen – ihre Treffer
  // kämen sonst mitten ins Öffnen.
  clearTimeout(debounceTimer);
  if (laufendeSuche) laufendeSuche.abort();
  sperreBedienung(true);
  setLoading(true);
  showHint("Garten wird geöffnet …");

  try {
    // --- Abschnitt 1: Flurstücke vervollständigen (ändert noch nichts) ---
    let parcels;
    try {
      await karteBereit;
      parcels = await grundstueck.vervollstaendige(gespeichert.flurstuecke);
    } catch (fehler) {
      console.error(fehler);
      showHint(
        fehler.name === "FlurstueckFehlt"
          ? "Das Flurstück dieses Gartens ist im Kataster nicht mehr zu finden – der Garten lässt sich so nicht öffnen."
          : "Der Garten lässt sich gerade nicht öffnen (Kataster-Dienst nicht erreichbar).",
        true,
      );
      return;
    }

    // Wurde inzwischen etwas anderes begonnen? Dann gilt dieses Öffnen nicht mehr.
    if (nr !== vorgangNr) return;

    // Den Garten frisch aus dem Speicher lesen: Wurde er während des Wartens
    // gelöscht oder verändert (etwa in einem zweiten Fenster), darf hier
    // nicht sein alter Stand wieder entstehen.
    const garten = ladeGarten(id);
    if (!garten) {
      showHint("Diesen Garten gibt es nicht mehr.", true);
      aktualisiereGaertenAnzeige();
      return;
    }
    if (!gleicheFlurstuecke(garten, parcels)) {
      showHint(
        "Dieser Garten wurde inzwischen geändert – bitte noch einmal antippen.",
        true,
      );
      aktualisiereGaertenAnzeige();
      return;
    }

    // --- Abschnitt 2: Garten anzeigen ---
    try {
      // Was das Kataster nachgeliefert hat, gleich mitspeichern.
      aktualisiereFlurstuecke(garten, parcels);

      // Oberfläche: Stecknadel einer früheren Suche weg, Name ins Suchfeld.
      if (marker) marker.remove();
      gewaehlteAdresse = null;
      input.value = garten.name;
      gaertenOffen = false;
      clearResults();
      hint.hidden = true;

      // Karte: Maske und Bemaßung wie nach „OK, übernehmen“, dann der Editor.
      grundstueck.uebernimm(parcels);
      editor.starten(parcels, garten);
      passeKarteEin(parcels);
    } catch (fehler) {
      // Das darf eigentlich nicht vorkommen (die Daten wurden beim Lesen
      // geprüft). Falls doch: nichts Halbes stehen lassen – Editor zu, Karte
      // leer, Liste wieder da.
      console.error(fehler);
      editor.leeren();
      editor.schliessen();
      grundstueck.zuruecksetzen();
      gaertenOffen = true;
      aktualisiereGaertenAnzeige();
      showHint(
        "Dieser Garten lässt sich nicht öffnen – seine gespeicherten Daten sind beschädigt.",
        true,
      );
    }
  } finally {
    gartenWirdGeoeffnet = false;
    setLoading(false);
    sperreBedienung(false);
  }
}

// Den Editor für einen Garten öffnen (die Flurstücke liegen schon auf der Karte).
function starteEditor(parcels, garten) {
  gaertenOffen = false;
  editor.starten(parcels, garten);
}

// „1 Flurstück“ bzw. „3 Flurstücke“.
const flurstueckeText = (anzahl) =>
  anzahl === 1 ? "1 Flurstück" : anzahl + " Flurstücke";

// Baut die Rückfrage für den Fall, dass sich die Auswahl mit einem
// gespeicherten Garten nur überschneidet (siehe oeffneEditorFuer).
function frageZuUeberschneidung(garten, parcels) {
  const eigene = new Set(garten.flurstuecke.map((f) => f.id));
  const gewaehlt = new Set(parcels.map((p) => p.id));
  const gemeinsam = [...eigene].filter((id) => gewaehlt.has(id)).length;
  // Ist die Auswahl nur größer geworden (alle bisherigen Flurstücke sind
  // dabei)? Oder nur kleiner (alle gewählten gehören schon zum Garten)?
  const erweitert = gemeinsam === eigene.size;
  const verkleinert = gemeinsam === gewaehlt.size;

  let lage;
  if (erweitert) {
    lage = `Der Garten „${garten.name}“ umfasst bisher ${flurstueckeText(eigene.size)} – jetzt sind ${gewaehlt.size} gewählt.`;
  } else if (verkleinert) {
    lage =
      `Der Garten „${garten.name}“ umfasst ${flurstueckeText(eigene.size)} – jetzt ` +
      (gewaehlt.size === 1 ? "ist nur 1" : `sind nur ${gewaehlt.size}`) +
      " davon gewählt.";
  } else {
    lage = `Der Garten „${garten.name}“ umfasst zum Teil andere Flurstücke als die jetzt gewählten.`;
  }

  return {
    titel: "Hier gibt es schon einen Garten",
    text: lage + "\nDie eingezeichneten Objekte bleiben in jedem Fall erhalten.",
    // Empfohlen (grün) ist das Umstellen nur, wenn dabei kein Flurstück
    // wegfällt – sonst das unveränderte Öffnen.
    knoepfe: [
      {
        wert: "umstellen",
        text: "Garten auf diese Auswahl umstellen",
        haupt: erweitert,
      },
      { wert: "oeffnen", text: "Garten unverändert öffnen", haupt: !erweitert },
      { wert: "neu", text: "Neuen Garten anlegen" },
    ],
  };
}

// „Garten erfassen“ nach der Grundstückswahl: den Garten zu den gewählten
// Flurstücken im Editor öffnen. Der Reihe nach:
//   a) Liegt der Garten noch im Editor (er wurde nur geschlossen)? Dann genau
//      dort weitermachen – auch wenn er sich nicht speichern ließ. (Nur ein
//      leerer Entwurf weicht einem inzwischen gespeicherten, passenden Garten.)
//   b) Gibt es einen gespeicherten Garten mit genau diesen Flurstücken? Öffnen.
//   c) Überschneidet sich die Auswahl nur mit einem Garten (ein Flurstück mehr
//      oder weniger)? Nachfragen – die Flurstücke eines Gartens werden nie
//      stillschweigend geändert.
//   d) Sonst: ein neuer Garten.
async function oeffneEditorFuer(parcels) {
  const { genau, teilweise } = sucheGaertenFuer(parcels.map((p) => p.id));

  // a) Derselbe Garten wie eben.
  const offen = editor.aktuellerGarten();
  if (offen && gleicheFlurstuecke(offen, parcels)) {
    // Ausnahme: Er ist nur ein leerer Entwurf (nichts gezeichnet, nie
    // gespeichert), und inzwischen gibt es einen gespeicherten Garten mit
    // genau diesen Flurstücken – etwa eben aus einer Datei geladen. Dann ist
    // der gemeint (weiter bei b).
    const nurEntwurf = offen.objekte.length === 0 && !ladeGarten(offen.id);
    if (!(nurEntwurf && genau.length > 0)) {
      starteEditor(parcels, offen);
      return;
    }
  }

  // b) Genau passender Garten (gibt es mehrere, der zuletzt geänderte).
  if (genau.length > 0) {
    aktualisiereFlurstuecke(genau[0], parcels); // Umriss, Lage auf neuem Stand
    starteEditor(parcels, genau[0]);
    return;
  }

  // c) Nur eine Überschneidung: nachfragen (zum ähnlichsten Garten).
  if (teilweise.length > 0) {
    const vorhanden = teilweise[0];
    const antwort = await frage(frageZuUeberschneidung(vorhanden, parcels));
    if (antwort === "umstellen") {
      aktualisiereFlurstuecke(vorhanden, parcels); // speichert die neue Auswahl
      starteEditor(parcels, vorhanden);
    } else if (antwort === "oeffnen") {
      await oeffneGarten(vorhanden.id); // mit SEINEN Flurstücken, wie aus der Liste
    } else if (antwort === "neu") {
      starteEditor(parcels, neuerGartenFuer(parcels));
    }
    // („Abbrechen“: nichts tun – das Bedienfeld bietet weiter „Garten erfassen“ an.)
    return;
  }

  // d) Neuer Garten.
  starteEditor(parcels, neuerGartenFuer(parcels));
}

// Ein neuer Garten für die gewählten Flurstücke, mit einem Namen, den noch
// kein anderer trägt. Gespeichert wird er erst mit dem ersten Objekt – sonst
// stünde jedes nur angesehene Grundstück in der Liste.
function neuerGartenFuer(parcels) {
  return neuerGarten(parcels, freierName(vorschlagName(parcels)));
}

// Liegt der Garten mit dieser Kennung gerade auf der Karte (im Editor – auch
// nach „Schließen“ noch)? Dann dort aufräumen wie bei einer neuen Adresse.
// Sonst bliebe sein alter Stand stehen und würde mit der nächsten Änderung
// wieder gespeichert, obwohl der Garten gelöscht oder ersetzt wurde.
// Rückgabe: true, wenn aufgeräumt wurde.
function raeumeKarteAuf(id) {
  const offen = editor.aktuellerGarten();
  if (!offen || offen.id !== id) return false;
  grundstueck.zeigeStart(); // leert auch den Editor
  input.value = "";
  return true;
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
  // Die Datei erst später wieder freigeben (siehe SICHERUNG_FREIGABE_MS).
  setTimeout(() => URL.revokeObjectURL(adresse), SICHERUNG_FREIGABE_MS);
}

function loescheNachRueckfrage(garten) {
  const sicher = window.confirm(
    `Garten „${garten.name}“ wirklich löschen? Das lässt sich nicht rückgängig machen.`,
  );
  if (!sicher) return;
  loescheGarten(garten.id);
  // Lag genau dieser Garten gerade auf der Karte? Dann auch dort entfernen.
  if (raeumeKarteAuf(garten.id)) showHint(START_HINWEIS);
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

  // Jeder Garten trägt einen eigenen Namen – zwei gleich benannte wären in
  // der Liste nicht zu unterscheiden.
  garten.name = freierName(garten.name, garten.id);
  const ausgelassen = garten.verworfen; // Objekte, die nicht lesbar waren

  if (!speichereGarten(garten)) {
    showHint(
      "Der Garten konnte nicht gespeichert werden – der Speicher des Browsers ist voll oder gesperrt.",
      true,
    );
    return;
  }
  // Lag der ersetzte Garten gerade auf der Karte? Dann dort den alten Stand
  // entfernen – er gilt nicht mehr.
  raeumeKarteAuf(garten.id);
  gaertenOffen = true;
  clearResults(); // zeigt die Liste mit dem neuen Garten
  showHint(
    `„${garten.name}“ wurde geladen. Tippe darauf, um weiterzuplanen.` +
      (ausgelassen === 1
        ? " 1 Objekt der Datei war nicht lesbar und wurde ausgelassen."
        : ausgelassen > 1
          ? ` ${ausgelassen} Objekte der Datei waren nicht lesbar und wurden ausgelassen.`
          : ""),
  );
});

// Beim Start: Pläne aus der ersten Version übernehmen und die Liste zeigen.
uebernehmeAltePlaene();
aktualisiereGaertenAnzeige();
// Ließ sich ein alter Plan nicht übernehmen (der Speicher des Browsers ist
// voll oder gesperrt), soll ihn niemand für verloren halten.
if (altePlaeneUebrig()) {
  showHint(
    "Ein früherer Plan konnte noch nicht übernommen werden – der Speicher des Browsers ist voll oder gesperrt. Verloren ist er nicht.",
    true,
  );
}
