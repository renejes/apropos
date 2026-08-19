# 03 · Next Steps

> Was als Nächstes zu tun ist, was das Go/No-Go-Gate entscheidet und welche Fragen noch offen sind.

|  |  |
|---|---|
| **Projekt** | Research Overview Platform |
| **Dokument** | 03 — Next Steps |
| **Stand** | 2026-08-19 · v2.4 |
| **Phase** | Open Source (MIT) · Cursor-first · SDK 1.30 — Kernannahme vor dem empirischen Test |

**Dokument-Set:** [01 Implementationplan](01-implementationplan.md) · [02 Projekt-Status](02-project-status.md) · [03 Next Steps](03-next-steps.md) · [04 Feasibility](04-feasability.md) · [05 Markt-Research](05-market-research.md) · [06 Eigene Research-Engine](06-eigene-research-engine.md) · [07 KI-Clients](07-clients.md)

---

## Der eine Schritt, an dem alles hängt

**Ein echter Lauf mit einem echten Modell.** Die gesamte Maschinerie ist gegen Fixtures und ein skriptbares Fake-Modell verifiziert — nie gegen ein reales. Das ist Spike 1, und der **MCP-Pfad hängt nicht an Ollama**:

1. **App starten + Cursor Agent** — MCP ist im Repo verdrahtet (`.cursor/mcp.json`). Eine echte Recherche mit `start_transparent_research` als Qualitäts-Referenzpunkt.
2. **`npm run ollama:check <modell>`** — nur für den Engine-Modus: *Ruft dieses Cloud-Modell die Werkzeuge überhaupt zuverlässig auf?* Sagt der Check „⚠️ KEIN Werkzeugaufruf", ist das Modell für die Schleife untauglich.
3. **Dieselbe Frage im Engine-Modus** mit Ollama (lokal oder Cloud) — erst nach Schritt 2.
4. **Auswerten** — die Zahlen stehen ohne Zusatzarbeit in der DB: `quote_verified`-Quote, Lücken je Teilfrage, Sättigung je Runde, Anteil im ersten Anlauf verifizierter Quellen.

Der Vergleich beider Modi auf derselben Frage ist die aussagekräftigste verfügbare Messung — gleicher Server, gleiche Werkzeuge, gleiches Enforcement, nur ein anderes Modell.

> **Die Messgröße hat sich verschoben.** Durch den Offset-Zitat-Pfad *kann* ein Modell kein Zitat mehr erfinden. Die Frage lautet daher nicht mehr „wie oft halluziniert es ein Zitat", sondern **„wie oft zeigt es auf die falsche Stelle"** — und ob die Extraktion die Aussage wirklich trägt. Das Erfolgskriterium bleibt (≥80 % faktische Deckung), misst jetzt aber schärfer.

## MCP-SDK & Client-Agnostik (Cursor) — erledigt 2026-08-19

Der Alltagsweg ist **Cursor**, nicht mehr Claude Code.

| Teil | Stand |
|---|---|
| **A · MCP-SDK** | `@modelcontextprotocol/sdk` **1.30.0** (v1-Linie). Rebinding-Schutz bleibt in der Express-Middleware `hostHeaderValidation`. |
| **B · Onboarding** | `.cursor/mcp.json` im Repo, Rule `.cursor/rules/transparent-research.mdc`, kopierbare Snippets in den App-Einstellungen, README + [07](07-clients.md) Cursor-first. Claude-Hooks sind optional. |

**Noch offen an diesem Strang:** Spike 1 im Cursor-MCP-Modus (App läuft, Agent, `start_transparent_research`). Alltag, PDF-Text und Such-Ingest sind seit 2026-08-19 (Abend) im Code.

Status-Dokument: [02 Projekt-Status](02-project-status.md) (v2.2, 2026-08-19).

---

## Reihenfolge

