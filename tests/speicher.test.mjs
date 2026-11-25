// =========================================================================
// Test des Speicher-Bausteins src/gaerten.js – ohne Browser
// -------------------------------------------------------------------------
// Der Speicher des Browsers (localStorage) wird hier nachgebaut. Geprüft:
// Übernahme alter Pläne (auch nach einem gescheiterten Versuch), Speichern und
// Wiederfinden, Prüfung von Objekten und Flurstücken, die Suche nach dem
// passenden Garten, eindeutige Namen, beschädigte Einträge, Sichern und Laden
// als Datei, voller oder gesperrter Speicher.
// Aufruf: npm test
// =========================================================================
import { isDeepStrictEqual as gleich } from "node:util";

// Der nachgebaute Speicher. Störungen lassen sich einschalten:
//   globalThis.__voll = true      jedes Schreiben scheitert (Speicher voll)
//   globalThis.__gesperrt = true  jeder Zugriff scheitert (Speicher gesperrt)
//   stoerung = (was, schluessel) => true/false
//                                 einzelne Zugriffe scheitern lassen; „was“ ist
//                                 "schreiben" oder "entfernen"
const speicher = new Map();
let stoerung = null;
const stoere = (was, k) => { if (globalThis.__gesperrt || (was === "schreiben" && globalThis.__voll) || (stoerung && was !== "lesen" && stoerung(was, k))) throw new Error("QuotaExceededError"); };
globalThis.localStorage = new Proxy({
  getItem: (k) => { stoere("lesen", k); return speicher.has(k) ? speicher.get(k) : null; },
  setItem: (k, v) => { stoere("schreiben", k); speicher.set(k, String(v)); },
  removeItem: (k) => { stoere("entfernen", k); speicher.delete(k); },
}, { ownKeys: () => { stoere("lesen", null); return [...speicher.keys()]; }, getOwnPropertyDescriptor: (t, k) => (speicher.has(k) ? { enumerable: true, configurable: true, value: speicher.get(k) } : Reflect.getOwnPropertyDescriptor(t, k)) });
// Der Baustein meldet jedes gescheiterte Schreiben mit console.warn. Hier ist
// das Scheitern Absicht – die Meldungen würden die Ausgabe nur unlesbar machen.
console.warn = () => {};
// (Zum Gegenprüfen lässt sich eine andere Fassung des Bausteins angeben:
//  node tests/speicher.test.mjs /pfad/zu/gaerten.js)
const g = await import(process.argv[2] || new URL("../src/gaerten.js", import.meta.url).href);
let ok = 0, bad = 0;
const pruefe = (name, bedingung, detail = "") => { bedingung ? ok++ : bad++; console.log((bedingung ? "OK    " : "FEHLER") + " " + name + (detail ? "  -> " + detail : "")); };

// Die Schlüssel im Speicher
const GARTEN = "gruenriss:garten:", ALT = "gruenriss:plan:", ARCHIV = "gruenriss:archiv:";
// Umriss eines Flurstücks in Metern (EPSG:25832, Rheda-Wiedenbrück): 10 m × 20 m
const ring = [[451000, 5744000], [451010, 5744000], [451010, 5744020], [451000, 5744020], [451000, 5744000]];
// … und ein zweites daneben mit krummen Werten: 12,5 m × 20,5 m = 256,25 m²
const ring2 = [[451010.5, 5744000.25], [451023, 5744000.25], [451023, 5744020.75], [451010.5, 5744020.75], [451010.5, 5744000.25]];
// Ein Vieleck auf der Karte (Länge, Breite in Grad), geschlossen
const ringLL = [[8.28, 51.84], [8.2801, 51.84], [8.2801, 51.8401], [8.28, 51.84]];
// Zwei echte Flurstückskennzeichen (20 Stellen) – und eines mit derselben
// Flurstücksnummer 544 in einer anderen Flur
const K544 = "05254002600544______", K271 = "05254002600271______", K544B = "05254002700544______";

// Kleine Helfer
const schluesselMit = (anfang) => [...speicher.keys()].filter((k) => k.startsWith(anfang));
const kennungen = (liste) => liste.map((x) => x.id).join(",");
const abbild = () => JSON.stringify([...speicher.entries()]); // der ganze Speicher als Text, zum Vergleichen
const flurstueck = (id, mehr = {}) => ({ id, info: "", lage: "", amtlicheFlaeche: null, ring25832: ring, ...mehr });
const rohGarten = (mehr = {}) => ({ format: "gruenriss-garten", version: 2, id: "g-test", name: "Test", geaendert: 1, flurstuecke: [flurstueck("A")], objekte: [], ...mehr });
// Legt einen Garten direkt in den Speicher – mit festem Änderungsdatum.
const lege = (id, flurstueckIds, geaendert, mehr = {}) => speicher.set(GARTEN + id, JSON.stringify(rohGarten({ id, name: id, geaendert, flurstuecke: flurstueckIds.map((f) => flurstueck(f)), ...mehr })));
const kreis = (mehr = {}) => ({ id: "k", typ: "baum", art: "kreis", center: [8.28, 51.84], radius: 3, ...mehr });
const flaeche = (coords, mehr = {}) => ({ id: "f", typ: "beet", art: "flaeche", coords, ...mehr });
// Ein einzelnes Objekt prüfen lassen: bleibt es – oder fällt es weg und wird gezählt?
const bleibt = (o) => { const e = g.pruefeObjekte([o]); return e.objekte.length === 1 && e.verworfen === 0; };
const faelltWeg = (o) => { const e = g.pruefeObjekte([o]); return e.objekte.length === 0 && e.verworfen === 1; };
const istZu = (r) => r[0][0] === r[r.length - 1][0] && r[0][1] === r[r.length - 1][1];

