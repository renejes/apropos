import { createServer, type Server } from 'node:http'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { openDb, SCHEMA_VERSION, type DB } from '../db'
import { Repo } from '../repo'
import {
  fetchDocument,
  fulfillCaptureFromInbox,
  recordExclusion,
  recordSource,
} from './research'
import { adoptMinimalBrief } from './brief'
import { projectWorkspace } from '../agent/workspace'
import { buildMinimalPdf } from '../enforce/minimal-pdf'
import { isCapturePending } from '../../../shared/types'

const QUOTE = 'Verifiable provenance is the foundation of trustworthy AI research.'
const ACTOR = 'test:capture'

describe('Paywall-Capture und PDF-Bindung', () => {
  let db: DB
  let repo: Repo
  let blocked: Server
  let missing: Server
  let blockedUrl: string
  let missingUrl: string
  let root: string
  const prevRoot = process.env.ROP_AGENT_ROOT
  const prevPrivate = process.env.RESEARCH_ALLOW_PRIVATE_FETCH

  beforeAll(async () => {
    process.env.RESEARCH_ALLOW_PRIVATE_FETCH = '1'
    blocked = createServer((_req, res) => {
      res.writeHead(403, { 'content-type': 'text/plain' })
      res.end('forbidden')
    })
    missing = createServer((_req, res) => {
      res.writeHead(404, { 'content-type': 'text/plain' })
      res.end('gone')
    })
    await new Promise<void>((resolve) => blocked.listen(0, '127.0.0.1', resolve))
    await new Promise<void>((resolve) => missing.listen(0, '127.0.0.1', resolve))
    blockedUrl = `http://127.0.0.1:${(blocked.address() as { port: number }).port}/locked`
    missingUrl = `http://127.0.0.1:${(missing.address() as { port: number }).port}/missing`
  })

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => blocked.close((err) => (err ? reject(err) : resolve())))
    await new Promise<void>((resolve, reject) => missing.close((err) => (err ? reject(err) : resolve())))
  })

  afterEach(() => {
    if (prevRoot === undefined) delete process.env.ROP_AGENT_ROOT
    else process.env.ROP_AGENT_ROOT = prevRoot
    if (prevPrivate === undefined) delete process.env.RESEARCH_ALLOW_PRIVATE_FETCH
    else process.env.RESEARCH_ALLOW_PRIVATE_FETCH = prevPrivate
    if (root) rmSync(root, { recursive: true, force: true })
  })

  const setup = () => {
    db = openDb(':memory:')
    repo = new Repo(db)
    root = mkdtempSync(join(tmpdir(), 'rop-capture-'))
    process.env.ROP_AGENT_ROOT = root
    process.env.RESEARCH_ALLOW_PRIVATE_FETCH = '1'
    expect(db.pragma('user_version', { simple: true })).toBe(SCHEMA_VERSION)
    const project = repo.createProject({
      title: 'Capture',
      research_question: 'Kommt der Volltext an?',
      mode: 'academic',
      policy_preset: null,
      actor: ACTOR,
    })
    adoptMinimalBrief(repo, project.id, ACTOR)
    return project
  }

  it('legt bei HTTP 403 einen Capture-Stub an statt fetch_failed', async () => {
    const project = setup()
    const res = await fetchDocument(
      repo,
      { project_id: project.id, url: blockedUrl, purpose: 'Paywall-Volltext für die Teilfrage holen' },
      ACTOR
    )
    expect(res.needs_capture).toBe(true)
    expect(res.window.text).toBe('')
    expect(repo.listOpenDocuments(project.id)).toHaveLength(1)
    const doc = repo.getDocument(res.document_id)!
    expect(isCapturePending(doc)).toBe(true)
    expect(doc.url).toBe(blockedUrl)
    expect(doc.char_len).toBe(0)
  })

  it('holt dieselbe Paywall-URL nicht erneut aus dem Netz', async () => {
    const project = setup()
    const first = await fetchDocument(
      repo,
      { project_id: project.id, url: blockedUrl, purpose: 'Paywall-Volltext für die Teilfrage holen' },
      ACTOR
    )
    const second = await fetchDocument(
      repo,
      { project_id: project.id, url: blockedUrl, purpose: 'Noch einmal dieselbe Verlagsseite lesen wollen' },
      ACTOR
    )
    expect(second.document_id).toBe(first.document_id)
    expect(second.needs_capture).toBe(true)
    expect(repo.listOpenDocuments(project.id)).toHaveLength(1)
  })

  it('wirft bei 404 weiter fetch_failed ohne Dokument', async () => {
    const project = setup()
    await expect(
      fetchDocument(repo, { project_id: project.id, url: missingUrl, purpose: 'Eine tote Seite trotzdem lesen wollen' }, ACTOR)
    ).rejects.toMatchObject({ code: 'fetch_failed' })
    expect(repo.listDocuments(project.id)).toHaveLength(0)
  })

  it('lehnt add_source auf dem Stub ab, bis der Volltext liegt', async () => {
    const project = setup()
    const res = await fetchDocument(
      repo,
      { project_id: project.id, url: blockedUrl, purpose: 'Paywall-Volltext für die Teilfrage holen' },
      ACTOR
    )
    await expect(
      recordSource(
        repo,
        {
          project_id: project.id,
          url: blockedUrl,
          title: 'Gesperrte Quelle',
          retrieval_method: 'fetch_source',
          reason: 'Versuch, ohne Volltext zu zitieren, der abgewiesen werden muss.',
          extraction: 'Es steht noch kein Text im Dokument, also darf hier nichts landen.',
          contribution: 'Negativtest.',
          document_id: res.document_id,
          quote_start: 0,
          quote_end: 40,
        },
        ACTOR
      )
    ).rejects.toMatchObject({ code: 'document_needs_capture' })
  })

  it('bindet die PDF an denselben Stub: URL bleibt, Text kommt, Gate-Slot gleich', async () => {
    const project = setup()
    const res = await fetchDocument(
      repo,
      { project_id: project.id, url: blockedUrl, purpose: 'Paywall-Volltext für die Teilfrage holen' },
      ACTOR
    )
    const ws = projectWorkspace(project.id, root)
    writeFileSync(join(ws, 'inbox', 'campus.pdf'), buildMinimalPdf(QUOTE))

    const bound = await fulfillCaptureFromInbox(repo, project.id, res.document_id, ['campus.pdf'], ACTOR)
    expect(bound.errors).toEqual([])
    expect(bound.documents).toHaveLength(1)
    expect(bound.documents[0]!.url).toBe(blockedUrl)
    expect(bound.documents[0]!.document_id).toBe(res.document_id)

    const doc = repo.getDocument(res.document_id)!
    expect(doc.url).toBe(blockedUrl)
    expect(isCapturePending(doc)).toBe(false)
    expect(doc.status).toBe('open')
    expect(doc.text).toContain('provenance')
    expect(repo.listOpenDocuments(project.id)).toHaveLength(1)
    expect(repo.listDocuments(project.id)).toHaveLength(1)
  })

  it('schließt den Capture nach Offset-Beleg', async () => {
    const project = setup()
    const res = await fetchDocument(
      repo,
      { project_id: project.id, url: blockedUrl, purpose: 'Paywall-Volltext für die Teilfrage holen' },
      ACTOR
    )
    const ws = projectWorkspace(project.id, root)
    writeFileSync(join(ws, 'inbox', 'campus.pdf'), buildMinimalPdf(QUOTE))
    await fulfillCaptureFromInbox(repo, project.id, res.document_id, ['campus.pdf'], ACTOR)
    const doc = repo.getDocument(res.document_id)!
    const start = doc.text.indexOf(QUOTE)
    expect(start).toBeGreaterThanOrEqual(0)

    const added = await recordSource(
      repo,
      {
        project_id: project.id,
        url: blockedUrl,
        title: 'Campus-PDF',
        retrieval_method: 'human_reader',
        reason: 'Beleg aus der nachgelegten Campus-PDF mit Offsets geschnitten.',
        extraction: 'Verifizierbare Provenienz bleibt die Grundlage der Research.',
        contribution: 'Stützt die Kernthese.',
        document_id: doc.id,
        quote_start: start,
        quote_end: start + QUOTE.length,
      },
      ACTOR
    )
    expect(added.checks.quote_verified).toBe(true)
    expect(repo.getDocument(doc.id)?.status).toBe('used')
    expect(repo.listOpenDocuments(project.id)).toHaveLength(0)
  })

  it('schließt den Capture per exclude_source', async () => {
    const project = setup()
    await fetchDocument(
      repo,
      { project_id: project.id, url: blockedUrl, purpose: 'Paywall-Volltext für die Teilfrage holen' },
      ACTOR
    )
    recordExclusion(
      repo,
      { project_id: project.id, url: blockedUrl, title: 'Gesperrt', reason: 'Kein Campus-Zugang, Quelle entfällt.' },
      ACTOR
    )
    expect(repo.listOpenDocuments(project.id)).toHaveLength(0)
    expect(repo.listDocuments(project.id)[0]?.status).toBe('excluded')
  })
})

