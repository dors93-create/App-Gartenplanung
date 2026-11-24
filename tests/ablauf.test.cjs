// =========================================================================
// Browser-Test „Ablauf“: der Hauptweg am Desktop (1280x800)
// -------------------------------------------------------------------------
// Start, Adresssuche, Grundstückswahl, Editor (Auswahl, Griffe, Stapelfolge),
// neue Adresse, Wiederöffnen des gespeicherten Plans.
// Luftbild-Kacheln sind blockiert, die Adresssuche wird selbst beantwortet
// (mit ECHT=1 zusätzlich zwei echte Suchanfragen); das Kataster ist echt.
// Aufruf: node tests/ablauf.test.cjs http://127.0.0.1:5173/   (siehe browser.cjs)
// =========================================================================
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
// Bildschirmfotos und heruntergeladene Dateien landen in tests/ausgabe/ (nicht im Git).
const AUSGABE = path.join(__dirname, 'ausgabe');
fs.mkdirSync(AUSGABE, { recursive: true });
process.chdir(AUSGABE);

const URL_APP = process.argv[2] || 'http://127.0.0.1:5173/';
const NRW = { state: 'Nordrhein-Westfalen', 'ISO3166-2-lvl4': 'DE-NW' };
const ORT = (name, lat, lon) => ({
  lat: String(lat), lon: String(lon), name,
  display_name: `${name}, Rheda, Rheda-Wiedenbrück, Kreis Gütersloh, Nordrhein-Westfalen, 33378, Deutschland`,
  address: { road: name, ...NRW },
});
const ergebnisse = [];
const pruefe = (name, ok, detail = '') => { ergebnisse.push({ name, ok }); console.log((ok ? 'OK    ' : 'FEHLER') + ' ' + name + (detail ? '  -> ' + detail : '')); };
const warte = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const fehler = [];
  page.on('pageerror', (e) => fehler.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|net::ERR/.test(m.text())) fehler.push('console: ' + m.text().slice(0, 200)); });
  const wfs = [];
  page.on('request', (r) => { if (r.url().includes('wfs.nrw.de')) wfs.push(r.url()); });
  const nominatim = [];

  await page.route('**/www.wms.nrw.de/**', (r) => r.abort());
  let echt = false; // echte Nominatim-Anfragen nur, wenn ausdrücklich gewünscht
  await page.route('**/nominatim.openstreetmap.org/**', async (r) => {
    const u = new URL(r.request().url());
    const q = u.searchParams.get('q');
    nominatim.push({ q, viewbox: u.searchParams.get('viewbox'), bounded: u.searchParams.get('bounded') });
    if (echt) return r.continue();
    if (/Erste/.test(q)) return r.fulfill({ contentType: 'application/json', body: JSON.stringify([ORT('Erste Straße', 51.8487816, 8.2891470)]) });
    if (/Zweite/.test(q)) { await warte(900); return r.fulfill({ contentType: 'application/json', body: JSON.stringify([ORT('Zweite Straße', 51.8500, 8.2950)]) }); }
    if (/Hausnummer/.test(q)) return r.fulfill({ contentType: 'application/json', body: JSON.stringify([{ lat: '51.8490', lon: '8.2893', name: '', display_name: '3, Mozartstraße, Rheda, Rheda-Wiedenbrück, Kreis Gütersloh, Nordrhein-Westfalen, 33378, Deutschland', address: { house_number: '3', road: 'Mozartstraße', ...NRW } }]) });
    if (/Grenzgebiet/.test(q)) return r.fulfill({ contentType: 'application/json', body: JSON.stringify([{ lat: '52.27', lon: '8.05', name: 'Lotter Straße', display_name: 'Lotter Straße, Osnabrück, Niedersachsen, 49078, Deutschland', address: { road: 'Lotter Straße', state: 'Niedersachsen', 'ISO3166-2-lvl4': 'DE-NI' } }]) });
    return r.fulfill({ contentType: 'application/json', body: JSON.stringify([ORT('Mozartstraße', 51.8487816, 8.2891470)]) });
  });

  const sichtbar = (sel) => page.evaluate((s) => { const e = document.querySelector(s); if (!e) return false; const r = e.getBoundingClientRect(); return getComputedStyle(e).display !== 'none' && r.width > 0 && r.height > 0; }, sel);
  const anzahl = (sel) => page.evaluate((s) => [...document.querySelectorAll(s)].filter((e) => e.getClientRects().length).length, sel);
  const text = (sel) => page.evaluate((s) => (document.querySelector(s) || {}).innerText || '', sel);

  // ---- 1. Startbildschirm: Bedienfeld versteckt ----
  await page.goto(URL_APP); await page.waitForTimeout(1500);
  pruefe('1 Start: unteres Bedienfeld ist unsichtbar', !(await sichtbar('#gp-panel')));
  await page.screenshot({ path: 'd1-start.png' });
  // ---- 5. Adresssuche ----
  await page.fill('#search-input', 'Hausnummer Test'); await page.waitForSelector('.results__item');
  pruefe('7 Quellenangabe unter den Treffern nennt OpenStreetMap', /OpenStreetMap-Mitwirkende/.test(await text('.results__quelle')) && (await page.getAttribute('.results__quelle a', 'href')) === 'https://www.openstreetmap.org/copyright', await text('.results__quelle'));
  pruefe('7 Karten-Quellenangabe unverändert kurz', (await text('.maplibregl-ctrl-attrib')).replace(/\s+/g, ' ').trim() === '© Geobasis NRW (DOP)', (await text('.maplibregl-ctrl-attrib')).replace(/\s+/g, ' '));
  const titel = await text('.results__title'); const zusatz = await text('.results__subtitle');
  pruefe('5b Hausadresse: Titel ist Straße + Hausnummer', titel === 'Mozartstraße 3', `Titel „${titel}“ | Zusatz „${zusatz}“`);
  pruefe('5b Zusatz wiederholt die Straße nicht', !/Mozartstraße/.test(zusatz));
  pruefe('5c Anfrage begrenzt auf NRW (viewbox + bounded)', nominatim.at(-1).viewbox === '5.86,52.54,9.47,50.32' && nominatim.at(-1).bounded === '1', JSON.stringify(nominatim.at(-1)));

  await page.fill('#search-input', 'Grenzgebiet Test'); await page.waitForTimeout(1500);
  pruefe('5c Treffer außerhalb NRW wird nicht angeboten', (await anzahl('.results__item')) === 0 && /nur für Nordrhein-Westfalen/.test(await text('#search-hint')), await text('#search-hint'));

  // Enter darf keinen Treffer der vorherigen Suche übernehmen
  await page.fill('#search-input', 'Erste Straße'); await page.waitForSelector('.results__item');
  await page.fill('#search-input', 'Zweite Straße'); await page.press('#search-input', 'Enter');
  await page.waitForTimeout(300);
  pruefe('5a Enter mit veralteter Liste: nichts übernommen, alte Liste weg', (await page.inputValue('#search-input')) === 'Zweite Straße' && !(await sichtbar('#gp-panel')) && (await anzahl('.results__item')) === 0, `Feld „${await page.inputValue('#search-input')}“`);
  pruefe('5 Spinner läuft, solange die neue Suche unterwegs ist', await sichtbar('#search-spinner'));
  await page.waitForSelector('.results__item');
  pruefe('5a Danach erscheint die Liste zur neuen Eingabe', (await text('.results__title')) === 'Zweite Straße');
  await page.press('#search-input', 'Enter'); await page.waitForTimeout(400);
  pruefe('5a Zweites Enter übernimmt den passenden Treffer', (await page.inputValue('#search-input')) === 'Zweite Straße' && (await sichtbar('#gp-panel')), await text('#search-hint'));

  // Zwei echte Anfragen an Nominatim (sparsam, nur mit ECHT=1): Hausadresse in NRW und ein Ort außerhalb
  if (process.env.ECHT) {
  echt = true;
  const antwort = page.waitForResponse((r) => r.url().includes('nominatim'));
  await page.fill('#search-input', 'Mozartstraße 3, Rheda-Wiedenbrück');
  const roh = await (await antwort).json();
  await page.waitForTimeout(600);
  console.log('      echte Antwort: ' + roh.length + ' Treffer; Adressfelder des ersten: ' + JSON.stringify(roh[0] && roh[0].address));
  pruefe('5 echt: Hausadresse erscheint als „Mozartstraße 3“', (await text('.results__title')) === 'Mozartstraße 3', `Titel „${await text('.results__title')}“ | Zusatz „${await text('.results__subtitle')}“`);
  await page.waitForTimeout(2500);
  const antwort2 = page.waitForResponse((r) => r.url().includes('nominatim'));
  await page.fill('#search-input', 'Brandenburger Tor, Berlin');
  const roh2 = await (await antwort2).json(); await page.waitForTimeout(600);
  pruefe('5 echt: Berlin liefert keinen Treffer und die NRW-Meldung', (await anzahl('.results__item')) === 0 && /nur für Nordrhein-Westfalen/.test(await text('#search-hint')), `Nominatim lieferte ${roh2.length} Treffer; Hinweis: ${await text('#search-hint')}`);
  echt = false;
  }

  // ---- Zur Testadresse fliegen ----
  await page.fill('#search-input', 'Mozartstraße'); await page.waitForSelector('.results__item'); await page.click('.results__item');
  await page.waitForTimeout(7000);

  // ---- 4. Grundstückswahl: verspätete Antwort nach „Abbrechen“ ----
  await page.click('#gp-aktion');
  await page.route('**/www.wfs.nrw.de/**', async (r) => { await warte(2500); r.continue(); });
  await page.mouse.click(640, 310); await page.waitForTimeout(400);
  await page.click('#gp-zurueck'); // Abbrechen, bevor die Antwort da ist
  await page.waitForTimeout(3500);
  pruefe('4 Verspätete Antwort nach „Abbrechen“ wird verworfen', /Wähle dein Grundstück/.test(await text('#gp-text')) && (await text('#gp-aktion')) === 'Grundstück auswählen', await text('#gp-text'));
  await page.unroute('**/www.wfs.nrw.de/**');

  // ---- 4. Doppelklick wählt genau einmal ----
  await page.click('#gp-aktion');
  const vorher = wfs.length;
  await page.mouse.dblclick(640, 310); await page.waitForTimeout(4000);
  pruefe('4 Doppelklick: Flurstück bleibt gewählt, nur eine Abfrage', /1 Flurstück gewählt/.test(await text('#gp-text')) && wfs.length - vorher === 1, `${await text('#gp-text')} | Abfragen: ${wfs.length - vorher}`);
  // Umschalten per bewusstem zweiten Tipp funktioniert weiter
  await page.mouse.click(640, 310); await page.waitForTimeout(3000);
  pruefe('4 Bewusster zweiter Tipp wählt weiterhin ab', /Tippe auf dein Grundstück/.test(await text('#gp-text')), await text('#gp-text'));
  await page.mouse.click(640, 310); await page.waitForTimeout(3000);
  await page.click('#gp-aktion'); await page.waitForTimeout(800); // OK, übernehmen
  pruefe('  Grundstück übernommen', /übernommen/.test(await text('#gp-text')), await text('#gp-text'));

  // ---- Editor ----
  await page.click('#gp-aktion'); await page.waitForTimeout(600);
  pruefe('1 Editor: Bedienfeld darunter ist wirklich versteckt', !(await sichtbar('#gp-panel')));
  pruefe('1 Editor: Formumschalter ohne gewählten Typ versteckt', !(await sichtbar('#ed-form')));
  const chips = await page.evaluate(() => { const box = document.getElementById('ed-toolbar').getBoundingClientRect(); return [...document.querySelectorAll('.chip')].map((c) => { const r = c.getBoundingClientRect(); return { t: c.innerText.trim(), ganz: r.left >= box.left && r.right <= box.right && r.width > 0 }; }); });
  pruefe('6 Desktop: alle 11 Typen vollständig sichtbar', chips.length === 11 && chips.every((c) => c.ganz), chips.filter((c) => !c.ganz).map((c) => c.t).join(', ') || 'alle sichtbar');
  await page.screenshot({ path: 'd2-editor.png' });

  await page.click('#ed-auto'); await page.waitForTimeout(5000);
  console.log('      Automatik: ' + (await text('#ed-hint')));
  await page.click('.chip[data-typ="terrasse"]'); await page.waitForTimeout(200);
  pruefe('1 Formumschalter erscheint bei gewähltem Flächentyp', await sichtbar('#ed-form'));
  await page.click('.chip[data-typ="baum"]'); await page.waitForTimeout(200);
  pruefe('1 Formumschalter verschwindet beim Baum', !(await sichtbar('#ed-form')));
  await page.mouse.click(880, 380); await page.waitForTimeout(500); // Baum setzen
  pruefe('  Baum gesetzt und gewählt (2 Griffe)', (await anzahl('.ed-griff')) === 2);
  await page.click('#ed-confirm'); await page.waitForTimeout(300);

  // Rasen löschen und als Restfläche neu anlegen -> liegt in der Liste NACH dem Baum
  await page.mouse.click(920, 320); await page.waitForTimeout(500);
  pruefe('  Rasen gewählt (keine Griffe, Löschen sichtbar)', (await anzahl('.ed-griff')) === 0 && (await sichtbar('#ed-delete')));
  await page.click('#ed-delete'); await page.waitForTimeout(300);
  await page.click('.chip[data-typ="rasen"]'); await page.waitForTimeout(200);
  await page.click('#ed-rest'); await page.waitForTimeout(600);
  await page.click('#ed-confirm'); await page.waitForTimeout(300);
  await page.mouse.click(880, 380); await page.waitForTimeout(500);
  pruefe('3 Baum unter später angelegtem Rasen bleibt wählbar', (await anzahl('.ed-griff')) === 2, 'Griffe: ' + (await anzahl('.ed-griff')));
  await page.screenshot({ path: 'd3-baum-gewaehlt.png' });

  // Tipp auf einen Griff ohne Ziehen: Auswahl bleibt
  let griffe = await page.evaluate(() => [...document.querySelectorAll('.ed-griff')].map((e) => { const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, k: e.className }; }));
  await page.mouse.click(griffe[1].x, griffe[1].y); await page.waitForTimeout(400);
  pruefe('3 Tipp auf Radius-Griff: Auswahl bleibt', (await anzahl('.ed-griff')) === 2 && (await sichtbar('#ed-confirm')));
  await page.click('#ed-confirm'); await page.waitForTimeout(300);

  await page.mouse.click(745, 392); await page.waitForTimeout(500); // ein Gebäude
  const n = await anzahl('.ed-griff');
  griffe = await page.evaluate(() => [...document.querySelectorAll('.ed-griff')].map((e) => { const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, k: e.className }; }));
  let stabil = n > 2;
  for (const g of griffe.filter((g) => !/move/.test(g.k)).slice(0, 6)) { await page.mouse.click(g.x, g.y); await page.waitForTimeout(300); if ((await anzahl('.ed-griff')) !== n) stabil = false; }
  pruefe('3 Tipp auf Eck-Griffe eines Gebäudes: Auswahl bleibt', stabil, `Griffe vorher ${n}, nachher ${await anzahl('.ed-griff')}`);
  // Ziehen funktioniert weiterhin
  const g0 = griffe.find((g) => !/move/.test(g.k));
  const vorZiehen = await page.evaluate(() => JSON.stringify(Object.entries(localStorage)));
  await page.mouse.move(g0.x, g0.y); await page.mouse.down(); await page.mouse.move(g0.x + 25, g0.y + 15, { steps: 6 }); await page.mouse.up(); await page.waitForTimeout(500);
  pruefe('3 Ziehen eines Eck-Griffs ändert und speichert weiterhin', (await page.evaluate(() => JSON.stringify(Object.entries(localStorage)))) !== vorZiehen && (await anzahl('.ed-griff')) === n);
  await page.click('#ed-confirm'); await page.waitForTimeout(300);

  // Tipp ins Leere (auf die weiße Fläche) hebt die Auswahl weiterhin auf
  await page.mouse.click(745, 392); await page.waitForTimeout(400);
  await page.mouse.click(300, 300); await page.waitForTimeout(400);
  pruefe('3 Tipp neben alle Objekte hebt die Auswahl auf', (await anzahl('.ed-griff')) === 0 && !(await sichtbar('#ed-confirm')));

  // ---- 2. Editor schließen, neue Adresse: alter Plan verschwindet ----
  const etikettenVorher = await anzahl('.masslabel');
  await page.click('#ed-close'); await page.waitForTimeout(400);
  await page.fill('#search-input', 'Zweite Straße'); await page.waitForSelector('.results__item'); await page.click('.results__item');
  await page.waitForTimeout(1500);
  pruefe('2 Neue Adresse: Etiketten des alten Plans sind weg', (await anzahl('.masslabel')) === 0, `vorher ${etikettenVorher}, nachher ${await anzahl('.masslabel')}`);
  await page.waitForTimeout(6000);
  await page.screenshot({ path: 'd4-neue-adresse.png' });

  // Zurück zur ersten Adresse: der gespeicherte Plan ist noch da
  await page.fill('#search-input', 'Mozartstraße'); await page.waitForSelector('.results__item'); await page.click('.results__item');
  await page.waitForTimeout(7000);
  await page.click('#gp-aktion'); await page.mouse.click(640, 310); await page.waitForTimeout(3500);
  await page.click('#gp-aktion'); await page.waitForTimeout(500); await page.click('#gp-aktion'); await page.waitForTimeout(800);
  pruefe('2 Gespeicherter Plan erscheint beim erneuten Öffnen wieder', (await anzahl('.masslabel')) > 8 && !(await sichtbar('#ed-auto')), 'Etiketten: ' + (await anzahl('.masslabel')));

  console.log('\nSeitenfehler: ' + (fehler.length ? fehler.join(' | ') : 'keine'));
  const bad = ergebnisse.filter((e) => !e.ok);
  console.log(`\nERGEBNIS: ${ergebnisse.length - bad.length} von ${ergebnisse.length} Prüfungen bestanden` + (bad.length ? ' – FEHLER: ' + bad.map((b) => b.name).join(' ; ') : ''));
  await browser.close();
  process.exit(bad.length ? 1 : 0);
})().catch((e) => { console.error('SKRIPTFEHLER', e); process.exit(1); });
