import { revalidatePath } from 'next/cache'
import {
  campaigns,
  contacts,
  db,
  desc,
  enrollments,
  eq,
  replies,
  type Reply,
} from '@disparei/db'
import { suppressEmail } from '@disparei/core'
import { Badge, Button, Card, Empty, PageHeader } from '@/components/ui'
import { requireWorkspace } from '@/lib/session'

export const dynamic = 'force-dynamic'

const TONE: Record<Reply['classification'], 'green' | 'amber' | 'red' | 'neutral' | 'indigo'> = {
  interested: 'green',
  not_interested: 'amber',
  negative: 'red',
  out_of_office: 'neutral',
  unclassified: 'indigo',
}

const LABEL: Record<Reply['classification'], string> = {
  interested: 'Interessado',
  not_interested: 'Sem interesse',
  negative: 'Pediu remoção',
  out_of_office: 'Ausente',
  unclassified: 'A classificar',
}

export default async function RespostasPage() {
  const workspace = await requireWorkspace()

  const rows = await db()
    .select({
      reply: replies,
      contactEmail: contacts.email,
      contactName: contacts.firstName,
      company: contacts.company,
      campaignName: campaigns.name,
    })
    .from(replies)
    .leftJoin(enrollments, eq(replies.enrollmentId, enrollments.id))
    .leftJoin(contacts, eq(enrollments.contactId, contacts.id))
    .leftJoin(campaigns, eq(enrollments.campaignId, campaigns.id))
    .where(eq(replies.workspaceId, workspace.id))
    .orderBy(desc(replies.receivedAt))
    .limit(100)

  async function reclassify(formData: FormData) {
    'use server'
    const id = String(formData.get('id'))
    const classification = String(formData.get('classification')) as Reply['classification']

    await db()
      .update(replies)
      .set({ classification, readAt: new Date() })
      .where(eq(replies.id, id))

    revalidatePath('/respostas')
  }

  async function suppress(formData: FormData) {
    'use server'
    const ws = await requireWorkspace()
    const email = String(formData.get('email'))

    await suppressEmail(db(), {
      workspaceId: ws.id,
      email,
      reason: 'manual',
      note: 'Suprimido manualmente pela caixa de respostas',
    })

    revalidatePath('/respostas')
  }

  return (
    <>
      <PageHeader
        title="Respostas"
        description="Toda resposta interrompe a cadência automaticamente — inclusive auto-resposta de ausência. A retomada é sempre decisão sua."
      />

      {rows.length === 0 ? (
        <Empty
          title="Nenhuma resposta ainda"
          hint="As respostas chegam aqui pelo endereço de Reply-To da plataforma, não na sua caixa pessoal."
        />
      ) : (
        <div className="space-y-3">
          {rows.map(({ reply, contactEmail, contactName, company, campaignName }) => (
            <Card key={reply.id} className="p-4">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-medium">
                    {contactName ?? reply.fromName ?? contactEmail ?? reply.fromEmail}
                    {company && (
                      <span className="font-normal text-[var(--color-muted)]"> · {company}</span>
                    )}
                  </p>
                  <p className="text-xs text-[var(--color-muted)]">
                    {reply.fromEmail}
                    {campaignName && ` · ${campaignName}`} ·{' '}
                    {reply.receivedAt.toLocaleString('pt-BR')}
                  </p>
                </div>
                <Badge tone={TONE[reply.classification]}>{LABEL[reply.classification]}</Badge>
              </div>

              {reply.subject && <p className="mb-1 text-sm font-medium">{reply.subject}</p>}
              <p className="mb-3 whitespace-pre-wrap text-sm text-[var(--color-muted)]">
                {(reply.text ?? '').slice(0, 800) || '(sem corpo em texto)'}
              </p>

              <div className="flex flex-wrap items-center gap-2">
                <form action={reclassify} className="flex items-center gap-2">
                  <input type="hidden" name="id" value={reply.id} />
                  <select
                    name="classification"
                    defaultValue={reply.classification}
                    className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1.5 text-xs"
                  >
                    {Object.entries(LABEL).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                  <Button type="submit" variant="ghost" className="!px-2 !py-1.5 !text-xs">
                    Salvar
                  </Button>
                </form>

                <form action={suppress}>
                  <input type="hidden" name="email" value={reply.fromEmail} />
                  <Button type="submit" variant="ghost" className="!px-2 !py-1.5 !text-xs">
                    Nunca mais contatar
                  </Button>
                </form>
              </div>
            </Card>
          ))}
        </div>
      )}
    </>
  )
}
