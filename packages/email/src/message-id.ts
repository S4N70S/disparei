import { randomBytes } from 'node:crypto'

/**
 * Geramos nosso próprio Message-ID em vez de depender do que o provedor
 * devolve.
 *
 * O encadeamento do follow-up (`In-Reply-To` / `References`) precisa apontar
 * para o Message-ID real do passo anterior. Se dependêssemos do valor
 * devolvido pela API, qualquer mudança de contrato do provedor quebraria a
 * thread — e quebraria em silêncio: o e-mail sairia normalmente, só deixaria
 * de ser conversa e viraria mensagem solta. Gerando nós mesmos, o valor já é
 * conhecido antes do envio e fica gravado junto da mensagem.
 */
export function generateMessageId(domain: string): string {
  const unique = `${Date.now().toString(36)}.${randomBytes(8).toString('hex')}`
  return `<${unique}@${domain}>`
}

/** Extrai o domínio do remetente para compor o Message-ID. */
export function domainFromEmail(email: string): string {
  return email.slice(email.lastIndexOf('@') + 1).toLowerCase()
}

/**
 * Monta o header `References`.
 *
 * A RFC pede a cadeia completa, na ordem. Clientes usam essa cadeia para
 * agrupar a conversa mesmo quando o In-Reply-To se perde no caminho.
 */
export function buildReferences(threadMessageIds: string[]): string | undefined {
  if (threadMessageIds.length === 0) return undefined
  return threadMessageIds.join(' ')
}

export function isValidMessageId(value: string): boolean {
  return /^<[^\s<>@]+@[^\s<>@]+>$/.test(value)
}
