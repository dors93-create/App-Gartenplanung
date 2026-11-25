// =========================================================================
// Grünriss – Meine Gärten (Speichern und Wiederfinden)
// -------------------------------------------------------------------------
// Ein „Garten“ ist alles, was zu einem Plan gehört: sein Name, die gewählten
// Flurstücke (mit Umriss) und die eingezeichneten Objekte. Jeder Garten liegt
// als eigener Eintrag im Speicher des Browsers (localStorage):
//
//   gruenriss:garten:<id>   der Garten selbst (Aufbau siehe unten)
//
// Aufbau eines Gartens (FORMAT_VERSION 2):
//   {
//     format: "gruenriss-garten", version: 2,
//     id, name, geaendert (Zeitstempel in Millisekunden),
//     flurstuecke: [{ id, info, lage, amtlicheFlaeche, ring25832 }],
//     objekte: [ … so, wie der Editor sie anlegt … ]
//   }
//
// Dieselbe Form hat auch die Datei, die „Als Datei sichern“ erzeugt.
//
// Ältere Pläne (Version 1) lagen als nackte Objektliste unter
// „gruenriss:plan:<Flurstückskennzeichen>“ – ohne Namen und ohne Umriss. Sie
// werden beim Start einmalig übernommen (uebernehmeAltePlaene); das Original
// wandert dabei ins Archiv („gruenriss:archiv:…“) und wird nicht gelöscht.
//
// Diese Datei kennt weder Karte noch Oberfläche – nur Daten. Alles, was aus
// dem Speicher oder aus einer Datei kommt, wird geprüft, bevor es benutzt
// wird: Ein beschädigter Eintrag darf die App nicht blockieren.
// =========================================================================

export const FORMAT_NAME = "gruenriss-garten";
export const FORMAT_VERSION = 2;

const PRAEFIX = "gruenriss:garten:";
const PRAEFIX_ALT = "gruenriss:plan:"; // Pläne der ersten Version
const PRAEFIX_ARCHIV = "gruenriss:archiv:";

// Radius, mit dem sehr alte Bäume (damals nur ein Punkt) übernommen werden.
const BAUM_RADIUS_ALT = 3;

// Obergrenzen für Werte aus dem Speicher oder aus einer Datei. Was darüber
// liegt, ist ein Fehler in den Daten und wird nicht übernommen.
const RADIUS_MAX = 500; // Meter – größer ist kein Baum und kein Garten
const KENNZEICHEN_MAX = 100; // Zeichen – ein Flurstückskennzeichen hat 20
const NAME_MAX = 80; // Zeichen – so lang darf der Name eines Gartens sein

// -------------------------------------------------------------------------
// Zugriff auf den Speicher des Browsers. Er kann fehlen oder voll sein
// (z. B. im privaten Modus) – darum fängt jede Funktion Fehler ab.
// -------------------------------------------------------------------------
function lies(schluessel) {
  try {
    return localStorage.getItem(schluessel);
  } catch {
    return null;
  }
}

// Rückgabe: true, wenn das Schreiben geklappt hat.
function schreibe(schluessel, wert) {
  try {
    localStorage.setItem(schluessel, wert);
    return true;
  } catch (fehler) {
    console.warn("Speichern fehlgeschlagen:", fehler);
    return false;
  }
}

function entferne(schluessel) {
  try {
    localStorage.removeItem(schluessel);
  } catch {
    // nichts zu tun
  }
}

function alleSchluessel() {
  try {
    return Object.keys(localStorage);
  } catch {
    return [];
  }
}

// Neue, eindeutige Kennung (für Gärten „g-…“, für Objekte ohne Vorsatz).
const zufall = () =>
  Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 7);

// -------------------------------------------------------------------------
// Prüfen und Bereinigen
// -------------------------------------------------------------------------
const istZahl = (x) => typeof x === "number" && Number.isFinite(x);

// Ein Punkt auf der Karte: [Länge, Breite] in Grad. Werte außerhalb des
// Gradnetzes würden die Karte beim Zeichnen zum Abbruch bringen.
const istPunkt = (p) =>
  Array.isArray(p) &&
  p.length >= 2 &&
  istZahl(p[0]) &&
  istZahl(p[1]) &&
  Math.abs(p[0]) <= 180 &&
  Math.abs(p[1]) <= 90;

