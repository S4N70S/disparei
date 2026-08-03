import {
  and,
  campaigns,
  count,
  enrollments,
  eq,
  isNotNull,
  messages,
  replies,
  sql,
  type Database,
} from '@disparei/db'

export type FunnelCounts = {
  sent: number
  delivered: number
  opened: number
  clicked: number
  bounced: number
  complained: number
  replied: number
  positiveReplies: number
  unsubscribed: number
}

export type FunnelRates = {
  deliveryRate: number
  bounceRate: number
  complaintRate: number
  openRate: number
  clickRate: number
  /** A métrica que importa. Tudo acima existe para sustentar esta. */
  replyRate: number
  positiveReplyRate: number
  unsubscribeRate: number
}

/** Limites operacionais do Resend: acima deles a conta é suspensa sem aviso. */
export const BOUNCE_RATE_LIMIT = 0.04
export const COMPLAINT_RATE_LIMIT = 0.0008

const ratio = (numerator: number, denominator: number): number =>
  denominator === 0 ? 0 : numerator / denominator

/**
 * Bounce e reclamação são calculados sobre ENVIADOS, não sobre entregues.
 *
 * Usar entregues no denominador é o erro clássico: ele exclui justamente os
 * bounces do cálculo e faz a taxa parecer menor do que o provedor enxerga.
 * Como é essa taxa que dispara a suspensão da conta, ela precisa bater com a
 * régua do provedor, não com a que nos favorece.
 */
export function computeRates(c: FunnelCounts): FunnelRates {
  return {
    deliveryRate: ratio(c.delivered, c.sent),
    bounceRate: ratio(c.bounced, c.sent),
    complaintRate: ratio(c.complained, c.sent),
    // Aberturas e cliques sobre entregues — quem não recebeu não podia abrir.
    openRate: ratio(c.opened, c.delivered),
    clickRate: ratio(c.clicked, c.delivered),
    replyRate: ratio(c.replied, c.delivered),
    positiveReplyRate: ratio(c.positiveReplies, c.delivered),
    unsubscribeRate: ratio(c.unsubscribed, c.delivered),
  }
}

export type HealthLevel = 'ok' | 'warning' | 'critical'

export type HealthCheck = {
  level: HealthLevel
  bounce: HealthLevel
  complaint: HealthLevel
  messages: string[]
}

/**
 * Semáforo de reputação.
 *
 * Avisa ANTES do limite, não quando ele já foi cruzado: quando a conta é
 * suspensa, o histórico de campanhas vai junto e não há o que corrigir.
 * Abaixo de 50 envios não opinamos — 1 bounce em 10 daria 10% e seria só
 * ruído estatístico.
 */
export function checkHealth(counts: FunnelCounts, rates: FunnelRates): HealthCheck {
  const messagesOut: string[] = []
  const MIN_VOLUME = 50

  if (counts.sent < MIN_VOLUME) {
    return { level: 'ok', bounce: 'ok', complaint: 'ok', messages: [] }
  }

  const grade = (rate: number, limit: number): HealthLevel => {
    if (rate >= limit) return 'critical'
    if (rate >= limit * 0.6) return 'warning'
    return 'ok'
  }

  const bounce = grade(rates.bounceRate, BOUNCE_RATE_LIMIT)
  const complaint = grade(rates.complaintRate, COMPLAINT_RATE_LIMIT)

  if (bounce === 'critical') {
    messagesOut.push(
      `Bounce em ${(rates.bounceRate * 100).toFixed(1)}%, acima do limite de 4%. Pare os envios e valide a lista antes de continuar.`,
    )
  } else if (bounce === 'warning') {
    messagesOut.push(
      `Bounce em ${(rates.bounceRate * 100).toFixed(1)}%, se aproximando do limite de 4%.`,
    )
  }

  if (complaint === 'critical') {
    messagesOut.push(
      `Reclamações em ${(rates.complaintRate * 100).toFixed(2)}%, acima do limite de 0,08%. Revise segmentação e copy.`,
    )
  } else if (complaint === 'warning') {
    messagesOut.push(
      `Reclamações em ${(rates.complaintRate * 100).toFixed(2)}%, se aproximando do limite de 0,08%.`,
    )
  }

  const worst: HealthLevel =
    bounce === 'critical' || complaint === 'critical'
      ? 'critical'
      : bounce === 'warning' || complaint === 'warning'
        ? 'warning'
        : 'ok'

  return { level: worst, bounce, complaint, messages: messagesOut }
}

export function formatPercent(value: number, digits = 1): string {
  return `${(value * 100).toFixed(digits)}%`
}

// ---------------------------------------------------------------------------
// Consultas
// ---------------------------------------------------------------------------

