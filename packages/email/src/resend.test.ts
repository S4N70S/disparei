import { describe, expect, it, vi } from 'vitest'
import { ResendProvider } from './resend'
import { SendError } from './provider'
import { generateMessageId } from './message-id'

function okResponse(id = 'resend-id-1') {
  return new Response(JSON.stringify({ id }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

const baseMessage = {
  from: { name: 'Diego Costa', email: 'diego@acme.com.br' },
  to: 'prospect@empresa.com',
  subject: 'Proposta',
  html: '<p>Olá</p>',
  messageId: '<abc@acme.com.br>',
}

describe('ResendProvider.send', () => {
  it('envia com from formatado e captura o id do provedor', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse('res_123'))
    const provider = new ResendProvider('re_key', fetchMock as unknown as typeof fetch)

    const result = await provider.send(baseMessage)

    expect(result.providerId).toBe('res_123')
    expect(result.rfcMessageId).toBe('<abc@acme.com.br>')

    const body = JSON.parse(fetchMock.mock.calls[0]![1].body)
    expect(body.from).toBe('"Diego Costa" <diego@acme.com.br>')
    expect(body.to).toEqual(['prospect@empresa.com'])
  })

  it('envia os headers de encadeamento no follow-up', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse())
    const provider = new ResendProvider('re_key', fetchMock as unknown as typeof fetch)

    await provider.send({
      ...baseMessage,
      inReplyTo: '<passo1@acme.com.br>',
      references: ['<passo1@acme.com.br>', '<passo2@acme.com.br>'],
      headers: { 'List-Unsubscribe': '<https://x/u/1>' },
    })

    const { headers } = JSON.parse(fetchMock.mock.calls[0]![1].body)
    expect(headers['In-Reply-To']).toBe('<passo1@acme.com.br>')
    expect(headers['References']).toBe('<passo1@acme.com.br> <passo2@acme.com.br>')
    expect(headers['Message-ID']).toBe('<abc@acme.com.br>')
    expect(headers['List-Unsubscribe']).toBe('<https://x/u/1>')
  })

  it('omite In-Reply-To e References no primeiro passo', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse())
    const provider = new ResendProvider('re_key', fetchMock as unknown as typeof fetch)

    await provider.send(baseMessage)

    const { headers } = JSON.parse(fetchMock.mock.calls[0]![1].body)
    expect(headers['In-Reply-To']).toBeUndefined()
    expect(headers['References']).toBeUndefined()
  })

  it('usa o Message-ID como chave de idempotência', async () => {
    // Retry do BullMQ não pode gerar um segundo e-mail para o mesmo prospect.
    const fetchMock = vi.fn().mockResolvedValue(okResponse())
    const provider = new ResendProvider('re_key', fetchMock as unknown as typeof fetch)

    await provider.send(baseMessage)

    expect(fetchMock.mock.calls[0]![1].headers['Idempotency-Key']).toBe('<abc@acme.com.br>')
  })

  it('não afirma autoridade sobre o Message-ID', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse())
    const provider = new ResendProvider('re_key', fetchMock as unknown as typeof fetch)

    const result = await provider.send(baseMessage)
    expect(result.rfcMessageIdIsAuthoritative).toBe(false)
  })

  it.each([
    [429, true],
    [500, true],
    [503, true],
    [422, false],
    [401, false],
  ])('marca status %i como retryable=%s', async (status, retryable) => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('erro', { status }))
    const provider = new ResendProvider('re_key', fetchMock as unknown as typeof fetch)

    await expect(provider.send(baseMessage)).rejects.toMatchObject({
      name: 'SendError',
      options: { retryable },
    })
  })

  it('trata falha de rede como transitória', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('ECONNRESET'))
    const provider = new ResendProvider('re_key', fetchMock as unknown as typeof fetch)

    await expect(provider.send(baseMessage)).rejects.toSatisfy(
      (e) => (e as SendError).options.retryable === true,
    )
  })
})

describe('generateMessageId', () => {
  it('gera IDs únicos no formato RFC', () => {
    const a = generateMessageId('acme.com.br')
    const b = generateMessageId('acme.com.br')
    expect(a).toMatch(/^<[^@]+@acme\.com\.br>$/)
    expect(a).not.toBe(b)
  })
})
