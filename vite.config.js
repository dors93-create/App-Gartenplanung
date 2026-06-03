import { defineConfig } from "vite";

// Vite-Konfiguration
// -----------------------------------------------------------------------
// "base" ist der Pfad, unter dem die App ausgeliefert wird.
//  - Lokal (npm run dev / preview): "/" – die App liegt direkt unter der Wurzel.
//  - Auf GitHub Pages: "/<Repo-Name>/" – dort liegt eine Projektseite in einem
//    Unterordner. Den genauen Namen setzt die GitHub-Action über VITE_BASE,
//    damit Groß-/Kleinschreibung garantiert passt.
export default defineConfig({
  base: process.env.VITE_BASE || "/",
});
