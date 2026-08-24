import { useCallback, useEffect, useState } from 'react'
import type { AgentAuthStatus, AgentModelInfo, AgentSettings } from '../../../shared/agent'
import { Badge, Button, Card, SectionTitle } from './ui'

export function useCursorAccount(): {
  auth: AgentAuthStatus | null
  models: AgentModelInfo[]
  settings: AgentSettings | null
  busy: boolean
  reload: () => Promise<void>
  saveSettings: (next: AgentSettings) => Promise<void>
  loginBrowser: () => Promise<AgentAuthStatus>
} {
  const [auth, setAuth] = useState<AgentAuthStatus | null>(null)
  const [models, setModels] = useState<AgentModelInfo[]>([])
  const [settings, setSettings] = useState<AgentSettings | null>(null)
  const [busy, setBusy] = useState(false)

  const reload = useCallback(async () => {
    setBusy(true)
    try {
      const [a, s] = await Promise.all([window.api.agentAuthStatus(), window.api.agentGetSettings()])
      setAuth(a)
      setSettings(s)
      if (a.signedIn) setModels(await window.api.agentListModels())
      else setModels([])
    } finally {
      setBusy(false)
    }
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  const saveSettings = useCallback(
    async (next: AgentSettings) => {
      const stored = await window.api.agentSetSettings(next)
      setSettings(stored)
    },
    []
  )

  const loginBrowser = useCallback(async () => {
    const result = await window.api.agentBrowserLogin()
    await reload()
    return result
  }, [reload])

  return { auth, models, settings, busy, reload, saveSettings, loginBrowser }
}

export function ModelPicker({
  models,
  settings,
  onChange,
  compact = false,
}: {
  models: AgentModelInfo[]
  settings: AgentSettings
  onChange: (next: AgentSettings) => void
  compact?: boolean
}) {
  const current = models.find((m) => m.id === settings.modelId) ?? models[0]
  const modelId = current?.id ?? settings.modelId
  const params = current?.parameters ?? []

  const setModel = (id: string) => {
    const meta = models.find((m) => m.id === id)
    const paramValues: Record<string, string> = {}
    for (const p of meta?.parameters ?? []) {
      const allowed = p.values.map((v) => v.value)
      const prev = settings.paramValues[p.id]
      if (prev && allowed.includes(prev)) paramValues[p.id] = prev
      else if (p.id === 'fast' && allowed.includes('false')) paramValues[p.id] = 'false'
      else if (p.values[0]) paramValues[p.id] = p.values[0].value
    }
    onChange({ modelId: id, paramValues })
  }

  const setParam = (id: string, value: string) => {
    onChange({ modelId, paramValues: { ...settings.paramValues, [id]: value } })
  }

  return (
    <div className={compact ? 'flex flex-wrap items-center gap-2' : 'space-y-3'}>
      <label className={compact ? 'flex items-center gap-1.5 text-xs text-muted' : 'block text-sm'}>
        {!compact && <span className="mb-1 block text-xs font-medium text-muted">Modell</span>}
        <select
          value={modelId}
          onChange={(e) => setModel(e.target.value)}
          className="field text-sm"
        >
          {models.length === 0 && <option value={settings.modelId}>{settings.modelId}</option>}
          {models.map((m) => (
            <option key={m.id} value={m.id}>
              {m.displayName}
            </option>
          ))}
        </select>
      </label>
      {params.map((p) => (
        <label key={p.id} className={compact ? 'flex items-center gap-1.5 text-xs text-muted' : 'block text-sm'}>
          {!compact && <span className="mb-1 block text-xs font-medium text-muted">{p.displayName}</span>}
          {compact && <span className="text-muted">{p.displayName}</span>}
          <select
            value={settings.paramValues[p.id] ?? p.values[0]?.value ?? ''}
            onChange={(e) => setParam(p.id, e.target.value)}
            className="field text-sm"
          >
            {p.values.map((v) => (
              <option key={v.value} value={v.value}>
                {v.displayName}
              </option>
            ))}
          </select>
        </label>
      ))}
    </div>
  )
}

/** Anmeldung + Modellwahl für die Einstellungsseite. */
export default function CursorSettings() {
  const { auth, models, settings, busy, reload, saveSettings, loginBrowser } = useCursorAccount()
  const [msg, setMsg] = useState<string | null>(null)
  const [loggingIn, setLoggingIn] = useState(false)
  const [loginUrl, setLoginUrl] = useState<string | null>(null)

  useEffect(() => {
    return window.api.onAgentLoginUrl(setLoginUrl)
  }, [])

  const startBrowserLogin = async () => {
    setMsg(null)
    setLoginUrl(null)
    setLoggingIn(true)
    try {
      const result = await loginBrowser()
      await reload()
      setMsg(result.signedIn ? 'Angemeldet.' : result.error ?? 'Anmeldung nicht abgeschlossen.')
    } finally {
      setLoggingIn(false)
      setLoginUrl(null)
    }
  }

  const logout = async () => {
    await window.api.agentLogout()
    await reload()
  }

  const sourceLabel = (source: AgentAuthStatus['keySource']): string | null => {
    switch (source) {
      case 'env':
        return 'CURSOR_API_KEY (Umgebung)'
      case 'browser':
        return 'Browser-Login'
      case null:
        return null
      default: {
        const _never: never = source
        return _never
      }
    }
  }

  return (
    <Card className="p-5">
      <div className="mb-3 flex items-center justify-between gap-3">
        <SectionTitle>Cursor-Konto (In-App-Agent)</SectionTitle>
        <Button variant="ghost" icon="refresh" onClick={() => void reload()} disabled={busy || loggingIn} title="Status neu prüfen" />
      </div>
      <p className="mb-3 text-sm leading-relaxed text-muted">
        Der Research-Chat nutzt dein Cursor-Abo über das SDK — dieselbe Abrechnung wie in der IDE. Anmeldung über den Browser
        (SDK mintet intern einen Key, 90 Tage). Verbrauch mit Tag „SDK“ unter{' '}
        <button
          type="button"
          className="text-fg underline"
          onClick={() => void window.api.openExternal('https://cursor.com/dashboard/usage')}
        >
          Usage
        </button>
        . Fast standardmäßig aus.
      </p>

      {!auth ? (
        <p className="text-sm text-muted">Prüfe …</p>
      ) : auth.signedIn ? (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <Badge tone="emerald" icon="check_circle">
            angemeldet
          </Badge>
          {auth.name && <span className="text-sm text-fg">{auth.name}</span>}
          {auth.email && <span className="text-xs text-muted">{auth.email}</span>}
          {auth.expired && <Badge tone="amber">Anmeldung abgelaufen</Badge>}
          {auth.keyName && <Badge tone="slate">{auth.keyName}</Badge>}
          {sourceLabel(auth.keySource) && <Badge tone="slate">{sourceLabel(auth.keySource)}</Badge>}
          {auth.keySource !== 'env' && (
            <Button variant="ghost" onClick={() => void logout()}>
              Abmelden
            </Button>
          )}
        </div>
      ) : (
        <div className="mb-4 space-y-3">
          <Badge tone="amber" icon="login">
            nicht angemeldet
          </Badge>
          {auth.error && <p className="text-xs text-warn">{auth.error}</p>}
          {loggingIn ? (
            <div className="space-y-2">
              <p className="text-sm text-muted">Browser geöffnet — Anmeldung auf cursor.com abschließen.</p>
              {loginUrl && (
                <button
                  type="button"
                  className="block max-w-full truncate text-left text-xs text-fg underline"
                  onClick={() => void window.api.openExternal(loginUrl)}
                >
                  {loginUrl}
                </button>
              )}
              <Button variant="danger" onClick={() => void window.api.agentCancelLogin()}>
                Abbrechen
              </Button>
            </div>
          ) : (
            <Button variant="primary" icon="login" onClick={() => void startBrowserLogin()}>
              Mit Cursor anmelden
            </Button>
          )}
        </div>
      )}

      {settings && (
        <div>
          <SectionTitle>Modell und Modus</SectionTitle>
          <ModelPicker models={models} settings={settings} onChange={(next) => void saveSettings(next)} />
          {models.length === 0 && auth?.signedIn && (
            <p className="mt-2 text-xs text-muted">Modellliste leer — Anmeldung prüfen oder neu laden.</p>
          )}
        </div>
      )}
      {msg && <p className="mt-3 text-xs text-ok">{msg}</p>}
    </Card>
  )
}
