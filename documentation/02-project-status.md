# 02 · Projekt-Status

> Aktueller Stand der Anwendung. Kein Changelog, keine offenen Baustellenlisten. Ziel: das Produkt in einer Sitzung wieder verstehen.

|  |  |
|---|---|
| **Projekt** | apROPos |
| **Dokument** | 02 — Projekt-Status |
| **Stand** | 2026-10-09 |

**Dokument-Set:** [01 Implementationplan](01-implementationplan.md) · [02 diese Datei](02-project-status.md) · [03 Next Steps](03-next-steps.md) · [08 Notebook](08-notebook.md) · [HANDOVER](../HANDOVER.md) · Archiv: [04](done/04-feasability.md) · [05](done/05-market-research.md) · [06](done/06-eigene-research-engine.md) · [07](done/07-clients.md)

---

## Was das Produkt ist

Eine **local-first Electron-App**. Die KI läuft über das **Cursor-Abo im Fenster**. Die SQLite-Datei auf dem Rechner ist die Source of Truth; Modelle laufen in der Cursor-Cloud.

Zwei Projektarten (`projects.kind`):

| | **Research** | **Notebook** |
|---|---|---|
| Versprechen | Prüfbare Recherche: Brief, Offset-Zitate, Lücken, Sign-off, Schreibpaket | Quellen (PDF, YouTube) fragen, Antworten als **bearbeitbare** Markdown-Notizen, HTML-Artefakte |
| Brief / Gates | ja | nein |
| UI | Chat links; rechts Plan, Agent-Desk, Human Desk, Bericht | Quellen/Notizen links, Chat+Notiz-Tabs in der Mitte |
| Details | dieser Text | [08 Notebook](08-notebook.md) |

Leitprinzip (beide): KI-Einträge sind **Behauptungen mit Status**, keine Wahrheit. Kein Werkzeug kann `human_signed` setzen. Was als Zitat in einen Bericht soll, braucht Offsets — der Server schneidet den Text. Berichte und BibTeX enthalten nur übernommene Quellen.

Zwei Lieferformen im Research-Modus, ein Korpus: Blogs (Frame) und wissenschaftliche Arbeiten (Zitate, Seiten, empirische Papers). Hochgeladene PDFs sind Seed-Quellen im selben Korpus.

---

## Zahlen

| | |
|---|---|
| Schema | **v21** (Impressum: Band, Heft, Seiten, Verlag, Ort, Auflage, Herausgeber, Bandtitel; davor v20 `biblio_suggestions`) |
| Tests | **385** (Vitest) |
| MCP-SDK | `@modelcontextprotocol/sdk` **1.30** |
| Agent | `@cursor/sdk` **1.0.28**, Runtime `local` |
| Runtime | Electron **39** (Node-22-ABI für `better-sqlite3`) |
| Lizenz | **GPL-3.0-or-later** (Copyright René Jesser; Dual-Lizenz als alleiniger Rechteinhaber möglich) |

Typecheck und Unit-Tests sind grün. Smoke (`npm run smoke`) prüft den MCP-HTTP-Pfad gegen einen echten Client, nicht gegen ein Frontier-Modell.

---

## Alltagsweg — Research

1. App starten (`npm start`). Einstellungen: Cursor anmelden (Systembrowser). **Benanntes Modell**, nicht Auto.
2. Projekt anlegen → **Research**. Optional verwandte Research-Projekte anhaken (Hausarbeit in Teilen).
3. PDFs als mögliche Quellen ablegen — unter **Plan**, über **PDFs reinlegen** im Kopf, oder die Büroklammer im Chat. Kein Brief nötig. Keine Paywall nötig.
4. Im Chat den Brief erarbeiten; er erscheint unter **Plan**. Du bestätigst (`adopt_research_brief`). **YOLO** (Composer-Menü): Briefing bleibt, danach Suche ohne Nachfragen — Offsets und Sign-off bleiben.
5. Erst danach suchen: eigener Korpus und verwandte Projekte, dann **Zotero** (`search_zotero`, PDF mit `ingest_zotero_pdf`), dann Literaturregister und WebSearch gegen den Plan. An einer übernommenen DOI: `snowball_literature`. Pro offener Teilfrage wenige passende Treffer, nicht die ganze Welle. Nach jeder Welle `reflect_search`, **bevor** erneut gesucht wird. Querverweise und Sackgassen: **Arbeitsnotizen** unter Plan (`NOTES.md`) — kein Beleg.
6. Ordner landen auf dem **Agent-Desk** (zuschauen) und dem **Human Desk** (**Übernehmen** / Ablehnen). Citekey und Typ stehen in der Akte. **Titelangaben** (Band, Seiten, Verlag, Ort) füllst du, wo Crossref leer bleibt. Ohne DOI kann die KI einen Crossref-Vorschlag legen — **Metadaten übernehmen** ist extra. Nur du setzt beides. Ein gesetzter Typ bleibt auch ohne DOI.
7. Bericht nur aus `human_signed`. Offene Ordner werden nicht zitiert. Export: Provenienz-Markdown, **BibTeX und RIS (nur übernommen)**, **Nach Zotero**, Easy Writing. Deutscher Fundstellen-Locator `S. 12`. Ein deutsches Paper setzt im Easy-Writing-Manifest den Stilnamen `deutsche-gesellschaft-fur-psychologie`.

