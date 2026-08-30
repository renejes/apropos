# 02 · Projekt-Status

> Aktueller Stand und aktuelle Funktionsweise. Kein Changelog. Ziel: das Produkt in einer Sitzung wieder verstehen.

|  |  |
|---|---|
| **Projekt** | Research Overview Platform |
| **Dokument** | 02 — Projekt-Status |
| **Stand** | 2026-08-30 · v4.0 |
| **Phase** | Research und Notebook gebaut · echter Modell-Lauf (Research) ausstehend |

**Dokument-Set:** [01 Implementationplan](01-implementationplan.md) · [02 Projekt-Status](02-project-status.md) · [03 Next Steps](03-next-steps.md) · [08 Notebook](08-notebook.md) · [HANDOVER](../HANDOVER.md) · Archiv: [04](done/04-feasability.md) · [05](done/05-market-research.md) · [06](done/06-eigene-research-engine.md) · [07](done/07-clients.md)

---

## Was das Produkt ist

Eine **local-first Electron-App**. Die KI läuft über das **Cursor-Abo in einem Fenster**. Die SQLite-Datenbank auf dem Rechner ist die Source of Truth; Modelle laufen in der Cursor-Cloud.

Es gibt **zwei Projektarten** (`projects.kind`):

| | **Research** | **Notebook** |
|---|---|---|
| Versprechen | Prüfbare Recherche: Brief, Offset-Zitate, Lücken, Karte, Sign-off, Schreibpaket | Quellen (PDF, YouTube) fragen, Antworten als **bearbeitbare** Markdown-Notizen, HTML-Artefakte |
| Brief / Gates | ja | nein |
| UI | Chat links, Review-Tabs rechts | Quellen/Notizen links, Chat+Notiz-Tabs in der Mitte |
| Details | dieser Text, Abschnitte Alltag und Enforcement | [08 Notebook](08-notebook.md) |

Leitprinzip (beide): KI-Einträge sind **Behauptungen mit Status**, keine Wahrheit. Kein Werkzeug kann `human_signed` setzen. Was als Zitat in einen Bericht soll, braucht Offsets — der Server schneidet den Text.

Zwei Lieferformen im Research-Modus, ein Korpus: Blogs (Frame) und wissenschaftliche Arbeiten (Zitate, Seiten, empirische Papers). Hochgeladene PDFs sind Seed-Quellen im selben Korpus.

---

## Zahlen

| | |
|---|---|
| Schema | **v14** (`kind`, `notes`; zuvor v13 `easy_writing_dir`) |
| Tests | **270** (Vitest) |
| MCP-SDK | `@modelcontextprotocol/sdk` **1.30** |
| Agent | `@cursor/sdk` **1.0.28**, Runtime `local` |
| Lizenz | **GPL-3.0-or-later** (Copyright René Jesser; Dual-Lizenz als alleiniger Rechteinhaber möglich) |

Typecheck und Unit-Tests sind grün. Smoke (`npm run smoke`) prüft den MCP-HTTP-Pfad gegen einen echten Client, nicht gegen ein Frontier-Modell.

---

## Alltagsweg — Research

1. App starten (`npm start`). Einstellungen: Cursor anmelden (Systembrowser). **Benanntes Modell**, nicht Auto.
2. Projekt anlegen → **Research**. PDFs sofort in den Korpus (kein Brief). Im Chat den Brief erarbeiten; nach Bestätigung `adopt_research_brief`.
3. Suche erst danach: Korpus, dann Literatur + WebSearch gegen den Plan. Nach jeder Welle `reflect_search`, **bevor** erneut gesucht wird.
4. Berichtstext: `fetch_source` / `read_document` → `add_source` mit Offsets.
5. Rechts: Übersicht, Korpus, Quellen (Sign-off), Aussagen, Karte, Berichte.
6. Export: Provenienz-Markdown oder Easy Writing (`research.mdx` + `.bib`).

Ohne adoptierten Brief: `brief_required` für Suche und Netzabruf. Uploads brauchen keinen Brief.

Fremdclients docken per **MCP-HTTP** `127.0.0.1:8790/mcp` an dieselbe SQLite. Der WebSearch-Hook fragt `GET /ingest/search-gate`; App tot → Fail-open.

## Alltagsweg — Notebook

1. Projekt anlegen → **Notebook**.
2. PDFs ablegen und/oder YouTube-Links (nur Videos **mit Untertiteln** — sonst klarer Fehler).
3. Im Chat fragen. Antwort als Notiz speichern oder der Agent ruft `save_note` mit Offsets.
4. Notiz in der Mitte öffnen und Markdown editieren. Folien/Tabellen: Agent schreibt nach `artifacts/`, Vorschau im iframe.

Ausführlich: [08](08-notebook.md).

---

## Ablauf einer Research

```
PDFs in den Korpus (optional, ohne Brief)
        │
        ▼
Brief entwerfen → adoptieren
        │
        ▼
plan_research (Teilfragen aus dem Brief)
        │
        ▼
Suche (Korpus / literature / WebSearch) nur gegen den Plan
        │
        ▼
reflect_search  (Lage: covered / underrepresented / next_action)
        │     die nächste Suche ist gesperrt, bis die Lage steht
        ▼
fetch_source / read_document → add_source (Offset-Zitat) oder exclude_source
        │
        ▼
Coverage / next_round  (Server entscheidet „genug“, nicht das Modell)
        │
        ▼
Karte, Marks, ask_narrative, prepare_view
        │
        ▼
Easy-Writing-Ordner aus dieser Sicht  +  Sign-off in der UI
```

