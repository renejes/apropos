# Research Overview Platform

Transparente KI-Research: Eine local-first Desktop-App mit **eingebautem MCP-Server**, die jede von einer KI genutzte Quelle mit erzwungener Provenienz erfasst (warum diese Quelle / was wurde extrahiert / welcher Beitrag + **wörtlicher Beleg**), Belege **deterministisch verifiziert**, einen **geblindeten Re-Verify-Pass** für beliebige KI-Clients anbietet und am Ende ein **zitierbares Provenienz-Artefakt** exportiert.

> Leitprinzip: KI-Einträge sind nie Wahrheit, sondern *zu verifizierende Behauptungen* mit Status und Konfidenz. Der menschliche Sign-off ist nur in der App möglich — keine KI kann ihn über MCP setzen.

**Neu hier oder neuer Chat?** → [HANDOVER.md](HANDOVER.md) gibt den vollständigen Kontext: Ziel, Stand, Architektur, Fallstricke und die Entscheidungen samt Begründung.

Konzept & Research: siehe [documentation/](documentation/) (01 Implementation-Plan … 07 KI-Clients).

## Stack

Electron (Node in-process) · React 18 + Tailwind CSS v4 + Material Symbols · better-sqlite3 (WAL, FTS5) · `@modelcontextprotocol/sdk` v1 (Streamable HTTP auf `127.0.0.1` + stdio) · Zod · Vitest.

## Entwicklung

```bash
npm install

# Tests (Node-ABI)
npm test          # Unit-Tests (Textmatch, Repo)
npm run smoke     # E2E: echter MCP-Client gegen den eingebauten Server
                  # inkl. Fabrikations-Erkennung + Multi-Client-Concurrency

# App starten (Electron-ABI für better-sqlite3 nötig)
npm run abi:electron
npm run dev

# zurück zu Tests: npm run abi:node
```

`better-sqlite3` ist ein natives Addon — Node- und Electron-ABI unterscheiden sich. `abi:node` / `abi:electron` schalten um (lädt i. d. R. Prebuilds, kein Kompilieren).

## KI-Clients verbinden

**Streamable HTTP** (Claude Desktop Connectors, Cursor, VS Code …): Endpoint aus der App übernehmen (Einstellungen), Standard: `http://127.0.0.1:8790/mcp`. Mehrere Clients können gleichzeitig andocken.

**stdio** (Claude Desktop `claude_desktop_config.json`): Die fertige Config in den App-Einstellungen kopieren — sie startet den gebündelten Server über das Electron-Binary im Node-Modus (`ELECTRON_RUN_AS_NODE=1`), damit die native SQLite-ABI zur App passt:

```json
{
  "mcpServers": {
    "research-overview": {
      "command": "<pfad-zu>/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron",
      "args": ["<projekt>/out/main/stdio.js"],
      "env": { "ELECTRON_RUN_AS_NODE": "1" }
    }
  }
}
```

(Manueller Start: `npm run mcp:stdio`; unter Node-ABI für Entwicklung: `npm run mcp:stdio:dev`.)

Beide Wege teilen sich dieselbe SQLite-DB (WAL) — Einträge erscheinen live in der App.

## MCP-Tools (Auszug)

| Tool | Zweck |
|---|---|
| `create_project` / `list_projects` / `get_project_state` | Projekt-Lebenszyklus (read/write) |
| `add_source` | Quelle mit Pflicht-Provenienz; Server prüft sofort URL + wörtliches Zitat gegen den echten Quelltext |
| `log_extraction` / `link_claim_to_source` | Feingranulare Extraktionen; Aussagen↔Quellen (many-to-many, auch `contrasts`) |
| `add_report_version` / `add_chat_log` | Unveränderliche Berichts-Snapshots; Chat-Protokoll als Provenienz |
| `flag_uncertainty` / `request_review` | Unsicherheit erst-klassig machen |
| `re_verify` / `get_next_unverified_claim` / `submit_verdict` | Verifikations-Leiter: deterministischer Pass + **geblindeter** Cross-Context-Judge |

