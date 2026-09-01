import { copyFileSync, existsSync, mkdirSync, statSync } from 'fs'
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
  AgentMentionable,
  AgentMode,
  AgentModelInfo,
  AgentRunState,
  AgentSendInput,
  AgentSendResult,
  AgentSessionResult,
  AgentSessionsSnapshot,
  AgentSettings,
} from '../../../shared/agent'
import { APP_NAME } from '../../../shared/brand'
import {
  UNTITLED_CHAT,
  activateSession,
  addSession,
  closeOpenTab,
  removeSession,
  snapshotSessions,
  titleFromUserText,
  touchSession,
  type AgentSessionIndex,
} from '../../../shared/agentSessions'
import { mapSdkMessage } from './events'
import { followUpPrefix, notebookPreamble, sessionPreamble, yoloDirective } from './instructions'
import { toolsForKind } from './notebook-tools'
import {
  apiKeySource,
  loadAgentSettings,
  loadApiKey,
  normalizeParamValues,
  rememberAgentId,
  rememberedAgentId,
  saveAgentSettings,
} from './settings'
import { listInboxFiles, projectWorkspace } from './workspace'
import {
  deleteTranscript,
  loadOrMigrateIndex,
  loadTranscript,
  saveIndexFile,
  saveTranscript,
} from './transcripts'

export type AgentEventSink = (projectId: string, event: AgentChatEvent, sessionId: string | null) => void

const ALLOWED_ATTACH_EXT = new Set(['.pdf', '.txt', '.md', '.markdown', '.html', '.htm', '.csv'])
const BUSY_SWITCH = 'Der Agent arbeitet noch. Warte oder brich den Lauf ab, bevor du den Chat wechselst.'

interface BoundAgent {
  agent: SDKAgent
  store: JsonlLocalAgentStore
  cwd: string
  running: boolean
  run: Run | null
  fresh: boolean
  history: AgentChatEvent[]
  sessionId: string
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

function asMode(value: AgentMode | undefined): AgentMode {
  return value === 'plan' ? 'plan' : 'agent'
}

/**
 * In-App-Host für den Cursor-Agenten. Mehrere Chats pro Projekt, Werkzeuge = MCP via ToolBridge.
 */
export class CursorAgentHost {
  private readonly bridge: ToolBridge
  private readonly bound = new Map<string, BoundAgent>()
  private readonly indexes = new Map<string, AgentSessionIndex>()
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
      expired: false,
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
    const session = this.bound.get(projectId)
    if (session && event.type !== 'usage') {
      session.history.push(event)
      if (event.type === 'user' || event.type === 'assistant' || event.type === 'run_end' || (event.type === 'tool' && event.status !== 'running')) {
        saveTranscript(session.cwd, session.sessionId, session.history)
      }
    }
    this.sink?.(projectId, event, session?.sessionId ?? null)
  }

  private persistBound(projectId: string): void {
    const session = this.bound.get(projectId)
    if (!session) return
    saveTranscript(session.cwd, session.sessionId, session.history)
  }

  private indexFor(projectId: string): { cwd: string; index: AgentSessionIndex } {
    const cwd = projectWorkspace(projectId)
    let index = this.indexes.get(projectId)
    if (!index) {
      index = loadOrMigrateIndex(cwd, rememberedAgentId(projectId))
      this.indexes.set(projectId, index)
    }
    return { cwd, index }
  }

  private writeIndex(projectId: string, cwd: string, index: AgentSessionIndex): void {
    this.indexes.set(projectId, index)
    saveIndexFile(cwd, index)
    if (index.activeId) rememberAgentId(projectId, index.activeId)
  }

  private sessionSnapshot(projectId: string): AgentSessionsSnapshot {
    return snapshotSessions(this.indexFor(projectId).index)
  }

  private result(projectId: string, extra?: { ok?: boolean; error?: string }): AgentSessionResult {
    return {
      ok: extra?.ok ?? true,
      error: extra?.error,
      sessions: this.sessionSnapshot(projectId),
      history: this.history(projectId),
    }
  }

