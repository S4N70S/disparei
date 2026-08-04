import { describe, expect, it } from 'vitest'
import { MAX_WORDS, analyzeDeliverability, scoreLabel } from './deliverability'
import type { Block } from './blocks'

const texto = (palavras: number): Block => ({
  type: 'text',
  html: Array.from({ length: palavras }, (_, i) => `palavra${i}`).join(' '),
})

const analisar = (over: Partial<Parameters<typeof analyzeDeliverability>[0]> = {}) =>
  analyzeDeliverability({
    subject: 'Pergunta sobre {{company}}',
    blocks: [{ type: 'text', html: 'Oi {{first_name}}, tudo certo?' }],
    provider: 'smtp',
    ...over,
  })

const temCheck = (r: ReturnType<typeof analisar>, id: string) =>
  r.checks.find((c) => c.id === id)

describe('caso saudável', () => {
  it('não gera aviso e mantém índice alto', () => {
    const r = analisar()
    expect(r.checks).toHaveLength(0)
    expect(r.score).toBe(100)
    expect(scoreLabel(r.score).tone).toBe('green')
  })
})

describe('tamanho do corpo', () => {
  it('avisa acima do limite', () => {
    const r = analisar({ blocks: [texto(MAX_WORDS + 20)] })
    expect(temCheck(r, 'length')?.severity).toBe('warning')
  })

  it('escala para crítico no dobro do limite', () => {
    const r = analisar({ blocks: [texto(MAX_WORDS * 2 + 10)] })
    expect(temCheck(r, 'length')?.severity).toBe('critical')
  })

  it('não avisa dentro do limite', () => {
    expect(temCheck(analisar({ blocks: [texto(MAX_WORDS - 10)] }), 'length')).toBeUndefined()
  })

  it('marca corpo vazio como crítico', () => {
    expect(temCheck(analisar({ blocks: [] }), 'empty')?.severity).toBe('critical')
  })
})

describe('links', () => {
  it('aceita um link sem avisar', () => {
    const r = analisar({
      blocks: [{ type: 'text', html: 'veja <a href="https://a.com">aqui</a> {{first_name}}' }],
    })
    expect(temCheck(r, 'links')).toBeUndefined()
    expect(r.linkCount).toBe(1)
  })

  it('avisa a partir de dois', () => {
    const r = analisar({
      blocks: [
        { type: 'text', html: '<a href="https://a.com">a</a> <a href="https://b.com">b</a> {{x}}' },
      ],
    })
    expect(temCheck(r, 'links')?.severity).toBe('warning')
  })

  it('conta botão como link', () => {
    const r = analisar({
      blocks: [
        { type: 'text', html: 'oi {{first_name}}' },
        { type: 'button', label: 'Agendar', url: 'https://cal.com' },
        { type: 'button', label: 'Saiba mais', url: 'https://x.com' },
      ],
    })
    expect(r.linkCount).toBe(2)
    expect(temCheck(r, 'links')).toBeDefined()
  })
})

describe('imagens', () => {
  const comImagem: Block[] = [
    { type: 'text', html: 'oi {{first_name}}' },
    { type: 'image', url: 'https://a.com/i.png', alt: 'banner' },
  ]

  it('é CRÍTICO em prospecção fria (SMTP)', () => {
    // Ninguém manda e-mail 1:1 com banner — imagem denuncia disparo em massa.
    expect(temCheck(analisar({ blocks: comImagem, provider: 'smtp' }), 'images')?.severity).toBe(
      'critical',
    )
  })

  it('é apenas informativo em nutrição opt-in (Resend)', () => {
    expect(temCheck(analisar({ blocks: comImagem, provider: 'resend' }), 'images')?.severity).toBe(
      'info',
    )
  })
})

describe('assunto', () => {
  it('avisa quando passa do corte do celular', () => {
    const r = analisar({ subject: 'a'.repeat(70) })
    expect(temCheck(r, 'subject-length')?.severity).toBe('warning')
  })

  it('trata assunto vazio como informativo, não erro', () => {
    // Follow-up sem assunto herda a thread com Re: — é o comportamento correto.
    expect(temCheck(analisar({ subject: '' }), 'subject-empty')?.severity).toBe('info')
  })
})

describe('palavras de gatilho', () => {
  it('detecta no corpo e no assunto', () => {
    expect(temCheck(analisar({ subject: 'Oferta imperdível!' }), 'spam-words')).toBeDefined()
    expect(
      temCheck(analisar({ blocks: [{ type: 'text', html: 'clique aqui {{x}}' }] }), 'spam-words'),
    ).toBeDefined()
  })

  it('escala para crítico com vários termos', () => {
    const r = analisar({
      subject: 'Promoção grátis',
      blocks: [{ type: 'text', html: 'clique aqui {{x}} desconto' }],
    })
    expect(temCheck(r, 'spam-words')?.severity).toBe('critical')
  })

  it('ignora texto comercial normal', () => {
    const r = analisar({
      subject: 'Sobre a operação de vocês',
      blocks: [{ type: 'text', html: 'Oi {{first_name}}, faz sentido conversarmos?' }],
    })
    expect(temCheck(r, 'spam-words')).toBeUndefined()
  })
})

describe('personalização', () => {
  it('avisa quando não há nenhuma variável', () => {
    const r = analisar({ subject: 'Olá', blocks: [{ type: 'text', html: 'Mensagem genérica' }] })
    expect(temCheck(r, 'no-personalization')?.severity).toBe('warning')
  })

  it('aceita variável só no assunto', () => {
    const r = analisar({ subject: 'Sobre {{company}}', blocks: [{ type: 'text', html: 'Oi' }] })
    expect(temCheck(r, 'no-personalization')).toBeUndefined()
  })

  it('não reclama de corpo vazio duas vezes', () => {
    const r = analisar({ subject: 'Olá', blocks: [] })
    expect(temCheck(r, 'no-personalization')).toBeUndefined()
  })
})

describe('índice', () => {
  it('cai conforme os problemas se acumulam', () => {
    const limpo = analisar().score
    const ruim = analisar({
      subject: 'PROMOÇÃO grátis desconto ' + 'a'.repeat(60),
      blocks: [
        texto(MAX_WORDS * 2 + 50),
        { type: 'image', url: 'https://a.com/i.png', alt: '' },
        { type: 'button', label: 'a', url: 'https://a.com' },
        { type: 'button', label: 'b', url: 'https://b.com' },
      ],
      provider: 'smtp',
    }).score
    expect(ruim).toBeLessThan(limpo)
    expect(ruim).toBe(0)
  })

  it('nunca sai do intervalo 0–100', () => {
    for (const p of ['smtp', 'resend'] as const) {
      const r = analisar({ provider: p, blocks: [texto(1000)] })
      expect(r.score).toBeGreaterThanOrEqual(0)
      expect(r.score).toBeLessThanOrEqual(100)
    }
  })
})

describe('scoreLabel', () => {
  it('mapeia as três faixas', () => {
    expect(scoreLabel(95).tone).toBe('green')
    expect(scoreLabel(60).tone).toBe('amber')
    expect(scoreLabel(20).tone).toBe('red')
  })
})
