# 05 · Markt-Research & Wettbewerb

> Kernfrage 2: Gibt es das schon? Wettbewerbslandschaft, Marktlücke, Zielsegmente und Monetarisierung.

|  |  |
|---|---|
| **Projekt** | Research Overview Platform |
| **Dokument** | 05 — Markt-Research |
| **Stand** | 2026-07-24 · v1.0 |
| **Phase** | Konzept / Pre-Prototype (Greenfield) |

**Dokument-Set:** [01 Implementationplan](01-implementationplan.md) · [02 Projekt-Status](02-project-status.md) · [03 Next Steps](03-next-steps.md) · [04 Feasibility](04-feasability.md) · [05 Markt-Research](05-market-research.md) · [06 Eigene Research-Engine](06-eigene-research-engine.md) · [07 KI-Clients](07-clients.md)

---

## Executive Summary

Die zentrale Frage lautet: Gibt es das schon? Die klare Antwort ist **nein — kein einziges existierendes Produkt kombiniert die vier definierenden Bausteine der Idee**: einen eingebauten, offenen MCP-Server (an den beliebige KI andocken und strukturiert schreiben kann), ein strukturiertes Pro-Quelle-Bewertungslog (warum diese Quelle / welches Wissen extrahiert / welcher Beitrag zum Ergebnis), Versionierung samt mitgespeichertem Chat-Protokoll und einen portablen, an wissenschaftliche Arbeiten anhaengbaren, prueffbaren Audit-Export.

