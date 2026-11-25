// =========================================================================
// Browser-Test „Feinheiten“: Zeitabläufe und Randfälle (Desktop + Handy-Format)
// -------------------------------------------------------------------------
// Suche (Nachfrage mit Bundesland, Zeitlimit, Enter), Grundstückswahl
// (Doppeltipp, langsame und hängende Kataster-Antworten, mehrere Flurstücke),
// späte Antwort von „Automatisch erfassen“, Typ-Reihe in kleinen Fenstern und
// am Handy (Pfeile, Drehen).
// Luftbild blockiert; Adresssuche nachgestellt; Kataster echt, für die
// Zeit-Tests aus einem Zwischenspeicher mit einstellbarer Antwortzeit.
// Aufruf: node tests/feinheiten.test.cjs http://127.0.0.1:5173/   (siehe browser.cjs)
// =========================================================================
const { chromium, devices } = require('playwright');
const fs = require('fs');
const path = require('path');
// Bildschirmfotos und heruntergeladene Dateien landen in tests/ausgabe/ (nicht im Git).
const AUSGABE = path.join(__dirname, 'ausgabe');
fs.mkdirSync(AUSGABE, { recursive: true });
process.chdir(AUSGABE);
const URL_APP = process.argv[2] || 'http://127.0.0.1:5173/';
const NRW = { state: 'Nordrhein-Westfalen', 'ISO3166-2-lvl4': 'DE-NW' };
const ORT = (name, lat, lon) => ({ lat: String(lat), lon: String(lon), name, display_name: `${name}, Rheda, Rheda-Wiedenbrück, Kreis Gütersloh, Nordrhein-Westfalen, 33378, Deutschland`, address: { road: name, ...NRW } });
const NACHBAR = (name) => ({ lat: '50.6', lon: '7.9', name, display_name: `${name}, Enspel, Westerburg, Westerwaldkreis, Rheinland-Pfalz, 57647, Deutschland`, address: { road: name, state: 'Rheinland-Pfalz', 'ISO3166-2-lvl4': 'DE-RP' } });
const ergebnisse = [];
const pruefe = (name, ok, detail = '') => { ergebnisse.push({ name, ok }); console.log((ok ? 'OK    ' : 'FEHLER') + ' ' + name + (detail ? '  -> ' + detail : '')); };
const warte = (ms) => new Promise((r) => setTimeout(r, ms));

