'use server'

import { revalidatePath } from 'next/cache'
import {
  and,
  campaignSteps,
  campaigns,
  contacts,
  db,
  enrollments,
  eq,
  inArray,
  listContacts,
  messages,
  sql,
} from '@disparei/db'
import { filterSuppressed, renderBlocksToHtml, staggeredSendTimes } from '@disparei/core'
import { requireWorkspace } from '@/lib/session'
import { campaignDraftSchema, type CampaignDraft, type SaveResult } from './draft'

/**
 * Passos que já produziram envio não podem ter o conteúdo alterado.
 *
 * Mudar o texto de um toque que já saiu corromperia a atribuição do teste
 * A/B: as métricas continuariam somando na mesma variante, mas o texto seria
 * outro — e você deixaria de saber qual copy gerou qual resultado.
 */
async function lockedStepIds(database: ReturnType<typeof db>, stepIds: string[]): Promise<Set<string>> {
  if (stepIds.length === 0) return new Set()

  const rows = await database
    .selectDistinct({ stepId: messages.stepId })
    .from(messages)
    .where(inArray(messages.stepId, stepIds))

  return new Set(rows.map((r) => r.stepId).filter((id): id is string => id !== null))
}

/** Blocos → HTML. O motor de envio continua consumindo só o HTML. */
function toStepRow(step: CampaignDraft['steps'][number], position: number) {
  return {
    position,
    // O primeiro toque sai imediatamente; os seguintes esperam em dias úteis.
    waitDays: position === 0 ? 0 : step.waitDays,
    subjectVariants: step.variants.map((v) => v.subject),
    bodyVariants: step.variants.map((v) => renderBlocksToHtml(v.blocks)),
    bodyBlocks: step.variants.map((v) => v.blocks),
    sameThread: position > 0 && step.sameThread,
    label: step.label,
    purpose: step.purpose ?? null,
    enabled: step.enabled,
  }
}

/**
 * Cria ou atualiza uma campanha inteira a partir do rascunho do builder.
 *
 * Substitui o parsing de `step-N-campo` do FormData: o builder mantém a
 * sequência como estado no cliente e envia JSON validado por Zod, o que
 * permite reordenar, variantes A/B e blocos sem inventar convenção de nome
 * de campo.
 */
export async function saveCampaign(input: unknown): Promise<SaveResult> {
  const workspace = await requireWorkspace()
  const database = db()

  const parsed = campaignDraftSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Rascunho inválido' }
  }
  const draft = parsed.data

  if (!draft.steps[0]?.variants[0]?.subject.trim()) {
    return { ok: false, error: 'O primeiro toque precisa de assunto' }
  }

  const campaignValues = {
    name: draft.name,
    listId: draft.listId,
    sendWindow: draft.sendWindow,
    sendingAccountIds: draft.sendingAccountIds,
    dailyCap: draft.dailyCap,
  }

  try {
    const campaignId = await database.transaction(async (tx) => {
      // ---- Criar --------------------------------------------------------
      if (!draft.id) {
        const [created] = await tx
          .insert(campaigns)
          .values({ workspaceId: workspace.id, status: 'draft', ...campaignValues })
          .returning({ id: campaigns.id })

        if (!created) throw new Error('Falha ao criar a campanha')

        await tx
          .insert(campaignSteps)
          .values(draft.steps.map((s, i) => ({ campaignId: created.id, ...toStepRow(s, i) })))

        return created.id
      }

      // ---- Editar -------------------------------------------------------
      const [existing] = await tx
        .select({ id: campaigns.id })
        .from(campaigns)
        .where(and(eq(campaigns.id, draft.id), eq(campaigns.workspaceId, workspace.id)))
        .limit(1)

      if (!existing) throw new Error('Campanha não encontrada')

      await tx.update(campaigns).set(campaignValues).where(eq(campaigns.id, draft.id))

      const current = await tx
        .select({ id: campaignSteps.id })
        .from(campaignSteps)
        .where(eq(campaignSteps.campaignId, draft.id))

      const locked = await lockedStepIds(database, current.map((s) => s.id))
      const keptIds = new Set(draft.steps.map((s) => s.id).filter(Boolean) as string[])

      for (const id of locked) {
        if (!keptIds.has(id)) {
          throw new Error('Um toque que já foi enviado não pode ser removido')
        }
      }

      // Apaga só os passos não travados que saíram do rascunho.
      const toDelete = current.filter((s) => !keptIds.has(s.id) && !locked.has(s.id))
      if (toDelete.length > 0) {
        await tx.delete(campaignSteps).where(inArray(campaignSteps.id, toDelete.map((s) => s.id)))
      }

      /*
       * Posições saem do caminho antes de receberem o valor final.
       *
       * Há índice único em (campaign_id, position). Trocar dois toques de
       * lugar atualizando um por vez colidiria: mover A para a posição de B
       * enquanto B ainda está lá viola a restrição. Um índice único não pode
       * ser adiado no Postgres, então a saída é deslocar todo mundo para uma
       * faixa livre e depois assentar.
       */
      const keptExisting = draft.steps.filter((s) => s.id).map((s) => s.id!)
      if (keptExisting.length > 0) {
        await tx
          .update(campaignSteps)
          .set({ position: sql`${campaignSteps.position} + 1000` })
          .where(inArray(campaignSteps.id, keptExisting))
      }

      for (const [i, step] of draft.steps.entries()) {
        const row = toStepRow(step, i)

        if (step.id && locked.has(step.id)) {
          // Travado: só posição e intervalo mudam. Conteúdo fica como saiu.
          await tx
            .update(campaignSteps)
            .set({ position: row.position, waitDays: row.waitDays, enabled: row.enabled })
            .where(eq(campaignSteps.id, step.id))
          continue
        }

        if (step.id) {
          await tx.update(campaignSteps).set(row).where(eq(campaignSteps.id, step.id))
        } else {
          await tx.insert(campaignSteps).values({ campaignId: draft.id, ...row })
        }
      }

      return draft.id
    })

    revalidatePath('/campanhas')
    revalidatePath(`/campanhas/${campaignId}`)
    return { ok: true, campaignId }
  } catch (error) {
    return { ok: false, error: (error as Error).message }
  }
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
