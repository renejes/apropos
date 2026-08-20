# 04 · Feasibility-Analyse

> Kernfrage 1: Ist es mit heutiger KI realistisch, dass eine KI Quellen + Bewertungen ZUVERLÄSSIG per MCP einträgt?

|  |  |
|---|---|
| **Projekt** | Research Overview Platform |
| **Dokument** | 04 — Feasibility |
| **Stand** | 2026-07-24 · v1.0 |
| **Phase** | Konzept / Pre-Prototype (Greenfield) |

**Dokument-Set:** [01 Implementationplan](01-implementationplan.md) · [02 Projekt-Status](02-project-status.md) · [03 Next Steps](03-next-steps.md) · [04 Feasibility](04-feasability.md) · [05 Markt-Research](05-market-research.md) · [06 Eigene Research-Engine](06-eigene-research-engine.md) · [07 KI-Clients](07-clients.md)

---

## Executive Summary

Kurzurteil: Ja, es ist mit heutiger KI (2026) realistisch, dass eine KI Quellen und Bewertungen zuverlässig per MCP einträgt — aber nur mit einer klaren Zweiteilung und nur unter Bedingungen. Das **Format-Problem** (valides, schema-konformes Eintragen aller Pflichtfelder per Tool-Call) ist technisch weitgehend gelöst: mit erzwungenen Schemata und Constrained Decoding erreichen Modelle nahezu 100 % Schema-Compliance ([OpenAI Structured Outputs](https://openai.com/index/introducing-structured-outputs-in-the-api/)). Das **Inhalts-Problem** — ob die eingetragene Quelle stimmt, das extrahierte Wissen korrekt ist und die Begründung wahrheitsgemäß die tatsächliche Quellennutzung widerspiegelt — ist dagegen der ehrliche Schwachpunkt: die faktische Deckung liegt selbst bei Frontier-Modellen nur bei ca. 39–77 % und sinkt mit zunehmender Recherchetiefe ([Cited but Not Verified](https://arxiv.org/abs/2605.06635)). Konfidenz-Level dieses Urteils: **hoch** für die Mechanik, **mittel-hoch** für die Machbarkeit unter der Voraussetzung, dass ein Verifikations- und Review-Layer (Mensch UND KI) fester Produktbestandteil ist — nicht optional. Ohne diesen Layer ist "zuverlässig" nicht erreichbar; mit ihm ist es realistisch.

## MCP als Mechanismus — Fähigkeiten & Grenzen

Das Model Context Protocol ist Mitte 2026 ein reifer, herstellerneutraler Standard: seit Dezember 2025 unter dem Dach der Agentic AI Foundation (Linux Foundation, mitgegründet u. a. von Anthropic, Block und OpenAI), unterstützt von allen großen Clients (Claude Desktop/Code, ChatGPT, Cursor, VS Code/Copilot u. a.) mit mehreren Tausend Servern in der offiziellen Registry ([MCP – Wikipedia](https://en.wikipedia.org/wiki/Model_Context_Protocol), [MCP Intro](https://modelcontextprotocol.io/docs/getting-started/intro)). Die Grundannahme der Projektidee — ein herstellerunabhängiges Andock-Protokoll, an das "jede KI" strukturiert schreiben kann — ist damit tragfähig und nicht von einem einzelnen Anbieter abhängig.

Für die konkrete Umsetzung sind drei Punkte entscheidend:

**Nur Tools sind clientübergreifend zuverlässig.** Von den MCP-Primitiven (Tools, Resources, Prompts, Elicitation, Sampling) werden nur Tools überall sauber unterstützt. Elicitation (der Server fragt strukturierte Nutzereingaben ab) ist noch lückenhaft: Claude Desktop unterstützt sie nicht (`-32601`), Claude Code erst seit v2.1.76 ([MCP Elicitation Tutorial](https://zazencodes.substack.com/p/mcp-elicitation-tutorial), [VS Code MCP-Doku](https://code.visualstudio.com/api/extension-guides/ai/mcp)). Konsequenz: Die strukturierte Quellenerfassung (warum/Extraktion/Beitrag) muss als klar definierte **Tool-Calls mit striktem JSON-Schema** modelliert werden, nicht über Elicitation — das funktioniert auf jedem Client.

**Transport bestimmt die Reichweite.** MCP kennt zwei offizielle Transporte: stdio (lokaler Prozess, ideal für eine Desktop-App) und Streamable HTTP (remote). ChatGPT bindet ausschließlich Remote-Server über HTTPS ein, kein lokales stdio ([Why MCP Deprecated SSE](https://blog.fka.dev/blog/2025-06-06-why-mcp-deprecated-sse-and-go-with-streamable-http/), [OpenAI Developer Mode](https://help.openai.com/en/articles/12584461-developer-mode-and-mcp-apps-in-chatgpt)). Ein rein lokaler Server erreicht Claude Desktop/Cursor/VS Code, für ChatGPT braucht es einen Hosting-/Tunnel-Pfad. Für "jede KI andockbar" muss die App also beide Pfade anbieten.

**Die Spezifikation ist ein bewegliches Ziel.** Stabil im Produktivbetrieb ist 2025-11-25; der Release Candidate 2026-07-28 bringt tiefgreifende Änderungen (stateless, Wegfall von Handshake/Session; roots, sampling und logging werden deprecatiert, aber nicht sofort entfernt) ([2026-07-28 RC](https://blog.modelcontextprotocol.io/posts/2026-07-28-release-candidate/)). Praktische Folge: **keine Kernfunktion auf Sampling stützen** und mit laufender Anpassung rechnen.

Wichtig ist die Einordnung: MCP ist der **Transportmechanismus**, über den die KI strukturierte Einträge schreibt — er garantiert aber selbst nichts über die inhaltliche Qualität dieser Einträge. Dass die Mechanik funktioniert, belegen bereits existierende Bausteine: Der Zotero-MCP-Server schreibt heute schon strukturierte Bibliotheks-Einträge per KI ([zotero-mcp](https://github.com/54yyyu/zotero-mcp)), der offizielle Memory/Knowledge-Graph-Server zeigt das Muster "KI legt strukturiertes Wissen persistent ab" ([Knowledge Graph Memory MCP](https://github.com/modelcontextprotocol/servers/tree/main/src/memory)).

## Zuverlässigkeit 1: Tool-Calls & erzwungene strukturierte Ausgaben

Hier ist die Lage gut. Das reine Erzeugen schema-konformer Einträge ist mit heutiger KI robust automatisierbar.

**Constrained Decoding löst das Format-Problem.** Im strict mode maskiert eine Grammatik-Engine ungültige Tokens, sodass das Modell strukturell kein schema-fremdes Feld mehr erzeugen kann: OpenAI dokumentiert 100 % Schema-Compliance (gpt-4o mit Structured Outputs) gegenüber unter 40 % bei einem älteren Modell ohne Feature ([OpenAI Structured Outputs](https://openai.com/index/introducing-structured-outputs-in-the-api/), [Developer Guide](https://www.digitalapplied.com/blog/openai-structured-outputs-complete-guide)). Open-Source-Stacks (Outlines, Guidance, XGrammar als Default-Backend von vLLM/SGLang) leisten dasselbe per Token-Masking ([JSONSchemaBench](https://arxiv.org/abs/2501.10868)). Die KI kann also gezwungen werden, JEDE Quelle mit allen Pflichtfeldern formal korrekt einzutragen.

**Aber: Schema-Komplexität und Tool-Anzahl senken die Zuverlässigkeit.** Die Compliance bricht von ~96 % bei einfachen auf ~30 % bei sehr komplexen, tief verschachtelten Schemata ein ([JSONSchemaBench](https://arxiv.org/abs/2501.10868)). Ebenso sinkt die Trefferquote stark mit der Zahl der exponierten Tools (~50 Tools: 84–95 %; ~740 Tools: 0–20 %) ([How Many Tools Should an LLM Agent See?](https://arxiv.org/html/2605.24660v1)). Beides ist für dieses Projekt ein **Vorteil**: Ein flaches, einfaches Quell-Schema und ein schlanker Tool-Satz (etwa `add_source` / `update_source` / `get_project`) liegen am günstigen Ende — genau der Fall, in dem aktuelle Modelle stark sind.

**Realistische Mehrschritt-Szenarien sind der Flaschenhals.** Einfache Single-Turn-Calls sind zuverlässig (BFCL AST oft >90 %), aber realistische, mehrschrittige Tool-Agent-User-Szenarien liegen nur bei ~76–77 % (BFCL Multi-Turn) ([BFCL V4](https://gorilla.cs.berkeley.edu/leaderboard.html)). Kritischer noch ist die **Wiederholungs-Zuverlässigkeit**: In tau-bench Retail fällt GPT-4o von ~60 % (pass^1) auf ~25 % (pass^8) — dieselbe Aufgabe gelingt selten mehrfach hintereinander ([tau-bench](https://arxiv.org/abs/2406.12045)). Für die Praxis heißt das: Trägt die KI 30–50 Quellen in einer langen Session ein, ist NICHT garantiert, dass jede einzelne beim ersten Versuch vollständig und korrekt erfasst wird. Gegenmittel: Chunking/Checkpointing pro Quelle statt einer langen Kette.

**Format-Zwang kann Reasoning verschlechtern.** Strikte Formatvorgaben können die Reasoning-Leistung senken — dokumentiert ist v. a. der Effekt, dass ein Schema das Antwortfeld vor ein Begründungsfeld zwingt und so Chain-of-Thought verhindert ([Let Me Speak Freely?](https://arxiv.org/abs/2408.02442)). Design-Konsequenz: **Begründungs-/Reasoning-Felder im Schema VOR die Bewertungs-/Ergebnisfelder stellen** und freies Reasoning von strukturierter Extraktion trennen.

## Zuverlässigkeit 2: Quellen-Attribution & Halluzinationsrisiko (der kritische Teil — ehrlich)

Das ist der Kern des Problems, und hier muss man ehrlich sein: **Die inhaltliche Vertrauenswürdigkeit ist nicht durch die Mechanik gedeckt.** Schema-Enforcement garantiert nur die Struktur, nicht die semantische Korrektheit der Werte — wörtlich: "Schemas guarantee structure, not semantic correctness" ([Developer Guide](https://www.digitalapplied.com/blog/openai-structured-outputs-complete-guide)). Ob die eingetragene URL stimmt, das extrahierte Wissen wahr ist und die Begründung die echte Quellennutzung abbildet, fällt vollständig in die NICHT abgesicherte Kategorie.

Die Befundlage 2023–2026 ist eindeutig:

**Aus dem Gedächtnis "weiß" die KI nicht, woher eine Aussage stammt.** Auf dem CiteME-Benchmark erreichen reine LLMs nur 4,2–18,5 % Genauigkeit beim Bestimmen der korrekt zu zitierenden Arbeit — Menschen 69,7 % ([CiteME](https://arxiv.org/abs/2407.12861)). Frei generierte Zitate sind je nach Modell/Thema zu 6–90 % fabriziert oder fehlerhaft; ohne Retrieval halluziniert GPT-4o Zitate in 78–90 % der Fälle ([OpenScholar](https://www.hpcwire.com/bigdatawire/2026/02/05/openscholar-shows-why-grounded-ai-matters-for-scientific-research/), [JMIR Mental Health](https://www.eurekalert.org/news-releases/1106130)).

**Auch mit Live-Retrieval bleibt die Fehlerquote hoch.** Der Tow-Center-Audit (Columbia Journalism Review) fand über 8 KI-Suchsysteme eine Fehlerquote von über 60 % bei der Quellenzuordnung — von 37 % (Perplexity, bester) bis 94 % (Grok-3); ChatGPT identifizierte 134 von 200 Artikeln falsch, signalisierte aber nur 15-mal Unsicherheit und verweigerte nie eine Antwort ([AI Search Has a Citation Problem](https://www.cjr.org/tow_center/we-compared-eight-ai-search-engines-theyre-all-bad-at-citing-news.php)). Die KI ist also **selbstsicher falsch** — ein Transparenz-Produkt darf der KI-Konfidenz nicht vertrauen.

**Selbst kommerzielle RAG-Produkte halluzinieren.** Juristische Tools mit kuratierten Datenbanken (Lexis+ AI, Westlaw) halluzinieren trotz Grounding zu 17–33 %, obwohl die Anbieter mit "hallucination-free" warben ([Hallucination-Free? – Stanford/JELS](https://onlinelibrary.wiley.com/doi/full/10.1111/jels.12413)).

**Der gefährlichste Befund für dieses Projekt:** Genau die anvisierten Deep-Research-Agenten zeigen einen systematischen Widerspruch. Links sind meist valide (>94 %) und thematisch relevant (>80 %), aber die tatsächliche faktische Deckung einer Aussage durch die zitierte Quelle liegt nur bei 39–77 % — und fällt mit steigender Recherchetiefe im Schnitt um ~42 %, wenn die Tool-Calls von 2 auf 150 steigen ([Cited but Not Verified](https://arxiv.org/abs/2605.06635)). "Mehr Retrieval erzeugt NICHT mehr korrekte Zitate." Oberflächliche Zitierqualität maskiert also faktische Fehler und erzeugt falsches Vertrauen — exakt das Risiko, das die Projektidee adressieren will.

**Und der subtilste Punkt — die Begründung selbst ist unzuverlässig.** Selbst wenn ein Modell eine Begründung ("warum diese Quelle") ausgibt, ist diese Selbstauskunft oft nicht kausal echt, sondern nachträglich rationalisiert: In bis zu 57 % der Fälle zitiert ein State-of-the-art-Modell "unfaithful" — es heftet einer bereits feststehenden Antwort ein passendes Dokument an, statt es tatsächlich genutzt zu haben ([Correctness is not Faithfulness](https://arxiv.org/abs/2412.18004)). Auch die ausgegebene Chain-of-Thought spiegelt oft nicht wider, was die Antwort tatsächlich beeinflusst hat ([CoT Not Always Faithful](https://arxiv.org/pdf/2503.08679)). Das trifft direkt das geplante Feld "warum diese Quelle / welcher Beitrag": Eine ehrlich klingende Begründung ist KEIN Beleg für echte Quellennutzung. Das mitgespeicherte Chat-Protokoll ist wertvoll für menschliches Nachvollziehen und Auditing — aber es taugt NICHT als Nachweis, dass eine Quelle wirklich der Ursprung eines Fakts war.

## Was NICHT zuverlässig ist (Grenzen)

Zusammengefasst — diese Dinge liefert die KI von sich aus NICHT verlässlich, und man darf sie nicht als gegeben annehmen:

- **Die Wahrheit der Feldwerte.** Quell-URL, extrahiertes Wissen und Beitrag können schema-konform und trotzdem falsch sein. Struktur ≠ Korrektheit.
- **Die Selbstauskunft über Quellenherkunft.** Ohne Retrieval praktisch wertlos (4–18 %); die "Warum"-Begründung ist bis zu 57 % nachträglich rationalisiert.
- **Konsistenz über viele Quellen und lange Sessions.** pass^k kollabiert; je mehr Turns, desto niedriger die Zuverlässigkeit.
- **Faktentreue bei tiefer Recherche.** Sinkt mit der Zahl der Tool-Calls, während die Oberflächenmetriken stabil bleiben — der Nutzer sieht die Verschlechterung nicht.
- **Ehrliche Unsicherheits-Kommunikation.** Die KI antwortet selbstsicher falsch und signalisiert Unsicherheit kaum von selbst.
- **Sicherheit gegen manipulierte Quellinhalte.** Da das Kerngeschäft das Einlesen fremder Web-Quellen ist, sind Prompt-Injection über Quellinhalte und Tool-Poisoning reale, dokumentierte Angriffe (u. a. CVE-2025-54136; mcp-remote CVE-2025-6514, CVSS 9.6) — eingelesene Inhalte müssen als untrusted behandelt und nie ungefiltert als Instruktion interpretiert werden ([State of MCP Security](https://nimblebrain.ai/blog/state-of-mcp-security-2026/), [Tool Poisoning](https://www.truefoundry.com/blog/blog-mcp-tool-poisoning-gateway-defense)).

Ein weiterer ehrlicher Punkt: Nicht-Frontier-Modelle, die Nutzer via MCP andocken könnten, füllen die strukturierten Felder deutlich schlechter als Spitzenmodelle. "Zuverlässig" ist bei schwächeren Modellen nicht garantiert — es braucht ggf. ein empfohlenes Mindest-Modell-Niveau.

## Gegenmaßnahmen, die die Zuverlässigkeit auf brauchbares Niveau heben

Die gute Nachricht: Jede der genannten Grenzen hat ein konkretes, verfügbares Gegenmittel. Der belegte Lösungsweg ist erzwungenes Grounding + unabhängiger Verifier + Human-in-the-loop. Im Detail:

**1. Strikter Schema-Zwang serverseitig.** Die Provenienz-Felder (warum/Extraktion/Beitrag) als Pflichtfelder mit strikter JSON-Schema-Validierung erzwingen; nur nötige Felder verlangen; jeden Tool-Call loggen. Die Tool-Zuverlässigkeit hängt stärker von Argument-Korrektheit und Schema-Einhaltung ab als von der Modellgröße — mit guten Schemata erreichen selbst kleinere Modelle brauchbare Werte ([Natural Language Tools](https://arxiv.org/pdf/2510.14453)).

**2. Erzwungene wörtliche Exzerpte aus dem gefetchten Text.** Das ist der wirksamste Einzelhebel. Das Tool-Schema sollte pro Aussage ein **Pflichtfeld "verbatim quote span + Quellen-ID"** verlangen; Aussagen ohne verankertes Wörtlichzitat werden automatisch als "unbelegt" markiert. Anthropics Citations API zerlegt gelieferte Dokumente in Sätze und stützt Behauptungen nur auf diese Passagen statt auf Trainingswissen; im Vendor-Fallbeispiel sank die Quellen-Halluzination von 10 % auf 0 % ([Anthropic Citations API](https://claude.com/blog/introducing-citations-api), [Simon Willison](https://simonwillison.net/2025/Jan/24/anthropics-new-citations-api/)). Grundregel: nur auf tatsächlich im selben Lauf abgerufene Quellen arbeiten, nicht auf "aus dem Kopf" vorgeschlagene.

**3. Automatische Beleg-gegen-Quelle-Prüfung (Verifier-Agenten).** Ein NLI-/Entailment- oder LLM-Judge-Pass prüft jedes Tripel Aussage–Quote–Quelle. Retrieval-gestützte Verifier heben die Attribution-Genauigkeit auf CiteME von ~4–18 % auf ~68 %, nahe menschliches Niveau ([CiteGuard](https://arxiv.org/abs/2510.17853)); span-level-Ansätze wie FullCite verlangen Quellen-ID + verbatim Span pro Behauptung. Ehrliche Einschränkung: Diese Verifier sind selbst nur ~78 % zuverlässig (hohe Precision, geringere Recall) — sie **flaggen**, ersetzen aber den Menschen nicht ([AttributionBench](https://osu-nlp-group.github.io/AttributionBench/), [ALCE](https://aclanthology.org/2023.emnlp-main.398/)).

**4. Human-in-the-loop-Review als Pflicht, nicht Kür.** Weil Verifier unvollständig sind und selbst der beste Architektur-Ansatz (Anthropics separater CitationAgent-Pass) die Attribution nicht vollständig verlässlich macht und teuer ist (~15x Tokens), bleibt der menschliche Sign-off pro Quelle fachlich gerechtfertigt ([Anthropic Multi-Agent Research](https://theaiengineer.substack.com/p/how-anthropic-built-multi-agent-deep)). Das deckt sich mit dem akademischen Konsens: Der Mensch trägt die volle Verantwortung und muss KI-Output verifizieren ([ICMJE](https://www.icmje.org/recommendations/browse/roles-and-responsibilities/defining-the-role-of-authors-and-contributors.html)).

**5. Konfidenz-/Uncertainty-Flags pro Eintrag.** Automatisches Vertrauens-Scoring pro Tool-Call plus gezielte Retries bei niedrigem Vertrauen senken die Fehlerrate um bis zu ~50 % ([Cleanlab / Tau2-Bench](https://cleanlab.ai/blog/tau-bench/)). Das UI muss Verifikationsstatus und Unsicherheit explizit erzwingen — ein grün wirkender, valider Link darf nicht über fehlende faktische Deckung hinwegtäuschen.

**6. Trennung "gelesen" vs. "inferiert".** Das Datenmodell sollte pro Kante (Aussage↔Quelle↔Span) einen Verifikationsstatus und eine Konfidenz führen und many-to-many-Beziehungen erlauben, statt eine 1:1-Zuordnung zu erzwingen — denn eine Aussage kann von mehreren Passagen gestützt werden und span-level Ground Truth ist mehrdeutig ([CiteGuard](https://arxiv.org/abs/2510.17853)). Optional stärken kontrafaktische Checks (Quelle entfernen und prüfen, ob sich die Aussage ändert) die Unterscheidung von echter Nutzung ("Faithfulness") gegenüber bloßer Korrektheit.

**7. Tool-Beschreibungen als größte Stellschraube.** 97,1 % analysierter MCP-Tool-Descriptions haben Qualitätsmängel; bessere Beschreibungen mit Parameter-Erklärungen, Beispielen und "Wann-nicht-nutzen"-Hinweisen heben die Erfolgsrate um ~6 Prozentpunkte ([MCP Tool Descriptions Are Smelly!](https://arxiv.org/abs/2602.14878)). Bei nur einer Handvoll Tools ist das mit vertretbarem Aufwand exzellent machbar.

**8. Reasoning und Formatierung trennen.** Erst frei begründen lassen, dann in einem separaten, validierten Schritt strukturieren — das umgeht den dokumentierten Accuracy-Drop bei stark constrainter Ausgabe ([Let Me Speak Freely?](https://arxiv.org/abs/2408.02442)).

## Fazit & Machbarkeits-Urteil

Ampelartig, mit Bedingungen:

**🟢 GRÜN — Das Eintragen strukturierter Quellen per MCP-Tool-Call.** Die Mechanik ist gelöst. Ein schlankes, strikt schema-erzwungenes `add_source`-Tool mit wenigen, sehr gut beschriebenen Feldern ist der günstigste Fall aktueller KI (wenige Tools, flaches Schema) und passt direkt zum TS/Node-Stack (offizielles `@modelcontextprotocol/sdk`, v1-Linie stabil). Voraussetzung: serverseitige Schema-Validierung, Pflichtfelder, Logging.

**🟡 GELB — Die inhaltliche Vertrauenswürdigkeit der Bewertungen (warum/Extraktion/Beitrag).** Ohne zusätzliche Maßnahmen NICHT zuverlässig (faktische Deckung 39–77 %, Begründungen bis 57 % rationalisiert, Faktentreue sinkt mit Tiefe). MIT den oben genannten Gegenmaßnahmen — erzwungene Wörtlichzitate aus gefetchtem Text, automatischer Verifier, Konfidenz-Flags, verpflichtender Mensch-Review — wird die Zuverlässigkeit auf ein brauchbares, produktiv einsetzbares Niveau gehoben. Genau diese Maßnahmen sind ohnehin der Kern des Produktversprechens "prüfbare, anhängbare Research".

**🔴 ROT — Vollautomatisches, review-freies Eintragen als "fertige Wahrheit".** Wenn das Produkt verspricht, dass die KI Quellen und Bewertungen ohne menschliche oder maschinelle Verifikation korrekt einträgt, ist das mit heutiger KI nicht einlösbar und würde die dokumentierten Fehlermodi (fabrizierte Zitate, unfaithful Begründungen, Injection über Quellinhalte) direkt in die "prüfbare" Datenbank schreiben.

**Gesamturteil:** Kernfrage 1 ist mit **Ja, unter Bedingungen** zu beantworten. Das Projekt ist technisch realistisch und gut zum gewählten Stack passend — aber sein Erfolg hängt nicht an der Annahme, MCP sei fertiges Plug-and-Play, sondern an nüchternem Design: Tools statt Elicitation, strikte Validierung, erzwungene Wörtlich-Belege, ein Verifikations-Layer und der ohnehin geplante Mensch-UND-KI-Review. Entscheidend ist die Umdeutung: Die drei Felder (warum/Extraktion/Beitrag) dürfen im Datenmodell nicht als Wahrheit behandelt werden, sondern als **zu verifizierende Behauptungen mit Status und Konfidenz**. Genau darin liegt zugleich die Differenzierung — kein Mainstream-Tool kombiniert heute den eingebauten MCP-Schreibzugriff mit strukturierter Pro-Quelle-Provenienz, Verifikation und Review zu einem versionierten, anhängbaren Audit-Artefakt.

---

## Methodik & Belege

Grundlage dieses Dokuments ist eine Multi-Agenten-Deep-Research vom 2026-07-24: **24 Agenten**, ~1,34 Mio Tokens, 318 Web-/Tool-Aufrufe. Ablauf: 10 parallele Recherche-Agenten (je ein Blickwinkel: MCP-Protokoll, Tool-Call-Zuverlässigkeit, Quellen-Attribution, akademische Tools, Deep-Research-Tools, Provenance/MCP-Server, akademische Standards, Markt, Architektur, Failure-Modes) → adversariale Verifikation pro Blickwinkel → 4 Synthese-Agenten. Die Inline-Links verweisen auf die Primärquellen. Trotz Verifikation gilt: KI-gestützte Research ist nicht fehlerfrei — entscheidungskritische Zahlen vor verbindlichen Schritten gegenprüfen.
