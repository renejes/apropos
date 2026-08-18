import type { ProjectState } from '../../../../shared/types'
import { Badge, Card, EmptyState, Icon, fmtDate } from '../../components/ui'

/**
 * Archiviertes Sitzungsprotokoll (read-only) — Teil des Provenienz-Pakets.
 * Bewusst KEINE Chat-Optik: Hier kann man nicht chatten; die KI schreibt
 * den Verlauf ihrer Research-Session per add_chat_log mit, damit Prüfer
 * nachvollziehen können, wie das Ergebnis entstanden ist.
 */
export default function ChatTab({ state }: { state: ProjectState }) {
  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-4 flex items-start gap-2 rounded-xl border border-sky-200 bg-sky-50 p-3 text-xs leading-relaxed text-sky-800">
        <Icon name="history_edu" className="icon-sm mt-0.5 shrink-0" />
        <p>
          <strong>Archiviertes Sitzungsprotokoll — nur Ansicht.</strong> Die Unterhaltung mit deiner KI führst du in deinem KI-Client
          (z.&nbsp;B. Claude Desktop); die KI protokolliert sie hier per <code className="font-mono">add_chat_log</code> als
          Provenienz-Beleg. Das Protokoll wandert mit in den Export, damit nachvollziehbar bleibt, wie die Research entstanden ist.
        </p>
      </div>

      {state.chatMessages.length === 0 ? (
        <EmptyState
          icon="history_edu"
          title="Kein Sitzungsprotokoll vorhanden"
          hint="Bitte deine KI zu Beginn der Research, den Dialog über add_chat_log mitzuprotokollieren — inklusive Modell und Provider."
        />
      ) : (
        <Card className="divide-y divide-slate-100">
          {state.chatMessages.map((m) => (
            <div key={m.id} className="flex gap-3 px-4 py-3">
              <span
                className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${
                  m.role === 'user'
                    ? 'bg-slate-100 text-slate-500'
                    : m.role === 'assistant'
                      ? 'bg-(--color-accent-50) text-(--color-accent-700)'
                      : 'bg-violet-50 text-violet-500'
                }`}
              >
                <Icon name={m.role === 'user' ? 'person' : m.role === 'assistant' ? 'smart_toy' : 'settings'} className="icon-sm" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="mb-1 flex flex-wrap items-center gap-1.5 text-[11px] text-slate-400">
                  {m.turn_index != null && <span className="font-mono">#{m.turn_index}</span>}
                  <span className="font-medium uppercase tracking-wide text-slate-500">{m.role}</span>
                  {m.model_id && <Badge tone="slate">{m.model_id}</Badge>}
                  {m.provider && <span>{m.provider}</span>}
                  <span>{fmtDate(m.created_at)}</span>
                </div>
                <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-700">{m.content}</p>
              </div>
            </div>
          ))}
        </Card>
      )}
    </div>
  )
}
