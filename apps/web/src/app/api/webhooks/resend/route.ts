import { NextResponse } from 'next/server'
import { db } from '@disparei/db'
import { handleEmailEvent, recordEvent, type EmailEventType } from '@disparei/core'
import { env } from '@/lib/env'
import { verifySvixSignature } from '@/lib/svix'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const HANDLED: ReadonlySet<string> = new Set<EmailEventType>([
  'email.delivered',
  'email.bounced',
  'email.complained',
  'email.opened',
  'email.clicked',
])

type ResendWebhook = {
  type?: string
  created_at?: string
  data?: { email_id?: string }
}

export async function POST(request: Request) {
  // O corpo cru é necessário para conferir a assinatura: reserializar o JSON
  // muda os bytes e invalida o HMAC.
  const raw = await request.text()

  const secret = env().RESEND_WEBHOOK_SECRET
  if (secret) {
    const valid = verifySvixSignature(
      raw,
      {
        id: request.headers.get('svix-id'),
        timestamp: request.headers.get('svix-timestamp'),
        signature: request.headers.get('svix-signature'),
      },
      secret,
    )
    if (!valid) {
      return NextResponse.json({ error: 'assinatura inválida' }, { status: 401 })
    }
  }

  let payload: ResendWebhook
  try {
    payload = JSON.parse(raw)
  } catch {
    return NextResponse.json({ error: 'json inválido' }, { status: 400 })
  }

  const type = payload.type
  const providerMessageId = payload.data?.email_id
  if (!type || !providerMessageId) {
    return NextResponse.json({ error: 'payload incompleto' }, { status: 400 })
  }

  const database = db()

  const { isDuplicate } = await recordEvent(database, {
    source: 'resend',
    type,
    payload,
    dedupeKey: request.headers.get('svix-id'),
  })
  if (isDuplicate) return NextResponse.json({ ok: true, duplicate: true })

  if (!HANDLED.has(type)) return NextResponse.json({ ok: true, ignored: true })

  // Não há fila para cancelar: o agendamento vive em `enrollments.nextSendAt`,
  // e zerá-lo no banco já impede o próximo envio.
  const outcome = await handleEmailEvent(database, {
    type: type as EmailEventType,
    providerMessageId,
    createdAt: payload.created_at ? new Date(payload.created_at) : new Date(),
  })

  // Sempre 200: um 4xx faria o Resend reentregar indefinidamente um evento
  // que nunca vamos conseguir casar (ex.: mensagem de outro ambiente).
  return NextResponse.json({ ok: true, ...outcome })
}
