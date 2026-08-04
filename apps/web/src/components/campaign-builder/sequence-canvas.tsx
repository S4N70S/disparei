'use client'

import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { analyzeDeliverability } from '@disparei/core/deliverability'
import { blocksToPlainText } from '@disparei/core/blocks'
import { reviewSequence, type TouchTemplate } from '@disparei/core/touch-library'
import { Badge, Card } from '@/components/ui'
import { formatProjected, projectTimeline, sequenceSpanDays } from './timeline'
import { stepFromTemplate, type BuilderState, type BuilderStep } from './types'

type Props = {
  state: BuilderState
  provider: 'resend' | 'smtp'
  library: readonly TouchTemplate[]
  onChange: (steps: BuilderStep[]) => void
  onEdit: (key: string) => void
}

function SortableStep({
  step,
  index,
  projected,
  provider,
  threadSubject,
  onEdit,
  onRemove,
  onWaitChange,
  onMove,
  total,
}: {
  step: BuilderStep
  index: number
  projected: string
  provider: 'resend' | 'smtp'
  threadSubject: string
  onEdit: () => void
  onRemove: () => void
  onWaitChange: (days: number) => void
  onMove: (dir: -1 | 1) => void
  total: number
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: step.key,
  })

  const primeira = step.variants[0]
  const report = analyzeDeliverability({
    subject: primeira?.subject ?? '',
    blocks: primeira?.blocks ?? [],
    provider,
  })
  const criticos = report.checks.filter((c) => c.severity === 'critical').length
  const avisos = report.checks.filter((c) => c.severity === 'warning').length
  const previa = blocksToPlainText(primeira?.blocks ?? []).slice(0, 90)

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={isDragging ? 'opacity-50' : ''}
    >
      {index > 0 && (
        <div className="flex items-center gap-2 py-2 pl-6 text-xs text-[var(--color-muted)]">
          <span className="h-4 w-px bg-[var(--color-border)]" />
          <label className="flex items-center gap-1.5">
            esperar
            <input
              type="number"
              min={0}
              max={60}
              value={step.waitDays}
              onChange={(e) => onWaitChange(Math.max(0, Number(e.target.value) || 0))}
              className="w-14 rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-1.5 py-0.5 text-center tabular-nums"
            />
            dias úteis
          </label>
          <span>→ {projected}</span>
        </div>
      )}

      <Card className={`p-4 ${step.enabled ? '' : 'opacity-50'}`}>
        <div className="flex items-start gap-3">
          <button
            type="button"
            {...attributes}
            {...listeners}
            aria-label={`Reordenar ${step.label}`}
            className="mt-0.5 cursor-grab select-none text-[var(--color-muted)] hover:text-[var(--color-fg)] active:cursor-grabbing"
          >
            ⠿
          </button>

          <button type="button" onClick={onEdit} className="min-w-0 flex-1 text-left">
            <div className="mb-1 flex flex-wrap items-center gap-2">
              <span className="text-xs tabular-nums text-[var(--color-muted)]">{index + 1}</span>
              <span className="text-sm font-medium">{step.label}</span>
              {step.locked && <Badge tone="neutral">enviado · travado</Badge>}
              {step.variants.length > 1 && (
                <Badge tone="indigo">{step.variants.length} variantes</Badge>
              )}
              {criticos > 0 && <Badge tone="red">{criticos} crítico(s)</Badge>}
              {criticos === 0 && avisos > 0 && <Badge tone="amber">{avisos} aviso(s)</Badge>}
            </div>
            <p className="truncate text-sm">
              {index > 0 && step.sameThread ? (
                <span className="text-[var(--color-muted)]">
                  Re: {threadSubject || '(assunto do toque 1)'}
                </span>
              ) : (
                primeira?.subject || (
                  <span className="text-[var(--color-muted)]">(sem assunto)</span>
                )
              )}
            </p>
            <p className="truncate text-xs text-[var(--color-muted)]">{previa || '(vazio)'}</p>
          </button>

          <div className="flex shrink-0 items-center gap-1 text-xs">
            <button
              type="button"
              onClick={() => onMove(-1)}
              disabled={index === 0}
              aria-label="Mover para cima"
              className="rounded px-1.5 py-0.5 text-[var(--color-muted)] hover:bg-[var(--color-bg)] disabled:opacity-30"
            >
              ↑
            </button>
            <button
              type="button"
              onClick={() => onMove(1)}
              disabled={index === total - 1}
              aria-label="Mover para baixo"
              className="rounded px-1.5 py-0.5 text-[var(--color-muted)] hover:bg-[var(--color-bg)] disabled:opacity-30"
            >
              ↓
            </button>
            <button
              type="button"
              onClick={onRemove}
              disabled={step.locked}
              aria-label="Remover toque"
              title={step.locked ? 'Toque já enviado não pode ser removido' : 'Remover'}
              className="rounded px-1.5 py-0.5 text-[var(--color-muted)] hover:bg-[var(--color-bg)] disabled:opacity-30"
            >
              ✕
            </button>
          </div>
        </div>
      </Card>
    </div>
  )
}

