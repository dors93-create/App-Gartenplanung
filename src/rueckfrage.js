// =========================================================================
// Grünriss – Rückfrage
// -------------------------------------------------------------------------
// Ein kleines Fenster mitten auf dem Bildschirm, das eine Frage stellt und
// die Antworten als beschriftete Knöpfe anbietet. Wir brauchen es dort, wo
// „OK / Abbrechen“ nicht genügt, weil es mehr als zwei Möglichkeiten gibt.
//
// Aufruf (in einer Funktion mit „async“):
//
//   const antwort = await frage({
//     titel: "Hier gibt es schon einen Garten",
//     text: "…",
//     knoepfe: [
//       { wert: "oeffnen", text: "Garten unverändert öffnen", haupt: true },
//       { wert: "neu", text: "Neuen Garten anlegen" },
//     ],
//   });
//   // antwort ist jetzt "oeffnen" oder "neu" – oder null bei „Abbrechen“.
//
// Der Knopf mit „haupt: true“ ist die empfohlene Antwort (grün). Unter den
// Antworten steht immer zusätzlich „Abbrechen“.
//
// Das Grundgerüst (<dialog id="rueckfrage">) steht in index.html, die
// Gestaltung in style.css.
// =========================================================================

// So lange nach dem Erscheinen der Frage zählen Klicks auf ihre Knöpfe noch
// nicht (Millisekunden). Sonst könnte der zweite Klick eines Doppelklicks
// gleich eine Antwort auslösen, die niemand gelesen hat.
const KNOPF_SPERRE_MS = 400;

const fenster = document.getElementById("rueckfrage");
const titelFeld = document.getElementById("rueckfrage-titel");
const textFeld = document.getElementById("rueckfrage-text");
const knopfFeld = document.getElementById("rueckfrage-knoepfe");

// Die Funktion, die die gerade offene Frage beantwortet (null = keine offen).
let beantworte = null;

// Fenster schließen und die Antwort weitergeben.
function schliesse(antwort) {
  if (!beantworte) return; // es ist gar keine Frage offen
  const weiter = beantworte;
  beantworte = null;
  if (fenster.hasAttribute("open")) {
    if (fenster.close) fenster.close();
    else fenster.removeAttribute("open");
  }
  weiter(antwort);
}

// Die Esc-Taste schließt ein solches Fenster von selbst. Das zählt als
// „Abbrechen“. (Dasselbe Ereignis kommt auch nach einem Knopfdruck noch
// hinterher – dann ist die Frage längst beantwortet. Sollte inzwischen schon
// die nächste Frage offen sein, lassen wir sie in Ruhe.)
fenster.addEventListener("close", () => {
  if (!fenster.hasAttribute("open")) schliesse(null);
});

// Stellt eine Frage. Rückgabe: ein Versprechen (Promise) auf die Antwort –
// der „wert“ des gedrückten Knopfes oder null bei „Abbrechen“.
export function frage({ titel, text, knoepfe }) {
  // Es kann immer nur eine Frage offen sein.
  if (beantworte) return Promise.resolve(null);

  // Texte eintragen. (textContent: Der Text wird nie als HTML gedeutet.)
  titelFeld.textContent = titel;
  textFeld.textContent = text;

  // Knöpfe neu aufbauen: erst die Antworten, zuletzt immer „Abbrechen“.
  const geoeffnetUm = performance.now();
  knopfFeld.innerHTML = "";
  [...knoepfe, { wert: "abbrechen", text: "Abbrechen" }].forEach((k) => {
    const knopf = document.createElement("button");
    knopf.type = "button";
    knopf.className = k.haupt ? "btn btn--primary" : "btn btn--ghost";
    knopf.dataset.wert = k.wert;
    knopf.textContent = k.text;
    knopf.addEventListener("click", (e) => {
      // Zu früh? (Zählung 0 = Tastatur – die ist nie ein Doppelklick.)
      const zuFrueh = performance.now() - geoeffnetUm < KNOPF_SPERRE_MS;
      if (zuFrueh && e.detail > 0) return;
      schliesse(k.wert === "abbrechen" ? null : k.wert);
    });
    knopfFeld.append(knopf);
  });

  return new Promise((weiter) => {
    beantworte = weiter;
    // showModal() legt das Fenster über alles andere und sperrt den Rest der
    // Seite, bis geantwortet ist. (Sehr alte Browser kennen das nicht – dort
    // zeigen wir das Fenster einfach an.)
    if (fenster.showModal) fenster.showModal();
    else fenster.setAttribute("open", "");
    // Die empfohlene Antwort vorwählen (für die Bedienung per Tastatur).
    const vorgewaehlt =
      knopfFeld.querySelector(".btn--primary") || knopfFeld.firstElementChild;
    if (vorgewaehlt) vorgewaehlt.focus();
  });
}
