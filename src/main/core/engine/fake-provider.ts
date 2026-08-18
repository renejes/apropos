import type { ChatChunk, ChatRequest, ModelInfo, ModelProvider, ProviderHealth } from '../providers/types'
import { ProviderError } from '../providers/types'

/**
 * Skriptbarer Modell-Anbieter für Tests.
 *
 * Nur so ist die Schleife überhaupt prüfbar: Ein echtes Modell entscheidet
 * nichtdeterministisch, ob und welche Werkzeuge es aufruft. Hier wird genau das
 * vorgegeben — damit lassen sich Turn-Grenzen, Fehlerbehandlung,
 * Werkzeug-Rückkopplung und Abbruch reproduzierbar testen.
 *
 * Liegt neben dem Produktionscode (nicht in einer .test-Datei), weil mehrere
 * Testdateien ihn brauchen. Wird nie in die App importiert.
 */

export type FakeTurn =
  | { text: string }
  | { toolCalls: Array<{ name: string; arguments: Record<string, unknown> }>; text?: string }
  | { error: ProviderError }
  /** Antwortet abhängig davon, was bisher passiert ist (z. B. Werkzeug-Ergebnisse lesen). */
  | { dynamic: (req: ChatRequest, turnIndex: number) => FakeTurn }

type StaticTurn = Exclude<FakeTurn, { dynamic: unknown }>

/** Dynamische Antworten auflösen — sie dürfen sich auf den bisherigen Verlauf beziehen. */
function resolve(turn: FakeTurn, req: ChatRequest, turnIndex: number): StaticTurn {
  let t = turn
  for (let guard = 0; guard < 5; guard++) {
    if (!('dynamic' in t)) return t
    t = t.dynamic(req, turnIndex)
  }
  throw new Error('FakeProvider: dynamic() zu tief verschachtelt')
}

export class FakeProvider implements ModelProvider {
  readonly id = 'fake'
  readonly label = 'Fake (Tests)'
  readonly endpoint = 'memory://fake'

  /** Alle empfangenen Anfragen — für Zusicherungen über Werkzeuge und Verlauf. */
  readonly requests: ChatRequest[] = []
  private index = 0

  constructor(private readonly script: FakeTurn[]) {}

  get turnsUsed(): number {
    return this.index
  }

  async health(): Promise<ProviderHealth> {
    return {
      reachable: true,
      version: 'fake',
      modelCount: 1,
      cloud: { available: false, signedIn: null, plan: null, reason: 'Testdouble' },
      note: 'ok',
    }
  }

  async listModels(): Promise<ModelInfo[]> {
    return [{ id: 'fake-model', label: 'fake-model', sizeBytes: null, cloud: false, contextLength: 8192, supportsTools: true, supportsThinking: false }]
  }

  async *chat(req: ChatRequest): AsyncGenerator<ChatChunk, void, undefined> {
    this.requests.push(req)
    const turnIndex = this.index
    const turn = resolve(this.script[this.index] ?? { text: 'Fertig.' }, req, turnIndex)
    this.index++

    if (req.signal?.aborted) throw new ProviderError('aborted', 'Abgebrochen.')
    if ('error' in turn) throw turn.error

    if ('toolCalls' in turn) {
      if (turn.text) yield { type: 'text', text: turn.text }
      for (const [i, c] of turn.toolCalls.entries()) {
        yield { type: 'tool_call', call: { id: `call-${turnIndex}-${i}`, name: c.name, arguments: c.arguments } }
      }
    } else {
      yield { type: 'text', text: turn.text }
    }

    yield { type: 'done', reason: 'stop', usage: { promptTokens: 100, completionTokens: 20, totalDurationMs: 5 } }
  }
}
