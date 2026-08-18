# 01 · Implementation-Plan

> Architektur, MCP-Tool-Interface, Datenmodell und phasierter Umsetzungsplan (TypeScript/Node, Electron, SQLite + Markdown).

|  |  |
|---|---|
| **Projekt** | Research Overview Platform |
| **Dokument** | 01 — Implementation-Plan |
| **Stand** | 2026-07-24 · v1.0 |
| **Phase** | Konzept / Pre-Prototype (Greenfield) |

**Dokument-Set:** [01 Implementationplan](01-implementationplan.md) · [02 Projekt-Status](02-project-status.md) · [03 Next Steps](03-next-steps.md) · [04 Feasibility](04-feasability.md) · [05 Markt-Research](05-market-research.md) · [06 Eigene Research-Engine](06-eigene-research-engine.md) · [07 KI-Clients](07-clients.md)

---

## Vision in einem Satz

Eine **local-first Desktop-App**, die KI-Deep-Research von einer Blackbox in ein **prüfbares, versioniertes und zitierbares Audit-Artefakt** verwandelt: Jede angedockte KI trägt über einen **eingebauten MCP-Server** jede Quelle strukturiert ein (warum diese Quelle / welches Wissen extrahiert / welcher Beitrag zum Ergebnis), ein Enforcement- und Verifikations-Layer prüft, und **Mensch UND KI reviewen** dasselbe Projekt — bis am Ende ein vollständiges, an wissenschaftliche Arbeiten anhängbares Research-Paket steht.

## Fixierte Parameter (vom Auftraggeber entschieden)

| Entscheidung | Wahl |
|---|---|
| **Zielgruppe** | Akademisch **und** Marketing/Business gleichwertig |
| **Produktform** | Hybrid — eigene Review-UI + eingebauter MCP-Server (jede KI andockbar) |
| **Tech-Stack** | TypeScript / Node |
| **Speicher** | SQLite als abfragbare Source-of-Truth + Markdown-Export |

**Aus der Research abgeleitete Empfehlungen (nicht vorgegeben, siehe Begründung unten):** Electron als Shell · lokaler Streamable-HTTP-MCP-Endpoint auf `127.0.0.1` · `better-sqlite3` + FTS5 · Drizzle als ORM · RO-Crate (JSON-LD) als Export-Standard für echte akademische Zitierbarkeit.

## Leitprinzip (der wichtigste Satz des ganzen Plans)

Aus der Feasibility-Analyse ([04](04-feasability.md)) folgt der zentrale Design-Grundsatz:

> **Die KI-Eingaben (warum / Extraktion / Beitrag) werden nie als Wahrheit gespeichert, sondern als *zu verifizierende Behauptungen* mit Status und Konfidenz.**

Das *Format*-Problem (schema-konformes Eintragen) ist mit heutiger KI gelöst; das *Inhalts*-Problem (stimmt die Quelle, ist die Extraktion wahr, ist die Begründung echt) ist es nicht. Deshalb ist der **Verifikations- + Review-Layer kein Zusatz-Feature, sondern das eigentliche Produkt** — und zugleich das Alleinstellungsmerkmal ([05](05-market-research.md)).

---

## Architektur-Ueberblick

Die Plattform ist eine **local-first Desktop-Hybrid-App**: eine eigene Review-/Projekt-UI, ein persistenter Datenspeicher (SQLite als Source-of-Truth) und ein **eingebauter MCP-Server**, an den beliebige KI-Clients (Claude Desktop/Code, Cursor, VS Code, via Bridge auch ChatGPT) andocken und den Rechercheprozess strukturiert einschreiben. Der zentrale Architektur-Gedanke: Die KI **schreibt** ihre Quellen, Extrakte und Begruendungen ueber schema-erzwingende MCP-Tools in die DB; die App **verifiziert und reviewt** (Mensch + KI); der Export erzeugt ein zitierbares, versioniertes Audit-Artefakt.

```
        KI-Clients (beliebig, mehrere gleichzeitig)
   Claude Desktop │ Cursor │ VS Code │ ChatGPT (via mcp-remote-Bridge)
        │            │          │            │
        └────────────┴──── MCP (Streamable HTTP, 127.0.0.1) ───┘
                              │  JSON-RPC 2.0, Session = mcp-session-id
                              ▼
   ┌───────────────────────────────────────────────────────────────┐
   │   DESKTOP-SHELL (Electron, Main-Prozess = Node.js)             │
   │                                                                │
   │   ┌──────────────────┐   ┌──────────────────────────────────┐  │
   │   │  MCP-Server       │   │  Enforcement-Layer               │  │
   │   │  (@mcp/sdk, in-   │──▶│  - Zod/JSON-Schema-Validierung   │  │
   │   │   process)        │   │  - Pflichtfeld-Check             │  │
   │   │  Tools: create_.. │   │  - Quote-in-Source-Pruefung      │  │
   │   │  add_source, ...  │   │  - Verifier (NLI/LLM-Judge)      │  │
   │   └──────────────────┘   └───────────────┬──────────────────┘  │
   │                                          │                     │
   │   ┌──────────────────────────────────────▼──────────────────┐  │
   │   │  Persistenz: better-sqlite3 (+ FTS5)                     │  │
   │   │  - Domain-Tabellen (projects, sources, claims, ...)     │  │
   │   │  - Append-only event_log (Audit / Time-Travel)          │  │
   │   │  - FTS5-Virtual-Tables + Sync-Trigger (Raw-SQL)         │  │
   │   └──────────────────────────────┬──────────────────────────┘  │
   │                                  │                             │
   │   ┌──────────────┐   ┌───────────▼─────────┐   ┌────────────┐  │
   │   │  Review-UI    │   │  Versionierung /    │   │  Export     │  │
   │   │ (Renderer,    │◀─▶│  Snapshots (Hash-   │──▶│  Markdown + │  │
   │   │  Human-Signoff│   │  Release-IDs)       │   │  RO-Crate   │  │
   │   └──────────────┘   └─────────────────────┘   └────────────┘  │
   └───────────────────────────────────────────────────────────────┘
```