| # | Schritt | Aufwand | Warum |
|---|---|---|---|
| ~~0~~ | ~~MCP-SDK + Cursor-first-Onboarding~~ | — | ✅ **2026-08-19.** SDK 1.30; `.cursor/mcp.json` + Rule; Einstellungen/README/[07](07-clients.md) |
| ~~4A / 2 / 3~~ | ~~Alltag, PDF-Text, WebSearch-Ingest~~ | — | ✅ **2026-08-19 Abend.** `npm start`, Allowlist, PDF-Offsets, `POST /ingest/search`, Cursor-Hooks |
| **1** | **Spike 1 im Cursor-MCP-Modus** (Agent, nicht Chat) | 1 Tag | **Go/No-Go-Gate.** Braucht **keine** Ollama-Cloud |
| 2 | Ollama-Vorbedingungen (`server.json`, `OLLAMA_MODELS`, `ollama signin`) | 15 Min | Nur für den Engine-Vergleich. **Braucht René** |
| 3 | Dieselbe Frage im Engine-Modus + auswerten | ½ Tag | Vergleich MCP (Cursor) vs. Engine |
| 4 | Spike 3 messen — Recall der Verifikations-Leiter | 1–2 Tage | Entscheidet, ob Ebene 3/4 Architektur-Notwendigkeit ist |
| 5 | RO-Crate-Export | 2–3 Tage | Markdown steht; RO-Crate für akademische Akzeptanz |
| 6 | Nebenläufigkeit unter Last (6–16 parallele Agenten) | 1 Tag | Bestätigen, bevor ein Vierstundenlauf darauf setzt |
| 7 | Ground-Truth-Set (50–100 Aussage-Quelle-Paare) | 2–3 Tage | Spike 1 quantitativ statt nur beobachtend |
| ~~A~~ | ~~`hint`-Texte selbsttragend~~ | — | ✅ **2026-07-31.** `status: "FEHLER …"` + `next_action`; SDK-Schemafehler und Beleg-ohne-`isError` behoben |
| ~~B~~ | ~~Auto-Mode-Härtung (Checkpoint/Quota-Guard)~~ | — | ✅ **2026-07-31.** Schema v5, Phantomläufe, Token-Budget mit Synthese-Reserve |

### Schritt 2 ist blockiert — auf Renés Rechner, nicht im Code

Ollama braucht drei Handgriffe, **bevor der Engine-Modus** (nicht Spike 1 in Cursor) laufen kann. Gemessen am 2026-07-31:

| Befund | Zustand | Wirkung |
|---|---|---|
| `~/.ollama/server.json` enthält `"disable_ollama_cloud": true` | Cloud aus | **Die Umgebungsvariable `OLLAMA_NO_CLOUD=false` überschreibt das NICHT** — die Datei gewinnt (nachgemessen). Nur die Datei ändern hilft |
| `OLLAMA_MODELS` zeigt (4× in `~/.zshrc`) auf `/Volumes/RjProgLearn/…` | Laufwerk existiert nicht mehr | `~/.ollama/models` ist ein toter Symlink auf denselben Pfad. Der Daemon startet trotzdem, findet aber keine Modelle |
| `ollama signin` | offen | Öffnet den Browser — nur interaktiv erledigbar |

Der Daemon selbst läuft einwandfrei, sobald `OLLAMA_MODELS` auf ein existierendes Verzeichnis zeigt (verifiziert auf Port 11435). Es fehlen also genau drei Handgriffe, von denen zwei Renés Systemkonfiguration betreffen.

## Ausdrücklich gestrichen

- **Eigenes Chat-/Antwort-Panel.** Fragen zur fertigen Research funktionieren heute schon über `discuss_research` — als MCP-Prompt *und* als Spiegel-Werkzeug, also in jedem Client. Der einzige Mehrwert eines eigenen Panels wäre der Sprung von einer Antwort in den Quelltext; den Sprung selbst gibt es bereits im Quellen-Tab. Fünf bis acht Tage für einen inkrementellen Schritt rechnen sich nicht.
- **Eigene generische Chat-App für Ollama.** Gelöstes Problem, siehe [07 KI-Clients](07-clients.md).
- **Auth + Tunnel + OAuth 2.1 — ersatzlos gestrichen (2026-07-30).** Der Aufwand hätte einer einzigen Gruppe gedient: Menschen, die ausschließlich ChatGPT im Browser nutzen und nichts installieren. Genau die können eine lokale Desktop-App ohnehin nicht verwenden. Für OpenAI-Nutzer gibt es **Codex** — ein lokales Werkzeug wie Claude Code, das lokal andockt (stdio oder HTTP auf `127.0.0.1`). Wer die Plattform installiert hat, installiert auch Codex; das ist keine nennenswerte Hürde. Damit entfällt der gesamte Hosting-/Tunnel-/Auth-Strang.
- **MCP Resources, Sampling, Roots.** Sampling und Roots sind seit Spec 2026-07-28 deprecated; Resources sind passiv und werden vom Modell nicht von selbst gelesen.
- **Phasenweises Ausblenden von Werkzeugen per `tools/list_changed`.** Bei parallelen Agenten im selben Projekt aktiv schädlich — Agent A blendet aus, was Agent B braucht. Kürzen der Beschreibungen wirkt in allen Clients und erzeugt kein Zustandsproblem.

