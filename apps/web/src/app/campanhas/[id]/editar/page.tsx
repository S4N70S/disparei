import { notFound } from 'next/navigation'
import {
  and,
  asc,
  campaignSteps,
  campaigns,
  db,
  eq,
  inArray,
  lists,
  messages,
  sendingAccounts,
} from '@disparei/db'
import { TOUCH_LIBRARY, htmlToBlocks, type Block } from '@disparei/core'
import { CampaignBuilder } from '@/components/campaign-builder'
import type { BuilderStep } from '@/components/campaign-builder/types'
import { requireWorkspace } from '@/lib/session'

export const dynamic = 'force-dynamic'

export default async function EditarCampanhaPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
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

  // Um passo é travado quando já produziu envio.
  const sent =
    steps.length > 0
      ? await database
          .selectDistinct({ stepId: messages.stepId })
          .from(messages)
          .where(inArray(messages.stepId, steps.map((s) => s.id)))
      : []
  const locked = new Set(sent.map((r) => r.stepId).filter((x): x is string => x !== null))

  const allLists = await database.select().from(lists).where(eq(lists.workspaceId, workspace.id))
  const accounts = await database
    .select()
    .from(sendingAccounts)
    .where(eq(sendingAccounts.workspaceId, workspace.id))

  const initialSteps: BuilderStep[] = steps.map((s) => {
    // Campanha criada antes dos blocos existirem não tem bodyBlocks —
    // reconstruímos a partir do HTML para não apagar o corpo ao abrir.
    const stored = s.bodyBlocks as Block[][] | null
    const variants = s.bodyVariants.map((html, i) => ({
      subject: s.subjectVariants[i] ?? '',
      blocks: stored?.[i] ?? htmlToBlocks(html),
    }))

    return {
      key: s.id,
      id: s.id,
      label: s.label ?? `Toque ${s.position + 1}`,
      purpose: s.purpose ?? undefined,
      waitDays: s.waitDays,
      sameThread: s.sameThread,
      enabled: s.enabled,
      locked: locked.has(s.id),
      variants: variants.length > 0 ? variants : [{ subject: '', blocks: [] }],
    }
  })

  return (
    <CampaignBuilder
      options={{
        lists: allLists.map((l) => ({ id: l.id, name: l.name })),
        accounts: accounts.map((a) => ({
          id: a.id,
          fromName: a.fromName,
          fromEmail: a.fromEmail,
          provider: a.provider,
        })),
        library: TOUCH_LIBRARY,
      }}
      initial={{
        id: campaign.id,
        name: campaign.name,
        listId: campaign.listId ?? allLists[0]?.id ?? '',
        sendingAccountIds: campaign.sendingAccountIds,
        sendWindow: campaign.sendWindow,
        dailyCap: campaign.dailyCap,
        steps: initialSteps,
      }}
    />
  )
}
