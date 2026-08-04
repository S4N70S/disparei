'use client'

import { DndContext, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { SortableContext, arrayMove, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { Block, BlockType } from '@disparei/core/blocks'
import { inputClass } from '@/components/ui'

const PALETA: Array<{ type: BlockType; label: string; make: () => Block; hint?: string }> = [
  { type: 'text', label: 'Texto', make: () => ({ type: 'text', html: '' }) },
  { type: 'heading', label: 'Título', make: () => ({ type: 'heading', text: '', level: 2 }) },
  {
    type: 'button',
    label: 'Botão',
    make: () => ({ type: 'button', label: 'Agendar conversa', url: '' }),
    hint: 'Conta como link',
  },
  {
    type: 'image',
    label: 'Imagem',
    make: () => ({ type: 'image', url: '', alt: '' }),
    hint: 'Pesa em prospecção fria',
  },
  { type: 'divider', label: 'Divisor', make: () => ({ type: 'divider' }) },
  { type: 'spacer', label: 'Espaço', make: () => ({ type: 'spacer', size: 'md' }) },
  { type: 'signature', label: 'Assinatura', make: () => ({ type: 'signature', html: '' }) },
]

const LABEL: Record<BlockType, string> = {
  text: 'Texto',
  heading: 'Título',
  button: 'Botão',
  image: 'Imagem',
  divider: 'Divisor',
  spacer: 'Espaço',
  signature: 'Assinatura',
}

function BlockFields({
  block,
  onChange,
}: {
  block: Block
  onChange: (b: Block) => void
}) {
  switch (block.type) {
    case 'text':
    case 'signature':
      return (
        <textarea
          value={block.html}
          onChange={(e) => onChange({ ...block, html: e.target.value })}
          rows={block.type === 'text' ? 3 : 2}
          placeholder={
            block.type === 'text'
              ? 'Oi {{first_name|tudo bem}}, ...'
              : 'Abraço,<br>Diego'
          }
          className={`${inputClass} text-sm`}
        />
      )

    case 'heading':
      return (
        <div className="flex gap-2">
          <input
            value={block.text}
            onChange={(e) => onChange({ ...block, text: e.target.value })}
            placeholder="Título"
            className={inputClass}
          />
          <select
            value={block.level}
            onChange={(e) => onChange({ ...block, level: Number(e.target.value) as 2 | 3 })}
            className={`${inputClass} w-20`}
          >
            <option value={2}>H2</option>
            <option value={3}>H3</option>
          </select>
        </div>
      )

    case 'button':
      return (
        <div className="grid gap-2 sm:grid-cols-2">
          <input
            value={block.label}
            onChange={(e) => onChange({ ...block, label: e.target.value })}
            placeholder="Texto do botão"
            className={inputClass}
          />
          <input
            value={block.url}
            onChange={(e) => onChange({ ...block, url: e.target.value })}
            placeholder="https://..."
            className={inputClass}
          />
        </div>
      )

    case 'image':
      return (
        <div className="grid gap-2 sm:grid-cols-2">
          <input
            value={block.url}
            onChange={(e) => onChange({ ...block, url: e.target.value })}
            placeholder="https://.../imagem.png"
            className={inputClass}
          />
          <input
            value={block.alt}
            onChange={(e) => onChange({ ...block, alt: e.target.value })}
            placeholder="Descrição (alt)"
            className={inputClass}
          />
        </div>
      )

    case 'spacer':
      return (
        <select
          value={block.size}
          onChange={(e) => onChange({ ...block, size: e.target.value as 'sm' | 'md' | 'lg' })}
          className={`${inputClass} w-32`}
        >
          <option value="sm">Pequeno</option>
          <option value="md">Médio</option>
          <option value="lg">Grande</option>
        </select>
      )

    case 'divider':
      return <p className="text-xs text-[var(--color-muted)]">Linha horizontal, sem configuração.</p>

    default:
      return null
  }
}

function SortableBlock({
  id,
  block,
  disabled,
  onChange,
  onRemove,
}: {
  id: string
  block: Block
  disabled: boolean
  onChange: (b: Block) => void
  onRemove: () => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
    disabled,
  })

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`rounded-lg border border-[var(--color-border)] p-3 ${isDragging ? 'opacity-50' : ''}`}
    >
      <div className="mb-2 flex items-center gap-2">
        {!disabled && (
          <button
            type="button"
            {...attributes}
            {...listeners}
            aria-label="Reordenar bloco"
            className="cursor-grab text-[var(--color-muted)] active:cursor-grabbing"
          >
            ⠿
          </button>
        )}
        <span className="text-xs font-medium text-[var(--color-muted)]">{LABEL[block.type]}</span>
        {!disabled && (
          <button
            type="button"
            onClick={onRemove}
            aria-label="Remover bloco"
            className="ml-auto text-xs text-[var(--color-muted)] hover:text-[var(--color-fg)]"
          >
            ✕
          </button>
        )}
      </div>
      <fieldset disabled={disabled}>
        <BlockFields block={block} onChange={onChange} />
      </fieldset>
    </div>
  )
}

export function BlockEditor({
  blocks,
  disabled,
  onChange,
}: {
  blocks: Block[]
  disabled: boolean
  onChange: (blocks: Block[]) => void
}) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }))
  const ids = blocks.map((_, i) => `bloco-${i}`)

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const from = ids.indexOf(String(active.id))
    const to = ids.indexOf(String(over.id))
    if (from === -1 || to === -1) return
    onChange(arrayMove(blocks, from, to))
  }

  return (
    <div className="space-y-2">
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={ids} strategy={verticalListSortingStrategy}>
          <div className="space-y-2">
            {blocks.map((block, i) => (
              <SortableBlock
                key={ids[i]}
                id={ids[i]!}
                block={block}
                disabled={disabled}
                onChange={(b) => onChange(blocks.map((x, j) => (j === i ? b : x)))}
                onRemove={() => onChange(blocks.filter((_, j) => j !== i))}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>

      {!disabled && (
        <div className="flex flex-wrap gap-1.5 pt-1">
          {PALETA.map((p) => (
            <button
              key={p.type}
              type="button"
              onClick={() => onChange([...blocks, p.make()])}
              title={p.hint}
              className="rounded-md border border-[var(--color-border)] px-2 py-1 text-xs transition hover:bg-[var(--color-bg)]"
            >
              + {p.label}
              {p.hint && <span className="ml-1 text-[var(--color-muted)]">·</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
