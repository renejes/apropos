import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'fs'
import { basename, extname, join } from 'path'
import {
  Agent,
  AgentBusyError,
  AgentNotFoundError,
  Cursor,
  CursorAgentError,
  JsonlLocalAgentStore,
} from '@cursor/sdk'
import type { ModelSelection, SDKAgent, SDKCustomTool, SDKJsonValue, SDKModel, Run } from '@cursor/sdk'
import { MAX_PDF_BYTES } from '../enforce/pdf'
import { ToolBridge } from '../engine/tool-bridge'
import type { Repo } from '../repo'
import type {
  AgentAuthStatus,
  AgentChatEvent,
  AgentModelInfo,
  AgentRunState,
  AgentSendResult,
  AgentSettings,
} from '../../../shared/agent'
import { mapSdkMessage } from './events'
import { followUpPrefix, sessionPreamble } from './instructions'
import {
  apiKeySource,
  loadAgentSettings,
  loadApiKey,
  normalizeParamValues,
  rememberAgentId,
  rememberedAgentId,
  saveAgentSettings,
} from './settings'
import { projectWorkspace } from './workspace'

export type AgentEventSink = (projectId: string, event: AgentChatEvent) => void

const HISTORY_MAX = 800
const ALLOWED_ATTACH_EXT = new Set(['.pdf', '.txt', '.md', '.markdown', '.html', '.htm', '.csv'])

interface ProjectSession {
  agent: SDKAgent
  store: JsonlLocalAgentStore
  cwd: string
  running: boolean
  run: Run | null
  fresh: boolean
  history: AgentChatEvent[]
}

function errText(err: unknown): string {
  if (err instanceof CursorAgentError) return err.message
  return err instanceof Error ? err.message : String(err)
}

function toModelInfo(m: SDKModel): AgentModelInfo {
  return {
    id: m.id,
    displayName: m.displayName,
    description: m.description ?? null,
    parameters: (m.parameters ?? []).map((p) => ({
      id: p.id,
      displayName: p.displayName ?? p.id,
      values: p.values.map((v) => ({ value: v.value, displayName: v.displayName ?? v.value })),
    })),
  }
}

function selectionFrom(settings: AgentSettings, models: SDKModel[]): ModelSelection {
  const meta = models.find((m) => m.id === settings.modelId) ?? models.find((m) => m.id === 'composer-2.5') ?? models[0]
  const id = meta?.id ?? settings.modelId
  const params = normalizeParamValues(meta?.parameters ?? [], settings.paramValues)
  const list = Object.entries(params).map(([pid, value]) => ({ id: pid, value }))
  return { id, params: list.length ? list : undefined }
}

function uniqueInboxName(dir: string, original: string): string {
  const name = basename(original)
  if (!existsSync(join(dir, name))) return name
  const ext = extname(name)
  const stem = basename(name, ext)
  let i = 2
  while (existsSync(join(dir, `${stem}-${i}${ext}`))) i += 1
  return `${stem}-${i}${ext}`
}

function historyFile(cwd: string): string {
  return join(cwd, 'ui-transcript.json')
}

function loadHistory(cwd: string): AgentChatEvent[] {
  const path = historyFile(cwd)
  if (!existsSync(path)) return []
  try {
    const raw = JSON.parse(readFileSync(path, 'utf-8')) as unknown
    return Array.isArray(raw) ? (raw as AgentChatEvent[]) : []
  } catch {
    return []
  }
}

function saveHistory(cwd: string, history: AgentChatEvent[]): void {
  const trimmed = history.length > HISTORY_MAX ? history.slice(history.length - HISTORY_MAX) : history
  writeFileSync(historyFile(cwd), JSON.stringify(trimmed), 'utf-8')
}

/**
 * In-App-Host für den Cursor-Agenten. Ein Agent pro Projekt, Werkzeuge = MCP via ToolBridge.
 */
export class CursorAgentHost {
  private readonly bridge: ToolBridge
  private readonly sessions = new Map<string, ProjectSession>()
  private customTools: Record<string, SDKCustomTool> | null = null
  private sink: AgentEventSink | null = null
  private modelsCache: SDKModel[] | null = null

  private loginAbort: AbortController | null = null

  constructor(private readonly repo: Repo) {
    this.bridge = new ToolBridge(repo, 'cursor-sdk', 'cursor-sdk')
  }

  private authOpts(): { apiKey?: string } {
    const key = loadApiKey()
    return key ? { apiKey: key } : {}
  }

  private unsigned(error: string | null, source: AgentAuthStatus['keySource'] = apiKeySource()): AgentAuthStatus {
    return {
      signedIn: false,
      email: null,
      name: null,
      keyName: null,
      error,
      keySource: source,
      expiresAtMs: null,
    }
  }

  async hasAuth(): Promise<boolean> {
    if (loadApiKey()) return true
    try {
      const st = await Cursor.auth.status()
      return st.status === 'logged-in'
    } catch {
      return false
    }
  }

  setSink(sink: AgentEventSink | null): void {
    this.sink = sink
  }