Ohne adoptierten Brief: `brief_required` für Suche und Netzabruf. Uploads brauchen keinen Brief.

Fremdclients docken per **MCP-HTTP** `127.0.0.1:8790/mcp` an dieselbe SQLite. Der WebSearch-Hook fragt `GET /ingest/search-gate`; App tot → Fail-open.

## Alltagsweg — Notebook

1. Projekt anlegen → **Notebook**. Optional an ein Research koppeln (lebt den Korpus, besitzt ihn nicht).
2. PDFs ablegen und/oder YouTube-Links (nur Videos **mit Untertiteln** — sonst klarer Fehler).
3. Im Chat fragen. Unter der Antwort **Als Notiz speichern** — dann in der Mitte bearbeiten. Der Agent speichert nicht von selbst.
4. Notiz in der Mitte öffnen und Markdown editieren. Folien/Tabellen: Agent schreibt nach `artifacts/`, Vorschau im iframe.

Ausführlich: [08](08-notebook.md).

---

## Ablauf einer Research

```
PDFs in den Korpus (optional, ohne Brief)
Verwandte Research-Projekte verknüpfen (optional)
        │
        ▼
Brief entwerfen → du bestätigst (Tab Plan)
        │
        ▼
plan_research (Teilfragen aus dem Brief)
        │
        ▼
Korpus / verwandte Projekte / Zotero / literature / Schneeball / WebSearch
        │  gegen den Plan, pro Lücke wenige Treffer
        ▼
reflect_search  (Lage: covered / underrepresented / next_action)
        │     die nächste Suche ist gesperrt, bis die Lage steht
        ▼
fetch_source / read_document → assess_carrier → add_source (Offset)
        │     oder exclude_source; Ordner auf den Arbeitstisch
        │     daneben: append_project_notes (NOTES.md, kein Beleg)
        │     ohne DOI: search_biblio → propose_biblio (Crossref, nicht Gedächtnis)
        ▼
Coverage / next_round  (Plan und get_coverage_gaps, nicht „5 Quellen“)
        │
        ▼
Human Desk: Übernehmen; DOI-Metadaten extra  →  Bericht nur aus human_signed
        │
        ▼
Export: Markdown · BibTeX und RIS (signiert, Server) · Zotero · Easy-Writing-Ordner
```

Paywall: Capture-Auftrag, Volltext nachlegen, dann `read_document` — nicht `verbatim_quote` erfinden.

---

## Was der Server erzwingt (Research)

Alles unterhalb der Schleife liegt in `services/research.ts` (plus `related-research.ts` für Kopplung, `project-notes.ts` für `NOTES.md`, `biblio.ts` für Citekey und DOI-Vorschläge). MCP-Handler und In-App-Agent rufen dieselben Services. Wer `repo.*` direkt schreibt, umgeht die Garantien.

Bei `kind === 'notebook'` überspringen `requireAdoptedBrief`, `requireSearchReflection` und `evaluateSearchGate`. Offset-Zitate und `add_source` gelten weiter. Verknüpftes Notebook: Korpus nur lesen.

**Zitat.** `fetch_source` speichert den Text (HTML und PDF). `add_source` bekommt `document_id` + `quote_start` + `quote_end` — der Server schneidet das Zitat aus. Scan ohne Textschicht: `verbatim_quote` ohne `document_id` plus menschlicher Sign-off. Paywall: Capture-Auftrag, warten.

**Arbeitsbuffer.** Weitere Netzabrufe gesperrt, solange zu viele abgerufene Volltexte undokumentiert sind. Die Obergrenze folgt der **Beleglücke gegenüber dem Plan** (Floor 2, Ceiling `ROP_MAX_PENDING` Default 8). Uploads und verwandte Lesezugriffe zählen nicht. Das ist kein Forschungs-Soll.

