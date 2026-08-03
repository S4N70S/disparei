import { redirect } from 'next/navigation'
import { db, workspaces } from '@disparei/db'
import { Button, Card, Field, inputClass } from '@/components/ui'
import { isAuthenticated } from '@/lib/session'

export const dynamic = 'force-dynamic'

export default async function SetupPage() {
  if (!(await isAuthenticated())) redirect('/login')

  const existing = await db().select().from(workspaces).limit(1)
  if (existing.length > 0) redirect('/')

  async function create(formData: FormData) {
    'use server'
    await db()
      .insert(workspaces)
      .values({
        name: String(formData.get('name') ?? '').trim() || 'Meu workspace',
        legalName: String(formData.get('legalName') ?? '').trim() || null,
        cnpj: String(formData.get('cnpj') ?? '').trim() || null,
        privacyEmail: String(formData.get('privacyEmail') ?? '').trim() || null,
      })
    redirect('/configuracoes')
  }

  return (
    <div className="mx-auto max-w-lg pt-8">
      <h1 className="mb-1 text-xl font-semibold">Configuração inicial</h1>
      <p className="mb-5 text-sm text-[var(--color-muted)]">
        Estes dados aparecem no rodapé de todo e-mail. São eles que sustentam a base legal de
        legítimo interesse da LGPD — dá para preencher agora e ajustar depois.
      </p>

      <Card className="p-5">
        <form action={create} className="space-y-4">
          <Field label="Nome do workspace">
            <input name="name" required defaultValue="Minha operação" className={inputClass} />
          </Field>
          <Field label="Razão social">
            <input name="legalName" className={inputClass} />
          </Field>
          <Field label="CNPJ">
            <input name="cnpj" className={inputClass} />
          </Field>
          <Field label="E-mail de privacidade">
            <input
              name="privacyEmail"
              type="email"
              placeholder="privacy@seudominio.com.br"
              className={inputClass}
            />
          </Field>
          <Button type="submit">Continuar</Button>
        </form>
      </Card>
    </div>
  )
}