// Ein Ring ist eine geschlossene Punktfolge: mindestens 3 Ecken + Schlusspunkt.
// Rückgabe: der Ring als saubere Liste von [Länge, Breite] (ein fehlender
// Schlusspunkt wird ergänzt) – oder null, wenn er nicht zu gebrauchen ist.
function bereinigeRing(r) {
  if (!Array.isArray(r) || r.length < 3 || !r.every(istPunkt)) return null;
  const ring = r.map((p) => [p[0], p[1]]);
  const erster = ring[0];
  const letzter = ring[ring.length - 1];
  if (erster[0] !== letzter[0] || erster[1] !== letzter[1]) {
    ring.push([erster[0], erster[1]]);
  }
  // Eine Fläche braucht mindestens drei VERSCHIEDENE Ecken. (Lauter gleiche
  // Punkte ergäben ein Objekt ohne Fläche, das sich im Editor nicht einmal
  // antippen – also auch nicht löschen – ließe.)
  const verschiedene = new Set(ring.map((p) => p[0] + "," + p[1]));
  return ring.length >= 4 && verschiedene.size >= 3 ? ring : null;
}

// Umriss eines Flurstücks in Metern (EPSG:25832). Zur Sicherheit nur Werte
// annehmen, die in und um NRW vorkommen können – alles andere ist ein Fehler
// in der Datei, und der Umriss wird dann beim Öffnen neu vom Kataster geholt.
// Dasselbe gilt für einen offenen Umriss (Schlusspunkt fehlt): Fläche und
// Seitenlängen würden aus ihm falsch gerechnet.
const istPunkt25832 = (p) =>
  Array.isArray(p) &&
  p.length >= 2 &&
  istZahl(p[0]) &&
  istZahl(p[1]) &&
  p[0] > 200000 &&
  p[0] < 700000 &&
  p[1] > 5400000 &&
  p[1] < 5900000;
const istRing25832 = (r) =>
  Array.isArray(r) &&
  r.length >= 4 &&
  r.every(istPunkt25832) &&
  r[0][0] === r[r.length - 1][0] &&
  r[0][1] === r[r.length - 1][1];

// Ein einzelnes Objekt prüfen. Rückgabe: das (ggf. umgewandelte) Objekt
// oder null, wenn es nicht zu gebrauchen ist.
function bereinigeObjekt(o) {
  if (!o || typeof o !== "object" || typeof o.typ !== "string") return null;
  const id = typeof o.id === "string" && o.id ? o.id : zufall();

  // Sehr alte Bäume (als Punkt gespeichert) in Kreise umwandeln.
  if (o.art === "punkt" && istPunkt(o.coords)) {
    return {
      id,
      typ: o.typ,
      art: "kreis",
      center: [o.coords[0], o.coords[1]],
      radius: BAUM_RADIUS_ALT,
    };
  }
  if (o.art === "kreis") {
    const gut =
      istPunkt(o.center) &&
      istZahl(o.radius) &&
      o.radius > 0 &&
      o.radius <= RADIUS_MAX;
    return gut ? { ...o, id, center: [o.center[0], o.center[1]] } : null;
  }
  if (o.art === "flaeche") {
    if (o.multi) {
      // Zusammengesetzte Fläche: Liste von Vielecken, jedes eine Liste von Ringen.
      if (!Array.isArray(o.multi) || o.multi.length === 0) return null;
      const multi = [];
      for (const vieleck of o.multi) {
        if (!Array.isArray(vieleck) || vieleck.length === 0) return null;
        const ringe = vieleck.map(bereinigeRing);
        if (ringe.includes(null)) return null;
        multi.push(ringe);
      }
      return { ...o, id, multi };
    }
    const coords = bereinigeRing(o.coords);
    return coords ? { ...o, id, coords } : null;
  }
  return null; // unbekannte Art
}

// Eine Objektliste prüfen. Rückgabe: { objekte, verworfen } – „verworfen“
// zählt, was nicht lesbar war (damit die Oberfläche es melden kann).
export function pruefeObjekte(liste) {
  if (!Array.isArray(liste)) {
    return { objekte: [], verworfen: liste == null ? 0 : 1 };
  }
  const objekte = [];
  const kennungen = new Set();
  let verworfen = 0;
  liste.forEach((o) => {
    const gut = bereinigeObjekt(o);
    if (!gut) {
      verworfen++;
      return;
    }
    // Jede Kennung darf nur einmal vorkommen („Löschen“ träfe sonst mehrere).
    if (kennungen.has(gut.id)) gut.id = zufall();
    kennungen.add(gut.id);
    objekte.push(gut);
  });
  return { objekte, verworfen };
}

