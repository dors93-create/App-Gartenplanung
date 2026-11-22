# Zu zweit spielen – Inselspiel

Zwei Handys, dieselbe Welt: gemeinsamer Markt, Diplomatie und Krieg.
Die Verbindung läuft über die Firebase-Datenbank, die auch der
Kegelpegel-Punktestand nutzt (`kegeltour-45451`).

## So spielt ihr zusammen

1. **Beide** öffnen das Spiel:
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

## Falls der Beitritt nicht klappt

Dann erlauben die Regeln der Firebase-Datenbank den Pfad `inselspiel`
noch nicht. In der [Firebase-Konsole](https://console.firebase.google.com)
unter **Realtime Database → Regeln** muss er lesbar und schreibbar sein,
zum Beispiel so:

```json
{
  "rules": {
    "kegelpegel": { ".read": true, ".write": true },
    "inselspiel": { ".read": true, ".write": true }
  }
}
```

Stehen dort bereits `".read": true` und `".write": true` auf oberster
Ebene, ist nichts zu tun.

> **Hinweis zur Sicherheit:** Wie beim Kegelpegel ist das eine offene
> Datenbank ohne Anmeldung. Wer den Code kennt, kann mitspielen; wer
> sich auskennt, könnte theoretisch fremde Partien stören. Für ein
> Spiel im Freundeskreis ist das in Ordnung – für mehr nicht.

## Grenzen der aktuellen Fassung

- Genau **zwei** menschliche Mitspieler (Plätze 1 und 2), dazu zwei KI-Gegner.
- Der Gastgeber kann nicht wechseln: Verlässt er die Partie, ist sie vorbei.
- Der Spielstand wird nur beim Gastgeber gespeichert.
- Beim Gast laufen Truppen und Schiffe weich interpoliert, können also
  um Bruchteile einer Kachel von der „Wahrheit" abweichen. Für die
  Berechnung zählt immer der Stand beim Gastgeber.
