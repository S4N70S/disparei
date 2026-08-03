import { buildReferences } from './message-id'
import { formatAddress, SendError, type EmailProvider, type OutboundMessage, type SendResult } from './provider'

const API = 'https://api.resend.com'

/**
 * Adapter do Resend.
 *
 * ATENÇÃO OPERACIONAL: a Acceptable Use Policy do Resend proíbe
 * "unsolicited messages of any kind, including cold outreach, purchased
 * lists, or scraped contact data", e exige complaint < 0,08% e bounce < 4%
 * sob pena de suspensão sem aviso. Este adapter é adequado para nutrição
 * opt-in e follow-up de inbound. Para prospecção fria, use o SmtpProvider
 * com caixas próprias — é assim que as ferramentas do mercado operam, e não
 * é só questão de política: IP compartilhado de ESP transacional entrega
 * cold email em spam.
 */
export class ResendProvider implements EmailProvider {
  readonly name = 'resend' as const

  constructor(
    private readonly apiKey: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async send(message: OutboundMessage): Promise<SendResult> {
    const headers: Record<string, string> = { ...message.headers }

    // Enviamos nosso Message-ID; o Resend pode reescrever (ver
    // `rfcMessageIdIsAuthoritative` abaixo).
    headers['Message-ID'] = message.messageId
    if (message.inReplyTo) headers['In-Reply-To'] = message.inReplyTo

    const references = buildReferences(message.references ?? [])
    if (references) headers['References'] = references

    const body = {
      from: formatAddress(message.from),
      to: [message.to],
      subject: message.subject,
      html: message.html,
      ...(message.text ? { text: message.text } : {}),
      ...(message.replyTo ? { reply_to: [message.replyTo] } : {}),
      headers,
      ...(message.tags
        ? { tags: Object.entries(message.tags).map(([name, value]) => ({ name, value })) }
        : {}),
    }

    let response: Response
    try {
      response = await this.fetchImpl(`${API}/emails`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          // Reenvio do mesmo job (retry do BullMQ) não deve gerar e-mail duplicado.
          'Idempotency-Key': message.messageId,
        },
        body: JSON.stringify(body),
      })
    } catch (cause) {
      throw new SendError('Falha de rede ao chamar o Resend', { retryable: true, cause })
    }

    if (!response.ok) {
      const detail = await response.text().catch(() => '')
      // 429 (rate limit: 10 req/s por team) e 5xx são transitórios.
      const retryable = response.status === 429 || response.status >= 500
      throw new SendError(`Resend respondeu ${response.status}: ${detail.slice(0, 500)}`, {
        retryable,
        status: response.status,
      })
    }

    const json = (await response.json()) as { id?: string }
    if (!json.id) {
      throw new SendError('Resend não devolveu id da mensagem', { retryable: false })
    }

    return {
      providerId: json.id,
      rfcMessageId: message.messageId,
      // A API não confirma o Message-ID final. O worker reconcilia pelo
      // webhook quando ele chega; até lá o encadeamento usa o nosso valor.
      rfcMessageIdIsAuthoritative: false,
    }
  }

  async verify(): Promise<void> {
    const response = await this.fetchImpl(`${API}/domains`, {
      headers: { Authorization: `Bearer ${this.apiKey}` },
    })
    if (!response.ok) {
      throw new SendError(`Credencial do Resend inválida (${response.status})`, {
        retryable: false,
        status: response.status,
      })
    }
  }
}
