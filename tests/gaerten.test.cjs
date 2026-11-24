// =========================================================================
// Browser-Test „Meine Gärten“ (Desktop + Handy-Format)
// -------------------------------------------------------------------------
// Wiederfinden nach dem Neuladen, Liste, „Weiter planen“, Sichern und Laden
// als Datei, Löschen, Übernahme alter Pläne, beschädigte Einträge,
// Speicherfehler. Luftbild blockiert, Suche nachgestellt, Kataster echt.
// Aufruf: node tests/gaerten.test.cjs http://127.0.0.1:5173/   (siehe browser.cjs)
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
const ergebnisse = [];
const pruefe = (name, ok, detail = '') => { ergebnisse.push({ name, ok }); console.log((ok ? 'OK    ' : 'FEHLER') + ' ' + name + (detail ? '  -> ' + detail : '')); };

async function neueSeite(browser, optionen = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, acceptDownloads: true, ...optionen });
  const page = await ctx.newPage();
  page.fehler = [];
  page.on('pageerror', (e) => page.fehler.push('pageerror: ' + e.message));
  page.wfs = [];
  page.on('request', (r) => { if (r.url().includes('wfs.nrw.de')) page.wfs.push(r.url()); });
  await page.route('**/www.wms.nrw.de/**', (r) => r.abort());
  await page.route('**/nominatim.openstreetmap.org/**', (r) => r.fulfill({ contentType: 'application/json', body: JSON.stringify([ORT('Mozartstraße', 51.8487816, 8.2891470)]) }));
  page.text = (sel) => page.evaluate((s) => (document.querySelector(s) || {}).innerText || '', sel);
  page.anzahl = (sel) => page.evaluate((s) => [...document.querySelectorAll(s)].filter((e) => e.getClientRects().length).length, sel);
  page.sichtbar = (sel) => page.evaluate((s) => { const e = document.querySelector(s); return !!e && e.getClientRects().length > 0; }, sel);
  page.gaerten = () => page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('gruenriss:garten:')).map((k) => { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } }).filter(Boolean));
  return page;
}

// Adresse suchen, Flurstück(e) antippen, übernehmen, Editor öffnen
async function bisZumEditor(page, klicks = [[640, 310]]) {
  await page.fill('#search-input', 'Mozartstraße'); await page.waitForSelector('.results__item'); await page.click('.results__item');
  await page.waitForTimeout(7000);
  await page.click('#gp-aktion'); await page.waitForTimeout(600);
  for (const [x, y] of klicks) { await page.mouse.click(x, y); await page.waitForTimeout(3500); }
  await page.click('#gp-aktion'); await page.waitForTimeout(700);
  await page.click('#gp-aktion'); await page.waitForTimeout(700);
}

