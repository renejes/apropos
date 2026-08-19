import { createServer, type Server } from 'node:http'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { openDb, type DB } from '../db'
import { Repo } from '../repo'
import { fetchDocument, recordSource } from './research'
import { buildMinimalPdf } from '../enforce/minimal-pdf'

const QUOTE = 'Verifiable provenance is the foundation of trustworthy AI research.'

describe('fetch_source + add_source auf PDF (Offset unfälschbar)', () => {
  let db: DB
  let repo: Repo
  let server: Server
  let pdfUrl: string
  const ACTOR = 'test:pdf'

  beforeAll(async () => {
    process.env.RESEARCH_ALLOW_PRIVATE_FETCH = '1'
    const pdf = buildMinimalPdf(QUOTE)
    server = createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/pdf' })
      res.end(pdf)
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const port = (server.address() as { port: number }).port
    pdfUrl = `http://127.0.0.1:${port}/paper.pdf`
  })

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())))
  })

  beforeEach(() => {
    db = openDb(':memory:')
    repo = new Repo(db)
  })

  it('speichert extrahierten Text und schneidet das Zitat serverseitig', async () => {
    const project = repo.createProject({
      title: 'PDF',
      research_question: 'Trägt das Offset-Zitat?',
      mode: 'academic',
      policy_preset: null,
      actor: ACTOR,
    })
    const doc = await fetchDocument(repo, { project_id: project.id, url: pdfUrl, purpose: 'arXiv-typischen Fließtext belegen' }, ACTOR)
    expect(doc.document_id).toBeTruthy()
    const start = doc.window.text.indexOf(QUOTE)
    expect(start).toBeGreaterThanOrEqual(0)
    const absStart = doc.window.offset + start
    const absEnd = absStart + QUOTE.length

    const added = await recordSource(
      repo,
      {
        project_id: project.id,
        url: pdfUrl,
        title: 'Fixture PDF',
        retrieval_method: 'fetch_source',
        reason: 'Beleg per Offset aus dem selbst abgerufenen PDF geschnitten.',
        extraction: 'Verifizierbare Provenienz ist die Grundlage vertrauenswürdiger KI-Research.',
        contribution: 'Stützt die Kernthese.',
        document_id: doc.document_id,
        quote_start: absStart,
        quote_end: absEnd,
      },
      ACTOR
    )
    expect(added.checks.quote_verified).toBe(true)
    expect(added.checks.note).toMatch(/^offset_exact/)
    expect(added.source.verbatim_quote).toBe(QUOTE)
  })
})
