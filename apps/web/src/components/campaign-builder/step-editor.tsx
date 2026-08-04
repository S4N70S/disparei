'use client'

import { useEffect, useState, useTransition } from 'react'
import { scoreLabel } from '@disparei/core/deliverability'
import type { Block } from '@disparei/core/blocks'
import { Badge, Button, Card, inputClass } from '@/components/ui'
import { previewStep, type PreviewResult } from '@/app/campanhas/preview-action'
import { BlockEditor } from './block-editor'
import type { BuilderStep } from './types'

const VARIAVEIS = [
  ['{{first_name}}', 'Nome'],
  ['{{company}}', 'Empresa'],
  ['{{title}}', 'Cargo'],
  ['{{last_name}}', 'Sobrenome'],
] as const

const TONE_CLASS = {
  green: 'text-emerald-600 dark:text-emerald-400',
  amber: 'text-amber-600 dark:text-amber-400',
  red: 'text-red-600 dark:text-red-400',
} as const

const SEVERITY_TONE = { critical: 'red', warning: 'amber', info: 'neutral' } as const

export function StepEditor({
  step,
  index,
  listId,
  provider,
  onChange,
  onClose,
}: {
  step: BuilderStep
  index: number
  listId: string
  provider: 'resend' | 'smtp'
  onChange: (patch: Partial<BuilderStep>) => void
  onClose: () => void
}) {
  const [variant, setVariant] = useState(0)
  const [preview, setPreview] = useState<PreviewResult | null>(null)
  const [offset, setOffset] = useState(0)
  const [, startTransition] = useTransition()

  const atual = step.variants[variant] ?? step.variants[0]!
  const travado = step.locked

  /*
   * Prévia com atraso: cada tecla dispararia uma chamada ao servidor.
   * 400ms é o intervalo em que a digitação pausa naturalmente.
   */
  useEffect(() => {
    const timer = setTimeout(() => {
      startTransition(async () => {
        try {
          setPreview(
            await previewStep({
              subject: atual.subject,
              blocks: atual.blocks,
              listId,
              contactOffset: offset,
              provider,
            }),
          )
        } catch {
          setPreview(null)
        }
      })
    }, 400)
    return () => clearTimeout(timer)
  }, [atual.subject, atual.blocks, listId, offset, provider])

  const patchVariant = (patch: Partial<{ subject: string; blocks: Block[] }>) =>
    onChange({
      variants: step.variants.map((v, i) => (i === variant ? { ...v, ...patch } : v)),
    })

  const inserirVariavel = (token: string) =>
    patchVariant({ subject: `${atual.subject}${token}` })

  const score = preview?.deliverability.score ?? 100
  const rotulo = scoreLabel(score)

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40" onClick={onClose}>
      <div
        className="h-full w-full max-w-3xl overflow-y-auto bg-[var(--color-bg)] p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          <div className="min-w-0">
            <input
              value={step.label}
              onChange={(e) => onChange({ label: e.target.value })}
              className="w-full border-0 bg-transparent p-0 text-lg font-semibold outline-none"
            />
            <p className="text-xs text-[var(--color-muted)]">Toque {index + 1}</p>
          </div>
          <Button variant="ghost" onClick={onClose}>
            Fechar
          </Button>
        </div>

        {travado && (
          <Card className="mb-4 border-amber-500/40 p-3">
            <p className="text-sm">
              Este toque já foi enviado, então o conteúdo está travado. Alterá-lo faria as métricas
              da variante somarem em cima de um texto diferente do que saiu — você perderia a
              relação entre copy e resultado. Posição e intervalo continuam editáveis.
            </p>
          </Card>
        )}

        {/* Variantes A/B — substituem o separador `---` invisível */}
        <div className="mb-3 flex flex-wrap items-center gap-1.5">
          {step.variants.map((_, i) => (
            <button
              key={i}
              type="button"
              onClick={() => setVariant(i)}
              className={`rounded-md px-2.5 py-1 text-xs font-medium ${
                i === variant
                  ? 'bg-[var(--color-accent)] text-white'
                  : 'border border-[var(--color-border)]'
              }`}
            >
              Variante {String.fromCharCode(65 + i)}
            </button>
          ))}
          {!travado && step.variants.length < 4 && (
            <button
              type="button"
              onClick={() => {
                onChange({ variants: [...step.variants, { ...atual }] })
                setVariant(step.variants.length)
              }}
              className="rounded-md border border-dashed border-[var(--color-border)] px-2.5 py-1 text-xs text-[var(--color-muted)]"
            >
              + teste A/B
            </button>
          )}
          {!travado && step.variants.length > 1 && (
            <button
              type="button"
              onClick={() => {
                onChange({ variants: step.variants.filter((_, i) => i !== variant) })
                setVariant(0)
              }}
              className="text-xs text-[var(--color-muted)] hover:text-[var(--color-fg)]"
            >
              remover esta
            </button>
          )}
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          {/* ---- Edição ---- */}
          <div className="space-y-3">
            <div>
              <label className="mb-1 block text-sm font-medium">
                Assunto
                {index > 0 && (
                  <span className="ml-1 text-xs font-normal text-[var(--color-muted)]">
                    — vazio herda a thread com “Re:”
                  </span>
                )}
              </label>
              <input
                value={atual.subject}
                disabled={travado}
                onChange={(e) => patchVariant({ subject: e.target.value })}
                placeholder={index === 0 ? '{Pergunta|Ideia} sobre {{company}}' : ''}
                className={inputClass}
              />
              {!travado && (
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {VARIAVEIS.map(([token, label]) => (
                    <button
                      key={token}
                      type="button"
                      onClick={() => inserirVariavel(token)}
                      className="rounded border border-[var(--color-border)] px-1.5 py-0.5 text-xs text-[var(--color-muted)] hover:text-[var(--color-fg)]"
                    >
                      {label}
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => inserirVariavel('{opção A|opção B}')}
                    title="Spintax: varia o texto entre envios"
                    className="rounded border border-[var(--color-border)] px-1.5 py-0.5 text-xs text-[var(--color-muted)] hover:text-[var(--color-fg)]"
                  >
                    spintax
                  </button>
                </div>
              )}
            </div>

            <div>
              <p className="mb-1.5 text-sm font-medium">Corpo</p>
              <BlockEditor
                blocks={atual.blocks}
                disabled={travado}
                onChange={(blocks) => patchVariant({ blocks })}
              />
            </div>
          </div>

          {/* ---- Prévia e entregabilidade ---- */}
          <div className="space-y-3">
            <Card className="p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <p className="text-sm font-medium">Prévia</p>
                <button
                  type="button"
                  onClick={() => setOffset((o) => o + 1)}
                  className="text-xs text-[var(--color-muted)] hover:text-[var(--color-fg)]"
                >
                  outro contato →
                </button>
              </div>

              <p className="mb-1 text-xs text-[var(--color-muted)]">
                {preview?.contact
                  ? `${preview.contact.firstName ?? '(sem nome)'} · ${preview.contact.email}`
                  : 'exemplo genérico — a lista não tem contatos'}
              </p>

              <p className="mb-2 border-b border-[var(--color-border)] pb-2 text-sm font-medium">
                {preview?.subject || '(sem assunto)'}
              </p>

              <div
                className="prose-sm max-h-80 overflow-y-auto rounded bg-white p-3 text-sm text-black"
                dangerouslySetInnerHTML={{ __html: preview?.html ?? '' }}
              />

              {preview && preview.missingVariables.length > 0 && (
                <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">
                  Variáveis sem valor e sem fallback: {preview.missingVariables.join(', ')} — vão
                  sair em branco. Use {'{{'}variavel|texto padrão{'}}'}.
                </p>
              )}
            </Card>

            <Card className="p-3">
              <div className="mb-2 flex items-center justify-between">
                <p className="text-sm font-medium">Entregabilidade</p>
                <span className={`text-sm font-semibold tabular-nums ${TONE_CLASS[rotulo.tone]}`}>
                  {rotulo.label} · {score}
                </span>
              </div>

              <p className="mb-2 text-xs text-[var(--color-muted)]">
                {preview?.deliverability.wordCount ?? 0} palavras ·{' '}
                {preview?.deliverability.linkCount ?? 0} link(s) ·{' '}
                {preview?.deliverability.imageCount ?? 0} imagem(ns)
              </p>

              {preview?.deliverability.checks.length === 0 ? (
                <p className="text-xs text-emerald-600 dark:text-emerald-400">
                  Nenhum problema detectado.
                </p>
              ) : (
                <ul className="space-y-2">
                  {preview?.deliverability.checks.map((c) => (
                    <li key={c.id}>
                      <Badge tone={SEVERITY_TONE[c.severity]}>{c.title}</Badge>
                      <p className="mt-0.5 text-xs text-[var(--color-muted)]">{c.detail}</p>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
        </div>
      </div>
    </div>
  )
}