Der Markt ist dennoch dicht besetzt: Rund ein Dutzend etablierter akademischer Tools, fuenf grosse generische Deep-Research-Systeme und ein wachsendes MCP-/Provenance-Oekosystem ueberlappen jeweils mit *Teilen* der Idee. Quellen-Transparenz allein (Inline-Zitate, klickbare Belege) ist 2026 zur Selbstverstaendlichkeit geworden — Elicit zitiert satzgenau, Consensus zeigt ein Consensus-Meter, [NotebookLM](https://www.atlasworkspace.ai/blog/notebooklm-limitations) springt per Klick zur exakten Passage. Die verteidigbare Luecke liegt daher nicht in der Suche oder im Zitieren, sondern in der **Dokumentations-, Review-, Versionierungs- und Anhang-Schicht** — genau dort, wo die Idee ansetzt.

Bemerkenswert: Die Forschung selbst beschreibt diese Luecke inzwischen explizit. Das Paper [Inspectable AI for Science](https://arxiv.org/pdf/2604.11261) entwirft nahezu deckungsgleich das gewuenschte Datenmodell (was ging in die KI ein, welche Quellen, was wurde erzeugt, wie trug es bei — versioniert, maschinenlesbar, anhaengbar), bleibt aber ein Governance-Framework ohne lauffaehiges Produkt. [From Fluent to Verifiable](https://arxiv.org/html/2602.13855) fordert einen "Auditable Autonomous Research"-Standard mit "semantic provenance". Die Idee trifft also einen real benannten, noch unbesetzten Bedarf.

## Konkurrenz-Landschaft

### Gruppe A: Akademische AI-Research-Tools

| Tool | Was es tut | Transparenz-Ansatz | Luecke ggue. dieser Idee | Preis |
|---|---|---|---|---|
| [Elicit](https://elicit.com/) | Suche/Extraktion ueber ~138 Mio. Paper, Extraktions-Tabellen, PRISMA-2020-Systematic-Review | Satzgenaue Zitate; SR-Workflow "reproducible, traceable, auditable"; gegen 994 Cochrane-Reviews validiert | Geschlossene Eigen-Pipeline, kein offener MCP-Server; kein Pro-Quelle-Warum/Beitrag-Feld; kein Chat-Protokoll-Anhang; Extraktion bindet nicht konsistent an exakte Belegstelle ("index cards, not proof") | Free; Pro 49 USD/Mo; Scale 169 USD/Mo; Enterprise custom |
| [Consensus](https://consensus.app) | Evidenz-Antworten ueber ~220 Mio. Paper, "Consensus Meter" (stuetzend/widersprechend) | Inline-Citations, Consensus-Meter, betreibt eigenen MCP-Server (mcp.consensus.app) | Answer-/Such-Tool, kein persistentes Projekt; keine Versionierung/Chat-Log; MCP ist Datenquelle, nicht Dokumentations-Ziel | Free; Premium 8,99 USD/Mo; Pro ~20 USD/Mo; Deep ~45 USD/Mo |
| [Scite](https://scite.ai/) | "Smart Citations": klassifiziert Zitate als supporting/contrasting/mentioning (>1,2 Mrd. Statements) | Zeigt Zitat-Kontext statt bloss Zahlen; eigener MCP-Server (api.scite.ai/mcp, angek. 02/2026) | Bewertet fremde Publikationen, nicht den eigenen Rechercheprozess; Labels teils ungenau; keine Versionierung/Review/Anhang | Free; Individual ~12-20 USD/Mo |
| [Undermind](https://www.undermind.ai/) | Deep-Search-Agent fuer Long-Tail-Literatur mit statistischer "discovery curve" | Marktweit staerkste Vollstaendigkeits-Transparenz (Certainty-Score, "~89,7% gefunden") | Kein anhaengbares Projekt-Artefakt, kein MCP-Andock, keine Pro-Quelle-Begruendung | Free (wenige); Pro ~16-20 USD/Mo; Team 15 USD/Person/Mo |
| [ResearchRabbit](https://www.researchrabbit.ai) | Visuelle Zitationsnetze (310+ Mio. Artikel) | Zeigt, warum Paper verbunden sind (Zitate/Autoren) | Reine Discovery-Karte, keine Extraktion/Bewertung/Review; Mai 2025 von Litmaps uebernommen | Free; RR+ ~10 USD/Mo |
| [SciSpace](https://scispace.com) | All-in-one Agent (Suche+Extraktion+DeepReview), Chat-with-PDF | Verweist auf Dokumentabschnitte; Markdown-Export | Kein MCP-Server, kein Pro-Quelle-Schema, keine versionierte Provenance-DB | Free; Premium ~7-12 USD/Mo |
| [Semantic Scholar](https://www.semanticscholar.org) | Gratis Suchmaschine (214+ Mio. Paper) + offene API | Offene, strukturierte Metadaten/Zitationsdaten | Infrastruktur/Index, kein Workflow — eher Datenquelle FUER die Plattform | Kostenlos |
| [Ai2 Paper Finder](https://allenai.org/blog/paper-finder) | LLM-Such-Agent, Pro-Paper-Relevanzbegruendung | Live-Reasoning sichtbar; kommt "warum diese Quelle" am naechsten; Snapshot open-source | Ergebnisse fluechtig — kein gespeichertes/versioniertes Projekt, kein Extraktions-Log, kein Review | Kostenlos |

### Gruppe B: Generische Deep-Research-Tools

| Tool | Was es tut | Transparenz-Ansatz | Luecke ggue. dieser Idee | Preis |
|---|---|---|---|---|
| [ChatGPT Deep Research](https://en.wikipedia.org/wiki/ChatGPT_Deep_Research) | Autonomer Web-Report (5-30 Min.) mit Inline-Markern | Marker + Quellen-Panel | Marker "stranden" (Panel persistiert nicht), Export-Bugs; kein strukturierter Pro-Quelle-Datensatz, kein offener MCP | In Plus 20 USD/Mo; Pro 200 USD/Mo |
| [Gemini Deep Research](https://skywork.ai/blog/ai-agent/gemini-sources-panel/) | Strukturierte Web-Reports mit editierbarem Rechercheplan | Gute Prozess-Transparenz, trennt Evidenz/Kontext | Export verlustbehaftet, "not for iterative editing"; keine Versionierung/Pro-Quelle-Begruendung | Teil kostenpfl. Google-AI-Tiers |
| [Perplexity (Deep Research + Spaces)](https://www.secondtalent.com/resources/perplexity-deep-research-review/) | Agentische RAG-Schleife; Spaces = geteilte Projekt-Raeume | Inline-Zitate mit Klick-Verifikation | Spaces am naechsten an "Projekt", aber keine Pro-Quelle-Begruendung/Versionierung/Chat-Anhang; US-Hosting | Pro 20 USD/Mo; Enterprise 40 USD/Sitz |
| [Claude Research](https://theaiengineer.substack.com/p/how-anthropic-built-multi-agent-deep) | Multi-Agent mit separatem CitationAgent-Pass | Bester Architektur-Ansatz gegen Attribution-Drift | Attribution transient im Chat, nicht als versioniertes Artefakt; ~15x Tokens, teuer | In Claude Pro |
| [NotebookLM](https://www.atlasworkspace.ai/blog/notebooklm-limitations) | Grounded auf nutzereigene Quellen, Klick->Passage | Transparenteste Aussage-Quelle-Bindung der Gruppe | Keine Seitenzahlen/Bibliografie, keine Provenance ueber Threads, keine Versionierung, kein offizieller MCP-Server | Free; Plus in Google One 19,99 USD/Mo |

### Gruppe C: Referenz-Manager / Provenance / existierende MCP-Server

| Tool | Was es tut | Transparenz-Ansatz | Luecke ggue. dieser Idee | Preis |
|---|---|---|---|---|
| [Zotero-MCP](https://github.com/54yyyu/zotero-mcp) | MCP-Server mit Lese- UND Schreibzugriff auf Zotero (~30 Tools) | Metadaten/Notiz-basierte Herkunft ueber Zotero-Records | Kein Provenance-Bewertungsschema (warum/was/Beitrag), keine Report-Versionierung, keine Review-UI — taugt als Backend | Open Source (MIT) |
| [footnote-mcp](https://github.com/KazKozDev/footnote-mcp) | Quellengestuetzte Web-Recherche, prueft Claims gegen Quelle | Stark: Provenance-Cache, Claim-Verifikation, Audit-Trail | Nur Server/Toolkit (stdio), keine App, keine Review-UI/Versionierung/Chat-Protokoll | Open Source (MIT) |
| [PaperQA2](https://github.com/Future-House/paper-qa) | Agentisches RAG, In-Text-Zitate, "uebermenschliche" Praezision | Geerdete Zitate, einsehbarer Reasoning-Pfad | Frage-Antwort-Engine, keine Pro-Quelle-DB/Versionierung/MCP-Andock | Open Source |
| [STORM / Co-STORM](https://github.com/stanford-oval/storm) | Erzeugt vollen Report mit Zitaten (~85% Citation Recall/Precision) | Zitierte Ausgabe, offener Code | Report-Generator, keine Provenance-DB/Review/MCP/Anhang | Open Source |
| [Offizieller MCP Memory/KG-Server](https://github.com/modelcontextprotocol/servers/tree/main/src/memory) | Persistenter Knowledge-Graph, per MCP beschreibbar | Neutrale strukturierte Ablage | Kein Research-Schema, keine Versionierung/Review — Referenz-Architektur zum Spezialisieren | Open Source |
| [RO-Crate + Inspectable AI for Science](https://www.researchobject.org/ro-crate/) | Standard zum maschinenlesbaren Verpacken von Research + Provenance; akademischer Blueprint | Maximaler Anspruch: verifizierbare, maschinenlesbare Provenance | Standard/Vorschlag, KEIN Produkt mit MCP-Server/Review-UI/Chat-Log — als Export-Ziel adaptieren | Offener Standard |

## Direkter-Treffer-Check

**Gibt es EIN Tool, das exakt die Idee umsetzt? Nein.** Diese Aussage stuetzt sich uebereinstimmend auf fuenf unabhaengige Recherche-Blickwinkel:

- **Akademische Tools:** Fachbibliothekar Aaron Tay beschreibt spezialisierte Deep-Research-Tools explizit als ["black boxes" mit "rigid, pre-programmed workflows"](https://aarontay.substack.com/p/creating-your-own-research-assistant) und benennt den Reproduzierbarkeits-/Auditierbarkeits-Gap als offenes Problem.
- **Generische Deep-Research-Tools:** Kein Mainstream-Tool bietet ein strukturiertes, versioniertes, abfragbares Projekt mit Pro-Quelle-Begruendung plus Chat-Protokoll als zitierbares Artefakt.
- **Provenance/MCP:** Kein fertiges Produkt buendelt MCP-Schreibzugriff + Provenance-Schema + Versionierung + Mensch/KI-Review + Anhang-Faehigkeit.

Am naechsten kommen jeweils *Teilloesungen*: Zotero-MCP beweist, dass "KI schreibt strukturiert per MCP in eine Bibliothek" bereits Alltag ist — aber ohne Bewertungsschema. Ai2 Paper Finder liefert Pro-Paper-Begruendungen — aber fluechtig. Perplexity Spaces bietet Projekt-Raeume — aber ohne Provenance/Versionierung. Elicit ist "reproducible, traceable, auditable" — aber als geschlossene Pipeline ohne offenen MCP. Und Claude Research hat den saubersten Attributions-Pass — aber nur transient im Chat. **Keines vereint die Bausteine.**

Wichtige Praezisierung zum MCP-Baustein: Der reine "KI-per-MCP-an-akademische-Quellen"-Zugang ist bereits teilweise **Commodity** (Consensus, Scite, PubMed, OpenAlex, Zotero haben MCP-Server). Das Alleinstellungsmerkmal liegt daher nicht darin, *ueberhaupt* MCP anzubieten, sondern darin, den MCP-Server als **nativen, stabilen Schreib-/Dokumentations-Endpoint** mit Provenance-Semantik zu betreiben. Die inoffiziellen Community-MCP-Wrapper (z.B. fuer NotebookLM) unterstreichen die Nachfrage, entwerten aber das Argument in seiner absoluten Form nicht — offizielle, supportete, versions-integrierte MCP-Server als Kernfeature fehlen weiterhin.

## Markt-Luecke & Alleinstellung

Die verteidigbare Kombination — die kein Wettbewerber abdeckt — besteht aus fuenf Elementen:

1. **Offener, eingebauter MCP-Server** — beliebige KI dockt an und traegt strukturiert ein (nicht "die Plattform IST die eine KI").
2. **Strukturiertes Pro-Quelle-Bewertungslog** — warum diese Quelle / welches Wissen extrahiert / welcher Beitrag zum Ergebnis, als Pflicht-Datenmodell mit strikter Schema-Validierung.
3. **Versionierung + mitgespeichertes Chat-Protokoll** — der Prompt-/Chat-Log IST das reproduzierbare Artefakt (nicht die Re-Generierbarkeit).
4. **Mensch-UND-KI-Review** desselben persistenten Projekts mit Sign-off pro Quelle.
5. **Portabler, zitierbarer Anhang-Export** — SQLite als abfragbare Source-of-Truth + Markdown, idealerweise RO-Crate-kompatibel und per DOI (Zenodo/OSF) hinterlegbar.

Der strategische Kern: **Quellen-Transparenz ist Tischstakes, Provenance-Dokumentation ist der Differenzierer.** Der Markt konsolidiert im Discovery-Segment (Litmaps kaufte ResearchRabbit; Gratis-Tools werden Freemium) — reine Suche ist ein Preiskampf. Der Provenance-/Compliance-/Anhang-Wert ist das robustere und hoeher bepreisbare Argument.

## Zielsegmente

**Akademisch (Forschende, Doktoranden, Bibliotheken):**
- *Beduerfnisse:* Reproduzierbarkeit, PRISMA-konforme Suchdokumentation, Offenlegungspflicht (COPE/ICMJE/Elsevier verlangen KI-Deklaration), Schutz vor fabrizierten Zitaten (Lancet-Audit: ~12-facher Anstieg, 1 von 458 Papern 2025).
- *WTP:* niedrig und stark preissensitiv — reale Kaufkraft der Forschungsbudgets sinkt seit Jahren; Einzelabos meist 8-50 USD/Mo. Realistischer Kanal: **institutionelle FTE-/Site-Lizenzen ueber Bibliotheken**, nicht Premium-Einzelabos.
- *Strategie:* Freemium fuer Sichtbarkeit + Campus-Deal fuer Umsatz.

**Marketing/Business (Competitive Intelligence, Strategie, Agenturen, regulierte Branchen):**
- *Beduerfnisse:* prueffbare, belegbare Recherche als Entscheidungsgrundlage; Audit-Trail; Compliance (EU AI Act Logging ab 08/2026); Datenresidenz.
- *WTP:* deutlich hoeher — [ChatGPT Enterprise real ~45-75 USD/Sitz/Mo](https://coworker.ai/blog/enterprise-ai-pricing-comparison-2026), wobei der Aufpreis Governance/Compliance/Datenresidenz kauft, **nicht bessere Modelle**. AlphaSense zeigt, dass Business-CI hohe 4-5-stellige Jahresvertraege traegt — die Provenance-/Audit-Nische dort ist noch unbesetzt.
- *Strategie:* Premium/Enterprise mit Compliance-Features und local-first als Differenzierer.

## Marktgroesse & Trends

Wichtiger Vorbehalt: Die Top-Down-Marktzahlen streuen je nach Definition **um Faktor 5+** und mischen Consumer-Chatbots mit Enterprise-Assistenz — nur als Groessenordnung nutzbar, nicht als harte Business-Case-Basis.

- **AI-Assistenten-Software:** [10,08 Mrd. USD (2025), 17,76% CAGR](https://www.fortunebusinessinsights.com/ai-assistant-software-market-118050) bis hin zu [19,1 Mrd. USD (2025)](https://www.gminsights.com/industry-analysis/ai-assistant-market) bzw. [3,35→21,11 Mrd. USD bei 44,5% CAGR](https://www.marketsandmarkets.com/Market-Reports/ai-assistant-market-40111511.html).
- **Wachstumskern:** Dem Sub-Segment "Knowledge & Research Assistants" wird die hoechste CAGR (~45-49%) zugeschrieben — Richtungssignal, nicht als harter Beleg zu fuehren (Sekundaerquelle).
- **Knowledge-Management-Software:** [~13,7 Mrd. USD (2025), ~18% CAGR](https://www.mordorintelligence.com/industry-reports/knowledge-management-software-market) — relevanter Nachbarmarkt, da die Plattform faktisch ein Research-Knowledge-Repository ist.
- **AI in Education:** [~6,9 Mrd. USD (2025), ~41% CAGR](https://www.mordorintelligence.com/industry-reports/ai-in-education-market) — thematisch naechster Markt fuer den akademischen Zweig.
- **Competitive Intelligence:** [2,6 Mrd. USD (2025), 9,8% CAGR](https://www.verifiedmarketreports.com/product/competitive-intelligence-software-market/) — kleiner, aber zahlungskraeftiger Proxy fuer den Business-Zweig.

**Rueckenwind-Trends:** (1) MCP ist seit 12/2025 herstellerneutral unter der Agentic AI Foundation (Linux Foundation), ~9-10k Server in der Registry. (2) Regulierung belohnt Provenance: [EU AI Act GPAI-Pflichten gelten seit 08/2025, Durchsetzung ab 08/2026](https://artificialintelligenceact.eu/implementation-timeline/), Bussen bis 35 Mio. EUR / 7% Umsatz. (3) Fabrizierte Zitate sind ein akuter, sichtbarer Schmerzpunkt (Springer-Nature-Rueckzug 2025; >200 Gerichtsfaelle mit KI-erfundenen Zitaten, Strafen bis 95.000 USD).

## Monetarisierung

Empfehlung: **zweigleisiges Modell.**

| Segment | Modell | Benchmark-Anker |
|---|---|---|
| Akademisch (Einzel) | Freemium + guenstiges Pro | Consensus 8,99-15 USD/Mo (massentauglich); Elicit Pro 49 USD (ambitioniert) |
| Akademisch (Institution) | FTE-/Site-License ueber Bibliotheken | verhandlungsabhaengig, nicht oeffentlich |
| Business/Enterprise | Seat + Compliance-Features | ChatGPT Enterprise ~45-75 USD/Sitz; Perplexity Enterprise 40 USD/Sitz |

**Preis-Anker:** 20-50 USD/Mo ist der Rahmen fuer ambitionierte Einzelnutzer-Research-Tools; ~9-15 USD ist massentauglich-akademisch positioniert.

**Local-first/Datenschutz als Kern-Verkaufsargument (kein Nice-to-have):** Der [US-CLOUD-Act](https://secureprivacy.ai/blog/data-residency-requirements-eu-vs-us-explained) kann US-Anbieter zur Datenherausgabe zwingen, auch bei EU-Serverstandort. Der local-first-Ansatz (SQLite lokal als Source-of-Truth, Markdown-Export, MCP-Andockung an frei waehlbare — auch lokale/EU — Modelle) ist ein direkter Differenzierer gegenueber NotebookLM (Google/US) und Perplexity (US), besonders fuer oeffentliche Hand, Recht, Gesundheit und compliance-getriebenen Mittelstand. Der [EU-Souveraen-Cloud-Markt waechst zweistellig](https://itdaily.com/news/cloud/global-sovereign-cloud-market-grows/) und soll 2027 Nordamerika ueberholen — guenstiges Timing.

*Caveat:* Bindet die angedockte KI selbst ein US-Cloud-Modell ein, verlassen Prompt-/Quelldaten das Geraet Richtung LLM-API — die Positionierung braucht daher zwingend eine lokale/EU-Modell-Option, sonst ist das Datensouveraenitaets-Argument nur teilweise tragfaehig.

## Chancen & Risiken (Markt)

**Chancen:**
- **Echte, auch akademisch benannte Whitespace-Luecke** — kein Produkt buendelt die fuenf Kern-Bausteine; die Forschung (Inspectable AI, AAR-Standard) validiert das Datenmodell.
- **Regulatorischer Rueckenwind** — EU AI Act, PRISMA-S, TOP-Guidelines und Offenlegungspflichten machen "compliance-by-design" glaubwuerdig verkaufbar.
- **Akuter Schmerzpunkt** — fabrizierte Zitate mit dokumentierten Ruecknahmen und Gerichtsfaellen sind das staerkste Verkaufsargument fuer "pruefbare Research".
- **Standard-Anschlussfaehigkeit** — RO-Crate als Export-Ziel macht den Anhang echt zitierbar und signalisiert Serioesitaet.

**Risiken:**
- **Preiskampf im Discovery-Segment** — reine Suche ist kommodifiziert; Monetarisierung muss ueber den Provenance-/Audit-Wert laufen.
- **Preissensibler akademischer Kern** — direkter Einzelverkauf ist schwer; lange institutionelle Beschaffungszyklen.
- **Inhaltliche Datenqualitaet als Achillesferse** — KI belegt Aussagen nur zu 39-77% faktisch korrekt (fallend mit Recherchetiefe); wenn das eingetragene "warum/was/Beitrag" unzuverlaessig ist, faellt das zentrale Verkaufsargument. Die Mensch+KI-Review-Schicht und automatische Beleg-gegen-Quelle-Verifikation sind daher zwingend, nicht optional.
- **Elicit setzt die Messlatte** — bietet PRISMA + "reproducible/traceable/auditable" bereits an; die offene MCP-Andockung + universelles Pro-Quelle-Log + Anhang-Faehigkeit muss als Differenzierer scharf kommuniziert werden.
- **MCP als bewegliches Ziel** — schnelle Spec-Entwicklung (RC 2026-07-28, stateless, breaking) und ungeloeste MCP-Sicherheit (Prompt-Injection, Tool-Poisoning) erfordern laufende Anpassung und Audit-Trail-Integritaet von Anfang an.

---

## Methodik & Belege

Grundlage dieses Dokuments ist eine Multi-Agenten-Deep-Research vom 2026-07-24: **24 Agenten**, ~1,34 Mio Tokens, 318 Web-/Tool-Aufrufe. Ablauf: 10 parallele Recherche-Agenten (je ein Blickwinkel: MCP-Protokoll, Tool-Call-Zuverlässigkeit, Quellen-Attribution, akademische Tools, Deep-Research-Tools, Provenance/MCP-Server, akademische Standards, Markt, Architektur, Failure-Modes) → adversariale Verifikation pro Blickwinkel → 4 Synthese-Agenten. Die Inline-Links verweisen auf die Primärquellen. Trotz Verifikation gilt: KI-gestützte Research ist nicht fehlerfrei — entscheidungskritische Zahlen vor verbindlichen Schritten gegenprüfen.
