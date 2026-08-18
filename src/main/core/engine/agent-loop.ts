import type { ChatMessage, ModelProvider, ToolDefinition } from '../providers/types'
import { ProviderError } from '../providers/types'
import type { ToolBridge } from './tool-bridge'

/**
 * Die innere Agenten-Schleife: Modell antwortet → ruft Werkzeuge → bekommt
 * Ergebnisse → antwortet weiter, bis es fertig ist oder eine Grenze greift.
 *
 * Entwurfsentscheidungen, die aus der Recherche stammen:
 *  - Werkzeug-Ergebnisse gehen IMMER zurück ans Modell, auch Fehler. Nur so kann
 *    es ein fehlgeschlagenes Zitat korrigieren, statt den Lauf zu verlieren.
 *  - Harte Obergrenzen (Turns, Token, Wanduhr) statt Vertrauen darauf, dass das
 *    Modell selbst aufhört. Eine Schleife ohne Abbruchbedingung ist keine Schleife,
 *    sondern ein Risiko.
 *  - Denkschritte werden protokolliert, aber NICHT in den Nachrichtenverlauf
 *    zurückgespeist: sie blähen den Kontext auf, ohne den Zustand zu tragen.
 */

export interface LoopLimits {
  maxTurns: number
  /** Summe aus Prompt- und Antwort-Token; 0 = unbegrenzt. */
  maxTokens: number
  maxWallClockMs: number
}

export const DEFAULT_LIMITS: LoopLimits = { maxTurns: 24, maxTokens: 0, maxWallClockMs: 20 * 60_000 }

export type LoopEvent =
  | { type: 'assistant_text'; text: string }
  | { type: 'thinking'; text: string }
  | { type: 'tool_start'; name: string; args: Record<string, unknown> }
  | { type: 'tool_end'; name: string; ok: boolean; preview: string }
  | { type: 'turn'; index: number; promptTokens: number | null; completionTokens: number | null }

export type LoopStopReason = 'model_finished' | 'max_turns' | 'max_tokens' | 'timeout' | 'aborted' | 'provider_error'

export interface LoopResult {
  stopReason: LoopStopReason
  turns: number
  toolCalls: number
  failedToolCalls: number
  promptTokens: number
  completionTokens: number
  /** Letzter Freitext des Modells — bei der Synthese der Bericht. */
  finalText: string
  messages: ChatMessage[]
  error?: string
  /**
   * Anbieter-Fehlercode, falls stopReason === 'provider_error'.
   *
   * Getrennt vom Text, weil der Aufrufer daran entscheidet, ob der GESAMTE Lauf
   * endet: Ein erschöpftes Kontingent bei Teilfrage 1 wird bei Teilfrage 2 nicht
   * besser. Am String zu erkennen, was endgültig ist, wäre eine Einladung zum
   * stillen Fehlgriff.
   */
  errorCode?: ProviderError['code']
}

export interface LoopOptions {
  provider: ModelProvider
  model: string
  bridge: ToolBridge
  tools: ToolDefinition[]
  system: string
  task: string
  limits?: Partial<LoopLimits>
  temperature?: number
  contextLength?: number
  think?: boolean
  signal?: AbortSignal
  onEvent?: (e: LoopEvent) => void
  /** Vorherige Nachrichten fortsetzen statt neu beginnen. */
  seed?: ChatMessage[]
}

const PREVIEW = 400

export async function runAgentLoop(opts: LoopOptions): Promise<LoopResult> {
  const limits = { ...DEFAULT_LIMITS, ...opts.limits }
  const deadline = Date.now() + limits.maxWallClockMs
  const emit = (e: LoopEvent) => opts.onEvent?.(e)

  const messages: ChatMessage[] = opts.seed?.length
    ? [...opts.seed]
    : [
        { role: 'system', content: opts.system },
        { role: 'user', content: opts.task },
      ]

  let turns = 0
  let toolCalls = 0
  let failedToolCalls = 0
  let promptTokens = 0
  let completionTokens = 0
  let finalText = ''

  const result = (stopReason: LoopStopReason, error?: string, errorCode?: ProviderError['code']): LoopResult => ({
    stopReason,
    turns,
    toolCalls,
    failedToolCalls,
    promptTokens,
    completionTokens,
    finalText: finalText.trim(),
    messages,
    error,
    errorCode,
  })

  while (turns < limits.maxTurns) {
    if (opts.signal?.aborted) return result('aborted')
    if (Date.now() > deadline) return result('timeout')
    if (limits.maxTokens > 0 && promptTokens + completionTokens >= limits.maxTokens) return result('max_tokens')

    turns++
    let text = ''
    const pendingCalls: Array<{ id: string; name: string; arguments: Record<string, unknown> }> = []

    try {
      for await (const chunk of opts.provider.chat({
        model: opts.model,
        messages,
        tools: opts.tools,
        temperature: opts.temperature,
        contextLength: opts.contextLength,
        think: opts.think,
        signal: opts.signal,
      })) {
        switch (chunk.type) {
          case 'text':
            text += chunk.text
            emit({ type: 'assistant_text', text: chunk.text })
            break
          case 'thinking':
            // Bewusst nicht in `messages` — Denkschritte gehören ins Protokoll, nicht in den Kontext.
            emit({ type: 'thinking', text: chunk.text })
            break
          case 'tool_call':
            pendingCalls.push(chunk.call)
            break
          case 'done':
            promptTokens += chunk.usage.promptTokens ?? 0
            completionTokens += chunk.usage.completionTokens ?? 0
            break
        }
      }
    } catch (err) {
      if (err instanceof ProviderError && err.code === 'aborted') return result('aborted')
      return result(
        'provider_error',
        err instanceof ProviderError ? `${err.code}: ${err.message}` : String(err),
        err instanceof ProviderError ? err.code : undefined
      )
    }

    emit({ type: 'turn', index: turns, promptTokens, completionTokens })

    messages.push({
      role: 'assistant',
      content: text,
      tool_calls: pendingCalls.length ? pendingCalls.map((c) => ({ id: c.id, name: c.name, arguments: c.arguments })) : undefined,
    })

    // Keine Werkzeugaufrufe = das Modell ist fertig.
    if (pendingCalls.length === 0) {
      finalText = text
      return result('model_finished')
    }

    for (const call of pendingCalls) {
      if (opts.signal?.aborted) return result('aborted')
      emit({ type: 'tool_start', name: call.name, args: call.arguments })
      const res = await opts.bridge.call(call.name, call.arguments)
      toolCalls++
      if (res.isError) failedToolCalls++
      emit({ type: 'tool_end', name: call.name, ok: !res.isError, preview: res.text.slice(0, PREVIEW) })
      messages.push({ role: 'tool', content: res.text, tool_call_id: call.id, tool_name: call.name })
    }
  }

  return result('max_turns')
}
