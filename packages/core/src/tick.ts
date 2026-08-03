import { and, asc, campaigns, enrollments, eq, isNotNull, lte, type Database } from '@disparei/db'
import { processSendJob, type SendDeps, type SendOutcome } from './send'

export type TickDeps = Omit<SendDeps, 'db'> & {
  db: Database
  /**
   * Quantos envios no máximo por invocação.
   *
   * Baixo de propósito. Junto com o intervalo do cron, é o que define o ritmo:
   * 3 envios a cada 2 minutos ≈ 2.000/dia de teto, muito acima do que uma
   * operação de prospecção saudável usa. Manter baixo também garante que a
   * invocação termine dentro do limite de tempo da função serverless.
   */
  maxPerTick?: number
  /** Orçamento de tempo, para encerrar antes do timeout da plataforma. */
  budgetMs?: number
}

export type TickResult = {
  due: number
  sent: number
  retried: number
  skipped: number
  outcomes: Array<{ enrollmentId: string; outcome: SendOutcome }>
  exhaustedBudget: boolean
}

/**
 * Uma passada do agendador.
 *
 * Substitui o worker contínuo: em vez de uma fila externa segurar os envios
 * com atraso, cada contato carrega o próprio horário em `nextSendAt` e esta
 * função colhe quem já venceu. O espaçamento entre envios é gravado no banco
 * no momento da matrícula (ver `staggeredSendTimes`), não na fila.
 */
export async function tick(deps: TickDeps): Promise<TickResult> {
  const now = deps.now?.() ?? new Date()
  const maxPerTick = deps.maxPerTick ?? 3
  const budgetMs = deps.budgetMs ?? 45_000
  const startedAt = Date.now()

  const result: TickResult = {
    due: 0,
    sent: 0,
    retried: 0,
    skipped: 0,
    outcomes: [],
    exhaustedBudget: false,
  }

  const due = await deps.db
    .select({
      enrollmentId: enrollments.id,
      stepPosition: enrollments.currentStep,
    })
    .from(enrollments)
    .innerJoin(campaigns, eq(enrollments.campaignId, campaigns.id))
    .where(
      and(
        eq(enrollments.status, 'active'),
        eq(campaigns.status, 'active'),
        isNotNull(enrollments.nextSendAt),
        lte(enrollments.nextSendAt, now),
      ),
    )
    // Mais atrasado primeiro: quem venceu antes não pode ser preterido
    // indefinidamente por matrículas novas.
    .orderBy(asc(enrollments.nextSendAt))
    .limit(maxPerTick)

  result.due = due.length

  for (const item of due) {
    if (Date.now() - startedAt > budgetMs) {
      // Sai limpo antes do timeout; o que sobrou continua vencido e o próximo
      // tick pega. Ser interrompido no meio de um envio deixaria a mensagem
      // gravada como `queued` sem ter saído.
      result.exhaustedBudget = true
      break
    }

    const outcome = await processSendJob(
      { enrollmentId: item.enrollmentId, stepPosition: item.stepPosition },
      deps,
    )

    result.outcomes.push({ enrollmentId: item.enrollmentId, outcome })
    if (outcome.status === 'sent') result.sent++
    else if (outcome.status === 'retry') result.retried++
    else result.skipped++
  }

  return result
}
