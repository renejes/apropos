# 01 · Implementation-Plan

> Agent-first Desktop-App: Cursor-SDK-Chat in der Anwendung, zwei Projektarten (Research mit Provenienz-Vertrag, Notebook mit Quellen-Chat), visuelle Lesart, Schreibhandoff.

|  |  |
|---|---|
| **Projekt** | Research Overview Platform |
| **Dokument** | 01 — Implementation-Plan |
| **Stand** | 2026-08-30 · v2.3 |
| **Phase** | A, B, E–H, **I (Notebook)** gebaut · C offen · empirischer Test ausstehend → [03](03-next-steps.md) |

**Dokument-Set:** [01 Implementationplan](01-implementationplan.md) · [02 Projekt-Status](02-project-status.md) · [03 Next Steps](03-next-steps.md) · [08 Notebook](08-notebook.md) · Archiv: [04 Feasibility](done/04-feasability.md) · [05 Markt-Research](done/05-market-research.md) · [06 Eigene Research-Engine](done/06-eigene-research-engine.md) · [07 KI-Clients](done/07-clients.md)

---

## 1. Vision in einem Satz

Eine **local-first Desktop-App**, in der du mit deinem **Cursor-Abo** entweder **gezielt recherchierst** (Brief, passende Quellen, Karte, Schreibpaket) oder ein **Notebook** über PDFs und YouTube führst (Chat, bearbeitbare Notizen, HTML-Artefakte) — während jede Stelle, die als Zitat gelten soll, ein **prüfbares Artefakt** bleibt. Sign-off nur in der UI.

Zwei Lieferformen, ein Korpus: **Kunden-/Eigen-Blogs** (Commodity ist der Text, wertvoll ist der Frame) und **wissenschaftliche Arbeiten** (Psychologie ab Oktober: Hausarbeiten, später Abschlussarbeiten).

---

## 2. Was sich ändert — und was nicht

### Bleibt (nicht neu verhandeln)

- SQLite als Source of Truth, Schema-Regeln, append-only `event_log`
- Enforcement in `services/research.ts` (Zitat unfälschbar, Pending-Gate, Coverage-Gate)
- MCP-HTTP auf `127.0.0.1:8790` für Fremdclients (Goose, Cursor-IDE, …)
- Kein Werkzeug kann `human_signed` setzen
- KI-Einträge sind Behauptungen mit Status, keine Wahrheit
- Zwei Projektarten: Research (Brief, Gates) und Notebook (Quellen-Chat) — Research-Vertrag nicht aufweichen

### Neu (Entscheidung 2026-08-20) — ✅ gebaut

Der Alltagsweg ist nicht mehr „Cursor Desktop offen + Platform als Monitor“, sondern:

> **Die Platform *ist* der Host.** Chat, Anhänge, Modellwahl und Research-Lauf leben in einem Fenster. Die IDE wird optional.

Die Streichung „kein eigenes Chat-Panel“ (2026-07) galt einem generischen Ollama-Chat. Sie wird **revidiert** für genau diesen Fall: ein Cursor-Agent-Host neben der Review-UI — kein zweites Cherry Studio.

