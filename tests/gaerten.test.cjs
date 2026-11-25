// =========================================================================
// Browser-Test „Meine Gärten“ (Desktop + Handy-Format)
// -------------------------------------------------------------------------
// Wiederfinden nach dem Neuladen, Liste, „Weiter planen“, Sichern und Laden
// als Datei, Löschen, Übernahme alter Pläne, beschädigte Einträge,
// Speicherfehler – und alles rund um „Garten erfassen“: derselbe Garten nach
// „Schließen“, genau passender Garten, Rückfrage bei Überschneidung, Namen,
// langsames oder gestörtes Kataster, Doppelklick.
//
// Luftbild blockiert, Adresssuche nachgestellt. Das Kataster ist echt, jede
// Abfrage geht aber nur EINMAL hinaus: Die Antwort wird gemerkt und bei der
// nächsten gleichen Abfrage wieder verwendet (schont den Dienst, spart Zeit).
//
// Der Test besteht aus Teilen, jeder mit einer frischen Seite. Teil 1 geht
// den ganzen Weg wie ein Mensch und liefert dabei die Vorlage (einen echten
// Garten), aus der die übrigen Teile ihren Speicher vorab füllen.
//
// Aufruf: node tests/gaerten.test.cjs http://127.0.0.1:5173/   (siehe browser.cjs)
// Nur einzelne Teile (Teil 1 läuft immer mit): … http://127.0.0.1:5173/ 3,5
// =========================================================================
const { chromium, devices } = require('playwright');
const fs = require('fs');
const path = require('path');
// Bildschirmfotos und heruntergeladene Dateien landen in tests/ausgabe/ (nicht im Git).
const AUSGABE = path.join(__dirname, 'ausgabe');
fs.mkdirSync(AUSGABE, { recursive: true });
process.chdir(AUSGABE);
const URL_APP = process.argv[2] || 'http://127.0.0.1:5173/';
const NUR = (process.argv[3] || '').split(',').map(Number).filter(Boolean);
const NRW = { state: 'Nordrhein-Westfalen', 'ISO3166-2-lvl4': 'DE-NW' };
const ORT = (name, lat, lon) => ({ lat: String(lat), lon: String(lon), name, display_name: `${name}, Rheda, Rheda-Wiedenbrück, Kreis Gütersloh, Nordrhein-Westfalen, 33378, Deutschland`, address: { road: name, ...NRW } });
const ergebnisse = [];
const pruefe = (name, ok, detail = '') => { ergebnisse.push({ name, ok }); console.log((ok ? 'OK    ' : 'FEHLER') + ' ' + name + (detail ? '  -> ' + detail : '')); };
const warte = (ms) => new Promise((r) => setTimeout(r, ms));
const kopie = (x) => JSON.parse(JSON.stringify(x));

// Feste Klick-Stellen im Fenster 1280x800, gleich nach der Adresssuche:
const A = [640, 310]; // Flurstück 544, „Mozartstraße 3“
const B = [450, 250]; // das Nachbar-Flurstück
const FERN = [1150, 420]; // ein Flurstück knapp 100 m neben der gesuchten Adresse
const BAUM = [880, 380]; // freie Stelle auf Flurstück A für einen Baum
const ID_A = '05254002600544______';

// Texte der App, die hier wörtlich geprüft werden.
const START_HINWEIS = 'Gib deine Adresse ein, um zu starten.';
const FRAGE_TITEL = 'Hier gibt es schon einen Garten';
const FRAGE_ZEILE2 = '\nDie eingezeichneten Objekte bleiben in jedem Fall erhalten.';
const FRAGE_KNOEPFE = 'umstellen:Garten auf diese Auswahl umstellen | oeffnen:Garten unverändert öffnen | neu:Neuen Garten anlegen | abbrechen:Abbrechen';
const geladen = (name) => `„${name}“ wurde geladen. Tippe darauf, um weiterzuplanen.`;

// -------------------------------------------------------------------------
// Kataster: echte Antworten merken und wiederverwenden
// -------------------------------------------------------------------------
const katasterAntworten = new Map(); // Adresse der Abfrage -> Antwort des Dienstes (Text)
const echteAnfragen = new Set(); // Anfragen, die wirklich zum Dienst gingen
const LEERE_ANTWORT = '<?xml version="1.0" encoding="utf-8"?><wfs:FeatureCollection xmlns:wfs="http://www.opengis.net/wfs/2.0" numberReturned="0" numberMatched="unknown"></wfs:FeatureCollection>';

// Fehlermeldungen der Konsole, die zum Testaufbau gehören: Das Luftbild ist
// blockiert, die Karte meldet deshalb jede Kachel als nicht ladbar.
const harmlos = (text) => /Failed to load resource|net::ERR_/.test(text) || (/Failed to fetch/.test(text) && /maplibre/.test(text));

// -------------------------------------------------------------------------
// Eine frische Seite mit allem, was die Prüfungen brauchen
// -------------------------------------------------------------------------
async function neueSeite(browser, optionen = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, acceptDownloads: true, ...optionen });
  const page = await ctx.newPage();
  page.setDefaultTimeout(12000); // hängt ein Schritt, soll der Test nicht lange warten

  // Fehler der Seite: jeder zählt am Ende des Teils als gescheiterte Prüfung.
  // „erlaubt“ nimmt Muster für Konsolen-Fehler auf, die ein Teil absichtlich
  // auslöst (z. B. ein gestörtes Kataster).
  page.fehler = [];
  page.erlaubt = [];
  page.on('pageerror', (e) => page.fehler.push('Seitenfehler: ' + e.message));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const text = m.text();
    if (harmlos(text) || page.erlaubt.some((muster) => muster.test(text))) return;
    page.fehler.push('Konsole: ' + text.split('\n')[0].slice(0, 200));
  });

  // Rückfragen des Browsers („OK / Abbrechen“): Nur eine angekündigte wird
  // beantwortet (siehe mitAntwort). Jede andere gilt als Fehler und wird
  // weggeklickt, damit der Test nicht hängen bleibt.
  page.antwort = null;
  page.gefragt = '';
  page.on('dialog', async (d) => {
    const antwort = page.antwort;
    page.antwort = null;
    if (antwort) page.gefragt = d.message();
    else page.fehler.push(`Unerwartetes Browser-Fenster (${d.type()}): ${d.message()}`);
    try { if (antwort === 'ja') await d.accept(); else await d.dismiss(); } catch (e) { /* Seite schon zu */ }
  });

  // Luftbild blockieren, Adresssuche nachstellen.
  await page.route('**/www.wms.nrw.de/**', (r) => r.abort());
  await page.route('**/nominatim.openstreetmap.org/**', (r) => r.fulfill({ contentType: 'application/json', body: JSON.stringify([ORT('Mozartstraße', 51.8487816, 8.2891470)]) }));

  // Kataster: page.wfs zählt, was die App fragt. page.kataster stellt ein, wie
  // geantwortet wird: „echt“ (gemerkte oder echte Antwort), „abbruch“ (Dienst
  // nicht erreichbar) oder „leer“ (Dienst kennt das Flurstück nicht);
  // warteMs verzögert die Antwort.
  page.wfs = [];
  page.kataster = { modus: 'echt', warteMs: 0 };
  page.on('response', async (antwort) => {
    const adresse = antwort.url();
    if (!echteAnfragen.has(antwort.request()) || antwort.status() !== 200 || katasterAntworten.has(adresse)) return;
    try { katasterAntworten.set(adresse, await antwort.text()); } catch (e) { /* Seite schon zu */ }
  });
  await page.route('**/www.wfs.nrw.de/**', async (route) => {
    const adresse = route.request().url();
    page.wfs.push(adresse);
    const { modus, warteMs } = page.kataster;
    try {
      if (modus === 'abbruch') return await route.abort();
      if (modus === 'leer') return await route.fulfill({ status: 200, contentType: 'text/xml', body: LEERE_ANTWORT });
      if (warteMs) await warte(warteMs);
      const bekannt = katasterAntworten.get(adresse);
      if (bekannt) return await route.fulfill({ status: 200, contentType: 'text/xml', body: bekannt });
      echteAnfragen.add(route.request());
      await route.continue();
    } catch (e) { /* Seite inzwischen geschlossen */ }
  });

  // Am Handy tippen, am Desktop klicken.
  const handy = !!optionen.hasTouch;
  page.tippe = (sel) => (handy ? page.tap(sel) : page.click(sel));
  page.tippeAuf = (x, y) => (handy ? page.touchscreen.tap(x, y) : page.mouse.click(x, y));

  // Kleine Abfragen der Oberfläche.
  page.text = (sel) => page.evaluate((s) => (document.querySelector(s) || {}).innerText || '', sel);
  page.anzahl = (sel) => page.evaluate((s) => [...document.querySelectorAll(s)].filter((e) => e.getClientRects().length).length, sel);
  page.sichtbar = (sel) => page.evaluate((s) => { const e = document.querySelector(s); return !!e && e.getClientRects().length > 0; }, sel);
  page.hat = (sel, attribut) => page.evaluate(([s, a]) => document.querySelector(s).hasAttribute(a), [sel, attribut]);
  page.hinweis = async () => ({ text: (await page.text('#search-hint')).trim(), fehler: await page.evaluate(() => document.getElementById('search-hint').classList.contains('is-error')), sichtbar: await page.sichtbar('#search-hint') });
  // Etiketten auf der Karte: jedes Objekt trägt eines (Klasse „--wert“), jede
  // Grundstücksseite eines, dazu eines für die Gesamtfläche („--flaeche“).
  page.objekte = () => page.anzahl('.masslabel--wert');
  page.seiten = () => page.anzahl('.masslabel:not(.masslabel--wert):not(.masslabel--flaeche)');
  page.lageVon = (sel) => page.evaluate((s) => [...document.querySelectorAll(s)].map((m) => { const r = m.getBoundingClientRect(); return [Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2)]; }), sel);
  page.etiketten = () => page.lageVon('.masslabel');
  page.mitte = (sel) => page.evaluate((s) => { const r = document.querySelector(s).getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; }, sel);
  page.warteAufEditor = async () => { await page.waitForFunction(() => !document.getElementById('ed-toolbar').hidden); await page.waitForTimeout(700); };

  // Der Speicher des Browsers.
  page.gaerten = () => page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('gruenriss:garten:')).map((k) => { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } }).filter(Boolean));
  page.eintrag = (id) => page.evaluate((k) => localStorage.getItem(k), 'gruenriss:garten:' + id);
  page.garten = async (id) => JSON.parse((await page.eintrag(id)) || 'null');
  page.speicher = () => page.evaluate(() => JSON.stringify(Object.keys(localStorage).filter((k) => k.startsWith('gruenriss:')).sort().map((k) => [k, localStorage.getItem(k)])));
  page.setzeGaerten = (gaerten) => page.evaluate((liste) => { for (const k of Object.keys(localStorage)) if (k.startsWith('gruenriss:garten:')) localStorage.removeItem(k); for (const g of liste) localStorage.setItem('gruenriss:garten:' + g.id, JSON.stringify(g)); }, gaerten);

  // Das Rückfrage-Fenster der App (<dialog id="rueckfrage">).
  page.frage = () => page.evaluate(() => { const f = document.getElementById('rueckfrage'); return { offen: f.open, titel: document.getElementById('rueckfrage-titel').textContent, text: document.getElementById('rueckfrage-text').textContent, knoepfe: [...document.querySelectorAll('#rueckfrage-knoepfe button')].map((b) => ({ wert: b.dataset.wert, text: b.textContent.trim(), haupt: b.classList.contains('btn--primary') })) }; });
  page.frageMasse = () => page.evaluate(() => {
    const fenster = document.getElementById('rueckfrage'); const f = fenster.getBoundingClientRect(); const w = window.innerWidth; const h = window.innerHeight;
    const knoepfe = [...document.querySelectorAll('#rueckfrage-knoepfe button')].map((b) => b.getBoundingClientRect());
    const ganzSichtbar = (r) => r.width > 0 && r.left >= Math.max(0, f.left) && r.right <= Math.min(w, f.right) && r.top >= Math.max(0, f.top) && r.bottom <= Math.min(h, f.bottom);
    return { fenster: [f.left, f.top, f.right, f.bottom].map(Math.round), bildschirm: [w, h], imBild: f.left >= 0 && f.top >= 0 && f.right <= w && f.bottom <= h, knoepfeGanzSichtbar: knoepfe.filter(ganzSichtbar).length, kleinsterKnopf: Math.round(Math.min(...knoepfe.map((r) => r.height))), ohneQuerRollen: document.documentElement.scrollWidth <= w && fenster.scrollWidth <= fenster.clientWidth };
  });
  return page;
}

