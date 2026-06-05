// =========================================================================
// Grünriss – Automatische Bestandsaufnahme (Schritt 3b, Teil 1)
// -------------------------------------------------------------------------
// Holt die amtlichen Gebäude-Umringe (ALKIS) für die gewählten Flurstücke.
// Datenquelle: WFS „wfs_nw_alkis_vereinfacht", Objektart `ave:GebaeudeBauwerk`
// (über CI-Test bestätigt). Liefert GML (XML) in EPSG:25832; wir lesen die
// Außenringe und rechnen mit proj4 nach Lat/Lon für die Karte um.
//
// Bewusst nur die zuverlässigen amtlichen Gebäude – die unsichere
// Luftbild-Analyse (Terrasse/Bäume) kommt als eigener, späterer Teil.
// =========================================================================

import proj4 from "proj4";

proj4.defs(
  "EPSG:25832",
  "+proj=utm +zone=32 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs",
);
const nachLngLat = (e, n) => proj4("EPSG:25832", "EPSG:4326", [e, n]);

const WFS_URL = "https://www.wfs.nrw.de/geobasis/wfs_nw_alkis_vereinfacht";

// Umschließendes Rechteck (Bbox) der Flurstücke in EPSG:25832.
function bbox25832(parcels) {
  let minE = Infinity,
    minN = Infinity,
    maxE = -Infinity,
    maxN = -Infinity;
  parcels.forEach((p) =>
    (p.ring25832 || []).forEach(([e, n]) => {
      if (e < minE) minE = e;
      if (n < minN) minN = n;
      if (e > maxE) maxE = e;
      if (n > maxN) maxN = n;
    }),
  );
  return [minE, minN, maxE, maxN];
}

// Mittelpunkt eines (geschlossenen) Rings.
function mitte(ring) {
  let x = 0,
    y = 0;
  const n = ring.length - 1;
  for (let i = 0; i < n; i++) {
    x += ring[i][0];
    y += ring[i][1];
  }
  return [x / n, y / n];
}

// Punkt-in-Vieleck-Test (Strahl-Methode) in Lat/Lon.
function punktImRing(pt, ring) {
  let drin = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0],
      yi = ring[i][1];
    const xj = ring[j][0],
      yj = ring[j][1];
    if (
      yi > pt[1] !== yj > pt[1] &&
      pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi
    )
      drin = !drin;
  }
  return drin;
}

// Alle Gebäude-Außenringe (Lat/Lon) aus der GML-Antwort lesen.
function leseRinge(xmlText) {
  const xml = new DOMParser().parseFromString(xmlText, "application/xml");
  const ringe = [];
  for (const m of xml.getElementsByTagNameNS("*", "member")) {
    // Ein Gebäude kann aus mehreren Teilflächen bestehen -> jede „exterior“.
    for (const ex of m.getElementsByTagNameNS("*", "exterior")) {
      const pl = ex.getElementsByTagNameNS("*", "posList")[0];
      if (!pl) continue;
      const z = pl.textContent.trim().split(/\s+/).map(Number);
      const ring = [];
      for (let i = 0; i + 1 < z.length; i += 2) ring.push(nachLngLat(z[i], z[i + 1]));
      if (ring.length >= 4) ringe.push(ring);
    }
  }
  return ringe;
}

// -------------------------------------------------------------------------
// Gebäude für die gewählten Flurstücke holen.
// Rückgabe: Liste von Ringen ([[lng,lat], …], geschlossen) innerhalb des
// Grundstücks (Nachbargebäude aus der Bbox werden herausgefiltert).
// -------------------------------------------------------------------------
export async function erfasseGebaeude(parcels) {
  if (!parcels || !parcels.length) return [];

  const [minE, minN, maxE, maxN] = bbox25832(parcels);
  const bbox = `${minE},${minN},${maxE},${maxN},urn:ogc:def:crs:EPSG::25832`;
  const url =
    `${WFS_URL}?SERVICE=WFS&VERSION=2.0.0&REQUEST=GetFeature` +
    `&TYPENAMES=ave:GebaeudeBauwerk&COUNT=500` +
    `&SRSNAME=urn:ogc:def:crs:EPSG::25832&BBOX=${bbox}`;

  const antwort = await fetch(url);
  if (!antwort.ok) throw new Error("WFS-Status " + antwort.status);
  const ringe = leseRinge(await antwort.text());

  // Nur Gebäude behalten, deren Mittelpunkt in einem der Flurstücke liegt.
  const grenzen = parcels.filter((p) => p.ringLngLat).map((p) => p.ringLngLat);
  return ringe.filter((r) => {
    const c = mitte(r);
    return grenzen.some((g) => punktImRing(c, g));
  });
}