// Fehler der Seite sammeln: Am Ende zählt jeder als gescheiterte Prüfung.
// Dazu gehören auch Fehlermeldungen in der Konsole – außer denen, die zum
// Testaufbau gehören (das Luftbild ist blockiert, die Karte meldet deshalb
// jede Kachel als nicht ladbar) und denen, die ein Abschnitt absichtlich
// auslöst (Muster in „erlaubt“) – und jedes Fenster des Browsers
// („OK / Abbrechen“): Dieser Test erwartet keines.
function sammleFehler(page) {
  const fehler = [];
  fehler.erlaubt = [];
  const harmlos = (t) => /Failed to load resource|net::ERR_/.test(t) || (/Failed to fetch/.test(t) && /maplibre/.test(t));
  page.on('pageerror', (e) => fehler.push('Seitenfehler: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !harmlos(m.text()) && !fehler.erlaubt.some((muster) => muster.test(m.text()))) fehler.push('Konsole: ' + m.text().split('\n')[0].slice(0, 200)); });
  page.on('dialog', async (d) => { fehler.push(`Unerwartetes Browser-Fenster (${d.type()}): ${d.message()}`); try { await d.dismiss(); } catch (e) { /* Seite schon zu */ } });
  return fehler;
}

async function suchAttrappe(page, protokoll) {
  await page.route('**/nominatim.openstreetmap.org/**', async (r) => {
    const q = new URL(r.request().url()).searchParams.get('q');
    protokoll.push({ q, t: Date.now() });
    const antwort = (liste) => r.fulfill({ contentType: 'application/json', body: JSON.stringify(liste) }).catch(() => {});
    if (/Haengt/.test(q)) return; // nie antworten
    if (/Weiler/.test(q)) return antwort([{ lat: '50.49', lon: '6.43', name: '', display_name: '12, Dorfweiler, Hellenthal, Kreis Euskirchen, Nordrhein-Westfalen, 53940, Deutschland', address: { house_number: '12', village: 'Dorfweiler', municipality: 'Hellenthal', ...NRW } }]);
    if (/Langsam/.test(q)) { await warte(1200); return antwort([ORT('Langsamweg', 51.8500, 8.2950)]); }
    if (/Viele/.test(q)) return antwort([1, 2, 3, 4, 5].map((i) => ({ lat: '51.85', lon: '8.29', name: '', display_name: `${i}, Sehr-lange-Beispielstraße, Rheda, Rheda-Wiedenbrück, Kreis Gütersloh, Nordrhein-Westfalen, 33378, Deutschland`, address: { house_number: String(i), road: 'Sehr-lange-Beispielstraße', ...NRW } })));
    if (/Zweite/.test(q)) return antwort([ORT('Zweite Straße', 51.8500, 8.2950)]);
    // „Nachbarweg“: wie getippt nur Treffer aus dem Nachbarland; mit Zusatz ein NRW-Treffer
    if (/Nachbarweg/.test(q)) return antwort(/Nordrhein-Westfalen/.test(q) ? [ORT('Nachbarweg', 51.9, 8.3)] : [NACHBAR('Nachbarweg'), NACHBAR('Nachbarweg')]);
    // „Fremdweg“: auch mit Zusatz nichts in NRW
    if (/Fremdweg/.test(q)) return antwort(/Nordrhein-Westfalen/.test(q) ? [] : [NACHBAR('Fremdweg')]);
    // „Landweg, Nordrhein-Westfalen“ (Land schon getippt): nur Nachbar-Treffer
    if (/Landweg/.test(q)) return antwort([NACHBAR('Landweg')]);
    return antwort([ORT('Mozartstraße', 51.8487816, 8.2891470)]);
  });
}

(async () => {
  const browser = await chromium.launch();

  // =================== Desktop ===================
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const fehler = sammleFehler(page);
  await page.route('**/www.wms.nrw.de/**', (r) => r.abort());
  const fragen = []; await suchAttrappe(page, fragen);
  const text = (sel) => page.evaluate((s) => (document.querySelector(s) || {}).innerText || '', sel);
  const anzahl = (sel) => page.evaluate((s) => [...document.querySelectorAll(s)].filter((e) => e.getClientRects().length).length, sel);
  const sichtbar = (sel) => page.evaluate((s) => { const e = document.querySelector(s); return !!e && e.getClientRects().length > 0; }, sel);

  await page.goto(URL_APP); await page.waitForTimeout(1200);

  // ---- Suche ----
  await page.fill('#search-input', 'Weiler Test'); await page.waitForSelector('.results__item');
  pruefe('Suche: zuerst wird genau wie getippt gefragt', fragen.at(-1).q === 'Weiler Test', fragen.at(-1).q);
  pruefe('Suche: Haus ohne Straßennamen heißt „Dorfweiler 12“', (await text('.results__title')) === 'Dorfweiler 12', `Titel „${await text('.results__title')}“`);
  await page.waitForTimeout(600);
  let n0 = fragen.length;
  await page.fill('#search-input', 'Nachbarweg 1,'); await page.waitForFunction(() => (document.querySelector('.results__title') || {}).innerText === 'Nachbarweg', null, { timeout: 8000 });
  const neu = fragen.slice(n0);
  pruefe('Suche: nur Nachbarland-Treffer -> EINE Nachfrage mit Bundesland, ohne doppeltes Komma', neu.length === 2 && neu[1].q === 'Nachbarweg 1, Nordrhein-Westfalen' && (await text('.results__title')) === 'Nachbarweg', JSON.stringify(neu.map((f) => f.q)));
  pruefe('Suche: die Nachfrage kommt frühestens 1 s nach der ersten Anfrage', neu.length === 2 && neu[1].t - neu[0].t >= 950, neu.length === 2 ? `${neu[1].t - neu[0].t} ms` : '');
  n0 = fragen.length;
  await page.fill('#search-input', 'Fremdweg 1'); await page.waitForTimeout(2600);
  pruefe('Suche: auch mit Bundesland nichts in NRW -> NRW-Meldung, höchstens 2 Anfragen', fragen.length - n0 === 2 && (await anzahl('.results__item')) === 0 && /nur für Nordrhein-Westfalen/.test(await text('#search-hint')), `Anfragen ${fragen.length - n0} | ${await text('#search-hint')}`);
  n0 = fragen.length;
  await page.fill('#search-input', 'Landweg 1, nordrhein-westfalen'); await page.waitForTimeout(2200);
  pruefe('Suche: Bundesland schon getippt -> keine Nachfrage', fragen.length - n0 === 1 && /nur für Nordrhein-Westfalen/.test(await text('#search-hint')), `Anfragen ${fragen.length - n0}`);
  // Nachfrage wird verworfen, wenn inzwischen weitergetippt wurde
  n0 = fragen.length;
  await page.fill('#search-input', 'Nachbarweg 2'); await page.waitForTimeout(650); // erste Anfrage raus, Nachfrage wartet noch
  await page.fill('#search-input', 'Weiler Test'); await page.waitForSelector('.results__item'); await page.waitForTimeout(1500);
  pruefe('Suche: Weitertippen verwirft die wartende Nachfrage', fragen.slice(n0).map((f) => f.q).join(' | ') === 'Nachbarweg 2 | Weiler Test' && (await text('.results__title')) === 'Dorfweiler 12', fragen.slice(n0).map((f) => f.q).join(' | '));
  // Enter während genau diese Suche schon läuft: keine zweite Anfrage
  n0 = fragen.length;
  await page.fill('#search-input', 'Langsam Test'); await page.waitForTimeout(650);
  await page.press('#search-input', 'Enter'); await page.waitForTimeout(250);
  pruefe('Suche: Enter während laufender gleicher Suche fragt nicht doppelt', fragen.length - n0 === 1 && (await sichtbar('#search-spinner')), `Anfragen: ${fragen.length - n0}`);
  await page.waitForSelector('.results__item');
  await page.press('#search-input', 'Enter'); await page.waitForTimeout(300);
  pruefe('Suche: zweites Enter übernimmt', (await page.inputValue('#search-input')) === 'Langsamweg' && (await sichtbar('#gp-panel')));
  // Hängende Suche: nach dem Zeitlimit Meldung, danach geht Enter wieder
  n0 = fragen.length;
  fehler.erlaubt = [/AbortError/]; // das Zeitlimit bricht die Suche ab – die App schreibt das in die Konsole
  await page.fill('#search-input', 'Haengt Test'); await page.waitForTimeout(700);
  await page.press('#search-input', 'Enter'); await page.waitForTimeout(300);
  pruefe('Suche: hängende Suche – Enter fragt (noch) nicht doppelt, Spinner läuft', fragen.length - n0 === 1 && (await sichtbar('#search-spinner')));
  await page.waitForTimeout(15200);
  pruefe('Suche: nach 15 s endet die hängende Suche mit Meldung', !(await sichtbar('#search-spinner')) && /nicht erreichbar/.test(await text('#search-hint')), await text('#search-hint'));
  fehler.erlaubt = [];
  await page.press('#search-input', 'Enter'); await page.waitForTimeout(300);
  pruefe('Suche: danach startet Enter die Suche wieder', fragen.length - n0 === 2, `Anfragen ${fragen.length - n0}`);

  // ---- Zur Testadresse ----
  await page.fill('#search-input', 'Mozartstraße'); await page.waitForSelector('.results__item'); await page.click('.results__item');
  await page.waitForTimeout(7000);

  // Doppelklick auf „Grundstück auswählen“ darf nicht gleich wieder abbrechen
  const knopf = await page.evaluate(() => { const r = document.getElementById('gp-aktion').getBoundingClientRect(); return { x: r.left + r.width * 0.8, y: r.top + r.height / 2 }; });
  await page.mouse.dblclick(knopf.x, knopf.y); await page.waitForTimeout(500);
  pruefe('Knopf: Doppelklick auf „Grundstück auswählen“ bleibt in der Auswahl', /Tippe auf dein Grundstück/.test(await text('#gp-text')) && (await text('#gp-zurueck')) === 'Abbrechen', await text('#gp-text'));

  // Echte Kataster-Antworten merken (für Zeit-Tests mit einstellbarer Antwortzeit je Abfrage)
  const zwischenspeicher = new Map();
  let verzoegerung = 0; const naechste = []; let wfsAnfragen = 0; let haengen = false;
  page.on('response', async (resp) => { const u = resp.url(); if (u.includes('wfs.nrw.de') && !zwischenspeicher.has(u)) { try { zwischenspeicher.set(u, { status: resp.status(), body: await resp.text() }); } catch (e) {} } });
  await page.route('**/www.wfs.nrw.de/**', async (r) => {
    wfsAnfragen++;
    if (haengen) return;
    const z = zwischenspeicher.get(r.request().url());
    if (!z) { try { await r.continue(); } catch (e) {} return; }
    await warte(naechste.length ? naechste.shift() : verzoegerung);
    try { await r.fulfill({ status: z.status, body: z.body, contentType: 'text/xml' }); } catch (e) {}
  });
  await page.mouse.click(640, 310); await page.waitForTimeout(3500);
  pruefe('Wahl: erster Tipp wählt', /1 Flurstück gewählt/.test(await text('#gp-text')), await text('#gp-text'));
  await page.mouse.click(640, 310); await page.waitForTimeout(1500);
  pruefe('Wahl: bewusster zweiter Tipp wählt ab', /Tippe auf dein Grundstück/.test(await text('#gp-text')), await text('#gp-text'));

  await page.waitForTimeout(800); verzoegerung = 30; let n = wfsAnfragen;
  await page.mouse.click(640, 310); await warte(300); await page.mouse.click(641, 311); await page.waitForTimeout(900);
  pruefe('Wahl: Doppeltipp bei SCHNELLER Antwort bleibt gewählt (1 Abfrage)', /1 Flurstück gewählt/.test(await text('#gp-text')) && wfsAnfragen - n === 1, `${await text('#gp-text')} | Abfragen ${wfsAnfragen - n}`);
  await page.mouse.click(640, 310); await page.waitForTimeout(900);

  await page.waitForTimeout(800); verzoegerung = 2500; n = wfsAnfragen;
  await page.mouse.click(640, 310); await warte(1200); await page.mouse.click(640, 310); await page.waitForTimeout(4200);
  pruefe('Wahl: ungeduldiger zweiter Tipp bei LANGSAMER Antwort wählt nicht wieder ab', /1 Flurstück gewählt/.test(await text('#gp-text')), `${await text('#gp-text')} | Abfragen ${wfsAnfragen - n}`);
  verzoegerung = 0;
  await page.mouse.click(640, 310); await page.waitForTimeout(1500); // abwählen

  // Späte Antwort eines ALTEN Tipps überstimmt neuere Tipps nicht (wählen -> abwählen -> alte Antwort)
  await page.waitForTimeout(800); naechste.push(5000, 0, 0);
  await page.mouse.click(640, 310); await warte(900); await page.mouse.click(640, 310); await page.waitForTimeout(700);
  const zwischen1 = await text('#gp-text');
  await warte(300); await page.mouse.click(640, 310); await page.waitForTimeout(700);
  const zwischen2 = await text('#gp-text');
  await page.waitForTimeout(4200);
  pruefe('Wahl: verspätete Antwort eines alten Tipps überstimmt das spätere Abwählen nicht', /Suche Flurstück|1 Flurstück gewählt/.test(zwischen1) && /Tippe auf dein Grundstück/.test(await text('#gp-text')) && !(await sichtbar('#gp-aktion')), `nach Tipp 2: ${zwischen1} | nach Tipp 3: ${zwischen2} | am Ende: ${await text('#gp-text')}`);

  // zwei verschiedene Flurstücke kurz nacheinander -> beide gewählt
  await page.waitForTimeout(800);
  await page.mouse.click(640, 310); await warte(250); await page.mouse.click(450, 250); await page.waitForTimeout(4500);
  pruefe('Wahl: zwei verschiedene Flurstücke zügig nacheinander werden beide gewählt', /2 Flurstücke gewählt/.test(await text('#gp-text')), await text('#gp-text'));
  await page.waitForTimeout(800); await page.mouse.click(450, 250); await page.waitForTimeout(2500);
  pruefe('Wahl: zweites Flurstück lässt sich wieder abwählen', /1 Flurstück gewählt/.test(await text('#gp-text')), await text('#gp-text'));

  verzoegerung = 2500;
  await page.waitForTimeout(800); await page.mouse.click(450, 250); await warte(400);
  await page.click('#gp-aktion'); await page.waitForTimeout(3500);
  pruefe('Wahl: „OK“ während laufender Abfrage – späte Antwort ändert nichts mehr', /1 Flurstück übernommen/.test(await text('#gp-text')) && (await text('#gp-aktion')) === 'Garten erfassen', await text('#gp-text'));

  await page.click('#gp-zurueck'); await page.waitForTimeout(700); // Neu beginnen
  await page.click('#gp-aktion'); await page.waitForTimeout(600); // Grundstück auswählen
  haengen = true;
  fehler.erlaubt = [/AbortError/]; // auch hier: Abbruch durch das Zeitlimit, von der App gemeldet
  await page.mouse.click(640, 310); await page.waitForTimeout(1500);
  haengen = false; verzoegerung = 0;
  await page.mouse.click(700, 420); await page.waitForTimeout(2500);
  pruefe('Wahl: trotz hängender Abfrage geht ein weiterer Tipp (Such-Hinweis bleibt)', /Suche Flurstück/.test(await text('#gp-text')) && (await sichtbar('#gp-aktion')), await text('#gp-text'));
  await page.waitForTimeout(13500);
  pruefe('Wahl: nach dem Zeitlimit endet der Such-Hinweis', !/Suche Flurstück/.test(await text('#gp-text')), await text('#gp-text'));
  fehler.erlaubt = [];
  await page.unroute('**/www.wfs.nrw.de/**');

  // ---- Editor: späte Antwort von „Automatisch erfassen“ ----
  await page.click('#gp-zurueck'); await page.waitForTimeout(700); // Abbrechen
  await page.click('#gp-aktion'); await page.waitForTimeout(600); await page.mouse.click(640, 310); await page.waitForTimeout(3500);
  await page.click('#gp-aktion'); await page.waitForTimeout(700); await page.click('#gp-aktion'); await page.waitForTimeout(600);
  await page.evaluate(() => { for (const k of Object.keys(localStorage)) if (k.startsWith('gruenriss:garten:')) localStorage.removeItem(k); });
  await page.click('#ed-close'); await page.waitForTimeout(300); await page.click('#gp-aktion'); await page.waitForTimeout(700);
  await page.route('**/www.wfs.nrw.de/**', async (r) => { await warte(3000); try { await r.continue(); } catch (e) {} });
  await page.click('#ed-auto'); await page.waitForTimeout(300);
  await page.click('#ed-close'); await page.waitForTimeout(300);
  await page.fill('#search-input', 'Zweite Straße'); await page.waitForSelector('.results__item'); await page.click('.results__item');
  await page.waitForTimeout(6000);
  pruefe('Automatik: verspätete Antwort nach „Schließen“ + neuer Adresse legt nichts mehr auf die Karte', (await anzahl('.masslabel')) === 0 && (await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('gruenriss:garten:')).length)) === 0, 'Etiketten: ' + (await anzahl('.masslabel')));
  await page.unroute('**/www.wfs.nrw.de/**');

  // ---- Typ-Reihe: niedriges und schmales Desktop-Fenster ----
  for (const [w, h, klick] of [[1280, 560, [640, 200]], [560, 700, [280, 260]]]) {
    await page.setViewportSize({ width: w, height: h });
    await page.fill('#search-input', 'Mozartstraße'); await page.waitForSelector('.results__item'); await page.click('.results__item'); await page.waitForTimeout(6500);
    await page.click('#gp-aktion'); await page.waitForTimeout(600); await page.mouse.click(klick[0], klick[1]); await page.waitForTimeout(3500);
    if (!/Flurstück gewählt/.test(await text('#gp-text'))) { await page.waitForTimeout(700); await page.mouse.click(klick[0], klick[1] + 40); await page.waitForTimeout(3500); }
    await page.click('#gp-aktion'); await page.waitForTimeout(700); await page.click('#gp-aktion'); await page.waitForTimeout(600);
    const chips = await page.evaluate(() => { const box = document.getElementById('ed-toolbar').getBoundingClientRect(); return [...document.querySelectorAll('.chip')].filter((c) => { const r = c.getBoundingClientRect(); return r.width > 0 && r.left >= box.left && r.right <= box.right; }).length; });
    pruefe(`Typen: Desktop-Fenster ${w}x${h} zeigt alle 11`, chips === 11, 'sichtbar: ' + chips);
    await page.screenshot({ path: `n2-fenster-${w}x${h}.png` });
    await page.click('#ed-close'); await page.waitForTimeout(300);
  }
  await page.waitForTimeout(500); // auch späte Fehler noch mitnehmen
  pruefe('Desktop: keine Fehler auf der Seite, kein unerwartetes Browser-Fenster', fehler.length === 0, fehler.join(' | '));
  await page.close();

  // =================== Handy ===================
  const ctx = await browser.newContext({ ...devices['iPhone 13'] });
  const p = await ctx.newPage();
  const fehlerM = sammleFehler(p);
  await p.route('**/www.wms.nrw.de/**', (r) => r.abort());
  await suchAttrappe(p, []);
  const vp = p.viewportSize();
  await p.goto(URL_APP); await p.waitForTimeout(1200);
  await p.fill('#search-input', 'Viele Treffer'); await p.waitForSelector('.results__item'); await p.waitForTimeout(300);
  const liste = await p.evaluate(() => { const l = document.getElementById('search-results').getBoundingClientRect(); const q = document.querySelector('.results__quelle').getBoundingClientRect(); return { listeUnten: Math.round(l.bottom), quelleOben: Math.round(q.top), quelleUnten: Math.round(q.bottom), treffer: document.querySelectorAll('.results__item').length }; });
  pruefe('Handy: Quellenangabe bleibt bei 5 Treffern im sichtbaren Teil der Liste', liste.treffer === 5 && liste.quelleUnten <= liste.listeUnten + 1 && liste.quelleOben >= liste.listeUnten - 40, JSON.stringify(liste));
  // Liste gescrollt, dann neue Treffer: wieder von oben
  await p.evaluate(() => { document.getElementById('search-results').scrollTop = 200; });
  await p.fill('#search-input', 'Viele Treffer bitte'); await p.waitForTimeout(1200);
  pruefe('Handy: neue Treffer erscheinen von oben', (await p.evaluate(() => document.getElementById('search-results').scrollTop)) === 0);
  await p.fill('#search-input', 'Mozartstraße'); await p.waitForSelector('.results__item'); await p.tap('.results__item'); await p.waitForTimeout(7000);
  // Doppeltipp auf den Knopf „Grundstück auswählen“
  const k = await p.evaluate(() => { const r = document.getElementById('gp-aktion').getBoundingClientRect(); return { x: r.left + r.width * 0.8, y: r.top + r.height / 2 }; });
  await p.touchscreen.tap(k.x, k.y); await warte(150); await p.touchscreen.tap(k.x, k.y); await p.waitForTimeout(500);
  pruefe('Handy: Doppeltipp auf „Grundstück auswählen“ bleibt in der Auswahl', /Tippe auf dein Grundstück/.test(await p.innerText('#gp-text')), await p.innerText('#gp-text'));
  await p.touchscreen.tap(vp.width / 2, vp.height / 2 - 90); await warte(250); await p.touchscreen.tap(vp.width / 2 + 2, vp.height / 2 - 89); await p.waitForTimeout(3500);
  pruefe('Handy: Doppeltipp wählt das Flurstück genau einmal', /1 Flurstück gewählt/.test(await p.innerText('#gp-text')), await p.innerText('#gp-text'));
  await p.tap('#gp-aktion'); await p.waitForTimeout(700); await p.tap('#gp-aktion'); await p.waitForTimeout(700);
  const pfeil = () => p.evaluate(() => { const c = document.getElementById('ed-chips'); const a = getComputedStyle(c, '::after'); const b = getComputedStyle(c, '::before'); return { rechts: a.display !== 'none' ? a.content : '-', links: b.display !== 'none' ? b.content : '-', scrollWidth: c.scrollWidth, scrollLeft: Math.round(c.scrollLeft) }; });
  const start = await pfeil();
  pruefe('Handy: am Anfang der Reihe steht rechts der Pfeil, links keiner', /›/.test(start.rechts) && start.links === '-' && start.scrollWidth === 1083, JSON.stringify(start));
  // Zeichnung beginnen, dann auf den rechten Pfeil tippen: blättert, wählt nichts, Zeichnung bleibt
  await p.tap('.chip[data-typ="haus"]'); await p.waitForTimeout(400);
  for (const [dx, dy] of [[40, -150], [90, -150], [90, -110]]) { await p.touchscreen.tap(vp.width / 2 + dx, vp.height / 2 + dy); await p.waitForTimeout(700); }
  const vorPfeil = { hinweis: await p.innerText('#ed-hint'), ...(await pfeil()) };
  const reihe = await p.evaluate(() => { const r = document.getElementById('ed-chips').getBoundingClientRect(); return { rechts: r.right, links: r.left, y: r.top + r.height / 2 - 2 }; });
  await p.touchscreen.tap(reihe.rechts - 12, reihe.y); await p.waitForTimeout(900);
  const nachPfeil = { hinweis: await p.innerText('#ed-hint'), aktiv: await p.evaluate(() => (document.querySelector('.chip.is-active') || { dataset: {} }).dataset.typ), ...(await pfeil()) };
  pruefe('Handy: Tipp auf den rechten Pfeil blättert und lässt Werkzeug und Zeichnung in Ruhe', nachPfeil.scrollLeft > vorPfeil.scrollLeft + 100 && nachPfeil.aktiv === 'haus' && /3 Punkt/.test(nachPfeil.hinweis), `vorher ${vorPfeil.scrollLeft} (${vorPfeil.hinweis}) -> nachher ${nachPfeil.scrollLeft}, aktiv ${nachPfeil.aktiv} (${nachPfeil.hinweis})`);
  await p.touchscreen.tap(reihe.links + 12, reihe.y); await p.waitForTimeout(900);
  pruefe('Handy: Tipp auf den linken Pfeil blättert zurück', (await pfeil()).scrollLeft < nachPfeil.scrollLeft - 100, JSON.stringify(await pfeil()));
  await p.screenshot({ path: 'n5-handy-chips-mitte.png' });
  await p.tap('#ed-cancel'); await p.waitForTimeout(300);
  await p.evaluate(() => { const c = document.getElementById('ed-chips'); c.scrollLeft = c.scrollWidth; }); await p.waitForTimeout(400);
  const ende = await pfeil();
  pruefe('Handy: am Ende steht nur links der Pfeil', ende.rechts === '-' && /‹/.test(ende.links), JSON.stringify(ende));
  await p.tap('.chip[data-typ="baum"]'); await p.waitForTimeout(600);
  pruefe('Handy: letzter Chip am rechten Rand lässt sich antippen (Baum aktiv)', await p.evaluate(() => document.querySelector('.chip[data-typ="baum"]').classList.contains('is-active')));
  await p.setViewportSize({ width: 844, height: 390 }); await p.waitForTimeout(600);
  const quer = await p.evaluate(() => getComputedStyle(document.getElementById('ed-chips')).flexWrap);
  pruefe('Handy quer: weiterhin eine wischbare Reihe', quer === 'nowrap', quer);
  await p.tap('.chip[data-typ="rasen"]'); await p.waitForTimeout(700);
  await p.setViewportSize({ width: 390, height: 664 }); await p.waitForTimeout(900);
  const lage = await p.evaluate(() => { const c = document.getElementById('ed-chips').getBoundingClientRect(); const r = document.querySelector('.chip.is-active').getBoundingClientRect(); return { chipLinks: Math.round(r.left), chipRechts: Math.round(r.right), reiheLinks: Math.round(c.left), reiheRechts: Math.round(c.right) }; });
  pruefe('Handy: nach dem Drehen liegt der gewählte Typ im sichtbaren Teil', lage.chipLinks >= lage.reiheLinks && lage.chipRechts <= lage.reiheRechts, JSON.stringify(lage));
  await p.waitForTimeout(500); // auch späte Fehler noch mitnehmen
  pruefe('Handy: keine Fehler auf der Seite, kein unerwartetes Browser-Fenster', fehlerM.length === 0, fehlerM.join(' | '));

  const bad = ergebnisse.filter((e) => !e.ok);
  console.log(`\nERGEBNIS: ${ergebnisse.length - bad.length} von ${ergebnisse.length} Prüfungen bestanden` + (bad.length ? ' – FEHLER: ' + bad.map((b) => b.name).join(' ; ') : ''));
  await browser.close();
  process.exit(bad.length ? 1 : 0);
})().catch((e) => { console.error('SKRIPTFEHLER', e); process.exit(1); });
