import { NextResponse } from 'next/server'
import { db } from '@disparei/db'
import { tick } from '@disparei/core'
import { env } from '@/lib/env'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * O agendador.
 *
 * Substitui o worker contínuo: um cron externo (pg_cron do Supabase) chama
 * este endpoint a cada poucos minutos, e ele envia os passos que venceram.
 *
 * O ritmo não vem daqui — cada contato já carrega o próprio `nextSendAt`,
 * espalhado com intervalos aleatórios no momento da matrícula. Este endpoint
 * só colhe quem chegou a hora.
 */

function authorized(request: Request): boolean {
  const expected = env().CRON_SECRET
  if (!expected) return false

  // Aceita os dois formatos: `Authorization: Bearer <secret>` (padrão da
  // Vercel Cron) e `x-cron-secret` (mais simples de configurar no pg_cron).
  const bearer = request.headers.get('authorization')
  if (bearer === `Bearer ${expected}`) return true

  return request.headers.get('x-cron-secret') === expected
}

async function run(request: Request) {
  if (!authorized(request)) {
    // Sem isso, qualquer um dispara envios da sua operação.
    return NextResponse.json({ error: 'não autorizado' }, { status: 401 })
  }

  const started = Date.now()
  const result = await tick({
    db: db(),
    encryptionKey: env().ENCRYPTION_KEY,
    tokenSecret: env().TOKEN_SECRET,
    appUrl: env().APP_URL,
    inboundDomain: env().INBOUND_DOMAIN,
    maxPerTick: env().MAX_SENDS_PER_TICK,
    // Margem sob o teto de 60s da função: preferimos sair limpo e deixar o
    // resto para o próximo tick a ser cortado no meio de um envio.
    budgetMs: 45_000,
  })

  console.log(
    JSON.stringify({
      ts: new Date().toISOString(),
      msg: 'cron.tick',
      due: result.due,
      sent: result.sent,
      retried: result.retried,
      skipped: result.skipped,
      exhaustedBudget: result.exhaustedBudget,
      durationMs: Date.now() - started,
    }),
  )

  return NextResponse.json({
    ok: true,
    due: result.due,
    sent: result.sent,
    retried: result.retried,
    skipped: result.skipped,
    exhaustedBudget: result.exhaustedBudget,
  })
}

export async function GET(request: Request) {
  return run(request)
}

export async function POST(request: Request) {
  return run(request)
}
