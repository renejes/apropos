import React from 'react'
import type { ReviewStatus } from '../../../shared/types'

/** Kleine, konsistente UI-Primitives (Tailwind + Material Symbols). */

export function Icon({ name, className = '' }: { name: string; className?: string }) {
  // aria-hidden: Icon-Ligaturen würden sonst als Text vorgelesen (A11y-Finding)
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
    default: 'bg-white border border-slate-300 text-slate-700 hover:bg-slate-50',
    primary: 'bg-(--color-accent-600) text-white hover:bg-(--color-accent-700) border border-transparent',
    danger: 'bg-white border border-red-300 text-red-700 hover:bg-red-50',
    ghost: 'bg-transparent text-slate-600 hover:bg-slate-100 border border-transparent',
  }
  const isIconOnly = !children && !!icon
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      title={title}
      // Icon-only-Buttons brauchen einen zugänglichen Namen (A11y-Finding)
      aria-label={isIconOnly ? (title ?? icon) : undefined}
      className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${styles[variant]}`}
    >
      {icon && <Icon name={icon} className="icon-sm" />}
      {children}
    </button>
  )
}

export function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <div className={`rounded-xl border border-slate-200 bg-white shadow-sm ${className}`}>{children}</div>
}

export function Badge({
  children,
  tone = 'slate',
  icon,
}: {
  children: React.ReactNode
  tone?: 'slate' | 'emerald' | 'amber' | 'red' | 'sky' | 'violet'
  icon?: string
}) {
  const tones: Record<string, string> = {
    slate: 'bg-slate-100 text-slate-700',
    emerald: 'bg-emerald-100 text-emerald-800',
    amber: 'bg-amber-100 text-amber-800',
    red: 'bg-red-100 text-red-700',
    sky: 'bg-sky-100 text-sky-800',
    violet: 'bg-violet-100 text-violet-800',
  }
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${tones[tone]}`}>
      {icon && <Icon name={icon} className="!text-[14px]" />}
      {children}
    </span>
  )
}

export function statusBadge(status: ReviewStatus): React.ReactElement {
  switch (status) {
    case 'pending':
      return (
        <Badge tone="amber" icon="schedule">
          offen
        </Badge>
      )
    case 'ai_checked':
      return (
        <Badge tone="sky" icon="neurology">
          KI-geprüft
        </Badge>
      )
    case 'human_signed':
      return (
        <Badge tone="emerald" icon="verified">
          freigegeben
        </Badge>
      )
    case 'rejected':
      return (
        <Badge tone="red" icon="block">
          abgelehnt
        </Badge>
      )
  }
}

export function quoteBadge(quoteVerified: 0 | 1 | null, score: number | null): React.ReactElement {
  if (quoteVerified === 1)
    return (
      <Badge tone="emerald" icon="check_circle">
        Beleg ✓{score != null && score < 1 ? ` (${Math.round(score * 100)} %)` : ''}
      </Badge>
    )
  if (quoteVerified === 0)
    return (
      <Badge tone="red" icon="cancel">
        Beleg fehlt
      </Badge>
    )
  return (
    <Badge tone="slate" icon="help">
      ungeprüft
    </Badge>
  )
}

export function EmptyState({ icon, title, hint }: { icon: string; title: string; hint?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-16 text-center text-slate-400">
      <Icon name={icon} className="icon-lg" />
      <div className="text-sm font-medium text-slate-500">{title}</div>
      {hint && <div className="max-w-md text-xs">{hint}</div>}
    </div>
  )
}

export function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">{children}</h3>
}

export function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' })
  } catch {
    return iso
  }
}
