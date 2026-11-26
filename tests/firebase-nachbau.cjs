// =========================================================================
// Nachgebaute Firebase-Datenbank für die Zwei-Fenster-Tests des Inselspiels
// -------------------------------------------------------------------------
// Das Spiel lädt wie im Ernstfall die Firebase-Bausteine von gstatic – der
// Test liefert dafür Ersatzbausteine aus, die alles an diesen Nachbau
// weiterreichen. Es geht also nichts ins Netz und nichts in die echte
// Datenbank. Der Nachbau verhält sich wie Firebase:
//  - prüft Werte beim Schreiben (kein undefined/NaN) und wirft sonst sofort
//  - legt Listen als Schlüssel ab, lässt Leeres weg
//  - wendet Regeln an: „alt“ (nur der Kegelpegel ist erlaubt – so war es,
//    bevor das Inselspiel freigegeben wurde), „neu“ (inselspiel/$code) und
//    „stumm“ (die Datenbank antwortet gar nicht, wie ohne Netz)
// Benutzung:  const db = nachbau();  await db.anbinden(seite, 'HOST');
// =========================================================================
function nachbau() {
  const db = { modus: 'neu', baum: {}, horcher: [], verweigert: [], vorgaenge: 0, pushNr: 0 };
  const teile = p => p.split('/').filter(Boolean);
  db.holen = pfad => { let k = db.baum; for (const t of teile(pfad)) { if (k === null || typeof k !== 'object' || !(t in k)) return null; k = k[t]; } return k; };
  const setzen = (pfad, wert) => {
    const t = teile(pfad); let k = db.baum;
    for (let i = 0; i < t.length - 1; i++) { if (k[t[i]] === null || typeof k[t[i]] !== 'object') k[t[i]] = {}; k = k[t[i]]; }
    if (wert === null) delete k[t[t.length - 1]]; else k[t[t.length - 1]] = wert;
  };
  const speichern = v => {
    if (v === null || v === undefined) return null;
    if (typeof v !== 'object') return v;
    const kinder = {}; let n = 0;
    for (const k of Object.keys(v)) { const s = speichern(v[k]); if (s !== null) { kinder[k] = s; n++; } }
    return n ? kinder : null;
  };
  db.lesen = kn => {
    if (kn === null || typeof kn !== 'object') return kn;
    const obj = {}; let anzahl = 0, max = 0, alleZahlen = true;
    for (const k of Object.keys(kn)) { obj[k] = db.lesen(kn[k]); anzahl++; if (alleZahlen && /^(0|[1-9]\d*)$/.test(k)) max = Math.max(max, Number(k)); else alleZahlen = false; }
    if (alleZahlen && max < 2 * anzahl) { const a = []; for (const k in obj) a[k] = obj[k]; return a; }
    return obj;
  };
  db.erlaubt = (pfad, art) => {
    const t = teile(pfad);
    if (t[0] === 'kegelpegel') return art === 'r' ? true : (t[1] === 'stand');
    if (t[0] === 'inselspiel' && db.modus === 'neu') return t.length >= 2;
    return false;
  };
  let kette = Promise.resolve();
  const rufe = (h, wert, key, fehler) => { kette = kette.then(() => h.seite.evaluate(([id, w, k, f]) => window._fbRuf && window._fbRuf(id, w, k, f), [h.id, wert, key || null, fehler || null]).catch(() => {})); };
  const melde = pfad => {
    for (const h of db.horcher) {
      const a = teile(pfad).join('/'), b = teile(h.pfad).join('/');
      if (!(a === b || a.startsWith(b + '/') || b.startsWith(a + '/'))) continue;
      if (h.art === 'value') rufe(h, db.lesen(db.holen(h.pfad)));
      else {
        const kn = db.holen(h.pfad) || {};
        for (const key of Object.keys(kn)) { if (h.bekannt.has(key)) continue; h.bekannt.add(key); rufe(h, db.lesen(kn[key]), key); }
      }
    }
  };
  db.anbinden = async (seite, name) => {
    const nein = (pfad, art) => db.verweigert.push(`${name} ${art} ${pfad} [${db.modus}]`);
    const ablehnung = { ok: false, code: 'PERMISSION_DENIED', message: 'PERMISSION_DENIED: Permission denied' };
    await seite.exposeFunction('fbSet', async (pfad, json) => {
      db.vorgaenge++;
      if (db.modus === 'stumm') return { haengt: true };
      if (!db.erlaubt(pfad, 'w')) { nein(pfad, 'schreiben'); return ablehnung; }
      setzen(pfad, speichern(JSON.parse(json))); melde(pfad); return { ok: true };
    });
    await seite.exposeFunction('fbGet', async pfad => {
      db.vorgaenge++;
      if (db.modus === 'stumm') return { haengt: true };
      if (!db.erlaubt(pfad, 'r')) { nein(pfad, 'lesen'); return { ok: false, message: 'Permission denied' }; }
      return { ok: true, wert: db.lesen(db.holen(pfad)) };
    });
    await seite.exposeFunction('fbPush', async (pfad, json) => {
      db.vorgaenge++;
      if (db.modus === 'stumm') return { haengt: true };
      if (!db.erlaubt(pfad, 'w')) { nein(pfad, 'schreiben'); return ablehnung; }
      const key = '-N' + String(++db.pushNr).padStart(6, '0');
      setzen(pfad + '/' + key, speichern(JSON.parse(json))); melde(pfad + '/' + key); return { ok: true, key };
    });
    await seite.exposeFunction('fbHorche', async (pfad, art, id) => {
      db.vorgaenge++;
      const h = { seite, id, pfad, art, bekannt: new Set() };
      if (!db.erlaubt(pfad, 'r')) { nein(pfad, 'horchen'); rufe(h, null, null, 'permission_denied at /' + pfad + ": Client doesn't have permission to access the desired data."); return; }
      db.horcher.push(h); melde(pfad);
      if (art === 'value' && db.holen(pfad) === null) rufe(h, null);
    });
    await seite.exposeFunction('fbAbmelden', async id => { db.horcher = db.horcher.filter(h => !(h.seite === seite && h.id === id)); });
    // Nach dem Neuladen einer Seite sind ihre alten Horcher hinfällig
    seite.on('framenavigated', f => { if (f === seite.mainFrame()) db.horcher = db.horcher.filter(h => h.seite !== seite); });
    // Die Firebase-Bausteine durch Ersatz austauschen
    await seite.route('https://www.gstatic.com/firebasejs/**', route => {
      const app = route.request().url().includes('firebase-app');
      route.fulfill({ status: 200, contentType: 'application/javascript', headers: { 'access-control-allow-origin': '*' },
        body: app ? `export const initializeApp = (...a) => window._fakeFb.initializeApp(...a);`
                  : `const f = n => (...a) => window._fakeFb[n](...a);
                     export const getDatabase = f('getDatabase'), ref = f('ref'), set = f('set'), get = f('get'),
                       push = f('push'), remove = f('remove'), onValue = f('onValue'), onChildAdded = f('onChildAdded');` });
    });
    await seite.addInitScript(SEITENTEIL);
  };
  return db;
}

