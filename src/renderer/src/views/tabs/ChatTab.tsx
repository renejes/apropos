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
      <div className="mb-4 flex items-start gap-2 border border-info bg-info-bg p-3 text-xs leading-relaxed text-info">
        <Icon name="history_edu" className="icon-sm mt-0.5 shrink-0" />
        <p>
          <strong>Archiviertes Sitzungsprotokoll — nur Ansicht.</strong> Der Live-Chat mit dem Cursor-Agenten läuft links im
          Projektfenster. Was die KI hier per <code className="font-mono">add_chat_log</code> mitprotokolliert, ist der
          Provenienz-Beleg für den Export — kein zweiter Chat.
        </p>
      </div>

      {state.chatMessages.length === 0 ? (
        <EmptyState
          icon="history_edu"
          title="Kein Sitzungsprotokoll vorhanden"
          hint="Bitte deine KI zu Beginn der Research, den Dialog über add_chat_log mitzuprotokollieren — inklusive Modell und Provider."
        />
      ) : (
        <Card className="divide-y divide-hairline">
          {state.chatMessages.map((m) => (
            <div key={m.id} className="px-4 py-3">
              <div className="mb-1 flex flex-wrap items-center gap-1.5 font-mono text-[11px] text-muted">
                {m.turn_index != null && <span>#{m.turn_index}</span>}
                <span className="uppercase tracking-[0.08em]">{m.role}</span>
                {m.model_id && <Badge tone="slate">{m.model_id}</Badge>}
                {m.provider && <span>{m.provider}</span>}
                <span>{fmtDate(m.created_at)}</span>
              </div>
              <p className="whitespace-pre-wrap text-sm leading-relaxed">{m.content}</p>
            </div>
          ))}
        </Card>
      )}
    </div>
  )
}
