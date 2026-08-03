'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import {
  and,
  campaignSteps,
  campaigns,
  contacts,
  db,
  enrollments,
  eq,
  listContacts,
  type SendWindow,
} from '@disparei/db'
import { DEFAULT_SEND_WINDOW, filterSuppressed, staggeredSendTimes } from '@disparei/core'
import { requireWorkspace } from '@/lib/session'

function parseSendWindow(formData: FormData): SendWindow {
  const days = formData.getAll('daysOfWeek').map(Number).filter(Number.isFinite)
  const [startHour = 9] = [Number(formData.get('startHour'))].filter(Number.isFinite)
  const [endHour = 17] = [Number(formData.get('endHour'))].filter(Number.isFinite)

  return {
    daysOfWeek: days.length > 0 ? days : DEFAULT_SEND_WINDOW.daysOfWeek,
    startMinute: startHour * 60,
    endMinute: endHour * 60,
    timezone: String(formData.get('timezone') || DEFAULT_SEND_WINDOW.timezone),
  }
}

/** Extrai os passos do formulário: `step-0-subject`, `step-0-body`, `step-0-wait`. */
function parseSteps(formData: FormData) {
  const steps: Array<{ subject: string; body: string; waitDays: number }> = []

  for (let i = 0; i < 12; i++) {
    const subject = String(formData.get(`step-${i}-subject`) ?? '').trim()
    const body = String(formData.get(`step-${i}-body`) ?? '').trim()
    if (!body) continue

    steps.push({
      subject,
      body,
      waitDays: Math.max(0, Number(formData.get(`step-${i}-wait`) ?? 3) || 0),
    })
  }

  return steps
}

export async function createCampaign(formData: FormData): Promise<void> {
  const workspace = await requireWorkspace()
  const database = db()

  const name = String(formData.get('name') ?? '').trim()
  const listId = String(formData.get('listId') ?? '')
  const accountIds = formData.getAll('sendingAccountIds').map(String).filter(Boolean)
  const steps = parseSteps(formData)

  if (!name) throw new Error('Informe o nome da campanha')
  if (!listId) throw new Error('Selecione uma lista')
  if (accountIds.length === 0) throw new Error('Selecione ao menos uma caixa de envio')
  if (steps.length === 0) throw new Error('Adicione ao menos um passo com corpo de e-mail')
  if (!steps[0]?.subject) throw new Error('O primeiro passo precisa de assunto')

  const campaignId = await database.transaction(async (tx) => {
    const [campaign] = await tx
      .insert(campaigns)
      .values({
        workspaceId: workspace.id,
        name,
        listId,
        status: 'draft',
        sendWindow: parseSendWindow(formData),
        sendingAccountIds: accountIds,
        dailyCap: Math.max(1, Number(formData.get('dailyCap') ?? 100) || 100),
      })
      .returning({ id: campaigns.id })

    if (!campaign) throw new Error('Falha ao criar a campanha')

    await tx.insert(campaignSteps).values(
      steps.map((step, position) => ({
        campaignId: campaign.id,
        position,
        // O primeiro passo sai imediatamente; os seguintes esperam em dias úteis.
        waitDays: position === 0 ? 0 : step.waitDays,
        // Variantes separadas por `---` viram opções de teste A/B.
        subjectVariants: step.subject
          ? step.subject.split('\n---\n').map((s) => s.trim()).filter(Boolean)
          : [''],
        bodyVariants: step.body.split('\n---\n').map((s) => s.trim()).filter(Boolean),
        // Follow-up encadeado na thread do primeiro toque.
        sameThread: position > 0,
      })),
    )

    return campaign.id
  })

  revalidatePath('/campanhas')
  redirect(`/campanhas/${campaignId}`)
}

/**
 * Matricula os contatos da lista na cadência.
 *
 * A supressão é reconferida aqui mesmo tendo sido conferida na importação: a
 * lista pode ter sido importada semanas antes, e nesse intervalo alguém pode
 * ter descadastrado por outra campanha.
 */
export async function enrollList(formData: FormData): Promise<void> {
  const workspace = await requireWorkspace()
  const database = db()
  const campaignId = String(formData.get('campaignId'))

  const [campaign] = await database
    .select()
    .from(campaigns)
    .where(and(eq(campaigns.id, campaignId), eq(campaigns.workspaceId, workspace.id)))
    .limit(1)

  if (!campaign?.listId) throw new Error('Campanha sem lista associada')

  const rows = await database
    .select({ id: contacts.id, email: contacts.email })
    .from(listContacts)
    .innerJoin(contacts, eq(listContacts.contactId, contacts.id))
    .where(and(eq(listContacts.listId, campaign.listId), eq(contacts.status, 'active')))

  if (rows.length === 0) throw new Error('A lista não tem contatos ativos')

  const suppressed = await filterSuppressed(
    database,
    workspace.id,
    rows.map((r) => r.email),
  )
  const eligible = rows.filter((r) => !suppressed.has(r.email))
  if (eligible.length === 0) throw new Error('Todos os contatos da lista estão suprimidos')

  /*
   * Cada contato recebe um horário PRÓPRIO, afastado do anterior por um
   * intervalo sorteado entre 30s e 3min, começando na próxima abertura da
   * janela — nunca "agora", que poderia ser 23h de um sábado.
   *
   * É aqui que vive o ritmo de envio. Sem fila externa, dar o mesmo horário a
   * todos faria a lista inteira vencer junta e sair em rajada, que é o padrão
   * que os filtros anti-spam reconhecem primeiro. O excedente que não cabe na
   * janela rola sozinho para o próximo dia útil.
   */
  const sendTimes = staggeredSendTimes(eligible.length, new Date(), campaign.sendWindow)

  const CHUNK = 1000
  for (let i = 0; i < eligible.length; i += CHUNK) {
    await database
      .insert(enrollments)
      .values(
        eligible.slice(i, i + CHUNK).map((c, offset) => ({
          workspaceId: workspace.id,
          campaignId,
          contactId: c.id,
          status: 'active' as const,
          currentStep: 0,
          nextSendAt: sendTimes[i + offset]!,
        })),
      )
      .onConflictDoNothing() // reexecutar não duplica matrícula
  }

  revalidatePath(`/campanhas/${campaignId}`)
}

export async function setCampaignStatus(formData: FormData): Promise<void> {
  const workspace = await requireWorkspace()
  const campaignId = String(formData.get('campaignId'))
  const status = String(formData.get('status')) as 'active' | 'paused' | 'draft' | 'finished'

  await db()
    .update(campaigns)
    .set({ status })
    .where(and(eq(campaigns.id, campaignId), eq(campaigns.workspaceId, workspace.id)))

  revalidatePath(`/campanhas/${campaignId}`)
  revalidatePath('/campanhas')
}
