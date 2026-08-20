import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb, type DB } from '../db'
import { Repo } from '../repo'
import { linkClaim, planResearch } from '../services/research'
import { adoptMinimalBrief } from '../services/brief'
import { prepareView, toggleMark } from '../services/visual'
import { graphToSvg } from '../export/graph-svg'
import { writeWritingPack } from '../export/writing-pack'

const ACTOR = 'test:pack'

describe('Schreibpaket (Phase G)', () => {
  let db: DB
  let repo: Repo
  let out: string

  afterEach(() => {
    db?.close()
    if (out) rmSync(out, { recursive: true, force: true })
  })

  function seed() {
    db = openDb(':memory:')
    repo = new Repo(db)
    out = mkdtempSync(join(tmpdir(), 'rop-pack-'))
    const project = repo.createProject({
      title: 'Paket',
      research_question: 'Was darf in den Text?',
      mode: 'academic',
      policy_preset: null,
      actor: ACTOR,
    })
    adoptMinimalBrief(repo, project.id, ACTOR)
    const planned = planResearch(
      repo,
      { project_id: project.id, sub_questions: [{ question: 'Welche Belege stützen These A zum Sachverhalt?', min_sources: 1 }] },
      ACTOR
    )
    const src = repo.addSource({
      project_id: project.id,
      url: 'https://example.org/a',
      title: 'Beispielquelle',
      retrieval_method: 'test',
      accessed_at: '2026-08-20T12:00:00.000Z',
      reason: 'Weil sie das Kernargument der Studie dokumentiert.',
      extraction: 'Die Studie zeigt X unter Bedingung Y mit Effektstärke Z.',
      contribution: 'Stützt These 2 des Berichts.',
      verbatim_quote: 'Ein wörtliches Zitat mit ausreichender Länge.',
      sub_question_id: planned.sub_questions[0]!.id,
      citekey: 'muster2020beispiel',
      entry_type: 'misc',
      quote_locator: 'S. 12',
      actor: ACTOR,
    })
    const linked = linkClaim(
      repo,
      {
        project_id: project.id,
        claim_text: 'Zentrale Aussage des Berichts über den Sachverhalt.',
        source_id: src.id,
        quote_span: 'Ein wörtliches Zitat mit ausreichender Länge.',
        support_type: 'supports',
      },
      ACTOR
    )
    return { project, src, claimId: linked.claim_id }
  }

  it('graphToSvg nutzt dieselben Koordinaten und escaped Labels', () => {
    const svg = graphToSvg({
      layout_kind: 'argument_map',
      width: 400,
      height: 200,
      interpretative: false,
      clusters: [],
      nodes: [
        { id: 'n1', kind: 'source', entity_id: 's1', label: 'A <B> & C', cluster_key: null, pos_x: 10, pos_y: 20 },
      ],
      edges: [],
    })
    expect(svg).toContain('x="10"')
    expect(svg).toContain('y="20"')
    expect(svg).toContain('A &lt;B&gt; &amp; C')
    expect(svg).not.toContain('A <B>')
  })

  it('packt nur die Sicht, nicht den Rohdump, und schreibt SVG', () => {
    const { project, src, claimId } = seed()
    const made = prepareView(
      repo,
      { project_id: project.id, question: 'Welche Belege gehören zu These A im Korpus?', layout_kind: 'argument_map' },
      ACTOR
    )
    const pack = writeWritingPack(
      repo,
      { project_id: project.id, visual_version_id: made.version.id, out_dir: join(out, 'view') },
      ACTOR
    )
    expect(pack.files).toEqual(
      expect.arrayContaining(['RESEARCH-PLAN.md', 'references.bib', 'claims.md', 'bericht.md', 'do-not-claim.md'])
    )
    expect(pack.files.some((f) => f.startsWith('karte-') && f.endsWith('.svg'))).toBe(true)
    expect(pack.files.some((f) => f.startsWith('karte-') && f.endsWith('.jpg'))).toBe(true)
    const jpg = readFileSync(join(pack.dir, pack.files.find((f) => f.endsWith('.jpg'))!))
    expect(jpg.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))).toBe(true)
    expect(jpg.length).toBeGreaterThan(800)
    expect(pack.source_ids).toContain(src.id)
    expect(pack.claim_ids).toContain(claimId)
    const plan = readFileSync(join(pack.dir, 'RESEARCH-PLAN.md'), 'utf-8')
    expect(plan).toMatch(/Stopp-Regel/)
    const bib = readFileSync(join(pack.dir, 'references.bib'), 'utf-8')
    expect(bib).toMatch(/example\.org\/a/)
    const svg = readFileSync(join(pack.dir, pack.files.find((f) => f.endsWith('.svg'))!), 'utf-8')
    expect(svg).toContain('<svg')
    expect(svg).toContain('Beispielquelle')
    const claims = readFileSync(join(pack.dir, 'claims.md'), 'utf-8')
    expect(claims).toMatch(/\[@muster2020beispiel, p\. 12\]/)
    expect(claims).not.toMatch(/p\. 1[^\d]/)
  })

  it('lehnt ein Paket ohne Scope ab', () => {
    const { project } = seed()
    expect(() => writeWritingPack(repo, { project_id: project.id, out_dir: join(out, 'x') }, ACTOR)).toThrow(/visual_version_id|scope/)
  })

  it('packt das Mark-Set, wenn scope=marked', () => {
    const { project, src } = seed()
    toggleMark(repo, { project_id: project.id, entity_type: 'source', entity_id: src.id }, ACTOR)
    const pack = writeWritingPack(repo, { project_id: project.id, scope: 'marked', out_dir: join(out, 'marks') }, ACTOR)
    expect(pack.scope).toBe('marked')
    expect(pack.source_ids).toEqual([src.id])
    expect(pack.files).toContain('do-not-claim.md')
    expect(pack.files.some((f) => f.endsWith('.jpg'))).toBe(true)
  })
})
