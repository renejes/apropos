# Handover — Research Overview Platform

> Vollständiger Kontext für einen neuen Chat. Stand: **2026-07-31**.
> Wer hier anfängt, sollte danach ohne Rückfragen weiterarbeiten können.

---

## 1. Was das Produkt ist — und warum

Eine **lokale Electron-Desktop-App**, die KI-Deep-Research von einer Blackbox in ein **prüfbares Artefakt** verwandelt.

Das Problem, das sie löst: Deep-Research-Werkzeuge liefern Berichte mit Fußnoten, aber niemand kann nachvollziehen, *warum* eine Quelle genommen wurde, *was* aus ihr stammt und *ob* das Zitat überhaupt darin steht. Die Forschungslage ist eindeutig und ernüchternd — bei Deep-Research-Agenten sind Links zu über 94 % valide und thematisch meist passend, aber die **faktische Deckung liegt nur bei 39–77 %** und **fällt um ~42 %, wenn die Tool-Calls von 2 auf 150 steigen** (arXiv 2605.06635). Mehr Recherchetiefe erzeugt also *nicht* mehr korrekte Zitate. Dazu: bis zu 57 % der Begründungen sind post-hoc rationalisiert, nicht kausal genutzt.

**Das Leitprinzip, aus dem alles folgt:** KI-Einträge sind nie Wahrheit, sondern *zu verifizierende Behauptungen mit Status und Konfidenz*. Der menschliche Sign-off ist ausschließlich in der UI möglich — **kein Werkzeug kann ihn setzen**.

**Zielgruppe:** akademische Recherche *und* Marketing/Business gleichwertig.

**Geschäftsmodell:** keines. Das Projekt wird **nicht verkauft** (Entscheidung 2026-07-30). Fragen zu Marktgröße und Preismodell sind damit gegenstandslos. Open Source ist die passende Form — ein Provenienz-Werkzeug, dessen Prüflogik man nicht nachlesen kann, ist ein Widerspruch in sich.

---

## 2. Die drei Erzwingungen — das ist der Kern

Alles andere ist Infrastruktur. Diese drei Mechanismen sind das Produkt:

### (a) Korrektheit — das Zitat ist unfälschbar

Nicht „prüfbar", sondern **unfälschbar**. Der Weg:

1. `fetch_source` ruft die Quelle **selbst** ab, speichert den Text (Tabelle `documents`) und gibt ein Textfenster mit Zeichenpositionen zurück.
2. `add_source` bekommt `{document_id, quote_start, quote_end}` — und **der Server schneidet das Zitat aus dem gespeicherten Text**.

Das Modell kann kein Zitat mehr erfinden; es kann nur auf vorhandenen Text zeigen. Gibt es zusätzlich einen Zitattext an, der nicht zu den Positionen passt, wird der Eintrag abgewiesen (im E2E-Test belegt).

Der alte Weg (`verbatim_quote` ohne `document_id`, Server holt die Quelle und prüft exakt/normalisiert/fuzzy) bleibt für PDFs und Paywalls erhalten.

### (b) Vollständigkeit — dokumentieren ist nicht optional

Der Server verweigert weitere `fetch_source`-Aufrufe, solange abgerufene Quellen noch nicht per `add_source` oder `exclude_source` dokumentiert sind (Standard 3, via `ROP_MAX_PENDING`).

**Warum serverseitig und nicht per Hook:** Die Claude-Code-Hooks (`skills/transparent-research/hooks/provenance-gate.cjs`) leisten dasselbe, aber sie feuern in **Subagenten nachweislich nicht** verlässlich und sind per `disableAllHooks` abschaltbar. Der Server ist es nicht.

### (c) Tiefe — „genug recherchiert" ist keine Modellentscheidung

- `plan_research` legt **Teilfragen** an (je mit `min_sources`). Ohne sie kann nichts gemessen werden.
- `get_coverage_gaps` liefert die **serverseitig berechnete** Lückenliste — eine Zählung, kein Modellurteil.
- `next_round` misst die **Sättigung** (neu belegte Quellen dieser Runde) und entscheidet über `should_continue`.
- `add_report_version` **lehnt ab**, solange blockierende Lücken offen sind. Bewusste Quittierung nur mit Begründung, die unlöschbar im `event_log` und in der `change_summary` landet.

