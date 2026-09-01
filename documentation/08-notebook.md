# 08 · Zwei Projektarten: Research und Notebook

> Wie Research und Notebook in **derselben** App zusammenleben — ohne den Research-Vertrag zu verdünnen. Lesen, bevor du an Gates, Agent-Host oder Schema rührst.

|  |  |
|---|---|
| **Projekt** | apROPos |
| **Dokument** | 08 — Notebook-Modus |
| **Stand** | 2026-08-30 |
| **Schema** | v14 (`projects.kind`, Tabelle `notes`) |

**Dokument-Set:** [01](01-implementationplan.md) · [02](02-project-status.md) · [03](03-next-steps.md) · [08 diese Datei](08-notebook.md) · [HANDOVER](../HANDOVER.md)

---

## 1. Eine App, zwei Verträge

Beim Anlegen wählt der Mensch **Research** oder **Notebook**. Das ist `projects.kind`. Bestehende Projekte ohne Spalte sind nach Migration `research`.

| | **Research** | **Notebook** |
|---|---|---|
| Wofür | Gezielte Recherche mit Brief, Lücken, Karte, Bericht, Sign-off | Quellen lesen (PDF, YouTube), im Chat fragen, Notizen und HTML-Artefakte |
| Brief | Pflicht vor Suche und Netzabruf | keiner |
| Agent-Preamble | `sessionPreamble` + Skill `focused-research` | `notebookPreamble` + Skill `notebook-sources` |
| MCP-Werkzeuge am Agenten | alle außer Notebook-only | Whitelist in `notebook-tools.ts` |
| UI | `ProjectView`: Chat links, Tabs rechts | `NotebookView`: Quellen/Notizen/Artefakte links, Chat+Notiz-Tabs Mitte |
| Zitat im Bericht | immer Offset (`add_source`) | dasselbe, **wenn** etwas als Beleg landen soll |
| Notizen | Tabelle existiert, UI nutzt sie nicht | Markdown, bearbeitbar, Datei unter `notes/` |

Research-Verhalten **nicht** umbauen, um Notebook zu bedienen. Gates in `services/research.ts` kennen `kind === 'notebook'` und kehren früh zurück. Der Offset-Pfad (`add_source`, `document_id` + Spannen) bleibt für beide.

---

## 2. UX (Notebook)

```
Sidebar          │  schmale Leiste              │  Mitte (Tabs)
Projekte         │  Quellen (PDF, YouTube)      │  [Chat] [Notiz …] [HTML-Preview]
                 │  Notizenliste                │
                 │  Artefakte (artifacts/)      │
```

- Quellen: Upload/Drop wie im Korpus-Tab; YouTube-URL → Transkript aus Untertiteln in `documents` (`origin: youtube`).
- Chat: Cursor-SDK, Starter „Quellen zusammenfassen“ / „Als HTML aufbereiten“. Unter **jeder** Assistenten-Antwort: **Als Notiz speichern**. Der Agent legt Notizen nicht von selbst an.
- Notiz anklicken → Tab in der Mitte (wo sonst der Chat ist), Textarea, Speichern schreibt DB **und** `notes/<slug>-<id8>.md`.
- Artefakte: der Agent schreibt HTML/Markdown/CSV nach `cwd/artifacts/`. Vorschau: iframe `sandbox="allow-scripts"` ohne `allow-same-origin` (kein zweites Slide-Framework).

NotebookLM-Unterschied, der Absicht ist: Notizen sind **bearbeitbar**. Chat-Antworten ohne Offsets sind **Entwürfe** (Badge). Gegroundete Notizen tragen `citations` mit vom Server geschnittenem Zitat.

---

## 3. Grounding

| Artefakt | Pflicht |
|---|---|
| Freie Notiz / Chat-Snippet speichern | keine Offsets → Entwurf |
| Wörtliche Stelle in einer Notiz | `citations[]`: `document_id`, `quote_start`, `quote_end` — Server setzt `quote` aus dem gespeicherten Text (`groundCitations` in `services/notes.ts`) |
| Beleg in einem späteren Bericht | `add_source` mit denselben Offsets (bestehender Research-Pfad) |

Erfundene Offsets lehnt der Server ab (`citation_offset_invalid` / `citation_document_missing`). Das Modell tippt kein Zitat ab.

---

## 4. Agent und Workspace

