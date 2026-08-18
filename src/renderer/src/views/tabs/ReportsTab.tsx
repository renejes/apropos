import { useEffect, useState } from 'react'
import type { ProjectState } from '../../../../shared/types'
import { Badge, Button, Card, EmptyState, Icon, fmtDate } from '../../components/ui'

/**
 * Unveränderliche Berichtsversionen mit stabiler Snapshot-ID.
 * Menschen können Berichte bearbeiten — jede Bearbeitung wird als NEUE
 * Version gespeichert (created_by = human:ui), nichts wird überschrieben.
 */
export default function ReportsTab({ state, onReload }: { state: ProjectState; onReload: () => void }) {
  const versions = [...state.reportVersions].reverse()
  const [selectedId, setSelectedId] = useState<string | null>(versions[0]?.id ?? null)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [summary, setSummary] = useState('')
  const [parentId, setParentId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // Erste per Poll eintreffende Version automatisch selektieren
  useEffect(() => {
    if (versions.length > 0 && (!selectedId || !versions.some((v) => v.id === selectedId))) {
      setSelectedId(versions[0].id)
    }
  }, [versions, selectedId])
  const selected = versions.find((v) => v.id === selectedId) ?? null

  const startEdit = (fromVersion: typeof selected) => {
    setDraft(fromVersion?.content_markdown ?? '')
    setParentId(fromVersion?.id ?? null)
    setSummary('')
    setEditing(true)
  }

  const save = async () => {
    if (draft.trim().length < 10) return
    setBusy(true)
    try {
      await window.api.addReportVersion(
        state.project.id,
        draft,
        parentId,
        summary.trim() || (parentId ? 'Menschliche Überarbeitung' : 'Von Hand begonnen')
      )
      setEditing(false)
      setSelectedId(null) // Auto-Select springt auf die neue (jüngste) Version
      onReload()
    } finally {
      setBusy(false)
    }
  }

  if (editing) {
    return (
      <div className="mx-auto flex h-full max-w-4xl flex-col">
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Icon name="edit_note" className="text-(--color-accent-700)" />
            <span className="text-sm font-medium">
              {parentId ? `Überarbeitung von Version ${versions.find((v) => v.id === parentId)?.snapshot_hash ?? ''}` : 'Neuer Bericht'}
            </span>
          </div>
          <div className="flex gap-2">
            <Button onClick={() => setEditing(false)} disabled={busy}>
              Abbrechen
            </Button>
            <Button variant="primary" icon="save" onClick={save} disabled={busy || draft.trim().length < 10}>
              Als neue Version speichern
            </Button>
          </div>
        </div>
        <input
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
          placeholder="Was hast du geändert? (Änderungs-Zusammenfassung für die Versionshistorie)"
          className="mb-2 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-(--color-accent-600) focus:outline-none"
        />
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          spellCheck={false}
          className="min-h-0 flex-1 resize-none rounded-xl border border-slate-300 bg-white p-4 font-mono text-[13px] leading-relaxed focus:border-(--color-accent-600) focus:outline-none"
          placeholder="# Bericht in Markdown … Quellen-Marker wie [S1] verweisen auf das Quellenverzeichnis."
        />
        <p className="mt-2 text-xs text-slate-400">
          <Icon name="lock" className="!text-[13px] mr-1" />
          Deine Bearbeitung überschreibt nichts: Sie wird als neue, unveränderliche Version mit dir als Autor (human:ui) und eigenem
          Snapshot-Hash im Audit-Trail abgelegt.
        </p>
      </div>
    )
  }

  if (versions.length === 0) {
    return (
      <div>
        <EmptyState
          icon="description"
          title="Noch keine Berichtsversion"
          hint="Die KI legt Berichte über add_report_version ab — oder du beginnst selbst eine Fassung. Jede Version ist unveränderlich und über ihren Snapshot-Hash zitierbar."
        />
        <div className="flex justify-center">
          <Button variant="primary" icon="edit_note" onClick={() => startEdit(null)}>
            Bericht von Hand beginnen
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full gap-4">
      <div className="w-72 shrink-0 space-y-2 overflow-y-auto">
        {versions.map((v, i) => (
          <Card key={v.id} className={`cursor-pointer p-3 ${selectedId === v.id ? 'ring-2 ring-(--color-accent-600)' : 'hover:shadow'}`}>
            <button className="w-full text-left" onClick={() => setSelectedId(v.id)}>
              <div className="flex items-center justify-between">
                <span className="font-mono text-xs font-semibold text-(--color-accent-700)">{v.snapshot_hash}</span>
                {i === 0 && <Badge tone="emerald">aktuell</Badge>}
              </div>
              <div className="mt-1 text-xs text-slate-500">{fmtDate(v.created_at)}</div>
              {v.change_summary && <div className="mt-1 line-clamp-2 text-xs text-slate-400">{v.change_summary}</div>}
              <div className="mt-1 flex items-center gap-1 text-[11px] text-slate-400">
                <Icon name={v.created_by.startsWith('human') ? 'person' : 'smart_toy'} className="!text-[13px]" />
                {v.created_by}
              </div>
            </button>
          </Card>
        ))}
      </div>

      {selected && (
        <Card className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-6 py-3">
            <div className="text-xs text-slate-400">
              Snapshot <span className="font-mono font-semibold text-slate-600">{selected.snapshot_hash}</span> ·{' '}
              {fmtDate(selected.created_at)}
              {selected.parent_version_id === null && (
                <span className="ml-2">
                  <Badge tone="slate">Erstfassung</Badge>
                </span>
              )}
            </div>
            <Button icon="edit" onClick={() => startEdit(selected)} title="Diese Fassung überarbeiten (wird als neue Version gespeichert)">
              Bearbeiten
            </Button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-6">
            {/* Bewusst als Plaintext gerendert (kein HTML-Rendering von KI-Inhalt) */}
            <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed text-slate-700">{selected.content_markdown}</pre>
          </div>
        </Card>
      )}
    </div>
  )
}