Ein Test hält das fest: Die Modellbehauptung *„Ich bin fertig, alles ist bestens belegt"* schließt keine Lücke.

---

## 3. Zwei Betriebsmodi

| | **MCP-Modus** | **Eingebaute Engine** |
|---|---|---|
| Wer treibt | Fremdclient (Claude Code, Codex, Goose, DeepChat …) | die App selbst |
| Modell | das des Clients | Ollama (lokal *oder* Cloud) |
| Status | erprobt | gebaut, gegen Fake-Modell verifiziert |

**Beide teilen alles unterhalb der Schleife**: dieselbe DB, dieselbe Service-Schicht, dasselbe Enforcement, dieselbe Verifikations-Leiter. Die Engine bindet den MCP-Server **in-process** ein (`InMemoryTransport`) — eine Werkzeugdefinition, kein zweiter Pflegepfad.

Das ist bewusst kein Kompromiss, sondern das Argument: **Die Plattform ist modellunabhängig, weil die Wahrheit nicht vom Modell kommt.**

**Die Engine ist seit 2026-07-31 gegen Langlauf-Realität gehärtet** (Schritt 4 der Next Steps):

- **Quota-Guard vor jedem Spawn.** Ein erschöpftes Kontingent, ein unerreichbarer Dienst oder ein aufgebrauchtes Token-Budget beendet den **Lauf**, nicht nur die Teilfrage. Das Token-Budget gilt für den gesamten Lauf, nicht je Aufruf — und ein Fünftel bleibt der Synthese reserviert, sonst endet ein knapper Lauf mit Quellen, aber ohne Bericht.
- **Checkpoint/Resume** über die Tabelle `engine_runs`. Steht beim App-Start ein Lauf auf `running`, kann er keinen lebenden Prozess mehr haben — er wird als `interrupted` geheilt und ist fortsetzbar. Beim Fortsetzen bekommt das Modell zuerst die Quellen genannt, die der Vorlauf zwischen `fetch_source` und `add_source` liegen ließ.

---

## 4. Stack & Landkarte

**Electron · React 18 · Tailwind v4 · Material Symbols · better-sqlite3 (WAL, FTS5) · `@modelcontextprotocol/sdk` 1.29 · Zod · Vitest**

```
src/main/core/
  db.ts                    Schema v5 + mehrprozess-sichere Migration
  repo.ts                  Datenzugriff + append-only event_log + engine_runs (Checkpoint)
  services/research.ts     ► ENFORCEMENT LEBT HIER (nicht im MCP-Handler!)
  services/literature.ts   OpenAlex, Crossref, Europe PMC, arXiv
  providers/               Anbieter-Abstraktion + Ollama-Adapter
  engine/                  ToolBridge (in-process MCP), AgentLoop, ResearchEngine, RunBudget
  enforce/                 SSRF-Fetcher, Quote-Matching, deterministische Verifikation
src/main/mcp/server.ts     26 Tools + 4 Prompts (dünne Wrapper um die Services)
src/main/mcp/http.ts       Streamable HTTP auf 127.0.0.1:8790 + Rebinding-Schutz
src/renderer/src/          UI (Abdeckung, Lücken, Quellen-Review, Engine-Panel)
skills/transparent-research/  Claude-Code-Skill + Provenienz-Gate-Hooks
documentation/01–07        Konzept, Status, Next Steps, Feasibility, Markt, Engine, Clients
```

**Die wichtigste Architekturregel:** Enforcement liegt in `services/research.ts`, **unter** der Schnittstelle. Wer neue Schreibpfade baut, ruft die Services — nie `repo.*` direkt. Sonst hätte ausgerechnet die eigene Engine schwächere Garantien als ein Fremdclient.

