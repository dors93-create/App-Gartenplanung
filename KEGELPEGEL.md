# Kegelpegel Olympiade – Punktestand einrichten

Die Seite liegt unter
`https://dors93-create.github.io/App-Gartenplanung/kegelpegel.html`
und ist eine einzige Datei: `public/kegelpegel.html`.

Diese Anleitung erklärt in zwei Teilen:

1. **Bedienung** – wie du Teams setzt, Spiele freigibst und Punkte vergibst.
2. **Live-Verbindung** – die einmalige Einrichtung, damit alle den
   Punktestand *gleichzeitig* sehen.

---

## 1. Bedienung

### Anmelden

Ganz unten auf der Seite steht ein Feld **„Verwaltung"**. Antippen, dann:

- E-Mail: `dors93@gmx.de`
- Passwort: `Kegelpegel`

Die Anmeldung bleibt 60 Tage auf dem Gerät gespeichert. Alle anderen sehen
das Feld zwar auch, kommen aber ohne Passwort nicht hinein.

> **Wichtig zu wissen:** Bei einer reinen HTML-Seite gibt es keinen echten
> Tresor. Das Passwort steht nicht im Klartext im Quelltext – dort liegt nur
> ein nicht umkehrbarer Fingerabdruck. Gegen jemanden, der sich wirklich
> auskennt und es darauf anlegt, schützt das trotzdem nicht. Für eine
> Kegel-Olympiade reicht es.

### Was du einstellen kannst

| Bereich | Was passiert |
|---|---|
| **Die beiden Teams** | Namen der Teams. Sie erscheinen überall auf der Seite. |
| **Wer spielt mit** | Neun Personen sind vorbereitet. Namen eintragen, Team wählen. Über „+ Person hinzufügen" kommen weitere dazu, das `×` entfernt eine. Wer auf „–" steht, taucht in keiner Aufstellung auf. |
| **Spiele freigeben und werten** | Je Spiel: ein Schalter für sichtbar/geheim, der Name, die Punktzahl, die Besetzung und wer gewonnen hat. |

### Spiele freigeben

Solange der Schalter auf **geheim** steht, sehen alle nur:

- die Spielnummer,
- zwei graue Platzhalter-Balken statt des Namens,
- die **Punktzahl** des Spiels,
- Punkte-Reihen, die zeigen, **wie viele Personen je Team** antreten.

Sobald du den Schalter auf **sichtbar** stellst, erscheint der Name – bei
allen, die die Seite offen haben, mit einer kurzen Einblende-Animation.

### Punkte vergeben

In jeder Spielzeile stehen vier Knöpfe hinter „Gewonnen":

- **Team 1** – das rote Team bekommt die volle Punktzahl
- **Unent.** – beide Teams bekommen die *halbe* Punktzahl
- **Team 2** – das schwarze Team bekommt die volle Punktzahl
- **offen** – noch nicht gewertet, die Punkte zählen zu „noch zu vergeben"

Die Punktzahl steigt vorgegeben von Spiel 1 (1 Punkt) bis Spiel 10
(10 Punkte), zusammen **55 Punkte**. Jede Zahl lässt sich einzeln ändern.

---

## 2. Live-Verbindung einrichten (einmalig, ca. 10 Minuten)

Ohne diesen Schritt merkt sich die Seite den Punktestand **nur auf deinem
eigenen Handy**. Die anderen sehen dann immer den Ausgangszustand. Mit der
Verbindung sehen alle jede Änderung sofort.

Dafür brauchst du ein kostenloses **Firebase**-Projekt (Google). Es kostet
nichts und die kostenlose Stufe reicht für so eine Olympiade um ein
Vielfaches.

### Schritt 1 – Projekt anlegen

1. <https://console.firebase.google.com> öffnen und mit einem Google-Konto
   anmelden.
2. **„Projekt erstellen"** anklicken.
3. Name eingeben, z. B. `kegelpegel`. Weiter.
4. **Google Analytics ausschalten** (brauchen wir nicht). Projekt erstellen.

### Schritt 2 – Datenbank anlegen

1. Links im Menü **„Erstellen" → „Realtime Database"** wählen.
   ⚠️ Wirklich *Realtime Database*, **nicht** „Firestore".
