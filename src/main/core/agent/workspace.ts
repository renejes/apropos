import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'fs'
import { basename, isAbsolute, join, relative, resolve, sep } from 'path'
import { defaultAgentRoot } from '../paths'
import { FOCUSED_RESEARCH_SKILL } from './focused-research-skill'

const workspaces = new Map<string, string>()

function seedFocusedResearchSkill(dir: string): void {
  const targets = [
    join(dir, '.cursor', 'skills', 'focused-research'),
    join(dir, 'skills', 'focused-research'),
  ]
  for (const skillDir of targets) {
    try {
      mkdirSync(skillDir, { recursive: true })
      writeFileSync(join(skillDir, 'SKILL.md'), FOCUSED_RESEARCH_SKILL, 'utf-8')
      return
    } catch {
      /* .cursor kann in Tests gesperrt sein — Fallback auf skills/ */
    }
  }
}

export function projectWorkspace(projectId: string, root = defaultAgentRoot()): string {
  const dir = join(root, projectId)
  mkdirSync(join(dir, 'inbox'), { recursive: true })
  seedFocusedResearchSkill(dir)
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

/** Speicherschlüssel für add_source — muss z.string().url() erfüllen. */
export function localInboxUrl(filename: string): string {
  return `local://inbox/${encodeURIComponent(basename(filename))}`
}