**Die zweitwichtigste:** Eine Fehlerantwort muss sich **selbst tragen**. Nur drei von 20 Clients werten `isError` aus; die anderen 17 legen dem Modell den Text hin wie jedes andere Ergebnis. Deshalb beginnt jede Fehlerantwort mit `status: "FEHLER …"` und trägt eine `next_action` im Imperativ — und deshalb ist der Hinweis ein **Pflichtparameter** von `ServiceError`. Wer eine neue Fehlerstelle baut, wird vom Compiler danach gefragt.

---

## 5. Fallstricke, die garantiert beißen

| Problem | Ursache | Abhilfe |
|---|---|---|
| App startet nicht: `Cannot read properties of undefined (reading 'whenReady')` | `ELECTRON_RUN_AS_NODE=1` in der Shell — dieselbe Variable, die der stdio-Server nutzt | `env -u ELECTRON_RUN_AS_NODE npm run dev` |
| `NODE_MODULE_VERSION`-Fehler | better-sqlite3 ist ein natives Addon; Node- und Electron-ABI unterscheiden sich | `npm run abi:node` für Tests, `npm run abi:electron` für die App |
| Ollama findet keine Modelle | `OLLAMA_MODELS` (4× in `~/.zshrc`) und `~/.ollama/models` zeigen auf `/Volumes/RjProgLearn/…` — **existiert nicht mehr** | Symlink neu setzen oder `OLLAMA_MODELS` umbiegen. Der Daemon selbst startet einwandfrei (2026-07-31 auf Port 11435 verifiziert) |
| Cloud-Modelle nicht verfügbar | `"disable_ollama_cloud": true` in `~/.ollama/server.json` | **Die Env-Variable `OLLAMA_NO_CLOUD=false` überschreibt das NICHT** (nachgemessen) — die Datei ändern, Daemon neu starten, `ollama signin` |
| Modellnamen laufen ins Leere | Ollama nimmt Cloud-Modelle **im Wochenrhythmus** vom Netz (15.07.2026: 16 Stück auf einmal) | Nie fest verdrahten. Liste: `ollama.com/search?c=cloud` |

**Verifikation (immer alle drei):**
```bash
npm run typecheck
npm run abi:node && npm test        # 149 Tests
npm run smoke                       # E2E gegen echten MCP-Client
```
Zusätzlich: `npm run ollama:check <modell>` (Live-Test inkl. echtem Tool-Call), `npm run lit:check "frage"` (Literatursuche gegen echte Register).

---

## 6. Entscheidungen mit Begründung — bitte nicht neu aufrollen

Diese Punkte sind recherchiert und entschieden. Sie wieder vorzuschlagen kostet nur Zeit.

**Gestrichen:**

- **Eigenes Chat-/Antwort-Panel.** `discuss_research` existiert als MCP-Prompt *und* als Werkzeug, funktioniert also überall. Der Sprung vom Zitat in den Quelltext existiert bereits im Quellen-Tab.
- **Eigene generische Ollama-Chat-App.** Gelöstes Problem (DeepChat, Cherry Studio, Goose, 5ire). Reor — 8.574 Sterne, exakt dieses Konzept — ist archiviert.
- **Auth + Tunnel + OAuth 2.1.** Hätte nur Browser-only-ChatGPT-Nutzern gedient; die können eine Desktop-App ohnehin nicht verwenden. Für OpenAI gibt es **Codex**, das lokal andockt.
- **Abo-basierter Modellzugang.** Z.ai, Moonshot und Alibaba verbieten die Nutzung in eigenen Apps **wörtlich** und setzen es technisch durch. Und es lohnt nicht: DeepSeek V4-Flash kostet ~0,13 $ pro Lauf, 100 Läufe ≈ 21 $ — billiger als jedes Abo.
- **MCP Sampling und Roots.** Seit Spec 2026-07-28 deprecated; von den großen Hosts nie implementiert.
- **Server-seitige Suche der Modellanbieter.** Moonshot gibt nur eine opake `search_id` zurück, DeepSeek nur `encrypted_content` — ohne echte URLs bricht die Verifikations-Kette.
- **Phasenweises Ausblenden von Tools per `list_changed`.** Bei parallelen Agenten schädlich: Agent A blendet aus, was Agent B braucht.

