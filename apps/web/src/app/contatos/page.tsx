import { contacts, count, db, desc, eq, listContacts, lists, suppressions } from '@disparei/db'
import { Card, Empty, PageHeader, Stat } from '@/components/ui'
import { requireWorkspace } from '@/lib/session'
import { ImportForm } from './import-form'

export const dynamic = 'force-dynamic'

export default async function ContatosPage() {
  const workspace = await requireWorkspace()
  const database = db()

  const [totals] = await database
    .select({ n: count() })
    .from(contacts)
    .where(eq(contacts.workspaceId, workspace.id))

  const [suppressed] = await database
    .select({ n: count() })
    .from(suppressions)
    .where(eq(suppressions.workspaceId, workspace.id))

  const allLists = await database
    .select({
      id: lists.id,
      name: lists.name,
      createdAt: lists.createdAt,
      total: count(listContacts.contactId),
    })
    .from(lists)
    .leftJoin(listContacts, eq(listContacts.listId, lists.id))
    .where(eq(lists.workspaceId, workspace.id))
    .groupBy(lists.id)
    .orderBy(desc(lists.createdAt))

  return (
    <>
      <PageHeader
        title="Contatos"
        description="Importe a lista pronta. A validação roda antes de qualquer contato entrar na base — é o que protege a reputação do seu domínio."
      />

      <section className="mb-6 grid grid-cols-3 gap-3">
        <Stat label="Contatos" value={String(totals?.n ?? 0)} />
        <Stat label="Listas" value={String(allLists.length)} />
        <Stat
          label="Suprimidos"
          value={String(suppressed?.n ?? 0)}
          hint="nunca mais recebem envio"
        />
      </section>

      <div className="mb-8">
        <h2 className="mb-3 text-sm font-semibold">Importar CSV</h2>
        <ImportForm />
      </div>

      <h2 className="mb-3 text-sm font-semibold">Listas</h2>
      {allLists.length === 0 ? (
        <Empty title="Nenhuma lista ainda" hint="Importe um CSV acima para começar." />
      ) : (
        <Card className="divide-y divide-[var(--color-border)]">
          {allLists.map((l) => (
            <div key={l.id} className="flex items-center justify-between gap-4 p-4">
              <div>
                <p className="text-sm font-medium">{l.name}</p>
                <p className="text-xs text-[var(--color-muted)]">
                  {l.total} contatos · criada em {l.createdAt.toLocaleDateString('pt-BR')}
                </p>
              </div>
            </div>
          ))}
        </Card>
      )}
    </>
  )
}
