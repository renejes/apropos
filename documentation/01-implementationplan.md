# 01 · Implementation-Plan

> Agent-first Desktop-App: Cursor-SDK-Chat in der Anwendung, unveränderte Provenienz-Schicht, visuelle Lesart — als Nächstes gezielte Research (Brief vor Suche) und Schreibhandoff.

|  |  |
|---|---|
| **Projekt** | Research Overview Platform |
| **Dokument** | 01 — Implementation-Plan |
| **Stand** | 2026-08-20 · v2.1 |
| **Phase** | Visuals stehen · als Nächstes Brief, gezielte Suche, Schreibpaket |

**Dokument-Set:** [01 Implementationplan](01-implementationplan.md) · [02 Projekt-Status](02-project-status.md) · [03 Next Steps](03-next-steps.md) · [04 Feasibility](04-feasability.md) · [05 Markt-Research](05-market-research.md) · [06 Eigene Research-Engine](06-eigene-research-engine.md) · [07 KI-Clients](07-clients.md)

---

## 1. Vision in einem Satz

Eine **local-first Desktop-App**, in der du mit deinem **Cursor-Abo** erst den **Blickwinkel und den Plan** einer Research erarbeitest, dann **gezielt** suchst (wenige passende Quellen, nicht viele), den Korpus auf der Karte aufbereitest und ein **Schreibpaket** an Easy Writing übergibst — während jede Quelle ein **prüfbares Artefakt** bleibt. Sign-off nur in der UI.

Zwei Lieferformen, ein Korpus: **Kunden-/Eigen-Blogs** (Commodity ist der Text, wertvoll ist der Frame) und **wissenschaftliche Arbeiten** (Psychologie ab Oktober: Hausarbeiten, später Abschlussarbeiten).

---

## 2. Was sich ändert — und was nicht

### Bleibt (nicht neu verhandeln)

- SQLite als Source of Truth, Schema-Regeln, append-only `event_log`
- Enforcement in `services/research.ts` (Zitat unfälschbar, Pending-Gate, Coverage-Gate)
- MCP-HTTP auf `127.0.0.1:8790` für Fremdclients (Goose, Cursor-IDE, …)
- Ollama-Engine als **Fallback**, wenn kein Cursor-Account da ist
- Kein Werkzeug kann `human_signed` setzen
- KI-Einträge sind Behauptungen mit Status, keine Wahrheit

### Neu (Entscheidung 2026-08-20)

Der Alltagsweg ist nicht mehr „Cursor Desktop offen + Platform als Monitor“, sondern:

> **Die Platform *ist* der Host.** Chat, Anhänge, Modellwahl und Research-Lauf leben in einem Fenster. Die IDE wird optional.

Die Streichung „kein eigenes Chat-Panel“ (2026-07) galt einem generischen Ollama-Chat. Sie wird **revidiert** für genau diesen Fall: ein Cursor-Agent-Host neben der Review-UI — kein zweites Cherry Studio.

