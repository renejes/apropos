import type { Source } from './types'

/** Quellen, die der Bericht per [S#] oder [@citekey] nennt. */
export function citedSourcesInMarkdown(markdown: string, sources: Source[]): Source[] {
  const found = new Map<string, Source>()
  for (const match of markdown.matchAll(/\[S(\d+)\]/g)) {
    const src = sources[Number(match[1]) - 1]
    if (src) found.set(src.id, src)
  }
  const byKey = new Map(sources.flatMap((s) => (s.citekey ? [[s.citekey.toLowerCase(), s] as const] : [])))
  for (const match of markdown.matchAll(/\[@([A-Za-z0-9][A-Za-z0-9_:-]*)/g)) {
    const src = byKey.get(match[1].toLowerCase())
    if (src) found.set(src.id, src)
  }
  return [...found.values()]
}