// -------------------------------------------------------------------------
// Alte Pläne übernehmen
// -------------------------------------------------------------------------
speicher.set(ALT + K544, JSON.stringify([{ id: "a", typ: "haus", art: "flaeche", coords: ringLL }, { id: "b", typ: "baum", art: "punkt", coords: [8.28, 51.84] }, null, { typ: "x" }]));
speicher.set(ALT + K271 + "|" + K544, JSON.stringify([{ id: "c", typ: "rasen", art: "flaeche", multi: [[ringLL]] }]));
speicher.set(ALT + "05254002600999______", "[]");
speicher.set(ALT + "05254002600888______", "{kaputt");
speicher.set(ALT + "default", JSON.stringify([{ id: "d", typ: "baum", art: "kreis", center: [8.28, 51.84], radius: 2 }]));
speicher.set("anderes:spiel", "bleibt");
const n = g.uebernehmeAltePlaene();
let alle = g.alleGaerten();
pruefe("2 alte Pläne mit Inhalt werden Gärten", n === 2 && alle.length === 2, `übernommen ${n}, Gärten ${alle.length}`);
const eins = alle.find((x) => x.flurstuecke.length === 1), zwei = alle.find((x) => x.flurstuecke.length === 2);
pruefe("Name aus dem Kennzeichen", eins.name === "Flurstück 544" && zwei.name === "Flurstück 271 u. a.", `${eins.name} | ${zwei.name}`);
pruefe("gültige Objekte übernommen, alter Punkt-Baum wird Kreis, Schrott fällt weg", eins.objekte.length === 2 && eins.objekte[1].art === "kreis" && eins.objekte[1].radius === 3, JSON.stringify(eins.objekte.map((o) => o.art)));
pruefe("Umriss fehlt zunächst (wird beim Öffnen nachgeladen)", eins.flurstuecke[0].ring25832 === null && g.flaecheVon(eins) === null);
pruefe("alte Einträge liegen im Archiv, nichts ist verloren", schluesselMit(ALT).length === 0 && schluesselMit(ARCHIV + ALT).length === 5 && speicher.get(ARCHIV + ALT + "05254002600888______") === "{kaputt");
pruefe("fremde Einträge bleiben unberührt", speicher.get("anderes:spiel") === "bleibt");
pruefe("die Kennung des Gartens wird aus dem alten Schlüssel gebildet (so entsteht er nie doppelt)", eins.id === "g-alt-" + K544 && zwei.id === "g-alt-" + K271 + "|" + K544, `${eins.id} | ${zwei.id}`);
pruefe("übernommener Garten wird über seine Flurstücke gefunden", kennungen(g.sucheGaertenFuer([K544, K271]).genau) === zwei.id && kennungen(g.sucheGaertenFuer([K544]).genau) === eins.id);
let vorher = abbild();
pruefe("zweiter Aufruf übernimmt nichts doppelt", g.uebernehmeAltePlaene() === 0 && g.alleGaerten().length === 2);
pruefe("… und auch ein dritter ändert am Speicher gar nichts mehr (das Archiv gilt nicht als alter Plan)", g.uebernehmeAltePlaene() === 0 && abbild() === vorher);
zwei.objekte.push(kreis());
pruefe("übernommener Garten (Kennung mit „|“) lässt sich speichern, wieder lesen und löschen", g.speichereGarten(zwei) === true && g.ladeGarten(zwei.id).objekte.length === 2 && (g.loescheGarten(zwei.id), g.ladeGarten(zwei.id) === null));
pruefe("gelöschter Garten kommt durch eine erneute Übernahme nicht zurück", g.uebernehmeAltePlaene() === 0 && g.ladeGarten(zwei.id) === null && g.alleGaerten().length === 1);

// -------------------------------------------------------------------------
// Übernahme alter Pläne ist wiederholungssicher – auch wenn ein Schritt scheitert
// -------------------------------------------------------------------------
const altPlan = JSON.stringify([{ id: "a", typ: "haus", art: "flaeche", coords: ringLL }]);
const ID544 = "g-alt-" + K544, ID271 = "g-alt-" + K271;

// (a) Die Kopie ins Archiv lässt sich nicht schreiben.
speicher.clear();
speicher.set(ALT + K544, altPlan);
speicher.set(ALT + K271, altPlan);
stoerung = (was, k) => was === "schreiben" && k === ARCHIV + ALT + K544;
let m = g.uebernehmeAltePlaene();
pruefe("Archiv-Kopie scheitert: das Original bleibt unberührt liegen, es entsteht kein Garten", speicher.get(ALT + K544) === altPlan && !speicher.has(GARTEN + ID544) && !speicher.has(ARCHIV + ALT + K544));
pruefe("… der andere Plan wird davon nicht aufgehalten", m === 1 && kennungen(g.alleGaerten()) === ID271 && !speicher.has(ALT + K271), `übernommen ${m}`);
stoerung = null;
m = g.uebernehmeAltePlaene();
pruefe("… der nächste Start holt den liegengebliebenen Plan nach: genau ein Garten je Plan, Original im Archiv", m === 1 && g.alleGaerten().length === 2 && schluesselMit(GARTEN).length === 2 && g.ladeGarten(ID544).objekte.length === 1 && schluesselMit(ALT).length === 0 && speicher.get(ARCHIV + ALT + K544) === altPlan, `übernommen ${m}, Gärten ${schluesselMit(GARTEN).length}`);

// (b) Die Kopie klappt, aber der Garten lässt sich nicht schreiben.
speicher.clear();
speicher.set(ALT + K544, altPlan);
stoerung = (was, k) => was === "schreiben" && k.startsWith(GARTEN);
m = g.uebernehmeAltePlaene();
pruefe("Garten lässt sich nicht schreiben: das Original bleibt liegen, nichts wird als übernommen gezählt", m === 0 && speicher.get(ALT + K544) === altPlan && speicher.get(ARCHIV + ALT + K544) === altPlan && schluesselMit(GARTEN).length === 0, `übernommen ${m}`);
m = g.uebernehmeAltePlaene();
pruefe("… auch ein weiterer gescheiterter Versuch ändert daran nichts", m === 0 && speicher.get(ALT + K544) === altPlan && schluesselMit(GARTEN).length === 0 && schluesselMit(ARCHIV).length === 1);
stoerung = null;
m = g.uebernehmeAltePlaene();
const m2 = g.uebernehmeAltePlaene();
pruefe("… später entsteht genau ein Garten (kein doppelter), das Original ist weg", m === 1 && m2 === 0 && kennungen(g.alleGaerten()) === ID544 && schluesselMit(GARTEN).length === 1 && schluesselMit(ALT).length === 0 && schluesselMit(ARCHIV).length === 1, `übernommen ${m}, dann ${m2}, Gärten ${schluesselMit(GARTEN).length}`);

// (c) Den Garten gibt es von einem früheren Versuch schon – und er wurde
//     inzwischen weiterbearbeitet. (Hier ließ sich das Original nicht entfernen.)
speicher.clear();
speicher.set(ALT + K544, altPlan);
stoerung = (was, k) => was === "entfernen" && k === ALT + K544;
m = g.uebernehmeAltePlaene();
stoerung = null;
pruefe("Original lässt sich nicht entfernen: der Garten entsteht trotzdem, das Original liegt noch da", m === 1 && g.ladeGarten(ID544) !== null && speicher.get(ALT + K544) === altPlan);
const bearbeitet = g.ladeGarten(ID544);
bearbeitet.name = "Mozartstraße 3";
bearbeitet.objekte.push(kreis());
g.speichereGarten(bearbeitet);
const stand = speicher.get(GARTEN + ID544);
m = g.uebernehmeAltePlaene();
pruefe("inzwischen bearbeiteter Garten wird von der erneuten Übernahme nicht überschrieben", m === 0 && speicher.get(GARTEN + ID544) === stand && g.ladeGarten(ID544).name === "Mozartstraße 3" && g.ladeGarten(ID544).objekte.length === 2, `übernommen ${m}`);
pruefe("… das Original wird dabei entfernt, die Kopie liegt im Archiv", !speicher.has(ALT + K544) && speicher.get(ARCHIV + ALT + K544) === altPlan && schluesselMit(GARTEN).length === 1);
// Liegt unter der Kennung ein Eintrag, den diese Version nicht lesen kann
// (z. B. aus einer neueren Version), darf er ebenfalls nicht ersetzt werden.
speicher.clear();
speicher.set(ALT + K544, altPlan);
speicher.set(GARTEN + ID544, '{"format":"gruenriss-garten","version":99}');
m = g.uebernehmeAltePlaene();
pruefe("auch ein hier nicht lesbarer Eintrag unter derselben Kennung wird nicht überschrieben", m === 0 && speicher.get(GARTEN + ID544) === '{"format":"gruenriss-garten","version":99}' && !speicher.has(ALT + K544) && speicher.get(ARCHIV + ALT + K544) === altPlan);

