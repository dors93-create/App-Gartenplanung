/* ============================================================
   Service Worker für das Insel-Aufbauspiel
   ------------------------------------------------------------
   Sorgt dafür, dass das Spiel nach dem ersten Aufruf auch ohne
   Internet startet (z. B. im Zug oder im Funkloch).

   Vorgehen: "zuerst Netz, sonst Zwischenspeicher". Online bekommt
   man also immer die neueste Fassung; offline die zuletzt
   geladene. Fremde Adressen (etwa die Gartenplanungs-App im
   selben Ordner) werden bewusst NICHT abgefangen.
   ============================================================ */

const SPEICHER = 'inselgruender-v1';

// Nur diese Dateien gehören zum Spiel
const UNSERE_DATEIEN = [
  'inselspiel.html',
  'manifest.webmanifest',
  'icon-192.png',
  'icon-512.png',
  'apple-touch-icon.png',
];

// Beim Einrichten alles einmal in den Zwischenspeicher legen
self.addEventListener('install', ereignis => {
  ereignis.waitUntil(
    caches.open(SPEICHER)
      .then(speicher => speicher.addAll(UNSERE_DATEIEN.map(n => './' + n)))
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting())   // offline installiert? Dann später nachladen
  );
});

// Beim Aktivieren alte Fassungen aufräumen
self.addEventListener('activate', ereignis => {
  ereignis.waitUntil(
    caches.keys()
      .then(namen => Promise.all(
        namen.filter(n => n.startsWith('inselgruender-') && n !== SPEICHER)
             .map(n => caches.delete(n))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', ereignis => {
  if (ereignis.request.method !== 'GET') return;
  const adresse = new URL(ereignis.request.url);

  // Alles, was nicht zum Spiel gehört, läuft unverändert durch
  const gehoertUns = UNSERE_DATEIEN.some(name => adresse.pathname.endsWith(name));
  if (!gehoertUns) return;

  ereignis.respondWith(
    fetch(ereignis.request)
      .then(antwort => {
        // Frische Fassung für das nächste Mal aufheben
        if (antwort && antwort.ok) {
          const kopie = antwort.clone();
          caches.open(SPEICHER).then(speicher => speicher.put(ereignis.request, kopie));
        }
        return antwort;
      })
      .catch(() => caches.match(ereignis.request)
        .then(treffer => treffer || caches.match('./inselspiel.html')))
  );
});
