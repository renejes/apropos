import { useState } from 'react'
import type { ProjectState } from '../../../shared/types'
import { Button } from '../components/ui'

export type WritingScopeInput = { visual_version_id?: string; scope?: 'marked' }

export function writingScopeFromState(state: ProjectState, visualVersionId?: string): WritingScopeInput | null {
  if (visualVersionId) return { visual_version_id: visualVersionId }
  if (state.marks.length > 0) return { scope: 'marked' }
  const latest = state.visualVersions[state.visualVersions.length - 1]
  if (latest) return { visual_version_id: latest.id }
  return null
}

export default function EasyWritingExportButton({
  state,
  visualVersionId,
  onDone,
}: {
  state: ProjectState
  visualVersionId?: string
  onDone: (msg: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const remembered = state.project.easy_writing_dir

  const run = async (target: 'new' | 'existing', outDir: string, projectType?: 'blog' | 'paper') => {
    const scope = writingScopeFromState(state, visualVersionId)
    if (!scope) {
      onDone('Erst eine Version speichern oder Punkte markieren — der Easy-Writing-Export braucht immer einen Scope.')
      return
    }
    setBusy(true)
    try {
      const result = await window.api.exportEasyWriting({
        project_id: state.project.id,
        ...scope,
        target,
        out_dir: outDir,
        project_type: projectType,
      })
      setOpen(false)
      onDone(`Easy Writing: ${result.dir}`)
    } catch (err) {
      onDone(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const onRemembered = () => {
    if (!remembered) return
    void run('existing', remembered)
  }

  const onNew = async (projectType: 'blog' | 'paper') => {
    const parent = await window.api.pickDirectory('Elternordner für das Easy-Writing-Projekt')
    if (!parent) return
    await run('new', parent, projectType)
  }

  const onExisting = async () => {
    const dir = await window.api.pickDirectory('Easy-Writing-Ordner (mit project.yaml)')
    if (!dir) return
    await run('existing', dir)
  }

  return (
    <>
      <Button
        icon="edit_note"
        disabled={busy}
        onClick={() => {
          const scope = writingScopeFromState(state, visualVersionId)
          if (!scope) {
            onDone('Erst eine Version speichern oder Punkte markieren — der Easy-Writing-Export braucht immer einen Scope.')
            return
          }
          if (remembered) {
            void onRemembered()
            return
          }
          setOpen(true)
        }}
        title={remembered ? `Erneut nach ${remembered} schreiben` : 'Easy-Writing-Ordner anlegen oder in einen bestehenden schreiben'}
      >
        Easy Writing
      </Button>
      {remembered && (
        <Button
          disabled={busy}
          onClick={() => setOpen(true)}
          title="Anderen Ordner wählen oder neu anlegen"
        >
          Ordner…
        </Button>
      )}
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-fg/30 p-4" onClick={() => setOpen(false)}>
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="ew-export-title"
            className="w-full max-w-lg border border-line bg-bg p-6"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setOpen(false)
            }}
          >
            <h2 id="ew-export-title" className="text-base">
              Easy Writing
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-muted">
              Schreibt <code className="font-mono text-xs">research.mdx</code> und die Bibliografie. Schreibkapitel bleiben leer bzw. unangetastet. Beim Export in Easy Writing das Dossier abwählen.
            </p>
            {remembered && (
              <p className="mt-3 font-mono text-xs text-muted">Gemerkt: {remembered}</p>
            )}
            <div className="mt-4 flex flex-col gap-2">
              {remembered && (
                <Button variant="primary" disabled={busy} onClick={() => void onRemembered()}>
                  Erneut schreiben
                </Button>
              )}
              <Button disabled={busy} onClick={() => void onNew('blog')}>
                Neuer Ordner — Blog
              </Button>
              <Button disabled={busy} onClick={() => void onNew('paper')}>
                Neuer Ordner — Paper
              </Button>
              <Button disabled={busy} onClick={() => void onExisting()}>
                In bestehenden Ordner
              </Button>
            </div>
            <div className="mt-4 flex justify-end">
              <Button onClick={() => setOpen(false)}>Abbrechen</Button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
