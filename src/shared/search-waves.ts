import type { SearchLogEntry, SearchNextAction, SearchReflection } from './types'

/**
 * Netz-/Register-Ausfall zählt nicht als Suchwelle: die nächste Suche darf
 * sofort wiederholt werden. 0 Treffer dagegen schon — das ist eine Lage.
 */
export function isFailedSearchAttempt(entry: Pick<SearchLogEntry, 'results_found' | 'note'>): boolean {
  return entry.results_found == null && (entry.note ?? '').includes('FEHLGESCHLAGEN')
}

export function nextActionLabel(action: SearchNextAction): string {
  switch (action) {
    case 'search':
      return 'weiter suchen'
    case 'read':
      return 'erst lesen'
    case 'enough':
      return 'reicht'
    default: {
      const _never: never = action
      return _never
    }
  }
}

export interface SearchWave {
  searches: SearchLogEntry[]
  reflection: SearchReflection | null
  /** Unbewertete Discovery-Suche: die nächste Suche ist gesperrt. */
  blocksSearch: boolean
}

/** Gruppiert Suchen nach der Lage, die reflect_search ihnen zugeordnet hat. */
export function groupSearchWaves(log: SearchLogEntry[], reflections: SearchReflection[]): SearchWave[] {
  const byId = new Map(reflections.map((r) => [r.id, r]))
  const waves: SearchWave[] = []
  for (const entry of log) {
    const key = entry.reflection_id ?? ''
    const last = waves[waves.length - 1]
    if (last && (last.reflection?.id ?? '') === key) {
      last.searches.push(entry)
      last.blocksSearch = last.reflection === null && last.searches.some((s) => !isFailedSearchAttempt(s))
      continue
    }
    const reflection = entry.reflection_id ? (byId.get(entry.reflection_id) ?? null) : null
    const searches = [entry]
    waves.push({
      searches,
      reflection,
      blocksSearch: reflection === null && !isFailedSearchAttempt(entry),
    })
  }
  const attached = new Set(waves.map((w) => w.reflection?.id).filter((id): id is string => !!id))
  for (const r of reflections) {
    if (!attached.has(r.id)) waves.push({ searches: [], reflection: r, blocksSearch: false })
  }
  return waves
}
