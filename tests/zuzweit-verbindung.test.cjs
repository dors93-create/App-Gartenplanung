// =========================================================================
// Browser-Test „Zu zweit – Verbindung“: Eröffnen und Beitreten (Handy-Format)
// -------------------------------------------------------------------------
// Was sagt das Spiel, wenn die Datenbank ablehnt (Freigabe fehlt) oder gar
// nicht antwortet? Dann der ganze Weg mit freigegebener Datenbank: eröffnen,
// warten, beitreten, Stand übertragen, der Gast baut und handelt, Befehle
// werden gelöscht, ein kaputtes Datenpaket hält das Spiel nicht an, Pause
// und Funkstille des Gastgebers.
// Alles über die echten Knöpfe; nur die Firebase-Datenbank ist nachgebaut
// (tests/firebase-nachbau.cjs).
// Aufruf: node tests/zuzweit-verbindung.test.cjs http://127.0.0.1:5173/   (siehe browser.cjs)
// =========================================================================
const { chromium } = require('playwright');
const { nachbau, MITSCHRIFT } = require('./firebase-nachbau.cjs');
const URL_SPIEL = (process.argv[2] || 'http://127.0.0.1:5173/') + 'inselspiel.html';

(async () => {
  const browser = await chromium.launch();
  const db = nachbau();
  const fehler = [];
  // Jede Prüfung wird gezählt; am Ende entscheidet die Summe über Erfolg.
  const ergebnisse = [];
  const pruef = (name, ok, detail) => {
    ergebnisse.push({ name, ok: !!ok });
    console.log((ok ? 'OK    ' : 'FEHLER') + ' ' + name + (!ok && detail !== undefined ? '  -> ' + JSON.stringify(detail).slice(0, 900) : ''));
  };
  const neueSeite = async name => {
    const p = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    p.on('pageerror', e => fehler.push(name + ' PAGEERROR: ' + e.message + ' @ ' + (e.stack || '').split('\n')[1]));
    p.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|ERR_/.test(m.text())) fehler.push(name + ' CONSOLE: ' + m.text()); });
    await db.anbinden(p, name);
    await p.goto(URL_SPIEL);
    await p.waitForTimeout(800);
    await p.evaluate(() => { try { localStorage.clear(); localStorage.setItem('inselspiel-anleitung', '1'); } catch (e) {} });
    await p.reload();
    await p.waitForTimeout(1200);
    await p.evaluate(MITSCHRIFT);
    await p.evaluate(() => { document.getElementById('hinweis').style.display = 'none'; });
    return p;
  };
  const host = await neueSeite('HOST');
  const gast = await neueSeite('GAST');
  const status = seite => seite.evaluate(() => (document.getElementById('mp-status') || {}).textContent || '');
  const fenster = seite => seite.evaluate(() => ({ offen: getComputedStyle(document.getElementById('mp-fenster')).display !== 'none',
    text: document.getElementById('mp-box').textContent.replace(/\s+/g, ' ').trim().slice(0, 160) }));

  // ---------- 1. Regeln wie bisher: nur Kegelpegel erlaubt ----------
  db.modus = 'alt';
  await host.tap('#k-netz'); await host.waitForTimeout(150);
  await host.tap('#mp-box button.knopf-gruen'); await host.waitForTimeout(500);
  let s = await status(host);
  let r = await host.evaluate(() => ({ an: MP.an, t0: state.spielzeit }));
  pruef('Alte Regeln, Eröffnen: verständliche Meldung statt „permission_denied"',
    /Datenbank lässt das Inselspiel noch nicht zu/.test(s) && /Regeln/.test(s) && !/PERMISSION_DENIED/.test(s) && !r.an, s);
  // Solange das Fenster offen ist, ruht die Welt (fairer Start beim nächsten Versuch) …
  await host.waitForTimeout(600);
  let r2 = await host.evaluate(() => ({ t1: state.spielzeit, halt: state.mpHalt }));
  pruef('Alte Regeln: bei offenem Fenster ruht die Welt', r2.t1 === r.t0 && r2.halt, { r, r2 });
  // … und nach dem Schließen läuft sie normal weiter
  await host.tap('#mp-box button:has-text("Schließen")'); await host.waitForTimeout(600);
  r2 = await host.evaluate(() => ({ t1: state.spielzeit, halt: state.mpHalt }));
  pruef('Alte Regeln: nach dem Schließen läuft das Spiel normal weiter', r2.t1 > r.t0 && !r2.halt, { r, r2 });
  await host.tap('#k-netz'); await host.waitForTimeout(150);
  await gast.tap('#k-netz'); await gast.waitForTimeout(150);
  await gast.fill('#mp-code', 'abcde');
  await gast.tap('text=Beitreten'); await gast.waitForTimeout(500);
  s = await status(gast);
  pruef('Alte Regeln, Beitreten: dieselbe verständliche Meldung', /Datenbank lässt das Inselspiel noch nicht zu/.test(s) && !/[Pp]ermission denied/.test(s), s);

  // ---------- 2. Datenbank antwortet nicht ----------
  db.modus = 'stumm';
  await host.tap('#mp-box button.knopf-gruen'); await host.waitForTimeout(1500);
  s = await status(host);
  pruef('Keine Antwort: zunächst „Verbinde …"', /Verbinde/.test(s), s);
  await host.waitForTimeout(15000);
  s = await status(host);
  r = await host.evaluate(() => ({ an: MP.an }));
  pruef('Keine Antwort: nach der Frist ein klarer Hinweis statt Dauerwarten', /antwortet nicht/.test(s) && !r.an, s);

  // ---------- 3. Neue Regeln: inselspiel/$code erlaubt ----------
  db.modus = 'neu'; db.verweigert.length = 0;
  await host.tap('#mp-box button.knopf-gruen'); await host.waitForTimeout(600);
  r = await host.evaluate(() => ({ an: MP.an, rolle: MP.rolle, code: MP.code, pfad: MP.pfad }));
  let f = await fenster(host);
  pruef('Neue Regeln: Partie eröffnet, Code wird angezeigt', r.an && r.rolle === 'gastgeber' && /^[A-Z2-9]{5}$/.test(r.code) && f.offen && f.text.includes(r.code), { r, f });
  const code = r.code;
  const welt = db.lesen(db.holen('inselspiel/' + code + '/welt'));
  pruef('Datenbank: Startwert und Fassung der Welt liegen unter dem Code', welt && welt.saat > 0 && welt.fassung === 3, welt);
  let w = await fenster(host);
  pruef('Gastgeber: Wartefenster, die Welt ruht bis zum Beitritt', w.offen && /Warte auf deinen Mitspieler/.test(w.text) && await host.evaluate(() => state.mpHalt), w);

  await gast.fill('#mp-code', code.toLowerCase());
  await gast.tap('text=Beitreten'); await gast.waitForTimeout(1500);
  r = await gast.evaluate(() => ({ an: MP.an, rolle: MP.rolle, ich: ICH, saat: weltSaat, werkzeug: state.werkzeug, meld: _meld.slice(-3) }));
  f = await fenster(gast);
  pruef('Gast: beigetreten (auch mit klein getipptem Code), Fenster zu, Rolle Gast', r.an && r.rolle === 'gast' && r.ich === 1 && !f.offen && r.saat === welt.saat && r.meld.some(m => /Verbunden/.test(m)), { r, f });
  await host.waitForTimeout(600);
  r = await host.evaluate(() => ({ gastDa: MP.gastDa, name: spieler[1].name, ki: spieler[1].ki, meld: _meld.slice(-3), halt: state.mpHalt,
    fenster: getComputedStyle(document.getElementById('mp-fenster')).display }));
  pruef('Gastgeber: erfährt vom Beitritt, Fenster schließt sich, die Welt läuft', r.gastDa && !r.ki && !r.halt && r.fenster === 'none' && r.meld.some(m => /los geht/.test(m)), r);
  const gleicheKarte = (await host.evaluate(() => karte.map(k => k.typ[0]).join(''))) === (await gast.evaluate(() => karte.map(k => k.typ[0]).join('')));
  pruef('Beide Geräte haben dieselbe Karte', gleicheKarte);

  // ---------- 4. Stand fließt: Gastgeber baut, Gast sieht es ----------
  await host.evaluate(() => {
    const info = inselInfo(); const reihe = info.map((e, i) => ({ i, wert: e.wert })).sort((a, b) => b.wert - a.wert);
    window._inseln = reihe.map(e => e.i);
    for (let i = 0; i < N * N; i++) {
      if (inselMarke[i] !== reihe[0].i) continue;
      const x = i % N, y = (i / N) | 0;
      const hafen = freiesFeldNeben(x + 0.5, y + 0.5, seeFrei);
      if (!hafen || Math.hypot(hafen.x - x, hafen.y - y) > 3) continue;
      spieler[0].schiff.x = hafen.x; spieler[0].schiff.y = hafen.y; spieler[0].schiff.pfad = [];
      if (platzOK('kontor', x, y, 0).ok && platziere('kontor', x, y, 0)) break;
    }
    spieler[0].res.gold = 77777;
  });
  await host.waitForTimeout(2500);
  r = await gast.evaluate(() => ({ gebaeude: gebaeude.filter(g => g.spieler === 0).length, hostKontor: !!spieler[0].kontor, hostGold: Math.round(spieler[0].res.gold), zeit: state.spielzeit, puls: MP.hostGesehen > 0 }));
  pruef('Gast: sieht Kontor und Gold des Gastgebers, Lebenszeichen kommt an', r.gebaeude === 1 && r.hostKontor && Math.abs(r.hostGold - 77777) < 2000 && r.puls, r);

  // ---------- 5. Gast baut sein Kontor mit echten Fingertipps ----------
  // (sein Schiff steht dafür schon vor der zweiten großen Insel)
  const platz = await host.evaluate(() => {
    for (let i = 0; i < N * N; i++) {
      if (inselMarke[i] !== _inseln[1]) continue;
      const x = i % N, y = (i / N) | 0;
      const hafen = freiesFeldNeben(x + 0.5, y + 0.5, seeFrei);
      if (!hafen || Math.hypot(hafen.x - x, hafen.y - y) > 3) continue;
      spieler[1].schiff.x = hafen.x; spieler[1].schiff.y = hafen.y; spieler[1].schiff.pfad = [];
      if (platzOK('kontor', x, y, 1).ok) return { x, y };
    }
    return null;
  });
  await host.waitForTimeout(900);     // Schiffsposition reist mit dem nächsten Takt zum Gast
  const tipp = await gast.evaluate(p => {
    werkzeugWaehlen('kontor');
    kamera.zoom = 1; kameraAuf(p.x + 1, p.y + 1); zeichnen();
    const wx = isoX(p.x + 0.5, p.y + 0.5), wy = isoY(p.x + 0.5, p.y + 0.5) - hoeheBei(p.x, p.y);
    return { sx: (wx - kamera.x) * kamera.zoom, sy: (wy - kamera.y) * kamera.zoom, schiff: [spieler[1].schiff.x, spieler[1].schiff.y] };
  }, platz);
  await gast.touchscreen.tap(tipp.sx, tipp.sy); await gast.waitForTimeout(200);
  r = await gast.evaluate(() => ({ leiste: getComputedStyle(document.getElementById('bestaetigung')).display, text: document.getElementById('bestaetigung-text').textContent, okAus: document.getElementById('b-ok').disabled }));
  pruef('Gast: Bauvorschau fürs Kontor erscheint und ist bestätigbar', r.leiste === 'flex' && !r.okAus, r);
  await gast.tap('#b-ok'); await gast.waitForTimeout(2600);
  // (gezählt wird je Besitzer – die Computergegner landen irgendwann von selbst)
  r = await host.evaluate(() => ({ kontorGast: !!spieler[1].kontor, gebaeude: gebaeude.filter(g => g.spieler === 1).length, alle: gebaeude.length }));
  pruef('Gastgeber: Baubefehl des Gastes ausgeführt', r.kontorGast && r.gebaeude === 1, r);
  const alleBeimHost = r.alle;
  r = await gast.evaluate(() => ({ kontor: !!spieler[1].kontor, gebaut: state.kontorGebaut, gebaeude: gebaeude.filter(g => g.spieler === 1).length, alle: gebaeude.length }));
  pruef('Gast: sieht sein eigenes Kontor und gleich viele Gebäude wie der Gastgeber', r.kontor && r.gebaut && r.gebaeude === 1 && Math.abs(r.alle - alleBeimHost) <= 1, { r, alleBeimHost });
  pruef('Datenbank: Befehle werden nach der Annahme gelöscht', db.holen('inselspiel/' + code + '/befehle') === null || Object.keys(db.holen('inselspiel/' + code + '/befehle')).length === 0, db.holen('inselspiel/' + code + '/befehle'));

  // ---------- 6. Handel des Gastes ----------
  const goldVor = await host.evaluate(() => { spieler[1].res.gold = 20000; spieler[1].res.holz = 100; return 20000; });
  await host.waitForTimeout(900);
  await gast.evaluate(() => { handel('holz', 20); });
  await gast.waitForTimeout(2000);
  r = await host.evaluate(() => ({ holz: Math.round(spieler[1].res.holz), gold: Math.round(spieler[1].res.gold) }));
  const rg = await gast.evaluate(() => ({ holz: Math.round(res.holz), gold: Math.round(res.gold) }));
  pruef('Handel des Gastes: beim Gastgeber gebucht und zurückgemeldet', r.holz !== 100 && r.gold !== goldVor && Math.abs(rg.holz - r.holz) <= 2, { r, rg });

  // ---------- 7. Ein kaputtes Paket darf die Spielschleife nicht anhalten ----------
  r = await host.evaluate(async () => {
    const echt = taktPaket; const toast = document.getElementById('toast');
    const warte = ms => new Promise(z => setTimeout(z, ms));
    taktPaket = () => ({ t: 1, kaputt: undefined, zahl: NaN });
    const t0 = state.spielzeit;
    await warte(700);
    const ersterHinweis = toast.textContent;
    toast.textContent = 'MARKE';          // erscheint der Hinweis noch einmal, wird die Marke überschrieben
    await warte(900);
    const danach = toast.textContent;
    const t1 = state.spielzeit;
    taktPaket = echt;
    await warte(800);
    return { t0, t1, t2: state.spielzeit, geworfen: _fbGeworfen.length, ersterHinweis, danach };
  });
  pruef('Kaputtes Paket: Datenbank lehnt ab, Spiel läuft weiter, Hinweis erscheint einmal und nicht im Dauerfeuer',
    r.geworfen > 0 && r.t1 > r.t0 && r.t2 > r.t1 && /nicht beim Mitspieler/.test(r.ersterHinweis) && r.danach === 'MARKE', r);

  // ---------- 8. Gastgeber pausiert / sendet gar nicht mehr ----------
  await host.evaluate(() => { if (!state.pause) pauseUmschalten(); });
  await gast.waitForTimeout(1500);
  const marken = () => gast.evaluate(() => { uiAktualisieren(); return [...document.querySelectorAll('#lage .lage-marke')].map(e => e.textContent.trim()); });
  r = await marken();
  pruef('Gast: bei Pause des Gastgebers erscheint die Marke „pausiert"', r.some(m => /pausiert/.test(m)), r);
  await host.evaluate(() => { if (state.pause) pauseUmschalten(); });
  await gast.waitForTimeout(1500);
  r = await marken();
  pruef('Gast: die Marke verschwindet, wenn es weitergeht', !r.some(m => /pausiert/.test(m)), r);
  // Gerät des Gastgebers gesperrt oder ohne Netz: es kommt gar nichts mehr an
  await host.evaluate(() => { window._senden = mpSenden; mpSenden = () => {}; });
  await gast.waitForTimeout(10500);
  r = await gast.evaluate(() => { uiAktualisieren(); return { text: document.getElementById('netz-warnung').textContent, da: getComputedStyle(document.getElementById('netz-warnung')).display }; });
  pruef('Gast: Hinweis, wenn der Gastgeber nicht mehr sendet', r.da === 'block' && /nicht erreichbar/.test(r.text), r);
  await host.evaluate(() => { mpSenden = window._senden; });
  await gast.waitForTimeout(2500);
  r = await gast.evaluate(() => { uiAktualisieren(); return { da: getComputedStyle(document.getElementById('netz-warnung')).display }; });
  pruef('Gast: Hinweis verschwindet, sobald wieder gesendet wird', r.da === 'none', r);

  // ---------- 9. Die neuen Regeln genügen: nichts wurde verweigert ----------
  pruef('Neue Regeln: kein einziger Zugriff des Spiels wurde verweigert', db.verweigert.length === 0, db.verweigert.slice(0, 8));
  pruef('Regeln: fremde können die Liste aller Partien nicht lesen', !db.erlaubt('inselspiel', 'r') && db.erlaubt('inselspiel/' + code + '/welt', 'r') && !db.erlaubt('irgendwas', 'w'));


  await new Promise((weiter) => setTimeout(weiter, 400)); // auch späte Fehler noch mitnehmen
  pruef('Keine Fehler auf den Seiten', fehler.length === 0, [...new Set(fehler)].slice(0, 6));
  const bad = ergebnisse.filter((e) => !e.ok);
  console.log(`\nERGEBNIS: ${ergebnisse.length - bad.length} von ${ergebnisse.length} Prüfungen bestanden` + (bad.length ? ' – FEHLER: ' + bad.map((b) => b.name).join(' ; ') : ''));
  await browser.close();
  process.exit(bad.length ? 1 : 0);
})().catch((e) => { console.error('SKRIPTFEHLER', e); process.exit(1); });