// Ein gespeichertes Flurstück prüfen. Der Umriss (ring25832) darf fehlen –
// bei übernommenen alten Plänen wird er beim Öffnen vom Kataster nachgeladen.
function bereinigeFlurstueck(f) {
  if (!f || typeof f !== "object" || typeof f.id !== "string" || !f.id) {
    return null;
  }
  if (f.id.length > KENNZEICHEN_MAX) return null;
  return {
    id: f.id,
    info: typeof f.info === "string" ? f.info : "",
    lage: typeof f.lage === "string" ? f.lage : "",
    amtlicheFlaeche: istZahl(f.amtlicheFlaeche) ? f.amtlicheFlaeche : null,
    ring25832: istRing25832(f.ring25832)
      ? f.ring25832.map((p) => [p[0], p[1]])
      : null,
  };
}

// Macht aus gelesenen Daten einen gültigen Garten – oder null, wenn sie
// keiner sind. Das Zusatzfeld „verworfen“ nennt die Zahl unlesbarer Objekte;
// es wird nicht mitgespeichert.
export function bereinigeGarten(daten) {
  if (!daten || typeof daten !== "object" || Array.isArray(daten)) return null;
  if (daten.format !== FORMAT_NAME) return null;
  if (!istZahl(daten.version) || daten.version > FORMAT_VERSION) return null;

  // Jedes Flurstück zählt nur einmal – doppelt genannt, stimmte die Fläche nicht.
  const gesehen = new Set();
  const flurstuecke = (Array.isArray(daten.flurstuecke) ? daten.flurstuecke : [])
    .map(bereinigeFlurstueck)
    .filter(Boolean)
    .filter((f) => {
      if (gesehen.has(f.id)) return false;
      gesehen.add(f.id);
      return true;
    });
  if (flurstuecke.length === 0) return null; // ohne Grundstück kein Garten

  const { objekte, verworfen } = pruefeObjekte(daten.objekte);
  const name =
    typeof daten.name === "string" && daten.name.trim()
      ? daten.name.trim().slice(0, NAME_MAX)
      : "Mein Garten";

  return {
    format: FORMAT_NAME,
    version: FORMAT_VERSION,
    id: typeof daten.id === "string" && daten.id ? daten.id : "g-" + zufall(),
    name,
    geaendert: istZahl(daten.geaendert) ? daten.geaendert : Date.now(),
    flurstuecke,
    objekte,
    verworfen,
  };
}

// Die Form, in der ein Garten gespeichert und als Datei ausgegeben wird
// (ohne das Zusatzfeld „verworfen“).
function zumSpeichern(garten) {
  const { verworfen, ...rest } = garten;
  return rest;
}

// -------------------------------------------------------------------------
// Gärten lesen, speichern, löschen
// -------------------------------------------------------------------------

// Alle gespeicherten Gärten, der zuletzt geänderte zuerst. Unlesbare Einträge
// werden übersprungen (sie bleiben im Speicher liegen, stören aber nicht).
export function alleGaerten() {
  return alleSchluessel()
    .filter((schluessel) => schluessel.startsWith(PRAEFIX))
    .map((schluessel) => ladeGarten(schluessel.slice(PRAEFIX.length)))
    .filter(Boolean)
    .sort((a, b) => b.geaendert - a.geaendert);
}

export function ladeGarten(id) {
  const roh = lies(PRAEFIX + id);
  if (!roh) return null;
  try {
    const garten = bereinigeGarten(JSON.parse(roh));
    // Die Kennung im Eintrag muss zum Schlüssel passen, unter dem er liegt.
    if (garten) garten.id = id;
    return garten;
  } catch {
    return null;
  }
}

// Speichert den Garten und setzt sein Änderungsdatum. Rückgabe: true, wenn
// das Speichern geklappt hat.
export function speichereGarten(garten) {
  garten.geaendert = Date.now();
  return schreibe(PRAEFIX + garten.id, JSON.stringify(zumSpeichern(garten)));
}

export function loescheGarten(id) {
  entferne(PRAEFIX + id);
}

// Legt einen neuen, leeren Garten für die gewählten Flurstücke an (noch nicht
// gespeichert – das übernimmt speichereGarten).
export function neuerGarten(flurstuecke, name) {
  return {
    format: FORMAT_NAME,
    version: FORMAT_VERSION,
    id: "g-" + zufall(),
    name: (name || "").trim().slice(0, NAME_MAX) || "Mein Garten",
    geaendert: Date.now(),
    flurstuecke: flurstuecke.map(alsGespeichertesFlurstueck),
    objekte: [],
    verworfen: 0,
  };
}

