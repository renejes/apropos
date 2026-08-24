import { ServiceError } from '../services/research'

export type EwProjectType = 'blog' | 'paper'
export type EwLang = 'de' | 'en' | 'en-US' | 'en-GB'

export interface EwManifest {
  schema: 1
  type: EwProjectType
  title: string
  lang: EwLang
  chapters: string[]
  citation?: { bibliography: string; csl: string }
}

const LANGS = new Set<EwLang>(['de', 'en', 'en-US', 'en-GB'])

function isProjectType(value: string): value is EwProjectType {
  return value === 'blog' || value === 'paper'
}

function isLang(value: string): value is EwLang {
  return LANGS.has(value as EwLang)
}

function yamlQuote(value: string): string {
  if (/^[A-Za-z0-9_./-]+$/.test(value) && !/^(true|false|null|yes|no|on|off)$/i.test(value)) {
    return value
  }
  return JSON.stringify(value)
}

function unquote(raw: string): string {
  const t = raw.trim()
  if (t.length >= 2 && ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'")))) {
    try {
      return JSON.parse(t.startsWith("'") ? `"${t.slice(1, -1).replace(/"/g, '\\"')}"` : t) as string
    } catch {
      return t.slice(1, -1)
    }
  }
  return t
}

export function serializeEwManifest(manifest: EwManifest): string {
  const lines = [
    'schema: 1',
    `type: ${manifest.type}`,
    `title: ${yamlQuote(manifest.title)}`,
    `lang: ${manifest.lang}`,
    'chapters:',
    ...manifest.chapters.map((chapter) => `  - ${yamlQuote(chapter)}`),
  ]
  if (manifest.citation) {
    lines.push('citation:')
    lines.push(`  bibliography: ${yamlQuote(manifest.citation.bibliography)}`)
    lines.push(`  csl: ${yamlQuote(manifest.citation.csl)}`)
  }
  return lines.join('\n') + '\n'
}

export function parseEwManifest(raw: string): EwManifest {
  const lines = raw.replace(/\r\n/g, '\n').split('\n')
  let type: EwProjectType | null = null
  let title: string | null = null
  let lang: EwLang = 'de'
  const chapters: string[] = []
  let bibliography: string | null = null
  let csl = 'apa'
  let inChapters = false
  let inCitation = false

  for (const line of lines) {
    if (/^\s*#/.test(line) || line.trim() === '') {
      continue
    }
    const chapterItem = line.match(/^\s+-\s+(.+)$/)
    if (inChapters && chapterItem) {
      chapters.push(unquote(chapterItem[1]))
      continue
    }
    if (/^\S/.test(line)) {
      inChapters = false
      inCitation = false
    }
    const kv = line.match(/^(\s*)([A-Za-z_]+):\s*(.*)$/)
    if (!kv) continue
    const indent = kv[1].length
    const key = kv[2]
    const value = kv[3].trim()
    if (indent === 0) {
      switch (key) {
        case 'type':
          if (!isProjectType(value)) {
            throw invalidManifest()
          }
          type = value
          break
        case 'title':
          title = unquote(value)
          break
        case 'lang': {
          const parsedLang = unquote(value)
          lang = isLang(parsedLang) ? parsedLang : 'de'
          break
        }
        case 'chapters':
          inChapters = true
          break
        case 'citation':
          inCitation = true
          break
        default:
          break
      }
      continue
    }
    if (inCitation && indent > 0) {
      if (key === 'bibliography' && value) bibliography = unquote(value)
      if (key === 'csl' && value) csl = unquote(value)
    }
  }

  if (!type || !title || title.trim().length === 0 || chapters.length === 0) {
    throw invalidManifest()
  }
  const manifest: EwManifest = {
    schema: 1,
    type,
    title: title.trim(),
    lang,
    chapters,
  }
  if (bibliography) {
    manifest.citation = { bibliography, csl }
  }
  return manifest
}

function invalidManifest(): ServiceError {
  return new ServiceError(
    'ew_invalid_manifest',
    'Der Ordner hat keine gültige Easy-Writing-project.yaml (type, title, chapters).',
    'Wähle einen Easy-Writing-Ordner oder exportiere in einen neuen Ordner.'
  )
}

export function slugifyFolder(input: string): string {
  const umlauts: Record<string, string> = { ä: 'ae', ö: 'oe', ü: 'ue', ß: 'ss' }
  const replaced = input
    .trim()
    .toLowerCase()
    .replace(/[äöüß]/g, (char) => umlauts[char] ?? char)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return replaced.length > 0 ? replaced : 'projekt'
}
