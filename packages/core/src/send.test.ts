import { describe, expect, it } from 'vitest'
import { MAX_SEND_ATTEMPTS, backoffMinutes, htmlToText } from './send'

describe('htmlToText', () => {
  it('converte parágrafos e quebras', () => {
    expect(htmlToText('<p>Olá Diego</p><p>Tudo bem?</p>')).toBe('Olá Diego\nTudo bem?')
    expect(htmlToText('linha 1<br>linha 2')).toBe('linha 1\nlinha 2')
  })

  it('remove style e script', () => {
    expect(htmlToText('<style>p{color:red}</style><p>Oi</p>')).toBe('Oi')
    expect(htmlToText('<script>alert(1)</script>Oi')).toBe('Oi')
  })

  it('desescapa entidades', () => {
    expect(htmlToText('<p>Alfa &amp; Beta &quot;X&quot;</p>')).toBe('Alfa & Beta "X"')
  })

  it('marca itens de lista', () => {
    expect(htmlToText('<ul><li>um</li><li>dois</li></ul>')).toBe('- um\n- dois')
  })

  it('colapsa excesso de linhas em branco', () => {
    expect(htmlToText('<p>a</p><br><br><br><p>b</p>')).toBe('a\n\nb')
  })

  it('preserva o texto de links', () => {
    expect(htmlToText('<p>Veja <a href="https://x.com">aqui</a></p>')).toBe('Veja aqui')
  })
})

describe('backoffMinutes', () => {
  it('cresce exponencialmente', () => {
    expect(backoffMinutes(1)).toBe(5)
    expect(backoffMinutes(2)).toBe(15)
    expect(backoffMinutes(3)).toBe(45)
  })

  it('não passa de algumas horas dentro do limite de tentativas', () => {
    // Insistir por dias num endereço problemático só queima reputação.
    const total = Array.from({ length: MAX_SEND_ATTEMPTS - 1 }, (_, i) =>
      backoffMinutes(i + 1),
    ).reduce((a, b) => a + b, 0)
    expect(total).toBeLessThan(120)
  })
})
