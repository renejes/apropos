# 07 · KI-Clients anbinden

> Welche Clients den eingebauten MCP-Server tragen, wie sie eingerichtet werden — und woran es bei den anderen scheitert.

|  |  |
|---|---|
| **Projekt** | Research Overview Platform |
| **Dokument** | 07 — KI-Clients anbinden |
| **Stand** | 2026-08-19 · v1.1 |
| **Grundlage** | Quellcode-Prüfung von 20 Clients (2026-07-30), Cursor-Onboarding 2026-08-19 |

**Dokument-Set:** [01 Implementationplan](01-implementationplan.md) · [02 Projekt-Status](02-project-status.md) · [03 Next Steps](03-next-steps.md) · [04 Feasibility](04-feasability.md) · [05 Markt-Research](05-market-research.md) · [06 Eigene Research-Engine](06-eigene-research-engine.md) · [07 KI-Clients](07-clients.md)

---

## Kurzfassung

Der Server ist **nicht an einen Client gebunden**. Streamable HTTP auf `127.0.0.1:8790/mcp` funktioniert in 17 von 20 geprüften Clients — der Transport war nie das Problem.

Was bricht, sind **MCP-Prompts**: Nur sechs Clients können sie mit Argumenten *ausführen*. Deshalb spiegelt der Server jeden Prompt zusätzlich als Werkzeug (`start_transparent_research` usw.) — damit ist der Einstieg überall erreichbar.

**Primärer Alltagsweg: Cursor.** Der Server-Enforcement plus die Projekt-Rule ersetzen Claude-Code-Hooks. Für Ollama-Desktop weiter empfohlen: **Goose** und **DeepChat**. Cherry Studio funktioniert mit Einschränkungen.

## Was ein Client können muss

| Eigenschaft | Warum sie trägt |
|---|---|
| **Streamable HTTP** | Der Server läuft auf `127.0.0.1:8790/mcp`. stdio ist der Notweg. |
| **Mehrrundiger Tool-Loop** | Eine Recherche braucht 10–40 Werkzeugaufrufe in Folge. Clients mit niedrigem Deckel brechen mittendrin ab. |
| **`isError` erreicht das Modell** | Ein fehlgeschlagenes Zitat ist eine Korrekturaufforderung. Verschluckt der Client sie, ist die Selbstkorrektur tot. |
| **Lange Werkzeug-Beschreibungen** | Sie tragen den Arbeitsvertrag. Wer kürzt, schneidet die Regeln weg. |
| **Ollama-Anbindung** | Für den Cloud-Weg über den lokalen Daemon. |

MCP-Prompts sind **kein** Muss mehr — die Spiegel-Werkzeuge decken das ab.

---

## Cursor (primärer Alltagsweg)

Cursor spricht Streamable HTTP nativ. Es gibt **kein Hook-System** wie in Claude Code — Provenienz hängt am Server plus einer Cursor-Rule.

### Einrichten

1. Research Overview Platform starten (`npm run abi:electron && npm run dev`), bis der Endpoint in den Einstellungen „läuft“ zeigt.
2. MCP eintragen — im Repo liegt bereits [`.cursor/mcp.json`](../.cursor/mcp.json). Global: `~/.cursor/mcp.json`.

```json
{
  "mcpServers": {
    "research-overview": {
      "url": "http://127.0.0.1:8790/mcp"
    }
  }
}
```

Kein `"type"`-Feld. Cursor erkennt den Transport am `url`-Schlüssel. `"type": "streamable-http"` kann `cursor-agent mcp list` die **gesamte** Datei stillschweigend verwerfen (IDE akzeptiert es, CLI nicht).

3. Fenster neu laden. Status-Punkt am Server muss grün sein.
4. **Agent-Modus** (nicht Chat) — MCP-Werkzeuge werden im Chat ignoriert.
5. Werkzeuge einmalig freigeben. Standard ist Bestätigung pro Aufruf; eine Recherche braucht 10–40 Calls.

Die Rule [`.cursor/rules/transparent-research.mdc`](../.cursor/rules/transparent-research.mdc) ist der Arbeitsvertrag. Kopierbar aus den App-Einstellungen.

### Research starten

Im Agent: *„Starte eine transparente Research zur Frage …“* oder das Werkzeug `start_transparent_research` aufrufen. Nicht den MCP-Prompt `transparent_research` erwarten — Cursor führt Prompts mit Argumenten nicht zuverlässig aus.

### Fallstricke

- **Chat statt Agent** — Werkzeuge existieren, werden aber nicht aufgerufen.
- **App nicht gestartet** — `127.0.0.1:8790` ist tot, Cursor zeigt den Server rot.
- **Client-Websuche statt `fetch_source`** — Quellen landen nicht in der DB, Zitate sind wieder fälschbar. Die Rule und die Tool-Beschreibung sagen das; der Server kann Cursor-Websuche nicht blocken.
- **Tool-Limit / Freigaben** — mittendrin abbrechen wirkt wie ein Fehler der Plattform.

---

## Goose (empfohlen für Ollama-Desktop)

