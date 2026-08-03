import { randomBytes, randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  decryptSecret,
  encryptSecret,
  signAddressToken,
  signToken,
  verifyAddressToken,
  verifyToken,
} from './crypto'
import { buildReplyToAddress, parseReplyToAddress } from './compliance'

const KEY = randomBytes(32).toString('base64')
const SECRET = 'segredo-de-teste'

describe('encryptSecret / decryptSecret', () => {
  it('faz round-trip', () => {
    const plain = 're_1234567890_abcdefghijklmnop'
    expect(decryptSecret(encryptSecret(plain, KEY), KEY)).toBe(plain)
  })

  it('produz ciphertext diferente a cada chamada (IV aleatório)', () => {
    expect(encryptSecret('x', KEY)).not.toBe(encryptSecret('x', KEY))
  })

  it('rejeita adulteração do ciphertext', () => {
    const payload = encryptSecret('senha', KEY)
    const [iv, data, tag] = payload.split('.')
    const tampered = [iv, Buffer.from('outracoisa').toString('base64url'), tag].join('.')
    expect(() => decryptSecret(tampered, KEY)).toThrow()
  })

  it('rejeita chave de tamanho errado', () => {
    expect(() => encryptSecret('x', 'curta')).toThrow(/32 bytes/)
  })
})

describe('signToken / verifyToken', () => {
  it('faz round-trip', () => {
    const id = randomUUID()
    expect(verifyToken(signToken(id, SECRET), SECRET)).toBe(id)
  })

  it('rejeita assinatura inválida', () => {
    expect(verifyToken(signToken('abc', SECRET), 'outro-segredo')).toBeNull()
  })

  it('rejeita token malformado', () => {
    expect(verifyToken('lixo', SECRET)).toBeNull()
    expect(verifyToken('', SECRET)).toBeNull()
  })
})

describe('token de endereço', () => {
  it('faz round-trip preservando o UUID canônico', () => {
    const id = randomUUID()
    expect(verifyAddressToken(signAddressToken(id, SECRET), SECRET)).toBe(id)
  })

  it('sobrevive à normalização para minúsculas em trânsito', () => {
    // Servidores de e-mail normalizam o local-part; um token base64url
    // quebraria aqui e a plataforma perderia a resposta silenciosamente.
    const id = randomUUID()
    const token = signAddressToken(id, SECRET)
    expect(verifyAddressToken(token.toUpperCase(), SECRET)).toBe(id)
  })

  it('cabe no limite de 64 caracteres do local-part', () => {
    const local = `r.${signAddressToken(randomUUID(), SECRET)}`
    expect(local.length).toBeLessThanOrEqual(64)
  })

  it('rejeita token forjado', () => {
    expect(verifyAddressToken('a'.repeat(32) + '.deadbeefdeadbeef', SECRET)).toBeNull()
  })
})

describe('endereço de Reply-To', () => {
  const domain = 'inbound.disparei.com.br'

  it('faz round-trip do enrollmentId', () => {
    const id = randomUUID()
    const addr = buildReplyToAddress(id, domain, SECRET)
    expect(parseReplyToAddress(addr, SECRET)).toBe(id)
  })

  it('extrai de um cabeçalho com nome de exibição', () => {
    const id = randomUUID()
    const addr = buildReplyToAddress(id, domain, SECRET)
    expect(parseReplyToAddress(`Diego Costa <${addr}>`, SECRET)).toBe(id)
  })

  it('sobrevive ao endereço normalizado para maiúsculas', () => {
    const id = randomUUID()
    const addr = buildReplyToAddress(id, domain, SECRET).toUpperCase()
    expect(parseReplyToAddress(addr, SECRET)).toBe(id)
  })

  it('ignora endereço que não é nosso', () => {
    expect(parseReplyToAddress('alguem@outrodominio.com', SECRET)).toBeNull()
    expect(parseReplyToAddress('r.naoassinado@inbound.com', SECRET)).toBeNull()
  })
})
