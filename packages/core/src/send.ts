import {
  asc,
  campaignSteps,
  campaigns,
  contacts,
  enrollments,
  eq,
  messages,
  sendingAccounts,
  workspaces,
  type Database,
} from '@disparei/db'
import { createProvider, domainFromEmail, generateMessageId, SendError } from '@disparei/email'
import { hasCapacityNow, loadCapacities, selectAccount } from './capacity'
import {
  appendFooter,
  buildComplianceHeaders,
  buildFooterHtml,
  buildFooterText,
  buildReplyToAddress,
  buildUnsubscribeUrl,
} from './compliance'
import { decryptSecret } from './crypto'
import { contactToContext, renderStep } from './renderer'
import { computeNextSendAt, isWithinSendWindow, startOfDayInZone } from './schedule'
import { isSuppressed } from './suppression'

export type SendJob = {
  enrollmentId: string
  /** Passo que este job envia. Guarda contra reprocessar um passo já enviado. */
  stepPosition: number
}

export type SendDeps = {
  db: Database
  encryptionKey: string
  tokenSecret: string
  appUrl: string
  inboundDomain: string
  now?: () => Date
}

export type SendOutcome =
  | { status: 'sent'; messageId: string }
  | { status: 'retry'; reason: string; attempt: number }
  | { status: 'skipped'; reason: SkipReason }

export type SkipReason =
  | 'enrollment_inactive'
  | 'campaign_inactive'
  | 'sequence_finished'
  | 'suppressed'
  | 'outside_window'
  | 'no_capacity'
  | 'already_sent'
  | 'permanent_failure'

/** Tentativas antes de pausar o enrollment para inspeção manual. */
export const MAX_SEND_ATTEMPTS = 4

/** Backoff entre tentativas: 5, 15, 45 minutos. */
export function backoffMinutes(attempt: number): number {
  return 5 * 3 ** (attempt - 1)
}

