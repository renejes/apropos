import { useState } from 'react'
import { Button } from '../components/ui'
import type { ProjectKind, ProjectMode } from '../../../shared/types'

export default function NewProjectDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const [kind, setKind] = useState<ProjectKind | null>(null)
  const [title, setTitle] = useState('')
  const [question, setQuestion] = useState('')
  const [mode, setMode] = useState<ProjectMode>('academic')
  const [busy, setBusy] = useState(false)

  const create = async () => {
    if (!kind || title.trim().length < 3) return
    if (kind === 'research' && question.trim().length < 5) return
    setBusy(true)
    try {
      const p = await window.api.createProject({
        title: title.trim(),
        research_question: kind === 'research' ? question.trim() : '',
        mode: kind === 'research' ? mode : 'academic',
        kind,
      })
      onCreated(p.id)
    } finally {
      setBusy(false)
    }
  }

  const canCreate =
    kind !== null && title.trim().length >= 3 && (kind === 'notebook' || question.trim().length >= 5)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-fg/30 p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-project-title"
        className="w-full max-w-lg border border-line bg-bg p-6"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onClose()
        }}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 id="new-project-title" className="text-base">
            Neues Projekt
          </h2>
          <Button variant="ghost" onClick={onClose} title="Dialog schließen">
            ×
          </Button>
        </div>

        <p className="mb-2 font-mono text-[11px] uppercase tracking-[0.08em] text-muted">Was möchtest du anlegen?</p>
        <div className="mb-4 grid grid-cols-2 gap-2">
          <KindCard
            active={kind === 'research'}
            title="Research"
            hint="Brief, Quellen mit Offset-Zwang, Karte, Bericht, Sign-off."
            onClick={() => setKind('research')}
          />
          <KindCard
            active={kind === 'notebook'}
            title="Notebook"
            hint="PDFs und YouTube, Chat über den Korpus, bearbeitbare Notizen."
            onClick={() => setKind('notebook')}
          />
        </div>

        {kind && (
          <>
            <label htmlFor="np-title" className="mb-1 block font-mono text-[11px] uppercase tracking-[0.08em] text-muted">
              Titel
            </label>
            <input
              id="np-title"
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={kind === 'notebook' ? 'z. B. Seminar Folien Q3' : 'z. B. Wettbewerbsanalyse KI-Research-Tools'}
              className="field mb-3 w-full"
            />
          </>
        )}

        {kind === 'research' && (
          <>
            <label htmlFor="np-question" className="mb-1 block font-mono text-[11px] uppercase tracking-[0.08em] text-muted">
              Forschungsfrage
            </label>
            <textarea
              id="np-question"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              rows={2}
              placeholder="Welche Frage soll diese Research beantworten?"
              className="field mb-3 w-full"
            />

            <label className="mb-1 block font-mono text-[11px] uppercase tracking-[0.08em] text-muted">Modus</label>
            <div className="mb-5 flex gap-2">
              {(
                [
                  ['academic', 'Akademisch'],
                  ['business', 'Business / Marketing'],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setMode(value)}
                  className={`flex flex-1 items-center justify-center border px-3 py-2 text-sm ${
                    mode === value ? 'border-line bg-fg text-bg' : 'border-line text-muted hover:bg-fg hover:text-bg'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </>
        )}

        {kind === 'notebook' && <div className="mb-5" />}

        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>Abbrechen</Button>
          <Button variant="primary" onClick={create} disabled={busy || !canCreate}>
            Projekt anlegen
          </Button>
        </div>
      </div>
    </div>
  )
}

function KindCard({
  active,
  title,
  hint,
  onClick,
}: {
  active: boolean
  title: string
  hint: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`border px-3 py-3 text-left ${active ? 'border-line bg-fg text-bg' : 'border-line text-fg hover:bg-wash'}`}
    >
      <div className="text-sm">{title}</div>
      <p className={`mt-1 text-xs ${active ? 'text-bg/80' : 'text-muted'}`}>{hint}</p>
    </button>
  )
}
