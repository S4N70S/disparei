import { describe, expect, it } from 'vitest'
import {
  BOUNCE_RATE_LIMIT,
  COMPLAINT_RATE_LIMIT,
  checkHealth,
  computeRates,
  formatPercent,
  type FunnelCounts,
} from './metrics'

function counts(over: Partial<FunnelCounts> = {}): FunnelCounts {
  return {
    sent: 1000,
    delivered: 960,
    opened: 400,
    clicked: 50,
    bounced: 40,
    complained: 0,
    replied: 48,
    positiveReplies: 12,
    unsubscribed: 10,
    ...over,
  }
}

describe('computeRates', () => {
  it('calcula bounce sobre ENVIADOS, como o provedor faz', () => {
    // 40/1000 = 4%. Sobre entregues (40/960) daria 4,17% e mascararia o
    // número que realmente dispara a suspensão.
    expect(computeRates(counts()).bounceRate).toBeCloseTo(0.04, 5)
  })

  it('calcula abertura e resposta sobre entregues', () => {
    const r = computeRates(counts())
    expect(r.openRate).toBeCloseTo(400 / 960, 5)
    expect(r.replyRate).toBeCloseTo(48 / 960, 5)
  })

  it('não divide por zero', () => {
    const r = computeRates(counts({ sent: 0, delivered: 0 }))
    expect(r.bounceRate).toBe(0)
    expect(r.replyRate).toBe(0)
    expect(Number.isNaN(r.openRate)).toBe(false)
  })

  it('separa resposta positiva do total de respostas', () => {
    const r = computeRates(counts())
    expect(r.positiveReplyRate).toBeLessThan(r.replyRate)
  })
})

describe('checkHealth', () => {
  it('não opina com volume baixo', () => {
    // 2 bounces em 10 envios daria 20% — ruído, não sinal.
    const c = counts({ sent: 10, delivered: 8, bounced: 2 })
    expect(checkHealth(c, computeRates(c)).level).toBe('ok')
  })

  it('alerta ANTES de cruzar o limite de bounce', () => {
    const c = counts({ sent: 1000, delivered: 970, bounced: 30 }) // 3%
    const h = checkHealth(c, computeRates(c))
    expect(h.bounce).toBe('warning')
    expect(h.level).toBe('warning')
    expect(h.messages[0]).toMatch(/aproximando/)
  })

  it('marca como crítico ao atingir o limite', () => {
    const c = counts({ sent: 1000, delivered: 960, bounced: 40 }) // 4%
    const h = checkHealth(c, computeRates(c))
    expect(h.bounce).toBe('critical')
    expect(h.messages[0]).toMatch(/Pare os envios/)
  })

  it('detecta reclamação acima de 0,08%', () => {
    const c = counts({ sent: 1000, delivered: 1000, bounced: 0, complained: 1 }) // 0,1%
    const h = checkHealth(c, computeRates(c))
    expect(h.complaint).toBe('critical')
    expect(h.level).toBe('critical')
  })

  it('fica ok com números saudáveis', () => {
    const c = counts({ sent: 1000, delivered: 990, bounced: 10, complained: 0 }) // 1%
    const h = checkHealth(c, computeRates(c))
    expect(h.level).toBe('ok')
    expect(h.messages).toHaveLength(0)
  })

  it('usa os limites reais do provedor', () => {
    expect(BOUNCE_RATE_LIMIT).toBe(0.04)
    expect(COMPLAINT_RATE_LIMIT).toBe(0.0008)
  })
})

describe('formatPercent', () => {
  it('formata com a precisão pedida', () => {
    expect(formatPercent(0.0412)).toBe('4.1%')
    expect(formatPercent(0.0008, 2)).toBe('0.08%')
  })
})
