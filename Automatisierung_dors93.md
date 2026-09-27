# Automatisierung – Fallbeschreibung für die Themensuche

**Fall:** Entwicklung eines browserbasierten Aufbau-Strategiespiels (`public/inselspiel.html`)
**Akteure:** eine Person ohne Programmiertätigkeit (Anforderungen, Abnahme) + KI-Agent (Umsetzung)
**Zeitraum:** 05.07.–01.08.2026 · **Repository:** `dors93-create/App-Gartenplanung`

> **Wichtige Einordnung:** Automatisiert wurde **kein fachlicher Geschäftsprozess**, sondern der
> **Software-Entwicklungsprozess selbst**. Der Fall eignet sich damit als Untersuchungsgegenstand
> zu „agentische KI in der Softwareentwicklung", nicht als klassische Prozessautomatisierung.

## 1. Automatisierter Prozess

Vollständiger Entwicklungszyklus ohne manuelles Programmieren:
Anforderung in Alltagssprache → Quelltextänderung → automatisierter Browsertest → Commit →
Merge → Build → Veröffentlichung. Der Mensch liefert nur Anforderung und Abnahmeurteil; alle
Zwischenschritte laufen agentisch. Klassisch manuelle Tätigkeiten, die entfielen: Codieren,
Regressionstests, Screenshot-Prüfung auf Mobilgeräten, Release-Durchführung.

## 2. Eingesetzte Werkzeuge

| Schritt | Werkzeug |
|---|---|
| Anforderung/Steuerung | Claude Code (Cloud-Container), Modelle Fable 5 / Opus 5 |
| Codeänderung | Datei-Editier-Tools; bei Massenänderungen generierte Python-Skripte |
| Qualitätssicherung | Node.js `--check` (Syntax), Playwright + Chromium (headless, 12 eigens erzeugte Testskripte) |
| Visuelle Prüfung | Automatisierte Screenshots, u. a. in iPhone-Auflösung (390×844) |
| Versionierung/Release | Git, GitHub MCP-Schnittstelle, GitHub Actions → GitHub Pages |

## 3. Datenquellen und Dokumenttypen

- **Eingang:** Anforderungstexte im Chat (Freitext, deutsch); **Screenshot-Uploads (PNG)** als
  Fehlermeldung durch den Nutzer; `CLAUDE.md` als verbindliches Konventionsdokument.
- **Verarbeitet:** Quelltext (HTML/CSS/JS, eine Datei, zuletzt **2.688 Zeilen**), Git-Historie,
  CI-Workflow-Definition (YAML), Workflow-Status über die GitHub-API.
- **Ausgang:** Commits mit strukturierten Nachrichten, Testprotokolle (JSON), Screenshots,
  öffentlich ausgelieferte Webseite.

## 4. Mengengerüst (gemessen aus Git und Sessionverlauf)

| Kennzahl | Wert |
|---|---|
| Anforderungs-Iterationen (Nutzerwünsche) | 9 |
| Commits auf das Artefakt | 8 |
| Geänderte Codezeilen | ca. 3.190 hinzugefügt / 500 entfernt |
| Automatisierte Testläufe / Testskripte | ca. 20 Läufe / 12 Skripte |
| Erzeugte Prüf-Screenshots | ca. 13 |
| Deployments (Build + Veröffentlichung) | 8, vollautomatisch |
| Durchsatz je Iteration | 1 Anforderung → 1 getesteter, veröffentlichter Release |

Hochrechnung für eine Vollzeitnutzung: ca. **3–5 solcher Iterationen pro Arbeitstag**,
also ca. **60–100 Änderungs-Releases pro Monat** bei einer Person ohne Programmierkenntnisse.

## 5. Zeit- und Fehlerwirkung

- **Nicht gemessen:** Es wurde **keine Baseline** gegen manuelle Entwicklung erhoben, keine
  Bearbeitungszeit je Iteration protokolliert und kein Fehlerzähler geführt. Belastbare
  Effizienzaussagen sind aus dieser Session **nicht** ableitbar – das ist die zentrale Messlücke.
- **Qualitativ belegt:** Die automatisierten Tests fingen mindestens drei Fehler vor der
  Veröffentlichung ab (Initialisierungsfehler beim Zoom-Button, fehlerhafte Erntelogik des
  Holzfällers, fehlgeschlagene Abrissprüfung). Ein Testlauf dauerte Sekunden bis wenige Minuten.
- **Beobachteter Nutzen:** Anforderung bis Live-Version innerhalb eines Dialogs; der Nutzer
  konnte Fehler per Screenshot statt per Fehlerbeschreibung melden.

## 6. Anfallende Daten (für Datenschutz-/Governance-Betrachtung)

Prompt-/Antwort-Paare und Tool-Aufrufprotokolle der Session; Git-Metadaten inkl. Autorenkennung,
Zeitstempel und Session-Verweisen in jeder Commit-Nachricht; Testergebnisse und Screenshots;
CI-Logs. **Personenbezug:** E-Mail-Adresse und Kontoname in der Versionshistorie, dauerhaft
öffentlich im Repository. Keine fachlichen Personendaten, da Spielinhalte synthetisch sind.

## 7. Mögliche Untersuchungsfragen für die Masterarbeit

1. Wie verändert sich Durchlaufzeit und Fehlerquote, wenn Fachanwender:innen ohne
   Programmierkenntnisse per KI-Agent Software ändern? (Baseline-Erhebung nachholen)
2. Welche Prüfmechanismen (automatisierte Tests, Screenshots, Bestätigungsdialoge) sind nötig,
   damit ein solcher Ablauf ohne Code-Review freigabefähig ist?
3. Welche Governance-Anforderungen entstehen durch die anfallenden Protokoll- und Metadaten?

---
*Datei ggf. in `Automatisierung_<Nachname>.md` umbenennen – der reale Name lag nicht vor.*
