import { describe, expect, it } from 'vitest'
import { DateTime } from 'luxon'
import {
  DEFAULT_SEND_WINDOW,
  addBusinessDays,
  computeNextSendAt,
  isWithinSendWindow,
  jitterDelayMs,
  nextWindowOpening,
  staggeredSendTimes,
} from './schedule'

const TZ = 'America/Sao_Paulo'
const w = DEFAULT_SEND_WINDOW // seg–sex, 09:00–17:00, America/Sao_Paulo

/** Helper: constrói um instante no fuso da janela. */
const at = (iso: string) => DateTime.fromISO(iso, { zone: TZ }).toJSDate()
const fmt = (d: Date) => DateTime.fromJSDate(d, { zone: TZ }).toFormat('yyyy-MM-dd HH:mm')

describe('isWithinSendWindow', () => {
  it('aceita horário comercial em dia útil', () => {
    expect(isWithinSendWindow(at('2026-08-05T10:00'), w)).toBe(true) // quarta
  })

  it('rejeita antes da abertura e a partir do fechamento', () => {
    expect(isWithinSendWindow(at('2026-08-05T08:59'), w)).toBe(false)
    expect(isWithinSendWindow(at('2026-08-05T17:00'), w)).toBe(false)
  })

  it('rejeita fim de semana', () => {
    expect(isWithinSendWindow(at('2026-08-08T10:00'), w)).toBe(false) // sábado
    expect(isWithinSendWindow(at('2026-08-09T10:00'), w)).toBe(false) // domingo
  })

  it('avalia no fuso da campanha, não no do servidor', () => {
    // 2026-08-05T23:00Z = 20:00 em São Paulo — fora da janela.
    expect(isWithinSendWindow(new Date('2026-08-05T23:00:00Z'), w)).toBe(false)
    // 2026-08-05T13:00Z = 10:00 em São Paulo — dentro.
    expect(isWithinSendWindow(new Date('2026-08-05T13:00:00Z'), w)).toBe(true)
  })
})

describe('nextWindowOpening', () => {
  it('devolve o próprio instante quando a janela já está aberta', () => {
    const d = at('2026-08-05T10:30')
    expect(nextWindowOpening(d, w).getTime()).toBe(d.getTime())
  })

  it('adianta para a abertura do mesmo dia', () => {
    expect(fmt(nextWindowOpening(at('2026-08-05T06:00'), w))).toBe('2026-08-05 09:00')
  })

  it('empurra para o dia seguinte depois do fechamento', () => {
    expect(fmt(nextWindowOpening(at('2026-08-05T18:00'), w))).toBe('2026-08-06 09:00')
  })

  it('pula o fim de semana', () => {
    // Sexta 18:00 -> segunda 09:00
    expect(fmt(nextWindowOpening(at('2026-08-07T18:00'), w))).toBe('2026-08-10 09:00')
    // Sábado 10:00 -> segunda 09:00
    expect(fmt(nextWindowOpening(at('2026-08-08T10:00'), w))).toBe('2026-08-10 09:00')
  })
})

describe('addBusinessDays', () => {
  it('conta apenas dias da janela', () => {
    // Sexta + 1 dia útil = segunda
    expect(fmt(addBusinessDays(at('2026-08-07T10:00'), 1, w))).toBe('2026-08-10 10:00')
    // Quarta + 3 dias úteis = segunda seguinte
    expect(fmt(addBusinessDays(at('2026-08-05T10:00'), 3, w))).toBe('2026-08-10 10:00')
  })

  it('respeita uma janela de dias customizada', () => {
    const tuesdaysOnly = { ...w, daysOfWeek: [2] }
    // Terça + 1 = terça seguinte
    expect(fmt(addBusinessDays(at('2026-08-04T10:00'), 1, tuesdaysOnly))).toBe('2026-08-11 10:00')
  })

  it('devolve a mesma data para 0 dias', () => {
    const d = at('2026-08-05T10:00')
    expect(addBusinessDays(d, 0, w).getTime()).toBe(d.getTime())
  })
})