// (d) Zweimal hintereinander – und gleiche Flurstücksnummern in zwei Fluren.
speicher.clear();
speicher.set(ALT + K544, altPlan);
speicher.set(ALT + K544B, altPlan);
m = g.uebernehmeAltePlaene();
vorher = abbild();
pruefe("zweimal übernehmen verdoppelt nichts: Gärten, Archiv und Inhalt bleiben gleich", m === 2 && g.uebernehmeAltePlaene() === 0 && abbild() === vorher && schluesselMit(GARTEN).length === 2 && schluesselMit(ARCHIV).length === 2);
pruefe("zwei alte Pläne mit derselben Flurstücksnummer (andere Flur) bekommen verschiedene Namen", new Set(g.alleGaerten().map((x) => x.name)).size === 2 && g.alleGaerten().every((x) => /^Flurstück 544/.test(x.name)), g.alleGaerten().map((x) => x.name).join(" | "));

// -------------------------------------------------------------------------
// Neuer Garten, speichern, wiederfinden
// -------------------------------------------------------------------------
speicher.clear();
const fl = [{ id: "A", info: "Gemarkung X, Flur 1, Flurstück 5", lage: "Mozartstraße 3", amtlicheFlaeche: 201, ring25832: ring, ringLngLat: ringLL }];
const neu = g.neuerGarten(fl, "Mozartstraße 3");
pruefe("neuer Garten ist noch nicht gespeichert (das geschieht erst mit dem ersten Objekt)", speicher.size === 0 && g.alleGaerten().length === 0 && neu.objekte.length === 0);
neu.objekte.push({ id: "o1", typ: "baum", art: "kreis", center: [8.28, 51.84], radius: 3 });
neu.geaendert = 1;
const jetzt = Date.now();
pruefe("speichern klappt", g.speichereGarten(neu) === true);
pruefe("speichern setzt das Änderungsdatum", neu.geaendert >= jetzt && g.ladeGarten(neu.id).geaendert === neu.geaendert);
const wieder = g.ladeGarten(neu.id);
pruefe("gespeicherter Garten kommt vollständig zurück (ohne Lat/Lon-Ballast)", wieder && wieder.name === "Mozartstraße 3" && wieder.objekte.length === 1 && gleich(wieder.flurstuecke[0].ring25832, ring) && wieder.flurstuecke[0].lage === "Mozartstraße 3" && wieder.flurstuecke[0].amtlicheFlaeche === 201 && !("ringLngLat" in wieder.flurstuecke[0]) && wieder.verworfen === 0);
pruefe("Fläche aus dem Umriss", g.flaecheVon(wieder) === 200, String(g.flaecheVon(wieder)));
pruefe("im Speicher steht kein Feld „verworfen“", !speicher.get(GARTEN + neu.id).includes("verworfen"));
pruefe("Garten wird über genau seine Flurstücke gefunden", kennungen(g.sucheGaertenFuer(["A"]).genau) === neu.id && g.sucheGaertenFuer(["Z"]).genau.length === 0);
lege("alt", ["Q"], 5);
pruefe("der zuletzt geänderte steht vorn", kennungen(g.alleGaerten()) === neu.id + ",alt");
const gespeichertesFlurstueck = g.alsGespeichertesFlurstueck(fl[0]);
pruefe("gespeichert wird eine eigene Kopie des Umrisses (spätere Änderungen an der Auswahl ändern den Garten nicht)", gleich(gespeichertesFlurstueck, { id: "A", info: "Gemarkung X, Flur 1, Flurstück 5", lage: "Mozartstraße 3", amtlicheFlaeche: 201, ring25832: ring }) && gespeichertesFlurstueck.ring25832 !== ring && gespeichertesFlurstueck.ring25832[0] !== ring[0]);
const zweiFlurstuecke = g.neuerGarten([fl[0], flurstueck("B", { ring25832: ring2 })], "  ");
pruefe("Flächen mehrerer Flurstücke werden addiert; fehlt ein Umriss, gibt es keine Fläche", Math.abs(g.flaecheVon(zweiFlurstuecke) - 456.25) < 0.01 && g.flaecheVon(g.neuerGarten([fl[0], { id: "B" }], "x")) === null, String(g.flaecheVon(zweiFlurstuecke)));
pruefe("Name eines neuen Gartens: ohne Angabe „Mein Garten“, höchstens 80 Zeichen, ohne Leerzeichen am Rand", zweiFlurstuecke.name === "Mein Garten" && g.neuerGarten(fl, "N".repeat(90)).name.length === 80 && g.neuerGarten(fl, "  Am Bach 1 ").name === "Am Bach 1");
pruefe("jeder neue Garten bekommt eine eigene Kennung", g.neuerGarten(fl, "x").id !== g.neuerGarten(fl, "x").id && /^g-/.test(neu.id));

