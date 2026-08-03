import Link from 'next/link'
import { campaigns, count, db, desc, enrollments, eq, sql } from '@disparei/db'
import { Badge, Card, Empty, PageHeader } from '@/components/ui'
import { requireWorkspace } from '@/lib/session'

export const dynamic = 'force-dynamic'

export default async function CampanhasPage() {
  const workspace = await requireWorkspace()

  const rows = await db()
    .select({
      id: campaigns.id,
      name: campaigns.name,
      status: campaigns.status,
      createdAt: campaigns.createdAt,
      total: count(enrollments.id),
      active: sql<number>`count(*) filter (where ${enrollments.status} = 'active')::int`,
      replied: sql<number>`count(*) filter (where ${enrollments.status} = 'replied')::int`,
    })
    .from(campaigns)
    .leftJoin(enrollments, eq(enrollments.campaignId, campaigns.id))
    .where(eq(campaigns.workspaceId, workspace.id))
    .groupBy(campaigns.id)
    .orderBy(desc(campaigns.createdAt))

  return (
    <>
      <PageHeader
        title="Campanhas"
        description="Uma campanha é uma sequência de 4 a 7 toques. Sequências mais curtas desistem antes de o follow-up ter chance."
        action={
          <Link
            href="/campanhas/nova"
            className="rounded-lg bg-[var(--color-accent)] px-3 py-2 text-sm font-medium text-white transition hover:opacity-90"
          >
            Nova campanha
          </Link>
        }
      />

      {rows.length === 0 ? (
        <Empty
          title="Nenhuma campanha ainda"
          hint="Importe uma lista em Contatos, configure uma caixa de envio e crie sua primeira sequência."
        />
      ) : (
        <Card className="divide-y divide-[var(--color-border)]">
          {rows.map((c) => (
            <Link
              key={c.id}
              href={`/campanhas/${c.id}`}
              className="flex flex-wrap items-center justify-between gap-3 p-4 transition hover:bg-[var(--color-bg)]"
            >
              <div>
                <p className="text-sm font-medium">{c.name}</p>
                <p className="text-xs text-[var(--color-muted)]">
                  {c.total} matriculados · {c.active} em cadência · {c.replied} responderam
                </p>
              </div>
              <Badge
                tone={c.status === 'active' ? 'green' : c.status === 'paused' ? 'amber' : 'neutral'}
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
