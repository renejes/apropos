import { useEffect, useState } from 'react'
import type { EventLogEntry } from '../../../../shared/types'
import { Card, EmptyState, Icon, fmtDate } from '../../components/ui'

const EVENT_ICONS: Record<string, string> = {
  'project.created': 'create_new_folder',
  'source.added': 'add_link',
  'source.checked': 'rule',
  'source.human_signoff': 'verified',
  'source.status_changed': 'sync_alt',
  'extraction.added': 'text_snippet',
  'claim.added': 'fact_check',
  'claim.linked': 'link',
  'report.version_added': 'description',
  'chat.logged': 'forum',
  'verify.deterministic_pass': 'rule_folder',
  'verify.item_served': 'visibility',
  'link.verification_set': 'task_alt',
  'export.markdown': 'download',
}

/** Append-only Audit-Trail: wer (Mensch/welche KI) hat wann was eingetragen. */
export default function AuditTab({ projectId }: { projectId: string }) {
  const [events, setEvents] = useState<EventLogEntry[]>([])

  useEffect(() => {
    const load = () => void window.api.listEvents(projectId).then(setEvents)
    load()
    // Review-Finding: Audit-Trail live halten statt nur beim Mount zu laden
    const t = setInterval(load, 5000)
    return () => clearInterval(t)
  }, [projectId])

  if (events.length === 0) return <EmptyState icon="history" title="Noch keine Ereignisse" />

  return (
    <Card className="mx-auto max-w-3xl divide-y divide-hairline">
      {events.map((e) => (
        <div key={e.seq} className="flex items-start gap-3 px-4 py-2.5">
          <Icon name={EVENT_ICONS[e.event_type] ?? 'circle'} className="icon-sm mt-0.5 text-muted" />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-baseline gap-x-2 text-sm">
              <span className="font-medium">{e.event_type}</span>
              <span className="text-xs text-muted">
                #{e.seq} · {fmtDate(e.created_at)} · <span className="font-mono">{e.actor}</span>
              </span>
            </div>
            <PayloadPreview json={e.payload_json} />
          </div>
        </div>
      ))}
    </Card>
  )
}

function PayloadPreview({ json }: { json: string }) {
  try {
    const obj = JSON.parse(json) as Record<string, unknown>
    const entries = Object.entries(obj).filter(([, v]) => v != null)
    if (entries.length === 0) return null
    return (
      <div className="mt-0.5 truncate text-xs text-muted">
        {entries
          .slice(0, 4)
          .map(([k, v]) => `${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`)
          .join(' · ')}
      </div>
    )
  } catch {
    return null
  }
}
