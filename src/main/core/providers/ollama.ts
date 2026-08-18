import { randomUUID } from 'crypto'
import type {
  ChatChunk,
  ChatMessage,
  ChatRequest,
  CloudStatus,
  ModelInfo,
  ModelProvider,
  ProviderHealth,
  ToolCall,
  TokenUsage,
} from './types'
import { ProviderError } from './types'

/**
 * Ollama-Adapter (lokaler Daemon, standardmäßig http://127.0.0.1:11434).
 *
 * Der lokale Daemon ist ein transparenter Proxy: Cloud-Modelle (`name:size-cloud`)
 * sprechen dieselbe API wie lokale. Ein Adapter deckt damit lokalen Betrieb
 * (Nullkosten, offline, DSGVO-sauber) und Cloud-Abo ab.
 *
 * Zwei Eigenheiten, die man kennen muss, sonst gelten abgebrochene Läufe als erfolgreich:
 *  1. Fehler kommen MITTEN IM STREAM mit HTTP 200 als NDJSON-Objekt {"error": "..."}.
 *  2. Bei erschöpftem Cloud-Kontingent wurde HTTP 200 mit LEEREM Body beobachtet
 *     (ollama/ollama#16045) — das darf niemals als "keine Antwort" durchgehen.
 * Beides wird hier explizit als Fehler behandelt.
 */

const DEFAULT_ENDPOINT = process.env.OLLAMA_HOST?.trim() || 'http://127.0.0.1:11434'
const HEALTH_TIMEOUT_MS = 5_000
const LIST_TIMEOUT_MS = 10_000
/**
 * Kein Timeout auf den Gesamtstream: Ein Modell kann bei kaltem Start oder langem
 * Denken minutenlang schweigen, bevor das erste Token kommt. Abgebrochen wird über
 * das AbortSignal des Aufrufers (Notbremse in der UI), nicht über eine Uhr.
 */

function normalizeEndpoint(raw: string): string {
  const e = raw.trim().replace(/\/+$/, '')
  return /^https?:\/\//.test(e) ? e : `http://${e}`
}

/**
 * Läuft das Modell in Ollamas Cloud?
 * Die reale Namensform ist `<modell>:<größe>-cloud`, z. B. `gpt-oss:120b-cloud` —
 * der Marker hängt am TAG, nicht am Modellnamen. Die kürzere Form `<modell>:cloud`
 * kommt ebenfalls vor. Konkrete Modellnamen NICHT fest verdrahten: Ollama nimmt
 * Cloud-Modelle laufend vom Netz.
 */
export function isCloudModel(name: string): boolean {
  return /[:-]cloud$/i.test(name.trim())
}

export interface OllamaOptions {
  endpoint?: string
  /** Wie lange ein Modell nach dem Aufruf geladen bleibt (Ollama-Syntax, z. B. "5m"). */
  keepAlive?: string
}

export class OllamaProvider implements ModelProvider {
  readonly id = 'ollama'
  readonly label = 'Ollama (lokal & Cloud)'
  readonly endpoint: string
  private readonly keepAlive?: string

  constructor(opts: OllamaOptions = {}) {
    this.endpoint = normalizeEndpoint(opts.endpoint ?? DEFAULT_ENDPOINT)
    this.keepAlive = opts.keepAlive
  }

  private async request(path: string, init: RequestInit, timeoutMs: number | null, outer?: AbortSignal): Promise<Response> {
    const ctrl = new AbortController()
    const onAbort = () => ctrl.abort()
    if (outer) {
      if (outer.aborted) ctrl.abort()
      else outer.addEventListener('abort', onAbort, { once: true })
    }
    const timer = timeoutMs == null ? null : setTimeout(() => ctrl.abort(), timeoutMs)
    try {
      return await fetch(`${this.endpoint}${path}`, { ...init, signal: ctrl.signal })
    } catch (err) {
      if (outer?.aborted) throw new ProviderError('aborted', 'Abgebrochen.')
      throw new ProviderError(
        'unreachable',
        `Ollama unter ${this.endpoint} nicht erreichbar: ${err instanceof Error ? err.message : String(err)}`,
        'Läuft der Daemon? Starte ihn mit "ollama serve" oder über die Ollama-App.'
      )
    } finally {
      if (timer) clearTimeout(timer)
      if (outer) outer.removeEventListener('abort', onAbort)
    }
  }

