import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { z } from 'zod'
import type { Repo } from '../repo'
import type { ProjectState, Source } from '../../../shared/types'
import { ServiceError } from '../services/research'
import { graphToJpeg } from './graph-jpeg'
import { graphToSvg } from './graph-svg'
import { renderSearchDocumentation } from './markdown'
import { mergeBibliography, rewriteCitekeys } from './bib-merge'
import {
  parseEwManifest,
  serializeEwManifest,
  slugifyFolder,
  type EwLang,
  type EwManifest,
  type EwProjectType,
} from './easy-writing-manifest'
import { renderBericht, renderClaimsMd, renderDoNotClaim, resolveWritingScope } from './pack-content'

export const RESEARCH_MDX = 'research.mdx'
const BIB_NAME = 'references.bib'
const KARTE_SVG = 'assets/research-karte.svg'
const KARTE_JPG = 'assets/research-karte.jpg'

export const easyWritingSchema = z
  .object({
    project_id: z.string().min(1),
    visual_version_id: z.string().min(1).optional(),
    scope: z.enum(['marked']).optional(),
    jpeg_base64: z.string().optional(),
    /** 'new' legt einen Unterordner in out_dir an; 'existing' schreibt in out_dir selbst. */
    target: z.enum(['new', 'existing']),
    out_dir: z.string().min(1),
    project_type: z.enum(['blog', 'paper']).optional(),
    lang: z.enum(['de', 'en', 'en-US', 'en-GB']).optional(),
  })
  .superRefine((v, ctx) => {
    if (!v.visual_version_id && v.scope !== 'marked') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Easy-Writing-Export braucht visual_version_id oder scope=marked — kein Rohdump des ganzen Projekts.',
      })
    }
    if (v.target === 'new' && !v.project_type) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Neuer Ordner braucht project_type blog oder paper.',
      })
    }
  })

export interface EasyWritingResult {
  dir: string
  files: string[]
  source_ids: string[]
  claim_ids: string[]
  scope: string
  remapped_citekeys: Array<{ from: string; to: string }>
  target: 'new' | 'existing'
}

function parseOrThrow<T extends z.ZodTypeAny>(schema: T, input: unknown, code: string): z.infer<T> {
  const parsed = schema.safeParse(input)
  if (!parsed.success) {
    const detail = parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ')
    throw new ServiceError(code, `Eingabe ungültig — ${detail}`, 'Korrigiere GENAU die oben genannten Felder und rufe dasselbe Werkzeug erneut auf.')
  }
  return parsed.data
}

function todayIso(at = new Date()): string {
  return at.toISOString().slice(0, 10)
}

function yamlEscapeTitle(title: string): string {
  return JSON.stringify(title)
}

function attr(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
}

function uniqueProjectRoot(parentDir: string, title: string): string {
  const base = slugifyFolder(title)
  let slug = base
  let n = 2
  let root = join(parentDir, slug)
  while (existsSync(root)) {
    slug = `${base}-${n}`
    n += 1
    root = join(parentDir, slug)
  }
  return root
}

function paperChapters(lang: EwLang): Array<{ file: string; heading: string }> {
  if (lang === 'de') {
    return [
      { file: '01-abstract.mdx', heading: 'Abstract' },
      { file: '02-einleitung.mdx', heading: 'Einleitung' },
      { file: '03-methode.mdx', heading: 'Methode' },
      { file: '04-ergebnisse.mdx', heading: 'Ergebnisse' },
      { file: '05-diskussion.mdx', heading: 'Diskussion' },
    ]
  }
  return [
    { file: '01-abstract.mdx', heading: 'Abstract' },
    { file: '02-introduction.mdx', heading: 'Introduction' },
    { file: '03-method.mdx', heading: 'Method' },
    { file: '04-results.mdx', heading: 'Results' },
    { file: '05-discussion.mdx', heading: 'Discussion' },
  ]
}