(async () => {
  const browser = await chromium.launch();
  const ordner = path.join(AUSGABE, 'downloads'); fs.mkdirSync(ordner, { recursive: true });

  // ============ A/B: erster Besuch, Plan anlegen ============
  let page = await neueSeite(browser);
  await page.goto(URL_APP); await page.waitForTimeout(1200);
  pruefe('A Erster Besuch: keine Gartenliste, Knopf bietet „Garten aus Datei laden“', !(await page.sichtbar('#gaerten')) && (await page.text('#gaerten-knopf')) === 'Garten aus Datei laden');
  await bisZumEditor(page);
  pruefe('B Nur ansehen legt noch keinen Garten an', (await page.gaerten()).length === 0);
  await page.click('#ed-auto'); await page.waitForTimeout(5000);
  let g = await page.gaerten();
  pruefe('B Mit dem ersten Objekt wird der Garten gespeichert (Name = amtliche Lage, Umriss, Objekte)', g.length === 1 && g[0].format === 'gruenriss-garten' && g[0].version === 2 && /Mozartstraße/.test(g[0].name) && g[0].flurstuecke.length === 1 && g[0].flurstuecke[0].ring25832.length >= 4 && g[0].flurstuecke[0].amtlicheFlaeche === 2149 && g[0].objekte.length === 8, g.length ? `${g[0].name} | ${g[0].objekte.length} Objekte | amtlich ${g[0].flurstuecke[0].amtlicheFlaeche} m²` : 'kein Garten');
  pruefe('B Alte Schlüssel werden nicht mehr geschrieben', (await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('gruenriss:plan:')).length)) === 0);
  const gartenName = g[0].name;
  await page.click('.chip[data-typ="baum"]'); await page.mouse.click(880, 380); await page.waitForTimeout(400); await page.click('#ed-confirm'); await page.waitForTimeout(300);

  // ============ C: Neuladen -> Weiter planen ============
  await page.reload(); await page.waitForTimeout(1500);
  pruefe('C Nach dem Neuladen steht der Garten in „Meine Gärten“', (await page.sichtbar('#gaerten')) && (await page.anzahl('.garten')) === 1 && (await page.text('.garten__name')) === gartenName, await page.text('.garten__info'));
  pruefe('C Beschreibung nennt Fläche, Objektzahl und Datum', /2\.146 m² · 9 Objekte · geändert am \d{1,2}\.\d{1,2}\.\d{4}/.test(await page.text('.garten__info')), await page.text('.garten__info'));
  let wfsVor = page.wfs.length;
  await page.click('.garten__oeffnen'); await page.waitForTimeout(2500);
  pruefe('C Ein Tipp öffnet den Garten im Editor – ohne Kataster-Abfrage', (await page.sichtbar('#ed-toolbar')) && !(await page.sichtbar('.search')) && page.wfs.length === wfsVor && (await page.anzahl('.masslabel')) >= 18, `Etiketten ${await page.anzahl('.masslabel')}, Abfragen ${page.wfs.length - wfsVor}`);
  pruefe('C „Automatisch erfassen“ wird nicht erneut angeboten (Plan ist nicht leer)', !(await page.sichtbar('#ed-auto')));
  // Liegt das Grundstück sichtbar über der Werkzeugleiste?
  const lage = await page.evaluate(() => { const t = document.getElementById('ed-toolbar').getBoundingClientRect(); const e = [...document.querySelectorAll('.masslabel')].map((m) => m.getBoundingClientRect()); return { leisteOben: Math.round(t.top), etikettenUnten: Math.round(Math.max(...e.map((r) => r.bottom))), etikettenOben: Math.round(Math.min(...e.map((r) => r.top))), links: Math.round(Math.min(...e.map((r) => r.left))), rechts: Math.round(Math.max(...e.map((r) => r.right))) }; });
  pruefe('C Karte ist auf das Grundstück eingepasst (ganz sichtbar über der Leiste)', lage.etikettenUnten <= lage.leisteOben + 12 && lage.etikettenOben >= 0 && lage.links >= 0 && lage.rechts <= 1280, JSON.stringify(lage));
  await page.screenshot({ path: 'g1-weiter-planen.png' });
  // Weiterarbeiten wird gespeichert
  await page.click('.chip[data-typ="baum"]'); await page.mouse.click(640, 300); await page.waitForTimeout(400); await page.click('#ed-confirm'); await page.waitForTimeout(300);
  pruefe('C Änderungen im wieder geöffneten Garten werden gespeichert', (await page.gaerten())[0].objekte.length === 10);

  // ============ D: Schließen -> Liste wieder erreichbar ============
  await page.click('#ed-close'); await page.waitForTimeout(400);
  pruefe('D Nach „Schließen“: Name im Suchfeld, Knopf „Meine Gärten“ sichtbar, Liste zu', (await page.inputValue('#search-input')) === gartenName && (await page.sichtbar('#gaerten-knopf')) && (await page.text('#gaerten-knopf')) === 'Meine Gärten' && !(await page.sichtbar('#gaerten')));
  await page.click('#gaerten-knopf'); await page.waitForTimeout(300);
  pruefe('D Knopf blendet die Liste ein', (await page.sichtbar('#gaerten')) && /10 Objekte/.test(await page.text('.garten__info')), await page.text('.garten__info'));
  await page.fill('#search-input', 'Moz'); await page.waitForTimeout(200);
  pruefe('D Tippen einer Adresse blendet die Liste aus', !(await page.sichtbar('#gaerten')));
  await page.waitForSelector('.results__item');
  pruefe('D Bei Suchtreffern sind Liste und Knopf verborgen', !(await page.sichtbar('#gaerten')) && !(await page.sichtbar('#gaerten-knopf')));

  // ============ E: andere Flurstücks-Kombination findet denselben Garten ============
  await page.click('.results__item'); await page.waitForTimeout(7000);
  await page.click('#gp-aktion'); await page.waitForTimeout(600);
  await page.mouse.click(640, 310); await page.waitForTimeout(3500); await page.mouse.click(450, 250); await page.waitForTimeout(3500);
  pruefe('E Zwei Flurstücke gewählt', /2 Flurstücke gewählt/.test(await page.text('#gp-text')), await page.text('#gp-text'));
  await page.click('#gp-aktion'); await page.waitForTimeout(700); await page.click('#gp-aktion'); await page.waitForTimeout(800);
  g = await page.gaerten();
  pruefe('E Derselbe Garten öffnet sich (Objekte da), jetzt mit 2 Flurstücken – kein zweiter Garten', g.length === 1 && g[0].flurstuecke.length === 2 && g[0].objekte.length === 10 && !(await page.sichtbar('#ed-auto')), `Gärten ${g.length}, Flurstücke ${g[0].flurstuecke.length}, Objekte ${g[0].objekte.length}`);
  await page.click('#ed-close'); await page.waitForTimeout(400);

  // ============ F: Als Datei sichern ============
  await page.fill('#search-input', ''); await page.click('#gaerten-knopf'); await page.waitForTimeout(300);
  const [download] = await Promise.all([page.waitForEvent('download'), page.click('.garten__aktion--sichern')]);
  const datei = path.join(ordner, download.suggestedFilename()); await download.saveAs(datei);
  const inhalt = JSON.parse(fs.readFileSync(datei, 'utf8'));
  pruefe('F „Als Datei sichern“ lädt eine lesbare Garten-Datei herunter', /^gruenriss-mozartstrasse.*\.json$/.test(download.suggestedFilename()) && inhalt.format === 'gruenriss-garten' && inhalt.objekte.length === 10 && inhalt.flurstuecke.length === 2 && !('verworfen' in inhalt), download.suggestedFilename());

  // ============ G: Löschen mit Rückfrage ============
  page.once('dialog', (d) => d.dismiss());
  await page.click('.garten__aktion--loeschen'); await page.waitForTimeout(300);
  pruefe('G Löschen: „Abbrechen“ in der Rückfrage lässt den Garten stehen', (await page.gaerten()).length === 1 && (await page.anzahl('.garten')) === 1);
  let frage = '';
  page.once('dialog', (d) => { frage = d.message(); d.accept(); });
  await page.click('.garten__aktion--loeschen'); await page.waitForTimeout(300);
  pruefe('G Löschen nach Bestätigung entfernt den Garten, Knopf bietet wieder das Laden an', (await page.gaerten()).length === 0 && !(await page.sichtbar('#gaerten')) && (await page.text('#gaerten-knopf')) === 'Garten aus Datei laden', frage);

  // ============ H/I: Aus Datei laden ============
  await page.setInputFiles('#gaerten-datei', datei); await page.waitForTimeout(500);
  pruefe('H Gesicherte Datei laden: Garten steht wieder in der Liste', (await page.gaerten()).length === 1 && (await page.anzahl('.garten')) === 1 && /wurde geladen/.test(await page.text('#search-hint')), await page.text('#search-hint'));
  wfsVor = page.wfs.length;
  await page.click('.garten__oeffnen'); await page.waitForTimeout(2500);
  pruefe('H Der geladene Garten lässt sich öffnen (beide Flurstücke, alle Objekte)', (await page.sichtbar('#ed-toolbar')) && (await page.anzahl('.masslabel')) >= 20 && page.wfs.length === wfsVor, 'Etiketten ' + (await page.anzahl('.masslabel')));
  await page.click('#ed-close'); await page.waitForTimeout(300);
  // Der kleine Knopf „Weiter planen“ öffnet denselben Garten
  await page.fill('#search-input', ''); await page.click('#gaerten-knopf'); await page.waitForTimeout(300);
  await page.click('.garten__aktion--weiter'); await page.waitForTimeout(2500);
  pruefe('H Auch der Knopf „Weiter planen“ öffnet den Garten', (await page.sichtbar('#ed-toolbar')) && (await page.anzahl('.masslabel')) >= 20);
  await page.click('#ed-close'); await page.waitForTimeout(300);
  await page.fill('#search-input', ''); await page.click('#gaerten-knopf'); await page.waitForTimeout(300);
  fs.writeFileSync(path.join(ordner, 'falsch.json'), '{"irgendwas": true}');
  await page.setInputFiles('#gaerten-datei', path.join(ordner, 'falsch.json')); await page.waitForTimeout(400);
  pruefe('I Fremde Datei wird mit Meldung abgelehnt', /keine Garten-Datei/.test(await page.text('#search-hint')) && (await page.gaerten()).length === 1, await page.text('#search-hint'));
  // dieselbe Datei noch einmal: Rückfrage „ersetzen?“
  let frage2 = '';
  page.once('dialog', (d) => { frage2 = d.message(); d.dismiss(); });
  await page.setInputFiles('#gaerten-datei', datei); await page.waitForTimeout(400);
  pruefe('I Vorhandener Garten wird nur nach Rückfrage ersetzt', /gibt es hier schon/.test(frage2) && (await page.gaerten()).length === 1, frage2);
  console.log('Seitenfehler (Teil 1): ' + (page.fehler.length ? page.fehler.join(' | ') : 'keine'));
  await page.context().close();

  // ============ J/K: alte Pläne übernehmen, beschädigte Einträge ============
  page = await neueSeite(browser);
  await page.addInitScript(() => {
    if (localStorage.getItem('test:vorbereitet')) return;
    localStorage.setItem('test:vorbereitet', '1');
    localStorage.setItem('gruenriss:plan:05254002600544______', JSON.stringify([{ id: 'alt1', typ: 'baum', art: 'kreis', center: [8.28975, 51.84905], radius: 4 }, { id: 'alt2', typ: 'baum', art: 'punkt', coords: [8.2899, 51.8491] }]));
    localStorage.setItem('gruenriss:garten:kaputt', '{das ist kein json');
    localStorage.setItem('gruenriss:garten:halb', JSON.stringify({ format: 'gruenriss-garten', version: 2, name: 'Halb lesbar', flurstuecke: [{ id: '05254002600544______' }], objekte: [{ id: 'x', typ: 'beet', art: 'flaeche' }, { id: 'y', typ: 'baum', art: 'kreis', center: [8.2897, 51.8490], radius: 2 }] }));
  });
  await page.goto(URL_APP); await page.waitForTimeout(1500);
  const namen = await page.$$eval('.garten__name', (els) => els.map((e) => e.innerText));
  pruefe('J Alter Plan erscheint als Garten „Flurstück 544“; beschädigter Eintrag stört nicht', namen.includes('Flurstück 544') && namen.includes('Halb lesbar') && namen.length === 2 && (await page.evaluate(() => !!localStorage.getItem('gruenriss:archiv:gruenriss:plan:05254002600544______') && !localStorage.getItem('gruenriss:plan:05254002600544______'))), namen.join(' | '));
  wfsVor = page.wfs.length;
  await page.click(`.garten__oeffnen:has-text("Flurstück 544")`); await page.waitForTimeout(4500);
  g = (await page.gaerten()).find((x) => x && x.objekte && x.objekte.length === 2 && x.flurstuecke[0].ring25832);
  pruefe('J Öffnen holt den Umriss einmal vom Kataster, benennt den Garten nach der Lage und zeigt die Objekte', (await page.sichtbar('#ed-toolbar')) && page.wfs.length - wfsVor === 1 && /flst-by-kennzeichen/.test(page.wfs.at(-1)) && !!g && /Mozartstraße/.test(g.name) && g.objekte.every((o) => o.art === 'kreis'), g ? `${g.name} | Abfragen ${page.wfs.length - wfsVor}` : 'nicht gefunden');
  await page.click('#ed-close'); await page.waitForTimeout(300);
  await page.fill('#search-input', ''); await page.click('#gaerten-knopf'); await page.waitForTimeout(300);
  await page.click(`.garten__oeffnen:has-text("Halb lesbar")`); await page.waitForTimeout(4500);
  pruefe('K Teilweise lesbarer Garten öffnet sich und meldet das ausgelassene Objekt', (await page.sichtbar('#ed-toolbar')) && /1 Objekt dieses Plans war nicht lesbar/.test(await page.text('#ed-hint')), await page.text('#ed-hint'));

  // ============ L: Speichern schlägt fehl ============
  await page.evaluate(() => { Storage.prototype.setItem = function () { throw new DOMException('voll', 'QuotaExceededError'); }; });
  await page.click('.chip[data-typ="baum"]'); await page.mouse.click(640, 300); await page.waitForTimeout(400);
  pruefe('L Speicherfehler: Warnung in der Werkzeugleiste', (await page.sichtbar('#ed-warnung')) && /nicht gespeichert/.test(await page.text('#ed-warnung')), await page.text('#ed-warnung'));
  console.log('Seitenfehler (Teil 2): ' + (page.fehler.length ? page.fehler.join(' | ') : 'keine'));
  await page.context().close();

  // ============ M: Kataster nicht erreichbar beim Öffnen eines alten Plans ============
  page = await neueSeite(browser);
  await page.addInitScript(() => { if (!localStorage.getItem('test:v')) { localStorage.setItem('test:v', '1'); localStorage.setItem('gruenriss:plan:05254002600544______', JSON.stringify([{ id: 'a', typ: 'baum', art: 'kreis', center: [8.28975, 51.84905], radius: 4 }])); } });
  await page.route('**/www.wfs.nrw.de/**', (r) => r.abort());
  await page.goto(URL_APP); await page.waitForTimeout(1500);
  await page.click('.garten__oeffnen'); await page.waitForTimeout(1500);
  pruefe('M Kataster nicht erreichbar: Meldung, Liste bleibt bedienbar, nichts geht verloren', /lässt sich gerade nicht öffnen/.test(await page.text('#search-hint')) && (await page.sichtbar('#gaerten')) && !(await page.sichtbar('#ed-toolbar')) && (await page.gaerten()).length === 1, await page.text('#search-hint'));
  await page.context().close();

  // ============ M2: Kataster antwortet, kennt das Flurstück aber nicht mehr ============
  page = await neueSeite(browser);
  await page.addInitScript(() => { if (!localStorage.getItem('test:v')) { localStorage.setItem('test:v', '1'); localStorage.setItem('gruenriss:plan:05254002600544______', JSON.stringify([{ id: 'a', typ: 'baum', art: 'kreis', center: [8.28975, 51.84905], radius: 4 }])); } });
  await page.route('**/www.wfs.nrw.de/**', (r) => r.fulfill({ status: 200, contentType: 'text/xml', body: '<?xml version="1.0" encoding="utf-8"?><wfs:FeatureCollection xmlns:wfs="http://www.opengis.net/wfs/2.0" numberReturned="0" numberMatched="unknown"></wfs:FeatureCollection>' }));
  await page.goto(URL_APP); await page.waitForTimeout(1500);
  await page.click('.garten__oeffnen'); await page.waitForTimeout(1500);
  pruefe('M Flurstück im Kataster nicht mehr vorhanden: eigene Meldung statt „nicht erreichbar“', /im Kataster nicht mehr zu finden/.test(await page.text('#search-hint')) && !(await page.sichtbar('#ed-toolbar')) && (await page.gaerten()).length === 1, await page.text('#search-hint'));
  await page.context().close();

  // ============ N: Handy ============
  const ctx = await browser.newContext({ ...devices['iPhone 13'] });
  const p = await ctx.newPage();
  const fehlerM = []; p.on('pageerror', (e) => fehlerM.push(e.message));
  await p.route('**/www.wms.nrw.de/**', (r) => r.abort());
  await p.addInitScript((text) => { if (!localStorage.getItem('test:v')) { localStorage.setItem('test:v', '1'); const garten = JSON.parse(text); localStorage.setItem('gruenriss:garten:' + garten.id, text); const zwei = { ...garten, id: 'g-zwei', name: 'Ein Garten mit einem wirklich sehr langen Namen, der nicht in eine Zeile passt' }; localStorage.setItem('gruenriss:garten:g-zwei', JSON.stringify(zwei)); } }, fs.readFileSync(datei, 'utf8'));
  await p.goto(URL_APP); await p.waitForTimeout(1500);
  const breite = await p.evaluate(() => ({ seite: document.documentElement.scrollWidth, fenster: window.innerWidth, liste: Math.round(document.getElementById('gaerten').getBoundingClientRect().right), knoepfe: [...document.querySelectorAll('.garten__aktion')].map((b) => Math.round(b.getBoundingClientRect().height)) }));
  pruefe('N Handy: Liste passt in die Breite, nichts ragt hinaus', breite.seite <= breite.fenster && breite.liste <= breite.fenster && (await p.locator('.garten').count()) === 2, JSON.stringify(breite));
  await p.screenshot({ path: 'g2-handy-liste.png' });
  await p.tap('.garten__oeffnen >> nth=0'); await p.waitForTimeout(3000);
  const handy = await p.evaluate(() => { const t = document.getElementById('ed-toolbar').getBoundingClientRect(); const e = [...document.querySelectorAll('.masslabel')].map((m) => m.getBoundingClientRect()); return { leiste: t.height > 0, leisteOben: Math.round(t.top), etiketten: e.length, unten: Math.round(Math.max(...e.map((r) => r.bottom))), oben: Math.round(Math.min(...e.map((r) => r.top))) }; });
  pruefe('N Handy: Tipp öffnet den Garten, Grundstück liegt über der Werkzeugleiste', handy.leiste && handy.etiketten >= 20 && handy.unten <= handy.leisteOben + 14 && handy.oben >= 0, JSON.stringify(handy));
  await p.screenshot({ path: 'g3-handy-offen.png' });
  console.log('Seitenfehler (Handy): ' + (fehlerM.length ? fehlerM.join(' | ') : 'keine'));

  const bad = ergebnisse.filter((e) => !e.ok);
  console.log(`\nERGEBNIS: ${ergebnisse.length - bad.length} von ${ergebnisse.length} Prüfungen bestanden` + (bad.length ? ' – FEHLER: ' + bad.map((b) => b.name).join(' ; ') : ''));
  await browser.close();
  process.exit(bad.length ? 1 : 0);
})().catch((e) => { console.error('SKRIPTFEHLER', e); process.exit(1); });
