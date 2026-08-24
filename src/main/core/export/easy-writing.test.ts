import { afterEach, describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb, type DB } from '../db'
import { Repo } from '../repo'
import { linkClaim, planResearch } from '../services/research'
import { adoptMinimalBrief } from '../services/brief'
import { prepareView } from '../services/visual'
import { parseEwManifest, serializeEwManifest } from '../export/easy-writing-manifest'
import { mergeBibliography, parseBibEntries, rewriteCitekeys } from '../export/bib-merge'
import { writeEasyWriting } from '../export/easy-writing'
import type { Source } from '../../../shared/types'

const ACTOR = 'test:ew'

describe('Easy-Writing-Manifest', () => {
  it('rundet YAML wie Easy Writing (type, title, chapters, citation)', () => {
    const raw = serializeEwManifest({
      schema: 1,
      type: 'paper',
      title: 'Schlaf und Aufmerksamkeit',
      lang: 'de',
      chapters: ['research.mdx', 'chapters/01-abstract.mdx'],
      citation: { bibliography: 'references.bib', csl: 'apa' },
    })
    expect(raw).toMatch(/^schema: 1$/m)
    expect(raw).toMatch(/^type: paper$/m)
    const parsed = parseEwManifest(raw)
    expect(parsed.type).toBe('paper')
    expect(parsed.chapters).toEqual(['research.mdx', 'chapters/01-abstract.mdx'])
    expect(parsed.citation?.bibliography).toBe('references.bib')
  })

  it('liest ein Easy-Writing-Fixture mit Anführungszeichen', () => {
    const parsed = parseEwManifest(`schema: 1
type: blog
title: "Titel: mit Doppelpunkt"
lang: de
chapters:
  - index.mdx
citation:
  bibliography: references.bib
  csl: apa
`)
    expect(parsed.title).toBe('Titel: mit Doppelpunkt')
    expect(parsed.chapters).toEqual(['index.mdx'])
  })
})

