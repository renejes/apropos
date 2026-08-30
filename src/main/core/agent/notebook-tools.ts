import type { ProjectKind } from '../../../shared/types'

/** Werkzeuge, die der Notebook-Agent sehen darf — bewusst kurz. */
export const NOTEBOOK_TOOL_NAMES = [
  'get_project_state',
  'list_corpus',
  'search_documents',
  'read_document',
  'add_source',
  'save_note',
  'list_notes',
  'update_note',
  'list_artifacts',
  'list_inbox',
  'ingest_local_file',
] as const

const NOTEBOOK_ONLY = new Set<string>(['save_note', 'list_notes', 'update_note', 'list_artifacts'])

export function toolsForKind<T>(all: Record<string, T>, kind: ProjectKind): Record<string, T> {
  if (kind === 'notebook') {
    const picked: Record<string, T> = {}
    for (const name of NOTEBOOK_TOOL_NAMES) {
      const tool = all[name]
      if (tool) picked[name] = tool
    }
    return picked
  }
  const picked: Record<string, T> = {}
  for (const [name, tool] of Object.entries(all)) {
    if (!NOTEBOOK_ONLY.has(name)) picked[name] = tool
  }
  return picked
}
