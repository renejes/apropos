/**
 * Live-Check des Ollama-Adapters gegen den ECHTEN Daemon.
 * Beantwortet die Fragen, die kein Fixture beantworten kann: Läuft der Daemon,
 * ist Cloud freigeschaltet, beherrscht das Modell Werkzeugaufrufe, und kommt bei
 * einem echten Tool-Call brauchbares zurück?
 *
 *   npm run ollama:check                      # nur Status
 *   npm run ollama:check gpt-oss:120b-cloud   # zusätzlich ein echter Tool-Call
 */
import { OllamaProvider, isCloudModel } from '../src/main/core/providers/ollama'
import { ProviderError } from '../src/main/core/providers/types'

const model = process.argv[2]

async function main(): Promise<void> {
  const p = new OllamaProvider()
  console.log(`Endpoint: ${p.endpoint}\n`)

  const health = await p.health()
  console.log(`Erreichbar: ${health.reachable ? 'ja' : 'NEIN'}${health.version ? ` (v${health.version})` : ''}`)
  console.log(`Modelle registriert: ${health.modelCount ?? '—'}`)
  console.log(`Cloud: ${health.cloud.available ? 'freigegeben' : 'NICHT verfügbar'} · angemeldet: ${health.cloud.signedIn ?? 'unbekannt'}${health.cloud.plan ? ` · Plan: ${health.cloud.plan}` : ''}`)
  console.log(`  ${health.cloud.reason}`)
  console.log(`Hinweis: ${health.note}\n`)

  if (!health.reachable) {
    console.log('→ Daemon starten: ollama serve  (oder die Ollama-App öffnen)')
    return
  }

  const models = await p.listModels()
  if (models.length === 0) {
    console.log('→ Noch kein Modell registriert. Für Cloud z. B.:')
    // Kein fester Modellname: Ollama nimmt Cloud-Modelle laufend vom Netz.
    console.log('   ollama signin')
    console.log('   Verfügbare Cloud-Modelle: https://ollama.com/search?c=cloud')
    console.log('   ollama pull <name>')
    return
  }
  console.log('Registrierte Modelle:')
  for (const m of models) {
    const size = m.sizeBytes ? `${(m.sizeBytes / 1e9).toFixed(1)} GB` : 'Cloud'
    console.log(`  ${m.cloud ? '☁' : '💻'} ${m.id.padEnd(38)} ${size}`)
  }
  console.log('')

  if (!model) {
    console.log('Für einen echten Tool-Call-Test:  npm run ollama:check <modell>')
    return
  }

  console.log(`— Prüfe "${model}" (${isCloudModel(model) ? 'Cloud' : 'lokal'}) —`)
  try {
    const info = await p.describeModel(model)
    console.log(`Werkzeugaufrufe: ${info.supportsTools === null ? 'unbekannt' : info.supportsTools ? 'ja' : 'NEIN'}`)
    console.log(`Denkschritte:    ${info.supportsThinking === null ? 'unbekannt' : info.supportsThinking ? 'ja' : 'nein'}`)
    console.log(`Kontextfenster:  ${info.contextLength?.toLocaleString('de-DE') ?? 'unbekannt'}`)
    if (info.supportsTools === false) {
      console.log('\n⚠️  Ohne Tool-Support ignoriert das Modell die Research-Werkzeuge stillschweigend.')
      return
    }
  } catch (err) {
    console.log(`describeModel fehlgeschlagen: ${err instanceof Error ? err.message : err}`)
  }

  // Echter Tool-Call: erzwingt genau das Verhalten, auf dem die Research-Schleife steht.
  const t0 = Date.now()
  let text = ''
  let toolCalls = 0
  try {
    for await (const c of p.chat({
      model,
      messages: [
        { role: 'system', content: 'Du hast ein Werkzeug. Nutze es, wenn die Frage danach verlangt. Antworte sonst kurz.' },
        { role: 'user', content: 'Suche wissenschaftliche Literatur zu "citation accuracy in language models".' },
      ],
      tools: [
        {
          name: 'search_literature',
          description: 'Sucht wissenschaftliche Literatur in offenen Registern.',
          parameters: {
            type: 'object',
            properties: { query: { type: 'string', description: 'Suchbegriffe, englisch' } },
            required: ['query'],
          },
        },
      ],
      temperature: 0,
    })) {
      if (c.type === 'text') text += c.text
      if (c.type === 'tool_call') {
        toolCalls++
        console.log(`\n✅ Werkzeugaufruf: ${c.call.name}(${JSON.stringify(c.call.arguments)})`)
      }
      if (c.type === 'done') {
        console.log(`\nAbschluss: ${c.reason} · ${c.usage.promptTokens ?? '?'} Prompt- / ${c.usage.completionTokens ?? '?'} Antwort-Token · ${Date.now() - t0} ms`)
      }
    }
    if (toolCalls === 0) {
      console.log(`\n⚠️  KEIN Werkzeugaufruf. Antworttext: ${text.slice(0, 200)}`)
      console.log('   Für die Research-Schleife ist dieses Modell damit ungeeignet.')
    }
  } catch (err) {
    if (err instanceof ProviderError) {
      console.log(`\n❌ ${err.code}: ${err.message}`)
      if (err.hint) console.log(`   → ${err.hint}`)
    } else {
      console.log(`\n❌ ${err instanceof Error ? err.message : err}`)
    }
  }
}

void main()
