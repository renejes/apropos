import { contextBridge, ipcRenderer } from 'electron'
import type { ModelInfo, ProviderHealth } from '../main/core/providers/types'
import type { EngineEvent, EngineRunResult } from '../main/core/engine/research-engine'
import type { EngineStatus, StartEngineInput } from '../main/engine-runner'
import type {
  CoverageReport,
  DeterministicVerifyResult,
  DocumentExcerpt,
  EngineRun,
  EventLogEntry,
  FetchedDocument,
  Project,
  ProjectState,
  ProjectSummary,
  ReportVersion,
  ServerInfo,
  Source,
} from '../shared/types'

/** Typisierte, schmale API-Fläche für den Renderer. */
const api = {
  listProjects: (): Promise<ProjectSummary[]> => ipcRenderer.invoke('projects:list'),
  createProject: (input: { title: string; research_question: string; mode: 'academic' | 'business' }): Promise<Project> =>
    ipcRenderer.invoke('projects:create', input),
  getProjectState: (projectId: string): Promise<ProjectState> => ipcRenderer.invoke('projects:state', projectId),
  listEvents: (projectId: string): Promise<EventLogEntry[]> => ipcRenderer.invoke('projects:events', projectId),
  searchSources: (projectId: string, query: string): Promise<Source[]> => ipcRenderer.invoke('projects:search', projectId, query),

  signSource: (sourceId: string, verdict: 'human_signed' | 'rejected', note: string | null): Promise<Source> =>
    ipcRenderer.invoke('sources:sign', sourceId, verdict, note),

  getCoverage: (projectId: string): Promise<CoverageReport> => ipcRenderer.invoke('coverage:get', projectId),
  assignSource: (sourceId: string, subQuestionId: string | null): Promise<Source> =>
    ipcRenderer.invoke('sources:assign', sourceId, subQuestionId),
  listDocuments: (projectId: string): Promise<Array<Omit<FetchedDocument, 'text'>>> => ipcRenderer.invoke('documents:list', projectId),
  getExcerpt: (documentId: string, start: number, end: number, context?: number): Promise<DocumentExcerpt | null> =>
    ipcRenderer.invoke('documents:excerpt', documentId, start, end, context),

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

  startEngine: (input: StartEngineInput): Promise<EngineRunResult> => ipcRenderer.invoke('engine:start', input),
  stopEngine: (): Promise<boolean> => ipcRenderer.invoke('engine:stop'),
  engineStatus: (): Promise<EngineStatus> => ipcRenderer.invoke('engine:status'),
  engineResumable: (projectId: string): Promise<EngineRun | null> => ipcRenderer.invoke('engine:resumable', projectId),
  engineRuns: (projectId: string): Promise<EngineRun[]> => ipcRenderer.invoke('engine:runs', projectId),
  onEngineEvent: (cb: (e: EngineEvent) => void): (() => void) => {
    const listener = (_e: unknown, payload: EngineEvent) => cb(payload)
    ipcRenderer.on('engine:event', listener)
    return () => ipcRenderer.removeListener('engine:event', listener)
  },

  providerHealth: (): Promise<ProviderHealth> => ipcRenderer.invoke('provider:health'),
  providerModels: (): Promise<ModelInfo[]> => ipcRenderer.invoke('provider:models'),

  serverInfo: (): Promise<ServerInfo> => ipcRenderer.invoke('server:info'),
  seedDemo: (): Promise<string> => ipcRenderer.invoke('demo:seed'),
}

export type RendererApi = typeof api

contextBridge.exposeInMainWorld('api', api)
