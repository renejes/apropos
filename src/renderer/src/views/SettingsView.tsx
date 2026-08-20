import { useCallback, useEffect, useState } from 'react'
import type { ServerInfo } from '../../../shared/types'
import type { ModelInfo, ProviderHealth } from '../../../main/core/providers/types'
import { CURSOR_PERMISSIONS_JSON, CURSOR_RULE_MDC, cursorMcpJson } from '../../../shared/cursor-onboarding'
import { Badge, Button, Card, Icon, SectionTitle } from '../components/ui'
import CursorSettings from '../components/CursorSettings'

/** MCP-Verbindungsinfos + Demo-Seed. */
/**
 * Ollama-Status für den Modus „Eingebaute Engine".
 * Zeigt bewusst DREI getrennte Bedingungen, weil sie unterschiedliche Abhilfe
 * verlangen: Daemon erreichbar, Cloud freigegeben, Modelle registriert.
 * Ein einzelnes „funktioniert nicht" wäre hier nutzlos.
 */
function OllamaPanel() {
  const [health, setHealth] = useState<ProviderHealth | null>(null)
  const [models, setModels] = useState<ModelInfo[]>([])
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setBusy(true)
    try {
      const [h, m] = await Promise.all([window.api.providerHealth(), window.api.providerModels()])
      setHealth(h)
      setModels(m)
    } finally {
      setBusy(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const cloudModels = models.filter((m) => m.cloud)
  const localModels = models.filter((m) => !m.cloud)

  return (
    <Card className="p-5">
      <div className="mb-3 flex items-center justify-between gap-3">
        <SectionTitle>Eingebaute Engine (Ollama)</SectionTitle>
        <Button variant="ghost" icon="refresh" onClick={load} disabled={busy} title="Status neu prüfen" />
      </div>

      {!health ? (
        <p className="text-sm text-slate-400">Prüfe …</p>
      ) : (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-1.5">
            {health.reachable ? (
              <Badge tone="emerald" icon="check_circle">
                Daemon erreichbar{health.version ? ` · v${health.version}` : ''}
              </Badge>
            ) : (
              <Badge tone="red" icon="cancel">
                Daemon nicht erreichbar
              </Badge>
            )}
            {/* Cloud-Status nur zeigen, wenn der Daemon läuft — sonst ist die Ursache
                der Daemon, und „Cloud gesperrt" schickt in die falsche Richtung. */}
            {health.reachable &&
              (health.cloud.available ? (
                health.cloud.signedIn === false ? (
                  <Badge tone="amber" icon="login">
                    nicht angemeldet
                  </Badge>
                ) : (
                  <Badge tone="emerald" icon="cloud">
                    Cloud{health.cloud.plan ? ` · ${health.cloud.plan}` : ''}
                  </Badge>
                )
              ) : (
                <Badge tone="amber" icon="cloud_off">
                  Cloud gesperrt
                </Badge>
              ))}
            {models.length > 0 && (
              <Badge tone="slate" icon="deployed_code">
                {cloudModels.length} Cloud · {localModels.length} lokal
              </Badge>
            )}
          </div>

          {health.note !== 'ok' && (
            <p className="mb-3 rounded-lg border border-amber-200 bg-amber-50/60 px-3 py-2 text-xs text-amber-900">{health.note}</p>
          )}

          {models.length > 0 && (
            <ul className="mb-3 space-y-1 text-xs">
              {models.slice(0, 12).map((m) => (
                <li key={m.id} className="flex items-center justify-between gap-2 rounded px-2 py-1 hover:bg-slate-50">
                  <span className="flex items-center gap-1.5 text-slate-700">
                    <Icon name={m.cloud ? 'cloud' : 'computer'} className="!text-[15px] text-slate-400" />
                    {m.id}
                  </span>
                  <span className="text-slate-400">{m.sizeBytes ? `${(m.sizeBytes / 1e9).toFixed(1)} GB` : 'Cloud'}</span>
                </li>
              ))}
            </ul>
          )}

          <p className="text-[11px] leading-relaxed text-slate-400">
            Der lokale Daemon bedient lokale <em>und</em> Cloud-Modelle über dieselbe API. Cloud-Modelle einmalig registrieren:{' '}
            <code className="rounded bg-slate-100 px-1">ollama signin</code>, verfügbare Modelle auf{' '}
            <code className="rounded bg-slate-100 px-1">ollama.com/search?c=cloud</code>, dann{' '}
            <code className="rounded bg-slate-100 px-1">ollama pull &lt;name&gt;</code>. Ausführlicher Check inklusive
            Werkzeugaufruf-Test: <code className="rounded bg-slate-100 px-1">npm run ollama:check &lt;modell&gt;</code>. Prüfe den Namen
            vor dem Pull — Ollama nimmt Cloud-Modelle laufend vom Netz.
          </p>
        </>
      )}
    </Card>
  )
}

export default function SettingsView({ onSeeded }: { onSeeded: () => void }) {
  const [info, setInfo] = useState<ServerInfo | null>(null)
  const [copied, setCopied] = useState<string | null>(null)
  const [seedMsg, setSeedMsg] = useState<string | null>(null)

  useEffect(() => {
    void window.api.serverInfo().then(setInfo)
  }, [])

  const copy = (label: string, text: string) => {
    void navigator.clipboard.writeText(text)
    setCopied(label)
    setTimeout(() => setCopied(null), 2000)
  }

  if (!info) return null

  // Direkt aus ServerInfo — Electron-as-Node teilt die native ABI mit der App (Review-Finding)
  const claudeDesktopConfig = JSON.stringify(
    {
      mcpServers: {
        'research-overview': {
          command: info.stdio.command,
          args: info.stdio.args,
          env: info.stdio.env,
        },
      },
    },
    null,
    2
  )
  const cursorConfig = cursorMcpJson(info.httpUrl)

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-3xl space-y-6 p-8">
      <div>
        <h1 className="text-lg font-semibold">Einstellungen</h1>
        <p className="mt-1 text-sm text-slate-500">
          Alltagsweg: Cursor-Konto und Modell hier, Research im Agent-Chat des Projekts. MCP-HTTP und Ollama bleiben für
          Fremdclients und als Fallback.
        </p>
      </div>

      <CursorSettings />

      <Card className="p-5">
        <div className="mb-3 flex items-center justify-between">
          <SectionTitle>Eingebauter MCP-Server (Streamable HTTP)</SectionTitle>
          {info.running ? (
            <Badge tone="emerald" icon="check_circle">
              läuft
            </Badge>
          ) : (
            <Badge tone="red" icon="error">
              gestoppt
            </Badge>
          )}
        </div>
        <CodeRow label="Endpoint" value={info.httpUrl} onCopy={copy} copied={copied} />
        {info.running ? (
          <p className="mt-2 text-xs leading-relaxed text-slate-400">
            Nur auf 127.0.0.1 erreichbar; mehrere Clients können gleichzeitig andocken. Werkzeuge greifen nur im{' '}
            <strong>Agent-Modus</strong>, nicht im Chat.
          </p>
        ) : (
          <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm leading-relaxed text-amber-900">
            MCP läuft nicht. Die App muss gestartet sein (<code className="font-mono text-xs">npm start</code>). In Cursor den{' '}
            <strong>Agent-Modus</strong> öffnen, nicht den Chat — sonst bleiben die Werkzeuge unsichtbar.
          </div>
        )}
      </Card>

      <Card className="p-5">
        <SectionTitle>Cursor (empfohlen)</SectionTitle>
        <p className="mb-2 text-sm text-slate-500">
          Nach <code className="font-mono text-xs">.cursor/mcp.json</code> (Projekt) oder{' '}
          <code className="font-mono text-xs">~/.cursor/mcp.json</code> (global — nötig, wenn das Projekt-MCP in einem Multi-Root-Workspace
          verschwindet). Anschließend <strong>Agent-Modus</strong> öffnen — im Chat sind MCP-Werkzeuge unsichtbar. Research mit einem{' '}
          <strong>benannten Modell</strong>, nicht Auto: WebSearch-Hooks feuern unter Auto oft nicht.
        </p>
        <pre className="overflow-x-auto rounded-lg bg-slate-900 p-3 text-xs leading-relaxed text-slate-100">{cursorConfig}</pre>
        <div className="mt-2">
          <Button icon="content_copy" onClick={() => copy('cursor', cursorConfig)}>
            {copied === 'cursor' ? 'Kopiert ✓' : 'mcp.json kopieren'}
          </Button>
        </div>
        <p className="mt-2 text-xs leading-relaxed text-slate-400">
          Kein <code className="font-mono">type</code>-Feld: Cursor erkennt Streamable HTTP am <code className="font-mono">url</code>
          -Feld. Einstieg im Agent: Werkzeug <code className="font-mono">start_transparent_research</code>. WebSearch darf entdecken;
          Berichtsquellen nur per <code className="font-mono">fetch_source</code>. WebFetch wird vom Projekt-Hook abgewiesen.
        </p>
      </Card>

      <Card className="p-5">
        <SectionTitle>Cursor-Allowlist (ohne Klick-Orgie)</SectionTitle>
        <p className="mb-2 text-sm text-slate-500">
          Datei <code className="font-mono text-xs">.cursor/permissions.json</code> (liegt im Repo). Cursor Settings → Agents →
          Approvals: <strong>Allowlist</strong> oder <strong>Auto-review</strong> — sonst fragt Cursor jeden der 10–40 Aufrufe einzeln.
        </p>
        <pre className="overflow-x-auto rounded-lg bg-slate-900 p-3 text-xs leading-relaxed text-slate-100">{CURSOR_PERMISSIONS_JSON}</pre>
        <div className="mt-2">
          <Button icon="content_copy" onClick={() => copy('allowlist', CURSOR_PERMISSIONS_JSON)}>
            {copied === 'allowlist' ? 'Kopiert ✓' : 'permissions.json kopieren'}
          </Button>
        </div>
      </Card>

      <Card className="p-5">
        <SectionTitle>Cursor-Rule (Arbeitsvertrag)</SectionTitle>
        <p className="mb-2 text-sm text-slate-500">
          Cursor hat keine Claude-Hooks. Diese Rule ist der Arbeitsvertrag: WebSearch darf entdecken, Berichtsquellen nur per{' '}
          <code className="font-mono text-xs">fetch_source</code>. Datei:{' '}
          <code className="font-mono text-xs">.cursor/rules/transparent-research.mdc</code>.
        </p>
        <pre className="max-h-64 overflow-auto rounded-lg bg-slate-900 p-3 text-xs leading-relaxed text-slate-100">{CURSOR_RULE_MDC}</pre>
        <div className="mt-2">
          <Button icon="content_copy" onClick={() => copy('rule', CURSOR_RULE_MDC)}>
            {copied === 'rule' ? 'Kopiert ✓' : 'Rule kopieren'}
          </Button>
        </div>
      </Card>

      <Card className="p-5">
        <SectionTitle>Optional: stdio (Claude Desktop)</SectionTitle>
        <pre className="mt-2 overflow-x-auto rounded-lg bg-slate-900 p-3 text-xs leading-relaxed text-slate-100">{claudeDesktopConfig}</pre>
        <div className="mt-2 flex gap-2">
          <Button icon="content_copy" onClick={() => copy('config', claudeDesktopConfig)}>
            {copied === 'config' ? 'Kopiert ✓' : 'Config kopieren'}
          </Button>
        </div>
        <p className="mt-2 text-xs leading-relaxed text-slate-400">
          In <code className="font-mono">claude_desktop_config.json</code>. Der stdio-Server teilt sich die Datenbank mit dieser App
          (WAL) und startet über das Electron-Binary im Node-Modus, damit die native SQLite-Bibliothek zur App passt.
        </p>
      </Card>

      {info.hookScriptPath && (
        <Card className="p-5">
          <SectionTitle>Optional: Claude Code Provenienz-Gate</SectionTitle>
          <p className="mb-2 text-sm text-slate-500">
            Nur für Claude Code. Hooks blockieren weitere Web-Recherche, bis die letzte Quelle dokumentiert ist. Snippet in{' '}
            <code className="font-mono text-xs">.claude/settings.json</code>:
          </p>
          <pre className="overflow-x-auto rounded-lg bg-slate-900 p-3 text-xs leading-relaxed text-slate-100">{hooksConfig(info.hookScriptPath)}</pre>
          <div className="mt-2">
            <Button icon="content_copy" onClick={() => copy('hooks', hooksConfig(info.hookScriptPath!))}>
              {copied === 'hooks' ? 'Kopiert ✓' : 'Hooks-Config kopieren'}
            </Button>
          </div>
          <p className="mt-2 text-xs leading-relaxed text-slate-400">
            Dazu den Skill <code className="font-mono">skills/transparent-research</code>. In Cursor greift stattdessen die Rule oben;
            der Server erzwingt Provenienz unabhängig vom Client.
          </p>
        </Card>
      )}

      <OllamaPanel />

      <Card className="p-5">
        <SectionTitle>Datenbank</SectionTitle>
        <CodeRow label="Pfad" value={info.dbPath} onCopy={copy} copied={copied} />
        <p className="mt-2 text-xs text-slate-400">
          SQLite mit append-only Audit-Trail (<span className="font-mono">event_log</span>) und FTS5-Volltextsuche — deine Daten bleiben
          lokal (local-first).
        </p>
      </Card>

      <Card className="p-5">
        <SectionTitle>Demo</SectionTitle>
        <p className="mb-3 text-sm text-slate-500">
          Legt ein Demo-Projekt mit zwei Quellen, einem Claim und einer Berichtsversion an — zum Kennenlernen der Review-Oberfläche.
        </p>
        <Button
          variant="primary"
          icon="auto_awesome"
          onClick={async () => {
            await window.api.seedDemo()
            setSeedMsg('Demo-Projekt angelegt — siehe Sidebar.')
            onSeeded()
            setTimeout(() => setSeedMsg(null), 3000)
          }}
        >
          Demo-Projekt laden
        </Button>
        {seedMsg && <div className="mt-2 text-xs text-emerald-700">{seedMsg}</div>}
      </Card>

      <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-4 text-xs leading-relaxed text-amber-800">
        <Icon name="info" className="icon-sm mt-0.5 shrink-0" />
        <p>
          <strong>Prinzip:</strong> Alles, was eine KI einträgt, ist eine <em>zu verifizierende Behauptung</em> — kein Fakt. Die App prüft
          Belege deterministisch (URL + wörtliches Zitat), eine geblindete Verify-Session kann semantisch prüfen, und die endgültige
          Freigabe bleibt immer bei dir.
        </p>
      </div>
      </div>
    </div>
  )
}

function hooksConfig(scriptPath: string): string {
  const cmd = `node "${scriptPath}"`
  return JSON.stringify(
    {
      hooks: {
        PreToolUse: [{ matcher: 'WebFetch|WebSearch', hooks: [{ type: 'command', command: cmd }] }],
        PostToolUse: [
          { matcher: 'WebFetch|WebSearch', hooks: [{ type: 'command', command: cmd }] },
          { matcher: 'mcp__.*__(add_source|exclude_source|log_search|log_extraction)', hooks: [{ type: 'command', command: cmd }] },
        ],
        Stop: [{ hooks: [{ type: 'command', command: cmd }] }],
      },
    },
    null,
    2
  )
}

function CodeRow({
  label,
  value,
  onCopy,
  copied,
}: {
  label: string
  value: string
  onCopy: (label: string, text: string) => void
  copied: string | null
}) {
  return (
    <div className="flex items-center gap-2">
      <code className="min-w-0 flex-1 truncate rounded-lg bg-slate-100 px-3 py-2 font-mono text-xs">{value}</code>
      <Button variant="ghost" icon={copied === label ? 'check' : 'content_copy'} onClick={() => onCopy(label, value)} title="Kopieren" />
    </div>
  )
}