**Datenfluss (ein Quell-Eintrag):** KI ruft `add_source` → Enforcement-Layer validiert Schema + Pflichtfelder + prueft, ob das woertliche Exzerpt tatsaechlich im Quelltext vorkommt → Eintrag wird als `pending_review` in SQLite geschrieben und als Event geloggt → Verifier (NLI/LLM-Judge) setzt einen Confidence-/Support-Status → Mensch reviewt in der UI und gibt frei → beim `add_report_version` wird ein unveraenderlicher Snapshot mit stabiler Hash-ID erzeugt, den der Markdown-Export zitierbar macht.

---

## Desktop-Shell-Entscheidung

**Empfehlung: Electron.** Fuer einen fixierten TypeScript/Node-Stack mit *eingebautem* Node-MCP-Server und *nativer* SQLite (FTS5) ist Electron die architektonisch geradlinigere Wahl, weil Electron im Main-Prozess eine vollstaendige Node.js-Runtime mitbringt: MCP-Server und `better-sqlite3` laufen **in-process**, ohne zusaetzlichen Prozess und ohne Sprachwechsel ([Node.js as a sidecar | Tauri v2](https://v2.tauri.app/learn/sidecar-nodejs/)).

**Warum nicht Tauri (trotz Vorteilen):** Tauri v2 liefert ~90 % kleinere Bundles (~3,2 MB vs. ~85 MB Hello-World) und Security-by-default ueber explizite Capability-Allowlists ([Electron vs Tauri 2026 - PkgPulse](https://www.pkgpulse.com/guides/electron-vs-tauri-2026)). Aber das Tauri-Backend ist Rust. Um den TS/Node-MCP-Server zu betreiben, muesste man ihn als externes **Sidecar-Binary** kompilieren (yao-pkg/pkg), pro Ziel-Architektur mit `-$TARGET_TRIPLE`-Suffix benennen, in `src-tauri/binaries/` legen und ueber `bundle.externalBin` + Shell-Plugin-Permissions einbinden ([Embedding External Binaries | Tauri v2](https://v2.tauri.app/develop/sidecar/)). Das reintroduziert de facto eine gebuendelte Node-Runtime plus zusaetzliche Build-/Signing-Komplexitaet — der Bundle-Vorteil schrumpft, die Komplexitaet steigt. Die Alternative (MCP-Server in Rust via `rmcp`-Crate) widerspricht dem fixierten TS/Node-Stack und hatte zudem dokumentierte Verbindungsabbrueche mit Claude Desktop bei Nicht-Node-Servern ([tauri-plugin-mcp - crates.io](https://crates.io/crates/tauri-plugin-mcp)).

**Warum nicht reine Web-App:** Der local-first-Datensouveraenitaets-Vorteil (SQLite lokal als Source-of-Truth, kein CLOUD-Act-Exposure) und der lokale MCP-Endpoint fuer Desktop-KI-Clients (stdio/localhost-HTTP) sind im Browser nicht erreichbar. Eine reine Web-App verliert genau das staerkste Positionierungs-Asset.

**Tauri als bewusste Ausnahme:** Nur wenn Bundle-Groesse/Security absolute Prioritaet erhalten und man den MCP-Server als eigenstaendigen Node-Prozess (Sidecar) akzeptiert.

**Kosten von Electron, eingeplant:** `better-sqlite3` ist ein Native-Addon und muss bei jedem Electron-Upgrade via `@electron/rebuild` neu gebaut werden ([Electron SQLite - RxDB](https://rxdb.info/articles/electron-sqlite.html)). Dieser Rebuild-Schritt gehoert fest in die CI-/Packaging-Pipeline. (Der Ausweg `node:sqlite` scheidet aus, weil er ohne FTS5 kompiliert ist — siehe Datenmodell.)

**MCP-Server-Betrieb:** Der Server laeuft als in-process-Modul des Electron-Main-Prozesses und exponiert einen **lokalen Streamable-HTTP-Endpoint auf 127.0.0.1**. Grund: stdio ist strikt 1 Client pro Prozess (kein Multi-Client, keine Netzwerk-Auth), waehrend Streamable HTTP mit einem Serverprozess viele Clients gleichzeitig bedient — Voraussetzung fuer "jede KI andockbar, mehrere gleichzeitig" ([MCP Transport - TrueFoundry](https://www.truefoundry.com/blog/mcp-stdio-vs-streamable-http-enterprise)). Kanonisches Muster im TS-SDK: pro `initialize` eine `StreamableHTTPServerTransport`+`McpServer`-Instanz erzeugen und in einer Map nach `mcp-session-id` ablegen; Folgeanfragen reusen die Instanz ([Stateful MCP Sessions - CodeSignal](https://codesignal.com/learn/courses/developing-and-integrating-an-mcp-server-in-typescript/lessons/stateful-mcp-server-sessions)). Haertung: an `127.0.0.1` binden, `allowedHosts`/`allowedOrigins` + `enableDnsRebindingProtection` setzen (sonst koennen Websites im Browser des Nutzers per DNS-Rebinding auf den lokalen Endpoint zugreifen) und pro andockendem Client ein Token/Handshake verlangen. stdio bleibt optionaler Fallback fuer Einzelclient-CLIs; das deprecatete HTTP+SSE wird nicht verwendet ([Future of MCP Transports - MCP Blog](https://blog.modelcontextprotocol.io/posts/2025-12-19-mcp-transport-future/)). Fuer ChatGPT (nur Remote-HTTPS, kein lokales stdio) wird ein optionaler `mcp-remote`-Bridge-/Tunnel-Pfad mitgeliefert.

Basis ist das offizielle `@modelcontextprotocol/sdk` in der stabilen v1-Linie (Server- und Client-Seite, stdio + Streamable HTTP, CORS/DNS-Rebinding-Schutz); das v2-Beta zum 2026-07-28-Spec-RC wird beobachtet, aber nicht produktiv gesetzt ([@modelcontextprotocol/sdk - npm](https://www.npmjs.com/package/@modelcontextprotocol/sdk)).

---

## MCP-Tool-Interface

Der Server exponiert bewusst **wenige, sehr praezise beschriebene Tools** statt vieler. Das ist empirisch begruendet: Zuverlaessigkeit sinkt stark mit der Tool-Anzahl (bei ~50 Tools 84–95 %, bei ~740 Tools nur 0–20 %), und Tool-Beschreibungen sind die groesste einzelne Stellschraube (97,1 % analysierter MCP-Descriptions haben Qualitaetsmaengel; bessere Beschreibungen +~6 Prozentpunkte Erfolgsrate) ([MCP Tool Descriptions Are Smelly! - arXiv](https://arxiv.org/abs/2602.14878)). Jedes Tool wird daher mit klarem Zweck, Parameter-Erklaerungen, Beispielen und "Wann-nicht-nutzen"-Hinweisen dokumentiert.

Alle Tools nutzen **strict JSON-Schema** (Zod). Das loest das *Format*-Problem (nahezu 100 % Schema-Compliance via Constrained Decoding), NICHT das *Inhalts*-Problem — "Schemas guarantee structure, not semantic correctness" ([OpenAI Structured Outputs Guide](https://www.digitalapplied.com/blog/openai-structured-outputs-complete-guide)). Deshalb ist jedes Schreib-Tool an den Enforcement-Layer gekoppelt.

| Tool | Zweck | Wichtigste Parameter |
|---|---|---|
| **create_project** | Neues Research-Projekt anlegen (Container fuer alles Weitere) | `title`, `research_question`, `mode` (`academic`\|`business`), `policy_preset` (z. B. `ICMJE`, `DFG`, `PRISMA`) |
| **add_source** | Eine Quelle MIT strukturierter Bewertung erfassen | `project_id`, `url` (aufloesbar, Pflicht), `title`, `retrieval_method`+`accessed_at`, `reason` (**warum diese Quelle**), `extraction` (**welches Wissen entnommen**), `contribution` (**Beitrag zum Ergebnis**), `verbatim_quote` (**woertliches Exzerpt**, Pflicht), `quote_locator` (Span/Seite) |
| **log_extraction** | Einzelne Wissensextraktion an eine Quelle binden (feiner als `add_source`) | `source_id`, `reasoning_freetext` (zuerst!), `extracted_fact`, `verbatim_quote`, `quote_locator` |
| **link_claim_to_source** | Eine Aussage im Bericht mit Quelle(n)+Span verknuepfen (many-to-many) | `claim_id`, `source_id`, `quote_span`, `support_type` (`supports`\|`contrasts`\|`mentions`), `confidence` |
| **add_report_version** | Unveraenderliche neue Berichtsfassung erzeugen (Snapshot) | `project_id`, `content_markdown`, `parent_version_id`, `change_summary` |
| **get_project_state** | Aktuellen Projektzustand lesen (read-only) | `project_id`, `include` (sources/claims/reviews/open_flags) |
| **request_review** | Einen Eintrag explizit zum Mensch/KI-Review anmelden | `entity_type` (`source`\|`claim`\|`report_version`), `entity_id`, `reason` |
| **add_chat_log** | Chat-/Reasoning-Protokoll als Provenance-Beleg mitspeichern | `project_id`, `role`, `content`, `model_id`, `model_version`, `provider`, `turn_index` |
| **flag_uncertainty** | KI-Selbstauskunft ueber Unsicherheit erzwingen/festhalten | `entity_type`, `entity_id`, `uncertainty_reason`, `confidence_level` |
| **re_verify** | Startet einen Re-Verification-Pass ueber offene Eintraege (manuell oder Batch); orchestriert deterministische Checks + geblindete KI-Pruefung | `project_id`, `scope` (`all_pending`\|`source_ids`\|`claim_ids`), `depth` (`deterministic`\|`ai_judge`\|`full`) |
| **get_next_unverified_claim** | Liefert der Verify-Session den naechsten zu pruefenden Eintrag — **geblindet**: nur `claim`/`extraction` + **frisch neu gefetchter** Quelltext, OHNE die urspruengliche Begruendung | `project_id`, `verifier_id` |
| **submit_verdict** | Schreibt das Verifikations-Urteil als **neue Review-Kante** zurueck (ueberschreibt nie das Original) | `entity_type`, `entity_id`, `verdict` (`supported`\|`partial`\|`unsupported`\|`source_unreachable`), `confidence`, `evidence_span`, `note` |

Die drei Verifikations-Tools (`re_verify`, `get_next_unverified_claim`, `submit_verdict`) bilden zusammen den **Re-Verification-Pass** — im eigenen Abschnitt weiter unten ausgearbeitet, weil er das sicherheitskritische Herz der Idee ist.

**Wie das Tool-Design Transparenz ERZWINGT:**

- **`add_source` ohne Pflichtfelder ist unmoeglich.** `reason`, `extraction`, `contribution` und `verbatim_quote` sind harte Schema-Pflichtfelder — die KI kann strukturell keine Quelle "nackt" eintragen. Das folgt direkt aus der Evidenz, dass frei/aus dem Gedaechtnis generierte Zitate zu 6–90 % fabriziert sind und nur erzwungenes Grounding mit woertlichen Belegen Halluzinationen drastisch senkt ([Anthropic Citations API](https://claude.com/blog/introducing-citations-api)).
- **Reasoning vor Struktur.** In `log_extraction` steht das Freitext-Begruendungsfeld im Schema VOR dem strukturierten Extrakt. Grund: Format-Zwang mit Antwortfeld-zuerst unterdrueckt Chain-of-Thought und senkt die Qualitaet ([Let Me Speak Freely? - arXiv](https://arxiv.org/abs/2408.02442)). Freies Begruenden und schema-konformes Eintragen werden getrennt.
- **`flag_uncertainty` macht Unsicherheit erst-klassig.** KI-Suchsysteme sind nachweislich "selbstbewusst falsch" (>60 % Fehlattribution, Unsicherheit fast nie signalisiert) ([AI Search Has a Citation Problem - CJR](https://www.cjr.org/tow_center/we-compared-eight-ai-search-engines-theyre-all-bad-at-citing-news.php)). Das Tool zwingt einen expliziten Confidence-Status.
- **Faithfulness ≠ Correctness.** Weil KI-Begruendungen bis zu 57 % nachtraeglich rationalisiert sind ([Correctness is not Faithfulness in RAG - arXiv](https://arxiv.org/abs/2412.18004)), werden `reason`/`contribution` als *zu verifizierende Behauptungen* gespeichert (Status `pending`), nie als Wahrheit.

---

## Datenmodell

SQLite via `better-sqlite3` (synchron, schnell, bringt **FTS5** gebuendelt mit). Das ab Node 22 eingebaute `node:sqlite` scheidet aus, weil es **ohne FTS5** kompiliert ist und damit die geforderte Volltextsuche nicht leisten kann ([better-sqlite3 - npm](https://www.npmjs.com/package/better-sqlite3)). ORM: **Drizzle** (schlank, SQL-nah, guenstig fuer Raw-SQL-Bedarf) — Prisma 7 (seit Nov 2025 Rust-frei, Bundle 14 MB → 1,6 MB) waere ebenfalls tragfaehig ([Prisma 7 Changelog](https://www.prisma.io/changelog/2025-11-19)). **Wichtig:** Weder Drizzle noch Prisma modelliert FTS5-Virtual-Tables nativ — die FTS5-Tabellen und ihre Sync-Trigger werden in **handgeschriebenen SQL-Migrationen** verwaltet und aus dem automatischen Schema-Diff ausgeklammert ([Drizzle Issue #2046](https://github.com/drizzle-team/drizzle-orm/issues/2046)).

**Kern-Tabellen (Kernspalten):**

```sql
projects(
  id, title, research_question, mode, policy_preset,
  created_at, updated_at)

sources(
  id, project_id → projects.id,
  url, title, retrieval_method, accessed_at,
  reason,          -- warum diese Quelle (KI, pending)
  extraction,      -- welches Wissen (KI, pending)
  contribution,    -- Beitrag zum Ergebnis (KI, pending)
  verbatim_quote,  -- Pflicht-Exzerpt
  quote_locator,
  quote_verified   BOOLEAN,  -- Exzerpt im Quelltext gefunden?
  url_resolved     BOOLEAN,  -- URL/DOI aufloesbar?
  review_status,   -- pending | ai_checked | human_signed
  confidence)

extractions(
  id, source_id → sources.id,
  reasoning_freetext, extracted_fact,
  verbatim_quote, quote_locator, created_at)

claims(
  id, project_id → projects.id,
  claim_text, report_section, created_at)

claim_source_links(          -- many-to-many + Status je Kante
  id, claim_id → claims.id,
  source_id → sources.id,
  quote_span, support_type,  -- supports | contrasts | mentions
  verification_status, confidence)

report_versions(             -- unveraenderlich (append-only)
  id, project_id → projects.id,
  parent_version_id, content_markdown,
  snapshot_hash,             -- stabile, zitierbare Release-ID
  change_summary, created_at, created_by)

chat_messages(
  id, project_id → projects.id,
  role, content, model_id, model_version, provider,
  turn_index, created_at)

reviews(                     -- eine Kante je Pruefung; ueberschreibt nie das Original
  id, entity_type, entity_id,
  reviewer_type,             -- human | ai_judge | deterministic
  reviewer_id,               -- Mensch, ODER Modell+Session-ID der Verify-KI
  verdict,                   -- supported | partial | unsupported | source_unreachable
                             --   | approved | rejected | flagged
  confidence, evidence_span, -- Beleg-Span, auf den sich das Urteil stuetzt
  source_snapshot_hash,      -- Hash des neu gefetchten Quelltexts (Reproduzierbarkeit)
  note, method, created_at)

event_log(                   -- Append-only Audit-Trail
  seq, project_id, actor,    -- welche KI / welcher Mensch
  event_type, payload_json, created_at)

sources_fts, claims_fts, reports_fts  -- FTS5 (Raw-SQL, per Trigger synchron)
```

Das **`event_log`** implementiert Event-Sourcing-Prinzipien: jede Zustandsaenderung wird unveraenderlich als Event gespeichert, Korrekturen erfolgen als Ausgleichs-Events (nichts wird geloescht). Das liefert genau den revisionssicheren "wer/welche-KI-hat-wann-was-eingetragen"-Audit-Trail, den ein *pruefbares* Research-Projekt braucht, plus Time-Travel; periodische Snapshots halten die Performance ([Event Sourcing 2026 - johal.in](https://www.johal.in/event-sourcing-with-event-stores-and-versioning-in-2026/)). Passend auch zu EU-AI-Act-Logging-Pflichten (Art. 12, ab Aug 2026).

**Markdown-Export (zitierbares Artefakt):** Je `report_version` ein unveraenderlicher Markdown-Export mit fester `snapshot_hash`-ID im Header, damit eine wissenschaftliche Arbeit auf eine stabile Fassung verweisen kann. Struktur:

```markdown
# <Projekttitel>  ·  Snapshot <hash>  ·  <ISO-Datum>
## Forschungsfrage
## Bericht
   … Aussagen mit Inline-Marker [S3 ¶2] auf Quelle+Span …
## Quellenverzeichnis
   [S3] <Titel> — <URL/DOI>  (Zugriff: <Datum>, Methode: <…>)
        Warum: <reason>
        Extraktion: <extraction>   Beitrag: <contribution>
        Beleg (woertlich): "<verbatim_quote>"  [verifiziert: ja/nein]
        Review: human_signed von <…> am <…>
## KI-Nutzungs-Deklaration   (Modell, Version, Provider, Zugriffsdatum)
## Provenance / Chat-Protokoll-Referenz   (Turn-Range, Hashes)
```

Fuer echte akademische Anschlussfaehigkeit wird zusaetzlich ein **RO-Crate-konformer** (JSON-LD) Export erzeugt — statt eines isolierten Eigenformats an den etablierten Provenance-Standard andocken, damit der Anhang in Repositorien (Zenodo/OSF, DOI) als valider Beleg zaehlt ([RO-Crate](https://www.researchobject.org/ro-crate/)).

---

## Transparenz- & Zuverlaessigkeits-Enforcement

Der Enforcement-Layer sitzt zwischen MCP-Tool-Call und DB-Schreibvorgang. Er ist der Kern des Produkts, weil die *mechanische* Zuverlaessigkeit (schema-konformes Eintragen) mit heutiger KI realistisch ist, die *inhaltliche* aber nicht: faktische Deckung einer Aussage durch die zitierte Quelle liegt selbst bei Frontier-Modellen nur bei 39–77 % und **sinkt** mit zunehmender Recherchetiefe (~42 % Abfall von 2 auf 150 Tool-Calls) ([Cited but Not Verified - arXiv](https://arxiv.org/abs/2605.06635)).

**Erzwungene Zwaenge:**

1. **Strikte Schema-Validierung** (Zod/JSON-Schema) auf jedem Schreib-Tool — ungueltige/fehlende/falsch-getypte Felder werden mit klarer Fehler-Rueckmeldung an die KI abgelehnt, nichts wird halb geschrieben.
2. **Pflichtfelder** `reason`/`extraction`/`contribution`/`verbatim_quote` — kein Quell-Eintrag ohne strukturierte Begruendung und woertlichen Beleg.
3. **Quote-in-Source-Pruefung:** Der Server fetcht die Quelle und prueft, ob `verbatim_quote` tatsaechlich im Quelltext vorkommt. Fehlt der Beleg, wird der Eintrag als *unbelegt* markiert.
4. **URL-/DOI-Aufloesung:** Jede Quelle wird gegen eine echte Datenbank (Crossref/DOI, OpenAlex, PubMed, Semantic Scholar) geprueft; Status als Pflichtfeld. Das faengt die dokumentierte Referenz-Fabrikationsrate (14–95 %) ab ([Hallucination Rates - JMIR 2024](https://www.jmir.org/2024/1/e53164)).
5. **Automatischer Verifier (NLI/LLM-Judge):** prueft je `claim_source_link`, ob der Span die Aussage stuetzt (Entailment). Er *flaggt*, entscheidet aber nicht endgueltig — automatische Attribution-Bewertung erreicht nur ~78 % F1 (hohe Precision, geringere Recall) ([AttributionBench](https://osu-nlp-group.github.io/AttributionBench/)).
6. **Verpflichtender Mensch-Sign-off:** `review_status` wechselt erst mit menschlicher Freigabe auf `human_signed`. "Die KI hat es eingetragen" reicht akademisch nicht — der Mensch traegt die Verantwortung (ICMJE/COPE) ([ICMJE - Role of Authors and AI](https://www.icmje.org/recommendations/browse/roles-and-responsibilities/defining-the-role-of-authors-and-contributors.html)).
7. **Reasoning/Extraktion getrennt** (Feld-Reihenfolge, siehe Tools) — vermeidet den Accuracy-Drop bei erzwungen strukturierter Ausgabe.
8. **Confidence-Scoring + gezielte Retries** bei niedrigem Vertrauen (kann Agenten-Fehlerraten um bis zu ~50 % senken) ([Cleanlab / tau2-bench](https://cleanlab.ai/blog/tau-bench/)).
9. **Append-only Audit + Signierung:** Eintraege sind nicht unbemerkt nachtraeglich editierbar; das schuetzt die "pruefbare" DB auch gegen Tool-Poisoning/Prompt-Injection aus eingelesenen Quellinhalten — Quellinhalte werden strikt als *Daten, nie als Instruktion* behandelt ([State of MCP Security 2026](https://nimblebrain.ai/blog/state-of-mcp-security-2026/)).

---

## Verifikations-Layer — der Re-Verification-Pass (Kernfeature)

Dies ist das sicherheitskritische Herz der Idee: der Pass, in dem eine Quelle **erneut angeschaut** und die daraus abgeleitete Aussage **eigenständig bewertet** wird. Er verwandelt die Research von einer Blackbox in ein prüfbares Artefakt. Zentrale Design-Anforderung: Er muss funktionieren, **ohne dass das Produkt selbst ein eigenes LLM betreibt** — sonst bräche er die Grundprämisse (bring-your-own-AI: du recherchierst mit Claude Desktop / einem beliebigen Client via MCP und baust die KI-Ebene nicht selbst).

Das gelingt über zwei Einsichten:

**Einsicht 1 — der wertvollste Teil braucht *gar kein* Modell.** Der häufigste und schädlichste Fehlermodus sind fabrizierte Quellen und Zitate (dokumentierte Fabrikationsraten 14–95 %, [JMIR 2024](https://www.jmir.org/2024/1/e53164)). Diese fängt man **rein deterministisch, mit Code**: URL/DOI gegen Crossref/OpenAlex/PubMed auflösen (tote Links, erfundene DOIs) und **Quote-in-Source-Check** — die Quelle neu fetchen und prüfen, ob das `verbatim_quote` wörtlich (bzw. fuzzy) im Text steht (erfundene/verdrehte Zitate). Kein Modell, kein API-Key, keine Kosten. Nur der *semantische* Rest ("stützt dieser Beleg die Aussage inhaltlich?") braucht Intelligenz.

**Einsicht 2 — der semantische Teil braucht keinen anderen *Modell*, nur einen anderen *Kontext*.** Das Problem naiver Selbstbewertung ist nicht "falsches Modell", sondern dass das Modell seine eigene vorherige Antwort im Kontext sieht und sie **rationalisiert/verteidigt** (KI-Begründungen sind bis zu 57 % nachträglich rationalisiert, [Correctness is not Faithfulness](https://arxiv.org/abs/2412.18004)). Nimmt man diesen Kontext weg, verschwindet der Effekt größtenteils — und ein frischer Kontext ist **gratis**: eine **neue Chat-Session gegen denselben MCP-Server**, deren einzige Aufgabe Verifikation ist. Der manuelle Trigger ("muss man anstoßen, ist Teil des Tools") ist genau das: eine Verify-Session starten. Das entspricht Anthropics separatem CitationAgent-Pass — ein *separater Durchgang*, kein zwingend anderes Modell ([Anthropic Multi-Agent Research](https://theaiengineer.substack.com/p/how-anthropic-built-multi-agent-deep)).

### Die Verifikations-Leiter

| Ebene | Wer/Was | Eigenes Modell nötig? | Rolle |
|---|---|---|---|
| **1 · Deterministisch** | App-Code: URL/DOI-Auflösung, Quote-in-Source | **Nein** | Kern, immer an — fängt Fabrikationen |
| **2 · Cross-Context-KI** | mitgebrachte KI, **frische Verify-Session**, geblindet & adversarial, selber MCP | **Nein** | Kern des Passes — semantische Prüfung (Entailment) |
| **3 · Cross-Client** | Verify in einem *anderen* Client als recherchiert wurde (z. B. Claude recherchiert, ChatGPT verifiziert) | Nein (Nutzer-Abos) | optionale Härtung — unkorrelierte Blind Spots |
| **4 · Auto-Verifier** | opt-in: **lokales Modell (Ollama)** oder eigener API-Key, unbeaufsichtigt | ja, aber opt-in & local-first möglich | Komfort/Automatisierung ohne zweite Session |
| **5 · Mensch-Sign-off** | der Nutzer | — | letzte Instanz, immer verpflichtend |

**Ebenen 1–3 lösen das Setup vollständig, ohne dass das Produkt je ein eigenes Modell betreibt.** Ebene 4 ist reiner Komfort und bleibt mit einem lokalen Ollama-Modell local-first (kein erzwungener Cloud-Key).

### Wie der Server das erzwingt (Blinding-Flow)

Der Server — nicht die chattende KI — kontrolliert, *was* die Verify-Session sieht, und erzeugt so die "frischen Augen":

1. Verify-Session ruft `get_next_unverified_claim(project_id)` → Server liefert `claim`/`extraction` + **frisch neu gefetchten** Quelltext (mit `source_snapshot_hash`), **ohne** das ursprüngliche `reason`/`contribution`.
2. Die Session ist adversarial instruiert: *"Versuche zu widerlegen, dass dieser Beleg die Aussage stützt. Im Zweifel: `unsupported`."* Standardannahme = nicht belegt.
3. Sie ruft `submit_verdict(...)` → Server schreibt eine **neue Review-Kante** (`reviewer_type = ai_judge`, mit Modell-/Session-Provenienz und `evidence_span`), **überschreibt nie** das Original. Bei `source_unreachable` oder gescheitertem Quote-Check wird der Eintrag hart geflaggt.
4. Für heikle Aussagen: 2–3 Judge-Stimmen (Mehrheit) statt einer.

### Ehrliche Grenzen

- Cross-Context (Ebene 2) entfernt das Anchoring, aber dieselbe Modellfamilie hat **korrelierte blinde Flecken** → für akademische Rigorosität ist Ebene 3 (anderer Anbieter) stärker.
- Automatische Verifier erreichen nur ~78 % F1 ([AttributionBench](https://osu-nlp-group.github.io/AttributionBench/)) — sie **priorisieren**, was der Mensch prüft, sie ersetzen ihn nicht. Der Sign-off (Ebene 5) bleibt das Gate.
- Der Pass ist ein **Filter, kein Beweis** — genau deshalb wird jedes Urteil mit Konfidenz, Beleg-Span und Provenienz gespeichert und ist selbst wieder prüfbar.

---

## Offene technische Entscheidungen

- **Multi-Client-Auth am lokalen Endpoint:** Wie authentifiziert/autorisiert man mehrere gleichberechtigte KI-Clients gegen dasselbe lokale Projekt (Per-Client-Token, Handshake, Rechte pro Client)? Der MCP-Auth-Stack (OAuth 2.1) ist primaer fuer Remote/Enterprise gedacht; fuer localhost braucht es eine leichtere, aber saubere Loesung. Zu klaeren auch: Welche Clients erlauben aktuell praktisch das gleichzeitige Andocken an denselben lokalen Streamable-HTTP-Server?
- **ChatGPT-Pfad:** Muss der `mcp-remote`-Bridge/Tunnel-Pfad (nebst Auth) fest mitgeliefert werden, oder bleibt ChatGPT ein optionales Feature? (ChatGPT bindet nur Remote-HTTPS an, kein lokales stdio.)
- **Versionierungs-Backbone:** reines Event-Sourcing (max. Auditierbarkeit, mehr Komplexitaet) vs. Snapshot + JSON-Patch (RFC6902, einfacher) vs. Automerge/CRDT (nur bei echtem parallelem Mensch+KI-Editing). Fuer eine primaer lokale Single-User-App mit gelegentlichem Review ist voraussichtlich Event-Log + Snapshots + JSON-Patch ausreichend; Automerge waere Overkill.
- **Electron vs. Tauri final:** Ein kleiner Prototyp-Vergleich (Bundle-Groesse/Build-Aufwand vs. In-process-Einfachheit) vor Fixierung ist sinnvoll, auch wenn die Empfehlung klar auf Electron zeigt.
- **Verifier-Tiefe & Default-Ebene pro Modus:** Die Verifikations-Leiter (siehe *Verifikations-Layer*) ist gesetzt — offen ist die Default-Tiefe je Modus: Genügt im Business-Modus Ebene 1+2 (deterministisch + Cross-Context), während der akademische Modus Ebene 3 (Cross-Client) oder einen stärkeren claim-level-Verifier (CiteGuard-artig, retrieval-gestützt) inkl. optionaler kontrafaktischer Faithfulness-Checks erzwingt? Und: Wird der Auto-Verifier (Ebene 4) mit lokalem Ollama-Modell mitgeliefert oder rein als Bring-your-own-Key konfiguriert?
- **Spec-Migration:** Wann/ob auf den 2026-07-28-RC (stateless, Wegfall Handshake/Session, Deprecation von Sampling/Roots/Logging) migriert wird — bis dahin bleibt 2025-11-25 der produktive De-facto-Standard, und keine Kernfunktion darf auf Sampling/Elicitation aufsetzen.
- **Verlustfreier Provenance-Graph im Markdown:** Wie bildet man `Projekt → Quelle → Extrakt → Beitrag → Berichtsabschnitt` verlustfrei UND stabil zitierbar (Hash) in portablem Markdown ab, sodass der Anhang app-unabhaengig pruefbar bleibt (RO-Crate als maschinenlesbare Ergaenzung)?---

## Phasierter Umsetzungsplan

> **Gate zuerst:** Vor Phase 1 steht zwingend die De-Risking-Phase aus [03 Next Steps](03-next-steps.md). Gebaut wird erst, wenn die **kritische Kernannahme (Spike 1)** empirisch bestätigt ist. Alle Zeitangaben sind grobe Richtwerte für **eine erfahrene TS/Node-Person** und dienen der Reihenfolge, nicht der Verbindlichkeit.

### Phase 0 — De-Risking (1–3 Wochen) · GATE
Kein UI-Bau. Ziel: die Kernannahme messen (siehe [03](03-next-steps.md), Spikes 1–5). Ergebnis: belegte Zahlen zur faktischen Deckung + **Go/No-Go**.

### Phase 1 — MCP-Kern + Enforcement (MVP-Fundament) · ~3–5 Wochen
- `@modelcontextprotocol/sdk` (v1), **Streamable HTTP auf `127.0.0.1`**, Session-Map nach `mcp-session-id`, DNS-Rebinding-Schutz + Per-Client-Token.
- Minimaler Tool-Satz: `create_project`, `add_source`, `get_project_state`.
- **Enforcement-Layer:** Zod-Schema-Validierung, Pflichtfelder (`reason`/`extraction`/`contribution`/`verbatim_quote`), **Quote-in-Source-Check** (Server fetcht Quelle, prüft Exzerpt), URL-/DOI-Auflösung gegen Crossref/OpenAlex.
- `better-sqlite3` + Kern-Tabellen + append-only `event_log`.
- **Ziel:** Claude Desktop/Code kann in ein Projekt schreiben; jede Quelle trägt Pflicht-Provenienz + verifizierten Quote-Status.

### Phase 2 — Verifier + Review-UI (der Kern-Value) · ~4–6 Wochen
- Automatischer **NLI/LLM-Judge-Verifier** je `claim_source_link`; Confidence-Scoring + gezielte Retries.
- **Review-UI** (Renderer): Quellenliste mit Status (`pending` → `ai_checked` → `human_signed`), Human-Sign-off, Flag-Ansicht.
- Weitere Tools: `flag_uncertainty`, `request_review`, `log_extraction`, `link_claim_to_source`.
- **Ziel:** Mensch reviewt effizient nur die geflaggten Einträge; Status-Übergänge sind sichtbar und erzwungen.

### Phase 3 — Versionierung, Chat-Protokoll & Berichte · ~3–4 Wochen
- `add_report_version` (unveränderliche Snapshots mit stabiler Hash-ID), `add_chat_log`.
- Report-Editor mit Inline-Markern `[S3 ¶2]`, Versions-Diff.
- FTS5-Volltextsuche über Quellen/Claims/Berichte.
- **Ziel:** vollständiges, versioniertes Projekt inkl. Reasoning-/Chat-Protokoll.

### Phase 4 — Export & akademische Anschlussfähigkeit · ~2–3 Wochen
- **Markdown-Export** (zitierbares Artefakt, Snapshot-Hash im Header).
- **RO-Crate (JSON-LD)** Export; DOI-Hinterlegung (Zenodo/OSF-Sandbox) testen.
- Policy-Presets (ICMJE / PRISMA-S / COPE / DFG).
- **Ziel:** ein Anhang, den Gutachter prüfen und Repositorien als Beleg akzeptieren.

### Phase 5 — Zwei-Segment-Ausbau · laufend
- **Business/Compliance:** EU-AI-Act-Logging-Report (Art. 12), Audit-Export, lokale/EU-Modell-Option, on-prem-Variante.
- **Academia:** PRISMA-Workflow, Bibliotheks-/FTE-Lizenzierung.
- **ChatGPT-Pfad:** `mcp-remote`-Bridge + OAuth 2.1 (optional, da ChatGPT nur Remote-HTTPS anbindet).

---

## Tech-Stack (Zusammenfassung)

| Layer | Wahl | Begründung (Kurz) |
|---|---|---|
| Shell | **Electron** | Node-Runtime in-process → MCP-Server + native SQLite ohne Sidecar/Sprachwechsel |
| MCP | `@modelcontextprotocol/sdk` v1, **Streamable HTTP** `127.0.0.1` | Multi-Client-fähig, clientübergreifend, stabil |
| DB | **better-sqlite3 + FTS5** | synchron, schnell, Volltextsuche gebündelt (`node:sqlite` hat kein FTS5) |
| ORM | **Drizzle** (SQL-nah) | schlank; FTS5-Tabellen + Trigger via handgeschriebene Migrationen |
| Validierung | **Zod** (strict JSON-Schema) | erzwingt Struktur an jedem Schreib-Tool |
| Verifikation | **NLI / LLM-Judge** | flaggt faktische Deckung Aussage↔Quote↔Quelle |
| Export | **Markdown + RO-Crate (JSON-LD)** | portabel **und** standardkonform zitierbar |

## Aufwands-Grobschätzung

Bis zu einem *nutzbaren* MVP (Phase 1–2) rechnet man für **eine erfahrene TS/Node-Person** grob mit **~2–3 Monaten**; ein vollständiges, akademisch anschlussfähiges Produkt (bis Phase 4) eher **~5–7 Monate**. *Caveat:* Schätzung ohne Detail-Scoping — der Verifier (Phase 2) und die Export-Standard-Konformität (Phase 4) sind die aufwands-unsichersten Blöcke.



---

## Methodik & Belege

Grundlage dieses Dokuments ist eine Multi-Agenten-Deep-Research vom 2026-07-24: **24 Agenten**, ~1,34 Mio Tokens, 318 Web-/Tool-Aufrufe. Ablauf: 10 parallele Recherche-Agenten (je ein Blickwinkel: MCP-Protokoll, Tool-Call-Zuverlässigkeit, Quellen-Attribution, akademische Tools, Deep-Research-Tools, Provenance/MCP-Server, akademische Standards, Markt, Architektur, Failure-Modes) → adversariale Verifikation pro Blickwinkel → 4 Synthese-Agenten. Die Inline-Links verweisen auf die Primärquellen. Trotz Verifikation gilt: KI-gestützte Research ist nicht fehlerfrei — entscheidungskritische Zahlen vor verbindlichen Schritten gegenprüfen.
