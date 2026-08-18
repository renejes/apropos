import { useCallback, useEffect, useState } from 'react'
import type { ServerInfo } from '../../../shared/types'
import type { ModelInfo, ProviderHealth } from '../../../main/core/providers/types'
import { Badge, Button, Card, Icon, SectionTitle } from '../components/ui'

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

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-8">
      <div>
        <h1 className="text-lg font-semibold">MCP & Einstellungen</h1>
        <p className="mt-1 text-sm text-slate-500">
          Verbinde beliebige KI-Clients mit dieser App. Alles, was sie eintragen, landet mit voller Provenienz in der lokalen Datenbank.
        </p>
      </div>

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
        <p className="mt-2 text-xs leading-relaxed text-slate-400">
          Für Clients mit Remote-/HTTP-MCP-Unterstützung (z. B. Claude Desktop → Einstellungen → Connectors, Cursor, VS Code). Der Server
          ist nur auf 127.0.0.1 erreichbar; mehrere Clients können gleichzeitig andocken.
        </p>
      </Card>

      <Card className="p-5">
        <SectionTitle>Alternative: stdio (Claude Desktop claude_desktop_config.json)</SectionTitle>
        <pre className="mt-2 overflow-x-auto rounded-lg bg-slate-900 p-3 text-xs leading-relaxed text-slate-100">{claudeDesktopConfig}</pre>
        <div className="mt-2 flex gap-2">
          <Button icon="content_copy" onClick={() => copy('config', claudeDesktopConfig)}>
            {copied === 'config' ? 'Kopiert ✓' : 'Config kopieren'}
          </Button>
        </div>
        <p className="mt-2 text-xs leading-relaxed text-slate-400">
          Der stdio-Server teilt sich die Datenbank mit dieser App (WAL) — Einträge erscheinen hier live. Er startet über das
          Electron-Binary im Node-Modus, damit die native SQLite-Bibliothek zur App passt.
        </p>
      </Card>

      {info.hookScriptPath && (
        <Card className="p-5">
          <SectionTitle>Claude Code: deterministisches Provenienz-Gate (empfohlen)</SectionTitle>
          <p className="mb-2 text-sm text-slate-500">
            Hooks blockieren in Claude Code jede weitere Web-Recherche, bis die letzte Quelle dokumentiert ist — Transparenz wird
            <em> erzwungen</em>, nicht erbeten. Snippet in die <code className="font-mono text-xs">.claude/settings.json</code> des
            Projekts (oder <code className="font-mono text-xs">~/.claude/settings.json</code>) einfügen:
          </p>
          <pre className="overflow-x-auto rounded-lg bg-slate-900 p-3 text-xs leading-relaxed text-slate-100">{hooksConfig(info.hookScriptPath)}</pre>
          <div className="mt-2">
            <Button icon="content_copy" onClick={() => copy('hooks', hooksConfig(info.hookScriptPath!))}>
              {copied === 'hooks' ? 'Kopiert ✓' : 'Hooks-Config kopieren'}
            </Button>
          </div>
          <p className="mt-2 text-xs leading-relaxed text-slate-400">
            Dazu den Skill <code className="font-mono">skills/transparent-research</code> nutzen (Projekt-Skill in Claude Code oder
            Zip-Upload auf claude.ai). Regelwerk: max. 3 unprotokollierte Fetches (ROP_MAX_PENDING), Such-Protokoll-Pflicht nach jeder
            Suche, Turn-Ende blockiert bei offenen Pflichten.
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
