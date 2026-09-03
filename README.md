# Grünriss 🌱

Plane deinen Garten in NRW – auf dem aktuellen Luftbild.

Eine bildschirmfüllende Karte mit dem NRW-Luftbild (DOP), Adresssuche und
sanftem Heranfliegen an deine Adresse.

## Voraussetzungen

- [Node.js](https://nodejs.org/) (Version 18 oder neuer)

## Loslegen

```bash
npm install   # einmalig: lädt die benötigten Bibliotheken
npm run dev   # startet die App
```

Vite zeigt im Terminal eine Adresse an, meist **http://localhost:5173** –
diese im Browser öffnen. Beim Speichern von Änderungen lädt die Seite
automatisch neu. Zum Beenden im Terminal `Strg + C` drücken.

## Bedienung

1. Adresse oben ins Suchfeld eingeben und Enter drücken.
2. Bei mehreren Treffern den passenden aus der Liste wählen.
3. Die Karte fliegt zu deiner Adresse – fertig für die weitere Planung.

## Mehr Infos

Projektüberblick und Konventionen stehen in [`CLAUDE.md`](./CLAUDE.md).

## Bonus-Seiten

Neben dem Planungstool liegen im Ordner `public/` einzelne, eigenständige
HTML-Seiten. Sie werden mit veröffentlicht und lassen sich direkt teilen:

| Seite | Link |
|---|---|
| Kegelpegel Olympiade – Punktestand | [`/kegelpegel.html`](https://dors93-create.github.io/App-Gartenplanung/kegelpegel.html) |
| Weißwein-Kompass | [`/weisswein.html`](https://dors93-create.github.io/App-Gartenplanung/weisswein.html) |
| Insel-Aufbauspiel | [`/inselspiel.html`](https://dors93-create.github.io/App-Gartenplanung/inselspiel.html) |

Zur Olympiade-Seite gehört die Anleitung [`KEGELPEGEL.md`](./KEGELPEGEL.md):
Bedienung der Verwaltung und die einmalige Einrichtung der Live-Verbindung.
