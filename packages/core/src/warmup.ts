import { DateTime } from 'luxon'

/**
 * Rampa de volume por caixa.
 *
 * Uma caixa nova disparando 50/dia no primeiro dia é o jeito mais rápido de
 * queimar o domínio. Os dados públicos de 2026 são consistentes: acima de
 * ~150/caixa/dia a taxa de spam sobe de forma acentuada, e uma caixa só é
 * considerada aquecida depois de ~3 semanas.
 */
export const WARMUP_STAGES: ReadonlyArray<{ throughDay: number; cap: number }> = [
  { throughDay: 3, cap: 10 },
  { throughDay: 7, cap: 20 },
  { throughDay: 14, cap: 35 },
]

/** Teto duro por caixa, independente do que o usuário configurar. */
export const MAX_DAILY_CAP_PER_MAILBOX = 150

export function warmupDay(warmupStartedAt: Date, now: Date, timezone: string): number {
  const start = DateTime.fromJSDate(warmupStartedAt, { zone: timezone }).startOf('day')
  const today = DateTime.fromJSDate(now, { zone: timezone }).startOf('day')
  return Math.floor(today.diff(start, 'days').days) + 1
}

/**
 * Cap efetivo de hoje: o menor entre o configurado, o teto duro e o estágio
 * da rampa. `warmupStartedAt` nulo significa caixa já aquecida.
 */
export function effectiveDailyCap(params: {
  configuredCap: number
  warmupStartedAt: Date | null
  now: Date
  timezone: string
}): number {
  const ceiling = Math.min(params.configuredCap, MAX_DAILY_CAP_PER_MAILBOX)
  if (!params.warmupStartedAt) return ceiling

  const day = warmupDay(params.warmupStartedAt, params.now, params.timezone)
  for (const stage of WARMUP_STAGES) {
    if (day <= stage.throughDay) return Math.min(ceiling, stage.cap)
  }
  return ceiling
}

export function isWarmupComplete(params: {
  warmupStartedAt: Date | null
  now: Date
  timezone: string
}): boolean {
  if (!params.warmupStartedAt) return true
  const last = WARMUP_STAGES[WARMUP_STAGES.length - 1]!
  return warmupDay(params.warmupStartedAt, params.now, params.timezone) > last.throughDay
}
