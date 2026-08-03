import { describe, expect, it } from 'vitest'
import { classifyReply, requiresSuppression, stripQuotedText } from './classification'

describe('stripQuotedText', () => {
  it('corta a citação em estilo Gmail', () => {
    const body = [
      'Não tenho interesse, obrigado.',
      '',
      'Em qua, 5 de ago de 2026 às 10:00, Diego <d@acme.com> escreveu:',
      '> Podemos marcar uma reunião? Acho que faz sentido.',
    ].join('\n')
    expect(stripQuotedText(body)).toBe('Não tenho interesse, obrigado.')
  })

  it('corta cabeçalho de encaminhamento', () => {
    const body = 'Sem interesse.\n\nDe: Diego\nPara: Fulano\nAssunto: Proposta'
    expect(stripQuotedText(body)).toBe('Sem interesse.')
  })
})

describe('classifyReply', () => {
  it.each([
    'Estou de férias até dia 20, retorno depois.',
    'Resposta automática: ausente do escritório',
    'Automatic reply: out of office',
  ])('classifica ausência: %s', (body) => {
    expect(classifyReply(body)).toBe('out_of_office')
  })

  it.each([
    'Por favor, remova meu email da sua lista.',
    'Pare de enviar mensagens.',
    'me descadastre disso',
    'Take me off this list',
  ])('classifica pedido de remoção: %s', (body) => {
    expect(classifyReply(body)).toBe('negative')
  })

  it.each([
    'Obrigado, mas não temos interesse no momento.',
    'Sem interesse.',
    'Agora não, talvez no próximo trimestre.',
    'Já usamos uma solução parecida.',
  ])('classifica desinteresse: %s', (body) => {
    expect(classifyReply(body)).toBe('not_interested')
  })

  it.each([
    'Tenho interesse, podemos conversar na quinta?',
    'Qual o valor?',
    'Me manda mais informações, parece interessante.',
    'Vamos marcar uma reunião.',
  ])('classifica interesse: %s', (body) => {
    expect(classifyReply(body)).toBe('interested')
  })

  it('prioriza ausência sobre o resto', () => {
    // "não tenho interesse" no meio de um auto-reply não é desinteresse real.
    expect(classifyReply('Estou de férias e não tenho interesse em nada agora')).toBe('out_of_office')
  })

  it('não classifica pelo texto citado do nosso próprio e-mail', () => {
    const body = [
      'ok',
      '',
      'Em qua, 5 de ago de 2026, Diego escreveu:',
      '> Podemos marcar uma reunião? Tenho interesse em te apresentar a proposta.',
    ].join('\n')
    expect(classifyReply(body)).toBe('unclassified')
  })

  it('devolve unclassified para vazio', () => {
    expect(classifyReply('')).toBe('unclassified')
    expect(classifyReply(null)).toBe('unclassified')
  })
})

describe('requiresSuppression', () => {
  it('suprime só o pedido explícito de remoção', () => {
    expect(requiresSuppression('negative')).toBe(true)
    // "não tenho interesse agora" não é pedido de descadastro — o contato
    // pode ser reaproveitado num próximo ciclo.
    expect(requiresSuppression('not_interested')).toBe(false)
    expect(requiresSuppression('out_of_office')).toBe(false)
    expect(requiresSuppression('interested')).toBe(false)
  })
})
