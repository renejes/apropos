import { existsSync, readdirSync, readFileSync, statSync } from 'fs'
import { extname, isAbsolute, join, relative, resolve, sep } from 'path'
import { projectWorkspace } from '../agent/workspace'
import { ServiceError } from './research'
import type { ArtifactFile } from '../../../shared/types'

const MAX_PREVIEW_BYTES = 2_000_000
const MAX_LIST = 80

function artifactsRoot(projectId: string): string {
  return resolve(join(projectWorkspace(projectId), 'artifacts'))
}

function kindOf(file: string): ArtifactFile['kind'] {
  switch (extname(file).toLowerCase()) {
    case '.html':
    case '.htm':
      return 'html'
    case '.md':
    case '.markdown':
      return 'markdown'
    case '.csv':
      return 'csv'
    default:
      return 'other'
  }
}

function walk(dir: string, relBase: string, acc: ArtifactFile[]): void {
  if (acc.length >= MAX_LIST || !existsSync(dir)) return
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return
  }
  for (const name of entries) {
    if (acc.length >= MAX_LIST) return
    if (name.startsWith('.')) continue
    const abs = join(dir, name)
    const rel = relBase ? `${relBase}/${name}` : name
    let st
    try {
      st = statSync(abs)
    } catch {
      continue
    }
    if (st.isDirectory()) {
      walk(abs, rel, acc)
      continue
    }
    if (!st.isFile()) continue
    acc.push({
      path: rel,
      kind: kindOf(name),
      size: st.size,
      updated_at: st.mtime.toISOString(),
    })
  }
}

export function listArtifacts(projectId: string): ArtifactFile[] {
  const root = artifactsRoot(projectId)
  const acc: ArtifactFile[] = []
  walk(root, '', acc)
  acc.sort((a, b) => b.updated_at.localeCompare(a.updated_at))
  return acc
}

export function resolveArtifactPath(projectId: string, relativePath: string): string {
  const root = artifactsRoot(projectId)
  const cleaned = relativePath.replace(/\\/g, '/').split('/').filter((p) => p && p !== '.' && p !== '..')
  if (cleaned.length === 0) {
    throw new ServiceError('artifact_path_invalid', 'Ungültiger Artefakt-Pfad.', 'Nimm einen Pfad aus list_artifacts.')
  }
  const target = resolve(join(root, ...cleaned))
  const rel = relative(root, target)
  if (!rel || rel.startsWith('..') || isAbsolute(rel) || rel.split(sep).includes('..')) {
    throw new ServiceError('artifact_path_invalid', 'Pfad liegt außerhalb von artifacts/.', 'Nimm einen Pfad aus list_artifacts.')
  }
  return target
}

export function readArtifact(
  projectId: string,
  relativePath: string
): { path: string; kind: ArtifactFile['kind']; text: string } {
  const abs = resolveArtifactPath(projectId, relativePath)
  if (!existsSync(abs)) {
    throw new ServiceError('artifact_missing', `Artefakt „${relativePath}“ nicht gefunden.`, 'Rufe list_artifacts auf.')
  }
  const st = statSync(abs)
  if (!st.isFile()) {
    throw new ServiceError('artifact_missing', 'Das ist kein Datei-Artefakt.', 'Wähle eine Datei aus list_artifacts.')
  }
  if (st.size > MAX_PREVIEW_BYTES) {
    throw new ServiceError(
      'artifact_too_large',
      `Datei ist ${st.size} Bytes groß (Maximum ${MAX_PREVIEW_BYTES}).`,
      'Schreibe ein kleineres HTML/Markdown nach artifacts/.'
    )
  }
  return { path: relativePath.replace(/\\/g, '/'), kind: kindOf(abs), text: readFileSync(abs, 'utf-8') }
}
