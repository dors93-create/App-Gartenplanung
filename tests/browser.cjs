// =========================================================================
// Alle Browser-Tests nacheinander ausführen
// -------------------------------------------------------------------------
// Startet die App lokal (Vite-Entwicklungsserver), lässt die Tests dagegen
// laufen und beendet den Server wieder. Aufruf: npm run test:browser
//
// Voraussetzungen:
//  - Playwright mit Chromium (in den Claude-Sitzungen vorinstalliert; es steht
//    bewusst nicht in package.json).
//  - Netzzugriff auf www.wfs.nrw.de: Die Tests fragen das echte Kataster ab
//    (wenige Anfragen). Luftbild und Adresssuche werden nicht belastet.
//
// Einzelnen Test wählen: npm run test:browser -- gaerten
// =========================================================================
const { spawn } = require('child_process');
const http = require('http');
const path = require('path');

const WURZEL = path.join(__dirname, '..');
const PORT = 5199;
const ADRESSE = `http://127.0.0.1:${PORT}/`;
const TESTS = ['ablauf', 'feinheiten', 'gaerten'];

// Antwortet der Server schon?
const erreichbar = () =>
  new Promise((weiter) => {
    http
      .get(ADRESSE, (antwort) => { antwort.resume(); weiter(antwort.statusCode === 200); })
      .on('error', () => weiter(false));
  });

// Ein Kommando ausführen und seine Ausgabe durchreichen; Rückgabe: Exit-Code.
const fuehreAus = (kommando, argumente) =>
  new Promise((weiter) => {
    const prozess = spawn(kommando, argumente, { cwd: WURZEL, stdio: 'inherit' });
    prozess.on('exit', (code) => weiter(code === null ? 1 : code));
  });

(async () => {
  const gewuenscht = process.argv.slice(2);
  const auswahl = gewuenscht.length ? TESTS.filter((t) => gewuenscht.includes(t)) : TESTS;
  if (auswahl.length === 0) {
    console.error('Unbekannter Test. Möglich sind: ' + TESTS.join(', '));
    process.exit(1);
  }

  const server = spawn('npx', ['vite', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'], { cwd: WURZEL, stdio: 'ignore' });
  let bereit = false;
  for (let versuch = 0; versuch < 40 && !bereit; versuch++) {
    await new Promise((weiter) => setTimeout(weiter, 500));
    bereit = await erreichbar();
  }
  if (!bereit) {
    server.kill();
    console.error('Der Entwicklungsserver ist nicht gestartet.');
    process.exit(1);
  }

  const fehlgeschlagen = [];
  for (const test of auswahl) {
    console.log(`\n===== ${test} =====`);
    const code = await fuehreAus('node', [path.join('tests', `${test}.test.cjs`), ADRESSE]);
    if (code !== 0) fehlgeschlagen.push(test);
  }

  server.kill();
  console.log(
    fehlgeschlagen.length
      ? `\nFEHLGESCHLAGEN: ${fehlgeschlagen.join(', ')}`
      : `\nAlle Browser-Tests bestanden (${auswahl.join(', ')}).`,
  );
  process.exit(fehlgeschlagen.length ? 1 : 0);
})();