Apache-2.0, Linux Foundation. Desktop **und** CLI. Der einzige geprüfte Client, der alle fünf Eigenschaften erfüllt **und** die Server-Instructions automatisch in den System-Prompt zieht.

### Einrichten

```bash
# 1. Ollama vorbereiten (Cloud-Weg)
ollama serve
ollama signin
# Verfügbare Cloud-Modelle: https://ollama.com/search?c=cloud
ollama pull <modell>

# 2. Goose auf Ollama zeigen
goose configure          # Provider: Ollama, Host: http://localhost:11434

# 3. Den MCP-Server anbinden
goose configure          # Add Extension → Remote Extension (Streamable HTTP)
                         # URL: http://127.0.0.1:8790/mcp
```

Alternativ direkt in `~/.config/goose/config.yaml`:

```yaml
extensions:
  research-overview:
    enabled: true
    type: streamable_http
    name: research-overview
    uri: http://127.0.0.1:8790/mcp
    timeout: 300
```

### Research starten

```
/prompt transparent_research research_question="Deine Frage"
```

**Nur im CLI.** Im Desktop zerreißt Goose mehrwortige Prompt-Argumente an Leerzeichen (`split_whitespace()` statt `shlex`) — aus deiner Frage würde das erste Wort. Im Desktop stattdessen das Spiegel-Werkzeug nutzen: einfach im Chat *„Nutze start_transparent_research für die Frage …"* schreiben.

### Was gut ist

- **`DEFAULT_MAX_TURNS = 1000`** — das höchste Limit aller geprüften Clients. Deine 10–40 Aufrufe sind unkritisch.
- **`isError` kommt unverfälscht am Modell an.** Die Selbstkorrektur funktioniert.
- **Server-Instructions werden automatisch gelesen** und in den System-Prompt gelegt. Der Arbeitsvertrag greift, ohne dass jemand einen Prompt ausführt.
- Keine Kürzung von Werkzeug-Beschreibungen.
- SSE ist bewusst entfernt — Streamable HTTP ist erster Bürger.

### Fallstricke

- **Kein `{{WORKING_DIR}}`** in Server-Instructions schreiben: Goose ersetzt diesen Platzhalter.
- Prompt-Argumente mit Leerzeichen nur im CLI.

---

## DeepChat (empfohlen)

Apache-2.0, Electron-Desktop. Die beste Kombination aus Bedienbarkeit und Korrektheit.

### Einrichten

1. **Einstellungen → Provider → Ollama** aktivieren, Base-URL `http://localhost:11434`.
2. Am gewählten Modell **Tool-/FunctionCall-Fähigkeit aktivieren** — sonst greift ein XML-Fallback-Prompt statt echter Werkzeugaufrufe.
3. **Einstellungen → MCP → Server hinzufügen:**
   - Typ: `http`
   - URL: `http://127.0.0.1:8790/mcp`
4. **`autoApprove` auf `read` + `write`** setzen. Sonst bestätigst du jeden einzelnen Aufruf — bei 40 Aufrufen unbenutzbar. Mit Freigabe sind es maximal zwei Dialoge pro Unterhaltung.

### Research starten

Im Eingabefeld `/` tippen → `transparent_research` wählen → DeepChat generiert ein **Argument-Formular**. Alternativ das Spiegel-Werkzeug `start_transparent_research`.

### Was gut ist

- **128 Werkzeugaufrufe pro Runde, unbegrenzte Runden.** Die Schleife endet erst, wenn das Modell keine Werkzeuge mehr aufruft.
- **`isError` wird vollständig ans Modell durchgereicht** — Flag und Inhalt.
- **Keine Kürzung** von Namen oder Beschreibungen (Präfix nur bei Namenskollisionen zwischen Servern).
- MCP-Prompts mit echtem Argument-Formular.
- Nativer Ollama-Provider mit API-Key-Pfad.

### Fallstricke

- Beta-Zweig (1.1.0-beta.x), dafür mehrmals wöchentlich Releases.
- Mehrere Prompt-Nachrichten werden zu einem Block abgeflacht — deine Prompts liefern ihren Vertrag ohnehin in einer Nachricht.

---

## Cherry Studio (funktioniert, mit Einschränkungen)

AGPL-3.0. Die ausgereifteste Allround-App, aber mit Vorbehalten.

**Nimm v1.9.12, nicht v2.** In v2.0.0-rc.2 ist die Ausführung von MCP-Prompts entfernt worden — der Prompt-Einstieg bricht dort weg. Über das Spiegel-Werkzeug `start_transparent_research` funktioniert es in beiden Versionen.

### Einrichten

1. **MCP-Server hinzufügen**, Typ `streamableHttp`, URL `http://127.0.0.1:8790/mcp`.
2. **Ollama-Provider** einrichten (Base-URL `http://127.0.0.1:11434/api`). Cloud-Modelle müssen von Hand eingetragen werden — der Katalog kennt sie nicht.
3. **`maxToolCalls` von 20 auf mindestens 60 erhöhen** (Assistenten-Einstellungen). Beim Erreichen wirft Cherry Studio einen **Fehler statt eines Teilergebnisses** — eine abgebrochene Recherche sieht dann nach einem Fehler der Plattform aus.