| Datei | Rolle |
|---|---|
| `src/main/core/agent/instructions.ts` | `sessionPreamble` (Research) · `notebookPreamble` (Notebook) |
| `src/main/core/agent/notebook-tools.ts` | `toolsForKind` — Filter **pro Spawn**, nicht am ToolBridge-Cache |
| `src/main/core/agent/notebook-skill.ts` | Skill-Text, geseedet nach `.cursor/skills/notebook-sources/` |
| `src/main/core/agent/workspace.ts` | immer `inbox/`, `notes/`, `artifacts/`; beide Skills; optionales `.cursor/sandbox.json` (Netz deny) |
| `src/main/core/agent/host.ts` | `send`: Preamble nach `kind`; `spawnAgent`: Tool-Filter + Name `research:` / `notebook:`; YOLO-Direktive vor den Turn |

YOLO (Composer-Menü / Einstellungen, `AgentSettings.yolo`): Research-Briefing bleibt (Intake, Bestätigung). Nach Adoption keine Nachfragen mehr während der Suche. Notebook: keine Auto-Notiz — Button unter der Antwort. **Nicht** betroffen: Offset-Schnitt, `reflect_search`, Sign-off.

`ensureBridge()` listet **alle** MCP-Tools einmal. Research-Agent bekommt alles minus `save_note` / `list_notes` / `update_note` / `list_artifacts`. Notebook-Agent bekommt nur die Whitelist (Korpus, Lesen, Notizen, Inbox, `add_source`).

SDK-`listArtifacts()` ist **keine** lokale Quelle — Dateien selbst unter `cwd/artifacts/` lesen (`services/artifacts.ts`, Pfad-Guard analog Inbox).

Cursor-Prozess-Sandbox (`local.sandboxOptions`) ist optional; die Produkt-Sandbox ist der Ordner plus iframe. HTML ohne CDN, ohne Tracking.

---

## 5. Daten und IPC

**Schema v14**

- `projects.kind` `CHECK (kind IN ('research','notebook'))` DEFAULT `'research'`
- `notes`: `title`, `body_markdown`, `file_name`, `origin` (`human`\|`chat`\|`agent`), `citations_json`

**Services** (Enforcement hier, nicht im IPC-Handler)

- `services/notes.ts` — CRUD + Datei spiegeln + Offset-Prüfung
- `services/youtube.ts` — Video-ID, oEmbed-Titel, Captions (Watch-Page / Player-API → timedtext). Ohne Untertitel: Fehler, nicht leere Zeile
- `services/artifacts.ts` — listen / lesen, kein Escape aus `artifacts/`

**IPC / Preload:** `notes:*`, `notebook:youtube`, `notebook:artifacts`, `notebook:artifact`. `createProject` akzeptiert `kind`.

**MCP:** `save_note`, `list_notes`, `update_note`, `list_artifacts`. `create_project` hat optionales `kind`.

**Gates:** `requireAdoptedBrief`, `requireSearchReflection`, `evaluateSearchGate` — bei Notebook no-op. `ingestUploadedFiles` war schon ohne Brief.

---

## 6. UI-Dateien

| Datei | Änderung |
|---|---|
| `NewProjectDialog.tsx` | zuerst Research vs Notebook; Frage/Modus nur bei Research |
| `ProjectView.tsx` | `kind === 'notebook'` → `NotebookView` |
| `NotebookView.tsx` | Layout, YouTube, Notiz-Editor, Artefakt-Preview |
| `AgentChat.tsx` | `variant`, `onSaveNote`, andere Starter/Platzhalter |
| `App.tsx` | Sidebar-Zeile unterscheidet Notebook |
| `CorpusTab.tsx` | Origin-Badge `youtube` |

---

## 7. Tests und Fallstricke

`src/main/core/services/notebook.test.ts`: YouTube-Parsing, Notebook ohne Brief darf `search_documents`/`read_document`, Research ohne Brief bleibt gesperrt, Notiz-Datei + serverseitiges Zitat, Artefakt-Pfad, Tool-Filter.

Nicht tun:

- Research-Preamble oder Brief-Gates „aufweichen“, damit Notebook einfacher wird — früh return nach `kind`.
- `listArtifacts()` vom Cursor-SDK als Dateiliste verwenden.
- YouTube ohne Captions still als leeres Dokument anlegen.
- HTML-Preview mit `allow-same-origin` (sonst ist das iframe keine Sandbox mehr).
- Zweites Repo / Open-Notebook-Fork.

---

## 8. Was bewusst fehlt (Notebook v1)

- Podcasts, Audio-Overviews
- Volles Slide-Framework (Reveal, Marp)
- Live-Sync der Notiz während der Agent noch schreibt
- YouTube ohne Untertitel (Whisper o. ä.)
