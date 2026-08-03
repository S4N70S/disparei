import { and, contacts, db, enrollments, eq } from '@disparei/db'
import { suppressEmail, verifyToken } from '@disparei/core'
import { env } from '@/lib/env'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Descadastro.
 *
 * É um route handler (e não uma página) porque o mesmo endereço precisa
 * atender dois clientes diferentes:
 *
 *  - POST, sem interação humana, disparado pelo botão nativo de "cancelar
 *    inscrição" do Gmail e do Outlook (RFC 8058, `List-Unsubscribe-Post`);
 *  - GET, quando a pessoa clica no link do rodapé.
 *
 * O botão nativo importa mais do que parece: ele é a alternativa que o
 * destinatário irritado usa NO LUGAR de marcar como spam. Reclamação derruba
 * reputação de domínio; descadastro, não.
 *
 * Não há tela de confirmação: a LGPD trata o pedido como imediato, e um
 * "tem certeza?" só serve para reduzir a taxa de saída.
 */

async function processUnsubscribe(token: string): Promise<'ok' | 'invalid'> {
  const enrollmentId = verifyToken(token, env().TOKEN_SECRET)
  if (!enrollmentId) return 'invalid'

  const database = db()

  const [row] = await database
    .select({
      workspaceId: enrollments.workspaceId,
      email: contacts.email,
    })
    .from(enrollments)
    .innerJoin(contacts, eq(enrollments.contactId, contacts.id))
    .where(eq(enrollments.id, enrollmentId))
    .limit(1)

  if (!row) return 'invalid'

  // Suprime no workspace inteiro, não só nesta campanha: quem pediu para sair
  // e continua recebendo de outra sequência é o caso clássico de reclamação.
  await suppressEmail(database, {
    workspaceId: row.workspaceId,
    email: row.email,
    reason: 'unsubscribe',
    note: 'Descadastro via link do rodapé',
  })

  // `suppressEmail` já encerra todos os enrollments do e-mail e zera o
  // `nextSendAt` — não há fila separada para limpar.
  return 'ok'
}

function html(title: string, message: string, status: number): Response {
  return new Response(
    `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
<style>
  body{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#fafafa;color:#18181b;
       display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:24px}
  .card{background:#fff;border:1px solid #e4e4e7;border-radius:12px;padding:32px;max-width:440px;text-align:center}
  h1{font-size:18px;margin:0 0 8px}
  p{font-size:14px;line-height:1.6;color:#52525b;margin:0}
  @media (prefers-color-scheme: dark){
    body{background:#09090b;color:#fafafa}
    .card{background:#18181b;border-color:#27272a}
    p{color:#a1a1aa}
  }
</style>
</head>
<body><div class="card"><h1>${title}</h1><p>${message}</p></div></body>
</html>`,
    { status, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
  )
}

export async function GET(_request: Request, context: { params: Promise<{ token: string }> }) {
  const { token } = await context.params
  const result = await processUnsubscribe(token)

  return result === 'ok'
    ? html(
        'Pronto, você foi removido',
        'Não enviaremos mais e-mails para este endereço. Se isso foi um engano, basta responder a qualquer mensagem anterior.',
        200,
      )
    : html(
        'Link inválido ou expirado',
        'Não conseguimos identificar este pedido. Se você continuar recebendo mensagens, responda a qualquer uma delas pedindo a remoção.',
        404,
      )
}

export async function POST(_request: Request, context: { params: Promise<{ token: string }> }) {
  const { token } = await context.params
  const result = await processUnsubscribe(token)

  // O cliente de e-mail não renderiza este corpo — só verifica o status.
  return new Response(null, { status: result === 'ok' ? 200 : 404 })
}