  async disposeAll(): Promise<void> {
    this.cancelBrowserLogin()
    for (const id of [...this.bound.keys()]) {
      await this.unbind(id)
    }
    await this.bridge.close()
  }

  private async unbind(projectId: string): Promise<void> {
    const session = this.bound.get(projectId)
    if (!session) return
    this.persistBound(projectId)
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
    this.bound.delete(projectId)
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
          expired: false,
        }
      }
      const stored = await Cursor.auth.status()
      if (stored.status !== 'logged-in') {
        return this.unsigned('Nicht angemeldet. „Mit Cursor anmelden“ öffnet den Browser — ein selbst erzeugter API-Key ist nicht nötig.')
      }
      const me = await Cursor.me()
      const name = [me.userFirstName, me.userLastName].filter(Boolean).join(' ') || null
      const expiresAtMs = stored.apiKeyExpiresAtMs ?? null
      return {
        signedIn: true,
        email: me.userEmail ?? stored.email ?? null,
        name,
        keyName: me.apiKeyName,
        error: null,
        keySource: 'browser',
        expiresAtMs,
        expired: typeof expiresAtMs === 'number' && expiresAtMs < Date.now(),
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
        apiKeyName: APP_NAME,
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
    return { modelId: stored.modelId, paramValues: stored.paramValues, yolo: stored.yolo === true }
  }

  setSettings(next: AgentSettings): AgentSettings {
    const cur = loadAgentSettings()
    const modelId = next.modelId.trim() || cur.modelId
    saveAgentSettings({
      ...cur,
      modelId,
      paramValues: next.paramValues ?? {},
      yolo: typeof next.yolo === 'boolean' ? next.yolo : cur.yolo,
    })
    return this.getSettings()
  }

  history(projectId: string): AgentChatEvent[] {
    const session = this.bound.get(projectId)
    if (session) return session.history
    const { cwd, index } = this.indexFor(projectId)
    if (index.activeId) return loadTranscript(cwd, index.activeId)
    return []
  }

  runState(projectId: string): AgentRunState {
    const session = this.bound.get(projectId)
    const { index } = this.indexFor(projectId)
    return {
      projectId,
      running: session?.running ?? false,
      agentId: session?.agent.agentId ?? index.activeId ?? rememberedAgentId(projectId),
      sessionId: session?.sessionId ?? index.activeId,
    }
  }

  sessions(projectId: string): AgentSessionResult {
    return this.result(projectId)
  }

  mentionables(projectId: string): AgentMentionable[] {
    try {
      const state = this.repo.getProjectState(projectId)
      const out: AgentMentionable[] = []
      for (const filename of listInboxFiles(projectId).slice(0, 40)) {
        out.push({ kind: 'inbox', id: filename, label: filename, hint: 'Inbox' })
      }
      for (const source of state.sources.slice(0, 40)) {
        out.push({
          kind: 'source',
          id: source.id,
          label: source.citekey || source.title,
          hint: source.citekey ? source.title : source.url,
        })
      }
      for (const question of state.subQuestions.slice(0, 20)) {
        out.push({ kind: 'question', id: question.id, label: question.question, hint: 'Teilfrage' })
      }
      return out
    } catch {
      return []
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
    const session = this.bound.get(projectId)
    if (!session?.run) return false
    if (session.run.supports('cancel')) {
      await session.run.cancel()
      return true
    }
    return false
  }

  async disposeProject(projectId: string): Promise<void> {
    await this.unbind(projectId)
  }

  async newSession(projectId: string): Promise<AgentSessionResult> {
    if (!this.repo.getProject(projectId)) return this.result(projectId, { ok: false, error: `Projekt ${projectId} existiert nicht.` })
    const current = this.bound.get(projectId)
    if (current?.running) return this.result(projectId, { ok: false, error: BUSY_SWITCH })
    if (current && current.history.length === 0) return this.result(projectId)
    try {
      this.persistBound(projectId)
      await this.bind(projectId, { forceCreate: true })
      return this.result(projectId)
    } catch (err) {
      return this.result(projectId, { ok: false, error: errText(err) })
    }
  }

  async switchSession(projectId: string, sessionId: string): Promise<AgentSessionResult> {
    const want = sessionId.trim()
    if (!want) return this.result(projectId, { ok: false, error: 'Fehlende Chat-ID.' })
    const current = this.bound.get(projectId)
    if (current?.running) return this.result(projectId, { ok: false, error: BUSY_SWITCH })
    const { cwd, index } = this.indexFor(projectId)
    if (!index.chats.some((c) => c.id === want)) {
      return this.result(projectId, { ok: false, error: 'Chat nicht gefunden.' })
    }
    if (current?.sessionId === want) {
      this.writeIndex(projectId, cwd, activateSession(index, want))
      return this.result(projectId)
    }
    try {
      this.persistBound(projectId)
      await this.bind(projectId, { resumeId: want })
      return this.result(projectId)
    } catch (err) {
      return this.result(projectId, { ok: false, error: errText(err) })
    }
  }

  async closeTab(projectId: string, sessionId: string): Promise<AgentSessionResult> {
    const { cwd, index } = this.indexFor(projectId)
    const current = this.bound.get(projectId)
    if (current?.running && current.sessionId === sessionId) {
      return this.result(projectId, { ok: false, error: BUSY_SWITCH })
    }
    if (index.openIds.length <= 1 && index.activeId === sessionId) return this.result(projectId)
    this.persistBound(projectId)
    const wasActive = index.activeId === sessionId
    const next = closeOpenTab(index, sessionId)
    this.writeIndex(projectId, cwd, next)
    if (!wasActive) return this.result(projectId)
    if (!next.activeId) return this.newSession(projectId)
    return this.switchSession(projectId, next.activeId)
  }

  async deleteSession(projectId: string, sessionId: string): Promise<AgentSessionResult> {
    const { cwd, index } = this.indexFor(projectId)
    const current = this.bound.get(projectId)
    if (current?.running && current.sessionId === sessionId) {
      return this.result(projectId, { ok: false, error: BUSY_SWITCH })
    }
    this.persistBound(projectId)
    const wasActive = index.activeId === sessionId
    try {
      deleteTranscript(cwd, sessionId)
    } catch {
      /* egal */
    }
    if (current?.sessionId === sessionId) await this.unbind(projectId)
    const next = removeSession(index, sessionId)
    this.writeIndex(projectId, cwd, next)
    if (next.chats.length === 0) return this.newSession(projectId)
    if (wasActive && next.activeId) return this.switchSession(projectId, next.activeId)
    return this.result(projectId)
  }

  async send(projectId: string, input: AgentSendInput): Promise<AgentSendResult> {
    const attached = input.attached ?? []
    const mentions = input.mentions ?? []
    const mode = asMode(input.mode)
    const yolo = input.yolo ?? this.getSettings().yolo
    const trimmed = input.text.trim()
    if (!trimmed && attached.length === 0 && mentions.length === 0) return { ok: false, error: 'Leere Nachricht.' }
    if (!(await this.hasAuth())) {
      return { ok: false, error: 'Nicht angemeldet. Unter Einstellungen „Mit Cursor anmelden“ wählen.' }
    }

    const project = this.repo.getProject(projectId)
    if (!project) return { ok: false, error: `Projekt ${projectId} existiert nicht.` }

    try {
      const session = await this.bind(projectId)
      if (session.running) return { ok: false, error: 'Der Agent arbeitet noch. Warte oder brich den Lauf ab.' }

      const visible = trimmed || (attached.length ? `(${attached.length} Datei(en) angehängt)` : mentions.map((m) => `@${m.label}`).join(' '))
      this.emit(projectId, { type: 'user', text: visible })
      this.touchActiveTitle(projectId, trimmed || attached[0] || mentions[0]?.label || '')
      session.running = true
      const notebook = project.kind === 'notebook'
      const kind = notebook ? 'notebook' : 'research'
      const briefAdopted = Boolean(this.repo.getAdoptedBrief(projectId))
      const yoloBlock = yolo ? `${yoloDirective(kind, { briefAdopted })}\n\n` : ''
      const preamble = notebook
        ? notebookPreamble({ projectId, title: project.title })
        : sessionPreamble({ projectId, title: project.title, researchQuestion: project.research_question })
      const body = session.fresh
        ? `${yoloBlock}${preamble}\n\n${followUpPrefix(projectId, attached, mentions)}${trimmed}`
        : `${yoloBlock}${followUpPrefix(projectId, attached, mentions)}${trimmed}`
      session.fresh = false

      const models = this.modelsCache ?? (await Cursor.models.list(this.authOpts()).catch(() => [] as SDKModel[]))
      this.modelsCache = models.length ? models : this.modelsCache
      const model = selectionFrom(this.getSettings(), models)

      let run: Run
      try {
        run = await session.agent.send(body, { model, mode })
      } catch (err) {
        if (err instanceof AgentBusyError) {
          run = await session.agent.send(body, { model, mode, local: { force: true } })
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
      const session = this.bound.get(projectId)
      if (session) {
        session.running = false
        session.run = null
        saveTranscript(session.cwd, session.sessionId, session.history)
      }
    }
  }

  private touchActiveTitle(projectId: string, text: string): void {
    const { cwd, index } = this.indexFor(projectId)
    if (!index.activeId) return
    const existing = index.chats.find((c) => c.id === index.activeId)
    const untitled = !existing?.title || existing.title === UNTITLED_CHAT
    const next = touchSession(index, index.activeId, {
      title: untitled ? titleFromUserText(text, UNTITLED_CHAT) : existing.title,
      updatedAt: Date.now(),
    })
    this.writeIndex(projectId, cwd, next)
  }

  private async bind(projectId: string, opts?: { resumeId?: string; forceCreate?: boolean }): Promise<BoundAgent> {
    const { cwd, index } = this.indexFor(projectId)
    const open = this.bound.get(projectId)
    const resumeId = opts?.forceCreate ? undefined : (opts?.resumeId ?? index.activeId ?? undefined)
    if (open && !opts?.forceCreate && (!resumeId || open.sessionId === resumeId)) return open

    const spawned = await this.spawnAgent(projectId, cwd, opts?.forceCreate ? null : resumeId ?? null)
    if (open) await this.unbind(projectId)

    const sessionId = spawned.agent.agentId
    const history = spawned.fresh ? [] : loadTranscript(cwd, sessionId)
    const session: BoundAgent = {
      agent: spawned.agent,
      store: spawned.store,
      cwd,
      running: false,
      run: null,
      fresh: spawned.fresh,
      history,
      sessionId,
    }
    this.bound.set(projectId, session)

    const known = index.chats.some((c) => c.id === sessionId)
    const next = known
      ? activateSession(index, sessionId)
      : addSession(index, { id: sessionId, title: UNTITLED_CHAT, createdAt: Date.now(), updatedAt: Date.now() })
    this.writeIndex(projectId, cwd, next)
    return session
  }

  private async spawnAgent(
    projectId: string,
    cwd: string,
    resumeId: string | null
  ): Promise<{ agent: SDKAgent; store: JsonlLocalAgentStore; fresh: boolean }> {
    const storeDir = join(cwd, '.sdk-store')
    mkdirSync(storeDir, { recursive: true })
    const store = new JsonlLocalAgentStore(storeDir)
    const kind = this.repo.getProject(projectId)?.kind === 'notebook' ? 'notebook' : 'research'
    const customTools = toolsForKind(await this.ensureBridge(), kind)
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

    if (resumeId) {
      try {
        const agent = await Agent.resume(resumeId, base)
        return { agent, store, fresh: false }
      } catch (err) {
        if (!(err instanceof AgentNotFoundError)) throw err
      }
    }
    const agent = await Agent.create({ ...base, name: `${kind}:${projectId.slice(0, 8)}` })
    return { agent, store, fresh: true }
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
}
