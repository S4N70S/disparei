import { SendError } from './provider'

/**
 * Busca o conteúdo de um e-mail recebido.
 *
 * O webhook `email.received` do Resend entrega SÓ metadados — sem corpo, sem
 * headers. É decisão de projeto deles, para não estourar o limite de tamanho
 * de request em ambiente serverless quando há anexo grande.
 *
 * Para nós isso não é detalhe: sem o corpo, a classificação da resposta roda
 * sobre string vazia. Um "me remova da lista" chegaria como `unclassified` e
 * não dispararia a supressão automática — falha de LGPD, não de UX.
 */

export type ReceivedEmail = {
  id: string
  from: string
  to: string[]
  subject: string | null
  text: string | null
  html: string | null
  receivedFor: string[]
  messageId: string | null
}

type ApiResponse = {
  id?: string
  from?: string
  to?: string[] | string
  subject?: string | null
  text?: string | null
  html?: string | null
  received_for?: string[] | string
  message_id?: string | null
}

function toArray(value: string[] | string | undefined): string[] {
  if (!value) return []
  return Array.isArray(value) ? value : [value]
}

export async function fetchReceivedEmail(
  apiKey: string,
  emailId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ReceivedEmail> {
  let response: Response
  try {
    response = await fetchImpl(`https://api.resend.com/emails/receiving/${emailId}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    })
  } catch (cause) {
    throw new SendError('Falha de rede ao buscar o e-mail recebido', {
      retryable: true,
      cause,
    })
  }

  if (!response.ok) {
    throw new SendError(`Resend respondeu ${response.status} ao buscar o e-mail recebido`, {
      retryable: response.status === 429 || response.status >= 500,
      status: response.status,
    })
  }

  const json = (await response.json()) as ApiResponse

  return {
    id: json.id ?? emailId,
    from: json.from ?? '',
    to: toArray(json.to),
    subject: json.subject ?? null,
    text: json.text ?? null,
    html: json.html ?? null,
    receivedFor: toArray(json.received_for),
    messageId: json.message_id ?? null,
  }
}