**Such-Lage.** Nach Discovery-Welle nächste Suche erst nach `reflect_search`. Das Modell formuliert `next_query` selbst. Register-Totalausfall zählt nicht als Welle. `get_coverage_gaps` ist Zählung, kein Suchauftrag.

**Tiefe.** Teilfragen, Sättigung, `add_report_version` lehnt unsignierte Zitate und blockierende Lücken ab.

**Verwandte Research.** Gerichtete Links (`research_links`). Der Agent liest dort (`list_related_research`, `read_related_document`). Was in *dieses* Projekt soll: `import_related_source` (Kopie, pending). Fremde `document_id` in `add_source` wird abgewiesen. Übernehmen erneut hier.

**Arbeitsnotizen.** Eine `NOTES.md` im Workspace (Tab Plan). Der Agent liest und hängt an (`read_project_notes` / `append_project_notes`). Du ersetzt denselben Text in der UI. Kein Beleg — Bericht und BibTeX ignorieren die Datei. Nur Research; Notebook bleibt bei `save_note`.

**Bibliografie.** Citekey `nachnameJahrKurztitel` und BibTeX-Typ stehen auf dem Human Desk. Impressum (Band, Heft, Seiten des Werks, Verlag, Ort, Auflage, Herausgeber, Bandtitel) kommt aus Crossref oder von dir unter **Titelangaben**. Ein Buch mit Bandtitel wird `@incollection`. Ohne DOI bleibt der gesetzte Typ; fehlende Felder bleiben leer. „f.“ und „ff.“ lehnt der Server ab. Quellen ohne DOI: der Agent sucht bei Crossref (`search_biblio`) und legt einen geprüften Vorschlag (`propose_biblio`). Du übernimmst die Metadaten. Keine erfundenen Autoren, keine selbst geschriebene `.bib`. Signierte Citekeys bleiben. Deutscher Export: `S. 12`.

**Zotero.** Lokale API `127.0.0.1:23119`, Zotero muss laufen und anderen Programmen die Verbindung erlauben. `search_zotero` ist eine Suchwelle und legt Treffer auf den Arbeitstisch. `ingest_zotero_pdf` liest das PDF vom Zotero-Pfad und speichert den Text, nicht eine zweite Datei. Die Citekey aus Zotero bleibt. `export_to_zotero` importiert nur Übernommene mit Citekey (Connector-Import, Schlagwort `apROPos`); gleiche DOI oder Citekey wird nicht doppelt angelegt. Better BibTeX soll installiert sein, damit der Schlüssel in der `.bib` für Penwright erhalten bleibt.

**Schneeball.** `snowball_literature` an einer übernommenen Quelle mit DOI: Referenzen und Zitierende aus OpenAlex, höchstens zwölf je Richtung. Treffer, keine Quellen. Danach `reflect_search`.

**Fehler.** `status: "FEHLER …"` und `next_action` im Imperativ (`ServiceError` erzwingt den Hinweis).

WebSearch **darf entdecken**. Snippets sind keine Quelle.

---

## Architektur

```
Electron
  Renderer    Chat (SDK-Stream, gruppierte Tool-Aktivität)
              Research: Plan · Agent-Desk · Human Desk · Bericht
              oder NotebookView
  Main        CursorAgentHost ── customTools (gefiltert nach kind) ── ToolBridge
              HTTP-MCP 127.0.0.1:8790
              research.ts / related-research.ts / project-notes.ts / biblio.ts / zotero.ts / notes.ts / youtube.ts
              → SQLite (WAL lokal / DELETE im Sync-Ordner) + FTS5
```

`ResearchEngine` + `FakeProvider` sind **Testharness**, kein Nutzer-Modus. Ollama-Engine in der App ist entfernt.

---

## Oberfläche

Chrome wie Easy Writing: Linie, Invert, Farbe nur für Bedeutung.

| Ort | Funktion |
|---|---|
| Neues Projekt | Research vs Notebook; Research: optional verwandte Projekte |
| Agent-Chat | Stream, Sessions, `@`, Büroklammer (sofort Korpus); Denken/MCP eingeklappt; Notebook: „Als Notiz speichern“ |
| Plan | Briefing, Stand, **Arbeitsnotizen** (`NOTES.md`), **eigene PDFs**, **verwandte Research** |
| Agent-Desk | Ordner der KI (in Arbeit) — zuschauen, nicht signieren |
| Human Desk | Offene Ordner **Übernehmen** oder Ablehnen; Citekey, Typ, DOI, **Titelangaben**; Crossref-Vorschlag extra; BibTeX, RIS, **Nach Zotero** |
| Bericht | Fassungen; nur `human_signed` zitierbar |
| Export | Provenienz, Easy Writing, BibTeX und RIS (nur übernommen) |
| Einstellungen | Cursor-Login, Modell, MCP-URL, **Zotero-Verbindung**, Demo-Seed, Datenordner |

