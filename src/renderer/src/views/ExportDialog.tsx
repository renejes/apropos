import { useState } from 'react'
import type { ProjectState } from '../../../shared/types'
import { Button } from '../components/ui'

export type WritingScopeInput = { visual_version_id?: string; scope?: 'marked' }
type ExportKind = 'provenance' | 'easy-writing'
type EasyWritingDest = 'remembered' | 'new-blog' | 'new-paper' | 'existing'

export function writingScopeFromState(state: ProjectState, visualVersionId?: string): WritingScopeInput | null {
  if (visualVersionId) return { visual_version_id: visualVersionId }
  if (state.marks.length > 0) return { scope: 'marked' }
  const latest = state.visualVersions[state.visualVersions.length - 1]
  if (latest) return { visual_version_id: latest.id }
  return null
}

export default function ExportDialog({
  state,
  visualVersionId,
  onClose,
  onDone,
}: {
  state: ProjectState
  visualVersionId?: string
  onClose: () => void
  onDone: (msg: string) => void
}) {
  const remembered = state.project.easy_writing_dir
  const scope = writingScopeFromState(state, visualVersionId)
  const [kind, setKind] = useState<ExportKind>('provenance')
  const [dest, setDest] = useState<EasyWritingDest>(remembered ? 'remembered' : 'new-blog')
  const [busy, setBusy] = useState(false)

  const runEasyWriting = async () => {
    if (!scope) {
      onDone('Erst eine Version speichern oder Punkte markieren — Easy Writing braucht immer einen Scope.')
      return
    }
    setBusy(true)
    try {
      switch (dest) {
        case 'remembered': {
          if (!remembered) return
          const result = await window.api.exportEasyWriting({
            project_id: state.project.id,
            ...scope,
            target: 'existing',
            out_dir: remembered,
          })
          onDone(`Easy Writing: ${result.dir}`)
          break
        }
        case 'new-blog':
        case 'new-paper': {
          const parent = await window.api.pickDirectory('Elternordner für das Easy-Writing-Projekt')
          if (!parent) return
          const result = await window.api.exportEasyWriting({
            project_id: state.project.id,
            ...scope,
            target: 'new',
            out_dir: parent,
            project_type: dest === 'new-blog' ? 'blog' : 'paper',
          })
          onDone(`Easy Writing: ${result.dir}`)
          break
        }
        case 'existing': {
          const dir = await window.api.pickDirectory('Easy-Writing-Ordner (mit project.yaml)')
          if (!dir) return
          const result = await window.api.exportEasyWriting({
            project_id: state.project.id,
            ...scope,
            target: 'existing',
            out_dir: dir,
          })
          onDone(`Easy Writing: ${result.dir}`)
          break
        }
        default: {
          const _never: never = dest
          return _never
        }
      }
      onClose()
    } catch (err) {
      onDone(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const submit = async () => {
    switch (kind) {
      case 'provenance': {
        setBusy(true)
        try {
          const res = await window.api.exportMarkdown(state.project.id, null)
          if (res.saved) {
            onDone(`Gespeichert: ${res.filePath}`)
            onClose()
          }
        } catch (err) {
          onDone(err instanceof Error ? err.message : String(err))
        } finally {
          setBusy(false)
        }
        return
      }
      case 'easy-writing':
        await runEasyWriting()
        return
      default: {
        const _never: never = kind
        return _never
      }
    }
  }

  const destDisabled = kind === 'easy-writing' && !scope

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-fg/30 p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="export-title"
        className="w-full max-w-lg border border-line bg-bg p-6"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onClose()
        }}
      >
        <h2 id="export-title" className="text-base">
          Export
        </h2>
        <fieldset className="mt-4">
          <legend className="mb-2 font-mono text-[11px] uppercase tracking-[0.08em] text-muted">Format</legend>
          <label className="flex items-center gap-2 text-sm">
            <input type="radio" name="export-kind" checked={kind === 'provenance'} onChange={() => setKind('provenance')} />
            Provenienz-Markdown
          </label>
          <label className="mt-1 flex items-center gap-2 text-sm">
            <input type="radio" name="export-kind" checked={kind === 'easy-writing'} onChange={() => setKind('easy-writing')} />
            Easy Writing
          </label>
        </fieldset>

        {kind === 'easy-writing' && (
          <fieldset className="mt-4">
            <legend className="mb-2 font-mono text-[11px] uppercase tracking-[0.08em] text-muted">Ziel</legend>
            <p className="mb-2 text-sm leading-relaxed text-muted">
              Schreibt <code className="font-mono text-xs">research.mdx</code> und die Bibliografie. Schreibkapitel bleiben leer bzw.
              unangetastet. Beim Export in Easy Writing das Dossier abwählen.
            </p>
            {destDisabled && (
              <p className="mb-2 text-sm text-warn">Erst eine Karten-Version speichern oder Punkte markieren.</p>
            )}
            {remembered && (
              <label className="flex items-start gap-2 text-sm">
                <input
                  type="radio"
                  name="ew-dest"
                  checked={dest === 'remembered'}
                  disabled={destDisabled}
                  onChange={() => setDest('remembered')}
                />
                <span>
                  Erneut schreiben
                  <span className="mt-0.5 block font-mono text-[11px] text-muted">{remembered}</span>
                </span>
              </label>
            )}
            <label className="mt-1 flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="ew-dest"
                checked={dest === 'new-blog'}
                disabled={destDisabled}
                onChange={() => setDest('new-blog')}
              />
              Neuer Ordner — Blog
            </label>
            <label className="mt-1 flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="ew-dest"
                checked={dest === 'new-paper'}
                disabled={destDisabled}
                onChange={() => setDest('new-paper')}
              />
              Neuer Ordner — Paper
            </label>
            <label className="mt-1 flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="ew-dest"
                checked={dest === 'existing'}
                disabled={destDisabled}
                onChange={() => setDest('existing')}
              />
              In bestehenden Ordner
            </label>
          </fieldset>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <Button onClick={onClose}>Abbrechen</Button>
          <Button variant="primary" disabled={busy || destDisabled} onClick={() => void submit()}>
            Exportieren
          </Button>
        </div>
      </div>
    </div>
  )
}