## Claude Code / Claude Desktop einbinden (empfohlene Nutzung)

Die Plattform baut bewusst **keine eigene Research-Engine** — sie macht sich das Research-Verhalten von Claude zunutze und erzwingt dabei Transparenz:

1. **Claude Code (stärkster Weg — deterministisch):** MCP-Server verbinden + Skill [skills/transparent-research](skills/transparent-research/SKILL.md) + **Provenienz-Gate-Hooks** ([provenance-gate.cjs](skills/transparent-research/hooks/provenance-gate.cjs)). Die Hooks blockieren jede weitere Web-Recherche, bis die letzte Quelle per `add_source`/`exclude_source` dokumentiert und jede Suche per `log_search` protokolliert ist — inklusive Turn-Ende-Sperre. Fertiges Settings-Snippet: App → Einstellungen. **Multi-Agent:** `transparent_research` mit `parallel_agents: "4"` lässt einen Orchestrator parallele Recherche-Subagenten ins selbe Projekt loggen (bei Hooks `ROP_MAX_PENDING` erhöhen). **Nachrecherche:** Prompt `extend_research` (project_id + Lücke) ergänzt bestehende Projekte gezielt, mit fortgeführter `[S#]`-Nummerierung und `contrasts`-Meldung bei Widersprüchen.
2. **Claude Desktop (bequemster Weg):** MCP-Server verbinden, dann im +‑Menü den Prompt **„Transparente Research starten"** wählen — der komplette Arbeitsvertrag wird injiziert (Best-Effort, ohne harte Hooks; das Server-seitige Enforcement — Pflichtfelder, Live-Quote-Check, Nonce-Audit — greift trotzdem immer).
3. **Verifikation:** Danach in einer *neuen* Unterhaltung den Prompt **„Geblindete Verify-Session starten"** ausführen; menschlicher Sign-off in der App.
4. **Weiterarbeiten & Diskutieren:** In beliebigen späteren Chats den Prompt **„Über eine Research sprechen"** (`discuss_research`) wählen — die KI lädt das Projekt, beantwortet Fragen strikt aus den erfassten Quellen (inkl. Verifikationsstatus, via `search_sources` gezielt durchsuchbar), überarbeitet den Bericht als neue Version und startet dabei garantiert **keine** neue Recherche. (In Claude Desktop dafür den Research-Modus-Schalter aus lassen.)

## Verifikations-Leiter

1. **Deterministisch** (kein Modell): URL/DOI-Auflösung + Quote-in-Source (exakt/normalisiert/fuzzy) — läuft automatisch bei `add_source` und per Button in der Übersicht.
2. **Geblindete KI-Verifikation**: neue Chat-Session, gleicher MCP-Server — sieht nur Aussage + frisch gefetchten Quelltext, nie die Original-Begründung.
3. **Cross-Client** (optional): Verifikation in einem anderen KI-Anbieter.
5. **Mensch-Sign-off**: pro Quelle in der App; wird als Review-Kante im append-only `event_log` protokolliert.

## Projektstruktur

```
src/main/core/        DB (Schema, Repo, Event-Log), Enforcement (textmatch, fetchers, verify), Export, Seed
src/main/mcp/         MCP-Server (Tools), HTTP-Transport (Session-Map), stdio-Entry
src/main/index.ts     Electron Main + eingebauter MCP-HTTP-Server
src/preload/          Typisierte IPC-Brücke
src/renderer/         React-UI (Tailwind): Übersicht, Quellen-Review, Aussagen, Berichte, Protokoll, Audit
scripts/smoke.ts      E2E-Smoke (MCP-Client, Fixture-Quelle, Concurrency)
documentation/        Research- & Plan-Dokumente (01–05)
```
# research-overview-platform
