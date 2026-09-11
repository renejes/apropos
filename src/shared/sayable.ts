import type { CarrierProfile, ClaimSourceLink, ProjectState, Source } from './types'

/**
 * Lesart „Was darfst du sagen“ — kein neues Wahrheits-Flag.
 * Grün: signiert und Quote ok. Gelb: belegt, unsigniert. Rot: Contrast, Flag, Lücke, Tabu.
 */

export type SayableTone = 'green' | 'yellow' | 'red'

export interface SayableItem {
  id: string
  tone: SayableTone
  title: string
  reason: string
}

function sourceTone(
  s: Source,
  links: ClaimSourceLink[],
  flagged: Set<string>,
  carrierProfile: CarrierProfile | undefined
): SayableTone {
  if (flagged.has(s.id) || links.some((l) => l.source_id === s.id && l.support_type === 'contrasts')) return 'red'
  if (carrierProfile?.review_status === 'rejected') return 'red'
  if (s.review_status === 'human_signed' && s.quote_verified !== 0 && carrierOkForGreen(carrierProfile)) return 'green'
  if (s.quote_verified === 1 && s.review_status !== 'rejected') return 'yellow'
  return 'red'
}

function carrierOkForGreen(profile: CarrierProfile | undefined): boolean {
  if (!profile) return true
  if (profile.review_status === 'human_signed') return true
  if (profile.evidence_basis === 'literature_register' && profile.review_status === 'ai_checked') return true
  return false
}

function reasonFor(
  tone: SayableTone,
  s: Source,
  links: ClaimSourceLink[],
  flagged: Set<string>,
  carrierProfile: CarrierProfile | undefined
): string {
  switch (tone) {
    case 'green':
      return 'human_signed und Quote ok — darf in Blog/Hausarbeit'
    case 'yellow':
      if (carrierProfile && !carrierOkForGreen(carrierProfile)) return 'Träger ungeprüft — intern ok, nicht liefern'
      return 'belegt, unsigniert — intern ok, nicht liefern'
    case 'red':
      if (links.some((l) => l.support_type === 'contrasts')) return 'Widerspruch (contrasts)'
      if (flagged.has(s.id)) return 'Unsicherheits-Flag'
      if (carrierProfile?.review_status === 'rejected') return 'Träger abgelehnt'
      return 'Lücke oder unsigniert'
    default: {
      const _exhaustive: never = tone
      return _exhaustive
    }
  }
}

export function sayableItems(state: ProjectState): SayableItem[] {
  const flagged = new Set(state.uncertaintyFlags.filter((f) => f.entity_type === 'source').map((f) => f.entity_id))
  const profileByCarrier = new Map(state.carrierProfiles.map((p) => [p.carrier_id, p]))
  const items: SayableItem[] = []
  if (state.researchBrief?.taboos) {
    items.push({
      id: 'brief-taboos',
      tone: 'red',
      title: 'Nicht behaupten (Brief)',
      reason: state.researchBrief.taboos,
    })
  }
  for (const s of state.sources.filter((x) => x.review_status !== 'rejected')) {
    const links = state.links.filter((l) => l.source_id === s.id)
    const carrierProfile = s.carrier_id ? profileByCarrier.get(s.carrier_id) : undefined
    const tone = sourceTone(s, links, flagged, carrierProfile)
    items.push({ id: s.id, tone, title: s.title, reason: reasonFor(tone, s, links, flagged, carrierProfile) })
  }
  return items
}