### Was gut ist

Streamable HTTP mit automatischem Fallback, echtes Function-Calling über den Ollama-Provider, `isError` erreicht das Modell und bricht den Loop nicht ab, Beschreibungen werden nicht gekürzt.

---

## Nicht empfohlen

| Client | Grund |
|---|---|
| **5ire** | Auf dem Ollama-Provider ist `isError` **defekt**: Das Modell sieht bei jedem fehlgeschlagenen Aufruf eine **leere** Antwort. Die Selbstkorrektur ist tot. Ausweg: statt des Ollama-Providers einen OpenAI-kompatiblen Provider auf `http://localhost:11434/v1` anlegen. Kürzt zudem Beschreibungen über 1.000 Zeichen. |
| **AnythingLLM** | Funktional stark, aber `AGENT_MAX_TOOL_CALLS` steht auf **10**. Muss auf 60 erhöht werden, dazu `@agent`-Modus. Config braucht zwingend `"type": "streamable"` — ohne das nimmt es stillschweigend SSE an und der Server wirkt kaputt. |
| **oterm** | Stirbt nach **einer** fehlgeschlagenen Korrektur (`retries = 1`, nicht konfigurierbar). Genau das Muster „Zitat korrigieren" läuft in die Wand. |
| **Cline** | Zeigt Slash-Commands `/mcp:research-overview:transparent_research` an, obwohl `prompts/get` gar nicht existiert — der Befehl läuft ins Leere. |
| **LM Studio** | Kein Ollama-Provider (eigene Engine). Für den Cloud-Weg irrelevant. |
| **Tome** | Kann Streamable HTTP strukturell nicht; Projekt ruht seit Oktober 2025. |
| **LibreChat / Open WebUI** | Laufen im Container: `127.0.0.1` zeigt dort auf den Container. Es braucht `host.docker.internal` in **beiden** Allowlists — der eigenen (`ROP_ALLOWED_HOSTS`) und der von LibreChat. LibreChat blockt private Ziele zusätzlich per Default. |

---

## Der stärkste Weg ist kein dritter Client

Wer Ollama-Modelle **und** volle MCP-Unterstützung will, braucht keine dritte App:

```bash
ANTHROPIC_BASE_URL=http://localhost:11434 ANTHROPIC_AUTH_TOKEN=ollama claude
claude mcp add --transport http research-overview http://127.0.0.1:8790/mcp
```

MCP sitzt in Claude Code client-seitig und ist orthogonal zum Modell-Endpunkt — du tauschst nur das Backend und behältst alles Verifizierte. Bei Cloud-Modellen umgeht Ollama die lokale Anthropic-Konvertierung vollständig, es gibt also kein Schema-Stripping.

Zwei Fußnoten: Alle drei Modellstufen (Opus/Sonnet/Haiku) zeigen auf dasselbe Ollama-Modell — auch Housekeeping-Aufrufe verbrauchen Kontingent. Und die Claude-**Desktop**-Integration hat Ollama entfernt (*„Claude Desktop is no longer supported by `ollama launch`"*).

## Und für Ollama-Nutzer: der eigene Engine-Modus

Der Modus **Eingebaute Engine** in der App bleibt für Ollama der bessere Weg — aus drei belegbaren Gründen:

1. **Kein Dritt-Client außer Goose liest die Server-Instructions.** Anderswo hängt der Arbeitsvertrag allein an Werkzeug-Beschreibungen.
2. **Die provenienzkritischen Randfälle behandelt nur der eigene Code**: leere Antwort bei erschöpftem Kontingent, Fehler mitten im Stream, 404 auf abgeschaltete Modelle. Fremde Clients zeigen eine leere Antwort einfach als Ergebnis.
3. **Client-Defaults brechen Recherchen mittendrin ab** — und für den Nutzer sieht das nach einem Fehler *dieser* Plattform aus.

---

## Server-Konfiguration

| Variable | Zweck |
|---|---|
| `ROP_ALLOWED_HOSTS` | Zusätzliche Host-Namen für den Rebinding-Schutz, kommagetrennt. Standard ist streng `127.0.0.1`, `localhost`, `[::1]`. Für Docker-Clients: `host.docker.internal`. |
| `ROP_MAX_PENDING` | Wie viele abgerufene, aber undokumentierte Quellen gleichzeitig offen sein dürfen (Standard 3). |
| `ROP_CONTACT_EMAIL` | Kontakt-Mail für den „polite pool" von OpenAlex und Crossref. |

---

### Methodik

Grundlage ist eine Multi-Agenten-Recherche vom 2026-07-30: sechs Spuren (Cherry Studio, DeepChat/5ire, Desktop-Feld, Server/Terminal, Ollama-Cloud, Rückfall-Architektur), jede adversarisch gegengeprüft, mit Quellcode-Belegen auf Datei- und Zeilenebene. **Kein Client wurde praktisch getestet** — alle Aussagen stammen aus Repository-Inspektion, Issues und Dokumentation. Vor produktiver Nutzung eines Clients: einmal einen echten Lauf fahren.
