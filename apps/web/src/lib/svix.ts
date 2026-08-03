import { createHmac, timingSafeEqual } from 'node:crypto'

/**
 * Verificação da assinatura de webhook do Resend (padrão Svix).
 *
 * Sem isso, o endpoint aceita qualquer POST — e como ele SUPRIME contatos
 * (bounce/complaint) e ENCERRA cadências, um terceiro conseguiria desligar a
 * operação de prospecção inteira com requisições forjadas.
 *
 * Implementado à mão para não trazer a dependência inteira do SDK: são
 * poucas linhas e o formato é estável.
 */

const TOLERANCE_SECONDS = 5 * 60

export type SvixHeaders = {
  id: string | null
  timestamp: string | null
  signature: string | null
}

export function verifySvixSignature(
  payload: string,
  headers: SvixHeaders,
  secret: string,
  now: Date = new Date(),
): boolean {
  const { id, timestamp, signature } = headers
  if (!id || !timestamp || !signature) return false

  // Janela de tolerância: bloqueia replay de uma entrega capturada antes.
  const sentAt = Number(timestamp)
  if (!Number.isFinite(sentAt)) return false
  if (Math.abs(now.getTime() / 1000 - sentAt) > TOLERANCE_SECONDS) return false

  const key = Buffer.from(secret.replace(/^whsec_/, ''), 'base64')
  const expected = createHmac('sha256', key)
    .update(`${id}.${timestamp}.${payload}`)
    .digest('base64')

  // O header traz versões separadas por espaço: "v1,<sig> v1,<sig2>".
  for (const part of signature.split(' ')) {
    const [version, value] = part.split(',')
    if (version !== 'v1' || !value) continue

    const a = Buffer.from(value)
    const b = Buffer.from(expected)
    if (a.length === b.length && timingSafeEqual(a, b)) return true
  }

  return false
}
