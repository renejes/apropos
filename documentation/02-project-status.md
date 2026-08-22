# 02 · Projekt-Status

> Aktueller Stand und aktuelle Funktionsweise. Kein Changelog.

|  |  |
|---|---|
| **Projekt** | Research Overview Platform |
| **Dokument** | 02 — Projekt-Status |
| **Stand** | 2026-08-22 · v3.1 |
| **Phase** | Gebaut und gegen Fixtures verifiziert · echter Modell-Lauf ausstehend |

**Dokument-Set:** [01 Implementationplan](01-implementationplan.md) · [02 Projekt-Status](02-project-status.md) · [03 Next Steps](03-next-steps.md) · Archiv: [04 Feasibility](done/04-feasability.md) · [05 Markt-Research](done/05-market-research.md) · [06 Eigene Research-Engine](done/06-eigene-research-engine.md) · [07 KI-Clients](done/07-clients.md)

---

## Was das Produkt ist

Eine **local-first Electron-App**, in der Research mit dem **Cursor-Abo in einem Fenster** läuft: Chat links, prüfbare Artefakte rechts. Die KI trägt Quellen ein; der Server erzwingt Provenienz; nur du darfst signieren.

Leitprinzip: KI-Einträge sind **Behauptungen mit Status**, keine Wahrheit. Kein Werkzeug kann `human_signed` setzen.

Zwei Lieferformen, ein Korpus: Blogs (Frame) und wissenschaftliche Arbeiten (Zitate, Seiten, empirische Papers).

---

## Zahlen

| | |
|---|---|
| Schema | **v10** (Brief, Biblio, Report-Scope, `source_kind`) |
| Tests | **218** (Vitest) |
| MCP-SDK | `@modelcontextprotocol/sdk` **1.30** |
| Agent | `@cursor/sdk` **1.0.28**, Runtime `local` |
| Lizenz | MIT |

Typecheck und Unit-Tests sind grün. Smoke (`npm run smoke`) prüft den MCP-HTTP-Pfad gegen einen echten Client, nicht gegen ein Frontier-Modell.

---

## Alltagsweg

1. App starten (`npm start`). In den Einstellungen bei Cursor anmelden (Systembrowser). Modell wählen — benanntes Modell, nicht Auto.
2. Projekt anlegen. Im **Agent-Chat** den Brief erarbeiten (`draft_research_brief`). Du bestätigst; `adopt_research_brief` macht ihn verbindlich. Mehrere Chats pro Projekt (neuer Chat, Verlauf, Tabs); mit `@` hängst du Quellen, Inbox-Dateien oder Teilfragen an.
3. Erst danach Suche: `search_literature` und Cursor-WebSearch dürfen entdecken. Was in den Bericht soll, geht über `fetch_source` in die DB, dann `add_source` mit Offsets.
4. Rechts prüfst du: Übersicht (Lücken, „Was darfst du sagen“), Quellen (Excerpt + Sign-off), Aussagen, Karte, Berichte.
5. Karte aufbereiten (`prepare_view`, Marks). Schreibpaket exportieren → Ordner in Easy Writing öffnen.

Fremdclients (Cursor-IDE, Goose, Claude Code) docken weiter per **MCP-HTTP** `127.0.0.1:8790/mcp` an dieselbe SQLite und dasselbe Enforcement an. Die IDE ist optional.

---

## Ablauf einer Research

```
Brief entwerfen → adoptieren
        │
        ▼
plan_research (Teilfragen aus dem Brief)
        │
        ▼
Suche (literature / WebSearch) nur gegen den Plan
        │
        ▼
fetch_source → add_source (Offset-Zitat) oder exclude_source
        │
        ▼
Coverage / next_round  (Server entscheidet „genug“, nicht das Modell)
        │
        ▼
Karte, Marks, ask_narrative, prepare_view
        │
        ▼
Schreibpaket aus dieser Sicht  +  Sign-off in der UI
```

Ohne adoptierten Brief lehnen `search_literature`, `fetch_source` und `ingest_local_file` mit `brief_required` ab.

---

## Was der Server erzwingt

Alles unterhalb der Schleife liegt in `services/research.ts`. MCP-Handler und In-App-Agent rufen dieselben Services. Wer `repo.*` direkt schreibt, umgeht die Garantien.

**Zitat.** `fetch_source` speichert den Text (HTML und PDF). `add_source` bekommt `document_id` + `quote_start` + `quote_end` — der Server schneidet das Zitat aus. Das Modell tippt kein Zitat ab. Zusätzlicher Text, der nicht zu den Offsets passt, wird abgewiesen. Scans/Paywall: alter Pfad `verbatim_quote` ohne `document_id`, plus menschlicher Sign-off.

**Vollständigkeit.** Weitere Abrufe sind gesperrt, solange abgerufene Quellen nicht per `add_source` oder `exclude_source` dokumentiert sind (`ROP_MAX_PENDING`, Standard 3).