// -------------------------------------------------------------------------
// Objekte prüfen: Was die Karte nicht zeichnen kann, fällt weg und wird gezählt
// -------------------------------------------------------------------------
const offen = [[8.28, 51.84], [8.2801, 51.84], [8.2801, 51.8401]]; // drei Ecken, Schlusspunkt fehlt
pruefe("Breite 95 Grad: Objekt fällt weg und wird gezählt", faelltWeg(kreis({ center: [8.28, 95] })) && faelltWeg(flaeche([[8.28, 51.84], [8.2801, 95], [8.2801, 51.8401], [8.28, 51.84]])) && faelltWeg({ id: "p", typ: "baum", art: "punkt", coords: [8.28, 95] }));
pruefe("Länge 181 Grad: Objekt fällt weg und wird gezählt", faelltWeg(kreis({ center: [181, 51.84] })) && faelltWeg(flaeche([[8.28, 51.84], [181, 51.84], [8.2801, 51.8401], [8.28, 51.84]])) && faelltWeg(kreis({ center: [-181, 51.84] })) && faelltWeg(kreis({ center: [8.28, -95] })));
pruefe("der Rand des Gradnetzes (±180 / ±90) ist noch gültig", bleibt(kreis({ center: [180, 90] })) && bleibt(kreis({ center: [-180, -90] })));
pruefe("Koordinaten, die keine Zahlen sind, fallen weg", faelltWeg(kreis({ center: ["8.28", "51.84"] })) && faelltWeg(kreis({ center: [8.28, NaN] })) && faelltWeg(kreis({ center: [Infinity, 51.84] })) && faelltWeg(kreis({ center: [8.28] })) && faelltWeg(kreis({ center: null })) && faelltWeg(flaeche([[8.28, 51.84], [8.2801, null], [8.2801, 51.8401]])));
pruefe("Kreis mit Radius 0 fällt weg", faelltWeg(kreis({ radius: 0 })));
pruefe("Kreis mit negativem Radius fällt weg", faelltWeg(kreis({ radius: -3 })));
pruefe("Kreis mit Radius 501 m fällt weg", faelltWeg(kreis({ radius: 501 })) && faelltWeg(kreis({ radius: 500.01 })));
pruefe("Kreis mit Radius 500 m bleibt (auch ein ganz kleiner)", bleibt(kreis({ radius: 500 })) && bleibt(kreis({ radius: 0.2 })) && g.pruefeObjekte([kreis({ radius: 500 })]).objekte[0].radius === 500);
pruefe("Radius, der keine Zahl ist, fällt weg", faelltWeg(kreis({ radius: "3" })) && faelltWeg(kreis({ radius: NaN })) && faelltWeg(kreis({ radius: Infinity })) && faelltWeg(kreis({ radius: undefined })));
let e = g.pruefeObjekte([flaeche(offen)]);
pruefe("offener Ring wird geschlossen: der erste Punkt wird angehängt", e.verworfen === 0 && e.objekte.length === 1 && e.objekte[0].coords.length === 4 && gleich(e.objekte[0].coords, [...offen, offen[0]]), JSON.stringify(e.objekte[0] && e.objekte[0].coords));
pruefe("… die übergebenen Daten selbst bleiben dabei unverändert", offen.length === 3);
e = g.pruefeObjekte([flaeche(ringLL)]);
pruefe("geschlossener Ring bleibt, wie er ist (kein zweiter Schlusspunkt)", e.objekte.length === 1 && gleich(e.objekte[0].coords, ringLL));
pruefe("Ring mit weniger als drei Ecken fällt weg (auch wenn er „geschlossen“ ist)", faelltWeg(flaeche([[8.28, 51.84], [8.2801, 51.84]])) && faelltWeg(flaeche([[8.28, 51.84], [8.2801, 51.84], [8.28, 51.84]])) && faelltWeg(flaeche([[8.28, 51.84]])) && faelltWeg(flaeche([])) && faelltWeg(flaeche(undefined)) && faelltWeg(flaeche("Ring")));
pruefe("Ring aus lauter gleichen Punkten ist keine Fläche und fällt weg (ließe sich im Editor nicht einmal antippen)", faelltWeg(flaeche([[8.28, 51.84], [8.28, 51.84], [8.28, 51.84], [8.28, 51.84]])) && faelltWeg(flaeche([[8.28, 51.84], [8.2801, 51.84], [8.2801, 51.84], [8.28, 51.84]])) && bleibt(flaeche([[8.28, 51.84], [8.2801, 51.84], [8.2801, 51.8401]])));
e = g.pruefeObjekte([flaeche(undefined, { multi: [[offen, offen.map(([x, y]) => [x + 0.00001, y + 0.00001])], [ringLL]] })]);
pruefe("zusammengesetzte Fläche (multi): auch ihre Ringe werden geschlossen", e.verworfen === 0 && e.objekte.length === 1 && e.objekte[0].multi.length === 2 && e.objekte[0].multi[0].length === 2 && e.objekte[0].multi.every((vieleck) => vieleck.every((r) => r.length === 4 && istZu(r))) && gleich(e.objekte[0].multi[0][0], [...offen, offen[0]]) && gleich(e.objekte[0].multi[1][0], ringLL), JSON.stringify(e.objekte[0] && e.objekte[0].multi));
pruefe("zusammengesetzte Fläche mit einem unbrauchbaren Ring fällt ganz weg", faelltWeg(flaeche(undefined, { multi: [[ringLL], [[[8.28, 51.84], [8.2801, 51.84]]]] })) && faelltWeg(flaeche(undefined, { multi: [[ringLL, [[8.28, 95], [8.2801, 51.84], [8.2801, 51.8401]]]] })) && faelltWeg(flaeche(undefined, { multi: [[]] })) && faelltWeg(flaeche(undefined, { multi: [ringLL] })) && faelltWeg(flaeche(ringLL, { multi: "x" })));
pruefe("unbekannte Art oder fehlender Typ fällt weg", faelltWeg({ id: "x", typ: "weg", art: "linie", coords: ringLL }) && faelltWeg({ id: "x", art: "flaeche", coords: ringLL }) && faelltWeg({ id: "x", typ: "beet", coords: ringLL }) && faelltWeg(null) && faelltWeg("Baum") && faelltWeg(7));
e = g.pruefeObjekte([kreis({ id: "1" }), kreis({ id: "2", radius: 0 }), flaeche(ringLL, { id: "3" }), null, flaeche(offen, { id: "4" }), kreis({ id: "5", center: [8.28, 95] }), { id: "6", typ: "x" }]);
pruefe("„verworfen“ zählt genau das Unlesbare, die Reihenfolge der übrigen bleibt", e.verworfen === 4 && kennungen(e.objekte) === "1,3,4", `verworfen ${e.verworfen}, übrig ${kennungen(e.objekte)}`);
pruefe("keine Liste: leerer Plan (fehlt sie ganz, gilt nichts als verworfen)", gleich(g.pruefeObjekte(undefined), { objekte: [], verworfen: 0 }) && gleich(g.pruefeObjekte(null), { objekte: [], verworfen: 0 }) && gleich(g.pruefeObjekte([]), { objekte: [], verworfen: 0 }) && gleich(g.pruefeObjekte("kaputt"), { objekte: [], verworfen: 1 }));
e = g.pruefeObjekte([kreis({ hoehe: 12, notiz: "Apfelbaum" }), flaeche(ringLL, { rechteck: true })]);
pruefe("weitere Angaben eines Objekts bleiben erhalten", e.objekte[0].hoehe === 12 && e.objekte[0].notiz === "Apfelbaum" && e.objekte[0].typ === "baum" && e.objekte[1].rechteck === true);

