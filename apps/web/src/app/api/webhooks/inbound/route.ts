import { NextResponse } from 'next/server'
import { db } from '@disparei/db'
import { handleInboundReply, recordEvent } from '@disparei/core'
import { fetchReceivedEmail } from '@disparei/email'
import { env } from '@/lib/env'
import { verifySvixSignature } from '@/lib/svix'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Recebe as respostas via Resend Inbound (evento `email.received`).
 *
 * É o endpoint que transforma a ferramenta de disparador em ferramenta de
 * vendas: para a cadência no instante da resposta e joga a mensagem na inbox
 * unificada, em vez de deixá-la perdida numa caixa pessoal.
 *
 * O payload traz SÓ metadados — o corpo é buscado à parte na API de e-mails
 * recebidos. Sem ele a classificação rodaria vazia, e um pedido de remoção
 * não dispararia a supressão.
 */

type InboundPayload = {
  type?: string
  created_at?: string
  data?: {
    email_id?: string
    to?: string[] | string
    received_for?: string[] | string
    from?: string
    subject?: string
    text?: string
    html?: string
    created_at?: string
  }
}

function toArray(value: string[] | string | undefined): string[] {
  if (!value) return []
  return Array.isArray(value) ? value : [value]
}

export async function POST(request: Request) {
  const raw = await request.text()

  // O Resend gera um secret por webhook: o do inbound é diferente do de
  // eventos. O fallback cobre quem usa o mesmo valor nos dois.
  const secret = env().RESEND_INBOUND_WEBHOOK_SECRET || env().RESEND_WEBHOOK_SECRET
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
    if (!valid) return NextResponse.json({ error: 'assinatura inválida' }, { status: 401 })
  }

  let payload: InboundPayload
  try {
    payload = JSON.parse(raw)
  } catch {
    return NextResponse.json({ error: 'json inválido' }, { status: 400 })
  }

  const data = payload.data
  if (!data?.from) {
    return NextResponse.json({ error: 'payload incompleto' }, { status: 400 })
  }

  const database = db()

  const { isDuplicate } = await recordEvent(database, {
    source: 'resend_inbound',
    type: payload.type ?? 'email.received',
    payload,
    dedupeKey: request.headers.get('svix-id'),
  })
  if (isDuplicate) return NextResponse.json({ ok: true, duplicate: true })

  const apiKey = env().RESEND_API_KEY

  const outcome = await handleInboundReply(
    database,
    {
      to: toArray(data.to),
      receivedFor: toArray(data.received_for),
      from: data.from,
      subject: data.subject ?? null,
      text: data.text ?? null,
      html: data.html ?? null,
      emailId: data.email_id ?? null,
      receivedAt: new Date(data.created_at ?? payload.created_at ?? Date.now()),
    },
    env().TOKEN_SECRET,
    // Não há fila para cancelar: marcar o enrollment como `replied` e zerar o
    // `nextSendAt` já é a interrupção da cadência.
    apiKey ? { fetchBody: (emailId: string) => fetchReceivedEmail(apiKey, emailId) } : {},
  )

  return NextResponse.json({ ok: true, ...outcome })
}
