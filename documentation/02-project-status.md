# 02 · Projekt-Status

> Wo das Projekt steht: fixierte Entscheidungen, Kern-Erkenntnisse der Research, Machbarkeits-Urteil und Risiko-Register.

|  |  |
|---|---|
| **Projekt** | Research Overview Platform |
| **Dokument** | 02 — Projekt-Status |
| **Stand** | 2026-07-31 · v2.1 |
| **Phase** | Gebauter Prototyp mit zwei Betriebsmodi — Kernannahme empirisch noch ungetestet |

**Dokument-Set:** [01 Implementationplan](01-implementationplan.md) · [02 Projekt-Status](02-project-status.md) · [03 Next Steps](03-next-steps.md) · [04 Feasibility](04-feasability.md) · [05 Markt-Research](05-market-research.md) · [06 Eigene Research-Engine](06-eigene-research-engine.md) · [07 KI-Clients](07-clients.md)

---

## Stand 2026-07-30 — was seit dem MVP dazugekommen ist

Der MVP vom 24.07. erzwang **Korrektheit** (Pflichtfelder + Zitat-Prüfung). Seither sind drei Dinge dazugekommen, die das Produkt qualitativ verändern:

**1. Recherchetiefe ist messbar und erzwingbar geworden.** Teilfragen (`plan_research`), eine **serverseitig berechnete** Lückenliste (`get_coverage_gaps`) und Sättigungsmessung je Runde (`next_round`). Das Abbruchkriterium liegt damit nicht mehr beim Modell — ein Test hält fest, dass die Behauptung *„Ich bin fertig, alles ist bestens belegt"* die Lücke nicht schließt. `add_report_version` lehnt ab, solange blockierende Lücken offen sind; eine bewusste Quittierung landet unlöschbar im Prüfpfad.

**2. Zitate sind unfälschbar statt nur prüfbar.** `fetch_source` ruft Quellen selbst ab und speichert den Text; `add_source` nimmt `{document_id, quote_start, quote_end}` und **der Server schneidet das Zitat heraus**. Das Modell kann kein Zitat mehr erfinden — nur auf vorhandenen Text zeigen. Ein erfundenes Zitat zu echten Offsets wird abgewiesen (im E2E-Test belegt). Das adressiert den gefährlichsten Befund aus [04 Feasibility](04-feasability.md) (faktische Deckung 39–77 %) **strukturell** statt nachträglich.

**3. Zweiter Betriebsmodus: die eingebaute Engine.** Provider-Abstraktion mit Ollama-Adapter (lokal *und* Cloud über denselben Daemon), In-Process-MCP-Bridge, Agenten-Schleife mit Planung → Runden → Sättigung → Synthese. Dieselben Werkzeuge, dasselbe Enforcement wie im MCP-Modus — eine Definition, kein zweiter Pflegepfad.

Dazu: **`search_literature`** (OpenAlex, Crossref, Europe PMC, arXiv parallel, DOI-Zusammenführung, PRISMA-S-Protokollierung inklusive) und eine UI, die Abdeckung, Lücken, Runden und die **Belegstelle im Originaltext** sichtbar macht.

### Nachtrag 2026-07-31 — Fehlerdarstellung und Auto-Mode-Härtung

**4. Fehler tragen sich selbst.** Anlass war ein Befund aus [07 KI-Clients](07-clients.md): Nur drei von 20 geprüften Clients werten das MCP-Feld `isError` aus. In den übrigen 17 landet der Antworttext im Verlauf wie jedes andere Werkzeugergebnis — ununterscheidbar von einem Erfolg. Jede Fehlerantwort beginnt jetzt mit einem `status`-Feld, das das Wort FEHLER enthält, und trägt statt eines `hint` eine `next_action` im Imperativ. Der Hinweis ist **Pflichtparameter** von `ServiceError` — der Compiler erzwingt ihn über alle 26 Fehlerstellen, weil eine Konvention das nicht durchhält.

Beim Nachmessen fielen dabei zwei Löcher auf, die keine Annahme vorhergesagt hatte:

- **Schema-Verstöße erreichten die eigenen Handler nie.** Das SDK validiert die Argumente vor dem Aufruf und verwandelt den Fehler selbst in ein Werkzeugergebnis — roher englischer Protokolltext mit einem Wall aus Zod-JSON. Ausgerechnet die **häufigste** Fehlerklasse war damit die einzige ohne Handlungsanweisung. Jetzt übersetzt, eingedampft und auf Deutsch. Der Ansatzpunkt im SDK ist `private`; deshalb scheitert der Server **laut**, wenn er verschwindet — die Lehre aus dem Rebinding-Fehler.
- **`add_source` meldete einen durchgefallenen Beleg in einer Antwort ohne `isError`.** Der Eintrag wird ja gespeichert, es ist kein Werkzeugfehler — nur zählt er nicht zur Abdeckung und blockiert den Bericht. Das stand bisher als freundlicher `hint` hinter `stored: true`. Jetzt steht der Befund als erstes Feld und schreit.

**5. Der Auto-Mode ist gegen Langlauf-Realität gehärtet.** Zwei Eigenschaften, die ein Vierstundenlauf braucht:

- **Quota-Guard vor jedem Spawn.** Ein erschöpftes Kontingent beendet den Lauf sofort. Vorher wurde es je Teilfrage und je Runde erneut angerannt — bei sechs Teilfragen über vier Runden bis zu 24-mal gegen einen Dienst, der bereits Nein gesagt hat (im Test nachgestellt: vier Versuche statt einem). Dazu ein Token-Budget für den **gesamten** Lauf statt nur je Aufruf, mit einer Reserve, die der Synthese vorbehalten bleibt — sonst endet ein knapp budgetierter Lauf im schlechtesten Zustand: Quellen erfasst, kein Bericht geschrieben.
- **Checkpoint/Resume.** Die neue Tabelle `engine_runs` hält fest, wo ein Lauf steht. Ein Datensatz, der beim App-Start noch auf `running` steht, kann keinen lebenden Prozess mehr haben — er wird als `interrupted` geheilt und damit fortsetzbar. Beim Fortsetzen bekommt das Modell zuerst die Quellen genannt, die der Vorlauf zwischen `fetch_source` und `add_source` liegen ließ; sonst läuft es blind in die Abruf-Sperre.

### Zahlen zum Stand

| | 2026-07-24 | 2026-07-30 | 2026-07-31 |
|---|---|---|---|
| MCP-Tools | 13 | **26** (inkl. 4 Prompt-Spiegel für Clients ohne Prompt-Ausführung) | 26 |
| Tests | 17 | 123 | **149** |
| Schema-Version | v2 | v4 | **v5** |
| Betriebsmodi | MCP (Fremdclient) | MCP **+ eingebaute Engine** | 2 |

### Drei Befunde, die Annahmen widerlegt haben

- **Der DNS-Rebinding-Schutz war seit einem SDK-Update wirkungslos.** Bis SDK 1.24 lagen `enableDnsRebindingProtection`/`allowedHosts` im Transport; seit 1.25 sind sie entfernt und werden **stillschweigend ignoriert** — kein Fehler, keine Warnung, nur kein Schutz. Jetzt über die Express-Middleware `hostHeaderValidation`, mit sechs Tests abgesichert.
- **Die Migration war nicht mehrprozess-sicher.** `BEGIN DEFERRED` ließ 26 von 60 gleichzeitig startenden Prozessen mit `SQLITE_BUSY_SNAPSHOT` abbrechen — ein Fehlerbild, für das der Busy-Handler per Definition nicht greift. Jetzt `BEGIN IMMEDIATE` mit Re-Check; gemessen 20/20 erfolgreich.
- **Ein erschöpftes Kontingent beendete den Lauf nicht** (2026-07-31, siehe oben). Aufgefallen, weil der Test zuerst geschrieben wurde: Er erwartete einen Versuch und zählte vier.

### Was weiterhin fehlt

**Die Kernannahme ist unverändert ungetestet.** Alles Gebaute ist gegen Fixtures und ein skriptbares Fake-Modell verifiziert — **nie gegen ein echtes Modell in einer echten Recherche**. Das ist der eine offene Punkt, an dem das Projekt hängt (siehe [03 Next Steps](03-next-steps.md)).

---

## Kurzfazit (Stand 2026-07-24, historisch)