  /**
   * Sind Cloud-Modelle nutzbar?
   * Zwei unabhängige Bedingungen, die getrennt gemeldet werden müssen, weil sie
   * unterschiedliche Abhilfe verlangen: angemeldet sein (`ollama signin`) UND
   * Cloud nicht per Konfiguration gesperrt (`OLLAMA_NO_CLOUD=true` schaltet sie ab,
   * ohne dass ein Aufruf einen sprechenden Fehler liefert).
   */
  async cloudStatus(signal?: AbortSignal): Promise<CloudStatus> {
    if (/^(1|true|yes)$/i.test(process.env.OLLAMA_NO_CLOUD?.trim() ?? '')) {
      return {
        available: false,
        signedIn: null,
        plan: null,
        reason: 'Cloud ist per OLLAMA_NO_CLOUD abgeschaltet. Variable entfernen und den Daemon neu starten.',
      }
    }
    try {
      // /api/me ist undokumentiert; nur als Indiz behandeln, nie als harte Bedingung.
      const res = await this.request('/api/me', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }, HEALTH_TIMEOUT_MS, signal)
      if (res.status === 401 || res.status === 403) {
        return { available: false, signedIn: false, plan: null, reason: 'Nicht angemeldet. Führe "ollama signin" aus.' }
      }
      if (!res.ok) {
        return { available: true, signedIn: null, plan: null, reason: `Anmeldestatus nicht ermittelbar (HTTP ${res.status}) — Cloud-Aufruf einfach versuchen.` }
      }
      const body = (await res.json().catch(() => ({}))) as { plan?: string; name?: string; email?: string }
      const signedIn = Boolean(body.plan || body.name || body.email)
      return {
        available: true,
        signedIn,
        plan: body.plan ?? null,
        reason: signedIn ? `Angemeldet${body.plan ? ` (${body.plan})` : ''}.` : 'Kein Konto erkannt — für Cloud-Modelle "ollama signin" ausführen.',
      }
    } catch {
      return { available: true, signedIn: null, plan: null, reason: 'Anmeldestatus nicht ermittelbar — Cloud-Aufruf einfach versuchen.' }
    }
  }

  async health(signal?: AbortSignal): Promise<ProviderHealth> {
    const offline: CloudStatus = { available: false, signedIn: null, plan: null, reason: 'Daemon nicht erreichbar.' }
    try {
      const res = await this.request('/api/version', { method: 'GET' }, HEALTH_TIMEOUT_MS, signal)
      if (!res.ok) return { reachable: false, version: null, modelCount: null, cloud: offline, note: `HTTP ${res.status}` }
      const body = (await res.json()) as { version?: string }

      let models: ModelInfo[] = []
      try {
        models = await this.listModels(signal)
      } catch {
        /* Version steht, Modell-Liste ist nachrangig */
      }
      const cloud = await this.cloudStatus(signal)
      const cloudModels = models.filter((m) => m.cloud).length

      const notes: string[] = []
      if (models.length === 0) notes.push('Keine Modelle registriert.')
      if (!cloud.available || cloud.signedIn === false) notes.push(cloud.reason)
      // Bewusst OHNE konkreten Modellnamen: Ollama nimmt Cloud-Modelle im
      // Wochenrhythmus vom Netz (am 15.07.2026 auf einen Schlag 16 Stück).
      // Ein fest verdrahteter Name in einem Hinweis ist damit immer nur kurz richtig.
      else if (cloudModels === 0) notes.push('Keine Cloud-Modelle registriert — verfügbare Modelle auf ollama.com/search?c=cloud, dann "ollama pull <name>".')

      return {
        reachable: true,
        version: body.version ?? null,
        modelCount: models.length,
        cloud,
        note: notes.length ? notes.join(' ') : 'ok',
      }
    } catch (err) {
      return {
        reachable: false,
        version: null,
        modelCount: null,
        cloud: offline,
        note: err instanceof ProviderError ? err.message : String(err),
      }
    }
  }

  async listModels(signal?: AbortSignal): Promise<ModelInfo[]> {
    const res = await this.request('/api/tags', { method: 'GET' }, LIST_TIMEOUT_MS, signal)
    if (!res.ok) throw new ProviderError('http_error', `Modell-Liste fehlgeschlagen: HTTP ${res.status}`)
    const body = (await res.json()) as { models?: Array<Record<string, any>> }
    return (body.models ?? []).map((m) => {
      const name = String(m.name ?? m.model ?? '')
      return {
        id: name,
        label: name,
        sizeBytes: typeof m.size === 'number' ? m.size : null,
        // Cloud-Modelle tragen den -cloud-Suffix und liegen nicht lokal (size 0).
        cloud: isCloudModel(name) || m.size === 0,
        contextLength: typeof m.details?.context_length === 'number' ? m.details.context_length : null,
        supportsTools: null, // erst /api/show weiß das — bewusst nicht geraten
        supportsThinking: null,
      }
    })
  }

  /**
   * Fähigkeiten eines Modells (Werkzeugaufrufe, Denkschritte).
   * Wichtig, weil ein Modell OHNE Tool-Support die Werkzeuge stillschweigend
   * ignoriert — die Recherche-Schleife liefe dann leer, statt zu scheitern.
   */
  async describeModel(model: string, signal?: AbortSignal): Promise<ModelInfo> {
    const res = await this.request(
      '/api/show',
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model }) },
      LIST_TIMEOUT_MS,
      signal
    )
    if (res.status === 404) throw new ProviderError('model_not_found', `Modell "${model}" ist nicht installiert.`, `ollama pull ${model}`)
    if (!res.ok) throw new ProviderError('http_error', `/api/show fehlgeschlagen: HTTP ${res.status}`)
    const body = (await res.json()) as { capabilities?: string[]; model_info?: Record<string, unknown>; details?: Record<string, any> }
    const caps = body.capabilities ?? []
    const ctxKey = Object.keys(body.model_info ?? {}).find((k) => k.endsWith('.context_length'))
    return {
      id: model,
      label: model,
      sizeBytes: null,
      cloud: isCloudModel(model),
      contextLength: ctxKey ? Number((body.model_info as Record<string, unknown>)[ctxKey]) : null,
      supportsTools: caps.includes('tools'),
      supportsThinking: caps.includes('thinking'),
    }
  }

  async *chat(req: ChatRequest): AsyncGenerator<ChatChunk, void, undefined> {
    const payload: Record<string, unknown> = {
      model: req.model,
      messages: req.messages.map(toOllamaMessage),
      stream: true,
    }
    if (req.tools?.length) {
      payload.tools = req.tools.map((t) => ({
        type: 'function',
        function: { name: t.name, description: t.description, parameters: t.parameters },
      }))
    }
    if (req.think) payload.think = true
    if (this.keepAlive) payload.keep_alive = this.keepAlive
    const options: Record<string, unknown> = {}
    if (typeof req.temperature === 'number') options.temperature = req.temperature
    if (req.contextLength) options.num_ctx = req.contextLength
    if (Object.keys(options).length) payload.options = options

    const res = await this.request(
      '/api/chat',
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) },
      null,
      req.signal
    )

    const isCloud = isCloudModel(req.model)

    if (res.status === 404) {
      throw new ProviderError(
        'model_not_found',
        `Modell "${req.model}" ist nicht registriert.`,
        isCloud
          ? `Cloud-Modelle einmalig registrieren: "ollama pull ${req.model}" — und vorher "ollama signin".`
          : `ollama pull ${req.model}`
      )
    }
    if (res.status === 401 || res.status === 403) {
      throw new ProviderError(
        'quota_exhausted',
        `Ollama verweigert den Zugriff auf "${req.model}" (HTTP ${res.status}).`,
        'Für Cloud-Modelle "ollama signin" ausführen. Ist OLLAMA_NO_CLOUD gesetzt, Cloud dort wieder freigeben.'
      )
    }
    if (res.status === 429) {
      throw new ProviderError('quota_exhausted', 'Ollama meldet zu viele Anfragen (HTTP 429).', 'Kontingent oder Parallelität erschöpft — später erneut versuchen.')
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new ProviderError('http_error', `Ollama antwortete mit HTTP ${res.status}${text ? `: ${text.slice(0, 300)}` : ''}`)
    }
    if (!res.body) throw new ProviderError('bad_response', 'Ollama lieferte keinen Antwortkörper.')

    let sawAnything = false
    let sawDone = false

    for await (const line of readNdjson(res.body, req.signal)) {
      let obj: Record<string, any>
      try {
        obj = JSON.parse(line)
      } catch {
        throw new ProviderError('bad_response', `Unlesbare Zeile im Antwortstrom: ${line.slice(0, 200)}`)
      }
      sawAnything = true

      // Fehler MITTEN IM STREAM — kommt mit HTTP 200 und darf nicht als Ende durchgehen.
      if (typeof obj.error === 'string' && obj.error) {
        const msg = obj.error
        if (/quota|limit|exceed|insufficient/i.test(msg)) {
          throw new ProviderError('quota_exhausted', `Kontingent erschöpft: ${msg}`, 'Warte auf das nächste Zeitfenster oder nutze ein lokales Modell.')
        }
        throw new ProviderError('stream_error', `Ollama meldete mitten im Stream: ${msg}`)
      }

      const message = obj.message as Record<string, any> | undefined
      if (message) {
        if (typeof message.thinking === 'string' && message.thinking) {
          yield { type: 'thinking', text: message.thinking }
        }
        if (typeof message.content === 'string' && message.content) {
          yield { type: 'text', text: message.content }
        }
        for (const raw of (message.tool_calls ?? []) as Array<Record<string, any>>) {
          const call = toToolCall(raw)
          if (call) yield { type: 'tool_call', call }
        }
      }

      if (obj.done === true) {
        sawDone = true
        yield { type: 'done', reason: String(obj.done_reason ?? 'stop'), usage: toUsage(obj) }
        break
      }
    }

    // Leerer 200er: bei erschöpftem Cloud-Kontingent beobachtet. Niemals als leere Antwort werten.
    if (!sawAnything) {
      throw new ProviderError(
        'quota_exhausted',
        `Ollama lieferte für "${req.model}" eine leere Antwort (HTTP 200 ohne Inhalt).`,
        isCloud
          ? 'Bei Cloud-Modellen ist das das dokumentierte Verhalten bei erschöpftem Kontingent (ollama/ollama#16045). Prüfe ollama.com/usage.'
          : 'Unerwartet bei lokalen Modellen — Daemon-Protokoll prüfen.'
      )
    }
    if (!sawDone) {
      throw new ProviderError('stream_error', 'Der Antwortstrom brach ab, bevor Ollama ihn als abgeschlossen markiert hat.')
    }
  }
}

