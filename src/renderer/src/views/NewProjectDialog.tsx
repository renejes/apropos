import { useState } from 'react'
import { Button, Icon } from '../components/ui'

export default function NewProjectDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const [title, setTitle] = useState('')
  const [question, setQuestion] = useState('')
  const [mode, setMode] = useState<'academic' | 'business'>('academic')
  const [busy, setBusy] = useState(false)

  const create = async () => {
    if (title.trim().length < 3) return
    setBusy(true)
    try {
      const p = await window.api.createProject({ title: title.trim(), research_question: question.trim(), mode })
      onCreated(p.id)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/30 p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-project-title"
        className="w-full max-w-lg rounded-xl bg-white p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onClose()
        }}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 id="new-project-title" className="text-base font-semibold">
            Neues Research-Projekt
          </h2>
          <Button variant="ghost" icon="close" onClick={onClose} title="Dialog schließen" />
        </div>

        <label htmlFor="np-title" className="mb-1 block text-xs font-medium text-slate-600">
          Titel
        </label>
        <input
          id="np-title"
          autoFocus
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="z. B. Wettbewerbsanalyse KI-Research-Tools"
          className="mb-3 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-(--color-accent-600) focus:outline-none"
        />

        <label htmlFor="np-question" className="mb-1 block text-xs font-medium text-slate-600">
          Forschungsfrage
        </label>
        <textarea
          id="np-question"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          rows={2}
          placeholder="Welche Frage soll diese Research beantworten?"
          className="mb-3 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-(--color-accent-600) focus:outline-none"
        />

        <label className="mb-1 block text-xs font-medium text-slate-600">Modus</label>
        <div className="mb-5 flex gap-2">
          {(
            [
              ['academic', 'school', 'Akademisch'],
              ['business', 'storefront', 'Business / Marketing'],
            ] as const
          ).map(([value, icon, label]) => (
            <button
              key={value}
              onClick={() => setMode(value)}
              className={`flex flex-1 items-center justify-center gap-2 rounded-lg border px-3 py-2 text-sm ${
                mode === value
                  ? 'border-(--color-accent-600) bg-(--color-accent-50) font-medium'
                  : 'border-slate-300 text-slate-600 hover:bg-slate-50'
              }`}
            >
              <Icon name={icon} className="icon-sm" /> {label}
            </button>
          ))}
        </div>

        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>Abbrechen</Button>
          <Button variant="primary" icon="add" onClick={create} disabled={busy || title.trim().length < 3}>
            Projekt anlegen
          </Button>
        </div>
      </div>
    </div>
  )
}
