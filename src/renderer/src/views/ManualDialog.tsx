import { useEffect, useId, useRef, useState } from 'react'
import { Button } from '../components/ui'
import { MANUAL_SECTIONS } from '../manual/sections'

export default function ManualDialog({ onClose }: { onClose: () => void }) {
  const titleId = useId()
  const scroller = useRef<HTMLElement>(null)
  const [active, setActive] = useState(MANUAL_SECTIONS[0]?.id ?? '')

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const scrollTo = (id: string) => {
    setActive(id)
    const root = scroller.current
    const el = document.getElementById(`manual-${id}`)
    if (!root || !el) return
    root.scrollTo({ top: el.offsetTop, behavior: 'smooth' })
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-fg/30 p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="flex h-[min(90vh,52rem)] w-full max-w-5xl border border-line bg-bg"
        onClick={(e) => e.stopPropagation()}
      >
        <nav className="flex w-52 shrink-0 flex-col border-r border-hairline">
          <div className="border-b border-hairline px-4 py-3">
            <div id={titleId} className="font-mono text-[11px] uppercase tracking-[0.08em] text-muted">
              Manual
            </div>
            <p className="mt-0.5 text-sm">Research Overview</p>
          </div>
          <ul className="min-h-0 flex-1 overflow-y-auto py-2">
            {MANUAL_SECTIONS.map((section) => (
              <li key={section.id}>
                <button
                  type="button"
                  onClick={() => scrollTo(section.id)}
                  className={`w-full px-4 py-1.5 text-left text-sm ${
                    active === section.id ? 'bg-fg text-bg' : 'text-muted hover:bg-fg hover:text-bg'
                  }`}
                >
                  {section.title}
                </button>
              </li>
            ))}
          </ul>
        </nav>

        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex shrink-0 items-center justify-between border-b border-hairline px-6 py-3">
            <p className="text-sm text-muted">Menüleiste → Manual · Tastatur ⌘/</p>
            <Button variant="ghost" onClick={onClose} title="Schließen">
              Schließen
            </Button>
          </div>
          <article
            ref={scroller}
            className="relative min-h-0 flex-1 overflow-y-auto px-8 py-6"
            onScroll={(e) => {
              const root = e.currentTarget
              const top = root.getBoundingClientRect().top
              let current = MANUAL_SECTIONS[0]?.id ?? ''
              for (const section of MANUAL_SECTIONS) {
                const el = document.getElementById(`manual-${section.id}`)
                if (!el) continue
                if (el.getBoundingClientRect().top - top <= 96) current = section.id
              }
              setActive(current)
            }}
          >
            {MANUAL_SECTIONS.map((section) => (
              <section key={section.id} id={`manual-${section.id}`} className="mb-10 scroll-mt-4">
                <h2 className="text-lg">{section.title}</h2>
                {section.body}
              </section>
            ))}
          </article>
        </div>
      </div>
    </div>
  )
}
