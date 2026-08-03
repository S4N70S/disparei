import { describe, expect, it } from 'vitest'
import { MAX_DAILY_CAP_PER_MAILBOX, effectiveDailyCap, isWarmupComplete, warmupDay } from './warmup'

const TZ = 'America/Sao_Paulo'
const day = (iso: string) => new Date(`${iso}T12:00:00-03:00`)

describe('warmupDay', () => {
  it('conta o primeiro dia como 1', () => {
    expect(warmupDay(day('2026-08-03'), day('2026-08-03'), TZ)).toBe(1)
    expect(warmupDay(day('2026-08-03'), day('2026-08-10'), TZ)).toBe(8)
  })
})

describe('effectiveDailyCap', () => {
  const cases: Array<[string, number]> = [
    ['2026-08-03', 10], // dia 1
    ['2026-08-05', 10], // dia 3
    ['2026-08-06', 20], // dia 4
    ['2026-08-09', 20], // dia 7
    ['2026-08-10', 35], // dia 8
    ['2026-08-16', 35], // dia 14
    ['2026-08-17', 50], // dia 15 -> cap configurado
  ]

  it.each(cases)('em %s aplica cap %i', (date, expected) => {
    expect(
      effectiveDailyCap({
        configuredCap: 50,
        warmupStartedAt: day('2026-08-03'),
        now: day(date),
        timezone: TZ,
      }),
    ).toBe(expected)
  })

  it('usa o cap cheio quando a caixa já está aquecida', () => {
    expect(
      effectiveDailyCap({ configuredCap: 50, warmupStartedAt: null, now: day('2026-08-03'), timezone: TZ }),
    ).toBe(50)
  })

  it('nunca ultrapassa o teto duro, mesmo se o usuário configurar acima', () => {
    expect(
      effectiveDailyCap({ configuredCap: 5000, warmupStartedAt: null, now: day('2026-08-03'), timezone: TZ }),
    ).toBe(MAX_DAILY_CAP_PER_MAILBOX)
  })

  it('a rampa nunca eleva um cap configurado baixo', () => {
    expect(
      effectiveDailyCap({
        configuredCap: 5,
        warmupStartedAt: day('2026-08-03'),
        now: day('2026-08-20'),
        timezone: TZ,
      }),
    ).toBe(5)
  })
})

describe('isWarmupComplete', () => {
  it('fica falso durante a rampa e verdadeiro depois', () => {
    expect(isWarmupComplete({ warmupStartedAt: day('2026-08-03'), now: day('2026-08-16'), timezone: TZ })).toBe(false)
    expect(isWarmupComplete({ warmupStartedAt: day('2026-08-03'), now: day('2026-08-17'), timezone: TZ })).toBe(true)
    expect(isWarmupComplete({ warmupStartedAt: null, now: day('2026-08-03'), timezone: TZ })).toBe(true)
  })
})