---

## Was der Server erzwingt (Research)

Alles unterhalb der Schleife liegt in `services/research.ts`. MCP-Handler und In-App-Agent rufen dieselben Services. Wer `repo.*` direkt schreibt, umgeht die Garantien.

Bei `kind === 'notebook'` überspringen `requireAdoptedBrief`, `requireSearchReflection` und `evaluateSearchGate`. Offset-Zitate und `add_source` gelten weiter.

**Zitat.** `fetch_source` speichert den Text (HTML und PDF). `add_source` bekommt `document_id` + `quote_start` + `quote_end` — der Server schneidet das Zitat aus. Scans/Paywall: `verbatim_quote` ohne `document_id` plus menschlicher Sign-off.

**Vollständigkeit.** Weitere Netzabrufe gesperrt, solange abgerufene Quellen nicht dokumentiert oder verworfen sind (`ROP_MAX_PENDING`, Standard 3). Uploads sind Seed, kein Pending.

**Such-Lage.** Nach Discovery-Welle nächste Suche erst nach `reflect_search`. Das Modell formuliert `next_query` selbst. Register-Totalausfall zählt nicht als Welle. `get_coverage_gaps` ist Zählung, kein Suchauftrag.

**Tiefe.** Teilfragen, Sättigung, `add_report_version` lehnt bei blockierenden Lücken ab.

**Fehler.** `status: "FEHLER …"` und `next_action` im Imperativ (`ServiceError` erzwingt den Hinweis).

WebSearch **darf entdecken**. Snippets sind keine Quelle.

---

## Architektur

```
Electron
  Renderer    Chat (SDK-Stream) │ Research-Tabs  ODER  NotebookView
  Main        CursorAgentHost ── customTools (gefiltert nach kind) ── ToolBridge
              HTTP-MCP 127.0.0.1:8790
              research.ts / notes.ts / youtube.ts / artifacts.ts  →  SQLite WAL + FTS5
```

`ResearchEngine` + `FakeProvider` sind **Testharness**, kein Nutzer-Modus. Ollama-Engine in der App ist entfernt.

---

## Oberfläche

Chrome wie Easy Writing: Linie, Invert, Farbe nur für Bedeutung.

| Ort | Funktion |
|---|---|
| Neues Projekt | zuerst Research vs Notebook |
| Agent-Chat | Stream, Sessions, `@`, Anhänge; Notebook: „Als Notiz speichern“ |
| Research-Tabs | Übersicht, Korpus, Quellen, Aussagen, Karte, Berichte, Protokoll, Audit |
| Notebook | Quellen, Notizen, Artefakte; Chat/Notiz/HTML in der Mitte |
| Export | nur Research: Provenienz oder Easy Writing |
| Einstellungen | Cursor-Login, Modell, MCP-URL, Demo-Seed |

---

## Quellen, Zitate, Export (Research)

- Register: OpenAlex, Crossref, Europe PMC. PSYNDEX: Hinweis PubPsych, nicht scrapen.
- Citekey `nachnameJahrKurztitel`. Ohne DOI: `@misc`.
- Easy Writing: `research.mdx` + gemergte `.bib`; Schreibkapitel unangetastet; Pfad in `easy_writing_dir`.
- Markdown-Schreibpaket bleibt daneben.

Schreibweg: [Easy Writing](https://github.com/renejes/easy-writing), Satz optional [Penwright](https://github.com/renejes/penwright). Diese App schreibt keine Artikel.

---

## Was belegt ist — und was nicht

**Belegt (automatisiert):** Schema-Zwang, Offset-Zitate, Brief-Gate (Research), Coverage-Gate, Pending-Gate, Sign-off nur UI, Rebinding-Schutz, PDF-Offsets, Seed-Korpus, Such-Lage, Easy-Writing-Ordner, Biblio/Citekey, Sayable, Chat-Sessions, Projekt-Löschen, **Notebook:** `kind`, Notizen+Datei, YouTube-ID-Parsing, Gates aus, Tool-Filter, Artefakt-Pfad. 270 Tests.

**Nicht belegt:** Ob ein echtes Cursor-Modell den Research-Vertrag hält (Brief, Lage, richtige Offsets). Ob der Notebook-Agent Notizen mit Offsets speichert statt Freitext. Die Maschine ist gegen Fixtures verifiziert, nicht gegen eine echte Recherche.

Nächster Schritt Research: [03](03-next-steps.md). Notebook-Vertrag: [08](08-notebook.md).

---

## Festgelegt (nicht neu verhandeln)

| Thema | Stand |
|---|---|
| Alltagsweg | Cursor-SDK in der App; IDE optional |
| Enforcement | in den Services, unter MCP und Agent |
| Sign-off | nur UI |
| Zwei Arten | Research unverändert; Notebook daneben, nicht statt |
| Such-Lage | nur Research; Query vom Modell |
| Schreibweg | Easy-Writing-Ordner, nicht Zotero; kein Artikelgenerator |
| Oberfläche | Familie zu Easy Writing |
| Ollama in der App | entfernt |
| Lizenz | GPL-3.0-or-later; Verkauf später über Dual-Lizenz möglich, solange alleiniger Copyright-Inhaber |
| Nicht bauen | Artikelgenerator, Deep-Research-Maximierung, Canvas ohne IDs, Sign-off durch die KI, SearXNG, Podcasts, zweites Repo |