**Bewusst so gebaut:**

- **Suche entkoppelt einkaufen** (0–10 $/Monat), primär über die **kostenlosen akademischen APIs** — die liefern DOIs statt geratener URLs.
- **Verifikation nutzt nie fremd-extrahierten Text.** Zwei Extraktoren normalisieren unterschiedlich; korrekte Zitate würden scheitern, erfundene durchrutschen. Ein einziger versionierter Extraktor, lokal.
- **Kein Chat für Engine-Läufe.** Ein Research-Lauf ist ein **Job-Monitor** (Eingabe, autonome Arbeit, Abbruch-Knopf), kein Dialog.

---

## 7. Was zwei Recherchen ergeben haben (Kurzfassung)

**Anbieter/Kosten** ([06](documentation/06-eigene-research-engine.md), 2026-07-26): Das gesuchte Abo-Modell existiert nicht, wird aber nicht gebraucht. Reasoning ist der Kostentreiber, nicht die Suche (Perplexitys eigenes Beispiel: 71 % Reasoning, 13 % Suche).

**Client-Kompatibilität** ([07](documentation/07-clients.md), 2026-07-30, Quellcode-Prüfung von 20 Clients): Streamable HTTP funktioniert in 17 von 20 — der Transport war nie das Problem. **MCP-Prompts sind die Bruchlinie**: nur sechs Clients können sie mit Argumenten ausführen; Cherry Studio hat die Fähigkeit in v2 wieder *entfernt*. Deshalb spiegelt der Server jeden Prompt zusätzlich als Werkzeug (`start_transparent_research` …). Empfohlen: **Goose** (max_turns 1000, liest als einziger die Server-`instructions`) und **DeepChat** (128 Tool-Calls/Runde).

**Nicht die Fähigkeiten der Clients brechen eine Recherche, sondern ihre Defaults** — AnythingLLM stoppt nach 10 Tool-Calls, Cherry Studio nach 20. Eine Recherche braucht 10–40.

---

## 8. Zwei Fehler, die nur durch Nachmessen auffielen

Erwähnenswert, weil sie das Arbeitsmuster zeigen:

1. **Der DNS-Rebinding-Schutz war wirkungslos.** Bis SDK 1.24 lagen `enableDnsRebindingProtection`/`allowedHosts` im Transport; seit 1.25 sind sie entfernt und werden **stillschweigend ignoriert**. Kein Fehler, keine Warnung, nur kein Schutz. Jetzt Express-Middleware, sechs Tests.
2. **Die Migration war nicht mehrprozess-sicher.** `BEGIN DEFERRED` ließ 26 von 60 gleichzeitig startenden Prozessen mit `SQLITE_BUSY_SNAPSHOT` abbrechen — ein Fehlerbild, bei dem der Busy-Handler per Definition nicht greift. Jetzt `BEGIN IMMEDIATE` + Re-Check, gemessen 20/20.
3. **Schema-Verstöße erreichten die eigenen Handler nie** (31.07.). Das SDK validiert vor dem Aufruf und macht aus dem Fehler selbst ein Werkzeugergebnis: englischer Protokolltext mit rohem Zod-JSON. Ausgerechnet die *häufigste* Fehlerklasse war die einzige ohne Handlungsanweisung. Der Ansatzpunkt (`createToolError`) ist im SDK `private` — deshalb scheitert der Server jetzt **laut**, wenn er verschwindet.
4. **Ein erschöpftes Kontingent beendete den Lauf nicht** (31.07.). Es wurde je Teilfrage und je Runde erneut angerannt. Der Test war zuerst da: Er erwartete einen Versuch und zählte vier.

Alle vier fielen durch adversarisches Review bzw. gezieltes Messen auf, keiner durch die bestehenden Tests. **Grüne Tests sind kein Beleg, wenn der Test das Problem nicht nachstellen kann** — ein Rebinding-Test mit `fetch()` war zunächst grün, weil Node den `host`-Header gar nicht überschreiben lässt.