---

## Quellen, Zitate, Export (Research)

- Register: OpenAlex, Crossref, Europe PMC, Semantic Scholar, OpenAIRE. Dazu Zotero lokal und Schneeball über OpenAlex. PSYNDEX: Hinweis PubPsych, nicht scrapen. BASE ist nicht angebunden.
- Citekey `nachnameJahrKurztitel`, aus Zotero übernommen wenn das PDF von dort kommt. Gesetzter Typ bleibt ohne DOI. KI darf DOI vorschlagen (`search_biblio` / `propose_biblio`); Übernehmen nur UI.
- Easy Writing: `research.mdx` + gemergte `.bib` und `.ris`; deutsches Paper nennt den DGPs-Stilnamen; Schreibkapitel unangetastet; Pfad in `easy_writing_dir`.
- BibTeX- und RIS-Export in Dialog und Human Desk: nur `human_signed`.
- Markdown-Schreibpaket bleibt daneben.

Schreibweg: [Easy Writing](https://github.com/renejes/easy-writing), Satz optional [Penwright](https://github.com/renejes/penwright). Diese App schreibt keine Artikel.

---

## Was belegt ist — und was nicht

**Belegt (automatisiert):** Schema-Zwang, Offset-Zitate, Brief-Gate (Research), Coverage-Gate, Arbeitsbuffer, Sign-off nur UI, Berichte und BibTeX nur signiert, Rebinding-Schutz, PDF-Offsets, Seed-Korpus, Such-Lage, Easy-Writing-Ordner, Biblio/Citekey, Impressum und RIS, deutscher Locator `S.`, DOI-Vorschlag (Crossref, Human Desk übernimmt), Schneeball (OpenAlex, Fixture), Zotero-Suche, PDF-Ingest und Import (Fixture, kein laufendes Zotero), Sayable, Chat-Sessions, Projekt-Löschen, verwandte Research (Link, Lesen, Import als pending), Arbeitsnotizen (`NOTES.md`: lesen, anhängen, ersetzen; kein Beleg), **Notebook:** `kind`, Notizen+Datei, YouTube-ID-Parsing, Gates aus, Tool-Filter, lebender Korpus (`linked_research_id`), Ingest-Ablehnung, Research-Lösch-Guard, Lock/Journal.

**Nicht belegt:** Ob ein echtes Cursor-Modell den Research-Vertrag hält (Brief, Lage, richtige Offsets, verwandte Projekte, Seed-PDFs, Zotero, DOI-Nachschlag statt erfundener Metadaten). Ob der Zotero-Connector-Import die Citekey mit installiertem Better BibTeX behält. Ob der Notebook-Agent Notizen mit Offsets speichert statt Freitext. Die Maschine ist gegen Fixtures verifiziert, nicht gegen eine echte Recherche.

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
| Menge | Plan / Coverage, nicht eine globale Stückzahl |
| Bericht / BibTeX | nur `human_signed` dieses Projekts |
| Verwandte Research | gerichtete Links; lesen ja, zitieren erst nach lokaler Kopie + Sign-off |
| Arbeitsnotizen | eine `NOTES.md` unter Plan; kein Beleg; Agent hängt an, Mensch ersetzt |
| Bibliografie | Server/Crossref plus Titelangaben; KI schlägt DOI vor; Übernehmen nur UI; signierte Citekeys stabil; RIS neben BibTeX |
| Zotero | Bibliothek, nicht der Zitierstil. Lesen und PDF ohne zweite Datei; Schreiben nur Übernommene. Better BibTeX für die Citekey |
| Schreibweg | Easy Writing oder Penwright; kein Artikelgenerator |
| Korpus | Research besitzt ihn; Notebook darf ihn lesen (`linked_research_id`) |
| PDF | Lesen (pdf.js), nicht markieren; Seed-Upload ohne Brief |
| Datenordner | Nutzerpfad; Dropbox/Drive nur Dateisystem; Lock + DELETE-Journal |
| Oberfläche | Familie zu Easy Writing |
| Ollama in der App | entfernt |
| Lizenz | GPL-3.0-or-later; Verkauf später über Dual-Lizenz möglich, solange alleiniger Copyright-Inhaber |
| Nicht bauen | Artikelgenerator, Deep-Research-Maximierung, Canvas ohne IDs, Sign-off durch die KI, SearXNG, Podcasts, zweites Repo |