Abrechnung: SDK-Läufe nutzen **dieselben Pools wie die IDE** (Pro+: u. a. $70 Other Models + Cursor-Models-Pool). Keine Extra-SDK-Lizenz. Siehe [Models & Pricing](https://cursor.com/docs/models-and-pricing) und [SDK Usage and billing](https://cursor.com/docs/sdk/typescript).

Die In-App-Ollama-Engine ist **gestrichen** (WebSearch über Ollama war unzuverlässig). WebSearch läuft über Cursor.

---

## 3. Architektur — ✅ gebaut

```
 ┌─────────────────────────────────────────────────────────────────┐
 │  ELECTRON-APP                                                    │
 │                                                                  │
 │  ┌──────────────┐   ┌─────────────────────────────────────────┐ │
 │  │ Agent-Chat   │   │ Research: Übersicht / Korpus / Quellen  │ │
 │  │ (Cursor SDK) │   │ Aussagen / Karte / Berichte / Audit     │ │
 │  │ + Anhänge    │   │ Notebook: Notiz-Tabs, Artefakt-Preview  │ │
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

**Ein Werkzeugkatalog, zwei Aufrufer:** In-App-Agent und HTTP-MCP. Beide gehen durch `services/research.ts`. Wer `repo.*` direkt schreibt, bricht die Garantien.

### Cursor SDK konkret (`@cursor/sdk` 1.0.28)

| Thema | Festlegung | Stand |
|---|---|---|
| Runtime | **local** (`local: { cwd }`), nicht Cloud-VM | ✅ |
| Persistenz | `JsonlLocalAgentStore` im Projekt-Workspace — **kein** `sqlite3`-Native-Addon | ✅ |
| Werkzeuge | `local.customTools` = MCP via `ToolBridge`; **Filter nach `projects.kind`** (`notebook-tools.ts`) | ✅ |
| `cwd` | eigener Ordner `agent-workspaces/<projectId>/` unter User-Data | ✅ |
| Inbox | `cwd/inbox/` — PDFs und Text, die der Mensch anhängt | ✅ |
| Ambient Settings | `settingSources: []` | ✅ |
| Session | ein Agent pro Projekt; `Agent.resume` wenn `agentId` bekannt | ✅ |
| Modell | Pflicht bei local; Auswahl + Parameter aus `Cursor.models.list()` | ✅ |
| Auth | `Cursor.auth.login()` — Systembrowser, kein Paste-Feld | ✅ |
| `disallowedTools` | Built-ins kappen, ohne `"mcp"` (customTools) zu kappen | **offen (Phase C)** |

---

## 4. Oberfläche — ✅ gebaut

### Layout eines Projekts

```
Sidebar (Projekte) │  Chat (Cursor-Agent)     │  Recherche-Artefakte
                   │  Nachrichten, Tools,     │  Tabs: Übersicht, Quellen,
                   │  Eingabe, PDF-Anhang     │  Aussagen, Karte, Berichte,
                   │  Modell-Chip             │  Protokoll, Audit
```

Chat ist der **Arbeitsort**. Die rechte Seite ist der **Beweis**.

### Chat-Funktionen

- Stream: Nutzertext, Denken (eingeklappt), Assistententext, Tool-Chips
- Abbrechen des laufenden Runs
- Folgefragen in derselben Session
- Dateien anhängen (PDF, Markdown, Text) → Kopie nach `inbox/`
- Leerzustand: Hinweis auf Login, sonst Prompt-Starter
- Kein HTML aus Modelltext rendern

### Einstellungen

1. Cursor-Konto: Browser-Login, Anzeigename aus `Cursor.me()`
2. Modell: Dropdown aus `Cursor.models.list()`
3. Parameter dynamisch aus `model.parameters` (Fast, Thinking Effort)
4. Hinweis: Verbrauch = IDE-Kontingent

MCP-HTTP-Anleitung bleibt darunter (Fremdclient).

---

## 5. MCP-Werkzeuge — ✅ gebaut

| Tool | Zweck |
|---|---|
| `ingest_local_file` | Datei aus der Projekt-Inbox (PDF/Text) wie `fetch_source` als `documents`-Zeile |
| `list_inbox` | Welche Anhänge liegen im Workspace? |
| `describe_evidence_map` | Live-Graph aus Ist-Daten |
| `prepare_view` | Immutable Version |
| `list_visual_versions` / `get_visual_version` | Versionen listen und laden |
| `toggle_mark` / `list_marks` | Projektsweites Arbeitsset |
| `ask_narrative` | Nur markierte Punkte: durable / mixed / needs_research |
| `draft_research_brief` / `adopt_research_brief` / `get_research_brief` | Brief vor Suche |
| `save_note` / `list_notes` / `update_note` / `list_artifacts` | Notebook: Markdown-Notizen und Artefaktliste |
| `export_bibliography` / `export_writing_pack` | `.bib` und Schreibpaket |

Einstiege (Prompt + Spiegel-Werkzeug): `start_transparent_research` / `start_extend_research` / `start_discuss_research` / `start_verify_session`.

Arbeitsvertrag im ersten Turn: Projekt-ID, Research-Tools, Anhänge über `ingest_local_file`, Visuals über `describe_evidence_map`.

---

## 6. Visuelle Darstellung — ✅ gebaut

### 6.1 Leitregeln

1. **Nach der Recherche**, nicht als Steuerpult während `fetch_source`.
2. Punkte = **Quellen und Aussagen**. Keine freien Gedanken-Zettel ohne ID.
3. **Zwei Layouts, ein Graph:** Aussagen-zentriert und Themen-Cluster.
4. Layout ist Interpretation. Knoten ohne `entity_id` sind in v1 **verboten**.
5. Markierungen sind **projektsweit**.
6. Haltbares Narrativ = Claim + `link_claim_to_source`. Lücke = neue Teilfrage.

### 6.2 Datenmodell (Schema v6, heute v10)

```
visual_versions / visual_nodes / visual_edges / marks
```

`prepare_view` erzeugt eine **immutable** Version. `describe_evidence_map` bleibt die Live-Sicht.

### 6.3 UI der Karte

- Tab **Karte**: Live-Graph, Versionsliste, Splitscreen zweier Versionen
- Markieren per Stern; `ask_narrative` auf dem Arbeitsset
- JPEG der View im Schreibpaket (`karte-<versionId>.jpg`)

### 6.4 MCP Apps — Phase D, nicht gebaut

Optional später für Leute, die in der IDE bleiben. Sign-off niemals im iframe. **Nicht der Alltagsweg.**

### 6.5 Was wir nicht bauen

- Freie Miro-/Obsidian-Canvas ohne IDs
- Mermaid im Bericht als Ersatz für markierbare Knoten
- Karte als Wahrheit oder als Bypass für `add_report_version`

---

## 7. Phasen

| Phase | Inhalt | Stand |
|---|---|---|
| **A** | In-App-Cursor-Agent, Browser-Login, Chat, Inbox, customTools=MCP | ✅ |
| **B** | Schema v6, Graph-Karte, `prepare_view`, Splitscreen, Marks, `ask_narrative` | ✅ |
| **E — Brief & gezielte Suche** | Intake-Skill, Research-Plan als Artefakt, Suche erst nach Adoption | ✅ |
| **F — Bibliografie** | DOI/Autoren/Jahr/Venue/Citekey, Crossref nachziehen, `.bib` + `[@key]` | ✅ |
| **G — Schreibpaket** | Export aus Karten-Arbeit, JPEG, `do-not-claim` | ✅ |
| **H — Semantik der Quellen** | Locator `[@key, p. 12]`, Quellentyp, Psych-Korpus, „Was darfst du sagen“ | ✅ |
| **I — Notebook** | `kind`, Notizen, YouTube-Ingest, Tool-Filter, Artefakt-Preview; Research unverändert | ✅ |
| **C** | SDK-Feinschliff (`disallowedTools` ohne `"mcp"` zu kappen) | **offen** |
| **D** | Optional: MCP Apps iframe für IDE-Nutzer | nicht Alltag, ungebaut |

Reihenfolge war **E → F → G → H**. HTTP-MCP bleibt. Die In-App-Ollama-Engine ist gestrichen.

---

## 8. Leitprinzip (unverändert)

> **Die KI-Eingaben werden nie als Wahrheit gespeichert, sondern als *zu verifizierende Behauptungen* mit Status und Konfidenz.**

Der Chat ändert den *Ort* der Unterhaltung. Der Brief ändert, *wonach* gesucht wird. Die Karte ändert, *was in den Text darf*. Keines der drei ersetzt einen Beleg.

---

## 9. Produktziel: passende Research, nicht tiefe Research — ✅ gebaut

Schreiben 2026 ist Commodity. Wertvoll sind **Fragestellung, Blickwinkel, und was du behaupten darfst**. Die App wird kein zweites Perplexity und kein Artikelgenerator.

### 9.1 Ablauf (ein Projekt, ein Agent)

```
Intake (Skill + Chat)     Research-Plan adoptieren     Gezielte Suche
  wieso / für wen /            Artefakt in DB +           literature + WebSearch
  Ziel / Frames /              Workspace-Datei            nur gegen Plan-Ziele
  Tabus / Nicht-Behaupten
        │
        ▼
   Karte / Marks / ask_narrative / prepare_view
        │
        ▼
   Schreibpaket (Claims + Bericht + JPEG + .bib) aus DIESER Sicht
```

**Gate:** `search_literature`, `fetch_source` und `ingest_local_file` lehnen ab, solange kein Brief adoptiert ist (`brief_required`).

### 9.2 Intake-Skill — in der Anwendung

Die App seedet `focused-research/SKILL.md` in `agent-workspaces/<projectId>/`. `settingSources: []` bleibt. Session-Preamble nennt den Skill als Fallback.

### 9.3 RESEARCH-PLAN.md

Mindestabschnitte (Server prüft Präsenz): Lieferform, Ziel, Blickwinkel, Einschluss/Ausschluss, Teilfragen, Stopp-Regel, Tabus.

---

## 10. Bauschichten

### 10.1 Bibliografische Identität und BibTeX (Phase F) — ✅

Schreibweg: **`.bib` + `[@citekey]`** nach [Easy Writing](https://github.com/renejes/easy-writing). Citekey `nachnameJahrKurztitel`. Ohne DOI: ehrliches `@misc`. MCP: `export_bibliography`.

### 10.2 Schreibpaket aus der Karten-Arbeit (Phase G) — ✅

Immer mit Scope (`visual_version_id` oder `scope=marked`). Dateien: `RESEARCH-PLAN.md`, `references.bib`, `claims.md`, `bericht.md`, `do-not-claim.md`, `karte-*.jpg`.

### 10.3 Blickwinkel als Objekt (Phase E) — ✅

Brief vor `fetch_source`. Ein Frame wird gewählt; `plan_research` zerlegt *diesen* Frame.

### 10.4 Seitenzahl / Locator (Phase H) — ✅

`quote_locator` → `[@key, p. 12]`. Ohne Seite: kein erfundenes `p. 1`.

### 10.5 Quellentyp und Coverage-Regeln (Phase H) — ✅

`source_kind`: `empirical` | `review` | `textbook` | `grey` | `web`. Lücken `empirical_shortfall`, `year_range_shortfall`.

### 10.6 Psychologie-Korpus (Phase H) — ✅ (ehrliche Lücke)

Backends: OpenAlex, Crossref, Europe PMC (kein arXiv als Default). PSYNDEX hat keine offene API — Hinweis auf PubPsych im Browser, nicht scrapen.

### 10.7 Ansicht „Was darfst du sagen“ (Phase H) — ✅

Grün / Gelb / Rot in der Übersicht (`SayablePanel`). Kein neues Wahrheits-Flag.

### 10.8 Notebook-Modus (Phase I) — ✅

Zweite Projektart neben Research, nicht statt. Schema v14, Gates per `kind`, Agent-Whitelist, bearbeitbare Notizen, YouTube-Transkript, `artifacts/` + iframe. Vertrag und Dateikarte: [08](08-notebook.md).

---

## 11. Was wir nicht bauen

- Artikelgenerator oder „ChatGPT mit Karte“
- Zotero-Sync, Live-Easy-Writing-Prozess
- Generic Deep-Research-Skill (Maximierung der Trefferzahl)
- Freie Canvas-Knoten ohne `entity_id`
- Sign-off durch den Agenten
- MCP-Apps-iframe als Alltag
- Eingebaute Ollama-Engine
- Open-Notebook-Fork / zweites Repo; Podcasts in v1

---

## 12. Verifikation

```bash
npm run typecheck
npm run abi:node && npm test
npm run smoke
```

Automatisierte Tests sind grün (Stand 2026-08-30: 270). **Ausstehend:** echter Lauf mit Cursor-Konto — siehe [03 Next Steps](03-next-steps.md). Notebook-Verdrahtung: [08](08-notebook.md).
