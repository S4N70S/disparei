import { db, eq, lists, sendingAccounts } from '@disparei/db'
import { Button, Card, Empty, Field, PageHeader, inputClass } from '@/components/ui'
import { requireWorkspace } from '@/lib/session'
import { createCampaign } from '../actions'

export const dynamic = 'force-dynamic'

const DAYS = [
  [1, 'Seg'],
  [2, 'Ter'],
  [3, 'Qua'],
  [4, 'Qui'],
  [5, 'Sex'],
  [6, 'Sáb'],
  [7, 'Dom'],
] as const

/** 4 toques é o mínimo defensável; o editor abre com essa estrutura. */
const STEP_SLOTS = [0, 1, 2, 3, 4, 5, 6]

const PLACEHOLDERS: Record<number, { subject: string; body: string }> = {
  0: {
    subject: '{Pergunta rápida|Ideia} sobre {{company|sua operação}}',
    body: 'Oi {{first_name|tudo bem}},\n\nVi que a {{company|sua empresa}} ...\n\nFaz sentido conversarmos 15 min?\n\nAbraço,\nDiego',
  },
  1: { subject: '', body: 'Oi {{first_name}}, subindo este e-mail caso tenha passado batido.' },
  2: { subject: '', body: 'Deixo um caso parecido com o de vocês: ...' },
  3: { subject: '', body: 'Sem retorno, imagino que não seja prioridade agora. Encerro por aqui.' },
}

export default async function NovaCampanhaPage() {
  const workspace = await requireWorkspace()
  const database = db()

  const allLists = await database
    .select()
    .from(lists)
    .where(eq(lists.workspaceId, workspace.id))

  const accounts = await database
    .select()
    .from(sendingAccounts)
    .where(eq(sendingAccounts.workspaceId, workspace.id))

  if (allLists.length === 0 || accounts.length === 0) {
    return (
      <>
        <PageHeader title="Nova campanha" />
        <Empty
          title="Falta configurar o básico"
          hint={
            allLists.length === 0
              ? 'Importe uma lista em Contatos antes de criar a campanha.'
              : 'Cadastre uma caixa de envio em Configurações antes de criar a campanha.'
          }
        />
      </>
    )
  }

  return (
    <>
      <PageHeader
        title="Nova campanha"
        description="Separe variantes com uma linha contendo apenas --- para rodar teste A/B. Use {opção a|opção b} para spintax e {{variavel|fallback}} para personalização."
      />

      <form action={createCampaign} className="space-y-6">
        <Card className="space-y-4 p-5">
          <Field label="Nome da campanha">
            <input name="name" required placeholder="Indústrias PE — set/2026" className={inputClass} />
          </Field>

          <Field label="Lista">
            <select name="listId" required className={inputClass}>
              {allLists.map((l) => (
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
              {accounts.map((a) => (
                <label key={a.id} className="flex items-center gap-2">
                  <input type="checkbox" name="sendingAccountIds" value={a.id} defaultChecked />
                  <span className="text-sm">
                    {a.fromName} &lt;{a.fromEmail}&gt;
                    <span className="text-[var(--color-muted)]"> · {a.provider}</span>
                  </span>
                </label>
              ))}
            </div>
          </Field>
        </Card>

        <Card className="space-y-4 p-5">
          <h2 className="text-sm font-semibold">Janela de envio</h2>

          <Field label="Dias" hint="Prospecção em fim de semana tem taxa de resposta baixa e custo de reputação alto.">
            <div className="flex flex-wrap gap-3">
              {DAYS.map(([value, label]) => (
                <label key={value} className="flex items-center gap-1.5">
                  <input
                    type="checkbox"
                    name="daysOfWeek"
                    value={value}
                    defaultChecked={value <= 5}
                  />
                  <span className="text-sm">{label}</span>
                </label>
              ))}
            </div>
          </Field>

          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Hora inicial">
              <input type="number" name="startHour" min={0} max={23} defaultValue={9} className={inputClass} />
            </Field>
            <Field label="Hora final">
              <input type="number" name="endHour" min={1} max={24} defaultValue={17} className={inputClass} />
            </Field>
            <Field label="Fuso">
              <input name="timezone" defaultValue="America/Sao_Paulo" className={inputClass} />
            </Field>
          </div>

          <Field
            label="Teto diário da campanha"
            hint="O teto por caixa continua valendo em paralelo — vale o menor dos dois."
          >
            <input type="number" name="dailyCap" min={1} defaultValue={100} className={inputClass} />
          </Field>
        </Card>

        <Card className="space-y-6 p-5">
          <div>
            <h2 className="text-sm font-semibold">Sequência</h2>
            <p className="mt-1 text-sm text-[var(--color-muted)]">
              Deixe o assunto em branco nos follow-ups: eles são encadeados na mesma thread do
              primeiro e-mail, com prefixo <code>Re:</code>.
            </p>
          </div>

          {STEP_SLOTS.map((i) => (
            <div key={i} className="border-t border-[var(--color-border)] pt-4 first:border-0 first:pt-0">
              <p className="mb-3 text-sm font-medium">
                Passo {i + 1}
                {i === 0 && <span className="text-[var(--color-muted)]"> · obrigatório</span>}
              </p>

              <div className="space-y-3">
                {i > 0 && (
                  <Field label="Esperar (dias úteis após o passo anterior)">
                    <input
                      type="number"
                      name={`step-${i}-wait`}
                      min={0}
                      defaultValue={i === 1 ? 3 : 4}
                      className={inputClass}
                    />
                  </Field>
                )}

                <Field label={i === 0 ? 'Assunto' : 'Assunto (opcional)'}>
                  <input
                    name={`step-${i}-subject`}
                    required={i === 0}
                    defaultValue={PLACEHOLDERS[i]?.subject ?? ''}
                    className={inputClass}
                  />
                </Field>

                <Field label="Corpo (HTML simples)">
                  <textarea
                    name={`step-${i}-body`}
                    rows={i === 0 ? 8 : 4}
                    defaultValue={PLACEHOLDERS[i]?.body ?? ''}
                    className={`${inputClass} font-mono text-xs`}
                  />
                </Field>
              </div>
            </div>
          ))}
        </Card>

        <Button type="submit">Criar campanha</Button>
      </form>
    </>
  )
}