2. **„Datenbank erstellen"** anklicken.
3. Als Standort **`europe-west1`** wählen (Server in Europa).
4. Beim Sicherheitsmodus **„Im gesperrten Modus starten"** wählen –
   die passenden Regeln setzen wir gleich selbst.

### Schritt 3 – Regeln setzen

Oben auf den Reiter **„Regeln"** wechseln, alles markieren und durch genau
diesen Text ersetzen, dann **„Veröffentlichen"**:

```json
{
  "rules": {
    "kegelpegel": {
      ".read": true,
      "stand": {
        ".write": true,
        ".validate": "newData.isString() && newData.val().length < 20000"
      }
    }
  }
}
```

Was das bedeutet: Lesen darf jeder, der den Link hat. Geschrieben werden darf
ausschließlich das eine Feld mit dem Punktestand, und auch nur ein Text unter
20 000 Zeichen. Niemand kann die Datenbank also mit fremden Daten vollmüllen.

### Schritt 4 – Zugangsdaten holen

1. Oben links auf das **Zahnrad ⚙ → „Projekteinstellungen"**.
2. Runterscrollen zu **„Meine Apps"**.
3. Auf das **Web-Symbol `</>`** klicken.
4. Irgendeinen Spitznamen eingeben, z. B. `Kegelpegel`, und registrieren.
   („Firebase Hosting" **nicht** ankreuzen.)
5. Es erscheint ein Textblock, der so anfängt:

```js
const firebaseConfig = {
  apiKey: "AIza…",
  authDomain: "kegelpegel-1234.firebaseapp.com",
  databaseURL: "https://kegelpegel-1234-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "kegelpegel-1234",
  …
};
```

Diesen Block **komplett kopieren**.

> Wenn die Zeile `databaseURL` fehlt, wurde in Schritt 2 keine *Realtime
> Database* angelegt (sondern vermutlich Firestore). Dann Schritt 2 nachholen.

### Schritt 5 – Auf dem eigenen Gerät ausprobieren

Auf der Kegelpegel-Seite anmelden, im Bereich **„Live-Verbindung"** den Block
in das große Feld einfügen und auf **„Verbinden"** tippen. Die Seite lädt neu.
Oben unter dem Titel muss jetzt ein grüner Punkt mit **„live"** stehen.

### Schritt 6 – Für alle fest eintragen

Schritt 5 gilt nur für dein eigenes Gerät. Damit **alle** live mitlesen,
müssen die Zugangsdaten fest in die Datei. In `public/kegelpegel.html` steht
ganz oben im Programmteil:

```js
const FIREBASE_KONFIG = {
  // apiKey:            "…",
  // authDomain:        "…firebaseapp.com",
  …
};
```

Dort die Werte eintragen (die `//` am Zeilenanfang entfernen), speichern und
hochladen. Am einfachsten: **den kopierten Block einfach an Claude schicken** –
dann wird er eingetragen und veröffentlicht.

> **Zur Sicherheit:** Diese Zugangsdaten sind nicht geheim, sie stehen bei
> jeder Firebase-Web-App im Quelltext. Geschützt wird über die Regeln aus
> Schritt 3. Theoretisch könnte jemand, der den Link hat und sich auskennt,
> den Punktestand überschreiben. Wer das ausschließen will, braucht ein
> echtes Firebase-Login – das lässt sich nachrüsten.

---

## Häufige Fragen

**Die anderen sehen meine Änderungen nicht.**
Steht unter dem Titel „live"? Wenn dort „nur auf diesem Gerät" steht, ist
Schritt 6 noch offen.

**Ich habe mich ausgesperrt / falsch geklickt.**
„Alles zurücksetzen" ganz unten in der Verwaltung stellt den Ausgangszustand
wieder her. Achtung: Punkte, Teams und Freigaben sind dann weg.

**Kann ich die Reihenfolge oder Punktzahl ändern?**
Punktzahl, Name und Besetzung ja – direkt in der Verwaltung. Die Reihenfolge
der zehn Spiele steht in der Datei (`SPIELE_VORLAGE`).

**Läuft die Seite auch ohne Internet?**
Der Punktestand ja (er liegt zusätzlich im Browser-Speicher). Für die
Live-Verbindung und die Schriften braucht es Netz.