function emptyBlogIndex(title: string, lang: EwLang): string {
  return `---
title: ${yamlEscapeTitle(title)}
date: ${todayIso()}
lang: ${lang}
---

`
}

function ensureCitation(manifest: EwManifest): EwManifest {
  if (manifest.citation) return manifest
  return {
    ...manifest,
    citation: { bibliography: BIB_NAME, csl: 'apa' },
  }
}

function ensureResearchChapter(manifest: EwManifest): EwManifest {
  if (manifest.chapters.includes(RESEARCH_MDX)) return manifest
  return { ...manifest, chapters: [...manifest.chapters, RESEARCH_MDX] }
}

function writeUtf8(path: string, body: string): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, body, 'utf-8')
}

function scaffoldNew(
  parentDir: string,
  title: string,
  type: EwProjectType,
  lang: EwLang
): { root: string; manifest: EwManifest; files: string[] } {
  const root = uniqueProjectRoot(parentDir, title)
  mkdirSync(join(root, 'assets'), { recursive: true })
  const files: string[] = []
  const manifest: EwManifest = {
    schema: 1,
    type,
    title: title.trim(),
    lang,
    chapters: [RESEARCH_MDX],
    citation: { bibliography: BIB_NAME, csl: 'apa' },
  }

  switch (type) {
    case 'blog': {
      const indexPath = 'index.mdx'
      writeUtf8(join(root, indexPath), emptyBlogIndex(title, lang))
      files.push(indexPath)
      manifest.chapters = [RESEARCH_MDX, indexPath]
      break
    }
    case 'paper': {
      mkdirSync(join(root, 'chapters'), { recursive: true })
      const chapters = paperChapters(lang)
      for (const chapter of chapters) {
        const rel = `chapters/${chapter.file}`
        writeUtf8(join(root, rel), `# ${chapter.heading}\n\n`)
        files.push(rel)
      }
      manifest.chapters = [RESEARCH_MDX, ...chapters.map((c) => `chapters/${c.file}`)]
      break
    }
    default: {
      const _never: never = type
      return _never
    }
  }

  try {
    writeUtf8(join(root, '.gitignore'), 'easy-writing.lock.json\n.easy-writing/\n')
    files.push('.gitignore')
  } catch {
    /* versteckte Dateien können am Host scheitern */
  }

  return { root, manifest, files }
}

function loadExisting(root: string): { manifest: EwManifest; files: string[] } {
  const yamlPath = join(root, 'project.yaml')
  if (!existsSync(yamlPath)) {
    throw new ServiceError(
      'ew_not_a_project',
      'Der Ordner ist kein Easy-Writing-Projekt (project.yaml fehlt).',
      'Wähle den Ordner, den Easy Writing öffnet, oder exportiere in einen neuen Ordner.'
    )
  }
  const manifest = ensureResearchChapter(ensureCitation(parseEwManifest(readFileSync(yamlPath, 'utf-8'))))
  return { manifest, files: [] }
}

