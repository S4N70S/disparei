import { createHmac, randomBytes } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { verifySvixSignature } from './svix'

const SECRET_RAW = randomBytes(24).toString('base64')
const SECRET = `whsec_${SECRET_RAW}`
const PAYLOAD = JSON.stringify({ type: 'email.delivered', data: { email_id: 'abc' } })

function signedHeaders(payload = PAYLOAD, at = new Date(), id = 'msg_1') {
  const timestamp = Math.floor(at.getTime() / 1000).toString()
  const mac = createHmac('sha256', Buffer.from(SECRET_RAW, 'base64'))
    .update(`${id}.${timestamp}.${payload}`)
    .digest('base64')
  return { id, timestamp, signature: `v1,${mac}` }
}

describe('verifySvixSignature', () => {
  const now = new Date('2026-08-03T12:00:00Z')

  it('aceita assinatura válida', () => {
    expect(verifySvixSignature(PAYLOAD, signedHeaders(PAYLOAD, now), SECRET, now)).toBe(true)
  })

  it('aceita quando há múltiplas versões no header', () => {
    const h = signedHeaders(PAYLOAD, now)
    const multi = { ...h, signature: `v1,assinaturaerrada ${h.signature}` }
    expect(verifySvixSignature(PAYLOAD, multi, SECRET, now)).toBe(true)
  })

  it('rejeita corpo adulterado', () => {
    const h = signedHeaders(PAYLOAD, now)
    const tampered = JSON.stringify({ type: 'email.bounced', data: { email_id: 'abc' } })
    expect(verifySvixSignature(tampered, h, SECRET, now)).toBe(false)
  })

  it('rejeita segredo errado', () => {
    const outro = `whsec_${randomBytes(24).toString('base64')}`
    expect(verifySvixSignature(PAYLOAD, signedHeaders(PAYLOAD, now), outro, now)).toBe(false)
  })

  it('rejeita replay fora da janela de tolerância', () => {
    const antigo = new Date(now.getTime() - 10 * 60 * 1000)
    expect(verifySvixSignature(PAYLOAD, signedHeaders(PAYLOAD, antigo), SECRET, now)).toBe(false)
  })

  it('aceita dentro da janela de tolerância', () => {
    const recente = new Date(now.getTime() - 60 * 1000)
    expect(verifySvixSignature(PAYLOAD, signedHeaders(PAYLOAD, recente), SECRET, now)).toBe(true)
  })

  it('rejeita headers ausentes', () => {
    expect(
      verifySvixSignature(PAYLOAD, { id: null, timestamp: null, signature: null }, SECRET, now),
    ).toBe(false)
  })

  it('rejeita timestamp não numérico', () => {
    const h = { ...signedHeaders(PAYLOAD, now), timestamp: 'ontem' }
    expect(verifySvixSignature(PAYLOAD, h, SECRET, now)).toBe(false)
  })

  it('rejeita versão desconhecida', () => {
    const h = signedHeaders(PAYLOAD, now)
    expect(
      verifySvixSignature(PAYLOAD, { ...h, signature: h.signature.replace('v1,', 'v2,') }, SECRET, now),
    ).toBe(false)
  })
})
