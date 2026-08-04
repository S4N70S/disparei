import { db, eq, lists, sendingAccounts } from '@disparei/db'
import { TOUCH_LIBRARY } from '@disparei/core'
import { Empty, PageHeader } from '@/components/ui'
import { CampaignBuilder } from '@/components/campaign-builder'
import { requireWorkspace } from '@/lib/session'

export const dynamic = 'force-dynamic'

export default async function NovaCampanhaPage() {
  const workspace = await requireWorkspace()
  const database = db()

  const allLists = await database.select().from(lists).where(eq(lists.workspaceId, workspace.id))
  const accounts = await database
    .select()
    .from(sendingAccounts)
    .where(eq(sendingAccounts.workspaceId, workspace.id))

  if (allLists.length === 0 || accounts.length === 0) {
    return (
      <>
        <PageHeader title="Nova campanha" />
        <Empty
          title="Falta configurar o básico"
          hint={
            allLists.length === 0
              ? 'Importe uma lista em Contatos antes de criar a campanha.'
              : 'Cadastre uma caixa de envio em Configurações antes de criar a campanha.'
          }
        />
      </>
    )
  }

  return (
    <CampaignBuilder
      options={{
        lists: allLists.map((l) => ({ id: l.id, name: l.name })),
        accounts: accounts.map((a) => ({
          id: a.id,
          fromName: a.fromName,
          fromEmail: a.fromEmail,
          provider: a.provider,
        })),
        library: TOUCH_LIBRARY,
      }}
    />
  )
}
