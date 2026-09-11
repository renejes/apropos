import { createServer, type Server } from 'node:http'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { openDb, SCHEMA_VERSION, type DB } from '../db'
import { Repo } from '../repo'
import { fetchDocument, recordSource, ServiceError } from './research'
import { addWatchlistEntry, assessCarrier, findImpressumUrl, registrableDomain } from './carriers'
import { adoptMinimalBrief } from './brief'
import { buildMinimalPdf } from '../enforce/minimal-pdf'

const QUOTE = 'Verifiable provenance is the foundation of trustworthy AI research.'
const ACTOR = 'test:carrier'

describe('Träger und Fundstelle', () => {
  let db: DB
  let repo: Repo
  let server: Server
  let origin: string
  const prevPrivate = process.env.RESEARCH_ALLOW_PRIVATE_FETCH

  beforeAll(async () => {
    process.env.RESEARCH_ALLOW_PRIVATE_FETCH = '1'
    const pdf = buildMinimalPdf(QUOTE)
    server = createServer((req, res) => {
      const url = req.url ?? '/'
      if (url.startsWith('/post')) {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
        res.end(
          `<!doctype html><html><body><h1>Blog</h1><p>Wir veröffentlichen Studien.</p><a href="/files/study.pdf">PDF</a><a href="/impressum">Impressum</a></body></html>`
        )
        return
      }
      if (url.startsWith('/files/study.pdf')) {
        res.writeHead(200, { 'content-type': 'application/pdf' })
        res.end(pdf)
        return
      }
      if (url.startsWith('/impressum')) {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
        res.end('<!doctype html><html><body><h1>Impressum</h1><p>Herausgeber: Beispiel-Verlag GmbH, Berlin.</p></body></html>')
        return
      }
      if (url.startsWith('/direct.pdf')) {
        res.writeHead(200, { 'content-type': 'application/pdf' })
        res.end(pdf)
        return
      }
      res.writeHead(404)
      res.end('missing')
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  })

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())))
    if (prevPrivate === undefined) delete process.env.RESEARCH_ALLOW_PRIVATE_FETCH
    else process.env.RESEARCH_ALLOW_PRIVATE_FETCH = prevPrivate
  })

  afterEach(() => {
    db?.close()
  })

  const setup = () => {
    db = openDb(':memory:')
    repo = new Repo(db)
    expect(db.pragma('user_version', { simple: true })).toBe(SCHEMA_VERSION)
    const project = repo.createProject({
      title: 'Träger',
      research_question: 'Woher kommt die PDF?',
      mode: 'academic',
      policy_preset: null,
      actor: ACTOR,
    })
    adoptMinimalBrief(repo, project.id, ACTOR)
    return project
  }

  it('nimmt IP-Hosts als Domain, nicht die letzten zwei Oktette', () => {
    expect(registrableDomain('127.0.0.1')).toBe('127.0.0.1')
    expect(registrableDomain('www.compact-example.de')).toBe('compact-example.de')
  })

  it('findet Impressum-Links in der Landing-HTML', () => {
    const html = '<a href="/impressum">Impressum</a>'
    expect(findImpressumUrl(html, 'https://blog.example.org/post')).toBe('https://blog.example.org/impressum')
  })

  it('holt PDF plus Landing und legt einen Träger an', async () => {
    const project = setup()
    const pdfUrl = `${origin}/files/study.pdf`
    const parent = `${origin}/post`
    const fetched = await fetchDocument(
      repo,
      { project_id: project.id, url: pdfUrl, purpose: 'Studie aus dem Blog lesen', parent_url: parent },
      ACTOR
    )
    expect(fetched.carrier_id).toBeTruthy()
    expect(fetched.parent_document_id).toBeTruthy()
    expect(fetched.imprint_document_id).toBeTruthy()
    expect(fetched.carrier_needs_assessment).toBe(true)
    const roles = repo.listDocuments(project.id).map((d) => d.document_role)
    expect(roles).toContain('work')
    expect(roles).toContain('landing')
    expect(roles).toContain('imprint')
    expect(repo.listOpenDocuments(project.id)).toHaveLength(1)
  })

  it('lässt Direkt-PDF ohne erfundene Landing', async () => {
    const project = setup()
    const fetched = await fetchDocument(
      repo,
      { project_id: project.id, url: `${origin}/direct.pdf`, purpose: 'Direkt gefundene PDF lesen' },
      ACTOR
    )
    const ctx = repo.getLatestDocumentContext(fetched.document_id)
    expect(ctx?.parent_document_id).toBeNull()
    expect(fetched.hint).toMatch(/Keine Landing-Seite/)
  })

  it('lehnt add_source ohne Trägerprofil ab', async () => {
    const project = setup()
    const fetched = await fetchDocument(
      repo,
      { project_id: project.id, url: `${origin}/direct.pdf`, purpose: 'Direkt gefundene PDF lesen' },
      ACTOR
    )
    await expect(
      recordSource(
        repo,
        {
          project_id: project.id,
          url: fetched.url,
          title: 'Direkt-PDF',
          retrieval_method: 'fetch_source',
          reason: 'Beleg aus der selbst abgerufenen PDF mit Offsets geschnitten.',
          extraction: 'Verifizierbare Provenienz bleibt die Grundlage der Research.',
          contribution: 'Stützt die Kernthese.',
          document_id: fetched.document_id,
          quote_start: fetched.window.offset,
          quote_end: fetched.window.offset + Math.min(80, fetched.window.length),
        },
        ACTOR
      )
    ).rejects.toMatchObject({ code: 'carrier_profile_required' })
  })

  it('erlaubt add_source nach assess_carrier', async () => {
    const project = setup()
    const fetched = await fetchDocument(
      repo,
      {
        project_id: project.id,
        url: `${origin}/files/study.pdf`,
        purpose: 'Studie aus dem Blog lesen',
        parent_url: `${origin}/post`,
      },
      ACTOR
    )
    const assessed = assessCarrier(
      repo,
      {
        project_id: project.id,
        carrier_id: fetched.carrier_id,
        observed: 'Impressum nennt Beispiel-Verlag GmbH in Berlin als Herausgeber.',
        interpretation: 'Kommerzieller Verlag, der die Studie auf einem Blog rahmt.',
        uncertainty: 'Finanzierung und politische Nähe sind aus dem Impressum nicht ersichtlich.',
        carrier_kind: 'blog',
        evidence_basis: 'imprint',
        self_description_document_id: fetched.imprint_document_id,
        self_description_start: 0,
        self_description_end: 40,
      },
      ACTOR
    )
    expect(assessed.profile.review_status).toBe('pending')
    const start = fetched.window.text.indexOf(QUOTE)
    const added = await recordSource(
      repo,
      {
        project_id: project.id,
        url: fetched.url,
        title: 'Studie',
        retrieval_method: 'fetch_source',
        reason: 'Beleg aus der selbst abgerufenen PDF mit Offsets geschnitten.',
        extraction: 'Verifizierbare Provenienz bleibt die Grundlage der Research.',
        contribution: 'Stützt die Kernthese.',
        document_id: fetched.document_id,
        quote_start: fetched.window.offset + start,
        quote_end: fetched.window.offset + start + QUOTE.length,
      },
      ACTOR
    )
    expect(added.source.carrier_id).toBe(fetched.carrier_id)
    expect(added.source.context_id).toBe(fetched.context_id)
  })

  it('blockiert add_source bei Watchlist-Ausschluss', async () => {
    const project = setup()
    addWatchlistEntry(
      repo,
      { project_id: project.id, list_kind: 'exclude', domain: '127.0.0.1', note: 'Lokaler Test-Ausschluss für die Domain.' },
      'human:ui'
    )
    const fetched = await fetchDocument(
      repo,
      { project_id: project.id, url: `${origin}/direct.pdf`, purpose: 'Direkt gefundene PDF lesen' },
      ACTOR
    )
    await assessCarrier(
      repo,
      {
        project_id: project.id,
        carrier_id: fetched.carrier_id,
        observed: 'Testdomain steht auf der Ausschlussliste des Projekts.',
        interpretation: 'Quelle darf nicht in den Bericht.',
        uncertainty: 'Keine weitere Einordnung nötig.',
        carrier_kind: 'unknown',
        evidence_basis: 'domain_list',
      },
      ACTOR
    )
    await expect(
      recordSource(
        repo,
        {
          project_id: project.id,
          url: fetched.url,
          title: 'Gesperrt',
          retrieval_method: 'fetch_source',
          reason: 'Beleg aus der selbst abgerufenen PDF mit Offsets geschnitten.',
          extraction: 'Verifizierbare Provenienz bleibt die Grundlage der Research.',
          contribution: 'Stützt die Kernthese.',
          document_id: fetched.document_id,
          quote_start: fetched.window.offset,
          quote_end: fetched.window.offset + Math.min(80, fetched.window.length),
        },
        ACTOR
      )
    ).rejects.toBeInstanceOf(ServiceError)
  })
})
