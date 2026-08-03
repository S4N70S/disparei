import {
  and,
  contacts,
  desc,
  enrollments,
  eq,
  events,
  isNull,
  messages,
  replies,
  type Database,
} from '@disparei/db'
import { classifyReply, requiresSuppression } from './classification'
import { parseReplyToAddress } from './compliance'
import { suppressEmail } from './suppression'

/** Callback para remover jobs pendentes da fila (injetado pelo worker/app). */
export type CancelPendingJobs = (enrollmentId: string) => Promise<void>

// ---------------------------------------------------------------------------
// Eventos de envio (delivered / bounced / complained / opened / clicked)
// ---------------------------------------------------------------------------

export type EmailEventType =
  | 'email.sent'
  | 'email.delivered'
  | 'email.bounced'
  | 'email.complained'
  | 'email.opened'
  | 'email.clicked'
  | 'email.delivery_delayed'

export type EmailEvent = {
  type: EmailEventType
  /** `data.email_id` no payload do Resend. */
  providerMessageId: string
  createdAt: Date
}

export type EventOutcome = {
  handled: boolean
  reason?: 'unknown_message' | 'duplicate' | 'ignored'
  suppressed?: boolean
}

/**
 * Processa um evento de envio.
 *
 * Bounce e complaint suprimem na hora e encerram a cadência. Não é zelo
 * excessivo: o Resend suspende a conta sem aviso acima de 4% de bounce ou
 * 0,08% de reclamação, e continuar tentando um endereço que já deu hard
 * bounce é o jeito mais rápido de chegar lá.
 */
export async function handleEmailEvent(
  db: Database,
  event: EmailEvent,
  options: { cancelPendingJobs?: CancelPendingJobs } = {},
): Promise<EventOutcome> {
  const [message] = await db
    .select({
      id: messages.id,
      workspaceId: messages.workspaceId,
      enrollmentId: messages.enrollmentId,
      contactEmail: contacts.email,
    })
    .from(messages)
    .innerJoin(enrollments, eq(messages.enrollmentId, enrollments.id))
    .innerJoin(contacts, eq(enrollments.contactId, contacts.id))
    .where(eq(messages.providerMessageId, event.providerMessageId))
    .limit(1)

  if (!message) return { handled: false, reason: 'unknown_message' }

  switch (event.type) {
    case 'email.delivered':
      await db
        .update(messages)
        .set({ status: 'delivered', deliveredAt: event.createdAt })
        .where(eq(messages.id, message.id))
      return { handled: true }

    case 'email.opened':
      // Só a PRIMEIRA abertura. Além disso, o Apple Mail Privacy Protection
      // pré-carrega imagens e infla esse número — por isso a métrica de
      // abertura é secundária no dashboard, e a decisão se toma por resposta.
      await db
        .update(messages)
        .set({ openedAt: event.createdAt })
        .where(and(eq(messages.id, message.id), isNull(messages.openedAt)))
      return { handled: true }

    case 'email.clicked':
      await db
        .update(messages)
        .set({ clickedAt: event.createdAt })
        .where(eq(messages.id, message.id))
      return { handled: true }

    case 'email.bounced':
    case 'email.complained': {
      const isBounce = event.type === 'email.bounced'

      await db
        .update(messages)
        .set(
          isBounce
            ? { status: 'bounced', bouncedAt: event.createdAt }
            : { status: 'complained', complainedAt: event.createdAt },
        )
        .where(eq(messages.id, message.id))

      await db
        .update(enrollments)
        .set({ status: isBounce ? 'bounced' : 'unsubscribed', nextSendAt: null })
        .where(eq(enrollments.id, message.enrollmentId))

      await suppressEmail(db, {
        workspaceId: message.workspaceId,
        email: message.contactEmail,
        reason: isBounce ? 'bounce' : 'complaint',
        note: `Automático via webhook ${event.type}`,
      })

      await options.cancelPendingJobs?.(message.enrollmentId)
      return { handled: true, suppressed: true }
    }

    default:
      return { handled: false, reason: 'ignored' }
  }
}

// ---------------------------------------------------------------------------
// Respostas recebidas (Resend Inbound)
// ---------------------------------------------------------------------------

export type InboundEmail = {
  /** Destinatários — é aqui que vem o `r.<token>@inbound.<dominio>`. */
  to: string[]
  /**
   * Endereço pelo qual o provedor recebeu a mensagem.
   *
   * Conferido além do `to` porque nem sempre o token aparece lá: se a pessoa
   * responde com o endereço no Cc, ou se houve encaminhamento, o `to` traz
   * outra coisa e só o `received_for` preserva quem era o destinatário real.
   */
  receivedFor?: string[]
  from: string
  subject?: string | null
  text?: string | null
  html?: string | null
  /** Id no provedor — usado para buscar o corpo quando ele não vem no webhook. */
  emailId?: string | null
  receivedAt: Date
}

export type InboundOutcome = {
  handled: boolean
  enrollmentId?: string
  classification?: string
  bodyFetched?: boolean
  reason?: 'no_token' | 'unknown_enrollment' | 'already_replied'
}

