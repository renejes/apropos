import type { ProjectState } from '../../../shared/types'
import { sayableItems, type SayableTone } from '../../../shared/sayable'
import { Card, SectionTitle } from './ui'

const TONE: Record<SayableTone, string> = {
  green: 'border-ok bg-ok-bg text-ok',
  yellow: 'border-warn bg-warn-bg text-warn',
  red: 'border-bad bg-bad-bg text-bad',
}

export default function SayablePanel({ state }: { state: ProjectState }) {
  const items = sayableItems(state)
  if (items.length === 0) return null
  return (
    <Card className="p-5">
      <SectionTitle>Was darfst du sagen</SectionTitle>
      <p className="mb-3 text-xs text-muted">
        Kein neues Wahrheits-Flag — Grün ist signiert, Gelb belegt aber unsigniert, Rot Widerspruch/Flag/Lücke/Tabu.
      </p>
      <ul className="space-y-2">
        {items.map((it) => (
          <li key={it.id} className={`border px-3 py-2 text-sm ${TONE[it.tone]}`}>
            <span className="font-medium">{it.title}</span>
            <span className="mt-0.5 block text-xs opacity-80">{it.reason}</span>
          </li>
        ))}
      </ul>
    </Card>
  )
}
