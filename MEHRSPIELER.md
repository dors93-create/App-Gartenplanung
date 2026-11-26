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
   Es erscheint ein fünfstelliger Code, zum Beispiel `K7PQM`, und das
   Fenster „Warte auf deinen Mitspieler". **Bis der da ist, ruht die
   Welt** – kein Computergegner sticht in See.
3. Die andere Person tippt auf **🌐**, gibt den Code ein → **„Beitreten"**.
4. In dem Moment beginnt das Spiel für beide gleichzeitig, bei Spielzeit
   null. Die beiden Computergegner brechen erst rund 15 Sekunden später
   auf – ihr habt also beide den ersten Zug bei der Inselwahl.

Liegt beim Start ein gespeicherter Spielstand vor, führt der Knopf
**„🌐 Zu zweit spielen"** direkt hierher, ohne den Stand anzurühren.

**Neue Welt oder laufende Welt?** Hat der Gastgeber in seiner Welt schon
gesiedelt, fragt das Fenster nach:

- **„Neue Welt zu zweit"** – faire Partie von vorn. Die Seite lädt dafür
  kurz neu. Der bisherige Spielstand wird ersetzt, sobald in der neuen
  Welt gesiedelt wird; wer vorher abbricht, bekommt ihn wieder angeboten.
- **„In dieser Welt weiterspielen"** – der Mitspieler steigt in die
  laufende Welt ein und übernimmt Platz 2 (samt allem, was dort schon
  steht). So setzt ihr auch eine frühere Partie fort: Stand laden,
  eröffnen, mit dem neuen Code beitreten.

**Wer bestimmt was?** Das Gerät der Person, die eröffnet hat (der
*Gastgeber*), rechnet das ganze Spiel.

- **Tempo und Pause** stellt nur der Gastgeber ein. Beim Gast zeigen die
  Knöpfe an, was gerade gilt; pausiert der Gastgeber, steht beim Gast
  links die Marke „Der Gastgeber pausiert".
- **Gespeichert** wird nur beim Gastgeber. Der eigene Spielstand des
  Gastes bleibt unberührt – nach der Partie ist er wieder da.
- Das Gerät des Gastgebers muss **offen bleiben**. Wird es gesperrt oder
  verliert es das Netz, steht die Welt für beide; der Gast sieht dann
  „Der Gastgeber ist gerade nicht erreichbar".

**Wer gewinnt?** Wer zuerst 1500 Siedler versammelt – ihr oder einer
der Computergegner. Beide sehen die Meldung im selben Moment und können
danach weiterspielen. Gewinnt der Gastgeber, ruht die Welt kurz, bis er
„Weiterspielen" tippt.

**Neu im Spiel?** Wer das Spiel zum ersten Mal öffnet, bekommt eine
kurze Anleitung aus sechs Karten, die sich jederzeit überspringen lässt.
Später steht sie oben in der Leiste unter **❓**.

**Aufhören:** Über **🌐** kann der Gast die Partie verlassen (und später
mit demselben Code wieder einsteigen) und der Gastgeber sie beenden –
dann spielt auf Platz 2 wieder die Computergegnerin.

## Was technisch passiert

- Die **Welt wird nicht übertragen**, sondern nur ihr Startwert
  (eine Zahl). Beide Geräte bauen daraus dieselbe Karte – das spart
  rund 260 KB je Beitritt.
- Der Gastgeber veröffentlicht etwa dreimal pro Sekunde den laufenden
  Stand (Rohstoffe, Schiffe, Truppen, Diplomatie, Markt, Tempo und
  Pause) und alle anderthalb Sekunden die Gebäudeliste.
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
| „Der Gastgeber ist gerade nicht erreichbar" | Das Gerät des Gastgebers ist gesperrt, geschlossen oder ohne Netz. |
| Marke „Der Gastgeber pausiert" | Kein Fehler: Der Gastgeber hat angehalten. Weiter geht es, wenn er die Pause beendet. |
| „Tempo und Pause bestimmt der Gastgeber" | Kein Fehler: Beim Gast sind diese Knöpfe nur Anzeige. |
| „Partie beendet" (beim Gast) | Der Gastgeber hat die Partie geschlossen. „Zu meinem Spiel" führt zurück zum eigenen Stand. |

## Grenzen der aktuellen Fassung

- Genau **zwei** menschliche Mitspieler (Plätze 1 und 2), dazu zwei KI-Gegner.
- Der Gastgeber kann nicht wechseln: Verlässt er die Partie, ist sie vorbei.
- Der Spielstand wird nur beim Gastgeber gespeichert.
- Lädt der Gastgeber die Seite mitten in der Partie neu, ist die Partie
  beendet; fortsetzen lässt sie sich über „In dieser Welt weiterspielen".
- Beim Gast werden Schiffe und Truppen zwischen zwei Meldungen
  gleichmäßig nachgeführt. Sie fahren dadurch ruhig, liegen aber einen
  Wimpernschlag hinter dem Stand des Gastgebers – für die Berechnung
  zählt immer dessen Stand.
- Bäume, die gefällt, und Erz, das abgebaut wurde, reisen nicht mit:
  Steigt jemand in eine länger laufende Welt ein, sieht er dort noch den
  ursprünglichen Wald.
