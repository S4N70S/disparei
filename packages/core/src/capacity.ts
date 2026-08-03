import { and, eq, gte, inArray, messages, sendingAccounts, sql, type Database } from '@disparei/db'
import { effectiveDailyCap } from './warmup'
import { startOfDayInZone } from './schedule'

export type AccountCapacity = {
  accountId: string
  fromName: string
  fromEmail: string
  domain: string
  replyToken: string
  timezone: string
  effectiveCap: number
  sentToday: number
}

/**
 * Teto por domínio remetente.
 *
 * O cap por caixa não basta: cinco caixas de 50 no mesmo domínio somam 250/dia
 * e a reputação é avaliada no domínio, não na caixa. Este teto é o que impede
 * escalar caixas para furar o limite sem querer.
 */
export const DEFAULT_DOMAIN_DAILY_CAP = 250

export function remainingCapacity(c: AccountCapacity): number {
  return Math.max(0, c.effectiveCap - c.sentToday)
}

/**
 * Escolhe a caixa do próximo envio.
 *
 * Não é round-robin puro: escolhemos a caixa com menor OCUPAÇÃO relativa
 * (enviados ÷ cap). Round-robin simples esvaziaria as caixas pequenas antes
 * das grandes e concentraria o fim do dia num único remetente — que é
 * exatamente o padrão de volume que queremos evitar.
 */
export function selectAccount(
  capacities: AccountCapacity[],
  options: { domainCap?: number } = {},
): AccountCapacity | null {
  const domainCap = options.domainCap ?? DEFAULT_DOMAIN_DAILY_CAP

  const sentByDomain = new Map<string, number>()
  for (const c of capacities) {
    sentByDomain.set(c.domain, (sentByDomain.get(c.domain) ?? 0) + c.sentToday)
  }

  const eligible = capacities.filter(
    (c) => remainingCapacity(c) > 0 && (sentByDomain.get(c.domain) ?? 0) < domainCap,
  )
  if (eligible.length === 0) return null

  return eligible.reduce((best, c) => {
    const occupancy = (x: AccountCapacity) => x.sentToday / Math.max(1, x.effectiveCap)
    if (occupancy(c) < occupancy(best)) return c
    // Empate: desempata pelo id para a escolha ser estável e previsível.
    if (occupancy(c) === occupancy(best) && c.accountId < best.accountId) return c
    return best
  })
}

/** Carrega o cap efetivo e o consumo de hoje de cada caixa da campanha. */
export async function loadCapacities(
  db: Database,
  accountIds: string[],
  now: Date,
): Promise<AccountCapacity[]> {
  if (accountIds.length === 0) return []

  const accounts = await db
    .select()
    .from(sendingAccounts)
    .where(and(inArray(sendingAccounts.id, accountIds), eq(sendingAccounts.active, true)))

  if (accounts.length === 0) return []

  // O dia do cap é o dia NO FUSO DA CAIXA. Contar em UTC deslocaria a
  // virada do contador em 3h e permitiria um pico no fim do expediente.
  const earliestDayStart = accounts
    .map((a) => startOfDayInZone(now, a.timezone))
    .reduce((min, d) => (d < min ? d : min))

  const counts = await db
    .select({
      accountId: messages.sendingAccountId,
      sentAt: messages.sentAt,
    })
    .from(messages)
    .where(
      and(
        inArray(
          messages.sendingAccountId,
          accounts.map((a) => a.id),
        ),
        gte(messages.sentAt, earliestDayStart),
      ),
    )

  return accounts.map((account) => {
    const dayStart = startOfDayInZone(now, account.timezone)
    const sentToday = counts.filter(
      (c) => c.accountId === account.id && c.sentAt !== null && c.sentAt >= dayStart,
    ).length

    return {
      accountId: account.id,
      fromName: account.fromName,
      fromEmail: account.fromEmail,
      domain: account.fromEmail.slice(account.fromEmail.lastIndexOf('@') + 1).toLowerCase(),
      replyToken: account.replyToken,
      timezone: account.timezone,
      effectiveCap: effectiveDailyCap({
        configuredCap: account.dailyCap,
        warmupStartedAt: account.warmupStartedAt,
        now,
        timezone: account.timezone,
      }),
      sentToday,
    }
  })
}

/**
 * Reserva atômica de uma vaga do dia.
 *
 * A checagem de cap no scheduler é otimista; com mais de um worker, dois
 * envios podem passar juntos pela mesma última vaga. Esta contagem no momento
 * do envio é a barreira final.
 */
export async function hasCapacityNow(
  db: Database,
  accountId: string,
  cap: number,
  dayStart: Date,
): Promise<boolean> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(messages)
    .where(and(eq(messages.sendingAccountId, accountId), gte(messages.sentAt, dayStart)))

  return (row?.n ?? 0) < cap
}