  private emit(projectId: string, event: AgentChatEvent): void {
    const session = this.sessions.get(projectId)
    if (session) {
      session.history.push(event)
      if (event.type === 'user' || event.type === 'assistant' || event.type === 'run_end' || (event.type === 'tool' && event.status !== 'running')) {
        saveHistory(session.cwd, session.history)
      }
    }
    this.sink?.(projectId, event)
  }

  async disposeAll(): Promise<void> {
    this.cancelBrowserLogin()
    for (const [id, session] of this.sessions) {
      try {
        if (session.run?.supports('cancel')) await session.run.cancel()
      } catch {
        /* egal */
      }
      try {
        await session.agent[Symbol.asyncDispose]()
      } catch {
        try {
          session.agent.close()
        } catch {
          /* egal */
        }
      }
      this.sessions.delete(id)
    }
    await this.bridge.close()
  }

  async authStatus(): Promise<AgentAuthStatus> {
    const explicit = loadApiKey()
    const source = apiKeySource()
    try {
      if (explicit) {
        const me = await Cursor.me({ apiKey: explicit })
        const name = [me.userFirstName, me.userLastName].filter(Boolean).join(' ') || null
        return {
          signedIn: true,
          email: me.userEmail ?? null,
          name,
          keyName: me.apiKeyName,
          error: null,
          keySource: source,
          expiresAtMs: null,
        }
      }
      const stored = await Cursor.auth.status()
      if (stored.status !== 'logged-in') {
        return this.unsigned('Nicht angemeldet. „Mit Cursor anmelden“ öffnet den Browser — ein selbst erzeugter API-Key ist nicht nötig.')
      }
      const me = await Cursor.me()
      const name = [me.userFirstName, me.userLastName].filter(Boolean).join(' ') || null
      return {
        signedIn: true,
        email: me.userEmail ?? stored.email ?? null,
        name,
        keyName: me.apiKeyName,
        error: null,
        keySource: 'browser',
        expiresAtMs: stored.apiKeyExpiresAtMs ?? null,
      }
    } catch (err) {
      return this.unsigned(errText(err), source)
    }
  }

  /**
   * Browser-Login laut SDK 1.0.27+: mintet einen User-Key (90 Tage) nach Cursor-Website-Login.
   * `openUrl` muss den Systembrowser öffnen (in Electron: shell.openExternal).
   */
  async browserLogin(openUrl: (url: string) => Promise<void>, onLoginUrl?: (url: string) => void): Promise<AgentAuthStatus> {
    this.cancelBrowserLogin()
    const ac = new AbortController()
    this.loginAbort = ac
    try {
      await Cursor.auth.login({
        openBrowser: (url) => openUrl(url),
        onLoginUrl,
        signal: ac.signal,
        apiKeyName: 'Research Overview Platform',
      })
      this.modelsCache = null
      return this.authStatus()
    } catch (err) {
      if (ac.signal.aborted) return this.unsigned('Anmeldung abgebrochen.')
      return this.unsigned(errText(err))
    } finally {
      if (this.loginAbort === ac) this.loginAbort = null
    }
  }

  cancelBrowserLogin(): void {
    this.loginAbort?.abort()
    this.loginAbort = null
  }

  async logout(): Promise<AgentAuthStatus> {
    try {
      await Cursor.auth.logout()
    } catch {
      /* kein gespeicherter Browser-Login */
    }
    this.modelsCache = null
    return this.authStatus()
  }

  async listModels(): Promise<AgentModelInfo[]> {
    if (!(await this.hasAuth())) return []
    try {
      const models = await Cursor.models.list(this.authOpts())
      this.modelsCache = models
      return models.map(toModelInfo)
    } catch {
      return []
    }
  }

  getSettings(): AgentSettings {
    const stored = loadAgentSettings()
    return { modelId: stored.modelId, paramValues: stored.paramValues }
  }

  setSettings(next: AgentSettings): AgentSettings {
    const cur = loadAgentSettings()
    const modelId = next.modelId.trim() || cur.modelId
    saveAgentSettings({ ...cur, modelId, paramValues: next.paramValues ?? {} })
    return this.getSettings()
  }

  history(projectId: string): AgentChatEvent[] {
    const session = this.sessions.get(projectId)
    if (session) return session.history
    const cwd = projectWorkspace(projectId)
    return loadHistory(cwd)
  }

  runState(projectId: string): AgentRunState {
    const session = this.sessions.get(projectId)
    return {
      projectId,
      running: session?.running ?? false,
      agentId: session?.agent.agentId ?? rememberedAgentId(projectId),
    }
  }

  importFiles(projectId: string, absPaths: string[]): string[] {
    const cwd = projectWorkspace(projectId)
    const inbox = join(cwd, 'inbox')
    mkdirSync(inbox, { recursive: true })
    const copied: string[] = []
    for (const src of absPaths) {
      const ext = extname(src).toLowerCase()
      if (!ALLOWED_ATTACH_EXT.has(ext)) continue
      try {
        if (statSync(src).size > MAX_PDF_BYTES) continue
      } catch {
        continue
      }
      const name = uniqueInboxName(inbox, src)
      copyFileSync(src, join(inbox, name))
      copied.push(name)
    }
    return copied
  }

