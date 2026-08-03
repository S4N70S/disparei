import { DateTime } from 'luxon'
import type { SendWindow } from '@disparei/db'

export const DEFAULT_SEND_WINDOW: SendWindow = {
  daysOfWeek: [1, 2, 3, 4, 5], // seg–sex
  startMinute: 9 * 60,
  endMinute: 17 * 60,
  timezone: 'America/Sao_Paulo',
}

function toZoned(date: Date, window: SendWindow): DateTime {
  return DateTime.fromJSDate(date, { zone: window.timezone })
}

function minuteOfDay(dt: DateTime): number {
  return dt.hour * 60 + dt.minute
}

function isSendDay(dt: DateTime, window: SendWindow): boolean {
  return window.daysOfWeek.includes(dt.weekday)
}

/** A janela é avaliada no timezone da campanha, não no do servidor. */
export function isWithinSendWindow(date: Date, window: SendWindow): boolean {
  const dt = toZoned(date, window)
  if (!isSendDay(dt, window)) return false
  const m = minuteOfDay(dt)
  return m >= window.startMinute && m < window.endMinute
}

/**
 * Próximo instante em que a janela está aberta.
 * Se já está aberta em `date`, devolve o próprio `date`.
 */
export function nextWindowOpening(date: Date, window: SendWindow): Date {
  let dt = toZoned(date, window)

  for (let guard = 0; guard < 14; guard++) {
    if (isSendDay(dt, window)) {
      const m = minuteOfDay(dt)
      if (m < window.startMinute) {
        return dt.startOf('day').plus({ minutes: window.startMinute }).toJSDate()
      }
      if (m < window.endMinute) return dt.toJSDate()
    }
    // Fora da janela: tenta a abertura do dia seguinte.
    dt = dt.plus({ days: 1 }).startOf('day').plus({ minutes: window.startMinute })
  }

  // daysOfWeek vazio — configuração inválida, não deve chegar aqui.
  throw new Error('Janela de envio sem nenhum dia válido')
}

/**
 * Avança `days` dias úteis, onde "útil" é definido pela própria janela da
 * campanha — quem envia só às terças tem "dia útil" às terças.
 */
export function addBusinessDays(date: Date, days: number, window: SendWindow): Date {
  let dt = toZoned(date, window)
  let remaining = days

  let guard = 0
  while (remaining > 0) {
    dt = dt.plus({ days: 1 })
    if (isSendDay(dt, window)) remaining--
    if (++guard > 365) throw new Error('Janela de envio sem nenhum dia válido')
  }

  return dt.toJSDate()
}

/**
 * Quando o próximo passo deve sair, dado o momento do envio anterior.
 *
 * Contar em dias úteis é deliberado: um follow-up com espera de 3 dias
 * corridos disparado numa sexta cai no domingo, quando ninguém lê — e queima
 * o toque.
 */
export function computeNextSendAt(
  lastSentAt: Date,
  waitDays: number,
  window: SendWindow,
): Date {
  const target = waitDays > 0 ? addBusinessDays(lastSentAt, waitDays, window) : lastSentAt
  return nextWindowOpening(target, window)
}

/**
 * Espalha os envios dentro da janela.
 *
 * 40 e-mails saindo em rajada, com intervalo idêntico entre eles, é o padrão
 * mais fácil de um filtro anti-spam reconhecer. O jitter aleatório quebra a
 * regularidade.
 */
export function jitterDelayMs(
  minSeconds = 30,
  maxSeconds = 180,
  random: () => number = Math.random,
): number {
  const span = Math.max(0, maxSeconds - minSeconds)
  return Math.round((minSeconds + random() * span) * 1000)
}

/**
 * Distribui N envios ao longo da janela, com intervalos aleatórios.
 *
 * Sem fila externa, o espaçamento precisa estar gravado no banco: cada
 * contato recebe um `nextSendAt` próprio, afastado do anterior por um
 * intervalo sorteado. Matricular 200 contatos com o mesmo horário faria todos
 * vencerem juntos e sairia uma rajada — que é o padrão mais fácil de um
 * filtro anti-spam reconhecer.
 *
 * Quando os horários passam do fim do expediente, o excedente rola para a
 * abertura do próximo dia útil automaticamente.
 */
export function staggeredSendTimes(
  count: number,
  startAt: Date,
  window: SendWindow,
  options: {
    minSeconds?: number
    maxSeconds?: number
    random?: () => number
  } = {},
): Date[] {
  const min = options.minSeconds ?? 30
  const max = options.maxSeconds ?? 180
  const random = options.random ?? Math.random

  const times: Date[] = []
  let cursor = nextWindowOpening(startAt, window)

  for (let i = 0; i < count; i++) {
    // O primeiro sai na abertura; os seguintes, um intervalo depois.
    if (i > 0) {
      cursor = new Date(cursor.getTime() + jitterDelayMs(min, max, random))
      cursor = nextWindowOpening(cursor, window)
    }
    times.push(cursor)
  }

  return times
}

/** Início do dia da caixa, para contar o cap diário no timezone certo. */
export function startOfDayInZone(date: Date, timezone: string): Date {
  return DateTime.fromJSDate(date, { zone: timezone }).startOf('day').toJSDate()
}