// Doppelte Kennungen („Löschen“ träfe sonst mehrere Objekte auf einmal)
e = g.pruefeObjekte([kreis({ id: "x" }), flaeche(ringLL, { id: "x" }), kreis({ id: "y" }), kreis({ id: "x", radius: 5 }), kreis({ id: "y", radius: 6 })]);
pruefe("doppelte Kennungen: danach sind alle verschieden", new Set(e.objekte.map((o) => o.id)).size === 5 && e.objekte.every((o) => typeof o.id === "string" && o.id), kennungen(e.objekte));
pruefe("… das jeweils erste Objekt behält seine Kennung", e.objekte[0].id === "x" && e.objekte[2].id === "y");
pruefe("… dabei geht kein Objekt verloren, Inhalt und Reihenfolge bleiben", e.verworfen === 0 && e.objekte.length === 5 && e.objekte.map((o) => o.art + (o.radius || "")).join(",") === "kreis3,flaeche,kreis3,kreis5,kreis6");
e = g.pruefeObjekte([kreis({ id: undefined }), kreis({ id: "" }), kreis({ id: 7 }), kreis({ id: "k" })]);
pruefe("Objekte ohne brauchbare Kennung bekommen je eine eigene", e.verworfen === 0 && new Set(e.objekte.map((o) => o.id)).size === 4 && e.objekte.every((o) => typeof o.id === "string" && o.id) && e.objekte[3].id === "k", kennungen(e.objekte));
speicher.clear();
speicher.set(GARTEN + "doppelt", JSON.stringify(rohGarten({ id: "doppelt", objekte: [kreis({ id: "x" }), kreis({ id: "x" })] })));
pruefe("auch im gespeicherten Garten: doppelte Kennungen sind nach dem Lesen verschieden, nichts gilt als verworfen", new Set(g.ladeGarten("doppelt").objekte.map((o) => o.id)).size === 2 && g.ladeGarten("doppelt").verworfen === 0);

// -------------------------------------------------------------------------
// Flurstücke prüfen
// -------------------------------------------------------------------------
const mitUmriss = (ring25832) => g.bereinigeGarten(rohGarten({ flurstuecke: [flurstueck("A", { ring25832 })] }));
const umrissFaelltWeg = (ring25832) => { const garten = mitUmriss(ring25832); return garten !== null && garten.flurstuecke.length === 1 && garten.flurstuecke[0].id === "A" && garten.flurstuecke[0].ring25832 === null && g.flaecheVon(garten) === null; };
pruefe("plausibler Umriss bleibt erhalten", gleich(mitUmriss(ring).flurstuecke[0].ring25832, ring) && gleich(mitUmriss(ring2).flurstuecke[0].ring25832, ring2));
pruefe("Umriss mit unmöglichen Werten wird verworfen (und beim Öffnen neu geholt) – der Garten bleibt gültig", umrissFaelltWeg([[0, 0], [10, 0], [10, 20], [0, 20], [0, 0]]) && umrissFaelltWeg(ringLL) && umrissFaelltWeg(ring.map(([ost, nord]) => [nord, ost])) && umrissFaelltWeg([[451000, 5744000], [451010, 5744000], [451010, 99999999], [451000, 5744020], [451000, 5744000]]));
pruefe("… ebenso knapp außerhalb des Bereichs um NRW (Ost 200000–700000, Nord 5400000–5900000)", umrissFaelltWeg(ring.map(([ost, nord]) => [ost - 251001, nord])) && umrissFaelltWeg(ring.map(([ost, nord]) => [ost + 249000, nord])) && umrissFaelltWeg(ring.map(([ost, nord]) => [ost, nord - 344001])) && umrissFaelltWeg(ring.map(([ost, nord]) => [ost, nord + 156000])));
pruefe("… ebenso ein Umriss, der keine Zahlen enthält, zu kurz ist oder gar keine Liste ist", umrissFaelltWeg(ring.map(([ost, nord]) => [String(ost), String(nord)])) && umrissFaelltWeg([[451000, NaN], ...ring.slice(1)]) && umrissFaelltWeg(ring.slice(0, 3)) && umrissFaelltWeg("Umriss") && umrissFaelltWeg(undefined));
pruefe("offener Umriss (Schlusspunkt fehlt) wird verworfen statt eine falsche Fläche zu liefern", umrissFaelltWeg(ring.slice(0, 4)), String(g.flaecheVon(mitUmriss(ring.slice(0, 4)))));
let garten = g.bereinigeGarten(rohGarten({ flurstuecke: [flurstueck("K".repeat(101)), flurstueck("A")] }));
pruefe("Flurstück mit überlangem Kennzeichen (über 100 Zeichen) ist ungültig, das gültige daneben bleibt", garten !== null && kennungen(garten.flurstuecke) === "A");
pruefe("… ein Garten ganz ohne gültiges Flurstück ist keiner", g.bereinigeGarten(rohGarten({ flurstuecke: [flurstueck("K".repeat(101))] })) === null && g.bereinigeGarten(rohGarten({ flurstuecke: [] })) === null && g.bereinigeGarten(rohGarten({ flurstuecke: "A" })) === null && g.bereinigeGarten(rohGarten({ flurstuecke: [{ id: 544 }, { id: "" }, null] })) === null);
pruefe("… genau 100 Zeichen sind noch erlaubt", g.bereinigeGarten(rohGarten({ flurstuecke: [flurstueck("K".repeat(100))] })) !== null && g.alsGespeichertesFlurstueck({ id: "K".repeat(101) }) === null);
garten = g.bereinigeGarten(rohGarten({ flurstuecke: [flurstueck("A"), flurstueck("B", { ring25832: ring2 }), flurstueck("A")] }));
pruefe("doppelt genanntes Flurstück zählt nur einmal (sonst stimmte die Fläche nicht)", kennungen(garten.flurstuecke) === "A,B" && Math.abs(g.flaecheVon(garten) - 456.25) < 0.01, `${kennungen(garten.flurstuecke)}, Fläche ${g.flaecheVon(garten)}`);
garten = g.bereinigeGarten(rohGarten({ flurstuecke: [{ id: "A", info: 5, lage: null, amtlicheFlaeche: "201", ring25832: ring, ringLngLat: ringLL, fremd: true }] }));
pruefe("unbrauchbare Angaben eines Flurstücks werden geleert, Fremdes fällt weg", gleich(garten.flurstuecke[0], { id: "A", info: "", lage: "", amtlicheFlaeche: null, ring25832: ring }));
garten = g.bereinigeGarten({ format: "gruenriss-garten", version: 1, flurstuecke: [{ id: "A" }] });
pruefe("fehlende Angaben eines Gartens werden ergänzt (Name, Kennung, Datum, leerer Plan)", garten !== null && garten.name === "Mein Garten" && /^g-/.test(garten.id) && garten.version === 2 && typeof garten.geaendert === "number" && gleich(garten.objekte, []) && garten.verworfen === 0);
pruefe("kein Garten: fremdes Format, neuere Version, Version fehlt, gar kein Objekt", g.bereinigeGarten(rohGarten({ format: "anderes" })) === null && g.bereinigeGarten(rohGarten({ version: 3 })) === null && g.bereinigeGarten(rohGarten({ version: "2" })) === null && g.bereinigeGarten(null) === null && g.bereinigeGarten([rohGarten()]) === null && g.bereinigeGarten("Garten") === null);
pruefe("Name wird gekürzt (80 Zeichen) und von Leerzeichen am Rand befreit", g.bereinigeGarten(rohGarten({ name: "  " + "N".repeat(90) })).name === "N".repeat(80) && g.bereinigeGarten(rohGarten({ name: "   " })).name === "Mein Garten" && g.bereinigeGarten(rohGarten({ name: 5 })).name === "Mein Garten");