// Füllt den Speicher, bevor die Seite zum ersten Mal lädt (nicht noch einmal
// beim Neuladen). „weitere“: zusätzliche Einträge als { Schlüssel: Text }.
async function saeen(page, gaerten, weitere = {}) {
  await page.addInitScript(([liste, sonst]) => {
    if (localStorage.getItem('test:gesaet')) return;
    localStorage.setItem('test:gesaet', '1');
    for (const g of liste) localStorage.setItem('gruenriss:garten:' + g.id, JSON.stringify(g));
    for (const [schluessel, wert] of Object.entries(sonst)) localStorage.setItem(schluessel, wert);
  }, [gaerten, weitere]);
}

// Etwas tun, das eine Rückfrage des Browsers („OK / Abbrechen“) auslöst, und
// sie mit „ja“ oder „nein“ beantworten. Rückgabe: der Text der Rückfrage
// ("" = es kam keine).
async function mitAntwort(page, antwort, aktion) {
  page.antwort = antwort; page.gefragt = '';
  await aktion(); await page.waitForTimeout(500);
  page.antwort = null;
  return page.gefragt;
}

// Nach der Wahl einer Adresse fliegt die Karte dorthin. Fertig ist der Flug,
// wenn die Stecknadel in der Bildmitte steht und sich nicht mehr bewegt.
// Erst dann passen die festen Klick-Stellen.
async function warteAufFlug(page) {
  const bild = page.viewportSize();
  const beginn = Date.now(); let zuletzt = ''; let ruhigSeit = Date.now();
  while (Date.now() - beginn < 12000) {
    const ort = await page.evaluate(() => { const m = document.querySelector('.marker'); if (!m) return ''; const r = m.getBoundingClientRect(); return Math.round((r.left + r.width / 2) * 10) + ',' + Math.round(r.bottom * 10); });
    if (ort !== zuletzt) { zuletzt = ort; ruhigSeit = Date.now(); }
    const [x, y] = ort.split(',').map((zahl) => zahl / 10);
    const inDerMitte = Math.abs(x - bild.width / 2) < 1.5 && Math.abs(y - bild.height / 2) < 1.5;
    if (inDerMitte && Date.now() - ruhigSeit > 800) break;
    await page.waitForTimeout(100);
  }
  await page.waitForTimeout(400);
}

// Adresse suchen und den Treffer wählen.
async function sucheAdresse(page) {
  await page.fill('#search-input', 'Mozartstraße'); await page.waitForSelector('.results__item'); await page.tippe('.results__item');
  await warteAufFlug(page);
}

// Der echte Dienst antwortet gelegentlich einmal nicht. Das ist kein Fehler
// der App: Der Schritt wird dann (wie von einem Menschen) wiederholt, und die
// Fehlermeldungen dieses einen Versuchs zählen nicht.
let katasterAussetzer = 0;
function verzeiheAussetzer(page) {
  katasterAussetzer++;
  console.log('      (Kataster antwortete nicht – zweiter Versuch)');
  page.fehler = page.fehler.filter((f) => !/wfs\.nrw\.de|Failed to fetch/.test(f));
}

// „Grundstück auswählen“ und die Flurstücke an den Klick-Stellen antippen.
async function tippeFlurstuecke(page, stellen) {
  await page.tippe('#gp-aktion'); await page.waitForTimeout(600);
  for (let i = 0; i < stellen.length; i++) {
    for (let versuch = 1; versuch <= 2; versuch++) {
      await page.tippeAuf(stellen[i][0], stellen[i][1]);
      // Antwort des Katasters abwarten (beim ersten Mal echt, dann gemerkt).
      const antwort = await page.waitForFunction((n) => { const t = document.getElementById('gp-text').textContent; return t.startsWith(n + ' Flurstück') ? 'gewaehlt' : /nicht erreichbar/.test(t) ? 'gestoert' : false; }, i + 1).then((wert) => wert.jsonValue(), () => '');
      if (antwort !== 'gestoert' || versuch === 2) break;
      verzeiheAussetzer(page);
      await page.waitForTimeout(2000);
    }
    await page.waitForTimeout(300);
  }
}

// … und mit „OK, übernehmen“ bestätigen: Danach bietet das Bedienfeld „Garten erfassen“ an.
async function waehle(page, stellen) {
  await tippeFlurstuecke(page, stellen);
  await page.tippe('#gp-aktion'); await page.waitForTimeout(700);
}

// Editor schließen und mit „Neu beginnen“ zurück vor die Grundstückswahl.
async function neuBeginnen(page) {
  await page.click('#ed-close'); await page.waitForTimeout(600);
  await page.click('#gp-zurueck'); await page.waitForTimeout(600);
}

// Einen Baum setzen (ein Objekt mehr im Plan).
async function setzeBaum(page, stelle = BAUM) {
  await page.click('.chip[data-typ="baum"]'); await page.mouse.click(stelle[0], stelle[1]); await page.waitForTimeout(400);
  await page.click('#ed-confirm'); await page.waitForTimeout(300);
}

// Was zeigt die Karte? Aus einem Bildschirmfoto (Fenster 1280x800) gezählt:
// die Bildpunkte in Rasen-Grün – und ob am linken und rechten Kartenrand Weiß
// liegt (Umgebung ausgeblendet) oder das Hellgrau der freien Karte.
async function kartenbild(page) {
  const foto = (await page.screenshot()).toString('base64');
  return page.evaluate(async (b64) => {
    const bild = new Image(); bild.src = 'data:image/png;base64,' + b64; await bild.decode();
    const flaeche = document.createElement('canvas'); flaeche.width = bild.width; flaeche.height = bild.height;
    const stift = flaeche.getContext('2d'); stift.drawImage(bild, 0, 0);
    const d = stift.getImageData(0, 0, bild.width, bild.height).data;
    let rasen = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i] > 185 && d[i] < 205 && d[i + 1] > 211 && d[i + 1] < 231 && d[i + 2] > 169 && d[i + 2] < 189 && d[i + 1] - d[i] > 15) rasen++;
    const punkt = (x, y) => [0, 1, 2].map((k) => d[(y * bild.width + x) * 4 + k]);
    const rand = [punkt(15, 300), punkt(bild.width - 15, 300)];
    return { rasen, randWeiss: rand.every((p) => p.every((v) => v >= 254)), randFrei: rand.every((p) => Math.abs(p[0] - 245) <= 2 && Math.abs(p[1] - 246) <= 2 && Math.abs(p[2] - 247) <= 2) };
  }, foto);
}

// Sucht im Rechteck (dort stand eben noch der Listeneintrag) eine Stelle, an
// der im geöffneten Garten ein Objekt liegt: Ein Tipp dorthin wählt es aus.
// Rückgabe: [x, y] oder null.
async function findeObjektStelle(page, r) {
  for (const hoehe of [0.5, 0.85, 0.15]) {
    for (const breite of [0.5, 0.7, 0.3, 0.85, 0.15]) {
      const x = Math.round(r.x + r.width * breite); const y = Math.round(r.y + r.height * hoehe);
      await page.tippeAuf(x, y); await page.waitForTimeout(400);
      if (await page.sichtbar('#ed-delete')) { await page.tippe('#ed-confirm'); await page.waitForTimeout(300); return [x, y]; }
    }
  }
  return null;
}

// Liegen die Etiketten an denselben Stellen (auf 1 Bildpunkt genau)?
const gleicheLage = (a, b) => a.length > 0 && a.length === b.length && a.every((p, i) => Math.abs(p[0] - b[i][0]) <= 1 && Math.abs(p[1] - b[i][1]) <= 1);

