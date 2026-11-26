// =========================================================================
// Browser-Test „Inselspiel“: kurze Anleitung und Siegziel (Handy-Format)
// -------------------------------------------------------------------------
// Anleitung: erscheint beim allerersten Start, lässt sich überspringen,
// kommt danach nicht von selbst wieder, ist über ❓ erreichbar; solange sie
// offen ist, ruht die Welt.
// Siegziel: erst bei 1500 Siedlern – allein, durch einen Computergegner und
// im Spiel zu zweit (Gast gewinnt / Gastgeber gewinnt); dazu die beiden
// Spielstand-Fälle (gewonnenes Spiel laden, Stand aus der Zeit des
// 500er-Ziels).
// Die Firebase-Datenbank ist nachgebaut (tests/firebase-nachbau.cjs).
// Aufruf: node tests/inselspiel.test.cjs http://127.0.0.1:5173/   (siehe browser.cjs)
// =========================================================================
const { chromium } = require('playwright');
const { nachbau, MITSCHRIFT } = require('./firebase-nachbau.cjs');
const URL_SPIEL = (process.argv[2] || 'http://127.0.0.1:5173/') + 'inselspiel.html';

(async () => {
  const browser = await chromium.launch();
  const fehler = [];
  // Jede Prüfung wird gezählt; am Ende entscheidet die Summe über Erfolg.
  const ergebnisse = [];
  const pruef = (name, ok, detail) => {
    ergebnisse.push({ name, ok: !!ok });
    console.log((ok ? 'OK    ' : 'FEHLER') + ' ' + name + (!ok && detail !== undefined ? '  -> ' + JSON.stringify(detail).slice(0, 900) : ''));
  };
  const horche = (p, name) => {
    p.on('pageerror', e => fehler.push(name + ' PAGEERROR: ' + e.message + ' @ ' + (e.stack || '').split('\n')[1]));
    p.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|ERR_/.test(m.text())) fehler.push(name + ' CONSOLE: ' + m.text()); });
  };
  // gesehen = true: Anleitung gilt als schon gelesen (wie bei allen anderen Prüfungen)
  const neueSeite = async (name, gesehen, db) => {
    const p = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    horche(p, name);
    if (db) await db.anbinden(p, name);
    await p.goto(URL_SPIEL); await p.waitForTimeout(600);
    await p.evaluate(g => { try { localStorage.clear(); sessionStorage.clear(); if (g) localStorage.setItem('inselspiel-anleitung', '1'); } catch (e) {} }, gesehen);
    await p.reload(); await p.waitForTimeout(1100);
    return p;
  };
  const anl = seite => seite.evaluate(() => {
    const f = document.getElementById('anleitung'), b = document.getElementById('anleitung-box');
    const r = b.getBoundingClientRect();
    return { offen: getComputedStyle(f).display !== 'none', kopf: (b.querySelector('.kopf span') || {}).textContent || '',
      titel: (b.querySelector('h1') || {}).textContent || '', text: b.textContent.replace(/\s+/g, ' ').trim(),
      knoepfe: [...b.querySelectorAll('button')].map(x => x.textContent.trim()),
      hoehe: Math.round(r.height), oben: Math.round(r.top), unten: Math.round(r.bottom), rollt: b.scrollHeight > b.clientHeight + 1,
      zustand: state.anleitung, laeuft: spielLaeuft(), zeit: state.spielzeit, merker: localStorage.getItem('inselspiel-anleitung') };
  });
  const kontor = (seite, sid, rang) => seite.evaluate(([sid, rang]) => {
    const info = inselInfo(); const reihe = info.map((e, i) => ({ i, wert: e.wert })).sort((a, b) => b.wert - a.wert);
    for (let i = 0; i < N * N; i++) {
      if (inselMarke[i] !== reihe[rang].i) continue;
      const x = i % N, y = (i / N) | 0;
      const hafen = freiesFeldNeben(x + 0.5, y + 0.5, seeFrei);
      if (!hafen || Math.hypot(hafen.x - x, hafen.y - y) > 3) continue;
      const s = spieler[sid].schiff; s.x = hafen.x; s.y = hafen.y; s.pfad = []; s.gesegelt = true;
      if (platzOK('kontor', x, y, sid).ok && platziere('kontor', x, y, sid)) return true;
    }
    return false;
  }, [sid, rang]);
  // Häuser der höchsten Stufe rund ums Kontor; liefert die Zahl der Siedler darin
  const haeuser = (seite, sid, anzahl) => seite.evaluate(([sid, anzahl]) => {
    const sp = spieler[sid], k = sp.kontor; let n = 0, leute = 0;
    for (const w of Object.keys(sp.res)) sp.res[w] = Math.max(sp.res[w], 4000);
    sp.res.gold = 400000; sp.res.nahrung = 1e6; sp.maxStufe = 4;
    for (let r = 2; r <= 8 && n < anzahl; r++) for (let dy = -r; dy <= r && n < anzahl; dy++) for (let dx = -r; dx <= r && n < anzahl; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
      const x = k.x + dx, y = k.y + dy;
      if (x < 0 || y < 0 || x >= N || y >= N) continue;
      if (platzOK('wohnhaus', x, y, sid).ok && platziere('wohnhaus', x, y, sid)) {
        const h = belegt[y * N + x]; h.stufe = 4; h.ausbau = 3; h.maxEw = hausMaxEw(h); h.ew = h.maxEw - 2; leute += h.ew; n++;
      }
    }
    return { haeuser: n, leute };
  }, [sid, anzahl]);
  const overlay = seite => seite.evaluate(() => ({ offen: getComputedStyle(document.getElementById('overlay')).display !== 'none',
    text: document.getElementById('overlay-box').textContent.replace(/\s+/g, ' ').trim(),
    knoepfe: [...document.querySelectorAll('#overlay-box button')].map(b => b.textContent.trim()),
    vorbei: state.rennenVorbei, gewonnen: state.gewonnen, sieger: state.sieger, laeuft: spielLaeuft() }));

  // ================= A. Anleitung beim allerersten Start =================
  const seite = await neueSeite('ERST', false);
  await seite.waitForTimeout(1500);
  let a = await anl(seite);
  pruef('Erststart: Anleitung erscheint von selbst, Karte 1 von 6, nennt das Ziel 1500 Siedler',
    a.offen && /1 von 6/.test(a.kopf) && /1500 Siedler/.test(a.text) && a.zustand, a);
  pruef('Erststart: Knöpfe „Überspringen" und „Weiter", noch kein „Zurück"', a.knoepfe.some(k => /Überspringen/.test(k)) && a.knoepfe.includes('Weiter') && !a.knoepfe.includes('Zurück'), a.knoepfe);
  let r = await seite.evaluate(() => ({ zeit: state.spielzeit, unterwegs: spieler.filter(s => s.ki && (s.zielInsel >= 0 || s.schiff.pfad.length)).length }));
  pruef('Erststart: solange gelesen wird, ruht die Welt (Spielzeit 0, niemand sticht in See)', r.zeit === 0 && r.unterwegs === 0 && !a.laeuft, r);
  // alle Karten durchblättern, Maße merken
  const karten = [a];
  for (let i = 2; i <= 6; i++) {
    await seite.tap('#anleitung-box button:has-text("Weiter")'); await seite.waitForTimeout(120);
    karten.push(await anl(seite));
  }
  pruef('Blättern: sechs Karten mit eigenen Titeln, Zähler stimmt', new Set(karten.map(k => k.titel)).size === 6 && karten.every((k, i) => k.kopf.includes(`${i + 1} von 6`)), karten.map(k => k.kopf + ' | ' + k.titel));
  pruef('Handy: jede Karte passt ohne Rollen auf den Bildschirm', karten.every(k => !k.rollt && k.oben >= 0 && k.unten <= 844), karten.map(k => [k.oben, k.unten, k.hoehe, k.rollt]));
  a = karten[5];
  pruef('Letzte Karte: „Los geht\'s" und „Zurück"', a.knoepfe.includes("Los geht's") && a.knoepfe.includes('Zurück') && !a.knoepfe.includes('Weiter'), a.knoepfe);
  await seite.tap('#anleitung-box button:has-text("Zurück")'); await seite.waitForTimeout(120);
  a = await anl(seite);
  pruef('„Zurück" blättert eine Karte zurück', /5 von 6/.test(a.kopf), a.kopf);
  await seite.tap('#anleitung-box button:has-text("Weiter")'); await seite.waitForTimeout(120);
  await seite.tap('#anleitung-box button:has-text("Los geht")'); await seite.waitForTimeout(1200);
  a = await anl(seite);
  r = await seite.evaluate(() => ({ hinweis: getComputedStyle(document.getElementById('hinweis')).display, zeit: state.spielzeit }));
  pruef('„Los geht\'s": Anleitung zu, gemerkt, die Welt läuft, der Starthinweis steht da', !a.offen && !a.zustand && a.merker === '1' && a.laeuft && r.zeit > 0 && r.hinweis !== 'none', { a: [a.offen, a.merker, a.laeuft], r });

  // ================= B. Danach nie wieder von selbst – aber über ❓ =================
  await seite.reload(); await seite.waitForTimeout(1500);
  a = await anl(seite);
  pruef('Zweiter Start: keine Anleitung mehr, die Welt läuft sofort', !a.offen && a.laeuft && a.zeit > 0, a);
  await seite.tap('#k-hilfe'); await seite.waitForTimeout(200);
  a = await anl(seite);
  const zeitOffen = a.zeit;
  pruef('❓: schlägt die Anleitung wieder auf (Karte 1), die Welt ruht', a.offen && /1 von 6/.test(a.kopf) && !a.laeuft, a);
  await seite.waitForTimeout(1200);
  a = await anl(seite);
  pruef('❓: während des Lesens steht die Spielzeit', a.zeit === zeitOffen, { zeitOffen, jetzt: a.zeit });
  await seite.tap('#anleitung-box button:has-text("Überspringen")'); await seite.waitForTimeout(700);
  a = await anl(seite);
  pruef('„Überspringen" schließt sofort, die Welt läuft weiter', !a.offen && a.laeuft && a.zeit > zeitOffen, a);
  await seite.tap('#k-hilfe'); await seite.waitForTimeout(150);
  await seite.keyboard.press('Escape'); await seite.waitForTimeout(150);
  a = await anl(seite);
  pruef('Esc schließt die Anleitung ebenfalls', !a.offen && !a.zustand, a);

  // ================= C. Gleich auf der ersten Karte überspringen =================
  await seite.evaluate(() => { localStorage.clear(); });
  await seite.reload(); await seite.waitForTimeout(1300);
  a = await anl(seite);
  pruef('Erststart (erneut): Anleitung offen', a.offen, a);
  await seite.tap('#anleitung-box button:has-text("Überspringen")'); await seite.waitForTimeout(600);
  a = await anl(seite);
  pruef('Überspringen auf Karte 1: zu, gemerkt, Welt läuft', !a.offen && a.merker === '1' && a.laeuft, a);

  // ================= D. Mit Spielstand kommt die gewohnte Frage, nicht die Anleitung =================
  await kontor(seite, 0, 0);
  await seite.evaluate(() => { spielSpeichern(true); localStorage.removeItem('inselspiel-anleitung'); });
  await seite.reload(); await seite.waitForTimeout(1500);
  a = await anl(seite);
  r = await seite.evaluate(() => ({ frage: state.startFrage, overlay: getComputedStyle(document.getElementById('overlay')).display }));
  pruef('Mit Spielstand: Frage „Weiterspielen?" statt Anleitung (kein doppeltes Fenster)', !a.offen && r.frage && r.overlay === 'flex', { a: a.offen, r });
  await seite.close();

  // ================= E. Siegziel 1500 – allein =================
  const solo = await neueSeite('SOLO', true);
  r = await solo.evaluate(() => ({ ziel: SIM.zielSiedler, leiste: document.getElementById('ziel').textContent.replace(/\s+/g, ' ').trim(),
    wettlauf: document.getElementById('punkte').textContent.slice(0, 40) }));
  pruef('Ziel: 1500 in der Stellschraube, in der Leiste und in der Rangliste', r.ziel === 1500 && /\/1500 Siedler/.test(r.leiste) && /Wettlauf auf 1500 Siedler/.test(r.wettlauf), r);
  await kontor(solo, 0, 0);
  let h = await haeuser(solo, 0, 6);
  await solo.waitForTimeout(1500);
  r = await solo.evaluate(() => ({ siedler: spieler[0].siedlerEw, vorbei: state.rennenVorbei, overlay: getComputedStyle(document.getElementById('overlay')).display }));
  pruef('Über 500, aber unter 1500 Siedlern: noch kein Sieg', r.siedler >= 500 && r.siedler < 1500 && !r.vorbei && r.overlay === 'none', { r, h });
  h = await haeuser(solo, 0, 14);
  await solo.waitForTimeout(1500);
  let o = await overlay(solo);
  r = await solo.evaluate(() => ({ siedler: spieler[0].siedlerEw }));
  pruef('Ab 1500 Siedlern: „Ziel erreicht!", die Welt ruht bis „Weiterspielen"', r.siedler >= 1500 && o.offen && /Ziel erreicht/.test(o.text) && /1500 Siedler/.test(o.text) && o.gewonnen && o.sieger === 0 && !o.laeuft && o.knoepfe.join() === 'Weiterspielen,Neue Insel', { r, o });
  await solo.tap('#overlay-box button:has-text("Weiterspielen")'); await solo.waitForTimeout(400);
  o = await overlay(solo);
  pruef('„Weiterspielen": Fenster zu, die Welt läuft', !o.offen && o.laeuft, o);
  await solo.close();

  // ================= F. Ein Computergegner erreicht 1500 zuerst =================
  const ki = await neueSeite('KI', true);
  await kontor(ki, 0, 0);
  await kontor(ki, 2, 1);
  h = await haeuser(ki, 2, 20);
  await ki.waitForTimeout(1500);
  o = await overlay(ki);
  pruef('Computergegner gewinnt: Meldung mit Namen und 1500, das Spiel läuft weiter', o.offen && /Wilhelm gewinnt das Wettrennen/.test(o.text) && /1500 Siedler/.test(o.text) && o.vorbei && !o.gewonnen && o.sieger === 2 && o.laeuft, { o, h });
  await ki.close();

  // ================= F2. Nach dem Sieg speichern und später laden: die Welt muss weiterlaufen =================
  const sieg = await neueSeite('SIEG', true);
  await kontor(sieg, 0, 0);
  await haeuser(sieg, 0, 22);
  await sieg.waitForTimeout(1500);
  await sieg.evaluate(() => { weiterspielen(); spielSpeichern(true); });
  await sieg.reload(); await sieg.waitForTimeout(1300);
  await sieg.tap('#overlay-box button:has-text("Fortsetzen")'); await sieg.waitForTimeout(700);
  const lage = () => sieg.evaluate(() => ({ siedler: spieler[0].siedlerEw, vorbei: state.rennenVorbei, gewonnen: state.gewonnen, sieger: state.sieger,
    laeuft: spielLaeuft(), zeit: state.spielzeit, overlay: getComputedStyle(document.getElementById('overlay')).display }));
  let l1 = await lage(); await sieg.waitForTimeout(1500); let l2 = await lage();
  pruef('Gewonnenes Spiel geladen: die Welt läuft weiter, kein zweites Sieg-Fenster, der Wettlauf bleibt entschieden',
    l2.laeuft && l2.zeit > l1.zeit && l2.vorbei && l2.gewonnen && l2.overlay === 'none' && l2.siedler >= 1500, { l1, l2 });

  // ================= F3. Stand aus der Zeit des 500er-Ziels: der Wettlauf geht bis 1500 weiter =================
  // (kontorGebaut zurücksetzen: Sonst sichert das Spiel beim Neuladen von selbst und der Stand wäre wieder da)
  await sieg.evaluate(() => { state.kontorGebaut = false; localStorage.removeItem(STAND_SCHLUESSEL); });
  await sieg.reload(); await sieg.waitForTimeout(1100);
  pruef('Frische Welt ohne Spielstand läuft sofort', await sieg.evaluate(() => spielLaeuft() && !state.startFrage));
  await kontor(sieg, 0, 0); await haeuser(sieg, 0, 3);
  await kontor(sieg, 2, 1); await haeuser(sieg, 2, 7);
  await sieg.waitForTimeout(900);
  r = await sieg.evaluate(() => { const vor = { gegner: spieler[2].siedlerEw, ich: spieler[0].siedlerEw };
    state.rennenVorbei = true; state.sieger = 2; state.gewonnen = false; spielSpeichern(true); return vor; });
  await sieg.reload(); await sieg.waitForTimeout(1300);
  await sieg.tap('#overlay-box button:has-text("Fortsetzen")'); await sieg.waitForTimeout(1200);
  l1 = await lage();
  pruef('Alter Stand (jemand hatte über 500, aber unter 1500): der Wettlauf ist wieder offen', r.gegner >= 500 && r.gegner < 1500 && !l1.vorbei && l1.sieger === -1 && l1.laeuft && l1.overlay === 'none', { r, l1 });
  await haeuser(sieg, 2, 14);
  await sieg.waitForTimeout(1500);
  o = await overlay(sieg);
  pruef('… und wird bei 1500 neu entschieden', o.offen && /Wilhelm gewinnt das Wettrennen/.test(o.text) && o.sieger === 2, o);
  await sieg.close();

  // ================= G. Zu zweit: Der Gast gewinnt =================
  const paar = async () => {
    const db = nachbau();
    const host = await neueSeite('HOST', true, db), gast = await neueSeite('GAST', true, db);
    await host.evaluate(MITSCHRIFT); await gast.evaluate(MITSCHRIFT);
    await host.tap('#k-netz'); await host.waitForTimeout(150);
    await host.tap('#mp-box button.knopf-gruen'); await host.waitForTimeout(900);
    const code = await host.evaluate(() => MP.code);
    await gast.tap('#k-netz'); await gast.waitForTimeout(150);
    await gast.fill('#mp-code', code);
    await gast.tap('#mp-box button:has-text("Beitreten")'); await gast.waitForTimeout(1500);
    await kontor(host, 0, 0); await kontor(host, 1, 1);
    return { db, host, gast, code };
  };
  let p = await paar();
  h = await haeuser(p.host, 1, 20);
  await p.gast.waitForTimeout(2500);
  o = await overlay(p.host);
  pruef('Gast gewinnt – beim Gastgeber: „Mitspieler gewinnt", weiter läuft die Welt, Knopf „Partie beenden"',
    o.offen && /Mitspieler gewinnt das Wettrennen/.test(o.text) && o.sieger === 1 && !o.gewonnen && o.laeuft && o.knoepfe.join() === 'Weiterspielen,Partie beenden', { o, h });
  let og = await overlay(p.gast);
  pruef('Gast gewinnt – beim Gast: „Ziel erreicht!", Knopf „Partie verlassen"',
    og.offen && /Ziel erreicht/.test(og.text) && og.gewonnen && og.sieger === 1 && og.knoepfe.join() === 'Weiterspielen,Partie verlassen', og);
  await p.gast.tap('#overlay-box button:has-text("Weiterspielen")'); await p.gast.waitForTimeout(300);
  og = await overlay(p.gast);
  r = await p.gast.evaluate(() => ({ an: MP.an, zeit: state.spielzeit }));
  pruef('Gast: „Weiterspielen" schließt das Fenster, die Partie läuft', !og.offen && r.an, { og, r });
  // „Partie beenden" beim Gastgeber
  await p.host.tap('#overlay-box button:has-text("Partie beenden")'); await p.host.waitForTimeout(800);
  r = await p.host.evaluate(() => ({ an: MP.an, laeuft: spielLaeuft(), overlay: getComputedStyle(document.getElementById('overlay')).display }));
  pruef('Gastgeber: „Partie beenden" schließt die Partie, er spielt allein weiter', !r.an && r.laeuft && r.overlay === 'none' && p.db.holen('inselspiel/' + p.code) === null, r);
  await p.gast.waitForTimeout(600);
  r = await p.gast.evaluate(() => ({ text: document.getElementById('mp-box').textContent.replace(/\s+/g, ' ').trim(), offen: getComputedStyle(document.getElementById('mp-fenster')).display }));
  pruef('Gast: erfährt vom Ende der Partie', r.offen === 'flex' && /Partie beendet/.test(r.text), r);
  await p.host.close(); await p.gast.close();

  // ================= H. Zu zweit: Der Gastgeber gewinnt =================
  p = await paar();
  h = await haeuser(p.host, 0, 20);
  await p.gast.waitForTimeout(2500);
  o = await overlay(p.host);
  pruef('Gastgeber gewinnt – bei ihm: „Ziel erreicht!", die Welt ruht bis „Weiterspielen"', o.offen && /Ziel erreicht/.test(o.text) && o.gewonnen && o.sieger === 0 && !o.laeuft, { o, h });
  og = await overlay(p.gast);
  r = await p.gast.evaluate(() => { uiAktualisieren(); return { marken: [...document.querySelectorAll('#lage .lage-marke')].map(e => e.textContent.trim()), pause: MP.hostPause }; });
  pruef('Gastgeber gewinnt – beim Gast: „Gastgeber gewinnt das Wettrennen!"', og.offen && /Gastgeber gewinnt das Wettrennen/.test(og.text) && og.sieger === 0 && !og.gewonnen && og.knoepfe.join() === 'Weiterspielen,Partie verlassen', { og, r });
  await p.host.tap('#overlay-box button:has-text("Weiterspielen")'); await p.gast.waitForTimeout(1200);
  o = await overlay(p.host);
  r = await p.gast.evaluate(() => ({ pause: MP.hostPause }));
  pruef('Nach „Weiterspielen" läuft die Welt wieder – für beide', !o.offen && o.laeuft && !r.pause, { o, r });
  pruef('Regeln: kein Zugriff verweigert', p.db.verweigert.length === 0, p.db.verweigert.slice(0, 4));
  await p.host.close(); await p.gast.close();


  await new Promise((weiter) => setTimeout(weiter, 400)); // auch späte Fehler noch mitnehmen
  pruef('Keine Fehler auf den Seiten', fehler.length === 0, [...new Set(fehler)].slice(0, 6));
  const bad = ergebnisse.filter((e) => !e.ok);
  console.log(`\nERGEBNIS: ${ergebnisse.length - bad.length} von ${ergebnisse.length} Prüfungen bestanden` + (bad.length ? ' – FEHLER: ' + bad.map((b) => b.name).join(' ; ') : ''));
  await browser.close();
  process.exit(bad.length ? 1 : 0);
})().catch((e) => { console.error('SKRIPTFEHLER', e); process.exit(1); });