// -------------------------------------------------------------------------
// Den passenden Garten suchen (sucheGaertenFuer)
// -------------------------------------------------------------------------
// Zwei Gärten teilen sich das Flurstück A – der größere ist der neuere.
speicher.clear();
lege("nurA", ["A"], 1000);
lege("AundB", ["A", "B"], 2000);
let s = g.sucheGaertenFuer(["A"]);
pruefe("Gärten {A} und {A, B}: zur Auswahl [A] passt genau nur {A} – {A, B} überschneidet sich bloß (obwohl er neuer ist)", kennungen(s.genau) === "nurA" && kennungen(s.teilweise) === "AundB", `genau ${kennungen(s.genau)} | teilweise ${kennungen(s.teilweise)}`);
s = g.sucheGaertenFuer(["A", "B"]);
pruefe("… zur Auswahl [A, B] ist es umgekehrt", kennungen(s.genau) === "AundB" && kennungen(s.teilweise) === "nurA", `genau ${kennungen(s.genau)} | teilweise ${kennungen(s.teilweise)}`);
s = g.sucheGaertenFuer(["B", "A"]);
pruefe("… die Reihenfolge der Auswahl spielt keine Rolle", kennungen(s.genau) === "AundB" && kennungen(s.teilweise) === "nurA");
s = g.sucheGaertenFuer(["B"]);
pruefe("… zur Auswahl [B] passt keiner genau; nur {A, B} überschneidet sich", s.genau.length === 0 && kennungen(s.teilweise) === "AundB", `genau ${kennungen(s.genau)} | teilweise ${kennungen(s.teilweise)}`);
s = g.sucheGaertenFuer(["A", "B", "C"]);
pruefe("… zur Auswahl [A, B, C] passt keiner genau (ein Flurstück mehr ist nicht „genau“)", s.genau.length === 0 && kennungen(s.teilweise) === "AundB,nurA", `genau ${kennungen(s.genau)} | teilweise ${kennungen(s.teilweise)}`);
s = g.sucheGaertenFuer(["Z"]);
const leer = g.sucheGaertenFuer([]);
pruefe("keine Überschneidung: beide Listen leer (auch bei leerer Auswahl)", s.genau.length === 0 && s.teilweise.length === 0 && leer.genau.length === 0 && leer.teilweise.length === 0);
s = g.sucheGaertenFuer(["A", "A"]);
const s2 = g.sucheGaertenFuer(["B", "A", "B", "A"]);
pruefe("doppelt genannte Flurstücke in der Auswahl bringen den Vergleich nicht durcheinander", kennungen(s.genau) === "nurA" && kennungen(s.teilweise) === "AundB" && kennungen(s2.genau) === "AundB" && kennungen(s2.teilweise) === "nurA", `[A,A]: genau ${kennungen(s.genau)} | teilweise ${kennungen(s.teilweise)}`);
speicher.set(GARTEN + "AA", JSON.stringify(rohGarten({ id: "AA", geaendert: 500, flurstuecke: [flurstueck("A"), flurstueck("A")] })));
s = g.sucheGaertenFuer(["A"]);
pruefe("… ebenso wenig ein Garten, der ein Flurstück doppelt nennt", kennungen(s.genau) === "nurA,AA" && kennungen(s.teilweise) === "AundB", `genau ${kennungen(s.genau)} | teilweise ${kennungen(s.teilweise)}`);
vorher = abbild();
g.sucheGaertenFuer(["A", "B"]);
pruefe("die Suche ändert nichts am Speicher (Flurstücke eines Gartens werden nie still umgeschrieben)", abbild() === vorher);

// Mehrere Gärten mit genau derselben Auswahl: der zuletzt geänderte zuerst.
speicher.clear();
lege("mittel", ["A", "B"], 7000);
lege("neuester", ["B", "A"], 9000);
lege("aeltester", ["A", "B"], 5000);
s = g.sucheGaertenFuer(["A", "B"]);
pruefe("mehrere genau passende Gärten: der zuletzt geänderte steht vorn", kennungen(s.genau) === "neuester,mittel,aeltester" && s.teilweise.length === 0, kennungen(s.genau));

// Reihenfolge der Überschneidungen zur Auswahl [A, B, C]. Die Änderungsdaten
// laufen der erwarteten Reihenfolge absichtlich entgegen, wo ein anderes
// Merkmal entscheidet.
speicher.clear();
lege("einsFern", ["C", "X", "Y"], 9000); // 1 gemeinsam, 4 fremd – der neueste von allen
lege("einsAlt", ["A"], 3000); //            1 gemeinsam, 2 fremd
lege("zweiFern", ["A", "B", "D", "E"], 8000); // 2 gemeinsam, 3 fremd
lege("fremd", ["Z"], 9500); //              nichts gemeinsam
lege("einsNeu", ["B"], 4000); //            1 gemeinsam, 2 fremd, neuer als einsAlt
lege("zweiNah", ["A", "B"], 2000); //       2 gemeinsam, 1 fremd
lege("viel", ["A", "B", "C", "D"], 1000); // 3 gemeinsam, 1 fremd – der älteste von allen
s = g.sucheGaertenFuer(["A", "B", "C"]);
pruefe("Überschneidungen: zuerst der Garten mit den meisten gemeinsamen Flurstücken", s.teilweise[0].id === "viel" && s.teilweise.map((x) => x.id).indexOf("zweiFern") < s.teilweise.map((x) => x.id).indexOf("einsNeu"), kennungen(s.teilweise));
pruefe("… bei gleich vielen gemeinsamen der mit weniger fremden Flurstücken", s.teilweise.map((x) => x.id).indexOf("zweiNah") < s.teilweise.map((x) => x.id).indexOf("zweiFern") && s.teilweise.map((x) => x.id).indexOf("einsAlt") < s.teilweise.map((x) => x.id).indexOf("einsFern"), kennungen(s.teilweise));
pruefe("… bei Gleichstand der zuletzt geänderte", s.teilweise.map((x) => x.id).indexOf("einsNeu") < s.teilweise.map((x) => x.id).indexOf("einsAlt"), kennungen(s.teilweise));
pruefe("… insgesamt: ähnlichster zuerst, Gärten ohne gemeinsames Flurstück fehlen", s.genau.length === 0 && kennungen(s.teilweise) === "viel,zweiNah,zweiFern,einsNeu,einsAlt,einsFern", kennungen(s.teilweise));

