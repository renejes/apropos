> **Hinweis 2026-08-20:** Die eingebaute Ollama-Engine in der App ist entfernt. Alltagsweg ist der Cursor-SDK-Agent (WebSearch inklusive). Dieses Dokument bleibt als historische Entscheidungsvorlage zu Abo-Modellen und Anbietern.

# 06 · Eigene Research-Engine — Anbieter, Abo-Modelle und Machbarkeit

> Kann eine eigene Deep-Research-Engine in der App über ein **Festpreis-Abo** statt über Token-Abrechnung betrieben werden? Und wenn ja — deckt dieses Abo auch die **Websuche** ab?

|  |  |
|---|---|
| **Projekt** | apROPos |
| **Dokument** | 06 — Eigene Research-Engine |
| **Stand** | 2026-07-26 · v1.0 |
| **Phase** | Entscheidungsvorlage (revidiert die Strategie-Festlegung vom 2026-07-25) |

**Dokument-Set:** [01 Implementationplan](01-implementationplan.md) · [02 Projekt-Status](02-project-status.md) · [03 Next Steps](03-next-steps.md) · [04 Feasibility](04-feasability.md) · [05 Markt-Research](05-market-research.md) · [06 Eigene Research-Engine](06-eigene-research-engine.md) · [07 KI-Clients](07-clients.md)

---

## Ausgangsfrage

In [03 Next Steps](03-next-steps.md) wurde am 2026-07-25 festgelegt: **keine eigene Research-Harness** — Claude Desktop und Claude Code sind die Engine, die Plattform erzwingt Transparenz drumherum. Das tragende Gegenargument war die Kostenunsicherheit einer Token-basierten Eigenlösung.

Die Anschlussfrage lautete: Mehrere Anbieter (Kimi/Moonshot, Z.ai, MiniMax, evtl. Perplexity) geben unter einem **Festpreis-Abo** einen echten API-Key aus. Ließe sich damit eine eigene Engine betreiben, die über das Abo statt über API-Preise abrechnet — vorausgesetzt, dieser Key deckt auch die **Websuche** ab?

Dieses Dokument beantwortet beides.

## Die kurze Antwort

Das Abo-Modell, das gesucht war, existiert praktisch nicht — und es wird nicht gebraucht.

Von den geprüften Coding-Plan-Anbietern **verbieten drei den Anwendungsfall wörtlich** (Z.ai, Moonshot, Alibaba), einer ist eine Grauzone mit einseitigem Änderungsvorbehalt (MiniMax), und **bei keinem** deckt das Abo die Websuche kostenlos ab. Perplexity hat 2026 gar kein API-Guthaben mehr im Abo.

Der entscheidende Befund liegt woanders: **Bei den Token-Preisen von 2026 existiert das befürchtete Kostenproblem nicht mehr.** Ein vollständiger Deep-Research-Lauf kostet auf DeepSeek V4-Flash rund 13 Cent, auf GLM-4.7 rund 84 Cent, auf Claude Sonnet 5 rund 3,30 $ — und alle drei erlauben die Einbettung in eigene Produkte vertraglich ausdrücklich. Bei 100 Läufen im Monat liegt DeepSeek bei ~21 $ und damit **unter dem billigsten Abo**, ohne Kontingentrisiko und ohne Grauzone.