---

## Kritische Kernannahme

**Eine beliebige, per MCP angedockte KI kann Quellen samt strukturierter Bewertung (warum diese Quelle / welches Wissen extrahiert / welcher Beitrag zum Ergebnis) so zuverlässig eintragen, dass der kombinierte Aufwand aus KI-Erfassung + Verifikation + Mensch-Review deutlich kleiner ist als manuelle Provenienz-Dokumentation — und das Ergebnis vertrauenswürdiger.**

Die Forschung stützt diese Annahme *bedingt*: Das **Format-Problem ist gelöst** (Schema-Compliance nahe 100 % mit Constrained Decoding; funktionierende Links >94 %). Das **Inhalts-Problem ist nicht gelöst** (faktische Deckung 39–77 %, unfaithful reasoning bis 57 %, Degradation mit Tiefe). Das Projekt trägt also nur, wenn die Bewertungen *nicht als Wahrheit*, sondern als *zu verifizierende, günstig prüfbare Behauptungen* modelliert werden.

> **Was der Bau seither an dieser Annahme verändert hat:** Zwei der drei Fehlerquellen sind strukturell entschärft. Ein Zitat kann nicht mehr erfunden werden (Offset-Pfad), und „genug recherchiert" ist keine Modellentscheidung mehr (serverseitige Abdeckungsrechnung). Was bleibt, ist die eigentliche inhaltliche Frage: **Trägt die Extraktion die Aussage, und zeigt das Zitat auf die richtige Stelle?** Genau darauf zielt Spike 1 jetzt.

## Verbleibende De-Risking-Experimente

**Spike 1 — Attributionsbenchmark auf dem eigenen Schema** (das Gate)
- **Ziel:** Messen, wie zuverlässig KIs die Provenienz-Felder inhaltlich korrekt befüllen.
- **Vorgehen:** Zuerst MCP-Modus in **Cursor Agent** mit einem Frontier-Modell; danach optional Engine-Modus mit einem Ollama-Modell (gleiche Frage). Je Eintrag bewerten: (a) Link/DOI auflösbar, (b) thematisch relevant, (c) Zitat deckt die Aussage faktisch.
- **Erfolgskriterium:** ≥80 % faktische Deckung beim Frontier-Modell, strukturelle Compliance ≥98 %. Unter 60 % trotz Offset-Zwang → Kernannahme gefährdet, Redesign nötig.

**Spike 2 — Reasoning-vor-Struktur** (billig, 1–2 Tage)
- **Ziel:** Prüfen, ob eine getrennte Begründungs- und Strukturierungsphase die Bewertungsqualität messbar hebt.
- **Stand:** Die Feldreihenfolge (Begründung vor Ergebnis) ist im Schema bereits umgesetzt. Offen ist der Vergleich gegen einen zweistufigen Ablauf.
- **Erfolgskriterium:** ≥5–10 pp bessere inhaltliche Qualität bei gleicher struktureller Compliance.

**Spike 3 — Verifikations-Leiter: Recall beziffern** (1–2 Tage)
- **Ziel:** Belegen, dass der Re-Verification-Pass die Netto-Fehlerrate praktikabel senkt — **ohne dass das Produkt ein eigenes Verifier-Modell betreibt**.
- **Stand:** Ebene 1 (deterministisch) läuft bei jedem `add_source` mit, Ebene 2 (geblindete Session) ist gebaut. Was fehlt, ist die **Messung**: Welcher Anteil der faktisch falschen Einträge fliegt auf welcher Ebene auf?
- **Erfolgskriterium:** Ebene 1+2 flaggen zusammen ≥80 % der faktisch falschen Einträge bei akzeptabler Precision. Darunter wird Ebene 3 (Cross-Client) oder 4 (lokaler Auto-Verifier) zur Architektur-Notwendigkeit statt zur Kür.

> Spike 4 (Multi-Client-Concurrency) ist erledigt und läuft bei jedem `npm run smoke` mit. Spike 5 ist zur Hälfte erledigt — der Markdown-Export steht, RO-Crate ist Schritt 5 oben.

## Entscheidungs-Gate (Klartext)

- **Faktische Deckung < ~60 %** → Produktversprechen gefährdet. Optionen: Redesign des Erfassungs-Flows, schärferer claim-level-Verifier, oder Pivot zu „KI-assistierte, aber mensch-getriebene Provenance".
- **Faktische Deckung ≥ ~80 %** → Kernannahme bestätigt.
- Dazwischen → gezielt an den schwächsten Dimensionen nachbessern (Retrieval-Zwang, Modell-Mindestniveau, Prompt-Schärfe) und erneut messen.

