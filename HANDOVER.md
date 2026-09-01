# Handover — Research Overview Platform

> Kontext für einen neuen Chat. Stand: **2026-08-30**.
> Danach ohne die Git-History lesen zu müssen weiterarbeiten können.

**Zuerst lesen:** [02 Status](documentation/02-project-status.md) · [08 Notebook](documentation/08-notebook.md) · bei Research-Läufen [03](documentation/03-next-steps.md).

---

## 1. Was das Produkt ist

Local-first **Electron-App**. Die KI (Cursor-Abo, `@cursor/sdk`) arbeitet **in der App**. SQLite auf der Platte ist die Wahrheit; Modelle laufen in der Cursor-Cloud.

**Problem:** Deep-Research-Berichte haben oft valide Links, aber schwache faktische Deckung (39–77 %, fällt mit der Tool-Call-Zahl; arXiv 2605.06635).

**Leitprinzip:** KI-Einträge sind *zu verifizierende Behauptungen*. Sign-off nur in der UI — **kein Werkzeug setzt `human_signed`**.

**Zwei Projektarten** (`projects.kind`):

- **Research** — Brief, Offset-Zitate, Lücken, Karte, Easy-Writing-Export. Vertrag unverändert.
- **Notebook** — PDF + YouTube, Chat, bearbeitbare Markdown-Notizen, HTML unter `artifacts/`. Kein Brief.

Zielgruppe Research: akademisch *und* Business. Notebook: Quellenarbeit ohne Forschungs-Gate.

**Lizenz:** GPL-3.0-or-later. Copyright René Jesser. Ein späterer Verkauf geht über **Dual-Lizenz** (GPL bleibt, kommerzielle Lizenz daneben), solange keine fremden Beiträge ohne CLA angenommen werden — nicht über „GPL statt MIT, dann ist Verkaufen einfacher“. Siehe README.

---

## 2. Die drei Erzwingungen (Research) — das ist der Kern

Alles andere ist Infrastruktur. In `services/research.ts`, unter MCP und Agent.

### (a) Zitat unfälschbar

`fetch_source` / `read_document` speichert Text. `add_source` bekommt Offsets — **der Server schneidet**. Scan/Paywall: `verbatim_quote` ohne `document_id`.

### (b) Vollständigkeit

Weitere `fetch_source`, solange Pending-Dokumente offen (`ROP_MAX_PENDING`, Default 3). Uploads zählen nicht. Hooks in Subagenten feuern nicht verlässlich — deshalb der Server.

### (c) Tiefe

Teilfragen, `get_coverage_gaps` (Zählung), `next_round` (Sättigung), Bericht erst ohne blockierende Lücken.

**Notebook:** Brief- und Lage-Gates sind no-op. Offset-Notizen (`services/notes.ts`) und `add_source` gelten weiter. Nicht die Research-Gates „aufweichen“.

---

## 3. Alltagsweg und MCP

| | **In-App-Agent** | **Fremdclient** |
|---|---|---|
| Wer | Cursor-SDK, Preamble + Tools nach `kind` | IDE / Goose / Claude Code → `127.0.0.1:8790/mcp` |
| Modell | Cursor-Katalog (Abo, WebSearch) | das des Clients |

Eine Werkzeugdefinition (`mcp/server.ts`). Filter nur beim Spawn (`notebook-tools.ts`). Ollama-Engine in der App entfernt. `ResearchEngine` + `FakeProvider` = Testharness.

---

## 4. Stack und Landkarte

**Electron · React 18 · Tailwind v4 · better-sqlite3 (WAL, FTS5) · `@cursor/sdk` 1.0.28 · MCP SDK 1.30 · Zod · Vitest**

Schema **v14**. Tests **270**.

```
src/main/core/
  db.ts, repo.ts
  services/research.ts     Research-Enforcement
  services/notes.ts        Notizen + Offset-Schnitt
  services/youtube.ts      Captions → Korpus
  services/artifacts.ts    artifacts/ lesen (kein SDK-listArtifacts)
  agent/host.ts            Spawn, Preamble, Tool-Filter
  agent/instructions.ts    sessionPreamble / notebookPreamble
  agent/notebook-tools.ts  Whitelist
  engine/                  Testharness
src/main/mcp/server.ts     Tools inkl. save_note / list_artifacts
src/renderer/.../NotebookView.tsx, NewProjectDialog.tsx, ProjectView.tsx
documentation/08-notebook.md
```

**Regel 1:** Neue Schreibpfade rufen Services, nie `repo.*` für Enforcement-Dinge.

**Regel 2:** Fehlerantworten tragen sich selbst (`FEHLER` + `next_action` Imperativ). `ServiceError` erzwingt den Hinweis.

---

## 5. Fallstricke

| Problem | Abhilfe |
|---|---|
| `whenReady` undefined | `ELECTRON_RUN_AS_NODE` in der Shell → `env -u ELECTRON_RUN_AS_NODE npm run dev` |
| `NODE_MODULE_VERSION` | `npm run abi:node` Tests, `npm run abi:electron` App; `npm start` rebuilded Electron |
| Notebook-Agent sieht Research-Tools | Filter in `spawnAgent`, nicht den Bridge-Cache nach kind splitten |
| YouTube leer | Keine Captions → Fehler, nicht speichern |
| HTML-Preview unsicher | iframe ohne `allow-same-origin` |
| YOLO zu locker | Briefing bleibt; YOLO erst nach Adoption. Notizen nur per Button |

```bash
npm run typecheck
npm run abi:node && npm test
npm run smoke
```

---

## 6. Nicht neu aufrollen

Gestrichen: generischer Ollama-Chat, Auth/Tunnel, Abo-Modelle fremder Anbieter in der eigenen App, MCP Sampling/Roots, Zotero als Source of Truth, Open-Notebook-Fork, Podcasts in v1.

Bewusst: WebSearch darf **entdecken**, Bericht nur aus `documents`. Suche über akademische APIs (DOI). Ein Extraktor, lokal. Easy Writing = `.bib` + `[@citekey]` aus dieser Plattform.

Historische Fallen (DNS-Rebinding still, Migration BEGIN IMMEDIATE, Schema-Fehler vor Handler, Quota beendet den Lauf): [alte HANDOVER-Abschnitte 7–8 im Git] — kurz: grüne Tests zählen nur, wenn sie die Mutation treffen.

---

## 7. Nächste Arbeit

1. **Spike 1** — echter Research-Lauf, benanntes Modell: [03](documentation/03-next-steps.md).
2. Notebook-Modell-Lauf **danach** (ob `save_note` mit Offsets kommt).
3. Phase C (`disallowedTools`) blockiert Spike 1 nicht.

BibTeX / Easy Writing / PDF-Ingest / WebSearch-Ingest sind **gebaut**, nicht der nächste Spike.

---

## 8. Zusammenarbeit mit René

Deutsch in UI und Kommentaren. Autonomie, dann gemeinsames Review. Belegte Aussagen. UI: hell, Tailwind, Material Symbols, keine Schatten, Farbe nur für Status.

Bauen → typecheck + tests + smoke → bei UI die App starten.
