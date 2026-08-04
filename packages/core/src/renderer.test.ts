import { describe, expect, it } from 'vitest'
import {
  contactToContext,
  render,
  renderStep,
  resolveSpintax,
  substituteVariables,
  withReplyPrefix,
} from './renderer'

const opts = { seed: 'contato-1' }

describe('resolveSpintax', () => {
  it('escolhe uma das opções', () => {
    const out = resolveSpintax('{Oi|Olá|E aí}, tudo bem?', 'c1')
    expect(['Oi, tudo bem?', 'Olá, tudo bem?', 'E aí, tudo bem?']).toContain(out)
  })

  it('é determinístico para a mesma seed', () => {
    const a = resolveSpintax('{a|b|c|d|e}', 'contato-x')
    const b = resolveSpintax('{a|b|c|d|e}', 'contato-x')
    expect(a).toBe(b)
  })

  it('varia entre contatos diferentes', () => {
    const outputs = new Set(
      Array.from({ length: 40 }, (_, i) => resolveSpintax('{a|b|c}', `contato-${i}`)),
    )
    expect(outputs.size).toBeGreaterThan(1)
  })

  it('usa semente independente por grupo', () => {
    // Se todos os grupos compartilhassem a semente, escolheriam sempre a mesma
    // posição e o resultado seria só "aaa" ou "bbb".
    const results = new Set(
      Array.from({ length: 30 }, (_, i) => resolveSpintax('{a|b}{a|b}{a|b}', `c${i}`)),
    )
    expect(results.size).toBeGreaterThan(2)
  })

  it('resolve grupos aninhados', () => {
    const out = resolveSpintax('{Oi{, tudo bem| por aí}|Olá}', 'c1')
    expect(['Oi, tudo bem', 'Oi por aí', 'Olá']).toContain(out)
  })

  it('não interpreta variáveis como spintax', () => {
    const out = resolveSpintax('Olá {{first_name}}, {tudo bem|como vai}?', 'c1')
    expect(out).toContain('{{first_name}}')
  })

  it('deixa chave solta intacta quando o grupo não fecha', () => {
    expect(resolveSpintax('preço R$ 1{000', 'c1')).toBe('preço R$ 1000')
  })
})

describe('substituteVariables', () => {
  it('substitui valores presentes', () => {
    const out = substituteVariables('Olá {{first_name}}', { first_name: 'Diego' }, opts)
    expect(out).toBe('Olá Diego')
  })

  it('usa o fallback quando o valor falta', () => {
    const out = substituteVariables('Olá {{first_name|tudo bem}}', {}, opts)
    expect(out).toBe('Olá tudo bem')
  })

  it('usa o fallback quando o valor é string vazia', () => {
    const out = substituteVariables('Olá {{first_name|pessoal}}', { first_name: '  ' }, opts)
    expect(out).toBe('Olá pessoal')
  })

  it('reporta variáveis ausentes sem fallback', () => {
    const missing: string[] = []
    substituteVariables('{{a}} {{b|x}} {{c}}', { b: null }, { ...opts, onMissing: (k) => missing.push(k) })
    expect(missing).toEqual(['a', 'c'])
  })

  it('escapa HTML nos valores quando pedido', () => {
    const out = substituteVariables(
      '<p>{{company}}</p>',
      { company: 'Alfa & Beta <script>' },
      { ...opts, escapeHtml: true },
    )
    expect(out).toBe('<p>Alfa &amp; Beta &lt;script&gt;</p>')
  })

  it('não reinterpreta o valor como template', () => {
    // Um cargo com chaves não pode virar spintax nem variável.
    const out = render('Cargo: {{title}}', { title: '{a|b} e {{email}}' }, opts)
    expect(out).toBe('Cargo: {a|b} e {{email}}')
  })
})

describe('renderStep', () => {
  const base = {
    subjectVariants: ['Assunto A', 'Assunto B'],
    bodyVariants: ['Corpo 1', 'Corpo 2', 'Corpo 3'],
    context: { first_name: 'Diego' },
    stepId: 'step-1',
  }

  it('atribui a mesma variante ao mesmo contato em execuções distintas', () => {
    const a = renderStep({ ...base, contactId: 'c-42' })
    const b = renderStep({ ...base, contactId: 'c-42' })
    expect(a.subjectVariant).toBe(b.subjectVariant)
    expect(a.bodyVariant).toBe(b.bodyVariant)
  })

  it('distribui variantes entre contatos', () => {
    const chosen = new Set(
      Array.from({ length: 60 }, (_, i) => renderStep({ ...base, contactId: `c-${i}` }).subjectVariant),
    )
    expect(chosen).toEqual(new Set([0, 1]))
  })

  it('reusa o assunto da thread com prefixo Re: no follow-up', () => {
    const out = renderStep({ ...base, contactId: 'c-1', threadSubject: 'Proposta comercial' })
    expect(out.subject).toBe('Re: Proposta comercial')
  })

  it('DESCARTA o assunto próprio quando encadeia na thread', () => {
    // Contrato importante: com threadSubject presente, o subjectVariants do
    // passo é ignorado por completo. A interface precisa refletir isso — um
    // campo editável aqui faria o operador escrever texto que nunca sai.
    const out = renderStep({
      ...base,
      subjectVariants: ['Assunto que não deve sair'],
      contactId: 'c-1',
      threadSubject: 'Proposta comercial',
    })
    expect(out.subject).toBe('Re: Proposta comercial')
    expect(out.subject).not.toContain('não deve sair')
  })

  it('usa o assunto próprio quando NÃO encadeia', () => {
    const out = renderStep({
      ...base,
      subjectVariants: ['Assunto próprio'],
      contactId: 'c-1',
      threadSubject: null,
    })
    expect(out.subject).toBe('Assunto próprio')
  })
})

describe('withReplyPrefix', () => {
  it('não empilha o prefixo', () => {
    expect(withReplyPrefix('Re: Proposta')).toBe('Re: Proposta')
    expect(withReplyPrefix('RE: Proposta')).toBe('RE: Proposta')
    expect(withReplyPrefix('Proposta')).toBe('Re: Proposta')
  })
})

describe('contactToContext', () => {
  it('achata os campos customizados e monta full_name', () => {
    const ctx = contactToContext({
      email: 'a@b.com',
      firstName: 'Diego',
      lastName: 'Costa',
      company: 'Acme',
      title: null,
      custom: { cidade: 'Recife' },
    })
    expect(ctx.full_name).toBe('Diego Costa')
    expect(ctx.cidade).toBe('Recife')
    expect(ctx.title).toBeNull()
  })
})
