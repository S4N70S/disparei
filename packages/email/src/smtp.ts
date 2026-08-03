import nodemailer, { type Transporter } from 'nodemailer'
import type SMTPTransport from 'nodemailer/lib/smtp-transport'
import { buildReferences } from './message-id'
import { formatAddress, SendError, type EmailProvider, type OutboundMessage, type SendResult } from './provider'

export type SmtpCredentials = {
  host: string
  port: number
  secure: boolean
  user: string
  password: string
}

/**
 * Adapter SMTP — o caminho correto para prospecção fria.
 *
 * O e-mail sai da caixa real do vendedor (Google Workspace, Microsoft 365),
 * com a reputação do próprio domínio, e chega como mensagem 1:1 em vez de
 * disparo de ESP transacional. É como Instantly, Smartlead e Lemlist operam,
 * e é o que a política do Resend não permite.
 *
 * Aqui o Message-ID é autoritativo: nós escrevemos o header e o servidor o
 * preserva, então o encadeamento da thread é garantido.
 */
export class SmtpProvider implements EmailProvider {
  readonly name = 'smtp' as const
  private transporter: Transporter

  constructor(credentials: SmtpCredentials) {
    const options: SMTPTransport.Options = {
      host: credentials.host,
      port: credentials.port,
      secure: credentials.secure,
      auth: { user: credentials.user, pass: credentials.password },
    }
    // Sem pool: uma conexão por envio mantém o ritmo humano, enquanto pooling
    // agressivo produz justamente o padrão de rajada que queremos evitar.
    this.transporter = nodemailer.createTransport(options)
  }

  async send(message: OutboundMessage): Promise<SendResult> {
    try {
      const info = await this.transporter.sendMail({
        from: formatAddress(message.from),
        to: message.to,
        replyTo: message.replyTo,
        subject: message.subject,
        html: message.html,
        text: message.text,
        messageId: message.messageId,
        inReplyTo: message.inReplyTo,
        references: buildReferences(message.references ?? []),
        headers: message.headers,
      })

      return {
        providerId: info.messageId ?? message.messageId,
        rfcMessageId: info.messageId ?? message.messageId,
        rfcMessageIdIsAuthoritative: true,
      }
    } catch (cause) {
      const code = (cause as { responseCode?: number }).responseCode
      // 4xx SMTP é transitório (greylisting, throttle); 5xx é permanente.
      const retryable = code === undefined || (code >= 400 && code < 500)
      throw new SendError(`Falha no envio SMTP: ${(cause as Error).message}`, {
        retryable,
        status: code,
        cause,
      })
    }
  }

  async verify(): Promise<void> {
    try {
      await this.transporter.verify()
    } catch (cause) {
      throw new SendError(`Credencial SMTP inválida: ${(cause as Error).message}`, {
        retryable: false,
        cause,
      })
    }
  }
}