**Tiefe.** `plan_research` legt Teilfragen an. `get_coverage_gaps` ist eine Zählung. `next_round` misst Sättigung. `add_report_version` lehnt ab, solange blockierende Lücken offen sind — Quittierung nur mit Begründung im Audit-Log.

**Brief.** Suche erst nach Adoption. `plan_research` übernimmt Teilfragen aus dem Brief.

**Fehler.** Jede Fehlerantwort beginnt mit `status: "FEHLER …"` und trägt `next_action` im Imperativ (`ServiceError` erzwingt den Hinweis).

WebSearch **darf entdecken**. Snippets sind keine Quelle. Berichtstext nur aus `documents`.

---

## Architektur

```
Electron
  Renderer    Chat (SDK-Stream, Sessions) │ Tabs: Übersicht, Quellen, Aussagen,
              Einstellungen               │ Karte, Berichte, Protokoll, Audit
  Main        CursorAgentHost ── customTools ── ToolBridge (In-Memory-MCP)
              mehrere Agenten / Projekt (chats.json + Transcripts)
              HTTP-MCP 127.0.0.1:8790
              services/research.ts  →  SQLite WAL + FTS5
```

Inferenz läuft in der **Cursor-Cloud** (Abo). Source of Truth ist lokal. Local-first heißt: die Datenbank, nicht das Modell.

`ResearchEngine` + `FakeProvider` sind **Testharness** (Quota, Checkpoint, Coverage) — kein Nutzer-Modus. Die frühere Ollama-Engine in der App ist entfernt.

---

## Oberfläche

| Ort | Funktion |
|---|---|
| Agent-Chat | Research-Lauf: Stream, Denken, Tool-Chips, Stopp; mehrere Sessions (Verlauf, Tabs); Composer mit Agent/Plan und Modell; `@`-Mentions und Datei-Chips; PDF-Anhang in die Inbox; Token-Usage |
| Übersicht | Abdeckung, Lücken, Verifikation, **Was darfst du sagen** (grün/gelb/rot) |
| Quellen | Excerpt im Original, Sign-off / Ablehnen |
| Aussagen | Claims und Belegkanten |
| Karte | Live-Graph, gespeicherte Views, Splitscreen, Marks |
| Berichte | Unveränderliche Versionen |
| Einstellungen | Cursor-Login, Modell, MCP-URL, Demo-Seed |

---

## Quellen, Zitate, Export

- Literaturregister: **OpenAlex, Crossref, Europe PMC**. arXiv nicht als Psych-Default. PSYNDEX hat keine offene API — Hinweis auf [PubPsych](https://www.pubpsych.eu), nicht scrapen.
- Bibliografie: DOI, Autoren, Jahr, Venue, Citekey `nachnameJahrKurztitel`. Ohne DOI: `@misc` mit URL, nie ein gefälschtes `@article`.
- Locator: `S. 12` → `[@citekey, p. 12]`. Keine erfundene Seitenzahl.
- `source_kind`: empirical / review / textbook / grey / web. Coverage kennt empirische und Zeitraum-Lücken.
- Schreibpaket (`export_writing_pack`) braucht immer einen Scope (View oder Marks). Enthält Plan, `.bib`, Claims, Bericht, `do-not-claim.md`, JPEG der Karte.

Schreibweg: Ordner in [Easy Writing](https://github.com/renejes/easy-writing) öffnen. Satz und Design optional in [Penwright](https://github.com/renejes/penwright). Diese App schreibt und setzt keine Artikel.

---

## Was belegt ist — und was nicht

**Belegt (automatisiert):** Schema-Zwang, Offset-Zitate, Brief-Gate, Coverage-Gate, Pending-Gate, Sign-off nur in der UI, Rebinding-Schutz, PDF-Offsets, Schreibpaket mit JPEG, Biblio/Citekey, Locator, Sayable-Lesart, Chat-Session-Index und Stream-Merge. 218 Tests.

**Nicht belegt:** Ob ein echtes Cursor-Modell den Arbeitsvertrag hält — Brief zuerst, Offsets auf die richtige Stelle, Extraktion trägt die Aussage. Die Maschine ist gegen Fixtures und ein Fake-Modell verifiziert, nie gegen eine echte Recherche.

Das ist der nächste Schritt: [03 Next Steps](03-next-steps.md).

---

## Festgelegt (nicht neu verhandeln)

| Thema | Stand |
|---|---|
| Alltagsweg | Cursor-SDK in der App; IDE optional |
| Enforcement | in `services/research.ts`, unter MCP und Agent |
| Sign-off | nur UI |
| Schreibweg | `.bib` + `[@citekey]` → Easy Writing, nicht Zotero |
| Ollama in der App | entfernt; Goose bleibt optionaler Fremdclient |
| Geschäftsmodell | keines; MIT |
| Nicht bauen | Artikelgenerator, Deep-Research-Maximierung, Canvas ohne IDs, Sign-off durch die KI |
