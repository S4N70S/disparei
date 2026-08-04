import { addBusinessDays, nextWindowOpening } from '@disparei/core/schedule'
import type { SendWindow } from '@disparei/db'
import type { BuilderStep } from './types'

/**
 * Projeta a data real de cada toque.
 *
 * É o ganho maior de toda a reconstrução: "4 dias" é abstrato, "segunda,
 * 11/08" é uma decisão. Espaçamento de cadência é onde a maioria erra, e
 * torná-lo visível enquanto se arrasta muda a qualidade da sequência.
 *
 * Reusa exatamente as funções que o motor usa para agendar — se a projeção
 * diverge do envio real, é bug em uma das duas, e não em duas implementações
 * paralelas.
 */
export function projectTimeline(
  steps: BuilderStep[],
  window: SendWindow,
  from: Date = new Date(),
): Date[] {
  const dates: Date[] = []
  let cursor = nextWindowOpening(from, window)

  steps.forEach((step, i) => {
    if (i > 0) {
      cursor = nextWindowOpening(addBusinessDays(cursor, step.waitDays, window), window)
    }
    dates.push(cursor)
  })

  return dates
}

const FMT = new Intl.DateTimeFormat('pt-BR', {
  weekday: 'short',
  day: '2-digit',
  month: '2-digit',
})

export function formatProjected(date: Date, timezone: string): string {
  return FMT.format(date).replace('.,', ',') + ` · ${date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: timezone })}`
}

/** Duração total da cadência, em dias corridos. */
export function sequenceSpanDays(dates: Date[]): number {
  if (dates.length < 2) return 0
  const first = dates[0]!.getTime()
  const last = dates[dates.length - 1]!.getTime()
  return Math.round((last - first) / 86_400_000)
}
