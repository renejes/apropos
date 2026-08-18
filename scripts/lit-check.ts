/**
 * Live-Check der Literatursuche gegen die ECHTEN Register (braucht Netz).
 * Die Unit-Tests prüfen die Zusammenführung mit gestubbtem fetch; dieser Check
 * beantwortet die andere Frage: Antworten die Register heute noch so, wie wir denken?
 *
 * Läuft unter Node-ABI:  npm run lit:check
 */
import { openDb } from '../src/main/core/db'
import { Repo } from '../src/main/core/repo'
import { searchLiterature } from '../src/main/core/services/literature'

const QUERY = process.argv[2] ?? 'retrieval augmented generation citation accuracy'

async function main(): Promise<void> {
  const repo = new Repo(openDb(':memory:'))
  const project = repo.createProject({
    title: 'Lit-Check',
    research_question: QUERY,
    mode: 'academic',
    policy_preset: null,
    actor: 'lit-check',
  })

  const res = await searchLiterature(
    repo,
    { project_id: project.id, query: QUERY, backends: ['openalex', 'crossref', 'europepmc', 'arxiv'], limit: 5, note: 'Live-Check' },
    'lit-check'
  )

  console.log(`Query: "${QUERY}"`)
  console.log(`Register: ${res.backends_used.join(', ')}`)
  if (res.backends_failed.length) {
    console.log(`FEHLGESCHLAGEN: ${res.backends_failed.map((f) => `${f.backend} (${f.error})`).join(', ')}`)
  }
  console.log(`Treffer nach Zusammenführung: ${res.total}\n`)

  for (const h of res.hits) {
    console.log(`• [${h.found_via.join('+')}] ${h.title.slice(0, 84)}`)
    console.log(`  ${h.year ?? '?'} · ${h.venue?.slice(0, 40) ?? '—'} · Zitate: ${h.cited_by_count ?? '—'} · DOI: ${h.doi ?? '—'}`)
    console.log(`  Volltext: ${h.oa_url ? h.oa_url.slice(0, 78) : '— (keine freie Fassung)'}\n`)
  }

  const withDoi = res.hits.filter((h) => h.doi).length
  const withOa = res.hits.filter((h) => h.oa_url).length
  const multi = res.hits.filter((h) => h.found_via.length > 1).length
  console.log(`DOI: ${withDoi}/${res.total} · frei zugänglich: ${withOa}/${res.total} · in mehreren Registern: ${multi}`)
  console.log(`Suchprotokoll (PRISMA-S): ${repo.listSearchLog(project.id).length} Einträge`)
  for (const s of repo.listSearchLog(project.id)) {
    console.log(`  - ${s.engine}: ${s.results_found ?? 'Fehler'} Treffer`)
  }
}

void main()