// -------------------------------------------------------------------------
// Eindeutige Namen (freierName)
// -------------------------------------------------------------------------
speicher.clear();
pruefe("freier Name bleibt, wie er ist", g.freierName("Mozartstraße 3") === "Mozartstraße 3");
lege("g1", ["A"], 1, { name: "Mozartstraße 3" });
pruefe("vergebener Name bekommt „ (2)“", g.freierName("Mozartstraße 3") === "Mozartstraße 3 (2)", g.freierName("Mozartstraße 3"));
pruefe("… ein anderer Name bleibt frei", g.freierName("Mozartstraße 5") === "Mozartstraße 5");
lege("g2", ["B"], 2, { name: "Mozartstraße 3 (2)" });
pruefe("ist auch „ (2)“ vergeben, wird es „ (3)“", g.freierName("Mozartstraße 3") === "Mozartstraße 3 (3)", g.freierName("Mozartstraße 3"));
pruefe("der Garten selbst (ausserId) versperrt seinen eigenen Namen nicht", g.freierName("Mozartstraße 3", "g1") === "Mozartstraße 3" && g.freierName("Mozartstraße 3 (2)", "g2") === "Mozartstraße 3 (2)");
pruefe("… ein anderer Garten als der genannte aber sehr wohl", g.freierName("Mozartstraße 3", "g2") === "Mozartstraße 3 (2)" && g.freierName("Mozartstraße 3", "gibt-es-nicht") === "Mozartstraße 3 (3)");
lege("g4", ["C"], 3, { name: "Mozartstraße 3 (4)" });
pruefe("es wird die erste freie Nummer genommen", g.freierName("Mozartstraße 3") === "Mozartstraße 3 (3)");
speicher.set(GARTEN + "kaputt", JSON.stringify({ format: "gruenriss-garten", version: 99, name: "Am Bach 1" }));
pruefe("ein unlesbarer Eintrag versperrt keinen Namen", g.freierName("Am Bach 1") === "Am Bach 1");
vorher = abbild();
g.freierName("Mozartstraße 3");
pruefe("die Namenssuche ändert nichts am Speicher", abbild() === vorher);
// Sehr lange Namen: Ein Name ist höchstens 80 Zeichen lang. Der Vorschlag
// muss auch nach dem Speichern noch ein eigener Name sein.
const lang = "Lange Straße ".repeat(7).slice(0, 80);
lege("lang", ["L"], 4, { name: lang });
let vorschlag = g.freierName(lang);
pruefe("sehr langer Name: auch mit „ (2)“ passt der Vorschlag in die 80 Zeichen und bleibt nach dem Speichern eigen", vorschlag.length <= 80 && vorschlag !== lang && / \(2\)$/.test(vorschlag) && g.neuerGarten(fl, vorschlag).name === vorschlag, `${vorschlag.length} Zeichen: ${vorschlag}`);
vorschlag = g.freierName(lang + " und noch mehr");
pruefe("überlanger Wunschname wird wie beim Speichern gekürzt – und dann als vergeben erkannt", vorschlag.length <= 80 && vorschlag !== lang && g.neuerGarten(fl, vorschlag).name === vorschlag, `${vorschlag.length} Zeichen: ${vorschlag}`);

// -------------------------------------------------------------------------
// Beschädigte Einträge
// -------------------------------------------------------------------------
speicher.clear();
g.speichereGarten(wieder);
lege("zweiter", ["Q"], 5);
speicher.set(GARTEN + "kaputt1", "hallo");
speicher.set(GARTEN + "kaputt2", JSON.stringify({ format: "gruenriss-garten", version: 2, objekte: [] }));
speicher.set(GARTEN + "kaputt3", JSON.stringify({ format: "gruenriss-garten", version: 99, flurstuecke: [{ id: "A" }], objekte: [] }));
speicher.set(GARTEN + "teil", JSON.stringify({ format: "gruenriss-garten", version: 2, id: "falsch", name: "  Teil  ", flurstuecke: [{ id: "T", ring25832: ring }, null], objekte: [{ id: "o", typ: "beet", art: "flaeche" }, { id: "p", typ: "beet", art: "flaeche", coords: ringLL }, "x"] }));
vorher = abbild();
alle = g.alleGaerten();
const teil = alle.find((x) => x.name === "Teil");
pruefe("beschädigte Einträge werden übersprungen statt zu blockieren", alle.length === 3 && g.ladeGarten("kaputt1") === null && g.ladeGarten("kaputt2") === null && g.ladeGarten("kaputt3") === null && g.ladeGarten("gibt-es-nicht") === null, "Gärten: " + alle.length);
pruefe("teilweise lesbarer Garten: Gutes bleibt, Unlesbares wird gezählt", teil && teil.objekte.length === 1 && teil.verworfen === 2 && teil.flurstuecke.length === 1 && teil.id === "teil", JSON.stringify(teil && { o: teil.objekte.length, v: teil.verworfen, id: teil.id }));
g.sucheGaertenFuer(["T"]);
pruefe("Lesen allein ändert nichts: beschädigte Einträge und unlesbare Objekte bleiben im Speicher liegen", abbild() === vorher);
g.loescheGarten("zweiter");
pruefe("löschen entfernt genau diesen einen Eintrag", g.ladeGarten("zweiter") === null && speicher.size === 5 && g.alleGaerten().length === 2 && g.ladeGarten(wieder.id) !== null);

