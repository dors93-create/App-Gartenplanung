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

  // Läuft auf dem Port schon etwas (z. B. der Server eines abgebrochenen
  // Laufs)? Dann wäre nicht sicher, welcher Stand der App geprüft wird.
  if (await erreichbar()) {
    console.error(`Auf Port ${PORT} läuft schon ein Server. Bitte erst beenden – die Tests starten ihren eigenen.`);
    process.exit(1);
  }

  // Vite direkt mit Node starten (nicht über „npx“): Nur so trifft
  // server.kill() wirklich den Server und nicht bloß ein Hilfsprogramm davor –
  // sonst liefe er nach den Tests unbemerkt weiter.
  const vite = path.join(WURZEL, 'node_modules', 'vite', 'bin', 'vite.js');
  const server = spawn(process.execPath, [vite, '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'], { cwd: WURZEL, stdio: 'ignore' });
  // Den Server in jedem Fall wieder beenden – auch bei einem Abbruch mit Strg + C.
  process.on('exit', () => server.kill());
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => process.exit(1));

  let bereit = false;
  for (let versuch = 0; versuch < 40 && !bereit; versuch++) {
    await new Promise((weiter) => setTimeout(weiter, 500));
    bereit = await erreichbar();
  }
  if (!bereit) {
    console.error('Der Entwicklungsserver ist nicht gestartet.');
    process.exit(1);
  }

  const fehlgeschlagen = [];
  for (const test of auswahl) {
    console.log(`\n===== ${test} =====`);
    const code = await fuehreAus('node', [path.join('tests', `${test}.test.cjs`), ADRESSE]);
    if (code !== 0) fehlgeschlagen.push(test);
  }

  console.log(
    fehlgeschlagen.length
      ? `\nFEHLGESCHLAGEN: ${fehlgeschlagen.join(', ')}`
      : `\nAlle Browser-Tests bestanden (${auswahl.join(', ')}).`,
  );
  process.exit(fehlgeschlagen.length ? 1 : 0);
})();
