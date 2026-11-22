# Zu zweit spielen – Inselspiel

Zwei Handys, dieselbe Welt: gemeinsamer Markt, Diplomatie und Krieg.
Die Verbindung läuft über die Firebase-Datenbank, die auch der
Kegelpegel-Punktestand nutzt (`kegeltour-45451`).

## Einmalig vorab: Datenbank freigeben

Die Datenbank lässt von sich aus nur den Kegelpegel zu. Ohne die folgende
Freigabe meldet das Spiel beim Eröffnen oder Beitreten:
„🔒 Die Datenbank lässt das Inselspiel noch nicht zu" (früher stand dort
nur `permission_denied`). Das Freischalten geht nur mit dem Google-Konto,
dem die Datenbank gehört, und dauert zwei Minuten:

1. [Firebase-Konsole](https://console.firebase.google.com) öffnen, Projekt
   `kegeltour-45451` wählen.
2. Links **Realtime Database** → Reiter **„Regeln"**.
3. Den Text dort durch diesen ersetzen und **„Veröffentlichen"** antippen:

```json
{
  "rules": {
    "kegelpegel": {
      ".read": true,
      "stand": {
        ".write": true,
        ".validate": "newData.isString() && newData.val().length < 20000"
      }
    },
    "inselspiel": {
      "$code": {
        ".read": true,
        ".write": true
      }
    }
  }
}
```

Der Teil `kegelpegel` ist unverändert der Schutz aus `KEGELPEGEL.md`. Neu
ist nur `inselspiel`: Jede Partie liegt unter ihrem Code und ist für alle
les- und schreibbar, die diesen Code kennen. Die Liste aller Partien kann
niemand abrufen.

> **Hinweis zur Sicherheit:** Es gibt keine Anmeldung. Wer den Code einer
> Partie kennt, kann mitspielen; wer sich auskennt, könnte theoretisch
> eine Partie stören oder Datenmüll ablegen. Für ein Spiel im
> Freundeskreis ist das in Ordnung – für mehr nicht.

## So spielt ihr zusammen

1. **Beide** öffnen das Spiel und laden die Seite einmal neu, damit auf
   beiden Geräten dieselbe Fassung läuft:
   `https://dors93-create.github.io/App-Gartenplanung/inselspiel.html`
2. Eine Person tippt oben auf **🌐** → **„Partie eröffnen"**.
   Es erscheint ein fünfstelliger Code, zum Beispiel `K7PQM`.
3. Die andere Person tippt auf **🌐**, gibt den Code ein → **„Beitreten"**.
4. Fertig. Ihr seid in derselben Welt; die beiden übrigen Inseln
   besiedeln wie gewohnt KI-Gegner.

**Wichtig:** Das Gerät der Person, die eröffnet hat (der *Gastgeber*),
rechnet das ganze Spiel. Es muss offen bleiben – wird es geschlossen
oder gesperrt, pausiert das Spiel für beide. Der Gast sieht dann den
Hinweis „Der Gastgeber ist gerade nicht erreichbar".

**Am einfachsten in einer neuen Welt:** Der Gastgeber beginnt eine neue
Welt und eröffnet die Partie gleich zu Beginn – der Mitspieler übernimmt
dann den Platz der ersten Computergegnerin. Meldet das Spiel beim
Beitreten eine „andere Spielfassung", hilft Neuladen auf beiden Geräten.

## Was technisch passiert

- Die **Welt wird nicht übertragen**, sondern nur ihr Startwert
  (eine Zahl). Beide Geräte bauen daraus dieselbe Karte – das spart
  rund 260 KB je Beitritt.
- Der Gastgeber veröffentlicht etwa dreimal pro Sekunde den laufenden
  Stand (Rohstoffe, Truppen, Diplomatie, Markt) und alle anderthalb
  Sekunden die Gebäudeliste.
- Der Gast rechnet **nichts** selbst. Jede seiner Handlungen – bauen,
  abreißen, ausbauen, handeln, Truppen befehligen, Diplomatie – wird
  als Befehl geschickt; der Gastgeber prüft und führt sie aus.
  Dadurch können die beiden Spielstände nicht auseinanderlaufen.
- Datenverbrauch: grob 10–15 KB pro Sekunde, also etwa 40 MB je
  Stunde. Im WLAN unkritisch, unterwegs lieber im Blick behalten.

## Wenn es nicht klappt

| Meldung im Spiel | Was zu tun ist |
|---|---|
| 🔒 „Die Datenbank lässt das Inselspiel noch nicht zu" | Die Freigabe oben fehlt noch (oder wurde beim Ändern der Regeln überschrieben). |
| 📡 „Die Datenbank antwortet nicht" | Internetverbindung prüfen, dann noch einmal versuchen. |
| „Keine Partie mit diesem Code gefunden" | Code vergleichen. Der Gastgeber muss die Partie gerade geöffnet haben. |
| „… andere Spielfassung" | Auf beiden Geräten die Seite neu laden. |
| „Dieser Spielstand stammt aus einer älteren Fassung" | Zu zweit geht es nur in einer neuen Welt. |
| „Der Gastgeber ist gerade nicht erreichbar" | Das Gerät des Gastgebers ist gesperrt, pausiert oder ohne Netz. |

## Grenzen der aktuellen Fassung

- Genau **zwei** menschliche Mitspieler (Plätze 1 und 2), dazu zwei KI-Gegner.
- Der Gastgeber kann nicht wechseln: Verlässt er die Partie, ist sie vorbei.
- Der Spielstand wird nur beim Gastgeber gespeichert.
- Beim Gast laufen Truppen und Schiffe weich interpoliert, können also
  um Bruchteile einer Kachel von der „Wahrheit" abweichen. Für die
  Berechnung zählt immer der Stand beim Gastgeber.
