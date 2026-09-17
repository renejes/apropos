import { useEffect, useMemo, useState, type ReactNode } from 'react'
import type {
  BriefDeliverable,
  BriefDiscipline,
  Project,
  ProjectState,
  ProjectSummary,
  ResearchBrief,
  ResearchBriefFields,
  ResearchFrame,
  SearchNextAction,
} from '../../../../shared/types'
import { buildPlanSteps } from '../../../../shared/plan'
import { groupSearchWaves, nextActionLabel } from '../../../../shared/search-waves'
import { Badge, Button, Card, EmptyState, SectionTitle, fmtDate } from '../../components/ui'
import CoveragePanel from '../../components/CoveragePanel'

type FormState = {
  deliverable: BriefDeliverable
  audience: string
  goal: string
  frames: ResearchFrame[]
  inclusion: string
  exclusion: string
  sub_questions: string[]
  stop_rule: string
  taboos: string
  year_from: string
  year_to: string
  min_empirical: string
  discipline: BriefDiscipline | ''
}

function emptyForm(project: Project): FormState {
  return {
    deliverable: project.mode === 'academic' ? 'academic' : 'blog',
    audience: '',
    goal: '',
    frames: [
      { key: 'a', label: '', chosen: true },
      { key: 'b', label: '', chosen: false },
    ],
    inclusion: '',
    exclusion: '',
    sub_questions: ['', '', ''],
    stop_rule: '',
    taboos: '',
    year_from: '',
    year_to: '',
    min_empirical: '',
    discipline: '',
  }
}

function formFromBrief(brief: ResearchBrief): FormState {
  const frames =
    brief.frames.length >= 2
      ? brief.frames.map((f) => ({ ...f, chosen: f.key === brief.chosen_frame_key || f.chosen }))
      : emptyForm({ mode: 'academic' } as Project).frames
  return {
    deliverable: brief.deliverable,
    audience: brief.audience,
    goal: brief.goal,
    frames,
    inclusion: brief.inclusion,
    exclusion: brief.exclusion,
    sub_questions: brief.sub_questions.length >= 3 ? [...brief.sub_questions] : [...brief.sub_questions, '', '', ''].slice(0, 3),
    stop_rule: brief.stop_rule,
    taboos: brief.taboos,
    year_from: brief.year_from != null ? String(brief.year_from) : '',
    year_to: brief.year_to != null ? String(brief.year_to) : '',
    min_empirical: brief.min_empirical != null ? String(brief.min_empirical) : '',
    discipline: brief.discipline ?? '',
  }
}

function fieldsFromForm(form: FormState): ResearchBriefFields {
  const chosen = form.frames.find((f) => f.chosen)?.key
  return {
    deliverable: form.deliverable,
    audience: form.audience.trim(),
    goal: form.goal.trim(),
    frames: form.frames.map((f) => ({ key: f.key, label: f.label.trim(), chosen: f.chosen })),
    chosen_frame_key: chosen,
    inclusion: form.inclusion.trim(),
    exclusion: form.exclusion.trim(),
    sub_questions: form.sub_questions.map((q) => q.trim()).filter(Boolean),
    stop_rule: form.stop_rule.trim(),
    taboos: form.taboos.trim(),
    year_from: form.year_from.trim() ? Number(form.year_from) : null,
    year_to: form.year_to.trim() ? Number(form.year_to) : null,
    min_empirical: form.min_empirical.trim() ? Number(form.min_empirical) : null,
    discipline: form.discipline || null,
  }
}

function statusBadge(brief: ResearchBrief | null, pending: ResearchBrief | null) {
  if (pending) return <Badge tone="amber">neuer Entwurf</Badge>
  if (!brief) return <Badge tone="slate">kein Plan</Badge>
  if (brief.status === 'adopted') return <Badge tone="emerald">bindend</Badge>
  return <Badge tone="amber">Entwurf</Badge>
}

