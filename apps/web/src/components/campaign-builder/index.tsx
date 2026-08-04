'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { DEFAULT_SEND_WINDOW } from '@disparei/core/schedule'
import { findTouch, type TouchPurpose } from '@disparei/core/touch-library'
import { Button, Card, Field, PageHeader, inputClass } from '@/components/ui'
import { saveCampaign } from '@/app/campanhas/actions'
import { SequenceCanvas } from './sequence-canvas'
import { StepEditor } from './step-editor'
import { formatProjected, projectTimeline, sequenceSpanDays } from './timeline'
import { stepFromTemplate, type BuilderOptions, type BuilderState, type BuilderStep } from './types'

const DAYS = [
  [1, 'Seg'],
  [2, 'Ter'],
  [3, 'Qua'],
  [4, 'Qui'],
  [5, 'Sex'],
  [6, 'Sáb'],
  [7, 'Dom'],
] as const

const ETAPAS = ['Base', 'Sequência', 'Agenda e revisão'] as const

const SEQUENCIA_INICIAL: TouchPurpose[] = ['opening', 'bump', 'social_proof', 'breakup']

export function CampaignBuilder({
  options,
  initial,
}: {
  options: BuilderOptions
  initial?: BuilderState
}) {
  const router = useRouter()
  const [etapa, setEtapa] = useState(0)
  const [editando, setEditando] = useState<string | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [salvando, startSaving] = useTransition()

  const [state, setState] = useState<BuilderState>(
    () =>
      initial ?? {
        name: '',
        listId: options.lists[0]?.id ?? '',
        sendingAccountIds: options.accounts.map((a) => a.id),
        sendWindow: DEFAULT_SEND_WINDOW,
        dailyCap: 50,
        steps: SEQUENCIA_INICIAL.map((p, i) => stepFromTemplate(findTouch(p), i === 0)),
      },
  )

  /*
   * O provedor da PRIMEIRA caixa selecionada define o rigor das verificações.
   * SMTP significa prospecção fria, onde imagem e HTML pesado custam caro;
   * Resend é nutrição opt-in, onde o mesmo bloco é aceitável.
   */
  const provider = useMemo(() => {
    const primeira = options.accounts.find((a) => state.sendingAccountIds.includes(a.id))
    return primeira?.provider ?? 'smtp'
  }, [options.accounts, state.sendingAccountIds])

  const dates = projectTimeline(state.steps, state.sendWindow)
  const stepEmEdicao = state.steps.find((s) => s.key === editando)

  const patch = (p: Partial<BuilderState>) => setState((s) => ({ ...s, ...p }))
  const patchWindow = (p: Partial<BuilderState['sendWindow']>) =>
    setState((s) => ({ ...s, sendWindow: { ...s.sendWindow, ...p } }))

  function salvar() {
    setErro(null)
    startSaving(async () => {
      const result = await saveCampaign({
        id: state.id,
        name: state.name,
        listId: state.listId,
        sendingAccountIds: state.sendingAccountIds,
        sendWindow: state.sendWindow,
        dailyCap: state.dailyCap,
        steps: state.steps.map((s) => ({
          id: s.id,
          label: s.label,
          purpose: s.purpose,
          waitDays: s.waitDays,
          sameThread: s.sameThread,
          enabled: s.enabled,
          variants: s.variants,
        })),
      })

      if (!result.ok) {
        setErro(result.error)
        return
      }
      router.push(`/campanhas/${result.campaignId}`)
    })
  }

  return (
    <>
      <PageHeader
        title={state.id ? 'Editar campanha' : 'Nova campanha'}
        description="Monte a sequência arrastando os toques. As datas ao lado são reais — calculadas com a janela de envio."
      />

      {/* Navegação das etapas */}
      <div className="mb-6 flex flex-wrap gap-1">
        {ETAPAS.map((label, i) => (
          <button
            key={label}
            type="button"
            onClick={() => setEtapa(i)}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${
              i === etapa
                ? 'bg-[var(--color-accent)] text-white'
                : 'text-[var(--color-muted)] hover:text-[var(--color-fg)]'
            }`}
          >
            {i + 1}. {label}
          </button>
        ))}
      </div>

      {/* ---- 1. Base ---- */}
      {etapa === 0 && (
        <Card className="space-y-4 p-5">
          <Field label="Nome da campanha">
            <input
              value={state.name}
              onChange={(e) => patch({ name: e.target.value })}
              placeholder="Indústrias PE — ago/2026"
              className={inputClass}
            />
          </Field>

          <Field label="Lista">
            <select
              value={state.listId}
              onChange={(e) => patch({ listId: e.target.value })}
              className={inputClass}
            >
              {options.lists.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </Field>

          <Field
            label="Caixas de envio"
            hint="Com mais de uma caixa, os envios são distribuídos entre elas para diluir o volume por remetente."
          >
            <div className="space-y-2">
              {options.accounts.map((a) => (
                <label key={a.id} className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={state.sendingAccountIds.includes(a.id)}
                    onChange={(e) =>
                      patch({
                        sendingAccountIds: e.target.checked
                          ? [...state.sendingAccountIds, a.id]
                          : state.sendingAccountIds.filter((id) => id !== a.id),
                      })
                    }
                  />
                  <span className="text-sm">
                    {a.fromName} &lt;{a.fromEmail}&gt;
                    <span className="text-[var(--color-muted)]"> · {a.provider}</span>
                  </span>
                </label>
              ))}
            </div>
          </Field>
        </Card>
      )}

      {/* ---- 2. Sequência ---- */}
      {etapa === 1 && (
        <SequenceCanvas
          state={state}
          provider={provider}
          library={options.library}
          onChange={(steps) => patch({ steps })}
          onEdit={setEditando}
        />
      )}

      {/* ---- 3. Agenda e revisão ---- */}
      {etapa === 2 && (
        <div className="space-y-4">
          <Card className="space-y-4 p-5">
            <h2 className="text-sm font-semibold">Janela de envio</h2>

            <Field
              label="Dias"
              hint="Prospecção em fim de semana tem taxa de resposta baixa e custo de reputação alto."
            >
              <div className="flex flex-wrap gap-3">
                {DAYS.map(([value, label]) => (
                  <label key={value} className="flex items-center gap-1.5">
                    <input
                      type="checkbox"
                      checked={state.sendWindow.daysOfWeek.includes(value)}
                      onChange={(e) =>
                        patchWindow({
                          daysOfWeek: e.target.checked
                            ? [...state.sendWindow.daysOfWeek, value].sort()
                            : state.sendWindow.daysOfWeek.filter((d) => d !== value),
                        })
                      }
                    />
                    <span className="text-sm">{label}</span>
                  </label>
                ))}
              </div>
            </Field>

            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Hora inicial">
                <input
                  type="number"
                  min={0}
                  max={23}
                  value={Math.floor(state.sendWindow.startMinute / 60)}
                  onChange={(e) => patchWindow({ startMinute: Number(e.target.value) * 60 })}
                  className={inputClass}
                />
              </Field>
              <Field label="Hora final">
                <input
                  type="number"
                  min={1}
                  max={24}
                  value={Math.floor(state.sendWindow.endMinute / 60)}
                  onChange={(e) => patchWindow({ endMinute: Number(e.target.value) * 60 })}
                  className={inputClass}
                />
              </Field>
              <Field label="Fuso">
                <input
                  value={state.sendWindow.timezone}
                  onChange={(e) => patchWindow({ timezone: e.target.value })}
                  className={inputClass}
                />
              </Field>
            </div>

            <Field
              label="Teto diário da campanha"
              hint="O teto por caixa continua valendo em paralelo — vale o menor dos dois."
            >
              <input
                type="number"
                min={1}
                value={state.dailyCap}
                onChange={(e) => patch({ dailyCap: Math.max(1, Number(e.target.value) || 1) })}
                className={inputClass}
              />
            </Field>
          </Card>

          <Card className="p-5">
            <h2 className="mb-3 text-sm font-semibold">
              Cadência projetada · {sequenceSpanDays(dates)} dias
            </h2>
            <ol className="space-y-2">
              {state.steps.map((s, i) => (
                <li key={s.key} className="flex items-baseline gap-3 text-sm">
                  <span className="w-5 shrink-0 tabular-nums text-[var(--color-muted)]">{i + 1}</span>
                  <span className="w-40 shrink-0 text-[var(--color-muted)]">
                    {formatProjected(dates[i] ?? new Date(), state.sendWindow.timezone)}
                  </span>
                  <span className="truncate">{s.label}</span>
                </li>
              ))}
            </ol>
          </Card>
        </div>
      )}

      {erro && (
        <Card className="mt-4 border-red-500/50 p-3">
          <p className="text-sm text-red-600 dark:text-red-400">{erro}</p>
        </Card>
      )}

      <div className="mt-6 flex flex-wrap items-center gap-2">
        {etapa > 0 && (
          <Button variant="ghost" onClick={() => setEtapa(etapa - 1)}>
            Voltar
          </Button>
        )}
        {etapa < ETAPAS.length - 1 ? (
          <Button onClick={() => setEtapa(etapa + 1)}>Continuar</Button>
        ) : (
          <Button onClick={salvar} disabled={salvando}>
            {salvando ? 'Salvando...' : state.id ? 'Salvar alterações' : 'Criar campanha'}
          </Button>
        )}
      </div>

      {stepEmEdicao && (
        <StepEditor
          step={stepEmEdicao}
          index={state.steps.findIndex((s) => s.key === stepEmEdicao.key)}
          listId={state.listId}
          provider={provider}
          onChange={(p) =>
            patch({
              steps: state.steps.map((s) => (s.key === stepEmEdicao.key ? { ...s, ...p } : s)),
            })
          }
          onClose={() => setEditando(null)}
        />
      )}
    </>
  )
}
