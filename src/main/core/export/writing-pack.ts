import { mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { z } from 'zod'
import type { Repo } from '../repo'
import { ServiceError } from '../services/research'
import { exportBibliography } from '../services/biblio'
import { graphToSvg } from './graph-svg'
import { graphToJpeg } from './graph-jpeg'
import { appDataDir } from '../paths'
import { renderBericht, renderClaimsMd, renderDoNotClaim, resolveWritingScope } from './pack-content'

export const writingPackSchema = z
  .object({
    project_id: z.string().min(1),
    visual_version_id: z.string().min(1).optional(),
    scope: z.enum(['marked']).optional(),
    jpeg_base64: z.string().optional(),
    out_dir: z.string().optional(),
  })
  .superRefine((v, ctx) => {
    if (!v.visual_version_id && v.scope !== 'marked') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Schreibpaket braucht visual_version_id oder scope=marked — kein Rohdump des ganzen Projekts.',
      })
    }
  })

export function defaultExportRoot(): string {
  if (process.env.ROP_EXPORT_ROOT) return process.env.ROP_EXPORT_ROOT
  return join(appDataDir(), 'research-export')
}

function parseOrThrow<T extends z.ZodTypeAny>(schema: T, input: unknown, code: string): z.infer<T> {
  const parsed = schema.safeParse(input)
  if (!parsed.success) {
    const detail = parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ')
    throw new ServiceError(code, `Eingabe ungültig — ${detail}`, 'Korrigiere GENAU die oben genannten Felder und rufe dasselbe Werkzeug erneut auf.')
  }
  return parsed.data
}

export interface WritingPackResult {
  dir: string
  files: string[]
  source_ids: string[]
  claim_ids: string[]
  scope: string
}

export function writeWritingPack(repo: Repo, rawInput: unknown, actor: string): WritingPackResult {
  const input = parseOrThrow(writingPackSchema, rawInput, 'pack_invalid')
  const packed = resolveWritingScope(repo, input)

  const root = input.out_dir ?? join(defaultExportRoot(), input.project_id, packed.scopeLabel)
  mkdirSync(root, { recursive: true })

  const files: string[] = []
  const write = (name: string, body: string | Buffer) => {
    writeFileSync(join(root, name), body)
    files.push(name)
  }

  const briefMd = packed.state.researchBrief?.markdown ?? '# Research-Plan\n\n_Kein adoptierter Brief._\n'
  write('RESEARCH-PLAN.md', briefMd)
  write('references.bib', exportBibliography(repo, input.project_id, packed.sources.map((s) => s.id)))
  write('claims.md', renderClaimsMd(packed.state, packed.claimIds, packed.sources))
  write('bericht.md', renderBericht(packed.state, packed.claims, packed.sources, packed.visualVersionId))
  write('do-not-claim.md', renderDoNotClaim(packed.state, packed.sources))

  if (packed.graph) {
    const svg = graphToSvg(packed.graph)
    write(`karte-${packed.scopeLabel}.svg`, svg)
    const jpeg = input.jpeg_base64 ? Buffer.from(input.jpeg_base64, 'base64') : graphToJpeg(packed.graph)
    write(`karte-${packed.scopeLabel}.jpg`, jpeg)
  }

  repo.logEvent(input.project_id, actor, 'export.writing_pack', { dir: root, scope: packed.scopeLabel, files })
  return {
    dir: root,
    files,
    source_ids: packed.sourceIds,
    claim_ids: packed.claimIds,
    scope: packed.scopeLabel,
  }
}