(async () => {
  const browser = await chromium.launch();
  const ordner = path.join(AUSGABE, 'downloads'); fs.mkdirSync(ordner, { recursive: true });
  const schreibeDatei = (name, inhalt) => { const pfad = path.join(ordner, name); fs.writeFileSync(pfad, typeof inhalt === 'string' ? inhalt : JSON.stringify(inhalt, null, 2)); return pfad; };
  const JETZT = Date.now(); const STUNDE = 3600000;

  // Einen Teil ausführen: frische Seite, Ablauf, am Ende die Fehler der Seite
  // als eigene Prüfung. Bricht ein Ablauf ab, laufen die übrigen Teile weiter.
  async function teil(nr, name, optionen, ablauf) {
    if (nr !== 1 && NUR.length && !NUR.includes(nr)) return;
    console.log(`\n--- Teil ${nr}: ${name} ---`);
    const page = await neueSeite(browser, optionen);
    try {
      await ablauf(page);
    } catch (e) {
      pruefe(`Teil ${nr} läuft ohne Abbruch durch`, false, String(e && e.message ? e.message : e).split('\n')[0]);
      await page.screenshot({ path: `abbruch-teil-${nr}.png` }).catch(() => {});
    }
    await page.waitForTimeout(500).catch(() => {}); // auch späte Fehler noch mitnehmen
    pruefe(`Teil ${nr}: keine Fehler auf der Seite, kein unerwartetes Browser-Fenster`, page.fehler.length === 0, page.fehler.join(' | '));
    await page.context().close();
  }

  // Die Vorlage aus Teil 1 – für die Teile, die ihren Speicher vorab füllen.
  let gartenA = null; // echter Garten auf Flurstück A: 8 erkannte Objekte + 1 Baum
  let flurA = null; // Flurstück A, wie es gespeichert wird (mit Umriss)
  let flurB = null; // das Nachbar-Flurstück
  let datei = ''; // mit „Als Datei sichern“ heruntergeladene Datei (A + B, 10 Objekte)
  let lageAusListe = []; // wo die Grundstücks-Etiketten liegen, wenn Garten A aus der Liste geöffnet wird
  const GRUNDSTUECK = '.masslabel:not(.masslabel--wert)'; // Seitenlängen und Gesamtfläche
  const flurOhneUmriss = () => ({ id: ID_A, info: '', lage: '', amtlicheFlaeche: null, ring25832: null });

  // =======================================================================
  // Teil 1: der ganze Weg am Desktop, echt bedient
  // =======================================================================
  await teil(1, 'der ganze Weg (Desktop)', {}, async (page) => {
    // ---- A/B: erster Besuch, Plan anlegen ----
    await page.goto(URL_APP); await page.waitForTimeout(1200);
    pruefe('A Erster Besuch: keine Gartenliste, Knopf bietet „Garten aus Datei laden“', !(await page.sichtbar('#gaerten')) && (await page.text('#gaerten-knopf')) === 'Garten aus Datei laden');
    await sucheAdresse(page); await waehle(page, [A]);
    await page.click('#gp-aktion'); await page.warteAufEditor();
    pruefe('B Nur ansehen legt noch keinen Garten an', (await page.gaerten()).length === 0);
    for (let versuch = 1; versuch <= 2; versuch++) {
      await page.click('#ed-auto');
      await page.waitForFunction(() => /erkannt|gefunden|nicht möglich/.test(document.getElementById('ed-hint').textContent)); await page.waitForTimeout(500);
      if (!/nicht möglich/.test(await page.text('#ed-hint')) || versuch === 2) break;
      verzeiheAussetzer(page); await page.waitForTimeout(2000);
    }
    let g = await page.gaerten();
    pruefe('B Mit dem ersten Objekt wird der Garten gespeichert (Name = amtliche Lage, Umriss, Objekte)', g.length === 1 && g[0].format === 'gruenriss-garten' && g[0].version === 2 && g[0].name === 'Mozartstraße 3' && g[0].flurstuecke.length === 1 && g[0].flurstuecke[0].id === ID_A && g[0].flurstuecke[0].ring25832.length >= 4 && g[0].flurstuecke[0].amtlicheFlaeche === 2149 && g[0].objekte.length === 8, g.length ? `${g[0].name} | ${g[0].objekte.length} Objekte | amtlich ${g[0].flurstuecke[0].amtlicheFlaeche} m²` : 'kein Garten');
    pruefe('B Alte Schlüssel werden nicht mehr geschrieben', (await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('gruenriss:plan:')).length)) === 0);
    const gartenName = g[0].name;
    await setzeBaum(page);
    gartenA = (await page.gaerten())[0]; flurA = gartenA.flurstuecke[0];

    // ---- O: „Schließen“ und gleich wieder „Garten erfassen“ ----
    await page.click('#ed-close'); await page.waitForTimeout(600);
    let vorher = await page.speicher(); let wfsVor = page.wfs.length;
    await page.click('#gp-aktion'); await page.warteAufEditor();
    pruefe('O Nach „Schließen“ führt „Garten erfassen“ in denselben Garten zurück – ohne Rückfrage, ohne Kataster', (await page.sichtbar('#ed-toolbar')) && !(await page.frage()).offen && (await page.objekte()) === 9 && !(await page.sichtbar('#ed-auto')) && (await page.speicher()) === vorher && page.wfs.length === wfsVor, `Objekte auf der Karte ${await page.objekte()}`);

    // ---- C: Neuladen -> Weiter planen ----
    await page.reload(); await page.waitForTimeout(1500);
    pruefe('C Nach dem Neuladen steht der Garten in „Meine Gärten“', (await page.sichtbar('#gaerten')) && (await page.anzahl('.garten')) === 1 && (await page.text('.garten__name')) === gartenName, await page.text('.garten__info'));
    pruefe('C Beschreibung nennt Fläche, Objektzahl und Datum', /2\.146 m² · 9 Objekte · geändert am \d{1,2}\.\d{1,2}\.\d{4}/.test(await page.text('.garten__info')), await page.text('.garten__info'));
    wfsVor = page.wfs.length;
    await page.click('.garten__oeffnen'); await page.warteAufEditor(); await page.waitForTimeout(800);
    pruefe('C Ein Tipp öffnet den Garten im Editor – ohne Kataster-Abfrage', (await page.sichtbar('#ed-toolbar')) && !(await page.sichtbar('.search')) && page.wfs.length === wfsVor && (await page.anzahl('.masslabel')) >= 18, `Etiketten ${await page.anzahl('.masslabel')}, Abfragen ${page.wfs.length - wfsVor}`);
    pruefe('C „Automatisch erfassen“ wird nicht erneut angeboten (Plan ist nicht leer)', !(await page.sichtbar('#ed-auto')));
    // Liegt das Grundstück sichtbar über der Werkzeugleiste?
    const lage = await page.evaluate(() => { const t = document.getElementById('ed-toolbar').getBoundingClientRect(); const e = [...document.querySelectorAll('.masslabel')].map((m) => m.getBoundingClientRect()); return { leisteOben: Math.round(t.top), etikettenUnten: Math.round(Math.max(...e.map((r) => r.bottom))), etikettenOben: Math.round(Math.min(...e.map((r) => r.top))), links: Math.round(Math.min(...e.map((r) => r.left))), rechts: Math.round(Math.max(...e.map((r) => r.right))) }; });
    pruefe('C Karte ist auf das Grundstück eingepasst (ganz sichtbar über der Leiste)', lage.etikettenUnten <= lage.leisteOben + 12 && lage.etikettenOben >= 0 && lage.links >= 0 && lage.rechts <= 1280, JSON.stringify(lage));
    lageAusListe = await page.lageVon(GRUNDSTUECK);
    await page.screenshot({ path: 'g1-weiter-planen.png' });
    // Weiterarbeiten wird gespeichert
    await setzeBaum(page, [640, 300]);
    pruefe('C Änderungen im wieder geöffneten Garten werden gespeichert', (await page.gaerten())[0].objekte.length === 10);

    // ---- D: Schließen -> Liste wieder erreichbar ----
    await page.click('#ed-close'); await page.waitForTimeout(400);
    pruefe('D Nach „Schließen“: Name im Suchfeld, Knopf „Meine Gärten“ sichtbar, Liste zu', (await page.inputValue('#search-input')) === gartenName && (await page.sichtbar('#gaerten-knopf')) && (await page.text('#gaerten-knopf')) === 'Meine Gärten' && !(await page.sichtbar('#gaerten')));
    await page.click('#gaerten-knopf'); await page.waitForTimeout(300);
    pruefe('D Knopf blendet die Liste ein', (await page.sichtbar('#gaerten')) && /10 Objekte/.test(await page.text('.garten__info')), await page.text('.garten__info'));
    await page.fill('#search-input', 'Moz'); await page.waitForTimeout(200);
    pruefe('D Tippen einer Adresse blendet die Liste aus', !(await page.sichtbar('#gaerten')));
    await page.waitForSelector('.results__item');
    pruefe('D Bei Suchtreffern sind Liste und Knopf verborgen', !(await page.sichtbar('#gaerten')) && !(await page.sichtbar('#gaerten-knopf')));

    // ---- E: ein Flurstück mehr als bisher -> Rückfrage ----
    await page.click('.results__item'); await warteAufFlug(page);
    await tippeFlurstuecke(page, [A, B]);
    pruefe('E Zwei Flurstücke gewählt', /2 Flurstücke gewählt/.test(await page.text('#gp-text')), await page.text('#gp-text'));
    await page.click('#gp-aktion'); await page.waitForTimeout(700); // OK, übernehmen
    vorher = await page.speicher();
    await page.click('#gp-aktion'); await page.waitForTimeout(700); // Garten erfassen
    let f = await page.frage();
    pruefe('E Auswahl mit einem Flurstück mehr: Die App fragt nach (Titel, Text mit den richtigen Zahlen)', f.offen && f.titel === FRAGE_TITEL && f.text === `Der Garten „${gartenName}“ umfasst bisher 1 Flurstück – jetzt sind 2 gewählt.` + FRAGE_ZEILE2 && !(await page.sichtbar('#ed-toolbar')), `${f.titel} | ${f.text.replace(/\n/g, ' / ')}`);
    pruefe('E Rückfrage bietet vier Antworten, „Abbrechen“ zuletzt; empfohlen (grün) ist das Umstellen', f.knoepfe.map((k) => k.wert + ':' + k.text).join(' | ') === FRAGE_KNOEPFE && f.knoepfe.filter((k) => k.haupt).map((k) => k.wert).join() === 'umstellen', f.knoepfe.map((k) => k.wert + (k.haupt ? '*' : '')).join(', '));
    let masse = await page.frageMasse();
    pruefe('E Rückfrage liegt ganz im Bild, alle vier Knöpfe sind zu sehen', masse.imBild && masse.knoepfeGanzSichtbar === 4 && masse.ohneQuerRollen, JSON.stringify(masse));
    await page.screenshot({ path: 'g4-rueckfrage.png' });
    const umstellenKnopf = await page.mitte('#rueckfrage [data-wert="umstellen"]');
    await page.click('#rueckfrage [data-wert="abbrechen"]'); await page.waitForTimeout(500);
    const unveraendert = async () => !(await page.frage()).offen && (await page.speicher()) === vorher && !(await page.sichtbar('#ed-toolbar')) && (await page.sichtbar('#gp-aktion')) && (await page.text('#gp-aktion')) === 'Garten erfassen';
    pruefe('E „Abbrechen“: nichts geändert, das Bedienfeld bietet weiter „Garten erfassen“', await unveraendert(), await page.text('#gp-text'));
    await page.click('#gp-aktion'); await page.waitForTimeout(700);
    const offenVorEsc = (await page.frage()).offen;
    await page.keyboard.press('Escape'); await page.waitForTimeout(500);
    pruefe('E Esc-Taste: Rückfrage schließt sich, nichts geändert, weiter „Garten erfassen“', offenVorEsc && (await unveraendert()));
    // Ein Klick gleich nach dem Erscheinen (zweiter Teil eines Doppelklicks) zählt noch nicht.
    await page.click('#gp-aktion');
    const beginn = Date.now();
    await page.mouse.click(umstellenKnopf[0], umstellenKnopf[1]);
    const dauer = Date.now() - beginn;
    await page.waitForTimeout(150);
    pruefe('E Klick auf eine Antwort in den ersten 400 ms nach dem Erscheinen zählt nicht', dauer < 300 && (await page.frage()).offen && (await page.speicher()) === vorher, `Klick ${dauer} ms nach dem Öffnen`);
    await page.waitForTimeout(600);
    await page.click('#rueckfrage [data-wert="umstellen"]'); await page.warteAufEditor();
    g = await page.gaerten();
    pruefe('E „Garten auf diese Auswahl umstellen“: derselbe Garten, jetzt mit 2 Flurstücken und allen Objekten – kein zweiter Garten', (await page.sichtbar('#ed-toolbar')) && g.length === 1 && g[0].id === gartenA.id && g[0].flurstuecke.length === 2 && g[0].objekte.length === 10 && (await page.objekte()) === 10 && (await page.seiten()) === 16 && !(await page.sichtbar('#ed-auto')), `Gärten ${g.length}, Flurstücke ${g[0].flurstuecke.length}, Objekte ${g[0].objekte.length}`);
    flurB = g[0].flurstuecke.find((x) => x.id !== ID_A);
    await page.click('#ed-close'); await page.waitForTimeout(400);

    // ---- F: Als Datei sichern ----
    await page.fill('#search-input', ''); await page.click('#gaerten-knopf'); await page.waitForTimeout(300);
    const [download] = await Promise.all([page.waitForEvent('download'), page.click('.garten__aktion--sichern')]);
    datei = path.join(ordner, download.suggestedFilename()); await download.saveAs(datei);
    const inhalt = JSON.parse(fs.readFileSync(datei, 'utf8'));
    pruefe('F „Als Datei sichern“ lädt eine lesbare Garten-Datei herunter', /^gruenriss-mozartstrasse.*\.json$/.test(download.suggestedFilename()) && inhalt.format === 'gruenriss-garten' && inhalt.objekte.length === 10 && inhalt.flurstuecke.length === 2 && !('verworfen' in inhalt), download.suggestedFilename());

    // ---- G: Löschen mit Rückfrage – der Garten liegt dabei noch auf der Karte ----
    let gefragt = await mitAntwort(page, 'nein', () => page.click('.garten__aktion--loeschen'));
    let bild = await kartenbild(page);
    pruefe('G Löschen: „Abbrechen“ in der Rückfrage lässt den Garten stehen – im Speicher und auf der Karte', /wirklich löschen/.test(gefragt) && (await page.gaerten()).length === 1 && (await page.anzahl('.garten')) === 1 && (await page.anzahl('.masslabel')) >= 20 && bild.randWeiss && bild.rasen > 5000, `${gefragt} | Rasen-Bildpunkte ${bild.rasen}`);
    gefragt = await mitAntwort(page, 'ja', () => page.click('.garten__aktion--loeschen'));
    pruefe('G Löschen nach Bestätigung entfernt den Garten, Knopf bietet wieder das Laden an', /wirklich löschen/.test(gefragt) && (await page.gaerten()).length === 0 && !(await page.sichtbar('#gaerten')) && (await page.text('#gaerten-knopf')) === 'Garten aus Datei laden', gefragt);
    bild = await kartenbild(page);
    let h = await page.hinweis();
    pruefe('G Der gelöschte Garten verschwindet auch von der Karte: keine Etiketten, keine Objekte, Umgebung nicht mehr ausgeblendet', (await page.anzahl('.masslabel')) === 0 && bild.rasen < 50 && bild.randFrei, `Etiketten ${await page.anzahl('.masslabel')}, Rasen-Bildpunkte ${bild.rasen}, Rand frei: ${bild.randFrei}`);
    pruefe('G … das Bedienfeld bietet „Grundstück auswählen“, das Suchfeld ist leer, darunter steht der Start-Hinweis', (await page.sichtbar('#gp-aktion')) && (await page.text('#gp-aktion')) === 'Grundstück auswählen' && !(await page.sichtbar('#ed-toolbar')) && (await page.inputValue('#search-input')) === '' && h.sichtbar && h.text === START_HINWEIS && !h.fehler, `Knopf „${await page.text('#gp-aktion')}“ | Hinweis „${h.text}“`);
    await page.click('#gp-aktion'); await page.waitForTimeout(700); // „Grundstück auswählen“ – der alte Garten darf nicht wiederkommen
    pruefe('G … und wird danach nicht wieder gespeichert', (await page.gaerten()).length === 0 && !(await page.sichtbar('#ed-toolbar')) && /Tippe auf dein Grundstück/.test(await page.text('#gp-text')), await page.text('#gp-text'));
    await page.click('#gp-zurueck'); await page.waitForTimeout(600);

    // ---- H: Aus Datei laden ----
    await page.setInputFiles('#gaerten-datei', datei); await page.waitForTimeout(500);
    h = await page.hinweis();
    pruefe('H Gesicherte Datei laden: Garten steht wieder in der Liste', (await page.gaerten()).length === 1 && (await page.anzahl('.garten')) === 1 && h.text === geladen(gartenName) && !h.fehler, h.text);
    wfsVor = page.wfs.length;
    await page.click('.garten__oeffnen'); await page.warteAufEditor(); await page.waitForTimeout(800);
    pruefe('H Der geladene Garten lässt sich öffnen (beide Flurstücke, alle Objekte)', (await page.sichtbar('#ed-toolbar')) && (await page.seiten()) === 16 && (await page.objekte()) === 10 && page.wfs.length === wfsVor, `Seiten ${await page.seiten()}, Objekte ${await page.objekte()}`);
    await page.click('#ed-close'); await page.waitForTimeout(300);
    // Der kleine Knopf „Weiter planen“ öffnet denselben Garten
    await page.fill('#search-input', ''); await page.click('#gaerten-knopf'); await page.waitForTimeout(300);
    await page.click('.garten__aktion--weiter'); await page.warteAufEditor();
    pruefe('H Auch der Knopf „Weiter planen“ öffnet den Garten', (await page.sichtbar('#ed-toolbar')) && (await page.anzahl('.masslabel')) >= 20);
    await page.click('#ed-close'); await page.waitForTimeout(300);

    // ---- I: fremde Datei; vorhandenen Garten ersetzen (er liegt auf der Karte) ----
    await page.fill('#search-input', ''); await page.click('#gaerten-knopf'); await page.waitForTimeout(300);
    vorher = await page.speicher();
    await page.setInputFiles('#gaerten-datei', schreibeDatei('falsch.json', '{"irgendwas": true}')); await page.waitForTimeout(400);
    pruefe('I Fremde Datei wird mit Meldung abgelehnt', /keine Garten-Datei/.test(await page.text('#search-hint')) && (await page.speicher()) === vorher, await page.text('#search-hint'));
    // Dieselbe Kennung, anderer Stand (nur 2 Objekte): erst nach Rückfrage ersetzen.
    const andererStand = schreibeDatei('anderer-stand.json', { ...inhalt, objekte: inhalt.objekte.slice(0, 2) });
    const etikettenVorher = await page.anzahl('.masslabel');
    gefragt = await mitAntwort(page, 'nein', () => page.setInputFiles('#gaerten-datei', andererStand));
    pruefe('I Vorhandener Garten: Die App fragt, bevor sie ersetzt – „Abbrechen“ lässt Speicher und Karte, wie sie sind', gefragt === `Den Garten „${gartenName}“ gibt es hier schon. Durch den Stand aus der Datei ersetzen?` && (await page.speicher()) === vorher && (await page.anzahl('.masslabel')) === etikettenVorher && etikettenVorher >= 20, gefragt || 'keine Rückfrage');
    gefragt = await mitAntwort(page, 'ja', () => page.setInputFiles('#gaerten-datei', andererStand));
    g = await page.gaerten(); h = await page.hinweis();
    pruefe('I … nach Bestätigung gilt der Stand aus der Datei (2 Objekte)', /gibt es hier schon/.test(gefragt) && g.length === 1 && g[0].id === inhalt.id && g[0].objekte.length === 2 && g[0].flurstuecke.length === 2 && g[0].name === gartenName && h.text === geladen(gartenName) && /2 Objekte/.test(await page.text('.garten__info')), `${g[0].objekte.length} Objekte | ${h.text}`);
    bild = await kartenbild(page);
    pruefe('I Der ersetzte Garten verschwindet von der Karte (sein alter Stand gilt nicht mehr): keine Etiketten, „Grundstück auswählen“, Suchfeld leer', (await page.anzahl('.masslabel')) === 0 && bild.rasen < 50 && bild.randFrei && (await page.sichtbar('#gp-aktion')) && (await page.text('#gp-aktion')) === 'Grundstück auswählen' && (await page.inputValue('#search-input')) === '' && !(await page.sichtbar('#ed-toolbar')), `Etiketten ${await page.anzahl('.masslabel')}, Rasen-Bildpunkte ${bild.rasen}, Knopf „${await page.text('#gp-aktion')}“`);
    vorher = await page.speicher();
    await page.click('#gp-aktion'); await page.waitForTimeout(700);
    pruefe('I … und überschreibt den geladenen Stand nicht wieder', (await page.speicher()) === vorher && !(await page.sichtbar('#ed-toolbar')));
  });

  // Gärten für die folgenden Teile, aus der Vorlage gebaut.
  const garten = (id, name, stundenHer, aenderungen = {}) => ({ ...kopie(gartenA), id, name, geaendert: JETZT - stundenHer * STUNDE, ...kopie(aenderungen) });

  // =======================================================================
  // Teil 2: Rückfrage – „Neuen Garten anlegen“ und „Garten unverändert öffnen“
  // =======================================================================
  await teil(2, 'Rückfrage: neuer Garten, unverändert öffnen', {}, async (page) => {
    const eins = garten('g-eins', 'Mozartstraße 3', 2);
    await saeen(page, [eins]);
    await page.goto(URL_APP); await page.waitForTimeout(1200);
    await sucheAdresse(page); await waehle(page, [A, B]);
    let vorher = await page.speicher();
    await page.click('#gp-aktion'); await page.waitForTimeout(700);
    const offen = (await page.frage()).offen;
    await page.click('#rueckfrage [data-wert="neu"]'); await page.warteAufEditor();
    pruefe('P „Neuen Garten anlegen“: leerer Editor für die Auswahl, gespeichert wird noch nichts', offen && (await page.sichtbar('#ed-toolbar')) && (await page.objekte()) === 0 && (await page.sichtbar('#ed-auto')) && (await page.seiten()) === 16 && (await page.speicher()) === vorher);
    await setzeBaum(page);
    let g = await page.gaerten(); const neu = g.find((x) => x.id !== 'g-eins');
    pruefe('P Mit dem ersten Objekt entsteht ein zweiter Garten mit eigener Kennung und eigenem Namen „… (2)“; der alte bleibt unberührt', g.length === 2 && !!neu && neu.name === 'Mozartstraße 3 (2)' && neu.flurstuecke.map((x) => x.id).sort().join() === [ID_A, flurB.id].sort().join() && neu.objekte.length === 1 && (await page.eintrag('g-eins')) === JSON.stringify(eins), neu ? `${neu.id} | ${neu.name} | ${neu.flurstuecke.length} Flurstücke` : 'kein neuer Garten');

    // Noch einmal von vorn, mit einem Garten aus drei Flurstücken: zwei davon sind gewählt.
    await neuBeginnen(page);
    const drei = garten('g-drei', 'Großer Garten', 2, { flurstuecke: [flurA, flurB, { ...flurB, id: '05254002600999______' }] });
    await page.setzeGaerten([drei]);
    await waehle(page, [A, B]);
    await page.click('#gp-aktion'); await page.waitForTimeout(700);
    const f = await page.frage();
    pruefe('P Zwei von drei Flurstücken eines Gartens gewählt: Rückfrage nennt beide Zahlen, empfohlen ist das unveränderte Öffnen', f.offen && f.text === 'Der Garten „Großer Garten“ umfasst 3 Flurstücke – jetzt sind nur 2 davon gewählt.' + FRAGE_ZEILE2 && f.knoepfe.filter((k) => k.haupt).map((k) => k.wert).join() === 'oeffnen', f.text.replace(/\n/g, ' / '));
    await page.click('#rueckfrage [data-wert="abbrechen"]'); await page.waitForTimeout(500);

    // Speicher wieder wie am Anfang (nur der Garten {A}): „Garten unverändert öffnen“.
    await page.setzeGaerten([eins]);
    vorher = await page.speicher();
    await page.click('#gp-aktion'); await page.waitForTimeout(700);
    await page.click('#rueckfrage [data-wert="oeffnen"]'); await page.warteAufEditor(); await page.waitForTimeout(800);
    const lage = await page.lageVon(GRUNDSTUECK);
    pruefe('Q „Garten unverändert öffnen“: Editor mit dem Garten wie gespeichert – 1 Flurstück auf der Karte, Speicher unverändert', (await page.sichtbar('#ed-toolbar')) && !(await page.frage()).offen && (await page.speicher()) === vorher && (await page.objekte()) === 9 && (await page.seiten()) === 9 && (await page.text('.masslabel--flaeche')) === '2.146 m²' && /^1 Flurstück übernommen/.test(await page.text('#gp-text')), `Seiten ${await page.seiten()}, Objekte ${await page.objekte()}, Fläche ${await page.text('.masslabel--flaeche')}`);
    pruefe('Q … wie aus der Liste geöffnet: Name im Suchfeld, Karte genauso auf den Garten eingepasst', (await page.inputValue('#search-input')) === 'Mozartstraße 3' && gleicheLage(lageAusListe, lage), `erstes Etikett ${lageAusListe[0]} / ${lage[0]}, Anzahl ${lageAusListe.length} / ${lage.length}`);
  });

  // =======================================================================
  // Teil 3: zwei Gärten teilen sich ein Flurstück ({A} und {A, B})
  // =======================================================================
  await teil(3, 'zwei Gärten mit gemeinsamem Flurstück', {}, async (page) => {
    // {A} ist der ältere; er kennt Lage und amtliche Fläche noch nicht und trägt
    // nur einen Platzhalter-Namen. {A, B} gibt es zweimal – einer davon wurde
    // zuletzt geändert.
    const eins = garten('g-eins', 'Mein Garten (2)', 2, { flurstuecke: [{ ...flurA, lage: '', amtlicheFlaeche: null }] });
    const beide = garten('g-beide', 'Beide Grundstücke', 1, { flurstuecke: [flurA, flurB], objekte: gartenA.objekte.slice(0, 3) });
    const beideAlt = garten('g-beide-alt', 'Beide Grundstücke, älterer Plan', 3, { flurstuecke: [flurA, flurB], objekte: gartenA.objekte.slice(0, 5) });
    await saeen(page, [eins, beide, beideAlt]);
    await page.goto(URL_APP); await page.waitForTimeout(1200);
    await sucheAdresse(page); await waehle(page, [A]);
    await page.click('#gp-aktion'); await page.warteAufEditor();
    let e = await page.garten('g-eins');
    pruefe('R Nur A gewählt: Es öffnet sich der Garten {A} – ohne Rückfrage; der Garten {A, B} bleibt unberührt', (await page.sichtbar('#ed-toolbar')) && !(await page.frage()).offen && (await page.objekte()) === 9 && (await page.eintrag('g-beide')) === JSON.stringify(beide) && e.flurstuecke.map((x) => x.id).join() === ID_A && JSON.stringify(e.objekte) === JSON.stringify(eins.objekte), `Objekte auf der Karte ${await page.objekte()} (Garten {A}: 9, Garten {A, B}: 3)`);
    pruefe('R Die gespeicherten Angaben zum Flurstück werden dabei aufgefrischt (Lage, amtliche Fläche); der Platzhalter-Name „Mein Garten (2)“ weicht der Lagebezeichnung', e.flurstuecke[0].lage === 'Mozartstraße 3' && e.flurstuecke[0].amtlicheFlaeche === 2149 && JSON.stringify(e.flurstuecke[0].ring25832) === JSON.stringify(flurA.ring25832) && e.name === 'Mozartstraße 3', `${e.name} | ${e.flurstuecke[0].lage} | ${e.flurstuecke[0].amtlicheFlaeche}`);
    await setzeBaum(page);
    e = await page.garten('g-eins');
    pruefe('R Eine Änderung landet im Garten {A}, nicht im anderen', e.objekte.length === 10 && e.flurstuecke.length === 1 && (await page.eintrag('g-beide')) === JSON.stringify(beide));

    // Werkzeugleiste: Ein Klick gleich nach dem Öffnen (zweiter Teil eines Doppelklicks) zählt noch nicht.
    const schliessen = await page.mitte('#ed-close');
    await page.click('#ed-close'); await page.waitForTimeout(600);
    await page.click('#gp-aktion');
    const beginn = Date.now();
    await page.mouse.click(schliessen[0], schliessen[1]);
    const dauer = Date.now() - beginn;
    await page.waitForTimeout(200);
    pruefe('S Klick auf die Werkzeugleiste in den ersten 400 ms nach dem Öffnen zählt nicht (hier: „Schließen“)', dauer < 300 && (await page.sichtbar('#ed-toolbar')) && !(await page.sichtbar('#gp-panel')), `Klick ${dauer} ms nach dem Öffnen`);
    await page.waitForTimeout(600);
    await page.click('.chip[data-typ="baum"]'); await page.waitForTimeout(200);
    pruefe('S Danach reagiert die Werkzeugleiste wieder', await page.evaluate(() => document.querySelector('.chip[data-typ="baum"]').classList.contains('is-active')));
    await page.click('#ed-cancel'); await page.waitForTimeout(200);

    // A und B gewählt: der Garten {A, B}.
    await neuBeginnen(page);
    await waehle(page, [A, B]);
    const einsVorher = await page.eintrag('g-eins');
    await page.click('#gp-aktion'); await page.warteAufEditor();
    pruefe('R A und B gewählt: Es öffnet sich der zuletzt geänderte Garten {A, B} – ohne Rückfrage; die anderen Gärten bleiben unberührt', (await page.sichtbar('#ed-toolbar')) && !(await page.frage()).offen && (await page.objekte()) === 3 && (await page.seiten()) === 16 && (await page.eintrag('g-eins')) === einsVorher && (await page.eintrag('g-beide')) === JSON.stringify(beide) && (await page.eintrag('g-beide-alt')) === JSON.stringify(beideAlt), `Objekte auf der Karte ${await page.objekte()} (zuletzt geändert: 3, älterer Plan: 5)`);
    await setzeBaum(page);
    const b = await page.garten('g-beide');
    pruefe('R Eine Änderung landet in diesem Garten', b.objekte.length === 4 && b.flurstuecke.length === 2 && (await page.eintrag('g-eins')) === einsVorher && (await page.eintrag('g-beide-alt')) === JSON.stringify(beideAlt));

    // B und ein fremdes Flurstück: weder mehr noch weniger, sondern „zum Teil andere“.
    await neuBeginnen(page);
    await waehle(page, [B, FERN]);
    const vorher = await page.speicher();
    await page.click('#gp-aktion'); await page.waitForTimeout(700);
    const f = await page.frage();
    pruefe('T Auswahl mit zum Teil anderen Flurstücken: Rückfrage zum ähnlichsten Garten, empfohlen ist das unveränderte Öffnen', f.offen && f.text === 'Der Garten „Beide Grundstücke“ umfasst zum Teil andere Flurstücke als die jetzt gewählten.' + FRAGE_ZEILE2 && f.knoepfe.filter((k) => k.haupt).map((k) => k.wert).join() === 'oeffnen' && (await page.speicher()) === vorher, f.text.replace(/\n/g, ' / '));
    await page.click('#rueckfrage [data-wert="abbrechen"]'); await page.waitForTimeout(400);
  });

  // =======================================================================
  // Teil 4: Garten, der sich nicht speichern lässt; Namen neuer Gärten
  // =======================================================================
  await teil(4, 'Speicher gesperrt, Namen', {}, async (page) => {
    await page.addInitScript(() => {
      // Das Kataster nennt hier keine Lagebezeichnung (kommt bei echten Flurstücken vor).
      const echtesFetch = window.fetch;
      window.fetch = async (...angaben) => {
        const antwort = await echtesFetch(...angaben);
        if (!String(angaben[0]).includes('wfs.nrw.de')) return antwort;
        return new Response((await antwort.text()).replace(/<lagebeztxt>[^<]*<\/lagebeztxt>/g, ''), { status: antwort.status });
      };
      // Gärten lassen sich nicht speichern, solange der Schalter an ist.
      const echtesSetzen = Storage.prototype.setItem;
      window.speicherGesperrt = true;
      Storage.prototype.setItem = function (schluessel, wert) {
        if (window.speicherGesperrt && String(schluessel).startsWith('gruenriss:garten:')) throw new DOMException('voll', 'QuotaExceededError');
        return echtesSetzen.call(this, schluessel, wert);
      };
    });
    await page.goto(URL_APP); await page.waitForTimeout(1200);
    await sucheAdresse(page); await waehle(page, [A]);
    // Nach der Adresswahl steht etwas ganz anderes im Suchfeld.
    await page.fill('#search-input', 'Bei Oma Erna'); await page.waitForSelector('.results__item');
    await page.click('#gp-aktion'); await page.warteAufEditor();
    await setzeBaum(page);
    pruefe('U Speichern schlägt fehl: Warnung in der Werkzeugleiste, im Speicher steht nichts', (await page.sichtbar('#ed-warnung')) && /nicht gespeichert/.test(await page.text('#ed-warnung')) && (await page.gaerten()).length === 0 && (await page.objekte()) === 1);
    await page.click('#ed-close'); await page.waitForTimeout(600);
    await page.click('#gp-aktion'); await page.warteAufEditor();
    pruefe('U „Schließen“ + „Garten erfassen“ mit ungespeichertem Garten: Der Baum ist noch da, die Warnung auch – kein leerer Neuanfang', (await page.sichtbar('#ed-toolbar')) && !(await page.frage()).offen && (await page.objekte()) === 1 && (await page.sichtbar('#ed-warnung')) && !(await page.sichtbar('#ed-auto')) && (await page.gaerten()).length === 0, `Objekte auf der Karte ${await page.objekte()}, Warnung sichtbar: ${await page.sichtbar('#ed-warnung')}`);
    await page.evaluate(() => { window.speicherGesperrt = false; });
    await setzeBaum(page, [900, 330]);
    let g = await page.gaerten();
    pruefe('U Klappt das Speichern wieder, ist alles gesichert und die Warnung weg', g.length === 1 && g[0].objekte.length === 2 && !(await page.sichtbar('#ed-warnung')), g.length ? `${g[0].objekte.length} Objekte` : 'kein Garten');
    pruefe('V Name ohne amtliche Lage: die gewählte Adresse („Mozartstraße“) – nicht der Text, der gerade im Suchfeld steht', g.length === 1 && g[0].name === 'Mozartstraße' && g[0].flurstuecke[0].lage === '', g.length ? `Name „${g[0].name}“, im Suchfeld steht „${await page.inputValue('#search-input')}“` : 'kein Garten');

    // Die Karte weit zur Seite schieben und dort ein Grundstück wählen (rund
    // 200 m von der gesuchten Adresse): Ihr Name passt dort nicht mehr.
    await neuBeginnen(page);
    await page.mouse.move(1000, 480); await page.mouse.down(); await page.mouse.move(400, 480, { steps: 12 }); await page.waitForTimeout(400); await page.mouse.up(); await page.waitForTimeout(800);
    await waehle(page, [FERN]);
    await page.click('#gp-aktion'); await page.warteAufEditor();
    await setzeBaum(page, [640, 300]);
    g = await page.gaerten(); const fern = g.find((x) => x.flurstuecke[0].id !== ID_A);
    pruefe('V Grundstück weit abseits der gesuchten Adresse, ohne amtliche Lage: „Mein Garten“', g.length === 2 && !!fern && fern.name === 'Mein Garten' && fern.flurstuecke[0].lage === '', fern ? `Name „${fern.name}“ (${fern.flurstuecke[0].info})` : 'kein zweiter Garten');
  });

  // =======================================================================
  // Teil 5: Öffnen aus der Liste – Doppelklick, gestörtes und langsames Kataster
  // =======================================================================
  await teil(5, 'Öffnen aus der Liste', {}, async (page) => {
    const baum = gartenA.objekte.find((o) => o.art === 'kreis');
    const voll = garten('g-voll', 'Mozartstraße 3', 1);
    // „Omas Garten“ fehlt der Umriss: Beim Öffnen muss das Kataster gefragt werden.
    const ohne = garten('g-ohne', 'Omas Garten', 2, { flurstuecke: [flurOhneUmriss()], objekte: [baum, { ...baum, id: 'baum-2', center: [baum.center[0] - 0.0002, baum.center[1]] }] });
    await saeen(page, [voll, ohne]);
    await page.goto(URL_APP); await page.waitForTimeout(1200);
    const eintragVoll = page.locator('.garten__oeffnen', { hasText: 'Mozartstraße 3' });
    const eintragOhne = page.locator('.garten__oeffnen', { hasText: 'Omas Garten' });

    // ---- Doppelklick auf den Listeneintrag ----
    let r = await eintragVoll.boundingBox();
    await page.mouse.click(r.x + r.width / 2, r.y + r.height / 2); await page.warteAufEditor(); await page.waitForTimeout(800);
    const einfach = await page.etiketten();
    const stelle = await findeObjektStelle(page, r);
    pruefe('W Aufbau: Wo eben der Listeneintrag stand, liegt im geöffneten Garten ein Objekt (dort landet der zweite Klick)', !!stelle, stelle ? stelle.join(', ') : 'keine Stelle gefunden');
    await page.reload(); await page.waitForTimeout(1500);
    r = await eintragVoll.boundingBox();
    if (!stelle) throw new Error('Ohne passende Stelle lässt sich der Doppelklick nicht prüfen.');
    const imEintrag = stelle[0] > r.x && stelle[0] < r.x + r.width && stelle[1] > r.y && stelle[1] < r.y + r.height;
    // Doppelklick wie von Hand: zwei Klicks kurz nacheinander an derselben Stelle.
    await page.mouse.click(stelle[0], stelle[1]); await warte(150); await page.mouse.click(stelle[0], stelle[1], { clickCount: 2 });
    await page.warteAufEditor(); await page.waitForTimeout(800);
    const doppelt = await page.etiketten();
    pruefe('W Doppelklick auf den Listeneintrag öffnet den Garten – die Karte zoomt nicht (gleiches Bild wie nach einem einfachen Klick)', imEintrag && (await page.sichtbar('#ed-toolbar')) && gleicheLage(einfach, doppelt), `Etiketten ${einfach.length} / ${doppelt.length}, erstes ${einfach[0]} / ${doppelt[0]}`);
    pruefe('W … und der zweite Klick wählt kein Objekt aus (keine Griffe, kein „Löschen“)', (await page.anzahl('.ed-griff')) === 0 && !(await page.sichtbar('#ed-delete')) && !(await page.sichtbar('#ed-confirm')), `Griffe ${await page.anzahl('.ed-griff')}`);
    await page.click('#ed-close'); await page.waitForTimeout(600);

    // Stand vor den gescheiterten Versuchen: „Mozartstraße 3“ liegt (geschlossen) auf der Karte.
    await page.click('#gaerten-knopf'); await page.waitForTimeout(300);
    const stand = async () => JSON.stringify({ etiketten: await page.etiketten(), text: await page.text('#gp-text'), knopf: await page.text('#gp-aktion'), feld: await page.sichtbar('#gp-panel'), eingabe: await page.inputValue('#search-input'), leiste: await page.sichtbar('#ed-toolbar'), liste: await page.anzahl('.garten'), speicher: await page.speicher() });
    const vorher = await stand();
    const frei = async () => !(await page.hat('.search', 'inert')) && !(await page.hat('#gp-panel', 'inert')) && !(await page.sichtbar('#search-spinner'));

    // ---- Kataster nicht erreichbar ----
    page.kataster.modus = 'abbruch'; page.erlaubt.push(/Failed to fetch/);
    await eintragOhne.click(); await page.waitForTimeout(1500);
    let h = await page.hinweis();
    pruefe('M Kataster nicht erreichbar: Meldung; Karte, Bedienfeld, Liste und Speicher bleiben, wie sie waren', h.text === 'Der Garten lässt sich gerade nicht öffnen (Kataster-Dienst nicht erreichbar).' && h.fehler && (await stand()) === vorher && /"leiste":false/.test(vorher) && /"knopf":"Garten erfassen"/.test(vorher) && /"liste":2/.test(vorher) && (await frei()), h.text);

    // ---- Kataster antwortet, kennt das Flurstück aber nicht mehr ----
    page.kataster.modus = 'leer'; page.erlaubt.push(/Flurstück nicht gefunden/);
    await eintragOhne.click(); await page.waitForTimeout(1500);
    h = await page.hinweis();
    pruefe('M Flurstück im Kataster nicht mehr vorhanden: eigene Meldung statt „nicht erreichbar“; sonst bleibt alles, wie es war', h.text === 'Das Flurstück dieses Gartens ist im Kataster nicht mehr zu finden – der Garten lässt sich so nicht öffnen.' && h.fehler && (await stand()) === vorher && (await frei()), h.text);

    // ---- Kataster antwortet erst nach 3 Sekunden ----
    page.kataster.modus = 'echt'; page.kataster.warteMs = 3000;
    let wfsVor = page.wfs.length;
    const loeschen = await page.mitte('.garten__aktion--loeschen');
    await eintragOhne.click(); await page.waitForTimeout(700);
    h = await page.hinweis();
    pruefe('X Während ein Garten geöffnet wird: Suchleiste samt Liste und Bedienfeld sind gesperrt, der Hinweis sagt „Garten wird geöffnet …“', (await page.hat('.search', 'inert')) && (await page.hat('#gp-panel', 'inert')) && h.text === 'Garten wird geöffnet …' && !h.fehler && (await page.sichtbar('#search-spinner')) && !(await page.sichtbar('#ed-toolbar')), h.text);
    // Ein Klick auf „Löschen“ in dieser Zeit bewirkt nichts (eine Rückfrage des Browsers gälte als Fehler).
    await page.mouse.click(loeschen[0], loeschen[1]); await page.waitForTimeout(300);
    pruefe('X Ein Klick auf „Löschen“ in der Liste bewirkt in dieser Zeit nichts', (await stand()) === vorher && page.fehler.length === 0, page.fehler.join(' | '));
    await page.warteAufEditor(); await page.waitForTimeout(500);
    let o = await page.garten('g-ohne');
    pruefe('X Danach ist der Garten offen und sein Umriss gespeichert (eine Kataster-Abfrage); sein eigener Name bleibt', (await page.sichtbar('#ed-toolbar')) && (await page.objekte()) === 2 && (await page.seiten()) === 9 && o.flurstuecke.length === 1 && Array.isArray(o.flurstuecke[0].ring25832) && o.flurstuecke[0].ring25832.length >= 4 && o.flurstuecke[0].lage === 'Mozartstraße 3' && o.name === 'Omas Garten' && o.objekte.length === 2 && page.wfs.length - wfsVor === 1 && /flst-by-kennzeichen/.test(page.wfs.at(-1)) && (await page.eintrag('g-voll')) === JSON.stringify(voll) && (await frei()), `${o.name} | Umriss ${o.flurstuecke[0].ring25832 ? o.flurstuecke[0].ring25832.length + ' Punkte' : 'fehlt'} | Abfragen ${page.wfs.length - wfsVor}`);
    await page.click('#ed-close'); await page.waitForTimeout(600);

    // ---- Der Garten wird gelöscht, während das Kataster noch antwortet (z. B. in einem zweiten Fenster) ----
    await page.setzeGaerten([voll, ohne]);
    await page.fill('#search-input', ''); await page.click('#gaerten-knopf'); await page.waitForTimeout(300);
    await eintragOhne.click(); await page.waitForTimeout(800);
    await page.evaluate(() => localStorage.removeItem('gruenriss:garten:g-ohne'));
    await page.waitForTimeout(3200); // bis die verzögerte Antwort des Katasters sicher da ist
    h = await page.hinweis();
    pruefe('Y Inzwischen gelöschter Garten: Er wird nicht geöffnet und entsteht nicht wieder; Meldung, Liste aufgefrischt', !(await page.sichtbar('#ed-toolbar')) && (await page.eintrag('g-ohne')) === null && (await page.gaerten()).length === 1 && h.text === 'Diesen Garten gibt es nicht mehr.' && h.fehler && (await page.anzahl('.garten')) === 1 && (await frei()), `${h.text} | Gärten im Speicher ${(await page.gaerten()).length}`);

    // ---- Der Garten bekommt in der Wartezeit andere Flurstücke ----
    await page.setzeGaerten([voll, ohne]);
    await page.fill('#search-input', 'x'); await page.fill('#search-input', ''); await page.click('#gaerten-knopf'); await page.waitForTimeout(300); // Liste neu aufbauen
    const geaendert = { ...ohne, flurstuecke: [flurOhneUmriss(), flurB] };
    await eintragOhne.click(); await page.waitForTimeout(800);
    await page.evaluate((g) => localStorage.setItem('gruenriss:garten:g-ohne', JSON.stringify(g)), geaendert);
    await page.waitForTimeout(3200); // bis die verzögerte Antwort des Katasters sicher da ist
    h = await page.hinweis();
    pruefe('Y Inzwischen geänderter Garten: Er wird nicht mit dem alten Stand geöffnet oder überschrieben; Meldung', !(await page.sichtbar('#ed-toolbar')) && (await page.eintrag('g-ohne')) === JSON.stringify(geaendert) && h.text === 'Dieser Garten wurde inzwischen geändert – bitte noch einmal antippen.' && h.fehler && (await frei()), h.text);

    // ---- In der Wartezeit wird eine Adresse gewählt ----
    // Die Sperre verhindert das; ältere Browser kennen sie aber nicht. Darum
    // lösen wir Suche und Wahl hier per Skript aus – an der Sperre vorbei.
    await page.setzeGaerten([voll, ohne]);
    await page.fill('#search-input', 'x'); await page.fill('#search-input', ''); await page.click('#gaerten-knopf'); await page.waitForTimeout(300);
    const speicherVorher = await page.speicher();
    await eintragOhne.click(); await page.waitForTimeout(500);
    await page.evaluate(() => { const feld = document.getElementById('search-input'); feld.value = 'Mozartstraße'; feld.dispatchEvent(new Event('input', { bubbles: true })); });
    await page.waitForFunction(() => !!document.querySelector('.results__item'));
    await page.evaluate(() => document.querySelector('.results__item').click());
    await page.waitForTimeout(3200); // bis die verzögerte Antwort des Katasters sicher da ist
    h = await page.hinweis();
    pruefe('Y Inzwischen gewählte Adresse: Das verspätete Öffnen fällt weg – die neue Adresse gilt, nichts wird gespeichert', !(await page.sichtbar('#ed-toolbar')) && (await page.inputValue('#search-input')) === 'Mozartstraße' && (await page.sichtbar('#gp-aktion')) && (await page.text('#gp-aktion')) === 'Grundstück auswählen' && h.text === 'Gefunden. Wähle als Nächstes dein Grundstück aus.' && (await page.anzahl('.masslabel')) === 0 && (await page.speicher()) === speicherVorher && (await frei()), `Suchfeld „${await page.inputValue('#search-input')}“ | Knopf „${await page.text('#gp-aktion')}“ | ${h.text}`);
    page.kataster.warteMs = 0;
  });

  // =======================================================================
  // Teil 6: Dateien laden – unlesbare Objekte, fehlende Kennung, gleiche Namen
  // =======================================================================
  await teil(6, 'Dateien laden', {}, async (page) => {
    const baum = gartenA.objekte.find((o) => o.art === 'kreis');
    const haus = gartenA.objekte.find((o) => o.art === 'flaeche' && o.coords);
    const voll = garten('g-voll', 'Mozartstraße 3', 1);
    await saeen(page, [voll]);
    await page.goto(URL_APP); await page.waitForTimeout(1200);

    // 4 lesbare Objekte (eines mit offenem Umriss, zwei mit derselben Kennung) und 3 unlesbare.
    const teilweise = schreibeDatei('teilweise-lesbar.json', { format: 'gruenriss-garten', version: 2, id: 'g-datei-1', name: 'Aus der Datei', geaendert: JETZT - STUNDE, flurstuecke: [flurA], objekte: [
      { ...baum, id: 'gut' },
      { ...haus, id: 'offen', coords: haus.coords.slice(0, -1) }, // Schlusspunkt fehlt
      { ...baum, id: 'breite', center: [baum.center[0], 95] }, // Breite außerhalb des Gradnetzes
      { ...baum, id: 'radius', radius: 0 },
      { id: 'wolke', typ: 'baum', art: 'wolke' }, // unbekannte Art
      { ...baum, id: 'doppelt', center: [baum.center[0] + 0.0001, baum.center[1]] },
      { ...baum, id: 'doppelt', center: [baum.center[0] + 0.0002, baum.center[1]] },
    ] });
    await page.setInputFiles('#gaerten-datei', teilweise); await page.waitForTimeout(500);
    let g = await page.garten('g-datei-1'); let h = await page.hinweis();
    pruefe('Z Datei mit 3 unlesbaren Objekten: Garten wird ohne sie geladen, die Meldung nennt die Zahl', !!g && g.objekte.length === 4 && h.text === geladen('Aus der Datei') + ' 3 Objekte der Datei waren nicht lesbar und wurden ausgelassen.' && !h.fehler && (await page.anzahl('.garten')) === 2, h.text);
    const offen = g && g.objekte.find((o) => o.id === 'offen');
    pruefe('Z Dabei bekommt jedes Objekt eine eigene Kennung, ein offener Umriss wird geschlossen', !!g && new Set(g.objekte.map((o) => o.id)).size === 4 && !!offen && offen.coords.length === haus.coords.length && offen.coords[0].join() === offen.coords.at(-1).join(), g ? g.objekte.map((o) => o.id).join(', ') : '');
    await page.click('.garten__oeffnen:has-text("Aus der Datei")'); await page.warteAufEditor(); await page.waitForTimeout(500);
    pruefe('Z Der geladene Garten öffnet sich fehlerfrei mit seinen 4 Objekten', (await page.sichtbar('#ed-toolbar')) && (await page.objekte()) === 4 && page.fehler.length === 0, `Objekte auf der Karte ${await page.objekte()} ${page.fehler.join(' | ')}`);
    await page.click('#ed-close'); await page.waitForTimeout(400);

    // Anderer Garten (andere Kennung), aber derselbe Name wie ein vorhandener; 1 unlesbares Objekt.
    const gleicherName = schreibeDatei('gleicher-name.json', { format: 'gruenriss-garten', version: 2, id: 'g-datei-2', name: 'Mozartstraße 3', geaendert: JETZT - STUNDE, flurstuecke: [flurA], objekte: [{ ...baum, id: 'gut' }, { ...baum, id: 'laenge', center: [181, baum.center[1]] }] });
    await page.setInputFiles('#gaerten-datei', gleicherName); await page.waitForTimeout(500);
    g = await page.garten('g-datei-2'); h = await page.hinweis();
    pruefe('Z Datei mit schon vergebenem Namen: Der geladene Garten heißt „… (2)“; die Meldung nennt 1 ausgelassenes Objekt', !!g && g.name === 'Mozartstraße 3 (2)' && g.objekte.length === 1 && h.text === geladen('Mozartstraße 3 (2)') + ' 1 Objekt der Datei war nicht lesbar und wurde ausgelassen.' && (await page.eintrag('g-voll')) === JSON.stringify(voll), h.text);
    const gefragt = await mitAntwort(page, 'ja', () => page.setInputFiles('#gaerten-datei', gleicherName));
    g = await page.garten('g-datei-2');
    pruefe('Z Dieselbe Datei noch einmal (nach Rückfrage): kein weiterer Garten, kein „(3)“', /„Mozartstraße 3 \(2\)“ gibt es hier schon/.test(gefragt) && (await page.gaerten()).length === 3 && g.name === 'Mozartstraße 3 (2)', gefragt || 'keine Rückfrage');

    // Datei ohne Kennung.
    const vorher = await page.speicher();
    const ohneKennung = kopie(voll); delete ohneKennung.id;
    await page.setInputFiles('#gaerten-datei', schreibeDatei('ohne-kennung.json', ohneKennung)); await page.waitForTimeout(500);
    h = await page.hinweis();
    pruefe('Z Datei ohne Kennung wird mit Meldung abgelehnt (sonst entstünde bei jedem Laden ein weiterer Garten)', h.text === 'Die Datei enthält keinen lesbaren Garten.' && h.fehler && (await page.speicher()) === vorher, h.text);
  });

  // =======================================================================
  // Teil 7: alte Pläne übernehmen, beschädigte Einträge, Speicherfehler
  // =======================================================================
  await teil(7, 'alte Pläne, beschädigte Einträge, Speicherfehler', {}, async (page) => {
    await saeen(page, [], {
      'gruenriss:plan:05254002600544______': JSON.stringify([{ id: 'alt1', typ: 'baum', art: 'kreis', center: [8.28975, 51.84905], radius: 4 }, { id: 'alt2', typ: 'baum', art: 'punkt', coords: [8.2899, 51.8491] }]),
      'gruenriss:garten:kaputt': '{das ist kein json',
      'gruenriss:garten:halb': JSON.stringify({ format: 'gruenriss-garten', version: 2, name: 'Halb lesbar', flurstuecke: [{ id: ID_A }], objekte: [{ id: 'x', typ: 'beet', art: 'flaeche' }, { id: 'y', typ: 'baum', art: 'kreis', center: [8.2897, 51.8490], radius: 2 }] }),
    });
    await page.goto(URL_APP); await page.waitForTimeout(1500);
    const namen = await page.$$eval('.garten__name', (els) => els.map((e) => e.innerText));
    pruefe('J Alter Plan erscheint als Garten „Flurstück 544“; beschädigter Eintrag stört nicht', namen.includes('Flurstück 544') && namen.includes('Halb lesbar') && namen.length === 2 && (await page.evaluate(() => !!localStorage.getItem('gruenriss:archiv:gruenriss:plan:05254002600544______') && !localStorage.getItem('gruenriss:plan:05254002600544______'))), namen.join(' | '));
    const wfsVor = page.wfs.length;
    await page.click('.garten__oeffnen:has-text("Flurstück 544")'); await page.warteAufEditor(); await page.waitForTimeout(500);
    const g = (await page.gaerten()).find((x) => x && x.objekte && x.objekte.length === 2 && x.flurstuecke[0].ring25832);
    pruefe('J Öffnen holt den Umriss einmal vom Kataster, benennt den Garten nach der Lage und zeigt die Objekte', (await page.sichtbar('#ed-toolbar')) && page.wfs.length - wfsVor === 1 && /flst-by-kennzeichen/.test(page.wfs.at(-1)) && !!g && g.name === 'Mozartstraße 3' && g.id === 'g-alt-05254002600544______' && g.objekte.every((o) => o.art === 'kreis') && (await page.objekte()) === 2, g ? `${g.name} | Abfragen ${page.wfs.length - wfsVor}` : 'nicht gefunden');
    await page.click('#ed-close'); await page.waitForTimeout(300);
    await page.fill('#search-input', ''); await page.click('#gaerten-knopf'); await page.waitForTimeout(300);
    await page.click('.garten__oeffnen:has-text("Halb lesbar")'); await page.warteAufEditor(); await page.waitForTimeout(500);
    pruefe('K Teilweise lesbarer Garten öffnet sich und meldet das ausgelassene Objekt', (await page.sichtbar('#ed-toolbar')) && /1 Objekt dieses Plans war nicht lesbar/.test(await page.text('#ed-hint')) && (await page.objekte()) === 1, await page.text('#ed-hint'));

    // ---- L: Speichern schlägt fehl ----
    await page.evaluate(() => { Storage.prototype.setItem = function () { throw new DOMException('voll', 'QuotaExceededError'); }; });
    await page.click('.chip[data-typ="baum"]'); await page.mouse.click(640, 300); await page.waitForTimeout(400);
    pruefe('L Speicherfehler: Warnung in der Werkzeugleiste', (await page.sichtbar('#ed-warnung')) && /nicht gespeichert/.test(await page.text('#ed-warnung')), await page.text('#ed-warnung'));
    await page.click('#ed-confirm'); await page.waitForTimeout(300);
    await page.click('#ed-close'); await page.waitForTimeout(600);
    await page.click('#gp-aktion'); await page.warteAufEditor();
    pruefe('L Nach „Schließen“ + „Garten erfassen“ liegt der nicht gespeicherte Baum noch auf der Karte, die Warnung steht noch da', (await page.sichtbar('#ed-toolbar')) && (await page.objekte()) === 2 && (await page.sichtbar('#ed-warnung')) && !(await page.frage()).offen, `Objekte auf der Karte ${await page.objekte()}, Warnung sichtbar: ${await page.sichtbar('#ed-warnung')}`);
  });

  // =======================================================================
  // Teil 8: Handy
  // =======================================================================
  await teil(8, 'Handy', { ...devices['iPhone 13'] }, async (p) => {
    const bild = p.viewportSize();
    const gesichert = JSON.parse(fs.readFileSync(datei, 'utf8')); // A + B, 10 Objekte
    const LANG = 'Ein Garten mit einem wirklich sehr langen Namen, der nicht in eine Zeile passt';
    const zwei = { ...gesichert, id: 'g-zwei', name: LANG, geaendert: JETZT - STUNDE };
    await saeen(p, [{ ...gesichert, geaendert: JETZT - 2 * STUNDE }, zwei]);
    await p.goto(URL_APP); await p.waitForTimeout(1500);
    const breite = await p.evaluate(() => ({ seite: document.documentElement.scrollWidth, fenster: window.innerWidth, liste: Math.round(document.getElementById('gaerten').getBoundingClientRect().right), knoepfe: [...document.querySelectorAll('.garten__aktion')].map((b) => Math.round(b.getBoundingClientRect().height)) }));
    pruefe('N Handy: Liste passt in die Breite, nichts ragt hinaus', breite.seite <= breite.fenster && breite.liste <= breite.fenster && (await p.locator('.garten').count()) === 2, JSON.stringify(breite));
    await p.screenshot({ path: 'g2-handy-liste.png' });
    let r = await p.locator('.garten__oeffnen').first().boundingBox();
    await p.tap('.garten__oeffnen >> nth=0'); await p.warteAufEditor(); await p.waitForTimeout(800);
    const handy = await p.evaluate(() => { const t = document.getElementById('ed-toolbar').getBoundingClientRect(); const e = [...document.querySelectorAll('.masslabel')].map((m) => m.getBoundingClientRect()); return { leiste: t.height > 0, leisteOben: Math.round(t.top), etiketten: e.length, unten: Math.round(Math.max(...e.map((r) => r.bottom))), oben: Math.round(Math.min(...e.map((r) => r.top))) }; });
    pruefe('N Handy: Tipp öffnet den Garten, Grundstück liegt über der Werkzeugleiste', handy.leiste && handy.etiketten >= 20 && handy.unten <= handy.leisteOben + 14 && handy.oben >= 0, JSON.stringify(handy));
    await p.screenshot({ path: 'g3-handy-offen.png' });

    // ---- Doppeltipp auf den Listeneintrag ----
    const einfach = await p.etiketten();
    const stelle = await findeObjektStelle(p, r);
    pruefe('N Handy, Aufbau: Wo eben der Listeneintrag stand, liegt im geöffneten Garten ein Objekt', !!stelle, stelle ? stelle.join(', ') : 'keine Stelle gefunden');
    await p.reload(); await p.waitForTimeout(1500);
    r = await p.locator('.garten__oeffnen').first().boundingBox();
    if (stelle) {
      const imEintrag = stelle[0] > r.x && stelle[0] < r.x + r.width && stelle[1] > r.y && stelle[1] < r.y + r.height;
      await p.touchscreen.tap(stelle[0], stelle[1]); await warte(120); await p.touchscreen.tap(stelle[0], stelle[1]);
      await p.warteAufEditor(); await p.waitForTimeout(800);
      pruefe('N Handy: Doppeltipp auf den Listeneintrag öffnet den Garten, ohne zu zoomen und ohne ein Objekt auszuwählen', imEintrag && (await p.sichtbar('#ed-toolbar')) && gleicheLage(einfach, await p.etiketten()) && (await p.anzahl('.ed-griff')) === 0 && !(await p.sichtbar('#ed-delete')), `Griffe ${await p.anzahl('.ed-griff')}, „Löschen“ sichtbar: ${await p.sichtbar('#ed-delete')}`);
    }

    // ---- Rückfrage am Handy: nur eines der beiden Flurstücke gewählt ----
    await p.reload(); await p.waitForTimeout(1500);
    await sucheAdresse(p);
    await waehle(p, [[bild.width / 2, bild.height / 2 - 90]]); // Flurstück A liegt knapp über der Bildmitte
    const vorher = await p.speicher();
    await p.tap('#gp-aktion'); await p.waitForTimeout(700);
    const f = await p.frage(); const masse = await p.frageMasse();
    pruefe('N Handy: ein Flurstück weniger als im Garten -> Rückfrage; empfohlen ist das unveränderte Öffnen', f.offen && f.titel === FRAGE_TITEL && f.text === `Der Garten „${LANG}“ umfasst 2 Flurstücke – jetzt ist nur 1 davon gewählt.` + FRAGE_ZEILE2 && f.knoepfe.map((k) => k.wert + ':' + k.text).join(' | ') === FRAGE_KNOEPFE && f.knoepfe.filter((k) => k.haupt).map((k) => k.wert).join() === 'oeffnen', f.text.replace(/\n/g, ' / '));
    pruefe('N Handy: Rückfrage passt auf den Bildschirm – alle vier Knöpfe ganz zu sehen und groß genug, kein Rollen zur Seite', masse.imBild && masse.knoepfeGanzSichtbar === 4 && masse.ohneQuerRollen && masse.kleinsterKnopf >= 44, JSON.stringify(masse));
    await p.screenshot({ path: 'g5-handy-rueckfrage.png' });
    await p.tap('#rueckfrage [data-wert="oeffnen"]'); await p.warteAufEditor(); await p.waitForTimeout(800);
    pruefe('N Handy: „Garten unverändert öffnen“ zeigt den Garten mit seinen beiden Flurstücken, Speicher unverändert', (await p.sichtbar('#ed-toolbar')) && !(await p.frage()).offen && (await p.seiten()) === 16 && (await p.objekte()) === 10 && (await p.speicher()) === vorher, `Seiten ${await p.seiten()}, Objekte ${await p.objekte()}`);
    await p.screenshot({ path: 'g6-handy-nach-rueckfrage.png' });

    // ---- Handy quer: Die Liste liegt dort, wo gleich die Werkzeugleiste erscheint ----
    // Der zweite Tipp eines Doppeltipps träfe dort einen Knopf der Leiste
    // (z. B. „Schließen“). Er kommt erst an, wenn die Karte den Garten
    // gezeichnet hat – und darf trotzdem nicht zählen.
    await p.setViewportSize({ width: 844, height: 390 }); await p.waitForTimeout(600);
    const knoepfe = [['„Haus“', await p.mitte('.chip[data-typ="haus"]')], ['„Schließen“', await p.mitte('#ed-close')]];
    await p.reload(); await p.waitForTimeout(1500);
    const ergebnis = [];
    for (const [name, [x, y]] of knoepfe) {
      // Nur Stellen, an denen in der Liste etwas liegt, das den Garten öffnet.
      if (!(await p.evaluate(([px, py]) => { const e = document.elementFromPoint(px, py); return !!e && !!e.closest('.garten__oeffnen, .garten__aktion--weiter'); }, [x, y]))) continue;
      await p.touchscreen.tap(x, y); await warte(120); await p.touchscreen.tap(x, y);
      await p.warteAufEditor(); await p.waitForTimeout(800);
      ergebnis.push({ name, offen: await p.sichtbar('#ed-toolbar'), werkzeug: await p.evaluate(() => (document.querySelector('.chip.is-active') || { dataset: {} }).dataset.typ || '') });
      await p.reload(); await p.waitForTimeout(1500);
    }
    pruefe('N Handy quer, Aufbau: Unter einem Listeneintrag erscheint nach dem Öffnen ein Knopf der Werkzeugleiste', ergebnis.length > 0, ergebnis.map((e) => e.name).join(', ') || 'keine passende Stelle');
    pruefe('N Handy quer: Doppeltipp auf einen solchen Eintrag – der Garten bleibt offen, kein Werkzeug wird gewählt', ergebnis.length > 0 && ergebnis.every((e) => e.offen && e.werkzeug === ''), ergebnis.map((e) => `${e.name}: Editor ${e.offen ? 'offen' : 'wieder zu'}${e.werkzeug ? ', Werkzeug ' + e.werkzeug : ''}`).join(' | '));
  });

  console.log(`\nEchte Anfragen an das Kataster in diesem Lauf: ${echteAnfragen.size}` + (katasterAussetzer ? ` (${katasterAussetzer}-mal antwortete der Dienst nicht, der Schritt wurde wiederholt)` : ''));
  const bad = ergebnisse.filter((e) => !e.ok);
  console.log(`\nERGEBNIS: ${ergebnisse.length - bad.length} von ${ergebnisse.length} Prüfungen bestanden` + (bad.length ? ' – FEHLER: ' + bad.map((b) => b.name).join(' ; ') : ''));
  await browser.close();
  process.exit(bad.length ? 1 : 0);
})().catch((e) => { console.error('SKRIPTFEHLER', e); process.exit(1); });
