import { describe, expect, it, vi } from 'vitest'
import { fetchReceivedEmail } from './received'
import type { SendError } from './provider'

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('fetchReceivedEmail', () => {
  it('chama o endpoint correto com o Bearer token', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ id: 'abc', text: 'oi' }))

    await fetchReceivedEmail('re_key', 'abc', fetchMock as unknown as typeof fetch)

    expect(fetchMock.mock.calls[0]![0]).toBe('https://api.resend.com/emails/receiving/abc')
    expect(fetchMock.mock.calls[0]![1].headers.Authorization).toBe('Bearer re_key')
  })

  it('normaliza corpo, remetente e destinatários', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        id: 'abc',
        from: 'Ana <ana@empresa.com>',
        to: 'r.token@inbound.budsmeet.com.br',
        received_for: ['r.token@inbound.budsmeet.com.br'],
        subject: 'Re: Proposta',
        text: 'Tenho interesse',
        html: '<p>Tenho interesse</p>',
        message_id: '<x@y>',
      }),
    )

    const email = await fetchReceivedEmail('re_key', 'abc', fetchMock as unknown as typeof fetch)

    expect(email.text).toBe('Tenho interesse')
    expect(email.html).toBe('<p>Tenho interesse</p>')
    // `to` vem como string quando há um destinatário só — normalizamos p/ array.
    expect(email.to).toEqual(['r.token@inbound.budsmeet.com.br'])
    expect(email.receivedFor).toEqual(['r.token@inbound.budsmeet.com.br'])
  })

  it('tolera campos ausentes', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ id: 'abc' }))
    const email = await fetchReceivedEmail('re_key', 'abc', fetchMock as unknown as typeof fetch)

    expect(email.text).toBeNull()
    expect(email.to).toEqual([])
  })

  it.each([
    [429, true],
    [500, true],
    [404, false],
    [401, false],
  ])('marca status %i como retryable=%s', async (status, retryable) => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('erro', { status }))

    await expect(
      fetchReceivedEmail('re_key', 'abc', fetchMock as unknown as typeof fetch),
    ).rejects.toSatisfy((e) => (e as SendError).options.retryable === retryable)
  })

  it('trata falha de rede como transitória', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('ECONNRESET'))

    await expect(
      fetchReceivedEmail('re_key', 'abc', fetchMock as unknown as typeof fetch),
    ).rejects.toSatisfy((e) => (e as SendError).options.retryable === true)
  })
})
