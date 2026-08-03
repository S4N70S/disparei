import { describe, expect, it } from 'vitest'
import { emailDomain, normalizeEmail, validateSyntax } from './email-validation'

describe('validateSyntax', () => {
  it('aceita endereço corporativo comum', () => {
    const r = validateSyntax('Diego.Costa@Acme.com.br')
    expect(r.valid).toBe(true)
    expect(r.email).toBe('diego.costa@acme.com.br') // normalizado
  })

  it.each([
    'sem-arroba.com',
    'dois@@arrobas.com',
    'sem@dominio',
    'espaço no@meio.com',
    '@semlocal.com',
    'ponto@final.',
  ])('rejeita sintaxe inválida: %s', (email) => {
    const r = validateSyntax(email)
    expect(r.valid).toBe(false)
    expect(r.reason).toBe('invalid_syntax')
  })

  it.each(['contato@acme.com', 'vendas@acme.com', 'sac@acme.com.br', 'no-reply@acme.com', 'financeiro@acme.com'])(
    'descarta caixa coletiva: %s',
    (email) => {
      const r = validateSyntax(email)
      expect(r.valid).toBe(false)
      expect(r.reason).toBe('role_based')
    },
  )

  it('detecta caixa coletiva mesmo com +tag', () => {
    expect(validateSyntax('contato+lista@acme.com').reason).toBe('role_based')
  })

  it('não confunde nome próprio com caixa coletiva', () => {
    expect(validateSyntax('vendasca@acme.com').valid).toBe(true)
    expect(validateSyntax('marcelo@acme.com').valid).toBe(true)
  })

  it('descarta domínio descartável', () => {
    expect(validateSyntax('teste@mailinator.com').reason).toBe('disposable')
  })

  it('sinaliza e-mail pessoal sem descartar', () => {
    const r = validateSyntax('diego@gmail.com')
    expect(r.valid).toBe(true)
    expect(r.warnings).toContain('free_domain')
  })
})

describe('helpers', () => {
  it('normaliza e extrai domínio', () => {
    expect(normalizeEmail('  A@B.COM ')).toBe('a@b.com')
    expect(emailDomain('diego@acme.com.br')).toBe('acme.com.br')
  })
})
