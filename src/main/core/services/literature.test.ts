import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { openDb, type DB } from '../db'
import { Repo } from '../repo'
import { searchLiterature } from './literature'
import { ServiceError } from './research'
import { adoptMinimalBrief, adoptResearchBrief, MINIMAL_BRIEF_INPUT } from './brief'

/**
 * Tests der Literatursuche mit gestubbtem fetch — die Zusammenführung über Register
 * hinweg lässt sich an echten APIs nicht zuverlässig provozieren (ob zwei Register
 * dieselbe Arbeit liefern, ist Zufall). Hier wird sie kontrolliert geprüft.
 */
describe('Literatursuche über offene Register', () => {
  let db: DB
  let repo: Repo
  let projectId: string
  const ACTOR = 'test:lit'

  beforeEach(() => {
    db = openDb(':memory:')
    repo = new Repo(db)
    projectId = repo.createProject({ title: 'T', research_question: 'x', mode: 'academic', policy_preset: null, actor: ACTOR }).id
    adoptMinimalBrief(repo, projectId, ACTOR)
  })
  afterEach(() => vi.unstubAllGlobals())

  const openAlexWork = (over: Record<string, unknown> = {}) => ({
    display_name: 'Attention Is All You Need',
    doi: 'https://doi.org/10.5555/3295222.3295349',
    publication_year: 2017,
    authorships: [{ author: { display_name: 'Ashish Vaswani' } }],
    primary_location: { source: { display_name: 'NeurIPS' }, landing_page_url: 'https://papers.nips.cc/paper/7181' },
    open_access: { is_oa: true, oa_url: 'https://arxiv.org/pdf/1706.03762' },
    cited_by_count: 100_000,
    abstract_inverted_index: { The: [0], dominant: [1], sequence: [2] },
    ...over,
  })

  const crossrefItem = (over: Record<string, unknown> = {}) => ({
    DOI: '10.5555/3295222.3295349',
    title: ['Attention Is All You Need'],
    author: [{ given: 'Ashish', family: 'Vaswani' }],
    issued: { 'date-parts': [[2017]] },
    'container-title': ['Advances in NeurIPS'],
    abstract: '<jats:p>The dominant sequence transduction models…</jats:p>',
    'is-referenced-by-count': 95_000,
    ...over,
  })

  /** fetch nach Ziel-Host beantworten. */
  const stubFetch = (h: {
    openalex?: unknown
    crossref?: unknown
    europepmc?: unknown
    arxivXml?: string
    fail?: string[]
    seen?: string[]
  }) => {
    vi.stubGlobal('fetch', async (url: string) => {
      const u = String(url)
      h.seen?.push(u)
      if (h.fail?.some((f) => u.includes(f))) throw new Error('Netzwerkfehler (simuliert)')
      const json = (body: unknown) => ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) })
      if (u.includes('api.openalex.org')) return json(h.openalex ?? { results: [] })
      if (u.includes('api.crossref.org')) return json(h.crossref ?? { message: { items: [] } })
      if (u.includes('ebi.ac.uk')) return json(h.europepmc ?? { resultList: { result: [] } })
      if (u.includes('arxiv.org')) return { ok: true, status: 200, text: async () => h.arxivXml ?? '<feed></feed>', json: async () => ({}) }
      throw new Error('unerwartete URL: ' + u)
    })
  }

  const search = (over: Record<string, unknown> = {}) =>
    searchLiterature(repo, { project_id: projectId, query: 'transformer attention', limit: 5, ...over }, ACTOR)

  it('führt dieselbe Arbeit aus zwei Registern über den DOI zusammen', async () => {
    stubFetch({ openalex: { results: [openAlexWork()] }, crossref: { message: { items: [crossrefItem()] } } })
    const res = await search({ backends: ['openalex', 'crossref'] })

    expect(res.total).toBe(1) // nicht zwei Einträge
    expect(res.hits[0].found_via.sort()).toEqual(['crossref', 'openalex'])
    // Felder werden ergänzt, nicht überschrieben: OA-Link kommt nur von OpenAlex
    expect(res.hits[0].oa_url).toBe('https://arxiv.org/pdf/1706.03762')
    expect(res.hits[0].url).toBe('https://papers.nips.cc/paper/7181')
    expect(res.hits[0].venue).toBe('NeurIPS')
  })

  it('führt auch ohne DOI über den normalisierten Titel zusammen', async () => {
    stubFetch({
      openalex: { results: [openAlexWork({ doi: null })] },
      crossref: { message: { items: [crossrefItem({ DOI: null, title: ['Attention is all you need!'] })] } },
    })
    const res = await search({ backends: ['openalex', 'crossref'] })
    expect(res.total).toBe(1)
    expect(res.hits[0].found_via).toHaveLength(2)
  })

  it('trennt unterschiedliche Arbeiten mit ähnlichem Titel', async () => {
    stubFetch({
      openalex: { results: [openAlexWork()] },
      crossref: { message: { items: [crossrefItem({ DOI: '10.1007/978-3-031-84300-6_13', title: ['Is Attention All You Need?'] })] } },
    })
    const res = await search({ backends: ['openalex', 'crossref'] })
    expect(res.total).toBe(2)
  })

  it('stellt Mehrfachfunde nach oben', async () => {
    stubFetch({
      openalex: {
        results: [
          openAlexWork({ display_name: 'Nur OpenAlex', doi: '10.1/only', cited_by_count: 999_999 }),
          openAlexWork(), // auch bei Crossref
        ],
      },
      crossref: { message: { items: [crossrefItem()] } },
    })
    const res = await search({ backends: ['openalex', 'crossref'] })
    expect(res.hits[0].found_via).toHaveLength(2) // trotz niedrigerer Zitationszahl vorn
  })

  it('verdrängt arXiv nicht, obwohl es keine Zitationszahlen liefert', async () => {
    const arxivXml = `<feed><entry>
      <id>http://arxiv.org/abs/2401.00001v1</id><published>2024-01-01T00:00:00Z</published>
      <title>Ein Preprint ohne Zitationszahl</title><summary>Zusammenfassung.</summary>
      <author><name>A. Autor</name></author>
      <link title="pdf" href="http://arxiv.org/pdf/2401.00001v1"/>
    </entry></feed>`
    stubFetch({
      openalex: { results: Array.from({ length: 5 }, (_, i) => openAlexWork({ display_name: `OA ${i}`, doi: `10.1/oa${i}`, cited_by_count: 5000 })) },
      arxivXml,
    })
    const res = await search({ backends: ['openalex', 'arxiv'], limit: 5 })
    // Round-Robin: arXiv ist vertreten, obwohl cited_by_count null ist
    expect(res.hits.some((h) => h.found_via.includes('arxiv'))).toBe(true)
    expect(res.hits.find((h) => h.found_via.includes('arxiv'))?.oa_url).toBe('http://arxiv.org/pdf/2401.00001v1')
    expect(res.hits.find((h) => h.found_via.includes('arxiv'))?.url).toBe('http://arxiv.org/abs/2401.00001v1')
  })

  it('überlebt den Ausfall eines Registers und protokolliert ihn', async () => {
    stubFetch({ openalex: { results: [openAlexWork()] }, fail: ['api.crossref.org'] })
    const res = await search({ backends: ['openalex', 'crossref'] })

    expect(res.backends_used).toEqual(['openalex'])
    expect(res.backends_failed[0].backend).toBe('crossref')
    expect(res.total).toBe(1)
    const log = repo.listSearchLog(projectId)
    expect(log).toHaveLength(2) // auch der Fehlversuch steht im Protokoll
    expect(log.find((l) => l.engine === 'Crossref')?.note).toMatch(/FEHLGESCHLAGEN/)
  })

  it('wirft, wenn ALLE Register ausfallen', async () => {
    stubFetch({ fail: ['api.openalex.org', 'api.crossref.org'] })
    await expect(search({ backends: ['openalex', 'crossref'] })).rejects.toBeInstanceOf(ServiceError)
    expect(repo.listSearchLog(projectId)).toHaveLength(2) // Fehlversuche bleiben dokumentiert
  })

  it('protokolliert jede Teilsuche einzeln (PRISMA-S)', async () => {
    stubFetch({ openalex: { results: [openAlexWork()] } })
    const res = await search({ backends: ['openalex', 'crossref', 'europepmc'], note: 'Warum diese Suche' })
    expect(res.search_log_ids).toHaveLength(3)
    const log = repo.listSearchLog(projectId)
    expect(log.map((l) => l.engine).sort()).toEqual(['Crossref', 'Europe PMC', 'OpenAlex'])
    expect(log.find((l) => l.engine === 'OpenAlex')?.note).toBe('Warum diese Suche')
    expect(log.find((l) => l.engine === 'Crossref')?.results_found).toBe(0)
  })

  it('dreht den invertierten OpenAlex-Abstract zurück', async () => {
    stubFetch({ openalex: { results: [openAlexWork()] } })
    const res = await search({ backends: ['openalex'] })
    expect(res.hits[0].abstract).toBe('The dominant sequence')
  })

  it('entfernt JATS-Markup aus Crossref-Abstracts', async () => {
    stubFetch({ crossref: { message: { items: [crossrefItem()] } } })
    const res = await search({ backends: ['crossref'] })
    expect(res.hits[0].abstract).toBe('The dominant sequence transduction models…')
  })

  it('normalisiert DOIs aus unterschiedlichen Schreibweisen', async () => {
    stubFetch({ openalex: { results: [openAlexWork({ doi: 'HTTPS://DOI.ORG/10.5555/ABC.' })] } })
    const res = await search({ backends: ['openalex'] })
    expect(res.hits[0].doi).toBe('10.5555/abc')
  })

  it('bevorzugt die Landing-Page als url und lässt oa_url die PDF', async () => {
    stubFetch({ openalex: { results: [openAlexWork()] } })
    const res = await search({ backends: ['openalex'] })
    expect(res.hits[0].url).toBe('https://papers.nips.cc/paper/7181')
    expect(res.hits[0].oa_url).toBe('https://arxiv.org/pdf/1706.03762')
    expect(res.hits[0].url).not.toMatch(/\.pdf/i)
  })

  it('lehnt einen widersprüchlichen Jahresbereich ab', async () => {
    stubFetch({})
    await expect(search({ year_from: 2020, year_to: 2010 })).rejects.toThrow(/year_from/)
  })

  it('lehnt unbekannte Projekte ab', async () => {
    stubFetch({})
    await expect(searchLiterature(repo, { project_id: 'gibtsnicht', query: 'test' }, ACTOR)).rejects.toThrow(/existiert nicht/)
  })

  it('lehnt die Suche ohne adoptierten Brief ab', async () => {
    stubFetch({})
    const bare = repo.createProject({ title: 'Nackt', research_question: 'x', mode: 'academic', policy_preset: null, actor: ACTOR }).id
    await expect(searchLiterature(repo, { project_id: bare, query: 'transformer attention' }, ACTOR)).rejects.toMatchObject({
      code: 'brief_required',
    })
  })

  it('übernimmt den Zeitraum aus dem Brief und nennt die PSYNDEX-Lücke bei Psychologie', async () => {
    const seen: string[] = []
    stubFetch({ seen })
    const psych = repo.createProject({ title: 'Psych', research_question: 'x', mode: 'academic', policy_preset: null, actor: ACTOR }).id
    adoptResearchBrief(
      repo,
      {
        project_id: psych,
        ...MINIMAL_BRIEF_INPUT,
        discipline: 'psychology',
        year_from: 2016,
        year_to: 2020,
      },
      ACTOR
    )
    const res = await searchLiterature(repo, { project_id: psych, query: 'bindungsstil', limit: 3 }, ACTOR)
    expect(seen.some((u) => u.includes('2016'))).toBe(true)
    expect(res.hint).toMatch(/PSYNDEX/)
    expect(res.backends_used.sort()).toEqual(['crossref', 'europepmc', 'openalex'])
    expect(res.backends_used).not.toContain('arxiv')
  })
})
