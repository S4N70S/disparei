'use server'

import { and, contacts, db, eq, listContacts } from '@disparei/db'
import {
  analyzeDeliverability,
  appendFooter,
  buildFooterHtml,
  contactToContext,
  renderBlocksToHtml,
  renderStep,
  type Block,
  type DeliverabilityReport,
} from '@disparei/core'
import { requireWorkspace } from '@/lib/session'

/**
 * Renderiza a prévia de um toque com um contato real da lista.
 *
 * Roda no servidor porque `renderStep` usa `node:crypto` para escolher a
 * variante A/B de forma determinística. O que parece limitação é garantia: a
 * prévia passa pelo MESMO código que envia, em vez de uma reimplementação
 * client-side que poderia divergir. Divergência silenciosa entre o que se vê
 * e o que sai é o pior bug possível numa ferramenta de e-mail.
 */

export type PreviewInput = {
  subject: string
  blocks: Block[]
  listId: string
  /** Índice do contato na lista, para percorrer exemplos diferentes. */
  contactOffset?: number
  provider?: 'resend' | 'smtp'
}

export type PreviewResult = {
  subject: string
  html: string
  contact: { email: string; firstName: string | null; company: string | null } | null
  missingVariables: string[]
  deliverability: DeliverabilityReport
}

export async function previewStep(input: PreviewInput): Promise<PreviewResult> {
  const workspace = await requireWorkspace()
  const database = db()

  const [contact] = await database
    .select({
      id: contacts.id,
      email: contacts.email,
      firstName: contacts.firstName,
      lastName: contacts.lastName,
      company: contacts.company,
      title: contacts.title,
      custom: contacts.custom,
    })
    .from(listContacts)
    .innerJoin(contacts, eq(listContacts.contactId, contacts.id))
    .where(and(eq(listContacts.listId, input.listId), eq(contacts.workspaceId, workspace.id)))
    .limit(1)
    .offset(Math.max(0, input.contactOffset ?? 0))

  const bodyHtml = renderBlocksToHtml(input.blocks)

  // Sem contato na lista, mostra a estrutura com os fallbacks aplicados.
  const exemplo = contact ?? {
    id: 'preview',
    email: 'prospect@exemplo.com.br',
    firstName: null,
    lastName: null,
    company: null,
    title: null,
    custom: {},
  }

  const rendered = renderStep({
    subjectVariants: [input.subject],
    bodyVariants: [bodyHtml],
    context: contactToContext(exemplo),
    contactId: exemplo.id,
    stepId: 'preview',
  })

  // O rodapé é concatenado no envio, fora do editor — a prévia precisa
  // mostrá-lo, senão o operador subestima o tamanho do e-mail.
  const html = appendFooter(
    rendered.body,
    buildFooterHtml({
      workspace,
      unsubscribeUrl: '#exemplo-de-link-de-descadastro',
    }),
  )

  return {
    subject: rendered.subject,
    html,
    contact: contact
      ? { email: contact.email, firstName: contact.firstName, company: contact.company }
      : null,
    missingVariables: rendered.missingVariables,
    deliverability: analyzeDeliverability({
      subject: input.subject,
      blocks: input.blocks,
      provider: input.provider ?? 'smtp',
    }),
  }
}