// Ein Flurstück so verkleinern, wie es im Garten gespeichert wird (ohne die
// Lat/Lon-Koordinaten – die lassen sich aus ring25832 jederzeit neu rechnen).
export function alsGespeichertesFlurstueck(f) {
  return bereinigeFlurstueck({
    id: f.id,
    info: f.info,
    lage: f.lage,
    amtlicheFlaeche: f.amtlicheFlaeche,
    ring25832: f.ring25832,
  });
}

// Vergleicht die gewählten Flurstücke mit allen gespeicherten Gärten.
// Rückgabe:
//   genau      Gärten mit GENAU dieser Flurstücks-Auswahl (neuester zuerst).
//              Nur ein solcher Garten darf ohne Rückfrage geöffnet werden.
//   teilweise  Gärten, die sich mit der Auswahl nur überschneiden – der
//              ähnlichste zuerst (meiste gemeinsame, dann wenigste fremde
//              Flurstücke, dann der neueste). Hier muss die Oberfläche
//              nachfragen; die Flurstücke eines Gartens werden nie still
//              umgeschrieben.
export function sucheGaertenFuer(flurstueckIds) {
  const gesucht = new Set(flurstueckIds);
  const genau = [];
  const kandidaten = [];
  alleGaerten().forEach((garten) => {
    const eigene = new Set(garten.flurstuecke.map((f) => f.id));
    const gemeinsam = [...eigene].filter((id) => gesucht.has(id)).length;
    if (gemeinsam === 0) return;
    if (gemeinsam === eigene.size && gemeinsam === gesucht.size) {
      genau.push(garten);
    } else {
      const fremd = eigene.size + gesucht.size - 2 * gemeinsam;
      kandidaten.push({ garten, gemeinsam, fremd });
    }
  });
  kandidaten.sort(
    (a, b) =>
      b.gemeinsam - a.gemeinsam ||
      a.fremd - b.fremd ||
      b.garten.geaendert - a.garten.geaendert,
  );
  return { genau, teilweise: kandidaten.map((k) => k.garten) };
}

// Ein Name, den noch kein anderer Garten trägt: Ist der Wunschname vergeben,
// wird „ (2)“, „ (3)“ … angehängt. „ausserId“ nennt den Garten, der den Namen
// selbst tragen darf (beim Umbenennen).
//
// Ein Name ist höchstens NAME_MAX Zeichen lang; was darüber hinausgeht, fiele
// beim Speichern weg – auch ein angehängtes „ (2)“. Darum wird der Wunsch
// zuerst so gekürzt wie beim Speichern und für die Nummer bei Bedarf noch
// etwas mehr.
export function freierName(wunsch, ausserId) {
  const vergeben = new Set(
    alleGaerten()
      .filter((garten) => garten.id !== ausserId)
      .map((garten) => garten.name),
  );
  const name = wunsch.trim().slice(0, NAME_MAX);
  if (!vergeben.has(name)) return name;
  const mitNummer = (nummer) => {
    const zusatz = ` (${nummer})`;
    return name.slice(0, NAME_MAX - zusatz.length).trimEnd() + zusatz;
  };
  let nummer = 2;
  while (vergeben.has(mitNummer(nummer))) nummer++;
  return mitNummer(nummer);
}

// -------------------------------------------------------------------------
// Kennzahlen für die Liste „Meine Gärten“
// -------------------------------------------------------------------------

// Fläche eines Rings in m² (Gauß'sche Trapezformel, Koordinaten in Metern).
function ringFlaeche25832(ring) {
  let doppelt = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    doppelt += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
  }
  return Math.abs(doppelt) / 2;
}

// Grundstücksfläche eines Gartens in m² – oder null, wenn (noch) kein Umriss
// gespeichert ist. Gerechnet wie auf der Karte: aus den Koordinaten.
export function flaecheVon(garten) {
  let summe = 0;
  for (const f of garten.flurstuecke) {
    if (!f.ring25832) return null;
    summe += ringFlaeche25832(f.ring25832);
  }
  return summe;
}

// -------------------------------------------------------------------------
// Als Datei sichern / aus Datei laden
// -------------------------------------------------------------------------

// Der Text der Sicherungsdatei.
export function alsDateiText(garten) {
  return JSON.stringify(zumSpeichern(garten), null, 2);
}

