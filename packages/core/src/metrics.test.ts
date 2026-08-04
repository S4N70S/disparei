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
    failed: 0,
    sentViaSmtp: 0, // padrão: caminho Resend, com rastreio completo
    replied: 48,
    positiveReplies: 12,
    unsubscribed: 10,
    ...over,
  }
}

/** Mesmos números, mas enviados por SMTP: sem webhook, sem entrega. */
function smtpCounts(over: Partial<FunnelCounts> = {}): FunnelCounts {
  return counts({
    delivered: 0,
    opened: 0,
    clicked: 0,
    bounced: 0,
    complained: 0,
    sentViaSmtp: 1000,
    ...over,
  })
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

  it('mostra travessão para o que não é mensurável', () => {
    // "0.0%" parece medição; "—" comunica ausência de dado.
    expect(formatPercent(null)).toBe('—')
  })
})

describe('caminho SMTP (send_only)', () => {
  it('detecta o modo a partir do que foi realmente enviado', () => {
    expect(computeRates(counts()).mode).toBe('full')
    expect(computeRates(smtpCounts()).mode).toBe('send_only')
    // Uma única mensagem por SMTP já torna o total de entregues incomparável.
    expect(computeRates(counts({ sentViaSmtp: 1 })).mode).toBe('send_only')
  })

  it('NÃO reporta zero para o que não consegue medir', () => {
    const r = computeRates(smtpCounts())
    expect(r.deliveryRate).toBeNull()
    expect(r.bounceRate).toBeNull()
    expect(r.complaintRate).toBeNull()
    expect(r.openRate).toBeNull()
    expect(r.clickRate).toBeNull()
  })

  it('calcula taxa de resposta sobre ENVIADOS', () => {
    /*
     * Era o bug: com delivered=0, `respostas ÷ entregues` dava 0% mesmo com
     * respostas chegando — e taxa de resposta é a métrica que decide a
     * operação inteira.
     */
    const r = computeRates(smtpCounts({ replied: 50 }))
    expect(r.replyRate).toBeCloseTo(50 / 1000, 5)
    expect(r.replyRate).toBeGreaterThan(0)
  })

  it('mede falha síncrona, que existe nos dois canais', () => {
    const r = computeRates(smtpCounts({ sent: 90, failed: 10 }))
    expect(r.failureRate).toBeCloseTo(0.1, 5)
  })

  it('avisa do ponto cego mesmo com volume baixo', () => {
    // Com volume baixo o semáforo se cala — mas o ponto cego precisa aparecer,
    // senão o painel fica verde sem estar medindo nada.
    const c = smtpCounts({ sent: 10 })
    const h = checkHealth(c, computeRates(c))
    expect(h.blindSpots.length).toBeGreaterThan(0)
    expect(h.blindSpots[0]).toMatch(/SMTP/)
  })

  it('não inventa semáforo de bounce sem dado', () => {
    const c = smtpCounts({ sent: 5000 })
    const h = checkHealth(c, computeRates(c))
    expect(h.bounce).toBe('ok')
    expect(h.messages).toHaveLength(0)
    expect(h.blindSpots.length).toBeGreaterThan(0)
  })

  it('reporta envios recusados no ato', () => {
    const c = smtpCounts({ failed: 3 })
    const h = checkHealth(c, computeRates(c))
    expect(h.blindSpots.some((b) => b.includes('3 envio'))).toBe(true)
  })
})

describe('caminho Resend (full) segue intacto', () => {
  it('mantém o semáforo de bounce funcionando', () => {
    const c = counts({ sent: 1000, delivered: 960, bounced: 40 })
    const h = checkHealth(c, computeRates(c))
    expect(h.bounce).toBe('critical')
    expect(h.blindSpots).toHaveLength(0)
  })

  it('calcula resposta sobre entregues', () => {
    expect(computeRates(counts()).replyRate).toBeCloseTo(48 / 960, 5)
  })
})
