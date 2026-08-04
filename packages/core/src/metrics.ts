import {
  and,
  campaigns,
  count,
  enrollments,
  eq,
  isNotNull,
  messages,
  replies,
  sendingAccounts,
  sql,
  type Database,
} from '@disparei/db'

/**
 * O que este canal consegue medir.
 *
 * `full` — envio via API do Resend, que devolve webhooks de entrega,
 * abertura, clique, bounce e reclamação.
 *
 * `send_only` — envio por SMTP direto. O servidor do destinatário aceita a
 * mensagem e a conversa acaba ali: **não existe confirmação de entrega em
 * SMTP**. Abertura e clique também não, porque não há domínio de tracking
 * nesse caminho, e o bounce assíncrono volta como mensagem para a caixa do
 * remetente, fora do alcance da plataforma.
 *
 * A distinção existe para o painel poder dizer "não sei" em vez de "zero".
 * Mostrar 0,0% de bounce numa campanha SMTP é pior do que não mostrar nada:
 * parece medição, é ausência de dado, e desliga em silêncio o alerta que
 * protege a reputação do domínio.
 */
export type TrackingMode = 'full' | 'send_only'

export type FunnelCounts = {
  sent: number
  delivered: number
  opened: number
  clicked: number
  bounced: number
  complained: number
  /** Recusa síncrona no envio. Mensurável nos dois canais. */
  failed: number
  replied: number
  positiveReplies: number
  unsubscribed: number
  /** Deriva o modo a partir do que foi realmente enviado. */
  sentViaSmtp: number
}

/** `null` = não mensurável neste canal. Nunca confundir com zero. */
export type FunnelRates = {
  deliveryRate: number | null
  bounceRate: number | null
  complaintRate: number | null
  openRate: number | null
  clickRate: number | null
  /** Falha na entrega ao servidor. Sempre mensurável. */
  failureRate: number
  /** A métrica que importa. Tudo acima existe para sustentar esta. */
  replyRate: number
  positiveReplyRate: number
  unsubscribeRate: number
  mode: TrackingMode
}

/** Limites operacionais do Resend: acima deles a conta é suspensa sem aviso. */
export const BOUNCE_RATE_LIMIT = 0.04
export const COMPLAINT_RATE_LIMIT = 0.0008

const ratio = (numerator: number, denominator: number): number =>
  denominator === 0 ? 0 : numerator / denominator

export function trackingModeOf(counts: Pick<FunnelCounts, 'sentViaSmtp'>): TrackingMode {
  // Basta uma mensagem por SMTP para o número de entregues deixar de ser
  // comparável — melhor tratar a campanha inteira como não rastreável.
  return counts.sentViaSmtp > 0 ? 'send_only' : 'full'
}

/**
 * Bounce e reclamação são calculados sobre ENVIADOS, não sobre entregues.
 *
 * Usar entregues no denominador é o erro clássico: ele exclui justamente os
 * bounces do cálculo e faz a taxa parecer menor do que o provedor enxerga.
 * Como é essa taxa que dispara a suspensão da conta, ela precisa bater com a
 * régua do provedor, não com a que nos favorece.
 *
 * Em `send_only`, o denominador de resposta passa a ser ENVIADOS. Sobre
 * entregues seria divisão por zero, e a taxa de resposta — o número que
 * decide a operação — apareceria como 0% mesmo com respostas chegando.
 */
export function computeRates(c: FunnelCounts): FunnelRates {
  const mode = trackingModeOf(c)
  const base = mode === 'full' ? c.delivered : c.sent

  return {
    mode,
    deliveryRate: mode === 'full' ? ratio(c.delivered, c.sent) : null,
    bounceRate: mode === 'full' ? ratio(c.bounced, c.sent) : null,
    complaintRate: mode === 'full' ? ratio(c.complained, c.sent) : null,
    openRate: mode === 'full' ? ratio(c.opened, c.delivered) : null,
    clickRate: mode === 'full' ? ratio(c.clicked, c.delivered) : null,
    failureRate: ratio(c.failed, c.sent + c.failed),
    replyRate: ratio(c.replied, base),
    positiveReplyRate: ratio(c.positiveReplies, base),
    unsubscribeRate: ratio(c.unsubscribed, base),
  }
}