// -------------------------------------------------------------------------
// Datei sichern und laden
// -------------------------------------------------------------------------
const text = g.alsDateiText(wieder);
pruefe("Dateiname ohne Sonderzeichen", g.dateiName(wieder) === "gruenriss-mozartstrasse-3.json" && g.dateiName({ name: "Ärger & Öl – Übung 7!" }) === "gruenriss-aerger-oel-uebung-7.json" && g.dateiName({ name: "???" }) === "gruenriss-garten.json", g.dateiName(wieder));
vorher = abbild();
const zurueck = g.ausDateiText(text);
pruefe("Datei lässt sich wieder laden", zurueck.garten && !zurueck.fehler && zurueck.garten.id === wieder.id && zurueck.garten.objekte.length === 1);
pruefe("sichern und wieder laden ergibt denselben Garten", gleich(zurueck.garten, wieder) && zurueck.garten.verworfen === 0 && g.alsDateiText(zurueck.garten) === text);
pruefe("in der Datei steht kein Feld „verworfen“; das Lesen einer Datei schreibt noch nichts in den Speicher", !text.includes("verworfen") && abbild() === vorher);
const reich = rohGarten({ id: "g-reich", name: "Großer Garten", geaendert: 1234567890123, flurstuecke: [flurstueck("A", { info: "Flur 26", lage: "Mozartstraße 3", amtlicheFlaeche: 2149 }), flurstueck("B", { ring25832: null })], objekte: [flaeche(ringLL, { id: "h", typ: "haus" }), flaeche(undefined, { id: "r", typ: "rasen", multi: [[ringLL, ringLL], [ringLL]] }), kreis({ id: "b" })] });
delete reich.objekte[1].coords;
const reichZurueck = g.ausDateiText(g.alsDateiText(g.bereinigeGarten(reich))).garten;
pruefe("… auch mit mehreren Flurstücken, zusammengesetzter Fläche und Baum", gleich(reichZurueck, { ...reich, verworfen: 0 }), JSON.stringify(reichZurueck));
const ohneId = rohGarten();
delete ohneId.id;
pruefe("Datei ohne Kennung wird abgelehnt (sonst entstünde bei jedem Laden ein weiterer Garten)", g.ausDateiText(JSON.stringify(ohneId)).fehler === "Die Datei enthält keinen lesbaren Garten." && !g.ausDateiText(JSON.stringify(ohneId)).garten && /keinen lesbaren Garten/.test(g.ausDateiText(JSON.stringify(rohGarten({ id: "" }))).fehler) && /keinen lesbaren Garten/.test(g.ausDateiText(JSON.stringify(rohGarten({ id: 7 }))).fehler));
pruefe("Datei mit Kennung wird ein Garten mit genau dieser Kennung", g.ausDateiText(JSON.stringify(rohGarten({ id: "g-meiner" }))).garten.id === "g-meiner" && !g.ausDateiText(JSON.stringify(rohGarten({ id: "g-meiner" }))).fehler);
pruefe("Datei aus einer neueren Version wird mit Meldung abgelehnt", /neueren Version/.test(g.ausDateiText(JSON.stringify(rohGarten({ version: 3 }))).fehler) && !g.ausDateiText(JSON.stringify(rohGarten({ version: 3 }))).garten && /neueren Version/.test(g.ausDateiText(JSON.stringify({ format: "gruenriss-garten", version: 3 })).fehler));
pruefe("kaputter Text wird mit Meldung abgelehnt", /nicht lesen/.test(g.ausDateiText("kein json").fehler) && /nicht lesen/.test(g.ausDateiText(text.slice(0, text.length / 2)).fehler) && /nicht lesen/.test(g.ausDateiText("").fehler));
pruefe("fremde Datei wird mit Meldung abgelehnt", /keine Garten-Datei/.test(g.ausDateiText('{"a":1}').fehler) && /keine Garten-Datei/.test(g.ausDateiText("[1,2]").fehler) && /keine Garten-Datei/.test(g.ausDateiText("null").fehler) && /keine Garten-Datei/.test(g.ausDateiText('"Garten"').fehler));
pruefe("Datei ohne brauchbares Flurstück oder ohne Versionsangabe enthält keinen lesbaren Garten", /keinen lesbaren Garten/.test(g.ausDateiText(JSON.stringify({ format: "gruenriss-garten", version: 2 })).fehler) && /keinen lesbaren Garten/.test(g.ausDateiText(JSON.stringify(rohGarten({ flurstuecke: [] }))).fehler) && /keinen lesbaren Garten/.test(g.ausDateiText(JSON.stringify(rohGarten({ version: undefined }))).fehler));
const mitSchrott = g.ausDateiText(JSON.stringify(rohGarten({ objekte: [kreis({ id: "1" }), kreis({ id: "2", radius: 0 }), flaeche(ringLL, { id: "3" }), "x", kreis({ id: "4", center: [8.28, 95] })] })));
pruefe("„verworfen“ nennt die Zahl der unlesbaren Objekte der Datei", mitSchrott.garten && mitSchrott.garten.verworfen === 3 && kennungen(mitSchrott.garten.objekte) === "1,3", JSON.stringify(mitSchrott.garten && { v: mitSchrott.garten.verworfen, o: kennungen(mitSchrott.garten.objekte) }));
pruefe("… bei genau einem unlesbaren Objekt ist es 1, bei keinem 0", g.ausDateiText(JSON.stringify(rohGarten({ objekte: [kreis(), null] }))).garten.verworfen === 1 && g.ausDateiText(JSON.stringify(rohGarten({ objekte: [kreis()] }))).garten.verworfen === 0);

// -------------------------------------------------------------------------
// Speicher voll oder gesperrt
// -------------------------------------------------------------------------
const standVorher = speicher.get(GARTEN + wieder.id);
wieder.objekte.push(kreis({ id: "o2" }));
globalThis.__voll = true;
pruefe("voller Speicher wird gemeldet statt verschluckt", g.speichereGarten(wieder) === false);
pruefe("… der zuletzt gespeicherte Stand bleibt dabei erhalten", speicher.get(GARTEN + wieder.id) === standVorher && g.ladeGarten(wieder.id).objekte.length === 1);
globalThis.__voll = false;
pruefe("… sobald wieder Platz ist, klappt das Speichern", g.speichereGarten(wieder) === true && g.ladeGarten(wieder.id).objekte.length === 2);
stoerung = (was, k) => was === "schreiben" && k === GARTEN + wieder.id;
pruefe("scheitert das Schreiben nur für einen Garten, lassen sich die anderen weiter speichern", g.speichereGarten(wieder) === false && g.speichereGarten(g.neuerGarten(fl, "Nachbar")) === true);
stoerung = null;
speicher.set(ALT + K544, altPlan);
vorher = abbild();
globalThis.__gesperrt = true;
let abgestuerzt = "";
let gesperrt = null;
try {
  gesperrt = { alle: g.alleGaerten().length, einer: g.ladeGarten(wieder.id), gespeichert: g.speichereGarten(g.neuerGarten(fl, "x")), suche: g.sucheGaertenFuer(["A"]), name: g.freierName("Mozartstraße 3"), alt: g.uebernehmeAltePlaene() };
  g.loescheGarten(wieder.id);
} catch (fehler) {
  abgestuerzt = String(fehler);
}
globalThis.__gesperrt = false;
pruefe("gesperrter Speicher (z. B. privater Modus) bringt nichts zum Absturz: keine Gärten, Speichern meldet „nein“", abgestuerzt === "" && gesperrt.alle === 0 && gesperrt.einer === null && gesperrt.gespeichert === false && gesperrt.suche.genau.length === 0 && gesperrt.suche.teilweise.length === 0 && gesperrt.name === "Mozartstraße 3" && gesperrt.alt === 0, abgestuerzt || JSON.stringify(gesperrt));
pruefe("… und am Speicher ändert sich nichts", abbild() === vorher);
g.loescheGarten(neu.id);
pruefe("löschen entfernt den Garten", g.ladeGarten(neu.id) === null);

// -------------------------------------------------------------------------
// Was der Baustein nach außen anbietet
// -------------------------------------------------------------------------
pruefe("findeGartenFuer gibt es nicht mehr (ersetzt durch sucheGaertenFuer)", !("findeGartenFuer" in g) && typeof g.sucheGaertenFuer === "function");
const erwartet = ["alleGaerten", "alsDateiText", "alsGespeichertesFlurstueck", "ausDateiText", "bereinigeGarten", "dateiName", "flaecheVon", "freierName", "ladeGarten", "loescheGarten", "neuerGarten", "pruefeObjekte", "speichereGarten", "sucheGaertenFuer", "uebernehmeAltePlaene"];
pruefe("alle Funktionen, die die Oberfläche braucht, sind vorhanden", erwartet.every((name) => typeof g[name] === "function") && g.FORMAT_NAME === "gruenriss-garten" && g.FORMAT_VERSION === 2, erwartet.filter((name) => typeof g[name] !== "function").join(", "));

console.log(`\nERGEBNIS: ${ok} von ${ok + bad} Prüfungen bestanden`);
process.exit(bad ? 1 : 0);
