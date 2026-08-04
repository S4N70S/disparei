import Link from 'next/link'
import { notFound } from 'next/navigation'
import { and, campaignSteps, campaigns, db, eq, sql, enrollments, asc } from '@disparei/db'
import {
  checkHealth,
  computeRates,
  formatPercent,
  loadFunnel,
  loadStepPerformance,
} from '@disparei/core'
import { Badge, Button, Card, PageHeader, Stat } from '@/components/ui'
import { requireWorkspace } from '@/lib/session'
import { enrollList, setCampaignStatus } from '../actions'

export const dynamic = 'force-dynamic'

export default async function CampanhaPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const workspace = await requireWorkspace()
  const database = db()

  const [campaign] = await database
    .select()
    .from(campaigns)
    .where(and(eq(campaigns.id, id), eq(campaigns.workspaceId, workspace.id)))
    .limit(1)

  if (!campaign) notFound()

  const steps = await database
    .select()
    .from(campaignSteps)
    .where(eq(campaignSteps.campaignId, id))
    .orderBy(asc(campaignSteps.position))

  const [enrollmentStats] = await database
    .select({
      total: sql<number>`count(*)::int`,
      active: sql<number>`count(*) filter (where ${enrollments.status} = 'active')::int`,
      replied: sql<number>`count(*) filter (where ${enrollments.status} = 'replied')::int`,
      finished: sql<number>`count(*) filter (where ${enrollments.status} = 'finished')::int`,
      bounced: sql<number>`count(*) filter (where ${enrollments.status} = 'bounced')::int`,
    })
    .from(enrollments)
    .where(eq(enrollments.campaignId, id))

  const funnel = await loadFunnel(database, workspace.id, id)
  const rates = computeRates(funnel)
  const health = checkHealth(funnel, rates)
  const stepPerf = await loadStepPerformance(database, workspace.id, id)

  const totalReplies = stepPerf.reduce((sum, s) => sum + s.replied, 0)
  const firstStepReplies = stepPerf[0]?.replied ?? 0
  const followUpShare = totalReplies > 0 ? (totalReplies - firstStepReplies) / totalReplies : 0

  const window = campaign.sendWindow
  const hhmm = (minutes: number) =>
    `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`

  return (
    <>
      <PageHeader
        title={campaign.name}
        description={`${steps.length} passos · janela ${hhmm(window.startMinute)}–${hhmm(window.endMinute)} (${window.timezone}) · teto ${campaign.dailyCap}/dia`}
        action={
          <div className="flex items-center gap-2">
            <Link
              href={`/campanhas/${campaign.id}/editar`}
              className="rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm font-medium transition hover:bg-[var(--color-bg)]"
            >
              Editar
            </Link>
            <Badge
              tone={
                campaign.status === 'active'
                  ? 'green'
                  : campaign.status === 'paused'
                    ? 'amber'
                    : 'neutral'
              }
            >
              {campaign.status}
            </Badge>
            <form action={setCampaignStatus}>
              <input type="hidden" name="campaignId" value={campaign.id} />
              <input
                type="hidden"
                name="status"
                value={campaign.status === 'active' ? 'paused' : 'active'}
              />
              <Button type="submit" variant={campaign.status === 'active' ? 'ghost' : 'primary'}>
                {campaign.status === 'active' ? 'Pausar' : 'Ativar'}
              </Button>
            </form>
          </div>
        }
      />

      {health.messages.length > 0 && (
        <Card
          className={`mb-6 p-4 ${health.level === 'critical' ? 'border-red-500/50' : 'border-amber-500/50'}`}
        >
          {health.messages.map((m) => (
            <p key={m} className="text-sm">
              {m}
            </p>
          ))}
        </Card>
      )}

      <section className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          label="Taxa de resposta"
          value={formatPercent(rates.replyRate)}
          hint={`${funnel.replied} respostas`}
          emphasis
        />
        <Stat label="Em cadência" value={String(enrollmentStats?.active ?? 0)} />
        <Stat label="Enviados" value={String(funnel.sent)} />
        <Stat label="Bounce" value={formatPercent(rates.bounceRate)} hint="limite 4%" />
      </section>

      {(enrollmentStats?.total ?? 0) === 0 && (
        <Card className="mb-6 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm">
              Nenhum contato matriculado ainda. A matrícula reconfere a lista de supressão antes de
              agendar o primeiro toque.
            </p>
            <form action={enrollList}>
              <input type="hidden" name="campaignId" value={campaign.id} />
              <Button type="submit">Matricular a lista</Button>
            </form>
          </div>
        </Card>
      )}

      <h2 className="mb-3 text-sm font-semibold">Desempenho por passo</h2>
      {stepPerf.length === 0 ? (
        <Card className="mb-6 p-4">
          <p className="text-sm text-[var(--color-muted)]">Nenhum envio ainda.</p>
        </Card>
      ) : (
        <>
          <Card className="mb-3 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-[var(--color-border)] text-left">
                <tr className="text-xs uppercase tracking-wide text-[var(--color-muted)]">
                  <th className="p-3 font-medium">Passo</th>
                  <th className="p-3 font-medium">Enviados</th>
                  <th className="p-3 font-medium">Entregues</th>
                  <th className="p-3 font-medium">Respostas</th>
                  <th className="p-3 font-medium">Taxa</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-border)]">
                {stepPerf.map((s) => (
                  <tr key={s.stepPosition}>
                    <td className="p-3 font-medium">{s.stepPosition + 1}</td>
                    <td className="p-3 tabular-nums">{s.sent}</td>
                    <td className="p-3 tabular-nums">{s.delivered}</td>
                    <td className="p-3 tabular-nums">{s.replied}</td>
                    <td className="p-3 tabular-nums">{formatPercent(s.replyRate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>

          {totalReplies > 0 && (
            <p className="mb-6 text-sm text-[var(--color-muted)]">
              {formatPercent(followUpShare, 0)} das respostas vieram dos passos posteriores ao
              primeiro e-mail. É a parte da sequência que costuma ser cortada primeiro — e é onde
              está boa parte do retorno.
            </p>
          )}
        </>
      )}

      <h2 className="mb-3 text-sm font-semibold">Sequência</h2>
      <Card className="divide-y divide-[var(--color-border)]">
        {steps.map((step) => (
          <div key={step.id} className="p-4">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium">Passo {step.position + 1}</span>
              {step.position > 0 && (
                <span className="text-xs text-[var(--color-muted)]">
                  {step.waitDays} dia(s) útil(eis) depois
                </span>
              )}
              {step.sameThread && step.position > 0 && <Badge tone="indigo">mesma thread</Badge>}
              {step.bodyVariants.length > 1 && (
                <Badge tone="neutral">{step.bodyVariants.length} variantes de corpo</Badge>
              )}
              {step.subjectVariants.filter(Boolean).length > 1 && (
                <Badge tone="neutral">
                  {step.subjectVariants.length} variantes de assunto
                </Badge>
              )}
            </div>
            {step.subjectVariants.filter(Boolean).length > 0 && (
              <p className="mb-1 text-sm font-medium">{step.subjectVariants[0]}</p>
            )}
            <p className="whitespace-pre-wrap text-sm text-[var(--color-muted)]">
              {(step.bodyVariants[0] ?? '').slice(0, 400)}
            </p>
          </div>
        ))}
      </Card>
    </>
  )
}