export type HealthLevel = 'ok' | 'warning' | 'critical'

export type HealthCheck = {
  level: HealthLevel
  bounce: HealthLevel
  complaint: HealthLevel
  messages: string[]
  /** Avisos sobre o que este canal NÃO consegue medir. */
  blindSpots: string[]
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
  const blindSpots: string[] = []
  const MIN_VOLUME = 50

  /*
   * O ponto cego é reportado SEMPRE, inclusive com volume baixo.
   *
   * Em SMTP o bounce assíncrono não chega até aqui, então este semáforo não
   * pode protegê-lo. Silenciar isso seria o pior desfecho possível: um painel
   * verde que não está medindo nada.
   */
  if (rates.mode === 'send_only') {
    blindSpots.push(
      'Envio por SMTP não gera confirmação de entrega, abertura, clique nem bounce assíncrono. As devoluções chegam na caixa do remetente — acompanhe o Gmail da conta de envio.',
    )
    if (counts.failed > 0) {
      blindSpots.push(
        `${counts.failed} envio(s) recusado(s) pelo servidor no ato. Veja o erro em cada mensagem.`,
      )
    }
  }

  if (counts.sent < MIN_VOLUME) {
    return { level: 'ok', bounce: 'ok', complaint: 'ok', messages: [], blindSpots }
  }

  // Sem dado de bounce não há semáforo a dar — só o ponto cego acima.
  if (rates.bounceRate === null || rates.complaintRate === null) {
    return { level: 'ok', bounce: 'ok', complaint: 'ok', messages: [], blindSpots }
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

  return { level: worst, bounce, complaint, messages: messagesOut, blindSpots }
}

/** `null` vira "—": o painel diz que não sabe, em vez de fingir zero. */
export function formatPercent(value: number | null, digits = 1): string {
  if (value === null) return '—'
  return `${(value * 100).toFixed(digits)}%`
}

/** Rótulo do denominador, para o painel não mentir sobre o que foi medido. */
export function baseLabel(mode: TrackingMode): string {
  return mode === 'full' ? 'entregues' : 'enviados'
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
      failed: sql<number>`count(*) filter (where ${messages.status} = 'failed')::int`,
      /*
       * Quantas saíram por SMTP.
       *
       * Deriva o modo de rastreio do que REALMENTE aconteceu, e não da
       * configuração atual da campanha — trocar a caixa de envio depois não
       * deve reescrever a leitura do histórico.
       */
      sentViaSmtp: sql<number>`count(*) filter (where ${sendingAccounts.provider} = 'smtp' and ${messages.sentAt} is not null)::int`,
    })
    .from(messages)
    .innerJoin(enrollments, eq(messages.enrollmentId, enrollments.id))
    .innerJoin(campaigns, eq(enrollments.campaignId, campaigns.id))
    .leftJoin(sendingAccounts, eq(messages.sendingAccountId, sendingAccounts.id))
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
    failed: row?.failed ?? 0,
    sentViaSmtp: row?.sentViaSmtp ?? 0,
    replied: enrollmentRow?.replied ?? 0,
    positiveReplies: positiveRow?.positive ?? 0,
    unsubscribed: enrollmentRow?.unsubscribed ?? 0,
  }
}

export type StepPerformance = {
  stepPosition: number
  sent: number
  /** `null` quando o canal não confirma entrega (SMTP). */
  delivered: number | null
  replied: number
  /** Sobre entregues no caminho Resend, sobre enviados no SMTP. */
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
      sentViaSmtp: sql<number>`count(*) filter (where ${sendingAccounts.provider} = 'smtp' and ${messages.sentAt} is not null)::int`,
    })
    .from(messages)
    .innerJoin(enrollments, eq(messages.enrollmentId, enrollments.id))
    .leftJoin(sendingAccounts, eq(messages.sendingAccountId, sendingAccounts.id))
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

  return rows.map((r) => {
    const smtp = r.sentViaSmtp > 0
    return {
      stepPosition: r.stepPosition,
      sent: r.sent,
      delivered: smtp ? null : r.delivered,
      replied: r.replied,
      // Sem confirmação de entrega, o denominador honesto é o que saiu.
      replyRate: ratio(r.replied, smtp ? r.sent : r.delivered),
    }
  })
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