function toOllamaMessage(m: ChatMessage): Record<string, unknown> {
  const out: Record<string, unknown> = { role: m.role, content: m.content }
  if (m.role === 'assistant' && m.tool_calls?.length) {
    out.tool_calls = m.tool_calls.map((c) => ({ function: { name: c.name, arguments: c.arguments } }))
  }
  // Ollama korreliert Werkzeug-Ergebnisse über den Namen, nicht über eine ID.
  if (m.role === 'tool' && (m.tool_name || m.tool_call_id)) out.tool_name = m.tool_name ?? m.tool_call_id
  return out
}

function toToolCall(raw: Record<string, any>): ToolCall | null {
  const fn = raw.function ?? raw
  const name = typeof fn?.name === 'string' ? fn.name : null
  if (!name) return null
  let args = fn.arguments
  // Manche Modelle liefern die Argumente als JSON-String statt als Objekt.
  if (typeof args === 'string') {
    try {
      args = JSON.parse(args)
    } catch {
      args = { _raw: args }
    }
  }
  return { id: typeof raw.id === 'string' ? raw.id : randomUUID(), name, arguments: (args ?? {}) as Record<string, unknown> }
}

function toUsage(obj: Record<string, any>): TokenUsage {
  return {
    promptTokens: typeof obj.prompt_eval_count === 'number' ? obj.prompt_eval_count : null,
    completionTokens: typeof obj.eval_count === 'number' ? obj.eval_count : null,
    totalDurationMs: typeof obj.total_duration === 'number' ? Math.round(obj.total_duration / 1e6) : null,
  }
}

/** NDJSON-Zeilen aus einem Web-Stream lesen, ohne alles im Speicher zu halten. */
async function* readNdjson(body: ReadableStream<Uint8Array>, signal?: AbortSignal): AsyncGenerator<string, void, undefined> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  try {
    for (;;) {
      if (signal?.aborted) throw new ProviderError('aborted', 'Abgebrochen.')
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let nl: number
      while ((nl = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, nl).trim()
        buffer = buffer.slice(nl + 1)
        if (line) yield line
      }
    }
    const rest = buffer.trim()
    if (rest) yield rest
  } finally {
    await reader.cancel().catch(() => {})
  }
}
