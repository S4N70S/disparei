import { describe, expect, it } from 'vitest'
import {
  DEFAULT_DOMAIN_DAILY_CAP,
  remainingCapacity,
  selectAccount,
  type AccountCapacity,
} from './capacity'

function account(over: Partial<AccountCapacity> & { accountId: string }): AccountCapacity {
  return {
    fromName: 'Diego',
    fromEmail: `${over.accountId}@acme.com.br`,
    domain: 'acme.com.br',
    replyToken: 'tok',
    timezone: 'America/Sao_Paulo',
    effectiveCap: 50,
    sentToday: 0,
    ...over,
  }
}

describe('remainingCapacity', () => {
  it('nunca fica negativo', () => {
    expect(remainingCapacity(account({ accountId: 'a', effectiveCap: 10, sentToday: 25 }))).toBe(0)
  })
})

describe('selectAccount', () => {
  it('devolve null quando todas as caixas estouraram o cap', () => {
    const caps = [
      account({ accountId: 'a', effectiveCap: 10, sentToday: 10 }),
      account({ accountId: 'b', effectiveCap: 20, sentToday: 20 }),
    ]
    expect(selectAccount(caps)).toBeNull()
  })

  it('escolhe a caixa de menor ocupação relativa, não a de menor contagem', () => {
    // 'a' enviou menos em número absoluto, mas está mais ocupada em proporção.
    const caps = [
      account({ accountId: 'a', effectiveCap: 10, sentToday: 8 }), // 80%
      account({ accountId: 'b', effectiveCap: 50, sentToday: 20 }), // 40%
    ]
    expect(selectAccount(caps)?.accountId).toBe('b')
  })

  it('distribui os envios entre as caixas', () => {
    const caps = [
      account({ accountId: 'a', effectiveCap: 10 }),
      account({ accountId: 'b', effectiveCap: 10 }),
      account({ accountId: 'c', effectiveCap: 10 }),
    ]

    // Simula 9 envios, incrementando a caixa escolhida a cada rodada.
    for (let i = 0; i < 9; i++) {
      const chosen = selectAccount(caps)!
      caps.find((c) => c.accountId === chosen.accountId)!.sentToday++
    }

    expect(caps.map((c) => c.sentToday)).toEqual([3, 3, 3])
  })

  it('respeita o teto do domínio mesmo com caixas ainda disponíveis', () => {
    // 3 caixas de 100 no mesmo domínio: por caixa há folga, por domínio não.
    const caps = [
      account({ accountId: 'a', effectiveCap: 100, sentToday: 90 }),
      account({ accountId: 'b', effectiveCap: 100, sentToday: 90 }),
      account({ accountId: 'c', effectiveCap: 100, sentToday: 90 }),
    ]
    expect(caps.reduce((s, c) => s + c.sentToday, 0)).toBe(270)
    expect(270).toBeGreaterThan(DEFAULT_DOMAIN_DAILY_CAP)
    expect(selectAccount(caps)).toBeNull()
  })

  it('não deixa um domínio saturado bloquear outro', () => {
    const caps = [
      account({ accountId: 'a', domain: 'acme.com.br', effectiveCap: 300, sentToday: 260 }),
      account({ accountId: 'b', domain: 'outra.com.br', fromEmail: 'b@outra.com.br', effectiveCap: 50, sentToday: 0 }),
    ]
    expect(selectAccount(caps)?.accountId).toBe('b')
  })

  it('é estável no empate', () => {
    const caps = [account({ accountId: 'z' }), account({ accountId: 'a' })]
    expect(selectAccount(caps)?.accountId).toBe('a')
    expect(selectAccount(caps)?.accountId).toBe('a')
  })
})
