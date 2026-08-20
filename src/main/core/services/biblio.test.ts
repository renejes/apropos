import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { openDb, type DB } from '../db'
import { Repo } from '../repo'
import { adoptMinimalBrief } from './brief'
import {
  allocateCitekey,
  citeMarker,
  citekeyBase,
  enrichSourceBiblio,
  exportBibliography,
  formatLocator,
  rewriteCiteMarkers,
  sourceToBibtex,
} from './biblio'

describe('Bibliografie (Phase F)', () => {
  let db: DB
  let repo: Repo
  let projectId: string
  const ACTOR = 'test:biblio'

  beforeEach(() => {
    db = openDb(':memory:')
    repo = new Repo(db)
    projectId = repo.createProject({
      title: 'Biblio',
      research_question: 'Trägt der Citekey?',
      mode: 'academic',
      policy_preset: null,
      actor: ACTOR,
    }).id
    adoptMinimalBrief(repo, projectId, ACTOR)
  })
  afterEach(() => vi.unstubAllGlobals())

  const add = (over: Partial<Parameters<Repo['addSource']>[0]> = {}) =>
    repo.addSource({
      project_id: projectId,
      url: 'https://example.org/paper',
      title: 'Attention Is All You Need',
      retrieval_method: 'test',
      accessed_at: '2026-08-20T12:00:00.000Z',
      reason: 'Zentrale Quelle für den Methodenvergleich der Studie.',
      extraction: 'Transformer ersetzen Rekurrenz durch Self-Attention in Sequenzmodellen.',
      contribution: 'Stützt die Kernaussage.',
      verbatim_quote: 'The dominant sequence transduction models are based on complex recurrent.',
      actor: ACTOR,
      ...over,
    })

  it('bildet Citekeys nach nachnameJahrKurztitel, nicht aus [S#]', () => {
    expect(citekeyBase(['Ashish Vaswani'], 2017, 'Attention Is All You Need')).toBe('vaswani2017attention')
    expect(citekeyBase([], null, 'The Quick Brown Fox')).toBe('anonndquick')
    expect(allocateCitekey(['vaswani2017attention'], 'vaswani2017attention')).toBe('vaswani2017attentiona')
  })

  it('exportiert ohne DOI nur @misc mit URL und Zugriffsdatum, nie @article', () => {
    const src = add({ url: 'https://blog.example.org/meinung' })
    const enriched = { ...src, citekey: 'anonndattention', entry_type: 'misc' as const, doi: null }
    const bib = sourceToBibtex(enriched)
    expect(bib).toMatch(/^@misc\{/)
    expect(bib).not.toMatch(/@article/)
    expect(bib).toMatch(/Zugriff am 2026-08-20/)
    expect(bib).toMatch(/url = \{https:\/\/blog\.example.org\/meinung\}/)
  })

  it('zieht Metadaten von Crossref nach, wenn eine DOI da ist — nicht vom Modell', async () => {
    vi.stubGlobal('fetch', async (url: string) => {
      const u = String(url)
      if (!u.includes('api.crossref.org')) throw new Error('unerwartet: ' + u)
      return {
        ok: true,
        json: async () => ({
          message: {
            DOI: '10.5555/3295222.3295349',
            type: 'journal-article',
            title: ['Attention Is All You Need'],
            author: [{ given: 'Ashish', family: 'Vaswani' }],
            issued: { 'date-parts': [[2017]] },
            'container-title': ['NeurIPS'],
          },
        }),
      }
    })
    const src = add({ url: 'https://doi.org/10.5555/3295222.3295349' })
    const enriched = await enrichSourceBiblio(repo, src)
    expect(enriched.doi).toBe('10.5555/3295222.3295349')
    expect(enriched.year).toBe(2017)
    expect(enriched.citekey).toBe('vaswani2017attention')
    expect(enriched.entry_type).toBe('article')
    expect(JSON.parse(enriched.authors_json ?? '[]')).toContain('Ashish Vaswani')
    const bib = exportBibliography(repo, projectId)
    expect(bib).toMatch(/@article\{vaswani2017attention/)
    expect(bib).toMatch(/journal = \{NeurIPS\}/)
  })

  it('hängt bei Kollision ein Suffix an, statt den Key aus der Listenposition zu bauen', async () => {
    vi.stubGlobal('fetch', async () => {
      throw new Error('kein Netz')
    })
    const a = add({ title: 'Same Title Here' })
    const b = add({ url: 'https://example.org/other', title: 'Same Title Here' })
    const ea = await enrichSourceBiblio(repo, a)
    const eb = await enrichSourceBiblio(repo, b)
    expect(ea.citekey).not.toBe(eb.citekey)
    expect(eb.citekey).toBe(`${ea.citekey}a`)
    expect(ea.citekey).not.toMatch(/^s\d+$/i)
  })

  it('ersetzt [S#] durch [@citekey] und erfindet keine Seite', () => {
    const src = add()
    const withKey = { ...src, citekey: 'vaswani2017attention', quote_locator: null }
    expect(citeMarker(withKey, 3)).toBe('[@vaswani2017attention]')
    expect(rewriteCiteMarkers('Siehe [S1] im Text.', [withKey])).toBe('Siehe [@vaswani2017attention] im Text.')
    expect(formatLocator(null)).toBeNull()
    expect(formatLocator('p. 12')).toBe('p. 12')
    expect(formatLocator('S. 12')).toBe('p. 12')
    expect(formatLocator('Seite 12')).toBe('p. 12')
    expect(formatLocator('pp. 12-14')).toBe('pp. 12–14')
    expect(formatLocator('Einleitung, erster Satz')).toBe('Einleitung, erster Satz')
    expect(citeMarker({ ...withKey, quote_locator: 'S. 12' }, 3, true)).toBe('[@vaswani2017attention, p. 12]')
    expect(citeMarker({ ...withKey, quote_locator: null }, 3, true)).toBe('[@vaswani2017attention]')
    expect(rewriteCiteMarkers('Siehe [S1].', [{ ...withKey, quote_locator: 'S. 12' }])).toBe(
      'Siehe [@vaswani2017attention, p. 12].'
    )
  })

  it('überschreibt einen gesetzten source_kind nicht beim Nachziehen', async () => {
    vi.stubGlobal('fetch', async () => ({
      ok: true,
      json: async () => ({
        message: {
          DOI: '10.5555/3295222.3295349',
          type: 'journal-article',
          title: ['Attention Is All You Need'],
          author: [{ given: 'Ashish', family: 'Vaswani' }],
          issued: { 'date-parts': [[2017]] },
          'container-title': ['NeurIPS'],
        },
      }),
    }))
    const src = add({ url: 'https://doi.org/10.5555/3295222.3295349', source_kind: 'review' })
    const enriched = await enrichSourceBiblio(repo, src)
    expect(enriched.source_kind).toBe('review')
  })
})