function renderResearchMdx(input: {
  state: ProjectState
  sources: Source[]
  claimIds: string[]
  claims: ProjectState['claims']
  visualVersionId: string | null
  lang: EwLang
  hasKarte: boolean
}): string {
  const title = `Research · ${input.state.project.title}`
  const brief = input.state.researchBrief?.markdown ?? '_Kein adoptierter Brief._'
  const lage = renderSearchDocumentation(input.state)
  const lines: string[] = [
    '---',
    `title: ${yamlEscapeTitle(title)}`,
    `date: ${todayIso()}`,
    `lang: ${input.lang}`,
    '---',
    '',
    'Dieses Kapitel ist das **Research-Dossier**, kein Artikel. Beim Export in Easy Writing dieses Kapitel abwählen.',
    '',
    '## Forschungsfrage',
    '',
    input.state.project.research_question || '_(keine hinterlegt)_',
    '',
  ]
  if (lage) {
    lines.push(lage.trimEnd(), '')
  }
  lines.push(renderClaimsMd(input.state, input.claimIds, input.sources).trimEnd(), '')
  lines.push('## Bericht dieser Sicht', '')
  const bericht = renderBericht(input.state, input.claims, input.sources, input.visualVersionId).trim()
  const berichtBody = bericht.replace(/^# Bericht dieser Sicht\s*/, '').trim()
  lines.push(berichtBody.length > 0 ? berichtBody : '_Kein Bericht an diese Sicht gebunden._', '')
  lines.push(renderDoNotClaim(input.state, input.sources).trimEnd(), '')
  if (input.hasKarte) {
    lines.push(
      '## Karte',
      '',
      `<Figure src="${KARTE_JPG}" alt="${attr('Evidenzkarte dieser Sicht')}" caption="${attr('Karte dieser Sicht — nicht der Artikel.')}" />`,
      '',
      `_Vektor: \`${KARTE_SVG}\`_`,
      ''
    )
  }
  lines.push('## Research-Plan', '', brief.trim(), '')
  return lines.join('\n')
}

export function rememberedEasyWritingDir(dir: string | null | undefined): string | null {
  if (!dir) return null
  return existsSync(join(dir, 'project.yaml')) ? dir : null
}

export function writeEasyWriting(repo: Repo, rawInput: unknown, actor: string): EasyWritingResult {
  const input = parseOrThrow(easyWritingSchema, rawInput, 'ew_invalid')
  const packed = resolveWritingScope(repo, input)
  const lang: EwLang = input.lang ?? 'de'
  const files: string[] = []

  let root: string
  let manifest: EwManifest
  let target: 'new' | 'existing' = input.target

  if (input.target === 'new') {
    const made = scaffoldNew(input.out_dir, packed.state.project.title, input.project_type!, lang)
    root = made.root
    manifest = made.manifest
    files.push(...made.files)
  } else {
    root = input.out_dir
    const loaded = loadExisting(root)
    manifest = loaded.manifest
    files.push(...loaded.files)
  }

  mkdirSync(join(root, 'assets'), { recursive: true })

  const bibRel = manifest.citation?.bibliography ?? BIB_NAME
  const bibPath = join(root, bibRel)
  const existingBib = existsSync(bibPath) ? readFileSync(bibPath, 'utf-8') : ''
  const merged = mergeBibliography(existingBib, packed.sources)
  writeUtf8(bibPath, merged.bib)
  files.push(bibRel)

  let karte = false
  if (packed.graph) {
    writeFileSync(join(root, KARTE_SVG), graphToSvg(packed.graph))
    const jpeg = input.jpeg_base64 ? Buffer.from(input.jpeg_base64, 'base64') : graphToJpeg(packed.graph)
    writeFileSync(join(root, KARTE_JPG), jpeg)
    files.push(KARTE_SVG, KARTE_JPG)
    karte = true
  }

  const mdx = rewriteCitekeys(
    renderResearchMdx({
      state: packed.state,
      sources: merged.sources,
      claimIds: packed.claimIds,
      claims: packed.claims,
      visualVersionId: packed.visualVersionId,
      lang,
      hasKarte: karte,
    }),
    merged.remapped
  )
  writeUtf8(join(root, RESEARCH_MDX), mdx.endsWith('\n') ? mdx : `${mdx}\n`)
  files.push(RESEARCH_MDX)

  writeUtf8(join(root, 'project.yaml'), serializeEwManifest(manifest))
  files.push('project.yaml')

  repo.setEasyWritingDir(input.project_id, root, actor)
  repo.logEvent(input.project_id, actor, 'export.easy_writing', {
    dir: root,
    scope: packed.scopeLabel,
    target,
    files,
    remapped: merged.remapped,
  })

  return {
    dir: root,
    files,
    source_ids: packed.sourceIds,
    claim_ids: packed.claimIds,
    scope: packed.scopeLabel,
    remapped_citekeys: merged.remapped,
    target,
  }
}
