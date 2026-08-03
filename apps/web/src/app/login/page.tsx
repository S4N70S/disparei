import { redirect } from 'next/navigation'
import { Button, Card, Field, inputClass } from '@/components/ui'
import { createSession, isAuthenticated, verifyPassword } from '@/lib/session'

export const dynamic = 'force-dynamic'

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ erro?: string }>
}) {
  if (await isAuthenticated()) redirect('/')
  const { erro } = await searchParams

  async function login(formData: FormData) {
    'use server'
    const password = String(formData.get('password') ?? '')
    if (!verifyPassword(password)) redirect('/login?erro=1')
    await createSession()
    redirect('/')
  }

  return (
    <div className="mx-auto max-w-sm pt-16">
      <Card className="p-6">
        <h1 className="mb-1 text-lg font-semibold">Entrar</h1>
        <p className="mb-5 text-sm text-[var(--color-muted)]">
          Acesso ao painel de prospecção.
        </p>

        <form action={login} className="space-y-4">
          <Field label="Senha">
            <input type="password" name="password" required autoFocus className={inputClass} />
          </Field>

          {erro && <p className="text-sm text-red-600 dark:text-red-400">Senha incorreta.</p>}

          <Button type="submit" className="w-full">
            Entrar
          </Button>
        </form>
      </Card>
    </div>
  )
}
