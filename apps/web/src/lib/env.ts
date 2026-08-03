import { z } from 'zod'

const schema = z.object({
  DATABASE_URL: z.string().url(),
  /** 32 bytes em base64: `openssl rand -base64 32`. */
  ENCRYPTION_KEY: z.string().min(32),
  /** Assina tokens de descadastro e de Reply-To. */
  TOKEN_SECRET: z.string().min(16),
  /** Base pública — entra no link de descadastro de todo e-mail. */
  APP_URL: z.string().url(),
  /** Domínio configurado no Resend Inbound para receber as respostas. */
  INBOUND_DOMAIN: z.string().min(3),
  /** Protege o endpoint de cron. Sem ele, qualquer um dispara seus envios. */
  CRON_SECRET: z.string().min(16).optional(),
  /**
   * Segredo do webhook de eventos de envio (Svix).
   *
   * O Resend gera um secret POR webhook. Como cadastramos dois endpoints
   * (eventos e inbound), são dois valores distintos — usar um só faria o
   * segundo endpoint rejeitar toda entrega como assinatura inválida.
   */
  RESEND_WEBHOOK_SECRET: z.string().optional(),
  /** Segredo do webhook de recebimento. Se ausente, cai no acima. */
  RESEND_INBOUND_WEBHOOK_SECRET: z.string().optional(),
  /**
   * Necessária para buscar o corpo das respostas: o webhook `email.received`
   * entrega só metadados. Sem ela a resposta é gravada sem texto e a
   * classificação não roda.
   */
  RESEND_API_KEY: z.string().optional(),
  /**
   * Envios por invocação do cron. Junto com o intervalo do cron, define o
   * teto de vazão — 3 a cada 2 min ≈ 2.000/dia, muito acima do necessário.
   */
  MAX_SENDS_PER_TICK: z.coerce.number().int().min(1).max(50).default(3),
  /** Senha de acesso ao painel no v1 (workspace único). */
  APP_PASSWORD: z.string().min(8),
})

let cached: z.infer<typeof schema> | undefined

export function env() {
  if (!cached) {
    const parsed = schema.safeParse(process.env)
    if (!parsed.success) {
      const issues = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`)
      throw new Error(`Variáveis de ambiente inválidas:\n${issues.join('\n')}`)
    }
    cached = parsed.data
  }
  return cached
}