export async function loadFunnel(
  db: Database,
  workspaceId: string,
  campaignId?: string,
): Promise<FunnelCounts> {
  const scope = campaignId
    ? and(eq(messages.workspaceId, workspaceId), eq(campaigns.id, campaignId))
    : eq(messages.workspaceId, workspaceId)

  const [row] = await db
    .select({
      sent: count(messages.sentAt),
      delivered: sql<number>`count(*) filter (where ${messages.deliveredAt} is not null)::int`,
      opened: sql<number>`count(*) filter (where ${messages.openedAt} is not null)::int`,
      clicked: sql<number>`count(*) filter (where ${messages.clickedAt} is not null)::int`,
      bounced: sql<number>`count(*) filter (where ${messages.bouncedAt} is not null)::int`,
      complained: sql<number>`count(*) filter (where ${messages.complainedAt} is not null)::int`,
    })
    .from(messages)
    .innerJoin(enrollments, eq(messages.enrollmentId, enrollments.id))
    .innerJoin(campaigns, eq(enrollments.campaignId, campaigns.id))
    .where(scope)

  const enrollmentScope = campaignId
    ? and(eq(enrollments.workspaceId, workspaceId), eq(enrollments.campaignId, campaignId))
    : eq(enrollments.workspaceId, workspaceId)

  const [enrollmentRow] = await db
    .select({
      replied: sql<number>`count(*) filter (where ${enrollments.status} = 'replied')::int`,
      unsubscribed: sql<number>`count(*) filter (where ${enrollments.status} = 'unsubscribed')::int`,
    })
    .from(enrollments)
    .where(enrollmentScope)

  const replyScope = campaignId
    ? and(eq(replies.workspaceId, workspaceId), eq(enrollments.campaignId, campaignId))
    : eq(replies.workspaceId, workspaceId)

  const [positiveRow] = await db
    .select({ positive: count() })
    .from(replies)
    .innerJoin(enrollments, eq(replies.enrollmentId, enrollments.id))
    .where(and(replyScope, eq(replies.classification, 'interested')))

  return {
    sent: row?.sent ?? 0,
    delivered: row?.delivered ?? 0,
    opened: row?.opened ?? 0,
    clicked: row?.clicked ?? 0,
    bounced: row?.bounced ?? 0,
    complained: row?.complained ?? 0,
    replied: enrollmentRow?.replied ?? 0,
    positiveReplies: positiveRow?.positive ?? 0,
    unsubscribed: enrollmentRow?.unsubscribed ?? 0,
  }
}

export type StepPerformance = {
  stepPosition: number
  sent: number
  delivered: number
  replied: number
  replyRate: number
}

/**
 * Desempenho por passo.
 *
 * Existe para tornar visível o fato que sustenta a sequência inteira: uma
 * fatia grande das respostas vem dos passos DEPOIS do primeiro e-mail. Quem
 * olha só o agregado conclui que follow-up não funciona e corta justamente a
 * parte que traz retorno.
 */
export async function loadStepPerformance(
  db: Database,
  workspaceId: string,
  campaignId: string,
): Promise<StepPerformance[]> {
  const rows = await db
    .select({
      stepPosition: messages.stepPosition,
      sent: count(messages.sentAt),
      delivered: sql<number>`count(*) filter (where ${messages.deliveredAt} is not null)::int`,
      replied: sql<number>`count(distinct ${replies.enrollmentId})::int`,
    })
    .from(messages)
    .innerJoin(enrollments, eq(messages.enrollmentId, enrollments.id))
    .leftJoin(
      replies,
      and(
        eq(replies.enrollmentId, enrollments.id),
        sql`${replies.receivedAt} >= ${messages.sentAt}`,
      ),
    )
    .where(and(eq(messages.workspaceId, workspaceId), eq(enrollments.campaignId, campaignId)))
    .groupBy(messages.stepPosition)
    .orderBy(messages.stepPosition)

  return rows.map((r) => ({
    stepPosition: r.stepPosition,
    sent: r.sent,
    delivered: r.delivered,
    replied: r.replied,
    replyRate: ratio(r.replied, r.delivered),
  }))
}

export type VariantPerformance = {
  stepPosition: number
  subjectVariant: number
  sent: number
  delivered: number
  opened: number
  replied: number
}

export async function loadVariantPerformance(
  db: Database,
  workspaceId: string,
  campaignId: string,
): Promise<VariantPerformance[]> {
  const rows = await db
    .select({
      stepPosition: messages.stepPosition,
      subjectVariant: messages.subjectVariant,
      sent: count(messages.sentAt),
      delivered: sql<number>`count(*) filter (where ${messages.deliveredAt} is not null)::int`,
      opened: sql<number>`count(*) filter (where ${messages.openedAt} is not null)::int`,
      replied: sql<number>`count(distinct ${replies.enrollmentId})::int`,
    })
    .from(messages)
    .innerJoin(enrollments, eq(messages.enrollmentId, enrollments.id))
    .leftJoin(replies, eq(replies.enrollmentId, enrollments.id))
    .where(
      and(
        eq(messages.workspaceId, workspaceId),
        eq(enrollments.campaignId, campaignId),
        isNotNull(messages.sentAt),
      ),
    )
    .groupBy(messages.stepPosition, messages.subjectVariant)
    .orderBy(messages.stepPosition, messages.subjectVariant)

  return rows
}