## Offene Fragen

Bewusst getrennt danach, **wie** sie sich klären — das entscheidet, ob man etwas tun muss oder nur weiterarbeiten.

### Klären sich durch Benutzen

Nichts zu planen; die Antwort fällt beim ersten echten Lauf ab.

- **Mindest-Modell-Niveau:** Ab welchem Modell füllen angedockte KIs die Felder verlässlich? Braucht es die Empfehlung „nur Frontier" oder modellspezifische Anpassungen? → fällt bei Spike 1 ab.
- **Audit-Trail-Integrität:** Append-only `event_log` und Mensch-Sign-off stehen. Ob ein Gutachter zusätzlich kryptografisch signierte Logs verlangt, zeigt sich beim ersten Gutachter — nicht vorher.
- **Faithfulness vs. Correctness:** Ob kontrafaktische Checks (ändert sich die Aussage, wenn die Quelle entfällt) nötig sind, hängt davon ab, wie oft die Verifikations-Leiter danebenliegt. Das misst Spike 3.

### Brauchen irgendwann eine Entscheidung

Klären sich **nicht** von selbst — aber sie sind erst fällig, wenn der Anlass da ist.

- **Export-Akzeptanz:** Akzeptieren Journals und Repositorien einen RO-Crate-Provenienz-Anhang als zitierbaren Beleg, oder braucht es zusätzlich einen DOI (Zenodo/OSF)? Das sagt einem niemand ungefragt. Fällig, wenn die erste echte Arbeit ein Provenienz-Paket anhängen soll — dann ist es eine E-Mail an eine Redaktion, nicht ein Rechercheprojekt.
- **Zwei-Schema-Frage:** Deckt sich der Provenienz-Bedarf von Academia (PRISMA/FAIR) und Business/Compliance (EU-AI-Act-Logging) im selben Datenmodell? Fällig, wenn der erste Business-Anwendungsfall real wird. Bis dahin trägt ein Schema.

### Gestrichen

- ~~**ChatGPT-Reichweite & Auth**~~ — siehe oben: Codex dockt lokal an, der Tunnel entfällt.
- ~~**Bottom-up-Marktgröße**~~ — nur entscheidungsrelevant für ein Preismodell. Das Projekt wird nicht verkauft; die Frage ist gegenstandslos.

### Beantwortet und geschlossen

- ~~**Verifikations-Backend**~~ — `search_literature` fragt OpenAlex, Crossref, Europe PMC und arXiv ab; DOI-Auflösung läuft im Fetcher.
- ~~**Desktop-Shell-Entscheidung**~~ — Electron, gebaut und lauffähig.
- ~~**Versionierungs-Backbone**~~ — append-only `event_log` plus unveränderliche Berichtsversionen mit Snapshot-Hash.
- ~~**Spec-Strategie**~~ — SDK **1.30**, Streamable HTTP; Sampling und Roots bewusst ungenutzt. Cursor-Onboarding 2026-08-19.
- ~~**Deep-Research-Integration nach Anbietern**~~ — abgelöst durch [06 Eigene Research-Engine](06-eigene-research-engine.md) und [07 KI-Clients](07-clients.md).
- ~~**Primärer Client**~~ — Cursor (Agent + Streamable HTTP). Claude Code optional.
- ~~**Lizenz**~~ — MIT, öffentliches Repo. Kein Verkauf.

---

## Methodik & Belege

Dieses Dokument fasst mehrere Multi-Agenten-Recherchen zusammen: 2026-07-24 (24 Agenten, MCP/Attribution/Markt), 2026-07-26 (Anbieter- und Abo-Analyse, 23 + 9 Agenten → [06](06-eigene-research-engine.md)), 2026-07-30 (Client-Kompatibilität, 13 Agenten mit Quellcode-Prüfung → [07](07-clients.md)) und die Cursor-first-Umstellung vom 2026-08-19 (SDK 1.30, Onboarding, Open Source). Alle älteren Recherchen mit adversarischer Gegenprüfung je Blickwinkel.

Trotz Verifikation gilt: KI-gestützte Recherche ist nicht fehlerfrei. Entscheidungskritische Zahlen vor verbindlichen Schritten gegenprüfen — mehrere Erstberichte wurden in der Gegenprüfung als teilweise falsch entlarvt, und zwei Befunde (wirkungsloser Rebinding-Schutz, nicht mehrprozess-sichere Migration) waren echte Fehler im eigenen Code, die nur durch Nachmessen auffielen.
