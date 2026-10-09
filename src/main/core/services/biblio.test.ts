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
  exportRis,
  formatLocator,
  proposeBiblio,
  acceptBiblioSuggestion,
  rejectBiblioSuggestion,
  rewriteCiteMarkers,
  saveSourceImprint,
  searchBiblioForSource,
  sourceToBibtex,
  titleOverlap,
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

  it('macht aus einem Crossref-Buchkapitel einen Sammelbandbeitrag', async () => {
    vi.stubGlobal('fetch', async () => ({
      ok: true,
      json: async () => ({
        message: {
          DOI: '10.1007/chapter',
          type: 'book-chapter',
          title: ['Mikropolitischer Führungsansatz'],
          author: [{ given: 'Rainhart', family: 'Lang' }],
          editor: [{ given: 'Irma', family: 'Rybnikova' }],
          issued: { 'date-parts': [[2014]] },
          'container-title': ['Aktuelle Führungstheorien und -konzepte'],
          page: '181-212',
          publisher: 'Springer',
          'publisher-location': 'Wiesbaden',
        },
      }),
    }))
    const src = add({ url: 'https://doi.org/10.1007/chapter', title: 'Mikropolitischer Führungsansatz' })
    const enriched = await enrichSourceBiblio(repo, src)
    expect(enriched.entry_type).toBe('book')
    expect(enriched.booktitle).toBe('Aktuelle Führungstheorien und -konzepte')
    expect(enriched.publisher).toBe('Springer')
    expect(enriched.place).toBe('Wiesbaden')
    expect(JSON.parse(enriched.editors_json ?? '[]')).toEqual(['Irma Rybnikova'])
    repo.signSourceHuman(enriched.id, 'human_signed', 'übernommen', ACTOR)
    expect(exportBibliography(repo, projectId)).toMatch(/@incollection\{/)
  })

  it('lässt ein Buch ohne DOI ein Buch und schreibt RIS mit Anfangs- und Endseite', () => {
    const src = add({
      url: 'https://example.org/lehrbuch',
      title: 'Psychologie',
      entry_type: 'book',
      authors_json: JSON.stringify(['David Myers']),
      year: 2014,
      publisher: 'Springer',
      place: 'Berlin',
      edition: '3',
      booktitle: 'Aktuelle Führungstheorien',
      editors_json: JSON.stringify(['Rainhart Lang']),
      pages: '181-212',
    })
    repo.signSourceHuman(src.id, 'human_signed', 'übernommen', ACTOR)
    const stored = repo.getSource(src.id)!
    const bib = sourceToBibtex(stored)
    expect(bib).toMatch(/^@incollection\{/)
    expect(bib).toMatch(/publisher = \{Springer\}/)
    expect(bib).toMatch(/booktitle = \{Aktuelle Führungstheorien\}/)
    expect(bib).not.toMatch(/Zugriff am/)
    const ris = exportRis(repo, projectId)
    expect(ris).toMatch(/TY  - CHAP/)
    expect(ris).toMatch(/SP  - 181/)
    expect(ris).toMatch(/EP  - 212/)
    expect(ris).toMatch(/PB  - Springer/)
    expect(ris).not.toMatch(/pages =/)
  })

  it('übernimmt Titelangaben vom Menschen und lehnt f. und ff. ab', () => {
    const src = add()
    const saved = saveSourceImprint(
      repo,
      {
        source_id: src.id,
        entry_type: 'article',
        authors: ['Ashish Vaswani'],
        year: 2017,
        venue: 'NeurIPS',
        volume: '30',
        issue: null,
        pages: '5998-6008',
        publisher: null,
        place: null,
        edition: null,
        editors: [],
        booktitle: null,
      },
      ACTOR
    )
    expect(saved.volume).toBe('30')
    expect(saved.pages).toBe('5998-6008')
    expect(saved.citekey).toBe(src.citekey)
    expect(() =>
      saveSourceImprint(
        repo,
        {
          source_id: src.id,
          entry_type: 'article',
          authors: [],
          year: null,
          venue: null,
          volume: null,
          issue: null,
          pages: '12 ff.',
          publisher: null,
          place: null,
          edition: null,
          editors: [],
          booktitle: null,
        },
        ACTOR
      )
    ).toThrow(/f\./)
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
            volume: '30',
            page: '5998-6008',
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
    expect(enriched.volume).toBe('30')
    expect(enriched.pages).toBe('5998-6008')
    expect(JSON.parse(enriched.authors_json ?? '[]')).toContain('Ashish Vaswani')
    repo.signSourceHuman(enriched.id, 'human_signed', 'übernommen', ACTOR)
    const bib = exportBibliography(repo, projectId)
    expect(bib).toMatch(/@article\{vaswani2017attention/)
    expect(bib).toMatch(/journal = \{NeurIPS\}/)
  })

  it('exportiert nur übernommene Quellen, offene bleiben draußen', () => {
    const open = add({ url: 'https://example.org/open', title: 'Noch offen' })
    const taken = add({ url: 'https://example.org/taken', title: 'Übernommen' })
    repo.signSourceHuman(taken.id, 'human_signed', 'übernommen', ACTOR)
    const bib = exportBibliography(repo, projectId)
    expect(bib).toMatch(/example\.org\/taken/)
    expect(bib).not.toMatch(/example\.org\/open/)
    expect(exportBibliography(repo, projectId, [open.id])).toMatch(/keine übernommenen Quellen/)
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
    expect(formatLocator('S. 12', 'dgps')).toBe('S. 12')
    expect(formatLocator('pp. 12-14', 'dgps')).toBe('S. 12–14')
    expect(formatLocator('12 f.')).toBe('p. 12')
    expect(formatLocator('ff.')).toBeNull()
    expect(citeMarker({ ...withKey, quote_locator: 'S. 12' }, 3, true)).toBe('[@vaswani2017attention, p. 12]')
    expect(citeMarker({ ...withKey, quote_locator: 'S. 12' }, 3, true, 'dgps')).toBe('[@vaswani2017attention, S. 12]')
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

  const crossrefWork = {
    DOI: '10.5555/3295222.3295349',
    type: 'journal-article',
    title: ['Attention Is All You Need'],
    author: [{ given: 'Ashish', family: 'Vaswani' }],
    issued: { 'date-parts': [[2017]] },
    'container-title': ['NeurIPS'],
  }

  it('misst Titelüberlappung grob, ohne Stoppwörter', () => {
    expect(titleOverlap('Attention Is All You Need', 'Attention is all you need')).toBe(1)
    expect(titleOverlap('Attention Is All You Need', 'Completely Unrelated Zoology Paper')).toBe(0)
  })

  it('sucht bei Crossref nach Titel und schlägt eine geprüfte DOI vor', async () => {
    vi.stubGlobal('fetch', async (url: string) => {
      const u = String(url)
      if (u.includes('query.bibliographic')) {
        return { ok: true, json: async () => ({ message: { items: [crossrefWork] } }) }
      }
      if (u.includes('api.crossref.org/works/')) {
        return { ok: true, json: async () => ({ message: crossrefWork }) }
      }
      throw new Error('unerwartet: ' + u)
    })
    const src = add({ title: 'Attention Is All You Need', url: 'https://arxiv.org/pdf/1706.03762' })
    const searched = await searchBiblioForSource(repo, { source_id: src.id })
    expect(searched.hits[0]?.doi).toBe('10.5555/3295222.3295349')
    expect(searched.hits[0]?.overlap).toBeGreaterThan(0.5)

    const proposed = await proposeBiblio(
      repo,
      { source_id: src.id, doi: '10.5555/3295222.3295349', reason: 'Crossref-Treffer zum Titel des PDFs.' },
      ACTOR
    )
    expect(proposed.suggestion.status).toBe('pending')
    expect(proposed.suggestion.proposed_year).toBe(2017)

    const accepted = await acceptBiblioSuggestion(repo, proposed.suggestion.id, 'human:ui')
    expect(accepted.source.doi).toBe('10.5555/3295222.3295349')
    expect(accepted.source.citekey).toBe('vaswani2017attention')
    expect(accepted.source.entry_type).toBe('article')
    expect(accepted.suggestion.status).toBe('accepted')
  })

  it('behält den Citekey nach Sign-off und liest die DOI aus dem gespeicherten Text', async () => {
    vi.stubGlobal('fetch', async () => ({
      ok: true,
      json: async () => ({ message: crossrefWork }),
    }))
    const src = add({ title: 'Institution PDF ohne DOI in der URL' })
    repo.setSourceBiblio(src.id, { citekey: 'alt2024placeholder', entry_type: 'misc' })
    repo.signSourceHuman(src.id, 'human_signed', 'übernommen', ACTOR)
    const text = 'Siehe DOI 10.5555/3295222.3295349 im Kopf.'
    const start = text.indexOf('10.5555')
    const doc = repo.addDocument({
      project_id: projectId,
      url: 'https://example.org/campus.pdf',
      title: 'Campus-PDF',
      text,
      content_hash: 'h1',
      actor: ACTOR,
    })
    const proposed = await proposeBiblio(
      repo,
      {
        source_id: src.id,
        document_id: doc.id,
        quote_start: start,
        quote_end: start + '10.5555/3295222.3295349'.length,
        reason: 'DOI steht auf der Titelseite des gespeicherten PDFs.',
      },
      ACTOR
    )
    expect(proposed.suggestion.found_via).toBe('document_offset')
    const accepted = await acceptBiblioSuggestion(repo, proposed.suggestion.id, 'human:ui')
    expect(accepted.source.doi).toBe('10.5555/3295222.3295349')
    expect(accepted.source.citekey).toBe('alt2024placeholder')
  })

  it('lehnt unbekannte DOIs ab und lässt den Menschen Vorschläge verwerfen', async () => {
    vi.stubGlobal('fetch', async () => ({ ok: false, json: async () => ({}) }))
    const src = add()
    await expect(
      proposeBiblio(repo, { source_id: src.id, doi: '10.9999/gibt-es-nicht', reason: 'Geratene DOI ohne Register.' }, ACTOR)
    ).rejects.toMatchObject({ code: 'biblio_doi_unknown' })

    vi.stubGlobal('fetch', async () => ({
      ok: true,
      json: async () => ({ message: crossrefWork }),
    }))
    const proposed = await proposeBiblio(
      repo,
      { source_id: src.id, doi: '10.5555/3295222.3295349', reason: 'Doch Crossref, aber falscher Treffer.' },
      ACTOR
    )
    const rejected = rejectBiblioSuggestion(repo, proposed.suggestion.id, 'human:ui')
    expect(rejected.status).toBe('rejected')
    expect(repo.getSource(src.id)?.doi).toBeNull()
  })

  it('lehnt Bibliografie-Vorschläge in Notebooks ab', async () => {
    const nb = repo.createProject({
      title: 'Notizbuch',
      research_question: '',
      mode: 'academic',
      policy_preset: null,
      kind: 'notebook',
      actor: ACTOR,
    })
    const src = repo.addSource({
      project_id: nb.id,
      url: 'https://example.org/nb',
      title: 'Attention Is All You Need',
      retrieval_method: 'test',
      accessed_at: '2026-08-20T12:00:00.000Z',
      reason: 'Nur zum Lesen, keine Research-Akte.',
      extraction: 'Notebook-Quelle ohne Bibliografie-Vorschlag.',
      contribution: 'Kein Bericht.',
      verbatim_quote: 'The dominant sequence transduction models are based on complex recurrent.',
      actor: ACTOR,
    })
    await expect(searchBiblioForSource(repo, { source_id: src.id })).rejects.toMatchObject({ code: 'biblio_not_research' })
  })
})