  async cancel(projectId: string): Promise<boolean> {
    const session = this.sessions.get(projectId)
    if (!session?.run) return false
    if (session.run.supports('cancel')) {
      await session.run.cancel()
      return true
    }
    return false
  }

  async send(projectId: string, text: string, attached: string[]): Promise<AgentSendResult> {
    const trimmed = text.trim()
    if (!trimmed && attached.length === 0) return { ok: false, error: 'Leere Nachricht.' }
    if (!(await this.hasAuth())) {
      return { ok: false, error: 'Nicht angemeldet. Unter Einstellungen „Mit Cursor anmelden“ wählen.' }
    }

    const project = this.repo.getProject(projectId)
    if (!project) return { ok: false, error: `Projekt ${projectId} existiert nicht.` }

    try {
      const session = await this.ensureSession(projectId)
      if (session.running) return { ok: false, error: 'Der Agent arbeitet noch. Warte oder brich den Lauf ab.' }
      this.emit(projectId, { type: 'user', text: trimmed || `(${attached.length} Datei(en) angehängt)` })
      session.running = true
      const body = session.fresh
        ? `${sessionPreamble({ projectId, title: project.title, researchQuestion: project.research_question })}\n\n${followUpPrefix(projectId, attached)}${trimmed}`
        : `${followUpPrefix(projectId, attached)}${trimmed}`
      session.fresh = false

      const models = this.modelsCache ?? (await Cursor.models.list(this.authOpts()).catch(() => [] as SDKModel[]))
      this.modelsCache = models.length ? models : this.modelsCache
      const model = selectionFrom(this.getSettings(), models)

      let run: Run
      try {
        run = await session.agent.send(body, { model })
      } catch (err) {
        if (err instanceof AgentBusyError) {
          run = await session.agent.send(body, { model, local: { force: true } })
        } else {
          throw err
        }
      }
      session.run = run

      const streaming = run.supports('stream')
        ? (async () => {
            for await (const msg of run.stream()) {
              for (const ev of mapSdkMessage(msg)) {
                if (ev.type === 'user') continue
                this.emit(projectId, ev)
              }
            }
          })()
        : Promise.resolve()

      const result = await run.wait()
      await streaming.catch(() => {})
      const status = result.status
      this.emit(projectId, {
        type: 'run_end',
        status,
        error: status === 'error' ? result.result ?? 'Lauf fehlgeschlagen' : undefined,
      })
      return { ok: status === 'finished', error: status === 'error' ? result.result : undefined, agentId: session.agent.agentId }
    } catch (err) {
      this.emit(projectId, { type: 'run_end', status: 'error', error: errText(err) })
      return { ok: false, error: errText(err) }
    } finally {
      const session = this.sessions.get(projectId)
      if (session) {
        session.running = false
        session.run = null
        saveHistory(session.cwd, session.history)
      }
    }
  }

  private async ensureBridge(): Promise<Record<string, SDKCustomTool>> {
    if (this.customTools) return this.customTools
    await this.bridge.connect()
    const listed = await this.bridge.listAll()
    const tools: Record<string, SDKCustomTool> = {}
    for (const t of listed) {
      const name = t.name
      tools[name] = {
        description: t.description,
        inputSchema: t.parameters as Record<string, SDKJsonValue>,
        execute: async (args) => {
          const result = await this.bridge.call(name, args as Record<string, unknown>)
          return { content: [{ type: 'text' as const, text: result.text }], isError: result.isError }
        },
      }
    }
    this.customTools = tools
    return tools
  }

  private async ensureSession(projectId: string): Promise<ProjectSession> {
    const open = this.sessions.get(projectId)
    if (open) return open

    const cwd = projectWorkspace(projectId)
    const storeDir = join(cwd, '.sdk-store')
    mkdirSync(storeDir, { recursive: true })
    const store = new JsonlLocalAgentStore(storeDir)
    const customTools = await this.ensureBridge()
    const models = this.modelsCache ?? (await Cursor.models.list(this.authOpts()).catch(() => [] as SDKModel[]))
    this.modelsCache = models.length ? models : this.modelsCache
    const model = selectionFrom(this.getSettings(), models)
    const local = {
      cwd,
      store,
      customTools,
      settingSources: [],
      autoReview: true,
    }
    const base = { ...this.authOpts(), model, local, mode: 'agent' as const }

    let agent: SDKAgent
    let fresh = true
    const remembered = rememberedAgentId(projectId)
    if (remembered) {
      try {
        agent = await Agent.resume(remembered, base)
        fresh = false
      } catch (err) {
        if (!(err instanceof AgentNotFoundError)) throw err
        agent = await Agent.create({ ...base, name: `research:${projectId.slice(0, 8)}` })
        fresh = true
      }
    } else {
      agent = await Agent.create({ ...base, name: `research:${projectId.slice(0, 8)}` })
    }
    rememberAgentId(projectId, agent.agentId)
    const session: ProjectSession = {
      agent,
      store,
      cwd,
      running: false,
      run: null,
      fresh,
      history: loadHistory(cwd),
    }
    this.sessions.set(projectId, session)
    return session
  }
}
