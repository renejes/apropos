import type { ProjectState } from '../../../../shared/types'
import { Badge, Card, EmptyState, Icon } from '../../components/ui'

/**
 * Aussagen (Claims) mit ihren Belegkanten und Verifikationsstatus je Kante.
 * Belegkanten sind klickbar und springen zur Quelle im Quellen-Tab —
 * dort findet auch der menschliche Sign-off statt.
 */
export default function ClaimsTab({ state, onOpenSource }: { state: ProjectState; onOpenSource: (sourceId: string) => void }) {
  if (state.claims.length === 0) {
    return (
      <EmptyState
        icon="fact_check"
        title="Noch keine Aussagen verknüpft"
        hint="Die KI verknüpft Berichts-Aussagen über link_claim_to_source mit Quellen und Belegstellen — inklusive widersprechender Quellen (contrasts)."
      />
    )
  }

  const sourceIndex = new Map(state.sources.map((s, i) => [s.id, i + 1]))

  return (
    <div className="mx-auto max-w-4xl space-y-3">
      <p className="flex items-center gap-1.5 text-xs text-muted">
        <Icon name="info" className="!text-[14px]" />
        Diese Ansicht zeigt, welche Berichts-Aussagen auf welchen Belegen ruhen. Belegkante anklicken → Quelle öffnen und dort reviewen.
      </p>
      {state.claims.map((claim) => {
        const links = state.links.filter((l) => l.claim_id === claim.id)
        return (
          <Card key={claim.id} className="p-4">
            <div className="flex items-start gap-2">
              <Icon name="format_quote" className="mt-0.5 text-muted" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium leading-snug">{claim.claim_text}</p>
                {claim.report_section && <div className="mt-0.5 text-xs text-muted">Abschnitt: {claim.report_section}</div>}

                <div className="mt-3 space-y-2">
                  {links.length === 0 && (
                    <div className="flex items-center gap-1.5 text-xs text-bad">
                      <Icon name="warning" className="!text-[15px]" /> Unbelegt — keine Quelle verknüpft
                    </div>
                  )}
                  {links.map((link) => {
                    const src = state.sources.find((s) => s.id === link.source_id)
                    return (
                      <button
                        key={link.id}
                        onClick={() => onOpenSource(link.source_id)}
                        disabled={!src}
                        title={src ? 'Quelle im Quellen-Tab öffnen' : 'Quelle nicht in diesem Projekt'}
                        className="group w-full border border-hairline p-2.5 text-left hover:border-line disabled:cursor-not-allowed"
                      >
                        <div className="flex flex-wrap items-center gap-1.5 text-xs">
                          <Badge tone="slate">[S{sourceIndex.get(link.source_id) ?? '?'}]</Badge>
                          <span className="truncate font-medium text-muted">{src?.title ?? link.source_id}</span>
                          <SupportBadge type={link.support_type} />
                          <VerificationBadge status={link.verification_status} />
                          {link.confidence && <span className="text-muted">Konfidenz: {link.confidence}</span>}
                          <Icon
                            name="open_in_new"
                            className="!text-[14px] ml-auto text-muted transition-colors group-hover:text-fg"
                          />
                        </div>
                        <div className="mt-1.5 text-xs italic text-muted">„{link.quote_span}“</div>
                      </button>
                    )
                  })}
                </div>
              </div>
            </div>
          </Card>
        )
      })}
    </div>
  )
}

function SupportBadge({ type }: { type: 'supports' | 'contrasts' | 'mentions' }) {
  if (type === 'supports')
    return (
      <Badge tone="emerald" icon="thumb_up">
        stützt
      </Badge>
    )
  if (type === 'contrasts')
    return (
      <Badge tone="red" icon="thumb_down">
        widerspricht
      </Badge>
    )
  return (
    <Badge tone="slate" icon="remove">
      erwähnt
    </Badge>
  )
}

function VerificationBadge({ status }: { status: string }) {
  switch (status) {
    case 'supported':
      return (
        <Badge tone="emerald" icon="check_circle">
          verifiziert
        </Badge>
      )
    case 'partial':
      return (
        <Badge tone="amber" icon="incomplete_circle">
          teilweise
        </Badge>
      )
    case 'unsupported':
      return (
        <Badge tone="red" icon="cancel">
          nicht gestützt
        </Badge>
      )
    case 'source_unreachable':
      return (
        <Badge tone="slate" icon="public_off">
          Quelle unerreichbar
        </Badge>
      )
    default:
      return (
        <Badge tone="amber" icon="schedule">
          Verifikation offen
        </Badge>
      )
  }
}
