'use server'

import { revalidatePath } from 'next/cache'
import { contacts, db, eq, listContacts, lists, sql } from '@disparei/db'
import {
  applyMapping,
  filterSuppressed,
  parseCsv,
  suggestMapping,
  validateBatch,
} from '@disparei/core'
import { requireWorkspace } from '@/lib/session'
import type { ImportReport } from './labels'

/**
 * Importa um CSV para uma lista.
 *
 * A validação acontece ANTES de qualquer contato entrar no banco. É a defesa
 * mais barata que existe contra bounce, e bounce acima de 4% derruba a conta
 * no Resend — sem aviso e levando o histórico junto.
 */
export async function importCsv(formData: FormData): Promise<ImportReport> {
  const workspace = await requireWorkspace()
  const database = db()

  const file = formData.get('file')
  const listName = String(formData.get('listName') ?? '').trim() || 'Lista importada'
  const checkMx = formData.get('checkMx') === 'on'

  if (!(file instanceof File) || file.size === 0) {
    throw new Error('Selecione um arquivo CSV')
  }

  const parsed = parseCsv(await file.text())
  const mapping = suggestMapping(parsed.headers)

  if (!Object.values(mapping).includes('email')) {
    throw new Error(
      `Nenhuma coluna de e-mail encontrada. Colunas do arquivo: ${parsed.headers.join(', ')}`,
    )
  }

  const rows = applyMapping(parsed, mapping)
  const report: ImportReport = {
    totalRows: rows.length,
    imported: 0,
    discarded: [],
    warnings: [],
    listName,
  }

  // 1. Validação de sintaxe e, opcionalmente, de MX.
  const validations = await validateBatch(
    rows.map((r) => r.email),
    { checkMx },
  )

  // 2. Deduplicação dentro do próprio arquivo — lista de prospecção costuma
  //    trazer o mesmo contato em mais de uma origem.
  const seen = new Set<string>()
  const candidates: Array<{ row: (typeof rows)[number]; email: string }> = []

  validations.forEach((validation, index) => {
    const row = rows[index]
    if (!row) return

    if (!validation.valid) {
      report.discarded.push({ email: validation.email, reason: validation.reason! })
      return
    }
    if (seen.has(validation.email)) {
      report.discarded.push({ email: validation.email, reason: 'duplicate' })
      return
    }

    seen.add(validation.email)
    for (const warning of validation.warnings) {
      report.warnings.push({ email: validation.email, warning })
    }
    candidates.push({ row, email: validation.email })
  })

  // 3. Lista de supressão: quem já descadastrou, deu bounce ou pediu remoção
  //    não volta por reimportação de planilha.
  const suppressed = await filterSuppressed(
    database,
    workspace.id,
    candidates.map((c) => c.email),
  )
  const admitted = candidates.filter((c) => {
    if (suppressed.has(c.email)) {
      report.discarded.push({ email: c.email, reason: 'suppressed' })
      return false
    }
    return true
  })

  if (admitted.length === 0) return report

  // 4. Gravação.
  const [list] = await database
    .insert(lists)
    .values({ workspaceId: workspace.id, name: listName })
    .returning({ id: lists.id })

  if (!list) throw new Error('Falha ao criar a lista')

  const CHUNK = 500
  for (let i = 0; i < admitted.length; i += CHUNK) {
    const chunk = admitted.slice(i, i + CHUNK)

    const upserted = await database
      .insert(contacts)
      .values(
        chunk.map(({ row, email }) => ({
          workspaceId: workspace.id,
          email,
          firstName: row.firstName ?? null,
          lastName: row.lastName ?? null,
          company: row.company ?? null,
          title: row.title ?? null,
          custom: row.custom,
          source: listName,
        })),
      )
      // Reimportar não pode apagar dado existente: só completa o que está vazio.
      .onConflictDoUpdate({
        target: [contacts.workspaceId, contacts.email],
        set: {
          firstName: sql`coalesce(excluded.first_name, ${contacts.firstName})`,
          lastName: sql`coalesce(excluded.last_name, ${contacts.lastName})`,
          company: sql`coalesce(excluded.company, ${contacts.company})`,
          title: sql`coalesce(excluded.title, ${contacts.title})`,
          custom: sql`${contacts.custom} || excluded.custom`,
        },
      })
      .returning({ id: contacts.id, createdAt: contacts.createdAt })

    await database
      .insert(listContacts)
      .values(upserted.map((c) => ({ listId: list.id, contactId: c.id })))
      .onConflictDoNothing()

    report.imported += upserted.length
  }

  revalidatePath('/contatos')
  return report
}

export async function deleteList(formData: FormData): Promise<void> {
  const workspace = await requireWorkspace()
  const id = String(formData.get('id'))

  // Remove só a lista; os contatos e o histórico de envio permanecem.
  await db().delete(lists).where(eq(lists.id, id))
  revalidatePath('/contatos')
  void workspace
}
