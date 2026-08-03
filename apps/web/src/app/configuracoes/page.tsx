import { db, eq, sendingAccounts } from '@disparei/db'
import { effectiveDailyCap, isWarmupComplete } from '@disparei/core'
import { Badge, Button, Card, Field, PageHeader, inputClass } from '@/components/ui'
import { requireWorkspace } from '@/lib/session'
import { createSendingAccount, deleteSendingAccount, saveWorkspace } from './actions'

export const dynamic = 'force-dynamic'

export default async function ConfiguracoesPage() {
  const workspace = await requireWorkspace()
  const now = new Date()

  const accounts = await db()
    .select()
    .from(sendingAccounts)
    .where(eq(sendingAccounts.workspaceId, workspace.id))

  return (
    <>
      <PageHeader title="Configurações" />

      <section className="mb-8">
        <h2 className="mb-1 text-sm font-semibold">Identificação legal</h2>
        <p className="mb-3 text-sm text-[var(--color-muted)]">
          Estes dados vão no rodapé de todo e-mail enviado. Eles sustentam a base legal de
          legítimo interesse da LGPD e não podem ser removidos pelo editor de template.
        </p>

        <Card className="p-5">
          <form action={saveWorkspace} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Nome do workspace">
                <input name="name" defaultValue={workspace.name} className={inputClass} />
              </Field>
              <Field label="Razão social">
                <input name="legalName" defaultValue={workspace.legalName ?? ''} className={inputClass} />
              </Field>
              <Field label="CNPJ">
                <input name="cnpj" defaultValue={workspace.cnpj ?? ''} className={inputClass} />
              </Field>
              <Field label="E-mail de privacidade" hint="Prazo de resposta da LGPD: 15 dias.">
                <input
                  name="privacyEmail"
                  type="email"
                  placeholder="privacy@seudominio.com.br"
                  defaultValue={workspace.privacyEmail ?? ''}
                  className={inputClass}
                />
              </Field>
              <Field label="Política de privacidade (URL)">
                <input
                  name="privacyPolicyUrl"
                  type="url"
                  defaultValue={workspace.privacyPolicyUrl ?? ''}
                  className={inputClass}
                />
              </Field>
              <Field label="Endereço">
                <input
                  name="postalAddress"
                  defaultValue={workspace.postalAddress ?? ''}
                  className={inputClass}
                />
              </Field>
            </div>
            <Button type="submit">Salvar</Button>
          </form>
        </Card>
      </section>

      <section className="mb-8">
        <h2 className="mb-1 text-sm font-semibold">Caixas de envio</h2>
        <p className="mb-3 text-sm text-[var(--color-muted)]">
          O Resend proíbe prospecção fria na política de uso e exige bounce abaixo de 4%. Para
          outbound frio de verdade, cadastre uma caixa SMTP própria (Google Workspace ou
          Microsoft 365) — o e-mail sai da sua caixa real, com a reputação do seu domínio.
        </p>

        {accounts.length > 0 && (
          <Card className="mb-4 divide-y divide-[var(--color-border)]">
            {accounts.map((a) => {
              const cap = effectiveDailyCap({
                configuredCap: a.dailyCap,
                warmupStartedAt: a.warmupStartedAt,
                now,
                timezone: a.timezone,
              })
              const warm = isWarmupComplete({
                warmupStartedAt: a.warmupStartedAt,
                now,
                timezone: a.timezone,
              })

              return (
                <div key={a.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
                  <div>
                    <p className="text-sm font-medium">
                      {a.fromName} &lt;{a.fromEmail}&gt;
                    </p>
                    <p className="text-xs text-[var(--color-muted)]">
                      {a.provider} · cap hoje: {cap}/dia (configurado {a.dailyCap}) · {a.timezone}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {!a.active && <Badge tone="neutral">inativa</Badge>}
                    <Badge tone={warm ? 'green' : 'amber'}>
                      {warm ? 'aquecida' : 'em rampa'}
                    </Badge>
                    {a.active && (
                      <form action={deleteSendingAccount}>
                        <input type="hidden" name="id" value={a.id} />
                        <Button type="submit" variant="ghost" className="!px-2 !py-1 !text-xs">
                          Desativar
                        </Button>
                      </form>
                    )}
                  </div>
                </div>
              )
            })}
          </Card>
        )}

        <Card className="p-5">
          <form action={createSendingAccount} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Provedor">
                <select name="provider" className={inputClass}>
                  <option value="resend">Resend (nutrição opt-in / follow-up de inbound)</option>
                  <option value="smtp">SMTP — caixa própria (outbound frio)</option>
                </select>
              </Field>
              <Field label="Rótulo">
                <input name="label" placeholder="Caixa principal" className={inputClass} />
              </Field>
              <Field label="Nome do remetente">
                <input name="fromName" required placeholder="Diego Costa" className={inputClass} />
              </Field>
              <Field label="E-mail do remetente">
                <input
                  name="fromEmail"
                  type="email"
                  required
                  placeholder="diego@seudominio.com.br"
                  className={inputClass}
                />
              </Field>
            </div>

            <details className="rounded-lg border border-[var(--color-border)] p-3">
              <summary className="cursor-pointer text-sm font-medium">Credenciais</summary>
              <div className="mt-3 space-y-3">
                <Field label="API key (Resend)">
                  <input name="apiKey" type="password" placeholder="re_..." className={inputClass} />
                </Field>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Host SMTP">
                    <input name="host" placeholder="smtp.gmail.com" className={inputClass} />
                  </Field>
                  <Field label="Porta">
                    <input name="port" type="number" defaultValue={587} className={inputClass} />
                  </Field>
                  <Field label="Usuário SMTP">
                    <input name="user" className={inputClass} />
                  </Field>
                  <Field label="Senha SMTP" hint="No Gmail, use uma senha de app.">
                    <input name="password" type="password" className={inputClass} />
                  </Field>
                </div>
                <label className="flex items-center gap-2">
                  <input type="checkbox" name="secure" />
                  <span className="text-sm">Conexão TLS direta (porta 465)</span>
                </label>
              </div>
            </details>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Teto diário" hint="Recomendado: 30 a 50 por caixa. Teto duro: 150.">
                <input type="number" name="dailyCap" min={1} defaultValue={50} className={inputClass} />
              </Field>
              <Field label="Fuso horário">
                <input name="timezone" defaultValue="America/Sao_Paulo" className={inputClass} />
              </Field>
            </div>

            <label className="flex items-start gap-2">
              <input type="checkbox" name="startWarmup" defaultChecked className="mt-1" />
              <span className="text-sm">
                Iniciar rampa de aquecimento
                <span className="block text-xs text-[var(--color-muted)]">
                  10/dia nos primeiros 3 dias, subindo até o teto em cerca de 3 semanas. Caixa
                  nova disparando volume cheio no dia 1 é o jeito mais rápido de queimar o
                  domínio.
                </span>
              </span>
            </label>

            <Button type="submit">Cadastrar e testar conexão</Button>
          </form>
        </Card>
      </section>
    </>
  )
}