export function SequenceCanvas({ state, provider, library, onChange, onEdit }: Props) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    // Teclado: arrastar não pode ser a única forma de reordenar.
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const dates = projectTimeline(state.steps, state.sendWindow)
  const notas = reviewSequence(state.steps.map((s) => ({ purpose: s.purpose, waitDays: s.waitDays })))

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over || active.id === over.id) return

    const from = state.steps.findIndex((s) => s.key === active.id)
    const to = state.steps.findIndex((s) => s.key === over.id)
    if (from === -1 || to === -1) return

    onChange(arrayMove(state.steps, from, to))
  }

  const update = (key: string, patch: Partial<BuilderStep>) =>
    onChange(state.steps.map((s) => (s.key === key ? { ...s, ...patch } : s)))

  const move = (index: number, dir: -1 | 1) => {
    const to = index + dir
    if (to < 0 || to >= state.steps.length) return
    onChange(arrayMove(state.steps, index, to))
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold">Sequência</h2>
        <p className="text-xs text-[var(--color-muted)]">
          {state.steps.length} toque(s) · {sequenceSpanDays(dates)} dias de cadência
        </p>
      </div>

      {notas.length > 0 && (
        <Card className="border-amber-500/40 p-3">
          <ul className="space-y-1">
            {notas.map((n) => (
              <li key={n} className="text-xs text-[var(--color-muted)]">
                {n}
              </li>
            ))}
          </ul>
        </Card>
      )}

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={state.steps.map((s) => s.key)} strategy={verticalListSortingStrategy}>
          {state.steps.map((step, i) => (
            <SortableStep
              key={step.key}
              step={step}
              index={i}
              total={state.steps.length}
              provider={provider}
              projected={formatProjected(dates[i] ?? new Date(), state.sendWindow.timezone)}
              threadSubject={state.steps[0]?.variants[0]?.subject ?? ''}
              onEdit={() => onEdit(step.key)}
              onRemove={() => onChange(state.steps.filter((s) => s.key !== step.key))}
              onWaitChange={(waitDays) => update(step.key, { waitDays })}
              onMove={(dir) => move(i, dir)}
            />
          ))}
        </SortableContext>
      </DndContext>

      <details className="rounded-xl border border-[var(--color-border)]">
        <summary className="cursor-pointer p-3 text-sm font-medium">Adicionar toque</summary>
        <div className="grid gap-2 p-3 pt-0 sm:grid-cols-2">
          {library.map((t) => (
            <button
              key={t.purpose}
              type="button"
              onClick={() =>
                onChange([...state.steps, stepFromTemplate(t, state.steps.length === 0)])
              }
              className="rounded-lg border border-[var(--color-border)] p-3 text-left transition hover:bg-[var(--color-bg)]"
            >
              <p className="text-sm font-medium">{t.label}</p>
              <p className="mt-0.5 text-xs text-[var(--color-muted)]">{t.role}</p>
              <p className="mt-1 text-xs text-[var(--color-muted)]">{t.rationale}</p>
            </button>
          ))}
        </div>
      </details>
    </div>
  )
}
