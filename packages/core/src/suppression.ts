import { and, eq, or, sql, suppressions, enrollments, contacts } from '@disparei/db'
import type { Database } from '@disparei/db'
import { emailDomain, normalizeEmail } from './email-validation'

export type SuppressionReason =
  | 'unsubscribe'
  | 'bounce'
  | 'complaint'
  | 'manual'
  | 'negative_reply'

/**
 * A supressão é checada NO MOMENTO DO ENVIO, não só na importação.
 *
 * Entre agendar e enviar podem passar dias: nesse intervalo o contato pode ter
 * descadastrado, dado bounce em outra campanha ou pedido remoção por resposta.
 * Enviar mesmo assim é a falha que gera reclamação — e reclamação é o que
 * derruba reputação de domínio e, no caso do Resend, a conta inteira.
 */
export async function isSuppressed(
  database: Database,
  workspaceId: string,
  rawEmail: string,
): Promise<boolean> {
  const email = normalizeEmail(rawEmail)
  const domain = emailDomain(email)

  const [hit] = await database
    .select({ id: suppressions.id })
    .from(suppressions)
    .where(
      and(
        eq(suppressions.workspaceId, workspaceId),
        or(eq(suppressions.email, email), eq(suppressions.domain, domain)),
      ),
    )
    .limit(1)

  return hit !== undefined
}

/** Filtra uma lista inteira numa query só — usado na importação de CSV. */
export async function filterSuppressed(
  database: Database,
  workspaceId: string,
  emails: string[],
): Promise<Set<string>> {
  if (emails.length === 0) return new Set()

  const normalized = emails.map(normalizeEmail)
  const domains = [...new Set(normalized.map(emailDomain))]

  const rows = await database
    .select({ email: suppressions.email, domain: suppressions.domain })
    .from(suppressions)
    .where(
      and(
        eq(suppressions.workspaceId, workspaceId),
        or(
          sql`${suppressions.email} = any(${normalized})`,
          sql`${suppressions.domain} = any(${domains})`,
        ),
      ),
    )

  const blockedEmails = new Set(rows.map((r) => r.email).filter((e): e is string => !!e))
  const blockedDomains = new Set(rows.map((r) => r.domain).filter((d): d is string => !!d))

  return new Set(
    normalized.filter((e) => blockedEmails.has(e) || blockedDomains.has(emailDomain(e))),
  )
}

/**
 * Suprime e encerra TODAS as cadências ativas daquele e-mail no workspace —
 * não só a campanha que originou o pedido. Alguém que pediu para sair e
 * continua recebendo de outra sequência é exatamente o caso que a ANPD trata
 * como descumprimento.
 */
export async function suppressEmail(
  database: Database,
  params: {
    workspaceId: string
    email: string
    reason: SuppressionReason
    note?: string
  },
): Promise<void> {
  const email = normalizeEmail(params.email)

  await database.transaction(async (tx) => {
    await tx
      .insert(suppressions)
      .values({
        workspaceId: params.workspaceId,
        email,
        reason: params.reason,
        note: params.note ?? null,
      })
      .onConflictDoNothing()

    const matching = tx
      .select({ id: contacts.id })
      .from(contacts)
      .where(and(eq(contacts.workspaceId, params.workspaceId), eq(contacts.email, email)))

    await tx
      .update(contacts)
      .set({ status: params.reason === 'bounce' ? 'bounced' : 'unsubscribed' })
      .where(and(eq(contacts.workspaceId, params.workspaceId), eq(contacts.email, email)))

    await tx
      .update(enrollments)
      .set({ status: 'unsubscribed', nextSendAt: null })
      .where(
        and(
          eq(enrollments.workspaceId, params.workspaceId),
          eq(enrollments.status, 'active'),
          sql`${enrollments.contactId} in ${matching}`,
        ),
      )
  })
}

export async function suppressDomain(
  database: Database,
  params: { workspaceId: string; domain: string; note?: string },
): Promise<void> {
  await database
    .insert(suppressions)
    .values({
      workspaceId: params.workspaceId,
      domain: params.domain.trim().toLowerCase(),
      reason: 'manual',
      note: params.note ?? null,
    })
    .onConflictDoNothing()
}