**Update 2026-07-24 (Abend): Der MVP ist gebaut und läuft.** Auf Wunsch des Auftraggebers wurde direkt mit der Implementierung begonnen (statt der ursprünglich geplanten Spike-Phase — die De-Risking-Experimente wurden, wo möglich, in den Bau integriert und automatisiert). Die grundlegende technische Machbarkeit ist damit nicht mehr nur research-basiert bestätigt, sondern **empirisch belegt**: Der komplette Provenienz-Flow inkl. Schema-Zwang, sofortiger Beleg-Verifikation, Fabrikations-Erkennung, geblindetem Re-Verify-Pass und Multi-Client-Concurrency läuft grün im End-to-End-Test.

### Was existiert (Stand heute)

- **Electron-App** (React + Tailwind v4 + Material Symbols, helle UI): Projekt-Sidebar, Übersicht mit Verifikations-Leiter, Quellen-Review mit Detail-Drawer + menschlichem Sign-off, Aussagen/Belegkanten, unveränderliche Berichtsversionen, Chat-Protokoll, Audit-Trail, MCP-Einstellungen, Demo-Seed, Markdown-Export.
- **Eingebauter MCP-Server** mit **13 Tools** (Streamable HTTP auf `127.0.0.1`, Multi-Client-Session-Map, DNS-Rebinding-Schutz; zusätzlich stdio-Entry für Claude Desktop) — inkl. der drei Verifikations-Tools `re_verify` / `get_next_unverified_claim` (geblindet) / `submit_verdict`.
- **Enforcement-Layer (Verifikations-Ebene 1):** `add_source` erzwingt reason/extraction/contribution/verbatim_quote per Zod-Schema und prüft **sofort** URL-Erreichbarkeit + Quote-in-Source (exakt/normalisiert/fuzzy via Dice-Bigrammen) gegen den frisch gefetchten Quelltext — Ergebnis geht als Korrektur-Feedback an die KI zurück.
- **SQLite-Source-of-Truth** (WAL, FTS5-Volltextsuche, append-only `event_log`), geteilt zwischen App und stdio-Prozess.

### Verifiziert (2026-07-24)

| Check | Ergebnis |
|---|---|
| TypeScript strict (beide Configs) | ✅ grün (2,2 s) |
| Unit-Tests (Textmatch, Repo) | ✅ 17/17 |
| E2E-Smoke: Schema-Zwang (Quelle ohne Beleg abgelehnt) | ✅ |
| E2E-Smoke: echtes Zitat verifiziert / **fabriziertes Zitat erkannt** | ✅ |
| E2E-Smoke: Blinding (Verify-Session sieht nie reason/contribution) | ✅ |
| E2E-Smoke: kein MCP-Pfad kann `human_signed` setzen | ✅ |
| **Spike 4** Multi-Client-Concurrency (2 Clients × 10 Quellen parallel) | ✅ 20/20, 0 Verluste, beide Identitäten im Audit-Trail |
| **Spike 5** (teilweise) Markdown-Provenienz-Export | ✅ implementiert (RO-Crate noch offen) |
| Electron-App bootet (OS-Sandbox aktiv), MCP-`initialize`-Handshake über HTTP | ✅ |
| stdio-Server unter Electron-ABI (Multi-Prozess-WAL-Setup) | ✅ |
| SSRF-Schutz (private IPs/localhost/Cloud-Metadata geblockt, pro Redirect-Hop) | ✅ Negativtests grün |
| Blinding-Audit: Urteile ohne Serving-Nonce ehrlich als `ai_judge_unblinded` markiert | ✅ |

**Multi-Agenten-Code-Review (36 Agenten, 5 Dimensionen, adversarial verifiziert):** 31 Findings gemeldet → 28 bestätigt, 2 widerlegt, 1 plausibel. **Alle 29 relevanten wurden behoben**, darunter: SSRF im Quell-Fetcher (critical), Markdown-Injection in den Provenienz-Export, Umgehbarkeit des Blinding-Labels (jetzt Nonce-basiert ehrlich auditiert), stdio-ABI-Konflikt (jetzt Electron-as-Node), Main-Thread-Blockade beim Fuzzy-Matching (bounded Scan), fehlende Transaktionen beim Sign-off, Cross-Projekt-Belegkanten, Session-Leaks, sowie ein Dutzend UI-Korrektheits- und A11y-Fixes. Zusätzlich selbst gefunden & behoben: Tailwind-v4-Syntaxfehler, der alle Akzentfarben unsichtbar gemacht hätte. Nach den Fixes: kompletter Regressions-Lauf erneut grün (Typecheck, 17 Unit-Tests, verschärfter E2E-Smoke mit 23 Checks, Build, App-Boot).

