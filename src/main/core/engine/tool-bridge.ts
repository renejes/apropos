import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import type { Repo } from '../repo'
import { buildMcpServer } from '../../mcp/server'
import type { ToolDefinition } from '../providers/types'

/**
 * Bindet den EINGEBAUTEN MCP-Server in-process als Client an die Engine.
 *
 * Warum über MCP statt direkter Service-Aufrufe: Der MCP-Server ist bereits die
 * Definition dessen, was eine KI mit diesem Projekt tun darf — inklusive
 * Beschreibungen, Schemata und Enforcement. Ein zweiter, handgeschriebener
 * Werkzeugkatalog für die Engine würde unweigerlich auseinanderlaufen; dann hätte
 * ausgerechnet die eigene Engine andere Regeln als der angedockte Fremdclient.
 *
 * In-Memory statt Subprozess oder Port: kein Handshake-Timeout, keine
 * Portvergabe, keine zusätzliche Angriffsfläche.
 */

/**
 * Werkzeug-Zusammenstellung je Arbeitsphase.
 *
 * Grund: Mehrere Anbieter dokumentieren, dass die Trefferquote bei der
 * Werkzeugauswahl mit der Anzahl sinkt (Moonshot warnt vor "dozens or hundreds",
 * Gemini empfiehlt 10–20, Alibaba begrenzt auf 20 pro Request). Deshalb Phasenfilter.
 */
export type EnginePhase = 'planning' | 'research' | 'synthesis'

const PHASE_TOOLS: Record<EnginePhase, string[]> = {
  planning: [
    'get_project_state',
    'get_research_brief',
    'draft_research_brief',
    'adopt_research_brief',
    'plan_research',
    'get_coverage_gaps',
  ],
  research: [
    'search_literature',
    'reflect_search',
    'fetch_source',
    'add_source',
    'exclude_source',
    'log_search',
    'log_extraction',
    'assign_source',
    'flag_uncertainty',
    'get_coverage_gaps',
    'get_research_brief',
    'list_corpus',
    'search_documents',
    'read_document',
  ],
  synthesis: [
    'get_project_state',
    'search_sources',
    'link_claim_to_source',
    'add_report_version',
    'export_bibliography',
    'export_writing_pack',
    'export_easy_writing',
    'flag_uncertainty',
    'describe_evidence_map',
    'prepare_view',
    'ask_narrative',
  ],
}

export interface ToolResult {
  text: string
  isError: boolean
}

export class ToolBridge {
  private client: Client | null = null

  constructor(
    private readonly repo: Repo,
    private readonly actorLabel = 'engine',
    private readonly clientName = 'research-engine'
  ) {}

  async connect(): Promise<void> {
    if (this.client) return
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    const server = buildMcpServer({ repo: this.repo, actorLabel: this.actorLabel })
    const client = new Client({ name: this.clientName, version: '0.1.0' })
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)])
    this.client = client
  }

  async close(): Promise<void> {
    await this.client?.close().catch(() => {})
    this.client = null
  }

  private require(): Client {
    if (!this.client) throw new Error('ToolBridge: connect() wurde nicht aufgerufen')
    return this.client
  }

  /** Alle Werkzeuge des Servers, im Format des Modell-Anbieters. */
  async listAll(): Promise<ToolDefinition[]> {
    const res = await this.require().listTools()
    return res.tools.map((t) => ({
      name: t.name,
      description: t.description ?? '',
      parameters: (t.inputSchema as Record<string, unknown>) ?? { type: 'object', properties: {} },
    }))
  }

  /** Nur die Werkzeuge, die in dieser Phase sinnvoll sind. */
  async listForPhase(phase: EnginePhase): Promise<ToolDefinition[]> {
    const wanted = new Set(PHASE_TOOLS[phase])
    const all = await this.listAll()
    const picked = all.filter((t) => wanted.has(t.name))
    // Fehlt ein erwartetes Werkzeug, ist das ein Konfigurationsfehler, kein Randfall:
    // die Schleife würde still schlechter arbeiten statt zu scheitern.
    const missing = [...wanted].filter((n) => !picked.some((p) => p.name === n))
    if (missing.length) throw new Error(`ToolBridge: Werkzeuge fehlen im MCP-Server: ${missing.join(', ')}`)
    return picked
  }

  /**
   * Führt einen Werkzeugaufruf aus. Fehler werden NICHT geworfen, sondern als
   * `isError`-Ergebnis zurückgegeben — das Modell muss sie sehen und korrigieren
   * können, statt dass der Lauf abbricht. Genau daran hängt die Selbstkorrektur
   * bei fehlgeschlagener Zitatprüfung.
   */
  async call(name: string, args: Record<string, unknown>): Promise<ToolResult> {
    try {
      const res = (await this.require().callTool({ name, arguments: args })) as {
        content?: Array<{ type: string; text?: string }>
        isError?: boolean
      }
      const text = (res.content ?? [])
        .filter((c) => c.type === 'text')
        .map((c) => c.text ?? '')
        .join('\n')
      return { text: text || '(leeres Ergebnis)', isError: res.isError === true }
    } catch (err) {
      // Unbekanntes Werkzeug, Schema-Verstoß, Transportfehler: dem Modell mitteilen.
      return { text: JSON.stringify({ error: err instanceof Error ? err.message : String(err) }), isError: true }
    }
  }
}
