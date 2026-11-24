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
const istPunkt = (p) =>
  Array.isArray(p) && p.length >= 2 && istZahl(p[0]) && istZahl(p[1]);
// Ein Ring ist eine geschlossene Punktfolge: mindestens 3 Ecken + Schlusspunkt.
const istRing = (r) => Array.isArray(r) && r.length >= 4 && r.every(istPunkt);

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
    const gut = istPunkt(o.center) && istZahl(o.radius) && o.radius > 0;
    return gut ? { ...o, id } : null;
  }
  if (o.art === "flaeche") {
    if (o.multi) {
      // Zusammengesetzte Fläche: Liste von Vielecken, jedes eine Liste von Ringen.
      const gut =
        Array.isArray(o.multi) &&
        o.multi.length > 0 &&
        o.multi.every(
          (vieleck) =>
            Array.isArray(vieleck) && vieleck.length > 0 && vieleck.every(istRing),
        );
      return gut ? { ...o, id } : null;
    }
    return istRing(o.coords) ? { ...o, id } : null;
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
  let verworfen = 0;
  liste.forEach((o) => {
    const gut = bereinigeObjekt(o);
    if (gut) objekte.push(gut);
    else verworfen++;
  });
  return { objekte, verworfen };
}

// Ein gespeichertes Flurstück prüfen. Der Umriss (ring25832) darf fehlen –
// bei übernommenen alten Plänen wird er beim Öffnen vom Kataster nachgeladen.
function bereinigeFlurstueck(f) {
  if (!f || typeof f !== "object" || typeof f.id !== "string" || !f.id) {
    return null;
  }
  return {
    id: f.id,
    info: typeof f.info === "string" ? f.info : "",
    lage: typeof f.lage === "string" ? f.lage : "",
    amtlicheFlaeche: istZahl(f.amtlicheFlaeche) ? f.amtlicheFlaeche : null,
    ring25832: istRing(f.ring25832)
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

  const flurstuecke = (Array.isArray(daten.flurstuecke) ? daten.flurstuecke : [])
    .map(bereinigeFlurstueck)
    .filter(Boolean);
  if (flurstuecke.length === 0) return null; // ohne Grundstück kein Garten

  const { objekte, verworfen } = pruefeObjekte(daten.objekte);
  const name =
    typeof daten.name === "string" && daten.name.trim()
      ? daten.name.trim().slice(0, 80)
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
    name: (name || "").trim().slice(0, 80) || "Mein Garten",
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

// Sucht den gespeicherten Garten, der zu den gewählten Flurstücken gehört:
// den mit den meisten gemeinsamen Flurstücken (bei Gleichstand den zuletzt
// geänderten). So findet man seinen Garten auch wieder, wenn man diesmal ein
// Flurstück mehr oder weniger angetippt hat.
export function findeGartenFuer(flurstueckIds) {
  const gesucht = new Set(flurstueckIds);
  let bester = null;
  let meiste = 0;
  alleGaerten().forEach((garten) => {
    const gemeinsam = garten.flurstuecke.filter((f) => gesucht.has(f.id)).length;
    if (gemeinsam > meiste) {
      meiste = gemeinsam;
      bester = garten;
    }
  });
  return bester;
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
  const garten = bereinigeGarten(daten);
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
// übernommenen Pläne. Leere Pläne werden nicht übernommen. Das Original
// wandert ins Archiv – aber nur, wenn der neue Garten sicher gespeichert ist.
export function uebernehmeAltePlaene() {
  let anzahl = 0;
  alleSchluessel()
    .filter((schluessel) => schluessel.startsWith(PRAEFIX_ALT))
    .forEach((alt) => {
      const rohwert = lies(alt);
      if (rohwert == null) return;

      const kennzeichen = alt
        .slice(PRAEFIX_ALT.length)
        .split("|")
        .filter((k) => k && k !== "default");

      let liste = null;
      try {
        liste = JSON.parse(rohwert);
      } catch {
        // unlesbar: bleibt unverändert im Archiv erhalten
      }
      const { objekte } = pruefeObjekte(liste);

      if (kennzeichen.length > 0 && objekte.length > 0) {
        const garten = {
          format: FORMAT_NAME,
          version: FORMAT_VERSION,
          id: "g-" + zufall(),
          name:
            "Flurstück " +
            flurstuecksNummer(kennzeichen[0]) +
            (kennzeichen.length > 1 ? " u. a." : ""),
          geaendert: Date.now(),
          flurstuecke: kennzeichen.map((id) => bereinigeFlurstueck({ id })),
          objekte,
        };
        if (!schreibe(PRAEFIX + garten.id, JSON.stringify(garten))) return;
        anzahl++;
      }

      // Original ins Archiv verschieben (nur wenn die Kopie dort angekommen ist).
      if (schreibe(PRAEFIX_ARCHIV + alt, rohwert)) entferne(alt);
    });
  return anzahl;
}
