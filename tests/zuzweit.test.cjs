// =========================================================================
// Browser-Test „Zu zweit“: das Inselspiel in zwei Fenstern (Handy-Format)
// -------------------------------------------------------------------------
// Start-Frage hält die Welt an · „Neue Welt zu zweit“ (mit Neuladen) ·
// die Welt ruht, bis der Mitspieler da ist · gemeinsamer Start · Tempo und
// Pause bestimmt der Gastgeber · das Schiff des Gastes fährt gleichmäßig ·
// der Gast kann nicht speichern · Beenden, Abbrechen, Verlassen und
// Wiedereinstieg · kein Spielstand geht verloren.
// Alles über die echten Knöpfe; nur die Firebase-Datenbank ist nachgebaut
// (tests/firebase-nachbau.cjs).
// Aufruf: node tests/zuzweit.test.cjs http://127.0.0.1:5173/   (siehe browser.cjs)
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
    await p.waitForTimeout(700);
    await p.evaluate(() => { try { localStorage.clear(); localStorage.setItem('inselspiel-anleitung', '1'); sessionStorage.clear(); } catch (e) {} });
    await p.reload();
    await p.waitForTimeout(1100);
    await p.evaluate(MITSCHRIFT);
    return p;
  };
  const sicht = (seite, id) => seite.evaluate(i => getComputedStyle(document.getElementById(i)).display !== 'none', id);
  const fenster = seite => seite.evaluate(() => ({ offen: getComputedStyle(document.getElementById('mp-fenster')).display !== 'none',
    text: document.getElementById('mp-box').textContent.replace(/\s+/g, ' ').trim(),
    knoepfe: [...document.querySelectorAll('#mp-box button')].map(b => b.textContent.trim()) }));
  const kontorBauen = (seite, sid, rang) => seite.evaluate(([sid, rang]) => {
    const info = inselInfo(); const reihe = info.map((e, i) => ({ i, wert: e.wert })).sort((a, b) => b.wert - a.wert);
    const insel = reihe[rang].i;
    for (let i = 0; i < N * N; i++) {
      if (inselMarke[i] !== insel) continue;
      const x = i % N, y = (i / N) | 0;
      const hafen = freiesFeldNeben(x + 0.5, y + 0.5, seeFrei);
      if (!hafen || Math.hypot(hafen.x - x, hafen.y - y) > 3) continue;
      const s = spieler[sid].schiff; s.x = hafen.x; s.y = hafen.y; s.pfad = []; s.gesegelt = true;
      if (platzOK('kontor', x, y, sid).ok && platziere('kontor', x, y, sid)) return true;
    }
    return false;
  }, [sid, rang]);

  // ================= A. Die Start-Frage hält die Welt an =================
  const host = await neueSeite('HOST');
  await kontorBauen(host, 0, 0);
  await host.evaluate(() => { spielSpeichern(true); });
  await host.reload();
  await host.waitForTimeout(2200);
  await host.evaluate(MITSCHRIFT);
  let r = await host.evaluate(() => ({ frage: state.startFrage, zeit: state.spielzeit, laeuft: spielLaeuft(),
    overlay: getComputedStyle(document.getElementById('overlay')).display, knoepfe: [...document.querySelectorAll('#overlay-box button')].map(b => b.textContent.trim()) }));
  pruef('Start: Frage erscheint, die Welt ruht (auch nach 2 Sekunden noch Spielzeit 0)', r.frage && r.zeit === 0 && !r.laeuft && r.overlay === 'flex', r);
  pruef('Start: Knopf „Zu zweit spielen" ist dabei', r.knoepfe.some(k => /Zu zweit/.test(k)), r.knoepfe);
  await host.tap('#overlay-box button:has-text("Zu zweit")'); await host.waitForTimeout(200);
  let f = await fenster(host);
  pruef('Start: Mehrspieler-Fenster liegt über der Frage, mit Hinweis auf den Spielstand',
    f.offen && f.knoepfe.includes('Partie eröffnen') && /bisheriger Spielstand/.test(f.text), f);
  await host.tap('#mp-box button:has-text("Schließen")'); await host.waitForTimeout(200);
  r = await host.evaluate(() => ({ frage: state.startFrage, zeit: state.spielzeit, overlay: getComputedStyle(document.getElementById('overlay')).display }));
  pruef('Start: Nach dem Schließen ist die Frage wieder da, die Welt ruht weiter', r.frage && r.zeit === 0 && r.overlay === 'flex', r);
  await host.tap('#overlay-box button:has-text("Fortsetzen")'); await host.waitForTimeout(900);
  r = await host.evaluate(() => ({ frage: state.startFrage, kontor: state.kontorGebaut, zeit: state.spielzeit, laeuft: spielLaeuft() }));
  pruef('Start: „Fortsetzen" lädt den Stand, die Welt läuft', !r.frage && r.kontor && r.laeuft && r.zeit > 0, r);

  // ================= B. Neue Welt zu zweit: Neuladen, warten, gemeinsam starten =================
  db.modus = 'neu';
  await host.tap('#k-netz'); await host.waitForTimeout(200);
  f = await fenster(host);
  pruef('Laufende Welt: Auswahl „Neue Welt zu zweit" / „In dieser Welt weiterspielen"',
    f.knoepfe.includes('Neue Welt zu zweit') && f.knoepfe.includes('In dieser Welt weiterspielen'), f.knoepfe);
  const saatVorher = await host.evaluate(() => weltSaat);
  await Promise.all([host.waitForEvent('load'), host.tap('#mp-box button:has-text("Neue Welt zu zweit")')]);
  await host.waitForTimeout(1800);
  await host.evaluate(MITSCHRIFT);
  r = await host.evaluate(() => ({ an: MP.an, rolle: MP.rolle, code: MP.code, halt: state.mpHalt, frage: state.startFrage, zeit: state.spielzeit, laeuft: spielLaeuft(),
    saat: weltSaat, kontor: state.kontorGebaut, gebaeude: gebaeude.length, merker: sessionStorage.getItem('inselspiel-zu-zweit'),
    overlay: getComputedStyle(document.getElementById('overlay')).display, platz2: { ki: spieler[1].ki, name: spieler[1].name } }));
  f = await fenster(host);
  pruef('Neue Welt: nach dem Neuladen eröffnet sich die Partie von selbst (frische Welt, Code, kein Spielstand-Fenster)',
    r.an && r.rolle === 'gastgeber' && /^[A-Z2-9]{5}$/.test(r.code || '') && r.saat !== saatVorher && !r.kontor && r.gebaeude === 0 && r.merker === null && r.overlay === 'none' && !r.frage, r);
  pruef('Neue Welt: Wartefenster mit Code und „Abbrechen", Platz 2 ist frei', f.offen && /Warte auf deinen Mitspieler/.test(f.text) && f.text.includes(r.code) && f.knoepfe.join() === 'Abbrechen' && !r.platz2.ki, { f, r: r.platz2 });
  await host.waitForTimeout(3000);
  r = await host.evaluate(() => ({ zeit: state.spielzeit, halt: state.mpHalt, kiUnterwegs: spieler.filter(s => s.ki && (s.zielInsel >= 0 || s.schiff.pfad.length)).length }));
  pruef('Warten: die Welt ruht – Spielzeit bleibt 0, kein Computergegner sticht in See', r.zeit === 0 && r.halt && r.kiUnterwegs === 0, r);
  const code = await host.evaluate(() => MP.code);

  const gast = await neueSeite('GAST');
  await gast.tap('#k-netz'); await gast.waitForTimeout(150);
  await gast.fill('#mp-code', code);
  await gast.tap('#mp-box button:has-text("Beitreten")'); await gast.waitForTimeout(1300);
  r = await host.evaluate(() => ({ gastDa: MP.gastDa, halt: state.mpHalt, zeit: state.spielzeit, laeuft: spielLaeuft(), meld: _meld.slice(-3),
    fenster: getComputedStyle(document.getElementById('mp-fenster')).display }));
  pruef('Beitritt: beim Gastgeber schließt sich das Wartefenster, die Welt läuft an', r.gastDa && !r.halt && r.laeuft && r.fenster === 'none' && r.zeit > 0 && r.zeit < 3 && r.meld.some(m => /los geht/.test(m)), r);
  let rg = await gast.evaluate(() => ({ an: MP.an, rolle: MP.rolle, ich: ICH, zeit: state.spielzeit, klasse: document.body.classList.contains('gast'),
    fenster: getComputedStyle(document.getElementById('mp-fenster')).display, speichernKnopf: getComputedStyle(document.getElementById('k-speichern')).display }));
  pruef('Beitritt: Gast ist verbunden und beginnt bei derselben frühen Spielzeit', rg.an && rg.rolle === 'gast' && rg.ich === 1 && rg.fenster === 'none' && rg.zeit <= 3 && rg.klasse, rg);
  // Vorsprung: die Computergegner brechen erst nach rund 15 Spielsekunden auf
  await host.waitForTimeout(7000);
  r = await host.evaluate(() => ({ zeit: Math.round(state.spielzeit), kiUnterwegs: spieler.filter(s => s.ki && (s.zielInsel >= 0 || s.schiff.pfad.length)).length }));
  pruef('Start: nach rund 8 Sekunden ist noch kein Computergegner aufgebrochen', r.zeit >= 6 && r.zeit <= 11 && r.kiUnterwegs === 0, r);
  await host.waitForTimeout(13000);
  r = await host.evaluate(() => ({ zeit: Math.round(state.spielzeit), kiUnterwegs: spieler.filter(s => s.ki && (s.zielInsel >= 0 || s.schiff.pfad.length || s.kontor)).length }));
  pruef('Start: nach gut 20 Sekunden sind beide Computergegner unterwegs', r.zeit >= 19 && r.kiUnterwegs === 2, r);

  // ================= C. Tempo und Pause bestimmt der Gastgeber =================
  await host.tap('#k-tempo3'); await gast.waitForTimeout(900);
  rg = await gast.evaluate(() => ({ tempo: state.tempo, aktiv: [1, 2, 3].filter(n => document.getElementById('k-tempo' + n).classList.contains('aktiv')) }));
  pruef('Tempo: der Gast übernimmt 3× vom Gastgeber und zeigt es an', rg.tempo === 3 && rg.aktiv.join() === '3', rg);
  await gast.evaluate(() => { _meld.length = 0; });
  await gast.tap('#k-tempo1'); await gast.waitForTimeout(700);
  rg = await gast.evaluate(() => ({ tempo: state.tempo, aktiv: [1, 2, 3].filter(n => document.getElementById('k-tempo' + n).classList.contains('aktiv')), meld: _meld.slice() }));
  r = await host.evaluate(() => ({ tempo: state.tempo }));
  pruef('Tempo: tippt der Gast, ändert sich nichts – nur ein Hinweis', rg.tempo === 3 && rg.aktiv.join() === '3' && r.tempo === 3 && rg.meld.some(m => /bestimmt der Gastgeber/.test(m)), { rg, r });
  await gast.tap('#k-pause'); await gast.waitForTimeout(300);
  rg = await gast.evaluate(() => ({ pause: state.pause }));
  pruef('Pause: der Gast kann nicht pausieren', !rg.pause, rg);
  await host.tap('#k-tempo1'); await host.waitForTimeout(300);
  const zeitVorPause = await host.evaluate(() => state.spielzeit);
  await host.tap('#k-pause'); await gast.waitForTimeout(1000);
  const pauseSicht = () => gast.evaluate(() => { uiAktualisieren(); return { hostPause: MP.hostPause, knopf: document.getElementById('k-pause').textContent,
    marken: [...document.querySelectorAll('#lage .lage-marke')].map(e => e.textContent.trim()),
    netz: getComputedStyle(document.getElementById('netz-warnung')).display, alter: Date.now() - MP.hostGesehen }; });
  rg = await pauseSicht();
  pruef('Pause: der Gast sieht die Marke „Der Gastgeber pausiert" und das Pausenzeichen', rg.hostPause && rg.knopf === '▶' && rg.marken.some(m => /pausiert/.test(m)) && rg.netz === 'none', rg);
  await gast.waitForTimeout(10500);
  rg = await pauseSicht();
  r = await host.evaluate(z => ({ still: Math.abs(state.spielzeit - z) < 1.2 }), zeitVorPause);
  pruef('Pause: auch nach 10 Sekunden „pausiert", nicht „nicht erreichbar" (Lebenszeichen laufen weiter)', rg.marken.some(m => /pausiert/.test(m)) && rg.netz === 'none' && rg.alter < 4000 && r.still, { rg, r });
  await host.tap('#k-pause'); await gast.waitForTimeout(1000);
  rg = await pauseSicht();
  pruef('Pause: nach dem Fortsetzen verschwindet die Marke', !rg.hostPause && rg.knopf === '⏸' && !rg.marken.some(m => /pausiert/.test(m)), rg);

  // ================= D. Das Schiff des Gastes fährt gleichmäßig =================
  const ziel = await gast.evaluate(() => {
    // weit entferntes Wasserfeld, zu dem ein Seeweg führt
    const sx = Math.floor(schiff.x), sy = Math.floor(schiff.y);
    let beste = null;
    for (let y = 3; y < N - 3; y += 4) for (let x = 3; x < N - 3; x += 4) {
      if (kachel(x, y).typ !== 'wasser') continue;
      const d = Math.hypot(x - sx, y - sy);
      if (d < 40 || d > 70) continue;
      if (!beste || d > beste.d) beste = { x, y, d };
    }
    return beste;
  });
  await gast.evaluate(z => { MP.ausgang({ art: 'schiff', tx: z.x, ty: z.y, zeit: Date.now() }); }, ziel);
  await gast.waitForTimeout(1500);       // anfahren lassen
  // Beide Geräte messen im selben Zeitraum, Bild für Bild: beim Gastgeber
  // die wirkliche Fahrt, beim Gast die nachgeführte
  const messen = seite => seite.evaluate(async () => {
    const s = spieler[1].schiff;
    const proben = []; const ende = performance.now() + 4000;
    await new Promise(fertig => { const f = () => { proben.push([performance.now(), s.x, s.y]); if (performance.now() < ende) requestAnimationFrame(f); else fertig(); }; requestAnimationFrame(f); });
    let stehend = 0, maxSprung = 0, weg = 0;
    for (let i = 1; i < proben.length; i++) {
      const d = Math.hypot(proben[i][1] - proben[i - 1][1], proben[i][2] - proben[i - 1][2]);
      if (d < 1e-5) stehend++; if (d > maxSprung) maxSprung = d; weg += d;
    }
    const a = proben[0], z = proben[proben.length - 1];
    return { bilder: proben.length, stehend, anteilStehend: +(stehend / (proben.length - 1)).toFixed(3), maxSprung: +maxSprung.toFixed(3), weg: +weg.toFixed(2),
             luftlinie: +Math.hypot(z[1] - a[1], z[2] - a[2]).toFixed(2) };
  });
  const [fahrt, fahrtHost] = await Promise.all([messen(gast), messen(host)]);
  pruef('Schiff beim Gast: fährt durchgehend (kaum stehende Bilder), ohne Sprünge, so weit wie beim Gastgeber',
    fahrt.anteilStehend < 0.08 && fahrt.maxSprung < 0.25 && fahrtHost.luftlinie > 5 && Math.abs(fahrt.luftlinie - fahrtHost.luftlinie) < 1.5, { fahrt, fahrtHost });
  r = await host.evaluate(() => ({ gesegelt: spieler[1].schiff.gesegelt, faehrt: spieler[1].schiff.pfad.length > 0 }));
  pruef('Gastgeber: das Schiff des Gastes ist unterwegs (und gilt als „entschieden")', r.gesegelt && r.faehrt, r);

  // ================= E. Speichern bleibt beim Gastgeber =================
  rg = await gast.evaluate(() => ({ ergebnis: spielSpeichern(false), stand: localStorage.getItem(STAND_SCHLUESSEL), knopf: getComputedStyle(document.getElementById('k-speichern')).display,
    laden: spielLaden(false) }));
  pruef('Gast: kann weder speichern noch laden, sein eigener Speicherplatz bleibt unberührt', rg.ergebnis === false && rg.stand === null && rg.knopf === 'none' && rg.laden === false, rg);
  r = await host.evaluate(() => ({ laden: spielLaden(false), an: MP.an }));
  pruef('Gastgeber: Laden ist während der Partie gesperrt', r.laden === false && r.an, r);

  // ================= F. Der Gastgeber beendet die Partie =================
  await host.tap('#k-netz'); await host.waitForTimeout(200);
  f = await fenster(host);
  pruef('Gastgeber: Fenster bietet „Partie beenden"', f.knoepfe.includes('Partie beenden') && f.knoepfe.includes('Weiterspielen'), f.knoepfe);
  await host.tap('#mp-box button:has-text("Partie beenden")'); await host.waitForTimeout(900);
  r = await host.evaluate(() => ({ an: MP.an, platz2: { ki: spieler[1].ki, name: spieler[1].name }, laeuft: spielLaeuft(), fenster: getComputedStyle(document.getElementById('mp-fenster')).display }));
  pruef('Beenden: Gastgeber spielt allein weiter, Platz 2 gehört wieder der Computergegnerin', !r.an && r.platz2.ki && r.platz2.name === 'Isabella' && r.laeuft && r.fenster === 'none', r);
  pruef('Beenden: die Partie ist aus der Datenbank verschwunden', db.holen('inselspiel/' + code) === null, db.holen('inselspiel/' + code));
  await gast.waitForTimeout(600);
  f = await fenster(gast);
  pruef('Beenden: der Gast erfährt es und kommt zurück zu seinem Spiel', f.offen && /Partie beendet/.test(f.text) && f.knoepfe.join() === 'Zu meinem Spiel', f);

  // ================= G. In dieser Welt weiterspielen – und abbrechen =================
  await kontorBauen(host, 0, 0);
  await host.waitForTimeout(400);
  await host.tap('#k-netz'); await host.waitForTimeout(200);
  await host.tap('#mp-box button:has-text("In dieser Welt weiterspielen")'); await host.waitForTimeout(900);
  r = await host.evaluate(() => ({ an: MP.an, halt: state.mpHalt, zeit: state.spielzeit, code: MP.code, geb: gebaeude.length }));
  f = await fenster(host);
  pruef('Weiterspielen: Partie in der laufenden Welt eröffnet (kein Neuladen), die Welt ruht', r.an && r.halt && r.geb >= 1 && /Warte auf deinen Mitspieler/.test(f.text), { r, f: f.knoepfe });
  await host.waitForTimeout(2000);
  const r2 = await host.evaluate(() => ({ zeit: state.spielzeit }));
  pruef('Weiterspielen: während des Wartens steht die Spielzeit', r2.zeit === r.zeit, { r: r.zeit, r2: r2.zeit });
  const code2 = r.code;
  await host.tap('#mp-box button:has-text("Abbrechen")'); await host.waitForTimeout(700);
  r = await host.evaluate(() => ({ an: MP.an, halt: state.mpHalt, laeuft: spielLaeuft(), platz2: spieler[1].ki, fenster: getComputedStyle(document.getElementById('mp-fenster')).display }));
  pruef('Abbrechen: Partie weg, Welt läuft wieder, Computergegnerin zurück', !r.an && !r.halt && r.laeuft && r.platz2 && r.fenster === 'none' && db.holen('inselspiel/' + code2) === null, r);

  // ================= H. „Neue Welt zu zweit" und dann doch abbrechen: der alte Stand bleibt erreichbar =================
  await host.evaluate(() => { spielSpeichern(true); });
  const kern = seite => seite.evaluate(() => { const d = JSON.parse(localStorage.getItem(STAND_SCHLUESSEL) || 'null'); return d ? [d.weltSaat, d.gebaeude.length, d.kontorGebaut].join('/') : null; });
  const standHost = await kern(host);
  await host.tap('#k-netz'); await host.waitForTimeout(200);
  await Promise.all([host.waitForEvent('load'), host.tap('#mp-box button:has-text("Neue Welt zu zweit")')]);
  await host.waitForTimeout(1800);
  await host.evaluate(MITSCHRIFT);
  f = await fenster(host);
  pruef('Abbruch-Fall: Wartefenster nach dem Neuladen', f.offen && /Warte auf deinen Mitspieler/.test(f.text), f);
  await host.tap('#mp-box button:has-text("Abbrechen")'); await host.waitForTimeout(700);
  r = await host.evaluate(() => ({ an: MP.an, frage: state.startFrage, laeuft: spielLaeuft(), zeit: state.spielzeit,
    overlay: getComputedStyle(document.getElementById('overlay')).display }));
  const standHostDanach = await kern(host);
  pruef('Abbruch-Fall: die Frage nach dem alten Spielstand kommt zurück, die Welt ruht, der Stand ist derselbe',
    !r.an && r.frage && !r.laeuft && r.zeit === 0 && r.overlay === 'flex' && standHostDanach === standHost, { r, standHost, standHostDanach });
  await host.tap('#overlay-box button:has-text("Fortsetzen")'); await host.waitForTimeout(800);
  r = await host.evaluate(() => ({ kontor: state.kontorGebaut, laeuft: spielLaeuft() }));
  pruef('Abbruch-Fall: „Fortsetzen" bringt das alte Spiel zurück', r.kontor && r.laeuft, r);

  // ================= I. Ein Gast mit eigenem Spielstand: der bleibt unangetastet =================
  const gast2 = await neueSeite('GAST2');
  await kontorBauen(gast2, 0, 1);
  await gast2.evaluate(() => { spielSpeichern(true); });
  await gast2.reload(); await gast2.waitForTimeout(1500);
  await gast2.evaluate(MITSCHRIFT);
  const standGast = await gast2.evaluate(() => localStorage.getItem(STAND_SCHLUESSEL));
  pruef('Gast mit Spielstand: Stand vorhanden, Start-Frage offen', !!standGast && await gast2.evaluate(() => state.startFrage));
  // der Gastgeber eröffnet in seiner laufenden Welt
  await host.tap('#k-netz'); await host.waitForTimeout(200);
  await host.tap('#mp-box button:has-text("In dieser Welt weiterspielen")'); await host.waitForTimeout(900);
  const code3 = await host.evaluate(() => MP.code);
  // der Gast kommt direkt von der Start-Frage aus hinein
  await gast2.tap('#overlay-box button:has-text("Zu zweit")'); await gast2.waitForTimeout(200);
  await gast2.fill('#mp-code', code3);
  await gast2.tap('#mp-box button:has-text("Beitreten")'); await gast2.waitForTimeout(2500);
  rg = await gast2.evaluate(() => { window.dispatchEvent(new Event('pagehide')); return { an: MP.an, rolle: MP.rolle, frage: state.startFrage,
    overlay: getComputedStyle(document.getElementById('overlay')).display, geb: gebaeude.length, stand: localStorage.getItem(STAND_SCHLUESSEL) }; });
  pruef('Gast mit Spielstand: tritt von der Start-Frage aus bei, sieht die Welt des Gastgebers', rg.an && rg.rolle === 'gast' && !rg.frage && rg.overlay === 'none' && rg.geb >= 1, { ...rg, stand: undefined });
  pruef('Gast mit Spielstand: sein eigener Stand ist unverändert (auch beim Verlassen der Seite)', rg.stand === standGast);
  r = await host.evaluate(() => ({ gastDa: MP.gastDa, halt: state.mpHalt }));
  pruef('Gastgeber: Mitspieler ist da, die Welt läuft', r.gastDa && !r.halt, r);
  // der Gast verlässt die Partie
  await host.evaluate(() => { _meld.length = 0; });
  await gast2.tap('#k-netz'); await gast2.waitForTimeout(200);
  f = await fenster(gast2);
  pruef('Gast: Fenster bietet „Partie verlassen"', f.knoepfe.includes('Partie verlassen'), f.knoepfe);
  await Promise.all([gast2.waitForEvent('load'), gast2.tap('#mp-box button:has-text("Partie verlassen")')]);
  await gast2.waitForTimeout(1500);
  rg = await gast2.evaluate(() => ({ an: MP.an, frage: state.startFrage, stand: localStorage.getItem(STAND_SCHLUESSEL), klasse: document.body.classList.contains('gast') }));
  pruef('Verlassen: der Gast ist zurück bei seinem eigenen Spiel (Frage „Weiterspielen?", Stand unverändert)', !rg.an && rg.frage && rg.stand === standGast && !rg.klasse, { ...rg, stand: rg.stand === standGast });
  r = await host.evaluate(() => ({ gastDa: MP.gastDa, meld: _meld.slice(-2), an: MP.an }));
  pruef('Verlassen: der Gastgeber erfährt es und spielt weiter', !r.gastDa && r.an && r.meld.some(m => /verlassen/.test(m)), r);
  // … und mit demselben Code wieder einsteigen
  await host.evaluate(() => { _meld.length = 0; });
  await gast2.tap('#overlay-box button:has-text("Zu zweit")'); await gast2.waitForTimeout(200);
  await gast2.fill('#mp-code', code3);
  await gast2.tap('#mp-box button:has-text("Beitreten")'); await gast2.waitForTimeout(2500);
  rg = await gast2.evaluate(() => ({ an: MP.an, rolle: MP.rolle, geb: gebaeude.length, zeit: state.spielzeit }));
  r = await host.evaluate(() => ({ gastDa: MP.gastDa, meld: _meld.slice(-2), geb: gebaeude.length, laeuft: spielLaeuft() }));
  pruef('Wiedereinstieg: mit demselben Code zurück in die laufende Partie', rg.an && rg.rolle === 'gast' && rg.geb >= 1 && Math.abs(rg.geb - r.geb) <= 1 && r.gastDa && r.laeuft && r.meld.some(m => /wieder da/.test(m)), { rg, r });
  await host.evaluate(() => partieBeenden());

  pruef('Regeln: kein Zugriff des Spiels wurde verweigert', db.verweigert.length === 0, db.verweigert.slice(0, 6));

  await new Promise((weiter) => setTimeout(weiter, 400)); // auch späte Fehler noch mitnehmen
  pruef('Keine Fehler auf den Seiten', fehler.length === 0, [...new Set(fehler)].slice(0, 6));
  const bad = ergebnisse.filter((e) => !e.ok);
  console.log(`\nERGEBNIS: ${ergebnisse.length - bad.length} von ${ergebnisse.length} Prüfungen bestanden` + (bad.length ? ' – FEHLER: ' + bad.map((b) => b.name).join(' ; ') : ''));
  await browser.close();
  process.exit(bad.length ? 1 : 0);
})().catch((e) => { console.error('SKRIPTFEHLER', e); process.exit(1); });