describe('Bib-Merge', () => {
  const src = (over: Partial<Source>): Source =>
    ({
      id: 's1',
      project_id: 'p1',
      url: 'https://example.org/a',
      title: 'Beispielquelle',
      retrieval_method: 'test',
      accessed_at: '2026-08-20T12:00:00.000Z',
      reason: 'r',
      extraction: 'e',
      contribution: 'c',
      verbatim_quote: 'q',
      quote_locator: null,
      quote_verified: null,
      quote_match_score: null,
      url_resolved: 1,
      review_status: 'pending',
      confidence: null,
      sub_question_id: null,
      document_id: null,
      quote_start: null,
      quote_end: null,
      doi: null,
      authors_json: null,
      year: 2020,
      venue: null,
      entry_type: 'misc',
      citekey: 'muster2020beispiel',
      source_kind: null,
      created_at: '2026-08-20T12:00:00.000Z',
      created_by: ACTOR,
      ...over,
    }) as Source

  it('hängt neue Keys an und lässt vorhandene Einträge stehen', () => {
    const existing = `@article{lim2010sleep,
  title = {Sleep},
  year = {2010}
}
`
    const merged = mergeBibliography(existing, [src({})])
    expect(merged.bib).toMatch(/@article\{lim2010sleep,/)
    expect(merged.bib).toMatch(/@misc\{muster2020beispiel,/)
    expect(merged.remapped).toEqual([])
  })

  it('behält den bestehenden Key bei gleichem DOI und überschreibt den Eintrag nicht', () => {
    const existing = `@article{otherkey,
  title = {Alt},
  doi = {10.1234/abc},
  url = {https://old.example/x}
}
`
    const merged = mergeBibliography(existing, [src({ doi: '10.1234/abc', citekey: 'muster2020beispiel' })])
    expect(merged.bib).not.toMatch(/muster2020beispiel/)
    expect(merged.sources[0]!.citekey).toBe('otherkey')
    expect(merged.remapped).toEqual([{ from: 'muster2020beispiel', to: 'otherkey' }])
    expect(merged.bib).toMatch(/title = \{Alt\}/)
  })

  it('vergibt einen neuen Key, wenn derselbe Citekey ein anderes Werk ist', () => {
    const existing = `@book{muster2020beispiel,
  title = {Anderes Buch},
  doi = {10.9999/other}
}
`
    const merged = mergeBibliography(existing, [src({ doi: '10.1111/ours', citekey: 'muster2020beispiel' })])
    expect(merged.sources[0]!.citekey).toBe('muster2020beispiela')
    expect(merged.bib).toMatch(/@book\{muster2020beispiel,/)
    expect(merged.bib).toMatch(/@misc\{muster2020beispiela,/)
    expect(rewriteCitekeys('Siehe [@muster2020beispiel, p. 12].', merged.remapped)).toBe(
      'Siehe [@muster2020beispiela, p. 12].'
    )
  })

  it('parst Keys aus einem Bib-Block', () => {
    expect(parseBibEntries('@misc{a, title = {A}}\n\n@article{b, doi = {10.1/x}}').map((e) => e.key)).toEqual(['a', 'b'])
  })
})

describe('Easy-Writing-Export', () => {
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
    out = mkdtempSync(join(tmpdir(), 'rop-ew-'))
    const project = repo.createProject({
      title: 'Schlafstudie',
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
      doi: '10.1234/ours',
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
    const made = prepareView(
      repo,
      { project_id: project.id, question: 'Welche Belege gehören zu These A im Korpus?', layout_kind: 'argument_map' },
      ACTOR
    )
    return { project, src, claimId: linked.claim_id, versionId: made.version.id }
  }

  it('legt ein Blog-Projekt mit leerem index.mdx, research.mdx, Bib und Karte an', () => {
    const { project, src, versionId } = seed()
    const result = writeEasyWriting(
      repo,
      {
        project_id: project.id,
        visual_version_id: versionId,
        target: 'new',
        project_type: 'blog',
        out_dir: out,
      },
      ACTOR
    )
    expect(result.target).toBe('new')
    expect(result.files).toEqual(expect.arrayContaining(['index.mdx', 'research.mdx', 'references.bib', 'project.yaml']))
    expect(existsSync(join(result.dir, 'assets/research-karte.jpg'))).toBe(true)
    const index = readFileSync(join(result.dir, 'index.mdx'), 'utf-8')
    expect(index).toMatch(/^---\n/)
    expect(index).toMatch(/\n---\n\s*$/)
    expect(index).not.toMatch(/^# /m)
    const mdx = readFileSync(join(result.dir, 'research.mdx'), 'utf-8')
    expect(mdx).toMatch(/Research-Dossier/)
    expect(mdx).toMatch(/\[@muster2020beispiel/)
    expect(mdx).toMatch(/<Figure src="assets\/research-karte\.jpg"/)
    const jsx = mdx.match(/<[A-Z][a-zA-Z]+/g) ?? []
    expect(jsx.every((tag) => tag === '<Figure')).toBe(true)
    const manifest = parseEwManifest(readFileSync(join(result.dir, 'project.yaml'), 'utf-8'))
    expect(manifest.chapters[0]).toBe('research.mdx')
    expect(manifest.chapters).toContain('index.mdx')
    expect(readFileSync(join(result.dir, 'references.bib'), 'utf-8')).toMatch(/example\.org\/a/)
    expect(repo.getProject(project.id)?.easy_writing_dir).toBe(result.dir)
    expect(result.source_ids).toContain(src.id)
  })

  it('legt ein Paper mit leeren Kapiteln an und lässt research.mdx extra', () => {
    const { project, versionId } = seed()
    const result = writeEasyWriting(
      repo,
      {
        project_id: project.id,
        visual_version_id: versionId,
        target: 'new',
        project_type: 'paper',
        out_dir: out,
      },
      ACTOR
    )
    const einleitung = readFileSync(join(result.dir, 'chapters/02-einleitung.mdx'), 'utf-8')
    expect(einleitung).toBe('# Einleitung\n\n')
    const manifest = parseEwManifest(readFileSync(join(result.dir, 'project.yaml'), 'utf-8'))
    expect(manifest.type).toBe('paper')
    expect(manifest.chapters).toContain('research.mdx')
    expect(manifest.chapters).toContain('chapters/02-einleitung.mdx')
  })

  it('schreibt in einen bestehenden Ordner, ohne index.mdx zu ändern, und merget die Bib', () => {
    const { project, versionId } = seed()
    const existing = join(out, 'mein-text')
    mkdirSync(existing)
    writeFileSync(
      join(existing, 'project.yaml'),
      serializeEwManifest({
        schema: 1,
        type: 'blog',
        title: 'Schon geschrieben',
        lang: 'de',
        chapters: ['index.mdx'],
      })
    )
    writeFileSync(
      join(existing, 'index.mdx'),
      `---
title: "Schon geschrieben"
date: 2026-01-01
lang: de
---

HAND-TEXT
`
    )
    writeFileSync(
      join(existing, 'references.bib'),
      `@article{lim2010sleep,
  title = {Sleep},
  year = {2010}
}
`
    )
    const result = writeEasyWriting(
      repo,
      {
        project_id: project.id,
        visual_version_id: versionId,
        target: 'existing',
        out_dir: existing,
      },
      ACTOR
    )
    expect(result.target).toBe('existing')
    expect(readFileSync(join(existing, 'index.mdx'), 'utf-8')).toMatch(/HAND-TEXT/)
    const manifest = parseEwManifest(readFileSync(join(existing, 'project.yaml'), 'utf-8'))
    expect(manifest.chapters).toEqual(['index.mdx', 'research.mdx'])
    expect(manifest.citation?.bibliography).toBe('references.bib')
    const bib = readFileSync(join(existing, 'references.bib'), 'utf-8')
    expect(bib).toMatch(/lim2010sleep/)
    expect(bib).toMatch(/muster2020beispiel/)
    expect(existsSync(join(existing, 'research.mdx'))).toBe(true)
    expect(repo.getProject(project.id)?.easy_writing_dir).toBe(existing)
  })

  it('überschreibt research.mdx erneut, hängt das Kapitel nicht doppelt an', () => {
    const { project, versionId } = seed()
    const first = writeEasyWriting(
      repo,
      { project_id: project.id, visual_version_id: versionId, target: 'new', project_type: 'blog', out_dir: out },
      ACTOR
    )
    writeFileSync(join(first.dir, 'research.mdx'), 'ALT\n')
    writeEasyWriting(
      repo,
      { project_id: project.id, visual_version_id: versionId, target: 'existing', out_dir: first.dir },
      ACTOR
    )
    const mdx = readFileSync(join(first.dir, 'research.mdx'), 'utf-8')
    expect(mdx).not.toMatch(/^ALT/)
    expect(mdx).toMatch(/Research-Dossier/)
    const manifest = parseEwManifest(readFileSync(join(first.dir, 'project.yaml'), 'utf-8'))
    expect(manifest.chapters.filter((c) => c === 'research.mdx')).toHaveLength(1)
  })

  it('lehnt Ordner ohne project.yaml ab', () => {
    const { project, versionId } = seed()
    const empty = join(out, 'leer')
    mkdirSync(empty)
    expect(() =>
      writeEasyWriting(
        repo,
        { project_id: project.id, visual_version_id: versionId, target: 'existing', out_dir: empty },
        ACTOR
      )
    ).toThrow(/project\.yaml/)
  })

  it('lehnt Export ohne Scope ab', () => {
    const { project } = seed()
    expect(() =>
      writeEasyWriting(repo, { project_id: project.id, target: 'new', project_type: 'blog', out_dir: out }, ACTOR)
    ).toThrow(/visual_version_id|scope/)
  })
})