/** Fallback em texto puro. Multipart melhora entregabilidade e acessibilidade. */
export function htmlToText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h[1-6]|li|tr)>/gi, '\n')
    .replace(/<li[^>]*>/gi, '- ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/**
 * Envia um passo da cadência.
 *
 * Toda guarda é reavaliada AQUI, no instante do envio: entre o agendamento e
 * a execução podem passar horas, e nesse intervalo o prospect pode ter
 * respondido, descadastrado ou entrado na supressão por outra campanha.
 * Enviar mesmo assim é o erro que gera reclamação — e reclamação derruba
 * reputação de domínio.
 */
export async function processSendJob(job: SendJob, deps: SendDeps): Promise<SendOutcome> {
  const now = deps.now?.() ?? new Date()

  const [row] = await deps.db
    .select({
      enrollment: enrollments,
      contact: contacts,
      campaign: campaigns,
      workspace: workspaces,
    })
    .from(enrollments)
    .innerJoin(contacts, eq(enrollments.contactId, contacts.id))
    .innerJoin(campaigns, eq(enrollments.campaignId, campaigns.id))
    .innerJoin(workspaces, eq(enrollments.workspaceId, workspaces.id))
    .where(eq(enrollments.id, job.enrollmentId))
    .limit(1)

  if (!row) return { status: 'skipped', reason: 'enrollment_inactive' }
  const { enrollment, contact, campaign, workspace } = row

  if (enrollment.status !== 'active') {
    return { status: 'skipped', reason: 'enrollment_inactive' }
  }
  if (campaign.status !== 'active') {
    return { status: 'skipped', reason: 'campaign_inactive' }
  }
  if (enrollment.currentStep !== job.stepPosition) {
    return { status: 'skipped', reason: 'already_sent' }
  }

  if (await isSuppressed(deps.db, enrollment.workspaceId, contact.email)) {
    await deps.db
      .update(enrollments)
      .set({ status: 'unsubscribed', nextSendAt: null })
      .where(eq(enrollments.id, enrollment.id))
    return { status: 'skipped', reason: 'suppressed' }
  }

  if (!isWithinSendWindow(now, campaign.sendWindow)) {
    return { status: 'skipped', reason: 'outside_window' }
  }

  const steps = await deps.db
    .select()
    .from(campaignSteps)
    .where(eq(campaignSteps.campaignId, campaign.id))
    .orderBy(asc(campaignSteps.position))

  const step = steps[job.stepPosition]
  if (!step) {
    await deps.db
      .update(enrollments)
      .set({ status: 'finished', nextSendAt: null })
      .where(eq(enrollments.id, enrollment.id))
    return { status: 'skipped', reason: 'sequence_finished' }
  }

  const capacities = await loadCapacities(deps.db, campaign.sendingAccountIds, now)
  const chosen = selectAccount(capacities)
  if (!chosen) return { status: 'skipped', reason: 'no_capacity' }

  const dayStart = startOfDayInZone(now, chosen.timezone)
  if (!(await hasCapacityNow(deps.db, chosen.accountId, chosen.effectiveCap, dayStart))) {
    return { status: 'skipped', reason: 'no_capacity' }
  }

  const [account] = await deps.db
    .select()
    .from(sendingAccounts)
    .where(eq(sendingAccounts.id, chosen.accountId))
    .limit(1)
  if (!account) return { status: 'skipped', reason: 'no_capacity' }

  // ---- Renderização -------------------------------------------------------

  const isFollowUp = job.stepPosition > 0 && step.sameThread
  const rendered = renderStep({
    subjectVariants: step.subjectVariants,
    bodyVariants: step.bodyVariants,
    context: contactToContext(contact),
    contactId: contact.id,
    stepId: step.id,
    threadSubject: isFollowUp ? enrollment.threadSubject : null,
  })

  const unsubscribeUrl = buildUnsubscribeUrl(deps.appUrl, enrollment.id, deps.tokenSecret)
  const complianceCtx = { workspace, unsubscribeUrl }

  // O rodapé é concatenado aqui, fora do editor de template: o operador não
  // pode removê-lo, porque é ele que sustenta a base legal exigida pela LGPD.
  const html = appendFooter(rendered.body, buildFooterHtml(complianceCtx))
  const text = `${htmlToText(rendered.body)}\n${buildFooterText(complianceCtx)}`

  const messageId = generateMessageId(domainFromEmail(account.fromEmail))
  const replyTo = buildReplyToAddress(enrollment.id, deps.inboundDomain, deps.tokenSecret)

  const [inserted] = await deps.db
    .insert(messages)
    .values({
      workspaceId: enrollment.workspaceId,
      enrollmentId: enrollment.id,
      stepId: step.id,
      sendingAccountId: account.id,
      stepPosition: job.stepPosition,
      subjectVariant: rendered.subjectVariant,
      bodyVariant: rendered.bodyVariant,
      subject: rendered.subject,
      bodyRendered: html,
      rfcMessageId: messageId,
      status: 'queued',
    })
    .returning({ id: messages.id })

  if (!inserted) throw new Error('Falha ao registrar a mensagem antes do envio')

  // ---- Envio --------------------------------------------------------------

  const provider = createProvider(
    account.provider,
    decryptSecret(account.credentials, deps.encryptionKey),
  )

  try {
    const result = await provider.send({
      from: { name: account.fromName, email: account.fromEmail },
      to: contact.email,
      replyTo,
      subject: rendered.subject,
      html,
      text,
      messageId,
      // O encadeamento usa o Message-ID que NÓS geramos e gravamos, então não
      // depende de o provedor devolver esse valor.
      inReplyTo: isFollowUp ? enrollment.threadMessageIds.at(-1) : undefined,
      references: isFollowUp ? enrollment.threadMessageIds : undefined,
      headers: buildComplianceHeaders({
        unsubscribeUrl,
        privacyEmail: workspace.privacyEmail,
      }),
      tags: { campaign: campaign.id, step: String(job.stepPosition) },
    })

    await deps.db.transaction(async (tx) => {
      await tx
        .update(messages)
        .set({
          status: 'sent',
          sentAt: now,
          providerMessageId: result.providerId,
          rfcMessageId: result.rfcMessageId,
        })
        .where(eq(messages.id, inserted.id))

      const nextStep = steps[job.stepPosition + 1]
      const threadIds = [...enrollment.threadMessageIds, result.rfcMessageId]

      await tx
        .update(enrollments)
        .set({
          currentStep: job.stepPosition + 1,
          threadMessageIds: threadIds,
          threadSubject: enrollment.threadSubject ?? rendered.subject,
          sendAttempts: 0, // zera para o próximo passo
          lastError: null,
          ...(nextStep
            ? { nextSendAt: computeNextSendAt(now, nextStep.waitDays, campaign.sendWindow) }
            : { status: 'finished' as const, nextSendAt: null }),
        })
        .where(eq(enrollments.id, enrollment.id))
    })

    return { status: 'sent', messageId: inserted.id }
  } catch (error) {
    const sendError = error instanceof SendError ? error : null
    const message = (error as Error).message.slice(0, 1000)
    const attempt = enrollment.sendAttempts + 1

    await deps.db
      .update(messages)
      .set({ status: 'failed', error: message })
      .where(eq(messages.id, inserted.id))

    const permanent = sendError !== null && !sendError.options.retryable
    const exhausted = attempt >= MAX_SEND_ATTEMPTS

    if (permanent || exhausted) {
      // Pausar em vez de seguir tentando: credencial inválida ou 4xx não
      // melhoram com repetição, e insistir só queima reputação e adia o
      // diagnóstico.
      await deps.db
        .update(enrollments)
        .set({
          status: 'paused',
          nextSendAt: null,
          sendAttempts: attempt,
          lastError: message,
        })
        .where(eq(enrollments.id, enrollment.id))

      return { status: 'skipped', reason: 'permanent_failure' }
    }

    // Falha transitória: reagenda com backoff. Sem fila externa, o retry é
    // simplesmente um `nextSendAt` no futuro.
    const retryAt = new Date(now.getTime() + backoffMinutes(attempt) * 60_000)

    await deps.db
      .update(enrollments)
      .set({ sendAttempts: attempt, lastError: message, nextSendAt: retryAt })
      .where(eq(enrollments.id, enrollment.id))

    return { status: 'retry', reason: message, attempt }
  }
}