/** Busca o corpo quando o webhook entrega só metadados. */
export type FetchInboundBody = (
  emailId: string,
) => Promise<{ text?: string | null; html?: string | null } | null>

function parseFromHeader(from: string): { email: string; name: string | null } {
  const match = from.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/)
  if (match) return { name: match[1]?.trim() || null, email: match[2]!.trim().toLowerCase() }
  return { name: null, email: from.trim().toLowerCase() }
}

/**
 * Processa uma resposta e PARA a cadência.
 *
 * A identificação vem do token assinado embutido no Reply-To, não de
 * heurística de assunto ou remetente. A diferença aparece nos casos reais:
 * a pessoa encaminha para um colega, responde de outro endereço, ou o
 * assunto vem traduzido pelo cliente de e-mail — em todos, casar por texto
 * falha e a sequência continua rodando contra alguém que já respondeu.
 */
export async function handleInboundReply(
  db: Database,
  email: InboundEmail,
  tokenSecret: string,
  options: {
    cancelPendingJobs?: CancelPendingJobs
    fetchBody?: FetchInboundBody
  } = {},
): Promise<InboundOutcome> {
  let enrollmentId: string | null = null
  for (const recipient of [...email.to, ...(email.receivedFor ?? [])]) {
    enrollmentId = parseReplyToAddress(recipient, tokenSecret)
    if (enrollmentId) break
  }
  if (!enrollmentId) return { handled: false, reason: 'no_token' }

  const [enrollment] = await db
    .select({
      id: enrollments.id,
      workspaceId: enrollments.workspaceId,
      status: enrollments.status,
      contactEmail: contacts.email,
    })
    .from(enrollments)
    .innerJoin(contacts, eq(enrollments.contactId, contacts.id))
    .where(eq(enrollments.id, enrollmentId))
    .limit(1)

  if (!enrollment) return { handled: false, reason: 'unknown_enrollment' }

  // O webhook `email.received` do Resend entrega só metadados. Sem buscar o
  // corpo, a classificação rodaria sobre string vazia e um pedido explícito
  // de remoção passaria como `unclassified`, sem suprimir ninguém.
  let text = email.text ?? null
  let html = email.html ?? null
  let bodyFetched = false

  if (!text && !html && email.emailId && options.fetchBody) {
    try {
      const fetched = await options.fetchBody(email.emailId)
      if (fetched) {
        text = fetched.text ?? null
        html = fetched.html ?? null
        bodyFetched = true
      }
    } catch {
      // Falhar aqui não pode impedir a parada da cadência: interromper o
      // envio é mais importante do que classificar. A resposta fica gravada
      // sem corpo e o operador reclassifica na inbox.
    }
  }

  const classification = classifyReply(text ?? html ?? '')
  const from = parseFromHeader(email.from)

  // A mensagem mais recente da sequência, para ancorar a resposta na thread.
  const [lastMessage] = await db
    .select({ id: messages.id })
    .from(messages)
    .where(eq(messages.enrollmentId, enrollment.id))
    .orderBy(desc(messages.sentAt))
    .limit(1)

  await db.insert(replies).values({
    workspaceId: enrollment.workspaceId,
    enrollmentId: enrollment.id,
    messageId: lastMessage?.id ?? null,
    fromEmail: from.email,
    fromName: from.name,
    subject: email.subject ?? null,
    text,
    html,
    classification,
    receivedAt: email.receivedAt,
  })

  // Qualquer resposta para a cadência — inclusive auto-resposta de férias.
  // Continuar enviando para quem já está numa conversa é o erro que queima a
  // relação, e retomar automaticamente depois seria pior ainda.
  if (enrollment.status === 'active') {
    await db
      .update(enrollments)
      .set({ status: 'replied', nextSendAt: null })
      .where(eq(enrollments.id, enrollment.id))

    await options.cancelPendingJobs?.(enrollment.id)
  }

  if (requiresSuppression(classification)) {
    await suppressEmail(db, {
      workspaceId: enrollment.workspaceId,
      email: enrollment.contactEmail,
      reason: 'negative_reply',
      note: 'Pedido de remoção identificado na resposta',
    })
  }

  return { handled: true, enrollmentId: enrollment.id, classification, bodyFetched }
}

// ---------------------------------------------------------------------------
// Log e idempotência
// ---------------------------------------------------------------------------

/**
 * Grava o evento cru e diz se ele já tinha sido processado.
 *
 * Provedores reentregam webhooks quando não recebem 2xx a tempo. Sem esta
 * barreira, uma reentrega de `email.bounced` reprocessaria a supressão — e um
 * `inbound` duplicado criaria duas respostas na inbox do vendedor.
 */
export async function recordEvent(
  db: Database,
  params: {
    workspaceId?: string | null
    source: string
    type: string
    payload: unknown
    dedupeKey?: string | null
  },
): Promise<{ isDuplicate: boolean }> {
  const inserted = await db
    .insert(events)
    .values({
      workspaceId: params.workspaceId ?? null,
      source: params.source,
      type: params.type,
      payload: params.payload as never,
      dedupeKey: params.dedupeKey ?? null,
    })
    .onConflictDoNothing()
    .returning({ id: events.id })

  return { isDuplicate: params.dedupeKey != null && inserted.length === 0 }
}