// Ein Dateiname, der auf jedem Gerät funktioniert („gruenriss-mozartstrasse-3.json“).
export function dateiName(garten) {
  const kern = garten.name
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return "gruenriss-" + (kern || "garten") + ".json";
}

// Liest eine Sicherungsdatei. Rückgabe: { garten } oder { fehler } mit einer
// Meldung, die man so anzeigen kann.
export function ausDateiText(text) {
  let daten;
  try {
    daten = JSON.parse(text);
  } catch {
    return { fehler: "Die Datei lässt sich nicht lesen (kein gültiges Format)." };
  }
  if (!daten || typeof daten !== "object" || daten.format !== FORMAT_NAME) {
    return { fehler: "Das ist keine Garten-Datei von Grünriss." };
  }
  if (istZahl(daten.version) && daten.version > FORMAT_VERSION) {
    return {
      fehler:
        "Die Datei stammt aus einer neueren Version von Grünriss und kann hier nicht gelesen werden.",
    };
  }
  // Ohne Kennung ließe sich nicht erkennen, ob es den Garten hier schon gibt –
  // jedes Laden legte einen weiteren an.
  const garten =
    typeof daten.id === "string" && daten.id ? bereinigeGarten(daten) : null;
  if (!garten) {
    return { fehler: "Die Datei enthält keinen lesbaren Garten." };
  }
  return { garten };
}

// -------------------------------------------------------------------------
// Alte Pläne (Version 1) übernehmen
// -------------------------------------------------------------------------

// Flurstücksnummer aus dem 20-stelligen Kennzeichen lesen
// (Stellen 10–14 = Zähler, 15–18 = Nenner; „_“ = nicht belegt).
function flurstuecksNummer(kennzeichen) {
  const zaehler = parseInt(kennzeichen.slice(9, 14), 10);
  const nenner = parseInt(kennzeichen.slice(14, 18), 10);
  if (!Number.isFinite(zaehler)) return kennzeichen;
  return Number.isFinite(nenner) ? zaehler + "/" + nenner : String(zaehler);
}

// Übernimmt Pläne aus der ersten Version als Gärten. Rückgabe: Anzahl der
// übernommenen Pläne. Leere Pläne werden nicht übernommen.
//
// Die Reihenfolge macht die Übernahme wiederholungssicher: zuerst die Kopie
// ins Archiv, dann der Garten, zuletzt das Entfernen des Originals. Scheitert
// ein Schritt (Speicher voll), bleibt das Original liegen, und der nächste
// Start versucht es erneut – ohne dass ein Garten doppelt entsteht, denn
// seine Kennung wird aus dem alten Schlüssel gebildet.
export function uebernehmeAltePlaene() {
  let anzahl = 0;
  alleSchluessel()
    .filter((schluessel) => schluessel.startsWith(PRAEFIX_ALT))
    .forEach((alt) => {
      const rohwert = lies(alt);
      if (rohwert == null) return;

      // 1. Sicherungskopie ins Archiv (ohne sie fassen wir das Original nicht an).
      if (!schreibe(PRAEFIX_ARCHIV + alt, rohwert)) return;

      const rest = alt.slice(PRAEFIX_ALT.length);
      const kennzeichen = rest.split("|").filter((k) => k && k !== "default");

      let liste = null;
      try {
        liste = JSON.parse(rohwert);
      } catch {
        // unlesbar: bleibt unverändert im Archiv erhalten
      }
      const { objekte } = pruefeObjekte(liste);

      // 2. Garten anlegen – außer es gibt ihn von einem früheren Versuch schon
      //    (dann wurde er vielleicht inzwischen weiterbearbeitet).
      if (kennzeichen.length > 0 && objekte.length > 0) {
        const id = "g-alt-" + rest;
        if (lies(PRAEFIX + id) == null) {
          const garten = {
            format: FORMAT_NAME,
            version: FORMAT_VERSION,
            id,
            // (freierName: Dieselbe Flurstücksnummer gibt es in jeder Flur.)
            name: freierName(
              "Flurstück " +
                flurstuecksNummer(kennzeichen[0]) +
                (kennzeichen.length > 1 ? " u. a." : ""),
            ),
            geaendert: Date.now(),
            flurstuecke: kennzeichen.map((k) => bereinigeFlurstueck({ id: k })),
            objekte,
          };
          if (!schreibe(PRAEFIX + id, JSON.stringify(garten))) return;
          anzahl++;
        }
      }

      // 3. Original entfernen – die Kopie liegt im Archiv.
      entferne(alt);
    });
  return anzahl;
}
