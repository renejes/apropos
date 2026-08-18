/**
 * Prüft, dass die Server-Instructions wirklich im initialize-Ergebnis beim Client landen.
 *
 * Warum als eigenes Skript: Das ist der einzige Weg, den Arbeitsvertrag ohne MCP-Prompts
 * zu übermitteln — und viele Clients können Prompts nur anzeigen, nicht ausführen. Wenn
 * dieser Kanal stillschweigend leer bliebe, wäre das nicht bemerkbar.
 *
 *   npx tsx scripts/instructions-check.ts
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { openDb } from '../src/main/core/db'
import { Repo } from '../src/main/core/repo'
import { buildMcpServer } from '../src/main/mcp/server'

async function main(): Promise<void> {
  const repo = new Repo(openDb(':memory:'))
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  const server = buildMcpServer({ repo, actorLabel: 'check' })
  const client = new Client({ name: 'instructions-check', version: '0.0.1' })
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)])

  const instructions = client.getInstructions()
  const tools = await client.listTools()
  const prompts = await client.listPrompts()

  console.log(`Server-Instructions: ${instructions ? `${instructions.length} Zeichen` : 'FEHLEN'}`)
  console.log(`Tools: ${tools.tools.length} · Prompts: ${prompts.prompts.length}\n`)

  if (instructions) {
    console.log('--- Instructions, wie ein Client sie erhält ---')
    console.log(instructions)
  }

  // Tool-Beschreibungen sind tragend: sie enthalten den Arbeitsvertrag im Detail.
  const longest = [...tools.tools].sort((a, b) => (b.description?.length ?? 0) - (a.description?.length ?? 0))[0]
  console.log(`\nLängste Tool-Beschreibung: ${longest?.name} (${longest?.description?.length ?? 0} Zeichen)`)
  const total = tools.tools.reduce((n, t) => n + (t.description?.length ?? 0), 0)
  console.log(`Summe aller Tool-Beschreibungen: ${total} Zeichen (~${Math.round(total / 4)} Token)`)

  await client.close()
}

void main()
