import type { Repo } from '../repo'
import { removeProjectWorkspace } from '../agent/workspace'
import { ServiceError, resolveCorpusProjectId } from './research'
import type { Project, ProjectKind, ProjectMode, ProjectState } from '../../../shared/types'

function assertProject(repo: Repo, projectId: string) {
  const project = repo.getProject(projectId)
  if (!project) {
    throw new ServiceError(
      'project_not_found',
      `Projekt ${projectId} existiert nicht.`,
      'Rufe list_projects auf und verwende eine der dort genannten project_id. Erfinde keine ID.'
    )
  }
  return project
}

export function loadProjectState(repo: Repo, projectId: string): ProjectState {
  const state = repo.getProjectState(projectId)
  const corpusId = resolveCorpusProjectId(repo, projectId)
  if (corpusId === projectId) return { ...state, linked_research: null }
  const linked = repo.getProject(corpusId)
  return {
    ...state,
    documents: repo.listDocuments(corpusId),
    linked_research: linked ? { id: linked.id, title: linked.title } : null,
  }
}

export function createProject(
  repo: Repo,
  input: {
    title: string
    research_question: string
    mode: ProjectMode
    policy_preset?: string | null
    kind?: ProjectKind
    linked_research_id?: string | null
    actor: string
  }
): Project {
  const kind: ProjectKind = input.kind === 'notebook' ? 'notebook' : 'research'
  let linked: string | null = input.linked_research_id ?? null
  if (linked) {
    if (kind !== 'notebook') {
      throw new ServiceError(
        'linked_research_kind',
        'Nur ein Notebook kann an ein Research-Projekt gekoppelt werden.',
        'Setze kind=notebook, wenn du linked_research_id übergibst.'
      )
    }
    const research = assertProject(repo, linked)
    if (research.kind !== 'research') {
      throw new ServiceError(
        'linked_research_invalid',
        'Das Ziel ist kein Research-Projekt.',
        'Nimm die project_id eines Projekts mit kind=research.'
      )
    }
  } else {
    linked = null
  }
  return repo.createProject({ ...input, kind, linked_research_id: linked })
}

export function createNotebookFromResearch(repo: Repo, researchId: string, actor: string): Project {
  const research = assertProject(repo, researchId)
  if (research.kind !== 'research') {
    throw new ServiceError(
      'linked_research_invalid',
      'Notebooks können nur aus einem Research-Projekt erzeugt werden.',
      'Wähle ein Research-Projekt.'
    )
  }
  return createProject(
    repo,
    {
      title: `Notebook: ${research.title}`,
      research_question: '',
      mode: research.mode,
      kind: 'notebook',
      linked_research_id: research.id,
      actor,
    }
  )
}

export function linkNotebookToResearch(repo: Repo, notebookId: string, researchId: string, actor: string): Project {
  const notebook = assertProject(repo, notebookId)
  if (notebook.kind !== 'notebook') {
    throw new ServiceError(
      'link_not_notebook',
      'Nur ein Notebook kann mit einem Research verknüpft werden.',
      'Nimm die project_id eines Notebooks.'
    )
  }
  const research = assertProject(repo, researchId)
  if (research.kind !== 'research') {
    throw new ServiceError(
      'linked_research_invalid',
      'Das Ziel ist kein Research-Projekt.',
      'Nimm die project_id eines Projekts mit kind=research.'
    )
  }
  const ownDocs = repo.listDocuments(notebookId)
  if (ownDocs.length > 0) {
    throw new ServiceError(
      'notebook_corpus_not_empty',
      'Dieses Notebook hat bereits eigene Dokumente und kann nicht verknüpft werden.',
      'Lege ein neues Notebook aus dem Research an, oder lösche zuerst die eigenen Quellen dieses Notebooks.'
    )
  }
  repo.setLinkedResearchId(notebookId, research.id, actor)
  return repo.getProject(notebookId)!
}

export function deleteProject(repo: Repo, projectId: string, actor: string): boolean {
  const project = repo.getProject(projectId)
  if (!project) return false
  if (project.kind === 'research') {
    const notebooks = repo.listNotebooksLinkedTo(projectId)
    if (notebooks.length > 0) {
      const names = notebooks.map((n) => `„${n.title}“`).join(', ')
      throw new ServiceError(
        'research_has_notebooks',
        `Dieses Research-Projekt hat noch verknüpfte Notebooks: ${names}.`,
        'Löse zuerst die Verknüpfung oder lösche die Notebooks, danach das Research-Projekt.'
      )
    }
  }
  const deleted = repo.deleteProject(projectId, actor)
  if (deleted) removeProjectWorkspace(projectId)
  return deleted
}