Noch offen aus dem ursprünglichen Spike-Plan: **Spike 1–3 mit echten Frontier-Modellen** (Attributions-Benchmark, Reasoning-vor-Struktur, Verifier-Recall) — dafür ist jetzt die komplette Infrastruktur vorhanden; es fehlt nur noch das Durchführen mit echten KI-Sessions (siehe [03 Next Steps](03-next-steps.md)).

## Fixierte Entscheidungen

| Thema | Entscheidung | Kurz-Begründung |
|---|---|---|
| Zielgruppe | Akademisch **und** Marketing/Business | Beide leiden am selben Transparenz-Defizit; breitere Marktbasis |
| Produktform | Hybrid-App + eingebauter MCP-Server | UI liefert Review/Versionierung; MCP macht „jede KI andockbar" |
| Tech-Stack | TypeScript / Node | Beste MCP-SDK-Reife + ein Stack für Server und UI |
| Speicher | SQLite (Source-of-Truth) + Markdown-Export | Abfragbar **und** portabel/anhängbar |

## Kern-Erkenntnisse der Research

### Frage 1 — Machbarkeit: **Ja, unter Bedingungen**

| Ampel | Aspekt | Befund |
|---|---|---|
| 🟢 | **Mechanik** (schema-konformes Eintragen per MCP-Tool) | Gelöst — ~100 % Schema-Compliance via Constrained Decoding; schlanker Tool-Satz + flaches Schema = günstigster Fall |
| 🟡 | **Inhaltliche Vertrauenswürdigkeit** (stimmt Quelle/Extraktion/Begründung) | Nur mit Verifikations- + Review-Layer brauchbar. Roh: faktische Deckung **39–77 %**, sinkt mit Recherchetiefe; Begründungen bis **57 %** nachträglich rationalisiert |
| 🔴 | **Review-freies „fertige Wahrheit"** | Mit heutiger KI nicht einlösbar — würde Fehler direkt in die „prüfbare" DB schreiben |

Vollständige Analyse inkl. Gegenmaßnahmen: **[04 Feasibility](04-feasability.md)**.

### Frage 2 — Existiert das schon: **Nein — kein Produkt vereint alle 5 Bausteine**

Kein Tool kombiniert (1) offenen eingebauten MCP-Server + (2) strukturiertes Pro-Quelle-Bewertungslog + (3) Versionierung inkl. Chat-Protokoll + (4) Mensch-**und**-KI-Review + (5) portablen, zitierbaren Anhang-Export. Quellen-*Transparenz* (Inline-Zitate) ist 2026 Commodity; die **Provenance-/Review-/Versionierungs-/Anhang-Schicht ist die verteidigbare Lücke** — die Forschung („Inspectable AI for Science", „Auditable Autonomous Research") benennt exakt dieses Datenmodell als offenen Bedarf. Am nächsten kommen jeweils *Teillösungen* (Zotero-MCP, Elicit, Perplexity Spaces, Claude Research). Vollständige Wettbewerbsanalyse: **[05 Markt-Research](05-market-research.md)**.

### Frage 3 — Probleme & Lösungen

Die drei gefährlichsten Probleme und ihr jeweiliger Hebel:

