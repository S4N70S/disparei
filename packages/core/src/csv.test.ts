import { describe, expect, it } from 'vitest'
import { applyMapping, detectDelimiter, parseCsv, suggestMapping, toVariableName } from './csv'

describe('detectDelimiter', () => {
  it('detecta vírgula e ponto e vírgula', () => {
    expect(detectDelimiter('a,b,c\n1,2,3')).toBe(',')
    // Excel pt-BR exporta com ponto e vírgula por padrão.
    expect(detectDelimiter('nome;email;empresa\nA;a@b.com;X')).toBe(';')
  })

  it('não se confunde com vírgula dentro de aspas', () => {
    expect(detectDelimiter('"Cargo, área";email\n"Diretor, Vendas";a@b.com')).toBe(';')
  })
})

describe('parseCsv', () => {
  it('separa cabeçalho e linhas', () => {
    const r = parseCsv('nome,email\nDiego,d@acme.com\nAna,a@acme.com')
    expect(r.headers).toEqual(['nome', 'email'])
    expect(r.rows).toHaveLength(2)
    expect(r.rows[0]).toEqual(['Diego', 'd@acme.com'])
  })

  it('respeita campos com aspas, vírgulas e quebras de linha', () => {
    const r = parseCsv('empresa,obs\n"Acme, Ltda","linha 1\nlinha 2"')
    expect(r.rows[0]).toEqual(['Acme, Ltda', 'linha 1\nlinha 2'])
  })

  it('trata aspas escapadas', () => {
    const r = parseCsv('nome\n"Diego ""DC"" Costa"')
    expect(r.rows[0]?.[0]).toBe('Diego "DC" Costa')
  })

  it('remove o BOM do Excel do primeiro cabeçalho', () => {
    const r = parseCsv('﻿email,nome\na@b.com,Ana')
    expect(r.headers[0]).toBe('email')
  })

  it('descarta linhas em branco', () => {
    const r = parseCsv('email\na@b.com\n\n\nb@c.com\n')
    expect(r.rows).toHaveLength(2)
  })

  it('aceita CRLF', () => {
    const r = parseCsv('email\r\na@b.com\r\nb@c.com')
    expect(r.rows).toEqual([['a@b.com'], ['b@c.com']])
  })
})

describe('suggestMapping', () => {
  it('reconhece cabeçalhos em português e inglês', () => {
    const m = suggestMapping(['E-mail', 'Nome', 'Sobrenome', 'Empresa', 'Cargo', 'Faturamento'])
    expect(m['E-mail']).toBe('email')
    expect(m['Nome']).toBe('firstName')
    expect(m['Sobrenome']).toBe('lastName')
    expect(m['Empresa']).toBe('company')
    expect(m['Cargo']).toBe('title')
    expect(m['Faturamento']).toBe('custom')
  })

  it('não mapeia duas colunas para o mesmo campo', () => {
    const m = suggestMapping(['email', 'mail'])
    expect(Object.values(m).filter((v) => v === 'email')).toHaveLength(1)
  })
})

describe('toVariableName', () => {
  it('normaliza acentos e espaços', () => {
    expect(toVariableName('Faturamento Anual')).toBe('faturamento_anual')
    expect(toVariableName('Região')).toBe('regiao')
    expect(toVariableName('  Nº de funcionários ')).toBe('n_de_funcionarios')
  })
})

describe('applyMapping', () => {
  it('mapeia campos conhecidos e joga o resto em custom', () => {
    const parsed = parseCsv('E-mail;Nome;Empresa;Região\nd@acme.com;Diego;Acme;Nordeste')
    const rows = applyMapping(parsed, suggestMapping(parsed.headers))

    expect(rows[0]).toEqual({
      email: 'd@acme.com',
      firstName: 'Diego',
      company: 'Acme',
      custom: { regiao: 'Nordeste' },
    })
  })

  it('ignora colunas marcadas como ignore', () => {
    const parsed = parseCsv('email,lixo\na@b.com,xyz')
    const rows = applyMapping(parsed, { email: 'email', lixo: 'ignore' })
    expect(rows[0]?.custom).toEqual({})
  })
})
