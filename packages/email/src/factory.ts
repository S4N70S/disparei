import type { EmailProvider } from './provider'
import { ResendProvider } from './resend'
import { SmtpProvider, type SmtpCredentials } from './smtp'

/**
 * Constrói o provedor a partir de credenciais JÁ DECIFRADAS.
 *
 * A decifragem fica com quem chama, de propósito: se este package importasse
 * o `decryptSecret` do core, teríamos ciclo — o core precisa importar daqui
 * para enviar. Manter `email` sem dependências internas deixa a direção do
 * grafo em um sentido só.
 */
export function createProvider(
  provider: 'resend' | 'smtp',
  credentials: string,
): EmailProvider {
  switch (provider) {
    case 'resend': {
      const { apiKey } = JSON.parse(credentials) as { apiKey: string }
      return new ResendProvider(apiKey)
    }
    case 'smtp': {
      return new SmtpProvider(JSON.parse(credentials) as SmtpCredentials)
    }
    default: {
      const exhaustive: never = provider
      throw new Error(`Provedor não suportado: ${String(exhaustive)}`)
    }
  }
}
