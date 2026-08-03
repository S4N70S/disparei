export type Address = { name?: string | null; email: string }

export type OutboundMessage = {
  from: Address
  to: string
  replyTo?: string
  subject: string
  html: string
  text?: string
  /** Message-ID RFC 5322 que NÓS geramos (ver `message-id.ts`). */
  messageId: string
  /** In-Reply-To do passo anterior, no formato `<...>`. */
  inReplyTo?: string
  /** Cadeia completa de References, na ordem de envio. */
  references?: string[]
  /** List-Unsubscribe e afins. */
  headers?: Record<string, string>
  tags?: Record<string, string>
}

export type SendResult = {
  /** ID interno do provedor. */
  providerId: string
  /** Message-ID RFC efetivo da mensagem. */
  rfcMessageId: string
  /**
   * `false` quando o provedor pode ter reescrito o Message-ID que enviamos.
   *
   * Importa porque o encadeamento da thread depende de o In-Reply-To do passo
   * seguinte apontar para um ID que existe de verdade. Com SMTP nós
   * controlamos o header e o valor é autoritativo; com API de terceiro, não
   * necessariamente.
   */
  rfcMessageIdIsAuthoritative: boolean
}

export class SendError extends Error {
  constructor(
    message: string,
    readonly options: {
      /** `true` para falha transitória (429, 5xx, rede) — vale retry. */
      retryable: boolean
      status?: number
      cause?: unknown
    },
  ) {
    super(message)
    this.name = 'SendError'
  }
}

export interface EmailProvider {
  readonly name: 'resend' | 'smtp'
  send(message: OutboundMessage): Promise<SendResult>
  /** Valida credenciais sem enviar nada. */
  verify(): Promise<void>
}

export function formatAddress(address: Address): string {
  if (!address.name) return address.email
  // Aspas evitam quebra quando o nome tem vírgula ("Costa, Diego").
  return `"${address.name.replace(/"/g, '')}" <${address.email}>`
}
