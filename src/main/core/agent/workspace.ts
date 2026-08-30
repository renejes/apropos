import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'fs'
import { basename, isAbsolute, join, relative, resolve, sep } from 'path'
import { defaultAgentRoot } from '../paths'
import { FOCUSED_RESEARCH_SKILL } from './focused-research-skill'
import { NOTEBOOK_SKILL } from './notebook-skill'

const workspaces = new Map<string, string>()

function seedSkill(dir: string, name: string, body: string): void {
  const targets = [join(dir, '.cursor', 'skills', name), join(dir, 'skills', name)]
  for (const skillDir of targets) {
    try {
      mkdirSync(skillDir, { recursive: true })
      writeFileSync(join(skillDir, 'SKILL.md'), body, 'utf-8')
      return
    } catch {
      /* .cursor kann in Tests gesperrt sein — Fallback auf skills/ */
    }
  }
}

function seedNotebookDirs(dir: string): void {
  mkdirSync(join(dir, 'notes'), { recursive: true })
  mkdirSync(join(dir, 'artifacts'), { recursive: true })
  try {
    mkdirSync(join(dir, '.cursor'), { recursive: true })
    writeFileSync(
      join(dir, '.cursor', 'sandbox.json'),
      JSON.stringify({ type: 'workspace', network: { default: 'deny' } }, null, 2),
      'utf-8'
    )
  } catch {
    /* optional */
  }
}

export function projectWorkspace(projectId: string, root = defaultAgentRoot()): string {
  const dir = join(root, projectId)
  mkdirSync(join(dir, 'inbox'), { recursive: true })
  seedNotebookDirs(dir)
  seedSkill(dir, 'focused-research', FOCUSED_RESEARCH_SKILL)
  seedSkill(dir, 'notebook-sources', NOTEBOOK_SKILL)
  workspaces.set(projectId, dir)
  return dir
}

export function registeredWorkspace(projectId: string): string | null {
  return workspaces.get(projectId) ?? null
}

export function listInboxFiles(projectId: string): string[] {
  const ws = registeredWorkspace(projectId) ?? projectWorkspace(projectId)
  const inbox = join(ws, 'inbox')
  if (!existsSync(inbox)) return []
  return readdirSync(inbox).filter((n) => !n.startsWith('.'))
}

/**
 * Löst einen Inbox-Dateinamen auf und weist Pfade außerhalb der Inbox ab.
 */
export function resolveInboxFile(workspace: string, filename: string): string {
  const inbox = resolve(join(workspace, 'inbox'))
  const cleaned = filename.replace(/\\/g, '/').split('/').filter(Boolean).pop()
  if (!cleaned || cleaned === '.' || cleaned === '..') {
    throw new Error('Ungültiger Dateiname')
  }
  const target = resolve(join(inbox, cleaned))
  const rel = relative(inbox, target)
  if (!rel || rel.startsWith('..') || isAbsolute(rel) || rel.split(sep).includes('..')) {
    throw new Error('Pfad liegt außerhalb der Inbox')
  }
  return target
}

export function inboxDisplayName(absPath: string): string {
  return basename(absPath)
}

/** Entfernt den Agent-Workspace. Der Easy-Writing-Ordner auf der Platte bleibt. */
export function removeProjectWorkspace(projectId: string, root = defaultAgentRoot()): void {
  workspaces.delete(projectId)
  const dir = join(root, projectId)
  if (!existsSync(dir)) return
  rmSync(dir, { recursive: true, force: true })
}

/** Speicherschlüssel für add_source — muss z.string().url() erfüllen. */
export function localInboxUrl(filename: string): string {
  return `local://inbox/${encodeURIComponent(basename(filename))}`
}
