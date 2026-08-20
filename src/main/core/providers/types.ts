/**
 * Anbieter-unabhängige Schnittstelle für Modellzugriff.
 *
 * Lebt weiter als Testharness: ResearchEngine + FakeProvider prüfen Quota,
 * Checkpoint und Coverage in-process. Die produktive Schleife läuft über den
 * Cursor-SDK-Agenten; ein eigener Ollama-Adapter in der App gibt es nicht mehr.
 */

export type ChatRole = 'system' | 'user' | 'assistant' | 'tool'

export interface ChatMessage {
  role: ChatRole
  content: string
  /** Nur bei role='assistant': vom Modell angeforderte Werkzeugaufrufe. */
  tool_calls?: ToolCall[]
  /** Nur bei role='tool': auf welchen Aufruf sich das Ergebnis bezieht. */
  tool_call_id?: string
  tool_name?: string
}

export interface ToolCall {
  id: string
  name: string
  arguments: Record<string, unknown>
}

export interface ToolDefinition {
  name: string
  description: string
  /** JSON Schema der Parameter — flach halten, mehrere Anbieter lehnen tiefe Verschachtelung ab. */
  parameters: Record<string, unknown>
}

export interface ChatRequest {
  model: string
  messages: ChatMessage[]
  tools?: ToolDefinition[]
  temperature?: number
  /** Kontextfenster in Token; 0/undefined = Modellvorgabe. */
  contextLength?: number
  /** Denkschritte anfordern, wo das Modell sie unterstützt. */
  think?: boolean
  signal?: AbortSignal
}

export type ChatChunk =
  /** Denkschritte — gehören NICHT in den Bericht, aber ins Protokoll. */
  | { type: 'thinking'; text: string }
  | { type: 'text'; text: string }
  | { type: 'tool_call'; call: ToolCall }
  | { type: 'done'; reason: string; usage: TokenUsage }

export interface TokenUsage {
  promptTokens: number | null
  completionTokens: number | null
  /** Gesamtdauer des Aufrufs, falls der Anbieter sie liefert. */
  totalDurationMs: number | null
}

export interface ModelInfo {
  id: string
  label: string
  /** Bytes; null bei Cloud-Modellen, die nicht lokal liegen. */
  sizeBytes: number | null
  /** Läuft in der Anbieter-Cloud statt lokal. */
  cloud: boolean
  contextLength: number | null
  /** Beherrscht das Modell Werkzeugaufrufe? null = unbekannt. */
  supportsTools: boolean | null
  supportsThinking: boolean | null
}

export interface ProviderHealth {
  reachable: boolean
  /** Version des Dienstes, falls ermittelbar. */
  version: string | null
  modelCount: number | null
  /** Cloud-Modelle nutzbar? Braucht Anmeldung UND darf nicht per Konfiguration gesperrt sein. */
  cloud: CloudStatus
  note: string
}

export interface CloudStatus {
  available: boolean
  signedIn: boolean | null
  /** Abo-Stufe, falls der Dienst sie meldet. */
  plan: string | null
  reason: string
}

export interface ModelProvider {
  readonly id: string
  readonly label: string
  /** Wo der Dienst erreicht wird — gehört in den Prüfpfad. */
  readonly endpoint: string
  health(signal?: AbortSignal): Promise<ProviderHealth>
  listModels(signal?: AbortSignal): Promise<ModelInfo[]>
  /** Streamt die Antwort. Wirft ProviderError bei Fehlern — auch bei solchen mitten im Stream. */
  chat(req: ChatRequest): AsyncGenerator<ChatChunk, void, undefined>
}

export class ProviderError extends Error {
  constructor(
    readonly code:
      | 'unreachable'
      | 'model_not_found'
      | 'tools_unsupported'
      | 'quota_exhausted'
      | 'aborted'
      | 'stream_error'
      | 'bad_response'
      | 'http_error',
    message: string,
    readonly hint?: string
  ) {
    super(message)
    this.name = 'ProviderError'
  }
}