describe('Unpaywall-Retry nach Paywall', () => {
  let db: DB
  let repo: Repo
  let blocked: Server
  let oa: Server
  let paywallUrl: string
  let oaUrl: string
  const prevPrivate = process.env.RESEARCH_ALLOW_PRIVATE_FETCH

  beforeAll(async () => {
    process.env.RESEARCH_ALLOW_PRIVATE_FETCH = '1'
    blocked = createServer((_req, res) => {
      res.writeHead(403, { 'content-type': 'text/plain' })
      res.end('forbidden')
    })
    oa = createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      res.end(`<p>${QUOTE}</p>`)
    })
    await new Promise<void>((resolve) => blocked.listen(0, '127.0.0.1', resolve))
    await new Promise<void>((resolve) => oa.listen(0, '127.0.0.1', resolve))
    const blockedPort = (blocked.address() as { port: number }).port
    const oaPort = (oa.address() as { port: number }).port
    paywallUrl = `http://127.0.0.1:${blockedPort}/10.5555/unpaywall-retry`
    oaUrl = `http://127.0.0.1:${oaPort}/paper`
  })

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => blocked.close((err) => (err ? reject(err) : resolve())))
    await new Promise<void>((resolve, reject) => oa.close((err) => (err ? reject(err) : resolve())))
    if (prevPrivate === undefined) delete process.env.RESEARCH_ALLOW_PRIVATE_FETCH
    else process.env.RESEARCH_ALLOW_PRIVATE_FETCH = prevPrivate
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    db.close()
  })

  const setup = () => {
    db = openDb(':memory:')
    repo = new Repo(db)
    process.env.RESEARCH_ALLOW_PRIVATE_FETCH = '1'
    const project = repo.createProject({
      title: 'Unpaywall',
      research_question: 'Gibt es eine legale OA-Fassung?',
      mode: 'academic',
      policy_preset: null,
      actor: ACTOR,
    })
    adoptMinimalBrief(repo, project.id, ACTOR)
    return project
  }

  const stubUnpaywall = (body: unknown) => {
    const originalFetch = globalThis.fetch
    vi.stubGlobal('fetch', async (input: string | URL, init?: RequestInit) => {
      const u = String(input)
      if (u.includes('api.unpaywall.org')) {
        return {
          ok: true,
          status: 200,
          json: async () => body,
        } as Response
      }
      return originalFetch(input, init)
    })
  }

  it('legt den OA-Volltext ab statt eines Capture-Stubs', async () => {
    const project = setup()
    stubUnpaywall({
      is_oa: true,
      best_oa_location: {
        url_for_pdf: oaUrl,
        version: 'publishedVersion',
        host_type: 'repository',
      },
    })
    const res = await fetchDocument(
      repo,
      { project_id: project.id, url: paywallUrl, purpose: 'Verlagsseite ist gesperrt, OA versuchen.' },
      ACTOR
    )
    expect(res.needs_capture).toBeFalsy()
    expect(res.url).toBe(oaUrl)
    expect(res.window.text).toContain('provenance')
    expect(res.hint).toMatch(/Unpaywall/)
    expect(isCapturePending(repo.getDocument(res.document_id)!)).toBe(false)
  })

  it('fällt auf Capture zurück, wenn Unpaywall kein OA kennt', async () => {
    const project = setup()
    stubUnpaywall({ is_oa: false, best_oa_location: null })
    const res = await fetchDocument(
      repo,
      { project_id: project.id, url: paywallUrl, purpose: 'Verlagsseite ist gesperrt, OA versuchen.' },
      ACTOR
    )
    expect(res.needs_capture).toBe(true)
    expect(res.url).toBe(paywallUrl)
    expect(res.window.text).toBe('')
  })
})