Abrechnung: SDK-Läufe nutzen **dieselben Pools wie die IDE** (Pro+: u. a. $70 Other Models + Cursor-Models-Pool). Keine Extra-SDK-Lizenz. Siehe [Models & Pricing](https://cursor.com/docs/models-and-pricing) und [SDK Usage and billing](https://cursor.com/docs/sdk/typescript).

---

## 3. Architektur

```
 ┌─────────────────────────────────────────────────────────────────┐
 │  ELECTRON-APP                                                    │
 │                                                                  │
 │  ┌──────────────┐   ┌─────────────────────────────────────────┐ │
 │  │ Agent-Chat   │   │ Projekt: Übersicht / Quellen / Aussagen │ │
 │  │ (Cursor SDK) │   │ Berichte / Karte / Protokoll / Audit    │ │
 │  │ + Anhänge    │   │ Sign-off nur hier                       │ │
 │  └──────┬───────┘   └──────────────────▲──────────────────────┘ │
 │         │  IPC Stream                  │ DB-Poll / Events        │
 │         ▼                              │                         │
 │  CursorAgentHost (Main) ── customTools ─► ToolBridge             │
 │         │                  InMemory MCP     │                    │
 │         │                                   ▼                    │
 │         │                         services/research.ts           │
 │         │                                   │                    │
 │         │                                   ▼                    │
 │         │                              SQLite (WAL)              │
 │         │                                                        │
 │  HTTP-MCP 127.0.0.1:8790  (weiterhin für IDE / Goose)            │
 └─────────────────────────────────────────────────────────────────┘
         ▲
         │  Modelle + Abo
    Cursor Cloud (Account / API-Key)
```

**Ein Werkzeugkatalog, drei Aufrufer:** In-App-Agent, HTTP-MCP, Ollama-Engine. Alle drei gehen durch `services/research.ts`. Wer `repo.*` direkt schreibt, bricht die Garantien.

### Cursor SDK konkret (`@cursor/sdk` 1.0.28)

| Thema | Festlegung |
|---|---|
| Runtime | **local** (`local: { cwd }`), nicht Cloud-VM |
| Persistenz | `JsonlLocalAgentStore` im Projekt-Workspace — **kein** `sqlite3`-Native-Addon (ABI-Konflikt mit Electron/`better-sqlite3`) |
| Werkzeuge | `local.customTools` = alle MCP-Tools via bestehende `ToolBridge` (in-process). Custom Tools umgehen die Klick-Freigabe |
| `cwd` | eigener Ordner `agent-workspaces/<projectId>/` unter User-Data, **nicht** das App-Repo (sonst editiert der Coding-Agent die Platform) |
| Inbox | `cwd/inbox/` — PDFs und Text, die der Mensch anhängt |
| Ambient Settings | `settingSources: []` — nicht die MCP-Liste der IDE laden |
| Session | ein Agent pro Projekt; `Agent.resume` wenn `agentId` bekannt |
| Modell | Pflicht bei local; Auswahl + Parameter (Fast, Effort) aus `Cursor.models.list()` |

**Auth (SDK 1.0.28):** Alltagsweg ist **`Cursor.auth.login()`** — Systembrowser, Login auf cursor.com, intern geminteter User-Key (90 Tage) in `~/.cursor/sdk/auth.json`. Kein Paste-Feld in der App. `CURSOR_API_KEY` in der Umgebung gilt weiter (SDK-Reihenfolge: Env vor gespeichertem Login), taucht in der UI nicht auf.

**Tool-Denylist:** Ab 1.0.27 gibt es `tools` / `disallowedTools`. Noch nicht gesetzt — Isolation weiter über `cwd` + Arbeitsvertrag. Nachziehen, sobald klar ist, welche Built-ins (Read/WebSearch) der Research-Agent braucht, ohne `mcp` (customTools) zu kappen.

---

## 4. Oberfläche

### Layout eines Projekts

```
Sidebar (Projekte) │  Chat (Cursor-Agent)     │  Recherche-Artefakte
                   │  Nachrichten, Tools,     │  Tabs: Übersicht, Quellen,
                   │  Eingabe, PDF-Anhang     │  Aussagen, Karte, Berichte,
                   │  Modell-Chip             │  Protokoll, Audit
```

Chat ist der **Arbeitsort**. Die rechte Seite ist der **Beweis**. Nach jedem Tool-Lauf lädt die rechte Seite neu (heute schon 5-s-Poll; zusätzlich Event nach `run_end`).

### Chat-Funktionen (diese Iteration)

- Stream: Nutzertext, Denken (eingeklappt), Assistententext, Tool-Chips (`fetch_source`, `add_source`, …)
- Abbrechen des laufenden Runs
- Folgefragen in derselben Session
- Dateien anhängen (PDF, Markdown, Text) → Kopie nach `inbox/` → Pfad steht in der Nutzernachricht
- Leerzustand: Hinweis auf Login, sonst Prompt-Starter („Research starten“, „Zusammenfassen“, „Karte aufbereiten“)
- Kein HTML aus Modelltext rendern (gleiche Regel wie Berichte)

### Einstellungen

Neuer Block **oben** in den Einstellungen:

1. Cursor-Konto: Key speichern / löschen, Anzeigename aus `Cursor.me()`
2. Modell: Dropdown aus `Cursor.models.list()` (keine hart verdrahteten IDs)
3. Parameter dynamisch aus `model.parameters` — mindestens **Fast** und **Thinking Effort**, wenn das Modell sie anbietet. Default Fast = aus (`false`), sonst zahlt das Dashboard oft `composer-2.5-fast`
4. Hinweis: Verbrauch = IDE-Kontingent, sichtbar unter cursor.com/dashboard/usage (Tag SDK)

MCP-HTTP-Anleitung und Ollama bleiben darunter (Fremdclient / Fallback).

---

## 5. MCP-Werkzeuge — damit der SDK-Agent allein zurechtkommt

Bestehende Tools bleiben. Ergänzungen, weil der Agent **in der App** Dateien bekommt und Visuals anstoßen soll:

| Tool | Zweck |
|---|---|
| `ingest_local_file` | Datei aus der Projekt-Inbox (PDF/Text) wie `fetch_source` als `documents`-Zeile anlegen. SSRF-Fetcher bleibt unberührt — kein `file://`-Netzabruf. Danach `add_source` mit Offsets. |
| `list_inbox` | Welche Anhänge liegen im Workspace? |
| `describe_evidence_map` | Live-Graph aus Ist-Daten (Teilfragen, Quellen, Aussagen). Optional `layout_kind`. |
| `prepare_view` | Immutable Version: Frage + Layout + optional placements (nur existierende entity_id). |
| `list_visual_versions` / `get_visual_version` | Versionen listen und laden. |
| `toggle_mark` / `list_marks` | Projektsweites Arbeitsset (Quelle oder Aussage). |
| `ask_narrative` | Nur markierte Punkte: durable (Claim+Kante) / mixed (Unsicherheit) / needs_research (neue Teilfrage). |

Bestehende Einstiege, die der In-App-Agent **nutzen soll** (schon als Tool gespiegelt):

- `start_transparent_research` / `start_extend_research` / `start_discuss_research` / `start_verify_session`

Arbeitsvertrag im ersten Turn jeder Session (nicht als Systemprompt — das SDK hat in dieser Fassung keinen): Projekt-ID, „nur Research-Tools“, „Anhänge über ingest_local_file“, „Visuals über describe_evidence_map“, „keine App-Quellen editieren“.

---

## 6. Visuelle Darstellung — Plan (nicht alles in dieser Iteration)

Ziel aus der Produktidee: erst Research, dann Fragen an den Korpus, Aufbereitung als Version, Splitscreen zweier Versionen, markierbare Punkte (Quellen und Aussagen), Synthese-Triage („haltbares Narrativ / Extra-Research“).

### 6.1 Leitregeln

1. **Nach der Recherche**, nicht als Steuerpult während `fetch_source`.
2. Punkte = **Quellen und Aussagen**. Klick auf Quelle öffnet Inhalt (Excerpt, Zitat, Sign-off). Keine freien Gedanken-Zettel ohne ID.
3. **Zwei Layouts, ein Graph:** Aussagen-zentriert (Argumentkarte) und Themen-Cluster (nach Teilfrage deterministisch; nach Aufbereitungs-Frage interpretativ und als `unverified` markiert). Umschalter, keine doppelten Versionen.
4. Layout ist Interpretation. Knoten ohne `entity_id` wären Gedanken — in v1 **verboten**.
5. Markierungen sind **projektsweit** (stabile `source_id` / `claim_id`), nicht in einer Version gefangen.
6. Haltbares Narrativ = Claim + `link_claim_to_source`. Lücke = neue Teilfrage, die in `get_coverage_gaps` landet. Kein weicher Chat-Satz „da sollten wir noch mal gucken“.

### 6.2 Datenmodell (Schema v6)

```
visual_versions
  id, project_id, parent_version_id, prompt, layout_kind
  ('argument_map' | 'theme_clusters'), scope, interpretative, snapshot_hash, created_at, created_by

visual_nodes
  id, version_id, kind ('source' | 'claim' | 'sub_question'),
  entity_id NOT NULL, label, cluster_key, pos_x, pos_y

visual_edges
  id, version_id, from_node, to_node,
  relation ('supports' | 'contrasts' | 'mentions' | 'part_of' | 'needs_research')

marks
  id, project_id, entity_type, entity_id, created_at  -- cross-version Arbeitsset
```

`prepare_view(project_id, question, layout_kind, scope)` erzeugt eine **immutable** Version. `describe_evidence_map` bleibt die Live-Sicht.

### 6.3 UI der Karte

- Tab **Karte**: Live-Graph (Themen-Cluster oder Argumentkarte), Versionsliste, Splitscreen genau zweier Versionen, Diff über `entity_id`.
- Markieren per Stern auf Quelle/Aussage; `ask_narrative` nur auf diesem Arbeitsset.
- Klick zeigt Details auf der Karte; „Quelle öffnen“ wechselt in den Quellen-Tab.
- **Export als Bild:** Jede gespeicherte View (und die Live-Karte) als JPEG/PNG in den Schreibordner — Easy Writing importiert das als Referenz, nicht als Wahrheit. Dateiname trägt `visual_version_id`. SVG optional später; JPEG ist der Alltagsweg.

### 6.4 MCP Apps (nicht der Alltagsweg)

`ui/message` kann Chat **im Host** anstoßen, aber nur aus einem iframe **in Cursor**. Das widerspricht „eine App, kein IDE-Fenster“. Optional später als progressive enhancement für Leute, die in der IDE bleiben. Sign-off niemals im iframe.

### 6.5 Was wir nicht bauen

- Freie Miro-/Obsidian-Canvas ohne IDs
- Mermaid im Bericht als Ersatz für markierbare Knoten
- Karte als Wahrheit oder als Bypass für `add_report_version`

---

## 7. Phasen

| Phase | Inhalt | Fertig wenn |
|---|---|---|
| **A** | In-App-Cursor-Agent, Browser-Login, Chat, Inbox, customTools=MCP | Ohne IDE: anmelden, Research, PDF, Quellen rechts |
| **B** | Schema v6, Graph-Karte, `prepare_view`, Splitscreen, Marks, `ask_narrative` | Zwei Sichten vergleichen; Markiertes → Claim oder Teilfrage |
| **E — Brief & gezielte Suche** | Intake-Skill, Research-Plan als Artefakt, Suche erst nach Adoption, Relevanz-Gate | Agent fragt nach, legt Plan an, sucht danach *weniger und passender* |
| **F — Bibliografie** | DOI/Autoren/Jahr/Venue/Citekey an der Quelle, Crossref nachziehen, `.bib` + `[@key]` | Easy Writing autocompleted dieselben Keys; ohne DOI nur `@misc` |
| **G — Schreibpaket** | Export aus **Karten-Arbeit** (Marks + View + signierte Claims), JPEG der Graphen, `do-not-claim` | Ordner in Easy Writing öffnen; Bericht und Claims stammen aus der View, nicht aus dem Rohdump |
| **H — Semantik der Quellen** | Locator bis `[@key, p. 12]`, Quellentyp, Psych-Korpus, Ansicht „Was darfst du sagen“ | Hausarbeit zitiert Seiten; Lückenliste kennt „n empirische Papers 2016–2026“ |
| **C** | SDK-Feinschliff (`disallowedTools` ohne `"mcp"` zu kappen) | Weniger Shell/Edit-Kollateralschäden |
| **D** | Optional: MCP Apps iframe für IDE-Nutzer | Nicht der Alltagsweg |

Reihenfolge **E → F → G → H**. F und G dürfen überlappen, sobald Citekeys existieren. Ollama-Engine und HTTP-MCP bleiben.

---

## 8. Leitprinzip (unverändert)

> **Die KI-Eingaben werden nie als Wahrheit gespeichert, sondern als *zu verifizierende Behauptungen* mit Status und Konfidenz.**

Der Chat ändert den *Ort* der Unterhaltung. Der Brief ändert, *wonach* gesucht wird. Die Karte ändert, *was in den Text darf*. Keines der drei ersetzt einen Beleg.

---

## 9. Produktziel: passende Research, nicht tiefe Research

Schreiben 2026 ist Commodity. Wertvoll sind **Fragestellung, Blickwinkel, und was du behaupten darfst**. Die App wird kein zweites Perplexity und kein Artikelgenerator.

Cursor hat **keinen** Deep-Research-Skill, den wir wrappen sollten. Generic Deep Research maximiert Abdeckung und speichert zu viel. Wir brauchen **Focused Research**: ein oder wenige klare Ziele, autonome Websuche *danach*, nur Relevantes in der DB.

Das geht. Es ist sogar der einzig saubere Weg, weil Enforcement schon serverseitig sitzt — der Skill darf nicht „mehr Tools“, er muss **Reihenfolge und Ablehnung** vorschreiben, und ein Teil davon muss im Server liegen, sonst ignoriert das Modell ihn nach Turn 8.

### 9.1 Ablauf (ein Projekt, ein Agent)

```
Intake (Skill + Chat)     Research-Plan adoptieren     Gezielte Suche
  wieso / für wen /            Artefakt in DB +           literature + WebSearch
  Ziel / Frames /              Workspace-Datei            nur gegen Plan-Ziele
  Tabus / Nicht-Behaupten
        │                            │                           │
        ▼                            ▼                           ▼
   nachfragen bis der          plan_research aus dem      fetch/add NUR wenn
   Mensch den Plan bestätigt   Brief, nicht aus der Luft  der Plan die Quelle braucht
                                                             sonst exclude_source
        │
        ▼
   Karte / Marks / ask_narrative / prepare_view
        │
        ▼
   Schreibpaket (Claims + Bericht + JPEG + .bib) aus DIESER Sicht
```

**Nicht:** beim ersten „Research starten“ sofort `search_literature` feuern. Der heutige Starter und `start_transparent_research` überspringen den Brief — das wird in Phase E umgedreht.

### 9.2 Intake-Skill — in der Anwendung, nicht in der IDE

Der In-App-Agent hat `cwd = agent-workspaces/<projectId>/`. Skills liegen **dort**:

```
agent-workspaces/<projectId>/.cursor/skills/focused-research/SKILL.md
agent-workspaces/<projectId>/RESEARCH-PLAN.md   ← vom Agenten geschrieben, vom Server gespiegelt
```

Die App **seedit** den Skill beim Anlegen des Workspace (gleiche Datei für jedes Projekt, versioniert mit der App). `settingSources: []` bleibt — die IDE-MCP-Liste soll nicht einlaufen. Skills aus dem `cwd` sind Workspace-Dateien, kein User-Setting. Zusätzlich nennt die Session-Preamble den Skill, falls das SDK ihn nicht von selbst lädt (dann ist die Preamble der Fallback, nicht der Vertrag).

Der Skill ist **kein** Deep-Research-Prompt. Er erzwingt drei Haltungen:

1. **Erst verstehen.** Für wen (Kunde, Seminar, ich)? Welches Lieferformat (Blog, Hausarbeit, beides)? Was ist das *Ziel der Research*, nicht das Thema? Welche 2–3 Blickwinkel konkurrieren? Was darf *nicht* behauptet werden (Tabus, Rechts-/Markengrenzen, Methodik die die Seminarleitung nicht will)?
2. **Erst den Plan schreiben.** Eine Datei in der Form unseres Implementationplans: Vision in einem Satz, Frames mit Empfehlung, Teilfragen-Kandidaten, Einschluss/Ausschluss, Stopp-Kriterium („genug“ = Passung zum Plan, nicht n Quellen). Der Mensch bestätigt.
3. **Dann erst suchen.** WebSearch und `search_literature` nur mit einem Satz aus dem Plan als Ziel. Treffer, die den Plan nicht treffen, werden verworfen (`exclude_source` mit Bezug zur Plan-Stelle) — nicht „zur Sicherheit“ abgelegt.

Ein Skill allein reicht nicht. Dazu MCP:

| Tool | Zweck |
|---|---|
| `draft_research_brief` | Strukturierter Brief (JSON + Markdown). Noch nicht bindend. |
| `adopt_research_brief` | Mensch oder Agent nach Bestätigung. Macht den Brief zur Source of Truth. |
| `get_research_brief` | Aktuellen Plan lesen. |

**Gate:** `search_literature`, `fetch_source` und `ingest_local_file` lehnen ab, solange kein Brief adoptiert ist (`brief_required`) — mit `next_action: draft_research_brief`. Ausnahme: `get_project_state` / Intake-Tools. `plan_research` übernimmt Teilfragen aus dem Brief, erfindet keine parallele Agenda.

Autonomie: Built-in `webSearch` **anlassen** (Denylist ohne `"mcp"`). Der Skill sagt: jede Suche nennt das Plan-Ziel; nach einer kleinen Charge (`get_coverage_gaps`) entscheiden, nicht 40 Tabs öffnen. Subagenten nur *pro Teilfrage aus dem Brief*, jeder mit derselben `project_id` und dem Brief-Text.

### 9.3 RESEARCH-PLAN.md — wie dieser Implementationplan, für Research

Mindestabschnitte (Server prüft Präsenz, nicht Stil):

1. Lieferform und Adressat
2. Ziel in einem Satz (was nach dem Lesen *anders* ist)
3. Blickwinkel — 2–3 Frames, einer **gewählt**
4. Einschluss / Ausschluss (Themen, Sprachen, Zeitraum, Quellentypen)
5. Teilfragen (werden zu `plan_research`)
6. Stopp-Regel (Passung, nicht Vollständigkeit der Welt)
7. Tabus / Nicht-Behaupten

Zwei Frames als zwei `prepare_view`-Versionen bleiben erlaubt — *nach* der Suche, zum Vergleich. Die Wahl *vor* der Suche sitzt im Brief.

---

## 10. Nächste Bauschichten (verbindlich)

### 10.1 Bibliografische Identität und BibTeX (Phase F)

Schreibweg: **`.bib` + `[@citekey]`** nach [Easy Writing](https://github.com/renejes/easy-writing), nicht Zotero. Stil (APA/Chicago/…) bleibt dort.

`search_literature` kennt DOI, Autoren, Jahr, Venue. `add_source` speichert sie **nicht**. Markdown spricht `[S3]`. Das ist die Lücke.

- Schema: `doi`, `authors_json`, `year`, `venue`, `entry_type`, `citekey` an der Quelle (oder 1:1 `source_biblio`). Citekey stabil (`nachnameJahrKurztitel`), Kollisionen mit Suffix — **nicht** aus `[S3]`.
- Metadaten von Crossref/OpenAlex **nachziehen**, nicht vom Modell tippen. Ohne DOI: ehrliches `@misc` mit URL und Zugriffsdatum, nie ein gefälschtes `@article`.
- MCP: `export_bibliography`. UI: „Für Easy Writing exportieren“.

**Nicht bauen:** Zotero-OAuth, Better-BibTeX-Bridge, Live-Kopplung der zwei Desktop-Apps.

### 10.2 Schreibpaket aus der Karten-Arbeit (Phase G)

Nicht der ganze Projekt-Dump. Sondern das, was mit Graph, Marks und `ask_narrative` **erarbeitet** wurde.

```
research-export/<projectId>/<view-or-mark-set>/
  RESEARCH-PLAN.md          # der adoptierte Brief
  references.bib            # nur Quellen, die in dieser Sicht vorkommen
  claims.md                 # Claims mit entity_id in der View / im Mark-Set,
                            # bevorzugt durable/signiert
  bericht.md                # add_report_version gebunden an visual_version_id
                            # oder mark_scope — [S#] → [@citekey]
  do-not-claim.md           # pending, contrasts, flags, verworfene Treffer
  karte-<versionId>.jpg     # Raster der gespeicherten View
```

`add_report_version` bekommt optional `visual_version_id` oder `scope: marked`. Ohne Scope bleibt der heutige Projektbericht (Abwärtskompatibilität), der Schreib-Button nutzt immer einen Scope.

JPEG: Renderer rasterisiert denselben Graphen wie die Karte (keine zweite Layout-Wahrheit). Eine View, ein Bild, eine `snapshot_hash`-Zeile im Dateinamen.

Der Agent darf das Paket **bauen**. Den Artikel schreibt Easy Writing. Kein Bloggenerator in dieser App.

### 10.3 Blickwinkel als Objekt (Phase E, im Brief)

Vor dem tiefen `fetch_source`: konkurrierende Frames, Zielgruppe, Tabus. Ein Frame wird gewählt; `plan_research` zerlegt *diesen* Frame. Das ist der Unterschied zu „Deep Research mit Quellenliste“.

### 10.4 Seitenzahl / Locator (Phase H)

APA und Hausarbeiten brauchen `[@key, p. 12]`. `quote_locator` existiert und stirbt im Export. Durchreichen in `.bib`/Bericht (Seiten aus Locator oder aus Offset-Kontext, wo die PDF Seitenzahlen hergibt). Ohne Seite: kein erfundenes `p. 1`.

### 10.5 Quellentyp und Coverage-Regeln (Phase H)

Typ an der Quelle: `empirical` | `review` | `textbook` | `grey` | `web`. Für Seminare: „mindestens n empirische Papers, Jahr X–Y“. `year_from`/`year_to` existieren in `search_literature` — sie müssen in `get_coverage_gaps` landen, sonst steuert der Brief die Suche nicht.

### 10.6 Psychologie-Korpus (Phase H)

OpenAlex/Crossref/Europe PMC/arXiv sind CS-lastig. Europe PMC deckt PubMed teilweise. Fehlt: deutschsprachige Psych (PSYNDEX o. ä.), klarer empirisch-vs-Review-Filter, bevorzugte Backends im Brief (`academic` + Disziplin `psychology`). Kein neuer Closed-Index mit AGB-Falle, solange offene Register reichen; Lücke ehrlich im Brief dokumentieren.

### 10.7 Ansicht „Was darfst du sagen“ (Phase H)

Eine Lesart der Karte/Übersicht, kein neues Wahrheits-Flag:

| Farbe | Bedeutung |
|---|---|
| Grün | `human_signed` und Quote ok — darf in Blog/Hausarbeit |
| Gelb | belegt, unsigniert — intern ok, nicht liefern |
| Rot | Contrast, Flag, Lücke, oder im Brief unter Nicht-Behaupten |

Das ist der Pitch an den Kunden und die ehrliche Methodik der Hausarbeit.

---

## 11. Was wir nicht bauen

- Artikelgenerator oder „ChatGPT mit Karte“
- Zotero-Sync, Live-Easy-Writing-Prozess
- Generic Deep-Research-Skill (Maximierung der Trefferzahl)
- Freie Canvas-Knoten ohne `entity_id`
- Sign-off durch den Agenten
- MCP-Apps-iframe als Alltag

---

## 12. Verifikation

```bash
npm run typecheck
npm run abi:node && npm test
npm run smoke
```

Zusätzlich manuell (nicht in CI, braucht Account): Einstellungen → Anmelden → Projekt → Intake (Brief) → erst danach Suche → eine Quelle in der DB, Chat zeigt Tool-Chips → Karte → Schreibpaket enthält nur View-Claims und ein JPEG.

Mutationsprobe für neue Zusicherungen: Wirkung kurz entfernen, Test muss rot werden. Neu: Suche ohne adoptierten Brief muss `brief_required` liefern.