Deshalb gehört zu jeder neuen Zusicherung eine **Mutationsprobe**: die Wirkung kurz entfernen und nachsehen, ob der Test rot wird. Bei den Änderungen vom 31.07. war das dreimal nötig — einmal war ein Test grün, ohne irgendetwas zu unterscheiden.

---

## 9. Der Stand in Zahlen

| | 2026-07-24 (MVP) | 2026-07-30 | 2026-07-31 |
|---|---|---|---|
| MCP-Tools | 13 | **26** | 26 |
| Tests | 17 | 123 | **149** |
| Schema | v2 | v4 | **v5** |
| Betriebsmodi | 1 | **2** | 2 |

Typecheck, Tests, E2E-Smoke und Build sind grün. Die App startet und wurde durchgeklickt.

---

## 10. Was als Nächstes ansteht

**Der eine Schritt, an dem alles hängt: ein echter Lauf mit einem echten Modell.** Die gesamte Maschinerie ist gegen Fixtures und ein skriptbares Fake-Modell verifiziert — **nie gegen ein reales**.

> **Dieser Schritt ist auf Renés Rechner blockiert, nicht im Code** (gemessen 2026-07-31). Drei Handgriffe fehlen, zwei davon an der Systemkonfiguration:
> 1. `~/.ollama/server.json`: `"disable_ollama_cloud"` auf `false`. **Die Env-Variable `OLLAMA_NO_CLOUD=false` genügt nicht** — die Datei gewinnt, nachgemessen.
> 2. `OLLAMA_MODELS` in `~/.zshrc` (steht dort 4×) zeigt auf `/Volumes/RjProgLearn/…`, das es nicht mehr gibt. Auf einen existierenden Pfad umbiegen; `~/.ollama/models` ist derselbe tote Symlink.
> 3. `ollama signin` — öffnet den Browser, nur interaktiv machbar.
>
> Der Daemon selbst läuft einwandfrei, sobald `OLLAMA_MODELS` gültig ist (auf Port 11435 verifiziert).

```bash
# 1. Vorbedingungen (15 Min) — siehe Kasten oben, dann:
ollama serve && ollama signin
# Modell von ollama.com/search?c=cloud wählen:
ollama pull <modell>

# 2. Die entscheidende Minute
npm run ollama:check <modell>
#    "✅ Werkzeugaufruf"    -> Engine startklar
#    "⚠️ KEIN Werkzeugaufruf" -> Modell für die Schleife untauglich
```

Danach dieselbe Forschungsfrage einmal im MCP-Modus (Claude Code/Codex) und einmal im Engine-Modus. Die Auswertung steht ohne Zusatzarbeit in der DB.

> **Die Messgröße hat sich verschoben.** Ein Modell *kann* kein Zitat mehr erfinden. Spike 1 misst deshalb nicht mehr „wie oft halluziniert es", sondern **„wie oft zeigt es auf die falsche Stelle"**.

Vollständige Reihenfolge: [03 Next Steps](documentation/03-next-steps.md).

---

## 11. Zusammenarbeit mit René

- **Deutsch**, auch in UI-Texten und Code-Kommentaren.
- Gibt gern **Autonomie** („fröhlich vor dich hinarbeiten") und geht danach gemeinsam über die Ergebnisse.
- Stellt **konzeptionelle Rückfragen**, bevor Features fixiert werden — und revidiert eigene Entscheidungen, wenn die Faktenlage sich ändert (siehe „keine eigene Engine" → doch eine).
- Erwartet **belegte Aussagen**. Recherche-Ergebnisse werden adversarisch gegengeprüft; von den geprüften Erstberichten kam regelmäßig „teilweise falsch" zurück.
- **UI:** helle Oberfläche, Tailwind, Material Symbols. Kein MUI.

**Arbeitsweise, die sich bewährt hat:** bauen → verifizieren (Typecheck + Tests + Smoke) → bei UI-Arbeit die App wirklich starten und anschauen → substanzielle Änderungen adversarisch reviewen lassen. Grüne Tests allein sind kein Beleg.
