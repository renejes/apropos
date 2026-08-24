import React from 'react'
import type { ReviewStatus } from '../../../shared/types'

/** Chrome wie Easy Writing: Linie, Invert, keine Schatten. Farbe nur am Status. */

export function Icon({ name, className = '' }: { name: string; className?: string }) {
  return (
    <span aria-hidden="true" className={`material-symbols-rounded ${className}`}>
      {name}
    </span>
  )
}

export function Button({
  children,
  onClick,
  variant = 'default',
  icon,
  disabled,
  title,
  type = 'button',
}: {
  children?: React.ReactNode
  onClick?: () => void
  variant?: 'default' | 'primary' | 'danger' | 'ghost'
  icon?: string
  disabled?: boolean
  title?: string
  type?: 'button' | 'submit'
}) {
  const styles: Record<string, string> = {
    default: 'border-line bg-bg text-fg hover:bg-fg hover:text-bg',
    primary: 'border-line bg-fg text-bg hover:bg-bg hover:text-fg',
    danger: 'border-bad text-bad hover:bg-bad hover:text-bg',
    ghost: 'border-transparent text-muted hover:text-fg hover:border-hairline',
  }
  const isIconOnly = !children && !!icon
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={isIconOnly ? (title ?? icon) : undefined}
      className={`inline-flex items-center gap-1.5 border px-2.5 py-1 text-sm disabled:cursor-not-allowed disabled:opacity-40 ${styles[variant]}`}
    >
      {icon && <Icon name={icon} className="icon-sm" />}
      {children}
    </button>
  )
}

export function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <div className={`border border-hairline bg-bg ${className}`}>{children}</div>
}

export function Badge({
  children,
  tone = 'slate',
}: {
  children: React.ReactNode
  tone?: 'slate' | 'emerald' | 'amber' | 'red' | 'sky' | 'violet'
  /** Ignoriert — Statusfarbe trägt die Bedeutung, nicht das Icon. */
  icon?: string
}) {
  const tones: Record<string, string> = {
    slate: 'border-hairline text-muted',
    emerald: 'border-ok bg-ok-bg text-ok',
    amber: 'border-warn bg-warn-bg text-warn',
    red: 'border-bad bg-bad-bg text-bad',
    sky: 'border-info bg-info-bg text-info',
    violet: 'border-line text-fg',
  }
  return (
    <span className={`inline-flex items-center border px-1.5 py-px text-xs ${tones[tone]}`}>{children}</span>
  )
}

export function statusBadge(status: ReviewStatus): React.ReactElement {
  switch (status) {
    case 'pending':
      return <Badge tone="amber">offen</Badge>
    case 'ai_checked':
      return <Badge tone="sky">KI-geprüft</Badge>
    case 'human_signed':
      return <Badge tone="emerald">freigegeben</Badge>
    case 'rejected':
      return <Badge tone="red">abgelehnt</Badge>
    default: {
      const _never: never = status
      return _never
    }
  }
}

export function quoteBadge(quoteVerified: 0 | 1 | null, score: number | null): React.ReactElement {
  if (quoteVerified === 1)
    return (
      <Badge tone="emerald">
        Beleg{score != null && score < 1 ? ` ${Math.round(score * 100)} %` : ''}
      </Badge>
    )
  if (quoteVerified === 0) return <Badge tone="red">Beleg fehlt</Badge>
  return <Badge tone="slate">ungeprüft</Badge>
}

export function EmptyState({ icon, title, hint }: { icon: string; title: string; hint?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-16 text-center text-muted">
      <Icon name={icon} className="icon-lg" />
      <div className="text-sm text-fg">{title}</div>
      {hint && <div className="max-w-md text-xs">{hint}</div>}
    </div>
  )
}

export function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h3 className="mb-2 font-mono text-[11px] uppercase tracking-[0.08em] text-muted">{children}</h3>
}

export function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' })
  } catch {
    return iso
  }
}
