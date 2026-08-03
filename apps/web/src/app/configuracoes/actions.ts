'use server'

import { randomBytes } from 'node:crypto'
import { revalidatePath } from 'next/cache'
import { and, db, eq, sendingAccounts, workspaces } from '@disparei/db'
import { decryptSecret, encryptSecret } from '@disparei/core'
import { createProvider } from '@disparei/email'
import { env } from '@/lib/env'
import { requireWorkspace } from '@/lib/session'

export async function saveWorkspace(formData: FormData): Promise<void> {
  const workspace = await requireWorkspace()

  await db()
    .update(workspaces)
    .set({
      name: String(formData.get('name') ?? '').trim() || workspace.name,
      legalName: String(formData.get('legalName') ?? '').trim() || null,
      cnpj: String(formData.get('cnpj') ?? '').trim() || null,
      privacyPolicyUrl: String(formData.get('privacyPolicyUrl') ?? '').trim() || null,
      privacyEmail: String(formData.get('privacyEmail') ?? '').trim() || null,
      postalAddress: String(formData.get('postalAddress') ?? '').trim() || null,
    })
    .where(eq(workspaces.id, workspace.id))

  revalidatePath('/configuracoes')
}

/**
 * Cadastra uma caixa de envio.
 *
 * As credenciais são cifradas com AES-256-GCM antes de tocar o banco, e a
 * conexão é testada na hora: descobrir que a credencial está errada durante
 * uma campanha significa mensagens falhando no meio da cadência.
 */
export async function createSendingAccount(formData: FormData): Promise<void> {
  const workspace = await requireWorkspace()
  const provider = String(formData.get('provider')) as 'resend' | 'smtp'

  const credentials =
    provider === 'resend'
      ? JSON.stringify({ apiKey: String(formData.get('apiKey') ?? '').trim() })
      : JSON.stringify({
          host: String(formData.get('host') ?? '').trim(),
          port: Number(formData.get('port') ?? 587),
          secure: formData.get('secure') === 'on',
          user: String(formData.get('user') ?? '').trim(),
          password: String(formData.get('password') ?? ''),
        })

  const encrypted = encryptSecret(credentials, env().ENCRYPTION_KEY)

  // Falha aqui aborta o cadastro — melhor do que gravar uma caixa quebrada e
  // só descobrir no meio de uma campanha.
  await createProvider(provider, decryptSecret(encrypted, env().ENCRYPTION_KEY)).verify()

  const startWarmup = formData.get('startWarmup') === 'on'

  await db()
    .insert(sendingAccounts)
    .values({
      workspaceId: workspace.id,
      provider,
      label: String(formData.get('label') ?? '').trim() || 'Caixa de envio',
      fromName: String(formData.get('fromName') ?? '').trim(),
      fromEmail: String(formData.get('fromEmail') ?? '').trim().toLowerCase(),
      credentials: encrypted,
      replyToken: randomBytes(8).toString('hex'),
      dailyCap: Math.max(1, Number(formData.get('dailyCap') ?? 50) || 50),
      // Caixa nova entra em rampa: 10/dia por 3 dias, subindo até o cap em ~3 semanas.
      warmupStartedAt: startWarmup ? new Date() : null,
      timezone: String(formData.get('timezone') ?? 'America/Sao_Paulo'),
    })

  revalidatePath('/configuracoes')
}

export async function deleteSendingAccount(formData: FormData): Promise<void> {
  const workspace = await requireWorkspace()
  const id = String(formData.get('id'))

  await db()
    .update(sendingAccounts)
    .set({ active: false })
    .where(and(eq(sendingAccounts.id, id), eq(sendingAccounts.workspaceId, workspace.id)))

  revalidatePath('/configuracoes')
}