function actionTone(action: SearchNextAction): 'amber' | 'sky' | 'emerald' {
  switch (action) {
    case 'search':
      return 'amber'
    case 'read':
      return 'sky'
    case 'enough':
      return 'emerald'
    default: {
      const _never: never = action
      return _never
    }
  }
}

export default function PlanTab({
  state,
  onReload,
  onOpenSource,
  onOpenProject,
}: {
  state: ProjectState
  onReload: () => void
  onOpenSource?: (sourceId: string) => void
  onOpenProject?: (id: string) => void
}) {
  const pending = state.pendingBriefDraft
  const binding = state.researchBrief
  const [showPending, setShowPending] = useState(true)
  const displayed = pending && showPending ? pending : binding
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState<FormState>(() => emptyForm(state.project))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const steps = useMemo(() => buildPlanSteps(state), [state])
  const waves = useMemo(
    () => groupSearchWaves(state.searchLog, state.searchReflections),
    [state.searchLog, state.searchReflections]
  )
  const latestWave = [...waves].reverse().find((w) => w.reflection || w.blocksSearch) ?? null
  const coverageKey = state.sources.length + state.subQuestions.length + state.searchReflections.length + state.rounds.length

  const startEdit = (from: ResearchBrief | null) => {
    setForm(from ? formFromBrief(from) : emptyForm(state.project))
    setError(null)
    setEditing(true)
  }

  const save = async (adopt: boolean) => {
    setBusy(true)
    setError(null)
    try {
      await window.api.saveBrief(state.project.id, fieldsFromForm(form), adopt)
      setEditing(false)
      onReload()
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err).replace(/^Error:\s*/, ''))
    } finally {
      setBusy(false)
    }
  }

  const adoptDisplayed = async () => {
    if (!displayed || displayed.status === 'adopted') return
    setBusy(true)
    setError(null)
    try {
      await window.api.adoptBrief(state.project.id, displayed.id)
      setShowPending(false)
      onReload()
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err).replace(/^Error:\s*/, ''))
    } finally {
      setBusy(false)
    }
  }

  if (editing) {
    return (
      <BriefEditor
        form={form}
        setForm={setForm}
        busy={busy}
        error={error}
        hasExisting={!!displayed}
        onCancel={() => {
          setEditing(false)
          setError(null)
        }}
        onSaveDraft={() => void save(false)}
        onSaveAdopt={() => void save(true)}
      />
    )
  }

  if (!displayed) {
    return (
      <div className="flex h-full min-h-0 flex-col overflow-y-auto p-6">
        <EmptyState
          icon="checklist"
          title="Noch kein Plan"
          hint="Im Chat „Research starten“. Der Agent hinterlegt das Briefing hier. Du kannst es lesen, bestätigen und jederzeit nachschärfen."
        />
        <div className="flex justify-center">
          <Button variant="primary" icon="edit_note" onClick={() => startEdit(null)}>
            Von Hand beginnen
          </Button>
        </div>
        <div className="mx-auto mt-8 w-full max-w-2xl space-y-6">
          <StepList steps={steps} />
          <SeedFilesCard state={state} onReload={onReload} />
          <RelatedResearchCard state={state} onReload={onReload} onOpenProject={onOpenProject} />
        </div>
      </div>
    )
  }

  return (
    <div className="h-full min-h-0 overflow-y-auto p-5">
      <div className="mx-auto max-w-3xl space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-sm font-medium">Research-Plan</h2>
              {statusBadge(binding, pending)}
            </div>
            <p className="mt-1 text-xs text-muted">
              {displayed.status === 'adopted'
                ? `Bindend seit ${displayed.adopted_at ? fmtDate(displayed.adopted_at) : fmtDate(displayed.created_at)}`
                : `Entwurf von ${fmtDate(displayed.created_at)} — Suche wartet auf deine Bestätigung.`}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {displayed.status === 'draft' && (
              <Button variant="primary" icon="verified" onClick={() => void adoptDisplayed()} disabled={busy}>
                Plan bestätigen
              </Button>
            )}
            <Button icon="edit" onClick={() => startEdit(displayed)} disabled={busy}>
              Bearbeiten
            </Button>
          </div>
        </div>

        {pending && (
          <div className="border border-warn bg-warn-bg px-3 py-2 text-sm">
            Die KI hat einen neuen Entwurf hinterlegt. Der bindende Plan gilt, bis du bestätigst.
            <div className="mt-2 flex flex-wrap gap-2">
              <button type="button" className="text-xs underline decoration-dotted" onClick={() => setShowPending(true)}>
                Entwurf zeigen
              </button>
              <button type="button" className="text-xs underline decoration-dotted" onClick={() => setShowPending(false)}>
                Bindenden Plan zeigen
              </button>
            </div>
          </div>
        )}

        {error && <div className="border border-warn bg-warn-bg px-3 py-2 text-sm text-warn">{error}</div>}

        <Card className="p-4">
          <SectionTitle>Stand</SectionTitle>
          <StepList steps={steps} />
        </Card>

        <SeedFilesCard state={state} onReload={onReload} />
        <RelatedResearchCard state={state} onReload={onReload} onOpenProject={onOpenProject} />

        <pre className="whitespace-pre-wrap border border-hairline bg-wash p-4 font-sans text-sm leading-relaxed">{displayed.markdown}</pre>

        {displayed.status === 'adopted' && state.subQuestions.length === 0 && !pending && (
          <p className="text-xs text-muted">
            Teilfragen übernimmt die KI als Nächstes mit plan_research. Danach siehst du hier die Balken.
          </p>
        )}

        <CoveragePanel
          projectId={state.project.id}
          state={state}
          refreshKey={coverageKey}
          onOpenSource={onOpenSource}
        />

        {latestWave && (
          <Card className="p-4">
            <SectionTitle>Letzte Lage</SectionTitle>
            {latestWave.blocksSearch ? (
              <p className="text-sm text-warn">Lage ausstehend — die nächste Suche ist gesperrt, bis die KI die Welle einordnet.</p>
            ) : latestWave.reflection ? (
              <div className="text-sm">
                <div className="mb-1 flex flex-wrap items-center gap-2">
                  <Badge tone={actionTone(latestWave.reflection.next_action)}>
                    {nextActionLabel(latestWave.reflection.next_action)}
                  </Badge>
                  {latestWave.reflection.next_query && (
                    <code className="font-mono text-xs">{latestWave.reflection.next_query}</code>
                  )}
                </div>
                <p>
                  <span className="text-muted">Getroffen: </span>
                  {latestWave.reflection.covered}
                </p>
                <p className="mt-1">
                  <span className="text-muted">Unterrepräsentiert: </span>
                  {latestWave.reflection.underrepresented}
                </p>
              </div>
            ) : null}
          </Card>
        )}
      </div>
    </div>
  )
}