1. **Halluzinierte/inhaltlich falsche Einträge** → erzwungene wörtliche Exzerpte aus gefetchtem Text + automatischer Verifier + Pflicht-Mensch-Sign-off.
2. **Unfaithful Begründungen** („warum diese Quelle" ist post-hoc rationalisiert) → Begründung als *zu verifizierende Behauptung* modellieren, nie als Wahrheit.
3. **Prompt-Injection über eingelesene Quellen** → Quellinhalte strikt als Daten (nie Instruktion) behandeln, append-only Audit-Log.

Das vollständige, priorisierte **Risiko-Register** folgt direkt unten; die Gegen-Experimente stehen in [03](03-next-steps.md).

## Risiko-Register

| Risiko | Auswirkung | Wahrscheinlichkeit | Gegenmassnahme |
|---|---|---|---|
| **KI traegt inhaltlich falsche/halluzinierte Quellen-Bewertungen ein** (warum/Extraktion/Beitrag). Structured Output garantiert nur die Struktur, nicht die semantische Korrektheit; faktische Deckung liegt selbst bei Frontier-Modellen nur bei 39-77% und sinkt mit Recherchetiefe ([arXiv 2605.06635](https://arxiv.org/abs/2605.06635)) | Kernversprechen "pruefbare Research" bricht; Nutzervertrauen und akademische Akzeptanz entfallen | **H** | Retrieval-Zwang (nur tatsaechlich gefetchte Quellen), Pflichtfeld verbatim Quote-Span + Quellen-ID, NLI/LLM-Judge-Verifier (Zitat gegen Quelltext), verpflichtender Mensch-Sign-off pro Quelle. Verifier selbst nur ~78% F1 ([AttributionBench](https://osu-nlp-group.github.io/AttributionBench/)) - daher Human-in-the-loop nicht wegautomatisieren |
| **KI-Selbstauskunft ("warum diese Quelle") ist unfaithful** - bis zu 57% korrekter Zitate sind post-hoc rationalisiert, nicht kausal genutzt ([arXiv 2412.18004](https://arxiv.org/abs/2412.18004)); CoT zertifiziert Korrektheit nicht | Begruendungsfelder und Chat-Protokoll wirken belastbar, sind es aber nicht - falsche Sicherheit | **H** | Begruendung als *zu verifizierende Behauptung* modellieren, nicht als Wahrheit. Optionale kontrafaktische Checks (Quelle entfernen, prueft sich die Aussage aendert). UI erzwingt Verifikationsstatus/Confidence pro Kante |
| **Format-Zwang senkt Reasoning-Qualitaet** (dokumentierter Drop ~10-15 pp, bei unguestandigem Schema mehr; "answer-vor-reason"-Effekt, [arXiv 2408.02442](https://arxiv.org/abs/2408.02442)) | Erzwungenes JSON verschlechtert genau die inhaltliche Bewertung, die das Produkt verkauft | **M** | Reasoning (Freitext-Begruendung) und Formatierung (schema-konformes Eintragen) trennen: erst begruenden lassen, dann separat validiert strukturieren. Begruendungsfelder im Schema VOR dem Bewertungsfeld anordnen. Flache, einfache Schemata (JSONSchemaBench: 96% simpel vs. 30% komplex) |
| **Prompt-Injection / Tool-Poisoning ueber eingelesene Web-Quellen** - genau das Einlesen manipulierter Quellen ist der Kernzweck (dokumentierte Angriffe, CVE-2025-54136; mcp-remote CVE-2025-6514, CVSS 9.6) | Manipulierte Quelle laesst KI falsche/boesartige Eintraege schreiben oder Daten exfiltrieren; kompromittiert die "pruefbare" DB | **M** | Quellinhalte strikt als *nur Daten, nie Instruktion* behandeln (Datentrennung/Markierung), Input-/Schema-Validierung, Sandboxing, Append-only-/tamper-evident-Log, ggf. Gateway/LLM-Judge, OAuth 2.1. Injection-Abwehr als Kernthema, nicht Add-on |
| **ChatGPT bindet nur Remote-HTTPS-Server an, kein lokales stdio** - eine reine lokale Desktop-App erreicht ChatGPT-Nutzer nicht | "Jede KI andockbar" gilt de facto nicht fuer ChatGPT ohne Hosting/Tunnel | **M** | App liefert sowohl lokalen stdio- als auch lokalen/remote Streamable-HTTP-Pfad (127.0.0.1) inkl. Auth (Per-Client-Token, OAuth 2.1) und optionalem Hosting-/mcp-remote-Bridge-Pfad |
| **MCP-Spezifikation ist bewegliches Ziel** - RC 2026-07-28 bringt stateless-Umbau (Wegfall Handshake/Session), deprecatiert roots/sampling/logging ([MCP Blog](https://blog.modelcontextprotocol.io/posts/2026-07-28-release-candidate/)) | Laufender Anpassungsaufwand; auf Sampling gebaute Features veralten | **M** | Auf stabiler Spec 2025-11-25 + TS-SDK v1 bauen, keine Kernfunktion auf Sampling/Elicitation stuetzen (Quellenerfassung ueber Tools + Server-Validierung). v2-Beta beobachten (v1 >=6 Monate Fixes) |
| **Zuverlaessigkeit kollabiert bei vielen Tools / langer Session** (pass^8 faellt bei GPT-4o Retail von ~60% auf ~25%; ~740 Tools nur 0-20%; Fact-Check -42% von 2->150 Tool-Calls) | Grosse Projekte (30-50 Quellen in einer Session) werden inkonsistent erfasst | **M** | Minimaler Tool-Satz (add_source/update_source/get_project), Chunking/Checkpointing pro Quelle, Reviewer-Gates alle N Quellen, Confidence-Scoring + gezielte Retries (bis ~50% Fehlerreduktion, [Cleanlab](https://cleanlab.ai/blog/tau-bench/)) |
| **Native-Addon/Build-Komplexitaet** (better-sqlite3 fuer FTS5 muss je Electron-Upgrade via @electron/rebuild neu gebaut werden; node:sqlite hat kein FTS5; FTS5-Virtual-Tables von Drizzle/Prisma nicht nativ modelliert) | Verzoegerungen, Packaging-Bugs, kaputte Volltextsuche bei Upgrades | **M** | better-sqlite3 fixieren, Rebuild in CI/Packaging aufnehmen; FTS5-Tabellen + Sync-Trigger in handgeschriebenen SQL-Migrationen, aus Auto-Diff ausklammern. Electron (Node in-process) statt Tauri-Sidecar, wenn Build-Einfachheit Prioritaet hat |
| **Markt: Quellen-Transparenz ist bereits Commodity** - Elicit (Satz-Zitate, PRISMA), Consensus/Scite betreiben eigene MCP-Server; reine Suche/Discovery kommodifiziert (ResearchRabbit->Litmaps) | Kein Differenzierer, Preiskampf im 8-50 USD-Band der Academia | **M** | Positionierung als *Provenienz-/Review-/Versionierungs-Layer*, nicht als "noch ein MCP-Suchtool". Verteidigbares Bundle: Pro-Quelle-Begruendung + Versionierung + Chat-Protokoll + Mensch/KI-Review + offener MCP + local-first als Audit-Artefakt |
| **Adoption: Academia preissensitiv, lange Beschaffungszyklen** - Einzelforscher zahlen ungern, Kaufkanal sind institutionelle FTE-Lizenzen ([arXiv 2508.00952](https://arxiv.org/pdf/2508.00952)) | Schwacher ARPU im akademischen Kern, langsame Umsatzkurve | **M** | Zweigleisig: Freemium/guenstig akademisch fuer Sichtbarkeit + Site-License (FTE); Umsatz-Schwerpunkt Enterprise/Business (ChatGPT Enterprise real ~45-75 USD/Sitz fuer Governance/Compliance) |
| **Akademische Akzeptanz des Export-Artefakts ungeklaert** - Journals/Betreuer akzeptieren KI-Provenienz-Anhang evtl. nicht als zitierbaren Beleg; KI-Chats sind selbst keine abrufbare Quelle (APA "record of use") | "Anhaengbar an Arbeiten" loest kein reales Bedurfnis ein | **M** | An etablierte Standards andocken statt Eigenformat: RO-Crate-konformer Export (JSON-LD/FAIR), DOI-Hinterlegung (Zenodo/OSF), PRISMA-S-Suchdokumentation, TOP-Level-2/3. Prompt+Output als empfohlener Beweisanhang |
| **Rechtlich/Compliance: fabrizierte Zitate real sanktioniert** (200+ Gerichtsfaelle, Strafen bis 95k USD, inkl. Claude-Fall; Springer-Nature-Buch zurueckgezogen) | Produktversprechen "Null-Halluzination" waere haftungsrelevant und falsch | **M** | NICHT mit Null-Halluzination werben, sondern mit *Pruefbarkeit/Audit*. Automatische DOI/Crossref/Accession-Verifikation jeder Quelle als Pflichtschritt, Verifikationsstatus mitprotokollieren. EU-AI-Act-Logging (Art. 12, ab Aug 2026) als Verkaufsargument nutzen |
| **Datensouveraenitaet als Versprechen vs. Realitaet** - angedockte KI ist oft US-Cloud-Modell; Prompt-/Quelldaten verlassen das Geraet trotz local-first SQLite | Datenschutz-Positionierung angreifbar, DSGVO/CLOUD-Act-Exposition | **N-M** | Klar kommunizieren: local-first = SoT lokal; zusaetzlich lokale/EU-Modell-Option anbieten. On-prem/EU-Residenz fuer regulierte Kunden als Premium-Feature |
| **Elicitation nicht clientuebergreifend verlaesslich** (Claude Desktop -32601; Claude Code erst seit v2.1.76) | Interaktive Quellenerfassung bricht auf Zielclients | **N** | Quellenerfassung dauerhaft ueber Tools + serverseitige Schema-Validierung (robust, clientuebergreifend), Elicitation hoechstens als Progressive Enhancement |

## Reifegrad & Konfidenz

| Dimension | Stand | Konfidenz |
|---|---|---|
| Problem/Bedarf | Validiert — auch in der Forschung explizit benannt | **hoch** |
| Techn. Machbarkeit — Mechanik (MCP/Tool-Calls) | Bestätigt | **hoch** |
| Techn. Machbarkeit — Inhalt (Attribution) | Bedingt tragfähig, **auf eigenem Schema noch ungetestet** | mittel |
| Marktlücke | Belegt (kein Produkt vereint die 5 Bausteine) | mittel-hoch |
| Monetarisierung / Marktgröße | Grobe Größenordnung; **Bottom-up-SAM/SOM fehlt** | niedrig-mittel |
| Akademische Akzeptanz des Export-Artefakts | Plausibel via RO-Crate/DOI, **ungeprüft** | niedrig-mittel |

## Was als Nächstes

Das Gate ist unverändert **Spike 1** — die Kernannahme empirisch testen. Ein eigenes Chat-/Antwort-Panel
wurde am 2026-07-30 gestrichen: Fragen zur fertigen Research laufen über `discuss_research`, das als
MCP-Prompt *und* als Werkzeug in jedem Client funktioniert. Was sich geändert hat: Die Infrastruktur dafür steht vollständig, und der Test ist heute **billiger und aussagekräftiger** als geplant.

- Die Abdeckungsrechnung liefert die Auswertung mit: `quote_verified`-Quote, Lücken je Teilfrage und Sättigung pro Runde stehen nach jedem Lauf in der DB.
- Beide Betriebsmodi sind vergleichbar — derselbe Server, dieselben Werkzeuge, dasselbe Enforcement. Der MCP-Pfad mit einem Frontier-Modell ist damit der Qualitäts-Referenzpunkt für die eigene Engine.
- Der Offset-Zitat-Pfad verschiebt die Messgröße: Nicht mehr „wie oft erfindet das Modell ein Zitat" (das kann es nicht mehr), sondern „wie oft zeigt es auf die **falsche** Stelle". Das ist die schärfere und ehrlichere Frage.

Details und Reihenfolge in [03 Next Steps](03-next-steps.md).



---

## Methodik & Belege

Grundlage dieses Dokuments ist eine Multi-Agenten-Deep-Research vom 2026-07-24: **24 Agenten**, ~1,34 Mio Tokens, 318 Web-/Tool-Aufrufe. Ablauf: 10 parallele Recherche-Agenten (je ein Blickwinkel: MCP-Protokoll, Tool-Call-Zuverlässigkeit, Quellen-Attribution, akademische Tools, Deep-Research-Tools, Provenance/MCP-Server, akademische Standards, Markt, Architektur, Failure-Modes) → adversariale Verifikation pro Blickwinkel → 4 Synthese-Agenten. Die Inline-Links verweisen auf die Primärquellen. Trotz Verifikation gilt: KI-gestützte Research ist nicht fehlerfrei — entscheidungskritische Zahlen vor verbindlichen Schritten gegenprüfen.