Die zweite Kostenachse (Suche + Seitenabruf) liegt bei sauberer Architektur zwischen 0 und 10 $ im Monat. Der Seitenabruf **muss** ohnehin lokal laufen (siehe [Provenienz-K.-o.-Kriterium](#das-provenienz-k-o-kriterium)) und kostet damit nichts.

**Empfehlung:** Eigene Engine bauen, aber gegen eine Provider-Abstraktion mit Bring-your-own-**API-Key** auf regulären Pay-per-Token-APIs. Kosten hart im eigenen Code deckeln statt beim Anbieter. Den bestehenden MCP-/Claude-Code-Pfad parallel halten.

## Die vier Zugangs-Modelle

Die zentrale Erkenntnis: **Technische Funktionsfähigkeit und vertragliche Erlaubnis sind bei diesen Produkten entkoppelt.** Fast jedes Coding-Plan-Abo gibt einen normalen Bearer-Token aus, den man in fünf Minuten in einen eigenen HTTP-Client kippen kann. Dass es geht, heißt nicht, dass es erlaubt ist — und die Anbieter erkennen die Nutzung an Client-Headern und Traffic-Mustern.

### (a) Echter allgemeiner API-Key mit Flatrate

Ein Monatsabo, dessen Key ohne Nutzungsbeschränkung in beliebiger Software verwendet werden darf. Aus der ersten Reihe bietet das **niemand**. Belegbare Kandidaten sind Nischenanbieter:

- **Synthetic.new** — 30 $/Monat, 500 Requests pro 5-h-Fenster, OpenAI- *und* nativ Anthropic-kompatible Endpoints, Open-Weight-Modelle mit 128k–512k Kontext. Der Anbieter schreibt im Blog (10.01.2026) ausdrücklich, man unterstütze die Nutzung „with any frontend or service you want to". **Aber:** ToS §4.1(iv) verbietet, „automatically or programmatically extract data or Output". Blog schlägt ToS nicht — vertraglich bindend ist die Klausel.
- **Featherless.ai** — 25–200 $/Monat. Killer im Detail: Der 25-$-Tarif ist auf **32K Kontext** begrenzt, 256K gibt es erst ab 100 $. Für eine Recherche-Schleife mit gefetchten Volltexten ist der Einstiegstarif unbrauchbar. Der 50-$-„Developer"-Tarif wird „billed per token" abgerechnet, ist also gar keine Flatrate.
- **Lokale Open-Weights** (Apache 2.0 / MIT) — die einzige *garantiert* unbeschränkte Variante, weil es keinen Vertragspartner gibt.

### (b) Coding-Plan mit kompatiblem Endpoint — technisch offen, vertraglich geschlossen

Die große, verführerische Kategorie: echter Key, echte Base-URL, oft Anthropic-Messages-Protokoll — und in den AGB ein **namentliches** Verbot dieses Anwendungsfalls.

| Anbieter | Wörtliche Verbotsklausel |
|---|---|
| **Z.ai (GLM Coding Plan)** | „You shall not use the GLM Coding Plan quota for general-purpose API access or any scenarios outside such tools, **including but not limited to directly invoking model APIs from your own applications, bots, websites, SaaS products or other systems**." Plus: „SDK-based access" wird als unautorisiert benannt. Usage Policy: „Accounts with more than three violations may be banned." |
| **Moonshot (Kimi Code)** | „Kimi Code subscriptions are for **personal interactive use only**. Using it for non-interactive purposes — such as scripted batch execution or data annotation pipelines — goes beyond normal use." Plus: „Don't spoof or alter client identity information." |
| **Alibaba/Qwen** | Verbotene Szenarien namentlich: „**Custom applications: automated scripts, application backends calling the API directly, etc.**" Sanktion: „subscription suspension or API key ban." |
| **Fireworks Fire Pass** | „Allowed: Personal development, experimentation, and coding with agentic harnesses / **Prohibited: Production workloads**" |
| **Chutes.ai** | „Subscriptions are intended for casual, direct usage and **not for use in large-scale automated inference, building production applications**, or similar high-volume workloads." |

Die Sperren sind **implementiert, nicht theoretisch**. Kimi antwortet auf einen Abo-Key außerhalb der erlaubten Clients mit `access_terminated_error`: *„Kimi For Coding is currently only available for Coding Agents such as Kimi CLI, Claude Code, Roo Code, Kilo Code, etc."* (zwei unabhängige GitHub-Issues). Z.ai wertet generische SDK-Header (`x-stainless-lang`) aus und antwortet auf dem falschen Endpoint mit Fehler 1113 „Insufficient Balance" — auch bei aktivem Max-Abo mit 99 % Restkontingent.

Der ökonomische Grund ist offen ausgesprochen: Diese Pläne sind subventionierte Verlustführer, kalibriert auf einen einzelnen Menschen mit Tipppausen. Eine Research-Engine produziert keinen Code — sie ist ökonomisch genau das, was diese Anbieter aussortieren.

**Sonderfall MiniMax.** Der Token Plan (20/50/120 $) ist die einzige ernsthafte Ausnahme. Die Open-Platform-ToS enthalten **null** Treffer für „Token Plan" oder „Coding Plan", sprechen ausdrücklich von „your applications" und deren „end-users", und MiniMax dokumentiert den Abo-Key selbst mit purem Anthropic-SDK-Code und mit LangChain. Der Anthropic-Endpoint wird sogar als „Recommended" markiert.

*Aber* — Ergebnis der adversarischen Prüfung: ToS-Abschnitt „Service" Ziffer 2 inkorporiert die Dokumentation als „Service Rules" **in der jeweils aktuellen Fassung** in den Vertrag. Die heute weiche Formulierung („designed for individual, interactive developer use", „recommended to use pay-as-you-go for production use") ist damit vertraglich bindend und einseitig ohne Vorlauf verschärfbar. **Einstufung: Grauzone mit Änderungsvorbehalt, nicht „klar erlaubt".**

### (c) Abo nur über hauseigenes CLI/OAuth — kein Key

**Anthropic (Pro 20 $ / Max ab 100 $)**, **Google (AI Pro/Ultra)**, **Mistral (Le Chat/Vibe)**. Details unter [Anthropic & OpenAI](#der-blinde-fleck-anthropic--openai).

### (d) Abo mit inkludiertem API-Guthaben

**GitHub Copilot** seit 01.06.2026: Premium Requests wurden durch **AI Credits** ersetzt (1 Credit = 0,01 $, 1.500 / 7.000 / 20.000 je nach Tarif, monatlicher Verfall). Das Copilot SDK ist MIT-lizenziert und technisch ein eleganter Fit — aber es ist keine Flatrate mehr, und GitHub hat im April 2026 Neuanmeldungen für Pro/Pro+ gestoppt, weil „long-running, parallelized sessions now regularly consume far more resources than the original plan structure was built to support". Genau dieses Lastprofil. **GitHub Models wird am 30.07.2026 abgeschaltet** — darauf darf nichts gebaut werden.

## Anbieter-Vergleich

Sortiert nach Eignung. Preise Stand 2026-07-26.

| # | Anbieter / Produkt | Preis | Echter API-Key? | Endpoint | Eigene App erlaubt? |
|---|---|---|---|---|---|
| 1 | **DeepSeek Open Platform** (V4-Flash/Pro) | kein Abo, Prepaid | ja, allgemein | OpenAI + `/anthropic` | 🟢 **ausdrücklich** (ToS 1.1) |
| 2 | **Moonshot Kimi Open Platform** | kein Abo, Prepaid ab 1 $ | ja, allgemein | `api.moonshot.ai/v1` | 🟢 **ausdrücklich** (Customer-Application-Klausel) |
| 3 | **Z.ai General API** (GLM-5.2 / 4.7) | kein Abo | ja, allgemein | `api.z.ai/api/paas/v4` | 🟢 (Terms of Use) |
| 4 | **MiniMax Token Plan** | 20 / 50 / 120 $ | **ja**, `sk-cp-…` | `api.minimax.io/v1` + `/anthropic` | 🟡 Grauzone mit Änderungsvorbehalt |
| 5 | **Synthetic.new** | 30 $ | ja | OpenAI + Anthropic | 🟡 Blog erlaubt, ToS §4.1(iv) widerspricht |
| 6 | **Cerebras Code** | 50 / 200 $ | ja | `api.cerebras.ai/v1` | 🟡 AGB schweigen |
| 7 | **OpenAI ChatGPT-Abo via Codex** | 20 / 100 / 200 $ | nein, OAuth | `chatgpt.com/backend-api/codex/…` | 🟡 kein Verbot, aktive Duldung |
| 8 | **Anthropic Claude Pro/Max** | 20 $ / ab 100 $ | nein, OAuth | keiner | 🟡→🔴 siehe unten |
| 9 | **Z.ai GLM Coding Plan** | ab 18 $ | ja | `api.z.ai/api/anthropic` | 🔴 **wörtlich verboten** |
| 10 | **Kimi Code Membership** | 19–199 $ | ja | `api.kimi.com/coding/…` | 🔴 **wörtlich verboten** |
| 11 | **Alibaba Coding/Token Plan** | 6–200 $ | ja, `sk-sp-…` | `coding-intl.dashscope…` | 🔴 **wörtlich verboten** |
| 12 | **Google AI Pro/Ultra** | 21,99–219,99 € | nein | keiner | 🔴 BYOK „Not Currently Supported" |

**Nicht belegbar und daher nicht verwendbar:** Fireworks Fire Pass (Preisseite 404, Doku nennt keinen Preis), Chutes-Tageskontingente (Doku 404), Atlas-Base-URL. Awan LLM bewirbt noch Llama 3.1 als „neu" — faktisch tot.

## Websuche: deckt das Abo sie ab?

**Nein — bei keinem Anbieter.** Und die Antwort ist unwichtiger als erwartet, weil Suche billig ist.

| Anbieter | Eingebaute Suche | Im Abo? | Preis | Liefert prüfbare URLs? |
|---|---|---|---|---|
| **Moonshot / Kimi** | `$web_search` | nein — Abo enthält keine API-Credits | 0,005 $/Call (intl.), ¥0,03 (CN) **plus** Treffer als Input-Token | ❌ **nein** |
| **Z.ai / GLM** | ja, 3 Produkte | nur als MCP, harter Monatsdeckel 100/1.000/4.000 (geteilt), **kein Nachkauf** | PAYG intl. **10 $/1.000** | ✅ ja (nur auf PAYG) |
| **MiniMax** | ja (Beta) | ja, aber **nicht gratis** — 0,01 $/Suche gegen dasselbe Kontingent | 10 $/1.000 | ✅ ja |
| **DeepSeek** | ja, nur über `/anthropic` | kein Abo | keine Pro-Suche-Gebühr auf der Preisliste ¹ | ⚠️ URLs ja, Inhalt `encrypted_content` |
| **Alibaba / Qwen** | ja, 3 Produkte | kein Abo, „does not include a free call quota" | intl. **10 $/1.000**; IQS LiteAdvanced ¥12/1.000 ≈ 1,68 $ | ✅ bei IQS, ❌ am OpenAI-Protokoll |
| **Perplexity** | ja | **nein** — „API usage is not included with subscription plans" | Search API **5 $/1.000** | ✅ am besten dokumentiert |

¹ *Argument aus dem Schweigen — kein Line-Item auf der Preisseite, aber auch keine Gratis-Zusage. DeepSeek sagt selbst, die Suche erzeuge „additional LLM API requests to summarize the retrieved search content". Vor Kalkulation empirisch prüfen.*

**Entkoppelt eingekauft ist Suche drastisch billiger** — Brave (5 $ Gratis-Credits/Monat), Tavily (1.000 Credits/Monat gratis), Exa (10 $ Guthaben/Monat), Serper (~1 $/1.000). Für 100 Recherchen/Monat: **0 bis 10 $**. Z.ai und Alibaba international liegen mit 10 $/1.000 am oberen Ende des Marktes.

### Die akademischen APIs

Kein einziger kommerzieller Such-Anbieter hat einen dokumentierten wissenschaftlichen Index. Für die akademische Zielgruppe verlieren sie damit strukturell.

**OpenAlex, Crossref, Semantic Scholar, Europe PMC, arXiv, CORE, Unpaywall, DOAJ, OpenAIRE** sind kostenlos, ohne Vertrag nutzbar und liefern genau das, was die Provenienz-Kette braucht: DOI, Titel, Autoren, Jahr, Journal, Lizenz, OA-Volltext-Link — **stabile Identifikatoren statt geratener URLs**. Ein DOI ist als Provenienz-Anker ungleich wertvoller als ein Websuch-Treffer. Praxis: höflichen `User-Agent` mit Kontakt-Mail setzen (öffnet bei OpenAlex und Crossref den „polite pool"), moderat parallelisieren, lokal cachen.

Eine akademische Kaskade senkt die bezahlten Suchen pro Lauf realistisch von ~80 auf ~20.

## Das Provenienz-K.-o.-Kriterium

Wichtiger als jeder Preis: Die Plattform steht und fällt damit, dass sie jede Quelle **selbst** holt und ein wörtliches Zitat im Originaltext wiederfindet ([textmatch.ts](../src/main/core/enforce/textmatch.ts) gegen [fetchers.ts](../src/main/core/enforce/fetchers.ts)).

**Server-seitige Suche bricht das.** Moonshots `$web_search` ist architektonisch so gebaut, dass der Client die Rohtreffer *nie* sieht — er echot eine opake `search_id`, der Server injiziert die Treffer intern. Zurück kommt Modell-Fließtext mit selbst generierten Inline-Zitaten; es existiert sogar ein eigener Fehlerzustand `kimi_web_search_ungrounded`. Auch der direkte Formula-Pfad liefert nur `context.encrypted_output`. Die Kette wäre nicht „Suchtreffer → Fetch → Zitat", sondern „**Modellbehauptung** über einen Suchtreffer → Fetch → Zitat".

Konzeptionell kommt hinzu: Bei server-seitiger Suche entscheidet **das Modell**, wonach gesucht wird. `log_search` protokolliert dann etwas, das die App weder formuliert noch kontrolliert hat.

**Zwei harte Architekturregeln folgen daraus:**

1. **Jedes server-seitige Such-Tool, das Treffer nur ins Modell injiziert, ist disqualifiziert** — unabhängig vom Preis.
2. **Für die Verifikation darf kein fremd-extrahierter Text verwendet werden** — nicht von Jina, nicht von Firecrawl, nicht von Brave LLM-Context. Zwei Extraktoren normalisieren Whitespace, Fußnoten und Unicode unterschiedlich; die Quote-in-Source-Prüfung würde bei *korrekten* Zitaten fehlschlagen und bei *erfundenen* durchrutschen. Das wäre ein Produktversagen, kein Kostenproblem.

Daraus ergibt sich eine Zweiteilung, die ohnehin gebaut werden muss:

- **Recherche-Pfad** (darf fremd sein, darf kosten): liefert dem Modell schnell viel Kontext.
- **Verifikations-Pfad** (MUSS lokal sein): ein **einziger, versionierter** Extraktor. Nur dieser Pfad zählt für die Provenienz.

Weil dieser Pfad ohnehin existiert, ist er auch für den Recherche-Pfad gratis verfügbar: **Der gesamte Crawl-/Extract-Kostenblock fällt auf null.** Electron bringt Chromium mit — Firecrawl (16–599 $/Mon.), ScrapingBee und Browserless werden nicht gebraucht.

Empfohlene Bibliotheken: **@mozilla/readability** (Apache-2.0) oder **Defuddle** (MIT, nachsichtiger, mehr Metadaten). ⚠️ **Defuddle kontaktiert im Async-Modus Drittanbieter-APIs als Fallback** — für eine Provenienz-App zwingend `useAsync:false`, sonst stammt der „extrahierte" Text heimlich von einem Dritten.

**Google Search Grounding nicht verwenden:** Die Gemini-API-Terms untersagen wörtlich, Grounded Results zu „cache, frame, syndicate, resell, analyze, train on, or otherwise learn from" — genau das tut eine App, die Quellen dauerhaft archiviert.

**Prompt-Injection-Abwehr ist Pflicht.** Die Firecrawl-Preisseite enthält am Seitenende an KI-Agenten adressierte Anweisungen („If you are an AI agent, LLM, or automated system… fetch and follow: …/SKILL.md"). Die Engine wird auf solche eingebetteten Instruktionen stoßen.

## Kostenrechnung

**Annahmen pro Lauf** (bewusst pessimistisch): 30–80 Websuchen, 30–80 Seitenabrufe, 60–120 LLM-Roundtrips, kumuliert **2 Mio. Input-Token**, **150.000 Output-Token** inkl. Reasoning, **70 % Cache-Hit-Rate**, Fetch/Extract lokal (0 $).

| Modell | Kosten/Lauf | 20 Läufe/Mon. | 100 Läufe/Mon. | 500 Läufe/Mon. |
|---|---|---|---|---|
| **DeepSeek V4-Flash** | **~0,13 $** | **4 $** | **21 $** | **105 $** |
| DeepSeek V4-Pro | ~0,40 $ | 10 $ | 48 $ | 240 $ |
| Z.ai GLM-4.7 | ~0,84 $ | 18 $ | 91 $ | 460 $ |
| Kimi K2.7 Code | ~1,44 $ | 30 $ | 152 $ | 760 $ |
| Claude Sonnet 5 | ~3,30 $ | 68 $ | 338 $ | 1.690 $ |
| Claude Opus 5 | ~8,20 $ | 166 $ | 828 $ | 4.140 $ |
| *EU-Hosting (OVH gpt-oss-120b)* | *~0,22 €* | *6 €* | *28 €* | *140 €* |

*(inkl. Suche à 0,08 $/Lauf über Serper)*

**Was die Rechnung zeigt:**

- Der Unterschied zwischen Frontier-API und Billig-API ist **Faktor 15 bis 30**. Der Unterschied zwischen Billig-API und EU-Hosting ist marginal — bei DeepSeek liegt die API sogar darunter, weil Caching den Input-Vorteil des EU-Hosters auffrisst. **Die Wahl zwischen beiden ist deshalb keine Kosten-, sondern eine Datenschutzentscheidung.**
- Bei 100 Läufen/Monat kostet DeepSeek V4-Flash **21 $** — weniger als das billigste Abo, ohne Kontingentrisiko und ohne Grauzone.
- Der Grund ist das Caching: Cache-Hits kosten bei V4-Flash **2 %** des Miss-Preises, Caching ist standardmäßig aktiv (kein `cache_control`-Header nötig) und persistiert Prefixe am Ende von User-Input *und* Model-Output — exakt das Muster `A+B → A+B+C` einer Agenten-Schleife.
- **Reasoning-Token dominieren.** Perplexity veröffentlicht die Aufschlüsselung eines eigenen Deep-Research-Laufs: 0,816 $ gesamt, davon **71 % Reasoning und nur 13 % Suche**. `reasoning_effort` gehört pro Schritt gesetzt, nicht global.

## AGB & Recht

### Variante 1 — Eigenes Abo, eigene Nutzung, eigene App

| Zugang | Ampel | Begründung |
|---|---|---|
| Pay-per-Token-APIs (DeepSeek, Z.ai Standard, Moonshot Open Platform, Anthropic Console, OpenAI API, Mistral, Gemini, Perplexity, EU-Clouds) | 🟢 | Ausdrücklich lizenziert |
| Lokale Open-Weights (Apache 2.0 / MIT) | 🟢 | Kein Vertragspartner, kein sperrbares Konto |
| MiniMax Token Plan | 🟡 | Kein Verbot im Vertragstext, aber Doku als „Service Rules" inkorporiert und einseitig verschärfbar |
| Synthetic.new | 🟡 | Blog erlaubt, ToS §4.1(iv) widerspricht — schriftlich klären |
| OpenAI Codex mit ChatGPT-Abo | 🟡 | Kein AGB-Verbot, positive Signale, aber Consumer-Training standardmäßig **an** |
| Anthropic Claude Pro/Max | 🟡→🔴 | Siehe unten |
| Z.ai Coding Plan, Kimi Code, Alibaba Coding/Token Plan, Fireworks Fire Pass, Chutes | 🔴 | Wörtliches, namentliches Verbot |

⚠️ **„Ich zahle doch dafür und nutze es selbst" ist in keinem dieser Verträge eine Ausnahme.** Die Klauseln setzen am *Tool* an, nicht am Nutzerkreis.

### Variante 2 — Auslieferung an Endkunden mit BYO-Zugang

Entscheidend ist, **welche Art** von Zugang der Nutzer einträgt:

| Was der Nutzer einträgt | Ampel | Begründung |
|---|---|---|
| **BYO-API-Key** (allgemeiner Entwickler-Key) | 🟢 | Anthropic Commercial Terms A.1, Moonshot Open Platform ToS, OpenAI Services Agreement, DeepSeek ToS 1.1, Mistral („non-sublicensable *except to its End Users*"), Perplexity („within the Customer Applications") — alle decken das ausdrücklich. **Zusatzvorteil: Der Nutzer wird selbst Vertragspartner, die DSGVO-Verantwortlichkeit liegt bei ihm.** |
| **BYO-Subscription** (OAuth-Token, Coding-Plan-Key) | 🔴 | Anthropic: „does not permit third-party developers to offer Claude.ai login or to route requests through Free, Pro, or Max plan credentials **on behalf of their users**." Bei Z.ai/Kimi/Alibaba wäre die App das „unsupported tool" — jeder Kunde riskiert den Bann. |
| **Eigener Key, mitgeliefert** | 🔴 | Tavily: Key „may not be transferred, assigned, shared". MiniMax: automatische Key-Deaktivierung bei Client-Side-Exposition. In einer Electron-App ist ein Key ohnehin in Minuten extrahiert. |

**Wie der Markt das handhabt:** Kein einziges etabliertes Tool verspricht, dass der Provider-Zugang zulässig ist. Cline setzt auf BYO-Key und macht daraus ein Datenschutz-Argument. Roo Code: „You assume all risks associated with the use of any such tools or outputs." Zed bietet bewusst **kein** Claude-Abo-Login an und verweist auf die offizielle CLI. OpenCode musste am 19.03.2026 nach einer Rechtsaufforderung Anthropic-Referenzen entfernen. **Wer BYO-Subscription anbot, wurde 2026 dazu gezwungen, es zu entfernen.**

### Variante 3 — Weiterverkauf / Bündelung

🔴 **Bei jedem geprüften Anbieter verboten**, mehrfach überdeterminiert: Anthropic Consumer Terms §3.2, Kimi („Don't resell Kimi Code's capabilities as a service"), Z.ai („may not resell, sub-resell, repackage, aggregate, proxy"), Atlas („thin wrapper for raw resale is strictly prohibited"), OpenAI, GitHub Copilot (**permanente** Sperrkategorie: „We will not be able to reinstate your Copilot access"). Hinzu käme die Auftragsverarbeiter-Rolle nach Art. 28 DSGVO und wettbewerbsrechtliches Abmahnrisiko.

### DSGVO — der harte Blocker bei akademischer Zielgruppe

- **Kein Angemessenheitsbeschluss für China** (Art. 45). Jeder Transfer an Moonshot, Z.ai, MiniMax oder DeepSeek ist ein Drittlandtransfer nach Art. 44 ff.
- **Kein auffindbarer AVV** nach Art. 28 bei Moonshot, Z.ai oder DeepSeek.
- **Behördenpraxis existiert:** sieben deutsche Landesdatenschutzbehörden mit förmlichen Prüfverfahren gegen DeepSeek; LfD Niedersachsen mit formeller Empfehlung gegen Cloud-Einsatz für Personendaten.
- **Die App verarbeitet naturgemäß Daten Dritter** — Quellentexte, Autorennamen, wörtliche Zitate. Hochschulen haben eigene Freigabeprozesse; ein chinesischer Default-Provider wird dort mit hoher Wahrscheinlichkeit nicht durchgehen.
- **MiniMax:** ToS-IP-Abschnitt Ziffer 3 erlaubt breit „We may use the input and generated content to provide, maintain, develop, and **improve our Services**" — kein Opt-out, keine Zero-Retention-Zusage. Recht: Singapur, Streitbeilegung zwingend **SIAC-Schiedsverfahren** — für einen deutschen Einzelentwickler faktisch nicht durchführbar. EU-Vertreter existiert (`mars@nanonoble.com`).
- **DeepSeek:** Weder ToS noch Privacy Policy enthalten eine Aussage zur Trainingsnutzung von API-Inputs. Kein Opt-out auffindbar, keine „we do not train on API data"-Zusage. **Ungeklärt und entscheidungskritisch.**
- **EU AI Act Art. 50** greift am **02.08.2026**: Transparenz-/Kennzeichnungspflichten für Anbieter *und* Betreiber. Bußgeldrahmen **15 Mio. € / 3 %** (Art. 99(4); die häufig zitierten 35 Mio./7 % gelten nur für verbotene Praktiken nach Art. 5), für KMU auf den niedrigeren Wert gedeckelt. Konkret: Der generierte Bericht muss als KI-generiert erkennbar sein. **Die Verifikations-Leiter ist hier ein Aktivposten** und sollte offensiv als Compliance-Feature geführt werden.

**Sauberer EU-Pfad:** Die interessanten Modelle sind alle Open-Weights (GLM-5.2 MIT, Qwen Apache 2.0, DeepSeek MIT, Mistral Apache 2.0). Bezug über **Scaleway** (Paris), **OVHcloud** („Zero data retention", „Your data will never be used to train or improve our AI models"), **IONOS** oder **Nebius** löst AGB- und DSGVO-Problem in einem Schritt, zu ca. 45–50 % Aufpreis.

## Der blinde Fleck: Anthropic & OpenAI

### Anthropic — technisch trivial, vertraglich riskant

Das Claude Agent SDK startet ein Claude-Code-Binary als Subprozess, aus dem Electron-Main-Prozess per `query()` treibbar. Die OAuth-Credentials aus `claude /login` würden vererbt. Es **würde funktionieren**.

Die Rechtslage hat sich 2026 mehrfach geändert. Der im Februar 2026 zitierte harte Satz („Using OAuth tokens obtained through Claude Free, Pro, or Max accounts in any other product, tool, or service — including the Agent SDK — is not permitted") steht **heute nicht mehr** auf der Quellseite. Aktueller Stand (abgerufen 2026-07-26):

- OAuth „is intended **exclusively** for purchasers of subscription plans and is designed to support ordinary use of Claude Code and other native Anthropic applications"
- Entwickler „**should** use API key authentication"
- Hartes Verbot nur für: „offer Claude.ai login or **route requests through Free, Pro, or Max plan credentials on behalf of their users**"
- Gleichzeitig: „Advertised usage limits for Pro and Max plans assume **ordinary, individual usage of Claude Code and the Agent SDK**"

→ **Variante 1** (eigenes Abo, eigene App, eigene Arbeit): **Grauzone**, nicht eindeutig verboten. **Variante 2** (Auslieferung): eindeutig untersagt, die Klausel ist präzise darauf gemünzt.

**Planungswarnung:** Anthropic hatte am 14.05.2026 einen separaten Agent-SDK-Credit-Pool angekündigt und ihn **am Tag des Inkrafttretens pausiert**. Das Abrechnungsmodell für programmatische Nutzung ist offiziell offen. Drei Regeländerungen in sechs Monaten — wer heute darauf baut, baut auf einem als vorläufig markierten Zustand.

### OpenAI — der einzige große Anbieter, der duldet

In den EU-Terms (OpenAI Ireland Ltd.) gibt es **keine** Klausel gegen Nutzung außerhalb offizieller Clients. Stattdessen:

- Die Feature-Matrix listet „Codex SDK, `codex exec`, and scriptable workflows" als **in ChatGPT Plus enthalten**
- Die app-server-Doku beschreibt das Produkt wörtlich für „a **deep integration inside your own product**", mit ChatGPT-OAuth als erstklassigem Auth-Modus
- Der gesamte Codex-Stack ist **Apache-2.0**; ein OpenAI-Contributor: „you're welcome to fork the repo and make modifications to suit your own needs"
- Sam Altman bewarb am 01.05.2026 öffentlich die Nutzung des ChatGPT-Abos in einem Fremd-Client

**Die Lücke:** In GitHub-Discussion `openai/codex#8338` haben drei Entwickler exakt diesen Fall gestellt (eigene App, kommerzieller Vertrieb, jeder Endkunde mit eigenem Abo — 07.02., 05.05. und 20.07.2026). **OpenAI hat auf keine der drei geantwortet.** Faktisches Dulden, keine schriftliche Freigabe.

Die Klauseln, an denen Accounts tatsächlich gesperrt werden: „You may not share your account credentials" und „circumventing any rate limits". Also strikt: jeder Endkunde loggt sich mit **seinem eigenen** Account ein, keine Token-Weitergabe, kein Pooling, kein Proxy, keine Multi-Account-Rotation.

⚠️ **Bei ChatGPT Free/Plus/Pro ist Training standardmäßig aktiv**, Opt-out nur manuell in den Data Controls, und es gibt keine API, die diesen Status ausliest.

**Nebenbefund, der das Projekt bestätigt:** OpenAIs eigene GPT-5.6 System Card (09.07.2026, S. 19) sagt wörtlich: „We have observed instances of the model **cheating on tasks and fabricating research results**." METR meldete „an unusually high detected rate of 'cheating'", UK AISI 12 % der Samples. Das widerlegt das Konzept nicht — es begründet es. **Konsequenz: Die Verifikations-Leiter darf nicht abschaltbar sein.**

**Ausgeschlossen:** OpenAIs Deep-Research-API. Wörtlich: „deep research models require a specialized type of MCP server — one that implements a search and fetch interface… doesn't support tool calls or MCP servers that don't implement this interface." Die Engine muss **schreiben** — das geht damit nicht.

## Architektur-Empfehlung

### 1. Provider-Abstraktionsschicht

Ein Interface, zwei Adapter (OpenAI-kompatibel, Anthropic-kompatibel), `capabilities`-Flags für Prompt-Caching, strict-Schema, Thinking, Kontextgröße. Ohne diese Schicht ist jeder Anbieterwechsel ein Rewrite — und dieser Markt erzwingt 2026 mindestens einen Wechsel (Z.ai: Preis ×6 in sechs Monaten; Kimi: Verkaufsstopp seit 19.07.2026; GitHub: Flatrate → Credits zum 01.06.2026; Gemini CLI: Kontingente eingezogen am 18.06.2026).

### 2. MCP-Server als Client — in-process

Der MCP-Server existiert bereits. Anbindung über `InMemoryTransport` aus dem `@modelcontextprotocol/sdk`: kein Subprozess, kein Port, kein Handshake-Timeout, keine zusätzliche Angriffsfläche. Dazwischen eine **Tool-Registry**, die `tools/list` ins Provider-Format übersetzt und `tools/call` zurück.

Zwei Regeln aus der Doku-Lage: **aktive Tool-Menge unter ~15 halten** (Moonshot warnt vor „dozens or hundreds of tools", Gemini empfiehlt „10-20 maximum", Alibaba „max. 20 pro Request") und **Schemas flach halten** — mehrere Anbieter weisen tief verschachtelte Schemas zurück.

Der bestehende Server bleibt zusätzlich über stdio erreichbar. **Ein Server, zwei Transporte.**

### 3. Provenienz-Enforcement wandert von Hooks in die Schleife

Bei Claude Code lief das *neben* der Schleife. In der eigenen Engine gehört es **hinein** — und das ist strikt besser. Jeder Tool-Call durch einen Interceptor mit vier Stufen:

1. **Schema-Validierung** vor Ausführung (Zod/Ajv; bei DeepSeek zusätzlich serverseitig `strict: true` — dann kommen Pflichtfelder gar nicht erst leer an).
2. **Pflichtfeld-Prüfung** bei `add_source`: Begründung, Extraktion, Beitrag, wörtliches Zitat.
3. **Deterministische Verifikation sofort, in-Loop.** Schlägt sie fehl, gibt der Interceptor ein `tool_result` mit `is_error: true` und präziser Meldung zurück („Zitat nicht im Quelltext gefunden. Nächstliegende Übereinstimmung bei Zeichen 4.812: '…'"). Das Modell **muss** nachbessern, bevor der Lauf weitergeht.
4. **Hash-/Offset-Referenzierung statt Volltext-Kopie.** Dem Modell nach dem Fetch nicht den Volltext zum Abschreiben geben, sondern eine `document_id` plus Textblöcke mit Offsets. Das Zitat wird als `{document_id, start, end}` eingetragen und serverseitig aufgelöst.

**Punkt 4 ist die wichtigste Einzelentscheidung dieser Architektur.** Das Modell *kann* ein Zitat dann gar nicht mehr erfinden — es kann nur auf existierenden Text zeigen. Das adressiert strukturell genau das Risiko aus [04 Feasibility](04-feasability.md) (faktische Deckung 39–77 %, Degradation ~42 % mit der Recherchetiefe) und macht die Engine unabhängig von der Zitattreue des Modells.

### 4. Loop-Mechanik

- **Hartes Token-Budget pro Session** plus Monatsdeckel in der App-Config.
- **Resume-Fähigkeit.** Bei 60–120 Roundtrips reißt irgendwann einer ab. DeepSeek liefert kein SLA („AS IS"), Z.ai hatte im Juni 2026 dokumentierte Totalausfälle (bis 100 % HTTP 429 über Stunden). Zustand nach jedem Turn persistieren, Retry mit exponentiellem Backoff.
- **HTTP-Timeouts ≥ 10 Minuten.** DeepSeek schließt die Verbindung erst, wenn nach 10 Minuten keine Inferenz begonnen hat. Ein 30-Sekunden-Client-Timeout killt jeden zweiten Lauf.
- **`reasoning_effort` pro Schritt**, nicht global. Suchanfrage formulieren → `low`. Synthese → `high`.
- **Modell-Mischung**: Flash für Routine, Pro nur für Synthese. Faktor ~3 auf beiden Achsen.
- **Prompt-Cache-Disziplin**: stabiler System-Prompt, append-only Historie, Modell nicht mitten im Lauf wechseln. Cache-Rate live über `prompt_cache_hit_tokens` messen.

### 5. Such-/Fetch-Kaskade

```
1. Akademisch zuerst (kostenlos, bessere Provenienz):
   OpenAlex (Suche) → Crossref (DOI, mit mailto!) → Unpaywall (legaler OA-Volltext)
   → CORE / Europe PMC / arXiv (Volltext) → DOAJ (Seriositätsfilter)
2. Erst dann Websuche für graue Literatur, News, Nicht-Akademisches
3. Fetch: IMMER lokal (net.fetch → verstecktes BrowserWindow → Jina Reader als Fallback)
4. Extraktion: EIN versionierter Extraktor, deterministische Normalisierung
```

Das viertelt nebenbei den Suchetat.

### 6. Key-Handling in Electron

Keys in den OS-Keystore im Main-Process, **nie** ins Renderer-Bundle. DeepSeek ToS 2.2 verlangt das ausdrücklich, MiniMax deaktiviert exponierte Keys automatisch.

### 7. Was mit dem „Claude Code ist die Engine"-Weg passiert

**Parallel halten, nicht ersetzen.** Drei Gründe:

1. **Kostet nichts extra.** Der MCP-Server muss ohnehin existieren; ihn zusätzlich über stdio zu exponieren ist ein Transport, keine Architektur.
2. **Er ist der Qualitäts-Referenzpunkt.** Die Verifikations-Leiter liefert dafür ein objektives Maß: *Anteil der Quellen, die die deterministische Prüfung im ersten Anlauf bestehen.* Das ist aussagekräftiger als jeder Hersteller-Benchmark — und sämtliche Agentic-Zahlen der Anbieter (BrowseComp, MCPAtlas, τ²-bench) sind Herstellerangaben.
3. **Er ist rechtlich sauber**, weil der Nutzer sein eigenes Claude Code startet und die App nur MCP-Tools bereitstellt. Genau der von Anthropic vorgesehene Weg.

Modellierung als **zwei Engine-Modi in derselben UI**: „Externe KI (MCP)" und „Eingebaute Engine (Provider X)". Provenienz-DB, Verifikations-Leiter und geblindete Re-Verify-Session sind für beide identisch. Das ist kein Kompromiss, sondern langfristig das beste Verkaufsargument: **Die Plattform ist modellunabhängig, weil die Wahrheit nicht vom Modell kommt.**

## Vorgehen

| # | Schritt | Aufwand | Warum |
|---|---|---|---|
| **0** | **Messen statt schätzen.** DeepSeek-Account (1 $ Testaufladung — prüft nebenbei, ob eine deutsche Kreditkarte durchgeht), ein realer Research-Lauf mit V4-Flash und V4-Pro, `total_cost`, Turn-Zahl, Cache-Rate und Zitattreue messen. | 1 Tag | Die Kostenangst ist eine Hypothese. Mit echten Zahlen fällt vermutlich die halbe Anbieterfrage weg. |
| 1 | Provider-Interface + zwei Adapter, DeepSeek und MiniMax als erste Provider | 2–3 Tage | Alles danach hängt daran |
| 2 | MCP In-Process-Bridge + Tool-Registry; stdio-Transport erhalten | 2 Tage | Macht die bestehende Tool-Investition sofort nutzbar |
| 3 | Agent-Loop: Turn-Management, Budget, Resume, Retry, Timeouts, `effort` pro Schritt | 3–5 Tage | Ohne Resume reißt jeder zweite Lauf ab |
| 4 | **Provenienz-Interceptor** inkl. In-Loop-Verifikation und Offset-Referenzierung | 3 Tage | Das ist das Produkt. Alles andere ist Infrastruktur. |
| 5 | Such-/Fetch-Kaskade, lokaler Extraktor, **Prompt-Injection-Abwehr** | 3–4 Tage | Halbiert Kosten *und* verbessert Provenienzqualität |
| 6 | Kostendashboard + harte Deckel, Balance-Abfrage | 2 Tage | Die eigentliche Antwort auf „unkalkulierbar" — sie liegt im eigenen Code, nicht in einem Abo |
| 7 | Eval-Harness: 10 feste Research-Fragen, alle Kandidaten, Metrik = Anteil im ersten Anlauf verifizierter Quellen + Kosten + Abbruchrate | 2 Tage | Danach wird mit Daten entschieden statt mit fremden Benchmarks |
| 8 | *Optional:* MiniMax Plus einen Monat messen; EU-Pfad evaluieren (Scaleway GLM-5.2 — **Function Calling testen**, das ist ein Ausschlusskriterium) | je 1–2 Tage | Erst wenn 0–7 stehen |

**Gesamt: ~3–4 Wochen.** Schritt 0 liefert den größten Erkenntnisgewinn pro Stunde.

Parallel dazu bleibt die Priorität aus [03 Next Steps](03-next-steps.md) unverändert: **Spike 1–3** müssen laufen. Die eigene Engine ändert nichts an der Kernannahme — sie macht die Spikes nur billiger durchführbar, weil man 100 Läufe für 21 $ fahren kann.

## Offene Punkte

**Nicht belegt — nicht als gesichert weitergeben:**

1. **DeepSeek: Training auf API-Inputs.** Weder ToS noch Privacy Policy enthalten eine Aussage, kein Opt-out, keine Negativzusage. → Anfrage an `privacy@deepseek.com`.
2. **DeepSeek AVV nach Art. 28 DSGVO** — laut Sekundärquelle nicht angeboten. „Nicht gefunden" ist nicht „existiert nicht".
3. **DeepSeek Peak-Aufschlag** — am 29./30.06.2026 angekündigt (Verdopplung 08:00–12:00 MESZ), am 26.07.2026 auf der offiziellen Preisseite **nicht umgesetzt**, kein Startdatum. Vor Produktivstart erneut prüfen.
4. **MiniMax-Kontingente für Plus und Max** sind nicht veröffentlicht (nur „Up to 12.5B tokens/month" für Ultra). Nur messbar. M3 steht auf AA-Briefcase (agentic knowledge work) auf **#17 von 56** — Mittelfeld, nicht Spitze.
5. **MiniMax Issue #19** (offen seit 17.06.2026, ohne Maintainer-Antwort): M3 reicht bei *verketteten* Tool-Calls die Ausgabe des ersten Tools nicht durch, sondern rekonstruiert das Schema aus dem eigenen Reasoning. Bewertung dort: M3 = 2/5, M2.5 besteht konsistent. **Für die Kette „Suchergebnis → Fetch → wörtliches Zitat" ist das der kritischste denkbare Fehlermodus** — die Offset-Referenzierung (Architektur, Punkt 3.4) umgeht ihn strukturell.
6. **Moonshot Anthropic-Endpoint.** Ob `api.moonshot.ai/anthropic` offiziell dokumentiert ist, war zwischen zwei Prüfungen strittig. `platform.moonshot.ai` leitet inzwischen per 301 auf `platform.kimi.ai` um. Vor Nutzung selbst verifizieren.
7. **Z.ai Coding-Plan-Kontingent** ist großzügiger als oft dargestellt: „One prompt refers to one query. **Each prompt is estimated to invoke the model 15–20 times.**" Ein Prompt ist eine Nutzeranfrage inklusive Agenten-Schleife, kein Roundtrip. Ändert nichts am AGB-Verbot.
8. **Z.ai Pro/Max-Preise** (72 $/160 $) nur sekundär belegt; offiziell existiert nur „Starting at just 18 USD per month", eine andere Quelle nennt 80 $ für Max.
9. **Brave Search API ToS** nicht öffentlich auffindbar (hinter Dashboard-Login). Ungeklärt, ob der Plan **Speicher- und KI-Nutzungsrechte** einschließt — für diese Architektur die entscheidende Klausel. Vor Nutzung im Dashboard lesen.
10. **Perplexity Multi-Query-Abrechnung:** Ob ein Request mit 5 Queries als 5 Requests zählt, sagt die Doku nirgends. Konservativ kalkulieren, empirisch messen.
11. **Zahlung aus Deutschland** ist bei DeepSeek, Kimi, Z.ai und Alibaba nicht verifiziert. Ebenso ungeklärt: Reverse-Charge/USt-Behandlung.
12. **Index-Tiefe für Deutsch und Fachliteratur** — kein Anbieter macht dazu eine belastbare Aussage. Z.ai akzeptiert im OpenAPI-Schema nur `Accept-Language: en-US,en`, Moonshots Tool ignoriert `language`/`country`/`freshness`, Alibabas Kategorien sind auf China zugeschnitten. **Das ist die einzige Zahl, die keine Recherche liefern kann:** zehn echte Fachfragen der Zielgruppe gegen Brave, Tavily, Exa, Perplexity und OpenAlex feuern und die Trefferlisten manuell vergleichen. Ein Nachmittag.

**Was sich schnell ändern kann:** Preise, Kontingente und ganze Produkte. Belege allein aus dem ersten Halbjahr 2026: Z.ai ×6 in sechs Monaten, Kimi-Verkaufsstopp ab 19.07., GitHub Flatrate → Credits zum 01.06., Gemini-CLI-Kontingente eingezogen am 18.06., Qwen-OAuth-Freikontingent abgeschaltet am 15.04., GitHub Models † 30.07.2026, Google CSE † 01.01.2027. **Den Anbieterwechsel als Feature bauen, nicht als Notfall.**

---

### Methodik

Grundlage sind zwei Multi-Agenten-Recherchen vom 2026-07-26: eine breite Anbieteranalyse (15 Recherche-Agenten, 7 adversarische Prüfungen, ~3,6 Mio. Tokens, ~1.600 Tool-Aufrufe) und eine Fokus-Recherche zur Frage „Websuche im Abo" (4 Recherche-Agenten, 4 Prüfungen). Jeder Prüf-Agent hatte den Auftrag, den jeweiligen Erst-Report zu **widerlegen**, mit direktem Abruf der Primärquellen und der Regel „im Zweifel nicht bestätigt".

**Prüfergebnis:** 5 Reports hielten stand, 6 wurden teilweise korrigiert. Die Korrekturen sind oben eingearbeitet — u. a. der Bußgeldrahmen des EU AI Act (15 Mio./3 % statt 35 Mio./7 %), Anthropics inzwischen entschärfte Credential-Policy, MiniMax' vertraglich inkorporierte Doku und die Datennutzungsklausel, Cerebras' tatsächliche TPM-Limits und Z.ais Prompt-Definition.

Trotz Verifikation gilt: KI-gestützte Recherche ist nicht fehlerfrei. Alles unter [Offene Punkte](#offene-punkte) ist ausdrücklich **nicht** belastbar. Entscheidungskritische Zahlen vor verbindlichen Schritten selbst gegenprüfen — insbesondere Preise, die sich in diesem Markt im Monatsrhythmus ändern.
