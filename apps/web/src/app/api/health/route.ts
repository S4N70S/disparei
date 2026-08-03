import { NextResponse } from 'next/server'
import { env } from '@/lib/env'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Diagnóstico de configuração.
 *
 * Existe porque um erro de variável de ambiente em serverless vira um 500 de
 * corpo vazio: o Next esconde a mensagem em produção, e descobrir qual
 * variável está errada exige cavar os logs da plataforma.
 *
 * NUNCA devolve valores — só o nome da variável e se ela passou na validação.
 * Saber que `DATABASE_URL` está malformada não vaza a senha do banco.
 */

/** Variáveis exigidas pelo schema, na ordem em que quebram o app. */
const EXPECTED = [
  'DATABASE_URL',
  'ENCRYPTION_KEY',
  'TOKEN_SECRET',
  'APP_URL',
  'INBOUND_DOMAIN',
  'APP_PASSWORD',
  'CRON_SECRET',
  'RESEND_API_KEY',
  'RESEND_WEBHOOK_SECRET',
] as const

export async function GET() {
  // Erro comum: colar o valor com as aspas do arquivo .env junto.
  const quoted = EXPECTED.filter((k) => {
    const v = process.env[k]
    return v !== undefined && /^["'].*["']$/.test(v)
  })

  const present = EXPECTED.filter((k) => (process.env[k] ?? '') !== '')
  const missing = EXPECTED.filter((k) => (process.env[k] ?? '') === '')

  let envValid = true
  let envError: string | null = null
  try {
    env()
  } catch (error) {
    envValid = false
    envError = (error as Error).message
  }

  return NextResponse.json(
    {
      ok: envValid,
      env: {
        valid: envValid,
        // A mensagem do Zod traz só nomes de campo e o motivo, sem valores.
        error: envError,
        present,
        missing,
        // Se cair aqui, o valor foi colado com aspas e está literalmente
        // com elas — o Zod rejeita, e ninguém desconfia olhando o painel.
        wrappedInQuotes: quoted,
      },
      runtime: {
        node: process.version,
        region: process.env.VERCEL_REGION ?? null,
        commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? null,
      },
    },
    { status: envValid ? 200 : 503 },
  )
}
