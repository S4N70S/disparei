import Link from 'next/link'
import { and, campaigns, count, db, desc, enrollments, eq, replies, sql } from '@disparei/db'
import { checkHealth, computeRates, formatPercent, loadFunnel } from '@disparei/core'
import { Badge, Card, Empty, PageHeader, Stat } from '@/components/ui'
import { requireWorkspace } from '@/lib/session'

export const dynamic = 'force-dynamic'

export default async function DashboardPage() {
  const workspace = await requireWorkspace()
  const database = db()

  const funnel = await loadFunnel(database, workspace.id)
  const rates = computeRates(funnel)
  const health = checkHealth(funnel, rates)

  const activeCampaigns = await database
    .select({
      id: campaigns.id,
      name: campaigns.name,
      status: campaigns.status,
      active: sql<number>`count(*) filter (where ${enrollments.status} = 'active')::int`,
      replied: sql<number>`count(*) filter (where ${enrollments.status} = 'replied')::int`,
      total: count(enrollments.id),
    })
    .from(campaigns)
    .leftJoin(enrollments, eq(enrollments.campaignId, campaigns.id))
    .where(eq(campaigns.workspaceId, workspace.id))
    .groupBy(campaigns.id)
    .orderBy(desc(campaigns.createdAt))
    .limit(5)

  const [unread] = await database
    .select({ n: count() })
    .from(replies)
    .where(and(eq(replies.workspaceId, workspace.id), sql`${replies.readAt} is null`))

  return (
    <>
      <PageHeader
        title="Painel"
        description="A métrica que decide uma operação de outbound é a taxa de resposta. Abertura serve de contexto, não de meta."
      />

      {health.messages.length > 0 && (
        <Card
          className={`mb-6 p-4 ${health.level === 'critical' ? 'border-red-500/50' : 'border-amber-500/50'}`}
        >
          <p className="mb-1 text-sm font-semibold">
            {health.level === 'critical' ? 'Reputação em risco' : 'Atenção à reputação'}
          </p>
          <ul className="space-y-1">
            {health.messages.map((m) => (
              <li key={m} className="text-sm text-[var(--color-muted)]">
                {m}
              </li>
            ))}
          </ul>
        </Card>
      )}

      <section className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          label="Taxa de resposta"
          value={formatPercent(rates.replyRate)}
          hint={`${funnel.replied} de ${funnel.delivered} entregues`}
          emphasis
        />
        <Stat
          label="Respostas positivas"
          value={String(funnel.positiveReplies)}
          hint={formatPercent(rates.positiveReplyRate) + ' dos entregues'}
        />
        <Stat label="Enviados" value={String(funnel.sent)} hint={`${funnel.delivered} entregues`} />
        <Stat
          label="Bounce"
          value={formatPercent(rates.bounceRate)}
          hint="limite do provedor: 4%"
        />
      </section>

      <section className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          label="Abertura"
          value={formatPercent(rates.openRate)}
          hint="inflada pelo Apple MPP — use como contexto"
        />
        <Stat label="Cliques" value={formatPercent(rates.clickRate)} />
        <Stat
          label="Reclamações"
          value={formatPercent(rates.complaintRate, 2)}
          hint="limite do provedor: 0,08%"
        />
        <Stat label="Descadastros" value={formatPercent(rates.unsubscribeRate)} />
      </section>

      {(unread?.n ?? 0) > 0 && (
        <Card className="mb-6 p-4">
          <div className="flex items-center justify-between gap-4">
            <p className="text-sm">
              <span className="font-semibold">{unread?.n}</span> resposta(s) sem leitura na caixa
              unificada.
            </p>
            <Link href="/respostas" className="text-sm font-medium text-[var(--color-accent)]">
              Abrir →
            </Link>
          </div>
        </Card>
      )}

      <h2 className="mb-3 text-sm font-semibold">Campanhas recentes</h2>
      {activeCampaigns.length === 0 ? (
        <Empty
          title="Nenhuma campanha ainda"
          hint="Comece importando uma lista em Contatos e depois crie uma sequência de 4 a 7 toques."
        />
      ) : (
        <Card className="divide-y divide-[var(--color-border)]">
          {activeCampaigns.map((c) => (
            <Link
              key={c.id}
              href={`/campanhas/${c.id}`}
              className="flex flex-wrap items-center justify-between gap-3 p-4 transition hover:bg-[var(--color-bg)]"
            >
              <div>
                <p className="text-sm font-medium">{c.name}</p>
                <p className="text-xs text-[var(--color-muted)]">
                  {c.total} contatos · {c.active} em cadência · {c.replied} responderam
                </p>
              </div>
              <Badge
                tone={
                  c.status === 'active' ? 'green' : c.status === 'paused' ? 'amber' : 'neutral'
                }
              >
                {c.status}
              </Badge>
            </Link>
          ))}
        </Card>
      )}
    </>
  )
}
