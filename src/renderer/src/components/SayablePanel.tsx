import type { ProjectState } from '../../../shared/types'
import { sayableItems, type SayableTone } from '../../../shared/sayable'
import { Card, SectionTitle } from './ui'

const TONE: Record<SayableTone, string> = {
  green: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  yellow: 'border-amber-200 bg-amber-50 text-amber-800',
  red: 'border-red-200 bg-red-50 text-red-800',
}

export default function SayablePanel({ state }: { state: ProjectState }) {
  const items = sayableItems(state)
  if (items.length === 0) return null
  return (
    <Card className="p-5">
      <SectionTitle>Was darfst du sagen</SectionTitle>
      <p className="mb-3 text-xs text-slate-500">
        Kein neues Wahrheits-Flag — Grün ist signiert, Gelb belegt aber unsigniert, Rot Widerspruch/Flag/Lücke/Tabu.
      </p>
      <ul className="space-y-2">
        {items.map((it) => (
          <li key={it.id} className={`rounded-lg border px-3 py-2 text-sm ${TONE[it.tone]}`}>
            <span className="font-medium">{it.title}</span>
            <span className="mt-0.5 block text-xs opacity-80">{it.reason}</span>
          </li>
        ))}
      </ul>
    </Card>
  )
}