function StepList({ steps }: { steps: ReturnType<typeof buildPlanSteps> }) {
  return (
    <ol className="space-y-1.5">
      {steps.map((step, i) => (
        <li key={step.id} className="flex items-start gap-3 px-1 py-1">
          <span
            className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center border font-mono text-[10px] ${
              step.done ? 'border-ok bg-ok text-bg' : 'border-hairline text-muted'
            }`}
          >
            {step.done ? '✓' : i + 1}
          </span>
          <div className="min-w-0 flex-1">
            <div className={`text-sm ${step.done ? 'text-muted' : 'text-fg'}`}>{step.label}</div>
            <div className="text-xs text-muted">{step.detail}</div>
          </div>
        </li>
      ))}
    </ol>
  )
}

function BriefEditor({
  form,
  setForm,
  busy,
  error,
  hasExisting,
  onCancel,
  onSaveDraft,
  onSaveAdopt,
}: {
  form: FormState
  setForm: (next: FormState) => void
  busy: boolean
  error: string | null
  hasExisting: boolean
  onCancel: () => void
  onSaveDraft: () => void
  onSaveAdopt: () => void
}) {
  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm({ ...form, [key]: value })

  return (
    <div className="h-full min-h-0 overflow-y-auto p-5">
      <div className="mx-auto max-w-3xl">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-medium">{hasExisting ? 'Plan bearbeiten' : 'Plan von Hand'}</h2>
          <div className="flex flex-wrap gap-2">
            <Button onClick={onCancel} disabled={busy}>
              Abbrechen
            </Button>
            <Button onClick={onSaveDraft} disabled={busy}>
              Als Entwurf speichern
            </Button>
            <Button variant="primary" icon="verified" onClick={onSaveAdopt} disabled={busy}>
              Bestätigen
            </Button>
          </div>
        </div>
        <p className="mb-4 text-xs leading-relaxed text-muted">
          Speichern legt eine neue Fassung an, nichts wird überschrieben. Bestätigen macht den Plan bindend — danach darf
          die KI suchen. Teilfragen in der operativen Liste ändert die KI mit plan_research.
        </p>
        {error && <div className="mb-4 border border-warn bg-warn-bg px-3 py-2 text-sm text-warn">{error}</div>}

        <Field label="Lieferform">
          <select
            className="field w-full text-sm"
            value={form.deliverable}
            onChange={(e) => set('deliverable', e.target.value as BriefDeliverable)}
          >
            <option value="blog">Blog</option>
            <option value="academic">Wissenschaftliche Arbeit</option>
            <option value="both">Beides</option>
          </select>
        </Field>
        <Field label="Adressat">
          <input className="field w-full text-sm" value={form.audience} onChange={(e) => set('audience', e.target.value)} />
        </Field>
        <Field label="Ziel in einem Satz">
          <textarea className="field w-full text-sm" rows={3} value={form.goal} onChange={(e) => set('goal', e.target.value)} />
        </Field>
        <Field label="Blickwinkel (einen wählen)">
          <div className="space-y-2">
            {form.frames.map((frame, i) => (
              <div key={frame.key} className="flex items-start gap-2">
                <input
                  type="radio"
                  name="chosen-frame"
                  className="mt-2"
                  checked={frame.chosen}
                  onChange={() =>
                    set(
                      'frames',
                      form.frames.map((f, j) => ({ ...f, chosen: j === i }))
                    )
                  }
                />
                <input
                  className="field w-full text-sm"
                  value={frame.label}
                  placeholder={`Blickwinkel ${i + 1}`}
                  onChange={(e) =>
                    set(
                      'frames',
                      form.frames.map((f, j) => (j === i ? { ...f, label: e.target.value } : f))
                    )
                  }
                />
              </div>
            ))}
            {form.frames.length < 3 && (
              <button
                type="button"
                className="text-xs text-muted underline decoration-dotted"
                onClick={() =>
                  set('frames', [...form.frames, { key: form.frames.length === 2 ? 'c' : `f${form.frames.length + 1}`, label: '', chosen: false }])
                }
              >
                Dritten Blickwinkel hinzufügen
              </button>
            )}
          </div>
        </Field>
        <Field label="Einschluss">
          <textarea className="field w-full text-sm" rows={2} value={form.inclusion} onChange={(e) => set('inclusion', e.target.value)} />
        </Field>
        <Field label="Ausschluss">
          <textarea className="field w-full text-sm" rows={2} value={form.exclusion} onChange={(e) => set('exclusion', e.target.value)} />
        </Field>
        <Field label="Teilfragen">
          <div className="space-y-2">
            {form.sub_questions.map((q, i) => (
              <div key={i} className="flex gap-2">
                <textarea
                  className="field w-full text-sm"
                  rows={2}
                  value={q}
                  onChange={(e) =>
                    set(
                      'sub_questions',
                      form.sub_questions.map((item, j) => (j === i ? e.target.value : item))
                    )
                  }
                />
                {form.sub_questions.length > 3 && (
                  <Button
                    variant="ghost"
                    title="Entfernen"
                    onClick={() => set('sub_questions', form.sub_questions.filter((_, j) => j !== i))}
                  >
                    −
                  </Button>
                )}
              </div>
            ))}
            {form.sub_questions.length < 8 && (
              <button
                type="button"
                className="text-xs text-muted underline decoration-dotted"
                onClick={() => set('sub_questions', [...form.sub_questions, ''])}
              >
                Teilfrage hinzufügen
              </button>
            )}
          </div>
        </Field>
        <Field label="Stopp-Regel">
          <textarea className="field w-full text-sm" rows={2} value={form.stop_rule} onChange={(e) => set('stop_rule', e.target.value)} />
        </Field>
        <Field label="Tabus / Nicht-Behaupten">
          <textarea className="field w-full text-sm" rows={2} value={form.taboos} onChange={(e) => set('taboos', e.target.value)} />
        </Field>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Jahr von">
            <input className="field w-full text-sm" value={form.year_from} onChange={(e) => set('year_from', e.target.value)} />
          </Field>
          <Field label="Jahr bis">
            <input className="field w-full text-sm" value={form.year_to} onChange={(e) => set('year_to', e.target.value)} />
          </Field>
          <Field label="Min. empirisch">
            <input className="field w-full text-sm" value={form.min_empirical} onChange={(e) => set('min_empirical', e.target.value)} />
          </Field>
        </div>
        <Field label="Disziplin">
          <select
            className="field w-full text-sm"
            value={form.discipline}
            onChange={(e) => set('discipline', e.target.value as BriefDiscipline | '')}
          >
            <option value="">(nicht festgelegt)</option>
            <option value="psychology">Psychologie</option>
            <option value="general">allgemein</option>
          </select>
        </Field>
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="mb-3">
      <div className="mb-1 font-mono text-[11px] uppercase tracking-[0.08em] text-muted">{label}</div>
      {children}
    </div>
  )
}

function dropPaths(e: React.DragEvent): string[] {
  return [...e.dataTransfer.files]
    .map((f) => (f as File & { path?: string }).path)
    .filter((p): p is string => typeof p === 'string' && p.length > 0)
}

function SeedFilesCard({ state, onReload }: { state: ProjectState; onReload: () => void }) {
  const [busy, setBusy] = useState(false)
  const [dropOver, setDropOver] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const uploads = state.documents.filter((d) => d.origin === 'upload' && d.status !== 'excluded')

  const run = async (importer: () => Promise<{ filenames: string[]; errors: Array<{ filename: string; message: string }> }>) => {
    setBusy(true)
    setNotice(null)
    try {
      const res = await importer()
      if (res.errors.length) setNotice(res.errors.map((e) => `${e.filename}: ${e.message}`).join(' · '))
      else if (res.filenames.length) setNotice(`${res.filenames.length} Datei(en) im Korpus. Die KI prüft sie zusätzlich zur Online-Suche.`)
      onReload()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className={dropOver ? 'ring-2 ring-fg' : ''}
      onDragOver={(e) => {
        e.preventDefault()
        setDropOver(true)
      }}
      onDragLeave={() => setDropOver(false)}
      onDrop={(e) => {
        e.preventDefault()
        setDropOver(false)
        const paths = dropPaths(e)
        if (paths.length === 0) return
        void run(() => window.api.importCorpus(state.project.id, paths))
      }}
    >
    <Card className="p-4">
      <SectionTitle>Eigene PDFs</SectionTitle>
      <p className="mb-3 text-xs leading-relaxed text-muted">
        Dateien hierher ziehen oder hochladen — als mögliche Quellen, nicht nur bei Paywall. Die KI liest sie neben der
        Online-Suche und legt Treffer als Ordner auf den Arbeitstisch. Übernehmen bleibt bei dir.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="primary"
          icon="upload_file"
          disabled={busy}
          onClick={() => void run(() => window.api.uploadCorpus(state.project.id))}
        >
          PDFs reinlegen
        </Button>
        <Button disabled={busy} onClick={() => void window.api.revealInbox(state.project.id)}>
          Inbox-Ordner
        </Button>
      </div>
      {notice && <p className="mt-2 text-xs text-muted">{notice}</p>}
      {uploads.length > 0 && (
        <ul className="mt-3 space-y-1">
          {uploads.map((d) => (
            <li key={d.id} className="truncate text-xs text-muted">
              {d.filename || d.title || d.url}
              {d.char_len > 0 ? ` · ${d.char_len.toLocaleString('de')} Zeichen` : ''}
            </li>
          ))}
        </ul>
      )}
    </Card>
    </div>
  )
}

function RelatedResearchCard({
  state,
  onReload,
  onOpenProject,
}: {
  state: ProjectState
  onReload: () => void
  onOpenProject?: (id: string) => void
}) {
  const [peers, setPeers] = useState<ProjectSummary[]>([])
  const [pick, setPick] = useState('')
  const [bothWays, setBothWays] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const linked = state.related_research
  const linkedIds = new Set(linked.map((r) => r.project_id))

  useEffect(() => {
    void window.api.listProjects().then((list) =>
      setPeers(list.filter((p) => p.kind === 'research' && p.id !== state.project.id))
    )
  }, [state.project.id, linked.length])

  const available = peers.filter((p) => !linkedIds.has(p.id))

  const add = async () => {
    if (!pick) return
    setBusy(true)
    setError(null)
    try {
      await window.api.addRelatedResearch(state.project.id, pick, bothWays)
      setPick('')
      onReload()
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err).replace(/^Error:\s*/, ''))
    } finally {
      setBusy(false)
    }
  }

  const remove = async (id: string) => {
    setBusy(true)
    setError(null)
    try {
      await window.api.removeRelatedResearch(state.project.id, id, bothWays)
      onReload()
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err).replace(/^Error:\s*/, ''))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card className="p-4">
      <SectionTitle>Verwandte Research-Projekte</SectionTitle>
      <p className="mb-3 text-xs leading-relaxed text-muted">
        Für eine Hausarbeit in Teilen: andere Research-Projekte verknüpfen. Die KI darf dort in übernommene Quellen und
        hochgeladene PDFs schauen. Was in <em>diesen</em> Bericht soll, kopiert sie hierher — du übernimmst erneut.
      </p>
      {linked.length > 0 ? (
        <ul className="mb-3 space-y-2">
          {linked.map((r) => (
            <li key={r.project_id} className="flex items-start justify-between gap-2 text-sm">
              <button
                type="button"
                className="min-w-0 text-left hover:underline"
                onClick={() => onOpenProject?.(r.project_id)}
              >
                <div className="truncate">{r.title}</div>
                <div className="text-xs text-muted">
                  {r.signed_count} übernommen · {r.upload_count} Upload{r.upload_count === 1 ? '' : 's'}
                </div>
              </button>
              <Button variant="ghost" disabled={busy} onClick={() => void remove(r.project_id)}>
                Lösen
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mb-3 text-xs text-muted">Noch keines verknüpft.</p>
      )}
      {available.length > 0 && (
        <div className="flex flex-wrap items-end gap-2">
          <label className="min-w-[12rem] flex-1">
            <span className="mb-1 block font-mono text-[11px] uppercase tracking-[0.08em] text-muted">Projekt</span>
            <select className="field w-full text-sm" value={pick} onChange={(e) => setPick(e.target.value)} disabled={busy}>
              <option value="">wählen…</option>
              {available.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.title}
                </option>
              ))}
            </select>
          </label>
          <Button variant="primary" disabled={busy || !pick} onClick={() => void add()}>
            Verknüpfen
          </Button>
        </div>
      )}
      {available.length > 0 && (
        <label className="mt-2 flex items-center gap-2 text-xs text-muted">
          <input type="checkbox" checked={bothWays} onChange={(e) => setBothWays(e.target.checked)} />
          Auch umgekehrt (beide Projekte dürfen zueinander schauen)
        </label>
      )}
      {error && <p className="mt-2 text-xs text-warn">{error}</p>}
    </Card>
  )
}
