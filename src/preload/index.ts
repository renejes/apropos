import { contextBridge, ipcRenderer } from 'electron'
import type {
  CoverageReport,
  DeterministicVerifyResult,
  DocumentExcerpt,
  DocumentSearchHit,
  EventLogEntry,
  FetchedDocument,
  Mark,
  MarkEntityType,
  Project,
  ProjectState,
  ProjectSummary,
  ReportVersion,
  ServerInfo,
  Source,
  VisualGraph,
  VisualLayoutKind,
  VisualVersion,
  Note,
  ArtifactFile,
  DataRootInfo,
  DocumentOpenInfo,
} from '../shared/types'
import type {
  AgentAuthStatus,
  AgentChatEvent,
  AgentEventPayload,
  AgentMentionable,
  AgentModelInfo,
  AgentRunState,
  AgentSendInput,
  AgentSendResult,
  AgentSessionResult,
  AgentSettings,
} from '../shared/agent'

/** Typisierte, schmale API-Fläche für den Renderer. */
const api = {
  listProjects: (): Promise<ProjectSummary[]> => ipcRenderer.invoke('projects:list'),
  createProject: (input: {
    title: string
    research_question: string
    mode: 'academic' | 'business'
    kind?: 'research' | 'notebook'
    linked_research_id?: string | null
  }): Promise<Project> => ipcRenderer.invoke('projects:create', input),
  createNotebookFromResearch: (researchId: string): Promise<Project> => ipcRenderer.invoke('projects:createNotebook', researchId),
  linkNotebookToResearch: (notebookId: string, researchId: string): Promise<Project> =>
    ipcRenderer.invoke('projects:linkResearch', notebookId, researchId),
  deleteProject: (projectId: string): Promise<{ deleted: boolean }> => ipcRenderer.invoke('projects:delete', projectId),
  getProjectState: (projectId: string): Promise<ProjectState> => ipcRenderer.invoke('projects:state', projectId),
  listEvents: (projectId: string): Promise<EventLogEntry[]> => ipcRenderer.invoke('projects:events', projectId),
  searchSources: (projectId: string, query: string): Promise<Source[]> => ipcRenderer.invoke('projects:search', projectId, query),

  signSource: (sourceId: string, verdict: 'human_signed' | 'rejected', note: string | null): Promise<Source> =>
    ipcRenderer.invoke('sources:sign', sourceId, verdict, note),

  getCoverage: (projectId: string): Promise<CoverageReport> => ipcRenderer.invoke('coverage:get', projectId),
  describeMap: (
    projectId: string,
    layoutKind?: VisualLayoutKind
  ): Promise<{ layout_kind: VisualLayoutKind; live: true; graph: VisualGraph; marks: Mark[]; versions: VisualVersion[] }> =>
    ipcRenderer.invoke('visual:describe', projectId, layoutKind),
  prepareView: (input: {
    project_id: string
    question: string
    layout_kind: VisualLayoutKind
    scope?: 'all' | 'marked'
    parent_version_id?: string | null
  }): Promise<{ version: VisualVersion; graph: VisualGraph }> => ipcRenderer.invoke('visual:prepare', input),
  getVisualVersion: (projectId: string, versionId: string): Promise<{ version: VisualVersion; graph: VisualGraph }> =>
    ipcRenderer.invoke('visual:get', projectId, versionId),
  toggleMark: (
    projectId: string,
    entityType: MarkEntityType,
    entityId: string
  ): Promise<{ marked: boolean; mark: Mark | null }> => ipcRenderer.invoke('marks:toggle', projectId, entityType, entityId),
  assignSource: (sourceId: string, subQuestionId: string | null): Promise<Source> =>
    ipcRenderer.invoke('sources:assign', sourceId, subQuestionId),
  listDocuments: (projectId: string): Promise<Array<Omit<FetchedDocument, 'text'>>> => ipcRenderer.invoke('documents:list', projectId),
  getExcerpt: (documentId: string, start: number, end: number, context?: number): Promise<DocumentExcerpt | null> =>
    ipcRenderer.invoke('documents:excerpt', documentId, start, end, context),
  getDocument: (documentId: string): Promise<FetchedDocument | null> => ipcRenderer.invoke('documents:get', documentId),
  searchDocuments: (projectId: string, query: string): Promise<DocumentSearchHit[]> =>
    ipcRenderer.invoke('documents:search', projectId, query),
  openOriginalDocument: (documentId: string): Promise<boolean> => ipcRenderer.invoke('documents:openOriginal', documentId),
  showDocumentInFolder: (documentId: string): Promise<boolean> => ipcRenderer.invoke('documents:showInFolder', documentId),
  inspectDocument: (documentId: string): Promise<DocumentOpenInfo> => ipcRenderer.invoke('documents:inspect', documentId),
  readDocumentPdf: (documentId: string): Promise<ArrayBuffer | null> => ipcRenderer.invoke('documents:pdfBytes', documentId),
  uploadCorpus: (
    projectId: string
  ): Promise<{
    filenames: string[]
    documents: Array<{ document_id: string; filename: string; char_len: number; url: string }>
    errors: Array<{ filename: string; message: string }>
  }> => ipcRenderer.invoke('corpus:upload', projectId),
  importCorpus: (
    projectId: string,
    filePaths: string[]
  ): Promise<{
    filenames: string[]
    documents: Array<{ document_id: string; filename: string; char_len: number; url: string }>
    errors: Array<{ filename: string; message: string }>
  }> => ipcRenderer.invoke('corpus:import', projectId, filePaths),

  addReportVersion: (
    projectId: string,
    contentMarkdown: string,
    parentVersionId: string | null,
    changeSummary: string | null
  ): Promise<ReportVersion> => ipcRenderer.invoke('reports:add', projectId, contentMarkdown, parentVersionId, changeSummary),

  runDeterministicVerify: (projectId: string): Promise<DeterministicVerifyResult[]> => ipcRenderer.invoke('verify:run', projectId),
  onVerifyProgress: (cb: (p: { done: number; total: number; last: DeterministicVerifyResult }) => void): (() => void) => {
    const listener = (_e: unknown, payload: { done: number; total: number; last: DeterministicVerifyResult }) => cb(payload)
    ipcRenderer.on('verify:progress', listener)
    return () => ipcRenderer.removeListener('verify:progress', listener)
  },

  exportMarkdown: (projectId: string, versionId: string | null): Promise<{ saved: boolean; filePath?: string }> =>
    ipcRenderer.invoke('export:markdown', projectId, versionId),
  copyMarkdown: (projectId: string, versionId: string | null): Promise<{ copied: boolean }> =>
    ipcRenderer.invoke('export:copy', projectId, versionId),
  exportBibliography: (projectId: string): Promise<{ saved: boolean; filePath?: string }> =>
    ipcRenderer.invoke('export:bibliography', projectId),
  exportWritingPack: (input: {
    project_id: string
    visual_version_id?: string
    scope?: 'marked'
    jpeg_base64?: string
  }): Promise<{ dir: string; files: string[]; source_ids: string[]; claim_ids: string[]; scope: string }> =>
    ipcRenderer.invoke('export:writingPack', input),
  exportEasyWriting: (input: {
    project_id: string
    visual_version_id?: string
    scope?: 'marked'
    jpeg_base64?: string
    target: 'new' | 'existing'
    out_dir: string
    project_type?: 'blog' | 'paper'
  }): Promise<{
    dir: string
    files: string[]
    source_ids: string[]
    claim_ids: string[]
    scope: string
    remapped_citekeys: Array<{ from: string; to: string }>
    target: 'new' | 'existing'
  }> => ipcRenderer.invoke('export:easyWriting', input),
  pickDirectory: (title: string): Promise<string | null> => ipcRenderer.invoke('dialog:pickDirectory', title),
  dataRootInfo: (): Promise<DataRootInfo> => ipcRenderer.invoke('data:info'),
  setDataCloudSynced: (cloudSynced: boolean): Promise<DataRootInfo> => ipcRenderer.invoke('data:setCloudSynced', cloudSynced),
  setDataRoot: (
    input: { toRoot: string; mode: 'copy' | 'use-existing'; cloudSynced: boolean }
  ): Promise<{ ok: true } | { ok: false; error: string; hasDb?: boolean }> => ipcRenderer.invoke('data:setRoot', input),

  serverInfo: (): Promise<ServerInfo> => ipcRenderer.invoke('server:info'),
  seedDemo: (): Promise<string> => ipcRenderer.invoke('demo:seed'),

  agentAuthStatus: (): Promise<AgentAuthStatus> => ipcRenderer.invoke('agent:authStatus'),
  agentBrowserLogin: (): Promise<AgentAuthStatus> => ipcRenderer.invoke('agent:browserLogin'),
  agentCancelLogin: (): Promise<boolean> => ipcRenderer.invoke('agent:cancelLogin'),
  agentLogout: (): Promise<AgentAuthStatus> => ipcRenderer.invoke('agent:logout'),
  agentListModels: (): Promise<AgentModelInfo[]> => ipcRenderer.invoke('agent:listModels'),
  agentGetSettings: (): Promise<AgentSettings> => ipcRenderer.invoke('agent:getSettings'),
  agentSetSettings: (settings: AgentSettings): Promise<AgentSettings> => ipcRenderer.invoke('agent:setSettings', settings),
  agentSend: (projectId: string, input: AgentSendInput): Promise<AgentSendResult> =>
    ipcRenderer.invoke('agent:send', projectId, input),
  agentCancel: (projectId: string): Promise<boolean> => ipcRenderer.invoke('agent:cancel', projectId),
  agentAttach: (projectId: string): Promise<string[]> => ipcRenderer.invoke('agent:attach', projectId),
  agentHistory: (projectId: string): Promise<AgentChatEvent[]> => ipcRenderer.invoke('agent:history', projectId),
  agentRunState: (projectId: string): Promise<AgentRunState> => ipcRenderer.invoke('agent:runState', projectId),
  agentSessions: (projectId: string): Promise<AgentSessionResult> => ipcRenderer.invoke('agent:sessions', projectId),
  agentNewSession: (projectId: string): Promise<AgentSessionResult> => ipcRenderer.invoke('agent:newSession', projectId),
  agentSwitchSession: (projectId: string, sessionId: string): Promise<AgentSessionResult> =>
    ipcRenderer.invoke('agent:switchSession', projectId, sessionId),
  agentCloseTab: (projectId: string, sessionId: string): Promise<AgentSessionResult> =>
    ipcRenderer.invoke('agent:closeTab', projectId, sessionId),
  agentDeleteSession: (projectId: string, sessionId: string): Promise<AgentSessionResult> =>
    ipcRenderer.invoke('agent:deleteSession', projectId, sessionId),
  agentMentionables: (projectId: string): Promise<AgentMentionable[]> => ipcRenderer.invoke('agent:mentionables', projectId),
  onAgentEvent: (cb: (payload: AgentEventPayload) => void): (() => void) => {
    const listener = (_e: unknown, payload: AgentEventPayload) => cb(payload)
    ipcRenderer.on('agent:event', listener)
    return () => ipcRenderer.removeListener('agent:event', listener)
  },
  onAgentLoginUrl: (cb: (url: string) => void): (() => void) => {
    const listener = (_e: unknown, url: string) => cb(url)
    ipcRenderer.on('agent:loginUrl', listener)
    return () => ipcRenderer.removeListener('agent:loginUrl', listener)
  },
  openExternal: (url: string): Promise<boolean> => ipcRenderer.invoke('open:external', url),
  listNotes: (projectId: string): Promise<Note[]> => ipcRenderer.invoke('notes:list', projectId),
  getNote: (noteId: string): Promise<Note | null> => ipcRenderer.invoke('notes:get', noteId),
  createNote: (input: {
    project_id: string
    title: string
    body_markdown: string
    origin?: 'human' | 'chat' | 'agent'
    citations?: unknown
  }): Promise<Note> => ipcRenderer.invoke('notes:create', input),
  updateNote: (input: { note_id: string; title?: string; body_markdown?: string; citations?: unknown }): Promise<Note> =>
    ipcRenderer.invoke('notes:update', input),
  deleteNote: (noteId: string): Promise<{ deleted: boolean }> => ipcRenderer.invoke('notes:delete', noteId),
  ingestYoutube: (projectId: string, url: string): Promise<FetchedDocument> =>
    ipcRenderer.invoke('notebook:youtube', projectId, url),
  listArtifacts: (projectId: string): Promise<ArtifactFile[]> => ipcRenderer.invoke('notebook:artifacts', projectId),
  readArtifact: (projectId: string, path: string): Promise<{ path: string; kind: ArtifactFile['kind']; text: string }> =>
    ipcRenderer.invoke('notebook:artifact', projectId, path),
  onOpenManual: (cb: () => void): (() => void) => {
    const listener = () => cb()
    ipcRenderer.on('ui:openManual', listener)
    return () => ipcRenderer.removeListener('ui:openManual', listener)
  },
}

export type RendererApi = typeof api

contextBridge.exposeInMainWorld('api', api)