// Läuft in jeder Seite vor dem Spiel: der seitenseitige Teil des Nachbaus
const SEITENTEIL = `
  window.fbPruefen = function (v, pfad, funde) {
    if (v === undefined) { funde.push('undefined in property ' + pfad); return; }
    if (typeof v === 'function') { funde.push('a function in property ' + pfad); return; }
    if (typeof v === 'number' && !isFinite(v)) { funde.push(v + ' in property ' + pfad); return; }
    if (v && typeof v === 'object') for (const k of Object.keys(v)) {
      if (!Array.isArray(v) && (k === '' || /[.$#\\[\\]\\/\\x00-\\x1f\\x7f]/.test(k))) funde.push('an invalid key (' + k + ') in property ' + pfad);
      window.fbPruefen(v[k], pfad + '.' + k, funde);
    }
  };
  window._fbHorcher = new Map(); window._fbNr = 0; window._fbGeworfen = [];
  window._fbRuf = (id, wert, key, fehler) => {
    const h = window._fbHorcher.get(id); if (!h) return;
    if (fehler) { if (h.err) h.err(new Error(fehler)); return; }
    if (h.art === 'value') h.cb({ val: () => wert });
    else h.cb({ val: () => wert, key, ref: { pfad: h.pfad + '/' + key } });
  };
  (() => {
    const zuFehler = r => Object.assign(new Error(r.message), r.code ? { code: r.code } : {});
    const pruef = (fn, wert, pfad) => { const funde = []; window.fbPruefen(wert, pfad.replace(/\\//g, '.'), funde);
      if (funde.length) { const e = new Error(fn + ' failed: value argument contains ' + funde[0]); window._fbGeworfen.push(e.message); throw e; } };
    const antwort = r => { if (r.haengt) return new Promise(() => {}); if (!r.ok) throw zuFehler(r); return r; };
    const horche = art => (ref, cb, err) => { const id = ++window._fbNr; window._fbHorcher.set(id, { art, cb, err, pfad: ref.pfad }); window.fbHorche(ref.pfad, art, id);
      return () => { window._fbHorcher.delete(id); window.fbAbmelden(id); }; };
    window._fakeFb = {
      initializeApp: (cfg, name) => { if (window._fakeApp) throw new Error("Firebase: Firebase App named '" + name + "' already exists (app/duplicate-app)."); window._fakeApp = { cfg, name }; return window._fakeApp; },
      getDatabase: app => ({ app }),
      ref: (db, pfad) => ({ pfad }),
      set: (ref, wert) => { pruef('set', wert, ref.pfad); return window.fbSet(ref.pfad, JSON.stringify(wert)).then(antwort).then(() => {}); },
      get: ref => window.fbGet(ref.pfad).then(antwort).then(r => ({ val: () => r.wert })),
      push: (ref, wert) => { pruef('push', wert, ref.pfad); return window.fbPush(ref.pfad, JSON.stringify(wert)).then(antwort).then(r => ({ pfad: ref.pfad + '/' + r.key })); },
      remove: ref => window.fbSet(ref.pfad, 'null').then(antwort).then(() => {}),
      onValue: horche('value'), onChildAdded: horche('child_added'),
    };
  })();
`;
// Meldungen mitschreiben (nach jedem Laden der Seite aufrufen)
const MITSCHRIFT = `(() => { if (window._meld) return; window._meld = []; const m0 = melden; melden = (t, s, x) => { window._meld.push(String(t)); return m0(t, s, x); }; })()`;
module.exports = { nachbau, MITSCHRIFT };