describe('computeNextSendAt', () => {
  it('agenda o follow-up dentro da janela', () => {
    // Enviado quarta 16:50, espera 2 dias úteis -> sexta 16:50 (dentro)
    expect(fmt(computeNextSendAt(at('2026-08-05T16:50'), 2, w))).toBe('2026-08-07 16:50')
  })

  it('nunca agenda para fim de semana', () => {
    // Quinta + 1 dia útil = sexta; sexta + 1 = segunda
    expect(fmt(computeNextSendAt(at('2026-08-07T10:00'), 1, w))).toBe('2026-08-10 10:00')
  })

  it('empurra para a abertura quando o passo cairia depois do expediente', () => {
    // Espera 3 dias corridos cairia no domingo; em dias úteis vai para segunda.
    const next = computeNextSendAt(at('2026-08-06T18:30'), 1, w)
    expect(fmt(next)).toBe('2026-08-10 09:00')
    expect(isWithinSendWindow(next, w)).toBe(true)
  })
})

describe('staggeredSendTimes', () => {
  // Segunda-feira 07:00, antes da janela abrir.
  const start = at('2026-08-03T07:00')

  it('gera um horário por contato', () => {
    expect(staggeredSendTimes(25, start, w)).toHaveLength(25)
    expect(staggeredSendTimes(0, start, w)).toHaveLength(0)
  })

  it('começa na abertura da janela, não em "agora"', () => {
    // Matricular às 7h não pode disparar às 7h — e às 23h de sábado, muito menos.
    expect(fmt(staggeredSendTimes(1, start, w)[0]!)).toBe('2026-08-03 09:00')
    expect(fmt(staggeredSendTimes(1, at('2026-08-08T23:00'), w)[0]!)).toBe('2026-08-10 09:00')
  })

  it('afasta os horários em ordem crescente', () => {
    const times = staggeredSendTimes(20, start, w)
    for (let i = 1; i < times.length; i++) {
      expect(times[i]!.getTime()).toBeGreaterThan(times[i - 1]!.getTime())
    }
  })

  it('mantém cada intervalo dentro do jitter configurado', () => {
    const times = staggeredSendTimes(30, start, w)
    for (let i = 1; i < times.length; i++) {
      const gap = times[i]!.getTime() - times[i - 1]!.getTime()
      expect(gap).toBeGreaterThanOrEqual(30_000)
      expect(gap).toBeLessThanOrEqual(180_000)
    }
  })

  it('não produz intervalos constantes', () => {
    // Cadência regular é o padrão que o filtro anti-spam reconhece primeiro.
    const times = staggeredSendTimes(20, start, w)
    const gaps = times.slice(1).map((t, i) => t.getTime() - times[i]!.getTime())
    expect(new Set(gaps).size).toBeGreaterThan(1)
  })

  it('mantém todos os horários dentro da janela', () => {
    // 300 contatos não cabem num dia: o excedente precisa rolar para o
    // próximo dia útil, nunca cair de madrugada ou no fim de semana.
    const times = staggeredSendTimes(300, start, w)
    for (const t of times) {
      expect(isWithinSendWindow(t, w)).toBe(true)
    }
  })

  it('transborda para o próximo dia útil quando a janela enche', () => {
    const times = staggeredSendTimes(300, start, w)
    const dias = new Set(times.map((t) => fmt(t).slice(0, 10)))
    expect(dias.size).toBeGreaterThan(1)
    expect([...dias].some((d) => d === '2026-08-08' || d === '2026-08-09')).toBe(false)
  })

  it('respeita um gerador determinístico', () => {
    const times = staggeredSendTimes(3, start, w, { random: () => 0 })
    expect(times.map(fmt)).toEqual([
      '2026-08-03 09:00',
      '2026-08-03 09:00',
      '2026-08-03 09:01',
    ])
  })
})

describe('jitterDelayMs', () => {
  it('fica dentro do intervalo pedido', () => {
    for (let i = 0; i < 200; i++) {
      const ms = jitterDelayMs(30, 180)
      expect(ms).toBeGreaterThanOrEqual(30_000)
      expect(ms).toBeLessThanOrEqual(180_000)
    }
  })

  it('usa os extremos do intervalo', () => {
    expect(jitterDelayMs(30, 180, () => 0)).toBe(30_000)
    expect(jitterDelayMs(30, 180, () => 1)).toBe(180_000)
  })
})
