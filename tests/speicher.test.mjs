// =========================================================================
// Test des Speicher-Bausteins src/gaerten.js – ohne Browser
// -------------------------------------------------------------------------
// Der Speicher des Browsers (localStorage) wird hier nachgebaut. Geprüft:
// Übernahme alter Pläne, Speichern und Wiederfinden, beschädigte Einträge,
// Sichern und Laden als Datei, voller Speicher.
// Aufruf: npm test
// =========================================================================
const speicher = new Map();
globalThis.localStorage = new Proxy({
  getItem: (k) => (speicher.has(k) ? speicher.get(k) : null),
  setItem: (k, v) => { if (globalThis.__voll) throw new Error("QuotaExceededError"); speicher.set(k, String(v)); },
  removeItem: (k) => { speicher.delete(k); },
}, { ownKeys: () => [...speicher.keys()], getOwnPropertyDescriptor: (t, k) => (speicher.has(k) ? { enumerable: true, configurable: true, value: speicher.get(k) } : Reflect.getOwnPropertyDescriptor(t, k)) });
const g = await import(process.argv[2] || new URL("../src/gaerten.js", import.meta.url).href);
let ok = 0, bad = 0;
const pruefe = (name, bedingung, detail = "") => { bedingung ? ok++ : bad++; console.log((bedingung ? "OK    " : "FEHLER") + " " + name + (detail ? "  -> " + detail : "")); };
const ring = [[0, 0], [10, 0], [10, 20], [0, 20], [0, 0]];
const ringLL = [[8.28, 51.84], [8.2801, 51.84], [8.2801, 51.8401], [8.28, 51.84]];

// Alte Pläne übernehmen
speicher.set("gruenriss:plan:05254002600544______", JSON.stringify([{ id: "a", typ: "haus", art: "flaeche", coords: ringLL }, { id: "b", typ: "baum", art: "punkt", coords: [8.28, 51.84] }, null, { typ: "x" }]));
speicher.set("gruenriss:plan:05254002600271______|05254002600544______", JSON.stringify([{ id: "c", typ: "rasen", art: "flaeche", multi: [[ringLL]] }]));
speicher.set("gruenriss:plan:05254002600999______", "[]");
speicher.set("gruenriss:plan:05254002600888______", "{kaputt");
speicher.set("gruenriss:plan:default", JSON.stringify([{ id: "d", typ: "baum", art: "kreis", center: [8.28, 51.84], radius: 2 }]));
speicher.set("anderes:spiel", "bleibt");
const n = g.uebernehmeAltePlaene();
let alle = g.alleGaerten();
pruefe("2 alte Pläne mit Inhalt werden Gärten", n === 2 && alle.length === 2, `übernommen ${n}, Gärten ${alle.length}`);
const eins = alle.find((x) => x.flurstuecke.length === 1), zwei = alle.find((x) => x.flurstuecke.length === 2);
pruefe("Name aus dem Kennzeichen", eins.name === "Flurstück 544" && zwei.name === "Flurstück 271 u. a.", `${eins.name} | ${zwei.name}`);
pruefe("gültige Objekte übernommen, alter Punkt-Baum wird Kreis, Schrott fällt weg", eins.objekte.length === 2 && eins.objekte[1].art === "kreis" && eins.objekte[1].radius === 3, JSON.stringify(eins.objekte.map((o) => o.art)));
pruefe("Umriss fehlt zunächst (wird beim Öffnen nachgeladen)", eins.flurstuecke[0].ring25832 === null && g.flaecheVon(eins) === null);
pruefe("alte Einträge liegen im Archiv, nichts ist verloren", [...speicher.keys()].filter((k) => k.startsWith("gruenriss:plan:")).length === 0 && [...speicher.keys()].filter((k) => k.startsWith("gruenriss:archiv:gruenriss:plan:")).length === 5 && speicher.get("gruenriss:archiv:gruenriss:plan:05254002600888______") === "{kaputt");
pruefe("fremde Einträge bleiben unberührt", speicher.get("anderes:spiel") === "bleibt");
pruefe("zweiter Aufruf übernimmt nichts doppelt", g.uebernehmeAltePlaene() === 0 && g.alleGaerten().length === 2);

