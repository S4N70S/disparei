import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto'

const ALGO = 'aes-256-gcm'
const IV_BYTES = 12

function keyFrom(secret: string): Buffer {
  const key = Buffer.from(secret, 'base64')
  if (key.length !== 32) {
    throw new Error(
      'ENCRYPTION_KEY deve ser 32 bytes em base64. Gere com: openssl rand -base64 32',
    )
  }
  return key
}

/**
 * Cifra credenciais de remetente (API key do Resend, senha SMTP) antes de
 * gravar. Um dump do banco não pode virar acesso de envio em nome do cliente.
 */
export function encryptSecret(plaintext: string, secret: string): string {
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv(ALGO, keyFrom(secret), iv)
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return [iv.toString('base64url'), enc.toString('base64url'), tag.toString('base64url')].join('.')
}

export function decryptSecret(payload: string, secret: string): string {
  const [ivB64, dataB64, tagB64] = payload.split('.')
  if (!ivB64 || !dataB64 || !tagB64) throw new Error('Credencial cifrada malformada')

  const decipher = createDecipheriv(ALGO, keyFrom(secret), Buffer.from(ivB64, 'base64url'))
  decipher.setAuthTag(Buffer.from(tagB64, 'base64url'))
  return Buffer.concat([
    decipher.update(Buffer.from(dataB64, 'base64url')),
    decipher.final(),
  ]).toString('utf8')
}

/**
 * Token assinado para o link de descadastro e para o Reply-To.
 *
 * Assinado em vez de sorteado e guardado: o descadastro precisa funcionar sem
 * login e sem consulta extra, e não pode ser forjável — alguém descadastrando
 * terceiros em massa seria um incidente de LGPD.
 */
export function signToken(payload: string, secret: string): string {
  const mac = createHmac('sha256', secret).update(payload).digest('base64url').slice(0, 22)
  return `${Buffer.from(payload).toString('base64url')}.${mac}`
}

/**
 * Variante do token para uso DENTRO de um endereço de e-mail.
 *
 * Base64url é sensível a maiúsculas, e boa parte dos servidores normaliza o
 * local-part para minúsculas em trânsito — o que invalidaria a assinatura e
 * faria a plataforma perder respostas silenciosamente. Hex é seguro sob
 * normalização, e o resultado (49 chars) cabe no limite de 64 do local-part.
 */
export function signAddressToken(uuid: string, secret: string): string {
  const compact = uuid.replace(/-/g, '').toLowerCase()
  const mac = createHmac('sha256', secret).update(compact).digest('hex').slice(0, 16)
  return `${compact}.${mac}`
}

export function verifyAddressToken(token: string, secret: string): string | null {
  const [compact, mac] = token.toLowerCase().split('.')
  if (!compact || !mac || !/^[0-9a-f]{32}$/.test(compact)) return null

  const expected = createHmac('sha256', secret).update(compact).digest('hex').slice(0, 16)
  const a = Buffer.from(mac)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null

  // Recompõe o formato canônico de UUID.
  return [
    compact.slice(0, 8),
    compact.slice(8, 12),
    compact.slice(12, 16),
    compact.slice(16, 20),
    compact.slice(20),
  ].join('-')
}

export function verifyToken(token: string, secret: string): string | null {
  const [payloadB64, mac] = token.split('.')
  if (!payloadB64 || !mac) return null

  const payload = Buffer.from(payloadB64, 'base64url').toString('utf8')
  const expected = createHmac('sha256', secret).update(payload).digest('base64url').slice(0, 22)

  const a = Buffer.from(mac)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null

  return payload
}