// Neuer Garten, speichern, wiederfinden
const fl = [{ id: "A", info: "Gemarkung X, Flur 1, Flurstück 5", lage: "Mozartstraße 3", amtlicheFlaeche: 201, ring25832: ring, ringLngLat: ringLL }];
const neu = g.neuerGarten(fl, "Mozartstraße 3");
neu.objekte.push({ id: "o1", typ: "baum", art: "kreis", center: [8.28, 51.84], radius: 3 });
pruefe("speichern klappt", g.speichereGarten(neu) === true);
const wieder = g.ladeGarten(neu.id);
pruefe("gespeicherter Garten kommt vollständig zurück (ohne Lat/Lon-Ballast)", wieder && wieder.name === "Mozartstraße 3" && wieder.objekte.length === 1 && wieder.flurstuecke[0].ring25832.length === 5 && !("ringLngLat" in wieder.flurstuecke[0]) && wieder.verworfen === 0);
pruefe("Fläche aus dem Umriss", g.flaecheVon(wieder) === 200);
pruefe("im Speicher steht kein Feld „verworfen“", !speicher.get("gruenriss:garten:" + neu.id).includes("verworfen"));
pruefe("Garten wird über ein gemeinsames Flurstück gefunden", g.findeGartenFuer(["A", "B"]).id === neu.id && g.findeGartenFuer(["Z"]) === null);
pruefe("der zuletzt geänderte steht vorn", g.alleGaerten()[0].id === neu.id);

// Beschädigte Einträge
speicher.set("gruenriss:garten:kaputt1", "hallo");
speicher.set("gruenriss:garten:kaputt2", JSON.stringify({ format: "gruenriss-garten", version: 2, objekte: [] }));
speicher.set("gruenriss:garten:kaputt3", JSON.stringify({ format: "gruenriss-garten", version: 99, flurstuecke: [{ id: "A" }], objekte: [] }));
speicher.set("gruenriss:garten:teil", JSON.stringify({ format: "gruenriss-garten", version: 2, id: "falsch", name: "  Teil  ", flurstuecke: [{ id: "T", ring25832: ring }, null], objekte: [{ id: "o", typ: "beet", art: "flaeche" }, { id: "p", typ: "beet", art: "flaeche", coords: ringLL }, "x"] }));
alle = g.alleGaerten();
const teil = alle.find((x) => x.name === "Teil");
pruefe("beschädigte Einträge werden übersprungen statt zu blockieren", alle.length === 4, "Gärten: " + alle.length);
pruefe("teilweise lesbarer Garten: Gutes bleibt, Unlesbares wird gezählt", teil && teil.objekte.length === 1 && teil.verworfen === 2 && teil.flurstuecke.length === 1 && teil.id === "teil", JSON.stringify(teil && { o: teil.objekte.length, v: teil.verworfen, id: teil.id }));

// Datei sichern und laden
const text = g.alsDateiText(wieder);
pruefe("Dateiname ohne Sonderzeichen", g.dateiName(wieder) === "gruenriss-mozartstrasse-3.json", g.dateiName(wieder));
const zurueck = g.ausDateiText(text);
pruefe("Datei lässt sich wieder laden", zurueck.garten && zurueck.garten.id === wieder.id && zurueck.garten.objekte.length === 1);
pruefe("fremde Datei wird mit Meldung abgelehnt", /keine Garten-Datei/.test(g.ausDateiText('{"a":1}').fehler) && /nicht lesen/.test(g.ausDateiText("kein json").fehler) && /neueren Version/.test(g.ausDateiText(JSON.stringify({ format: "gruenriss-garten", version: 3 })).fehler) && /keinen lesbaren Garten/.test(g.ausDateiText(JSON.stringify({ format: "gruenriss-garten", version: 2 })).fehler));

// Speicher voll
globalThis.__voll = true;
pruefe("voller Speicher wird gemeldet statt verschluckt", g.speichereGarten(wieder) === false);
globalThis.__voll = false;
g.loescheGarten(neu.id);
pruefe("löschen entfernt den Garten", g.ladeGarten(neu.id) === null);
console.log(`\nERGEBNIS: ${ok} von ${ok + bad} Prüfungen bestanden`);
process.exit(bad ? 1 : 0);
