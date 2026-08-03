/**
 * Preflight antes do primeiro envio.
 *
 * Confere as coisas que só falham em produção e falham caro: DNS de
 * autenticação faltando (a mensagem cai em spam com a sequência perfeita),
 * banco sem migration, Redis inacessível, domínio de inbound sem MX (a
 * plataforma perde toda resposta em silêncio).
 *
 *   npx tsx scripts/doctor.ts
 */

import { createDatabase, sql } from '@disparei/db'
import { lookupMx, lookupTxt } from './lib/dns'
import { loadEnvFile } from './lib/load-env'
import { check, printResult, printSection, summarize, type CheckResult } from './lib/report'

const results: CheckResult[] = []

const loadedEnv = loadEnvFile()
console.log(
  loadedEnv ? '\n\x1b[90m.env carregado da raiz\x1b[0m' : '\n\x1b[90mnenhum .env na raiz — usando o ambiente do shell\x1b[0m',
)

/** Registra um resultado já pronto (sem função de checagem). */
function record(result: CheckResult): void {
  printResult(result)
  results.push(result)
}

// ---------------------------------------------------------------------------
// Ambiente
// ---------------------------------------------------------------------------

const REQUIRED = [
  'DATABASE_URL',
  'ENCRYPTION_KEY',
  'TOKEN_SECRET',
  'APP_URL',
  'INBOUND_DOMAIN',
  'APP_PASSWORD',
] as const

/**
 * Nunca imprime credencial.
 *
 * A saída do doctor é feita para ser colada em chat, ticket e screenshot —
 * mostrar a senha do banco aqui é vazamento, mesmo rodando na máquina do
 * dono. Só passam adiante valores que ajudam no diagnóstico e não são
 * segredo: domínio, host, porta.
 */
function safeDetail(key: string, value: string): string {
  if (/SECRET|KEY|PASSWORD|TOKEN/.test(key)) return 'definida'

  // Connection string: mostra host e porta, esconde usuário e senha.
  if (/^[a-z+]+:\/\//.test(value)) {
    try {
      const url = new URL(value)
      const auth = url.username ? `${url.username}:****@` : ''
      return `${url.protocol}//${auth}${url.host}${url.pathname}`
    } catch {
      return 'definida'
    }
  }

  return value
}

printSection('Ambiente')

for (const key of REQUIRED) {
  results.push(
    await check(key, async () => {
      const value = process.env[key]
      if (!value) {
        return {
          status: 'fail',
          detail: 'não definida',
          fix: 'copie .env.example para .env e preencha',
        }
      }

      if (key === 'ENCRYPTION_KEY') {
        const bytes = Buffer.from(value, 'base64').length
        if (bytes !== 32) {
          return {
            status: 'fail',
            detail: `${bytes} bytes, precisa de 32`,
            fix: 'openssl rand -base64 32',
          }
        }
      }

      if (key === 'TOKEN_SECRET' && value.length < 32) {
        return {
          status: 'warn',
          detail: `${value.length} caracteres — curto para assinar tokens públicos`,
          fix: 'openssl rand -hex 32',
        }
      }

      if (key === 'APP_URL' && /localhost|127\.0\.0\.1/.test(value)) {
        return {
          status: 'warn',
          detail: 'aponta para localhost',
          fix: 'em produção precisa ser público: o link de descadastro vai nesta base e o botão nativo do Gmail faz POST nele',
        }
      }

      return { status: 'ok', detail: safeDetail(key, value) }
    }),
  )
}

results.push(
  await check('RESEND_WEBHOOK_SECRET', async () => {
    const value = process.env.RESEND_WEBHOOK_SECRET
    if (!value) {
      return {
        status: 'warn',
        detail: 'não definida — endpoints de webhook aceitam qualquer POST',
        fix: 'os webhooks suprimem contatos e encerram cadências; defina antes de expor o app',
      }
    }
    return { status: 'ok', detail: 'definida' }
  }),
)

// ---------------------------------------------------------------------------
// Banco
// ---------------------------------------------------------------------------

printSection('Banco de dados')

const databaseUrl = process.env.DATABASE_URL

if (!databaseUrl) {
  record({ name: 'Conexão', status: 'skip', detail: 'DATABASE_URL ausente' })
} else {
  const db = createDatabase(databaseUrl, { max: 1 })

  results.push(
    await check('Conexão', async () => {
      const [row] = await db.execute<{ version: string }>(sql`select version() as version`)
      return { status: 'ok', detail: (row?.version ?? '').split(',')[0] ?? 'conectado' }
    }),
  )

  results.push(
    await check('Migrations aplicadas', async () => {
      const [row] = await db.execute<{ n: number }>(
        sql`select count(*)::int as n from information_schema.tables
            where table_schema = 'public'
              and table_name in ('workspaces','contacts','campaigns','enrollments','messages','replies','suppressions','sending_accounts')`,
      )
      const found = row?.n ?? 0
      if (found < 8) {
        return {
          status: 'fail',
          detail: `${found} de 8 tabelas principais`,
          fix: 'npm run db:migrate',
        }
      }
      return { status: 'ok', detail: '8 de 8 tabelas principais' }
    }),
  )

  results.push(
    await check('Workspace configurado', async () => {
      const [row] = await db.execute<{ n: number; cnpj: string | null }>(
        sql`select count(*)::int as n, max(cnpj) as cnpj from workspaces`,
      )
      if ((row?.n ?? 0) === 0) {
        return { status: 'warn', detail: 'nenhum', fix: 'acesse /setup no app' }
      }
      if (!row?.cnpj) {
        return {
          status: 'warn',
          detail: 'sem CNPJ',
          fix: 'o rodapé de LGPD exige identificação do remetente — preencha em /configuracoes',
        }
      }
      return { status: 'ok', detail: 'com dados legais preenchidos' }
    }),
  )

  results.push(
    await check('Caixas de envio', async () => {
      const [row] = await db.execute<{ n: number; providers: string }>(
        sql`select count(*)::int as n, string_agg(distinct provider::text, ', ') as providers
            from sending_accounts where active = true`,
      )
      if ((row?.n ?? 0) === 0) {
        return { status: 'fail', detail: 'nenhuma ativa', fix: 'cadastre em /configuracoes' }
      }
      const providers = row?.providers ?? ''
      if (providers === 'resend') {
        return {
          status: 'warn',
          detail: `${row?.n} ativa(s), só Resend`,
          fix: 'a política do Resend proíbe prospecção fria — para outbound frio cadastre uma caixa SMTP própria',
        }
      }
      return { status: 'ok', detail: `${row?.n} ativa(s): ${providers}` }
    }),
  )
}

// ---------------------------------------------------------------------------
// Redis
// ---------------------------------------------------------------------------

printSection('Agendamento')

results.push(
  await check('CRON_SECRET', async () => {
    const value = process.env.CRON_SECRET
    if (!value) {
      return {
        status: 'fail',
        detail: 'não definida',
        fix: 'sem ela o endpoint /api/cron/tick recusa tudo e nada é enviado. Gere com: openssl rand -hex 32',
      }
    }
    if (value.length < 16) {
      return { status: 'warn', detail: 'curta demais', fix: 'openssl rand -hex 32' }
    }
    return { status: 'ok', detail: 'definida' }
  }),
)

if (databaseUrl) {
  const db = createDatabase(databaseUrl, { max: 1 })

  results.push(
    await check('Envios pendentes', async () => {
      const [row] = await db.execute<{ due: number; scheduled: number; paused: number }>(
        sql`select
              count(*) filter (where status = 'active' and next_send_at <= now())::int as due,
              count(*) filter (where status = 'active' and next_send_at > now())::int as scheduled,
              count(*) filter (where status = 'paused')::int as paused
            from enrollments`,
      )

      const due = row?.due ?? 0
      const paused = row?.paused ?? 0

      // Fila vencida acumulando significa que o cron parou de chamar o tick.
      if (due > 50) {
        return {
          status: 'warn',
          detail: `${due} vencidos, ${row?.scheduled ?? 0} agendados`,
          fix: 'acúmulo alto — confirme que o cron está chamando /api/cron/tick',
        }
      }

      return {
        status: paused > 0 ? 'warn' : 'ok',
        detail: `${due} vencidos · ${row?.scheduled ?? 0} agendados · ${paused} pausados`,
        ...(paused > 0
          ? { fix: 'enrollments pausados falharam no envio — veja a coluna last_error' }
          : {}),
      }
    }),
  )
}

// ---------------------------------------------------------------------------
// DNS — o fator isolado que mais pesa em entregabilidade
// ---------------------------------------------------------------------------

printSection('Autenticação de domínio')

const sendingDomain = process.env.SENDING_DOMAIN ?? process.env.INBOUND_DOMAIN?.replace(/^[^.]+\./, '')

/** Sempre pelo nameserver autoritativo — cache mente durante a configuração. */
async function txtRecords(name: string): Promise<string[]> {
  return (await lookupTxt(name)).records
}

if (!sendingDomain) {
  record({
    name: 'Domínio remetente',
    status: 'skip',
    detail: 'defina SENDING_DOMAIN para checar SPF/DKIM/DMARC',
  })
} else {
  results.push(
    await check(`SPF (${sendingDomain})`, async () => {
      const spf = (await txtRecords(sendingDomain)).filter((r) => r.startsWith('v=spf1'))
      if (spf.length === 0) {
        return {
          status: 'fail',
          detail: 'nenhum registro',
          fix: 'sem SPF a mensagem é tratada como não autenticada e vai para spam',
        }
      }
      if (spf.length > 1) {
        return {
          status: 'fail',
          detail: `${spf.length} registros SPF`,
          fix: 'mais de um SPF invalida os dois — mantenha apenas um, combinando os includes',
        }
      }
      return { status: 'ok', detail: spf[0]!.slice(0, 90) }
    }),
  )

  results.push(
    await check(`DMARC (${sendingDomain})`, async () => {
      const dmarc = (await txtRecords(`_dmarc.${sendingDomain}`)).filter((r) =>
        r.startsWith('v=DMARC1'),
      )
      if (dmarc.length === 0) {
        return {
          status: 'fail',
          detail: 'nenhum registro',
          fix: 'Gmail e Yahoo exigem DMARC de quem envia em volume. Comece com p=none e evolua para quarantine',
        }
      }
      const policy = /p=(\w+)/.exec(dmarc[0]!)?.[1]
      if (policy === 'none') {
        return {
          status: 'warn',
          detail: 'p=none (só monitoramento)',
          fix: 'ok para começar; evolua para p=quarantine depois de validar os relatórios',
        }
      }
      return { status: 'ok', detail: dmarc[0]!.slice(0, 90) }
    }),
  )

  results.push(
    await check(`DKIM (${sendingDomain})`, async () => {
      // Seletores comuns: Resend usa `resend`, Google usa `google`.
      const selectors = ['resend', 'google', 'default', 'selector1', 'k1']
      for (const selector of selectors) {
        const records = await txtRecords(`${selector}._domainkey.${sendingDomain}`)
        if (records.some((r) => r.includes('p='))) {
          return { status: 'ok', detail: `seletor "${selector}" publicado` }
        }
      }
      return {
        status: 'warn',
        detail: `nenhum seletor conhecido (${selectors.join(', ')})`,
        fix: 'se você usa outro seletor, ignore. Sem DKIM o DMARC não passa em alinhamento',
      }
    }),
  )
}

printSection('Recebimento de respostas')

results.push(
  await check('MX do domínio de inbound', async () => {
    const domain = process.env.INBOUND_DOMAIN
    if (!domain) return { status: 'skip', detail: 'INBOUND_DOMAIN ausente' }

    const { records } = await lookupMx(domain)
    if (records.length === 0) {
      return {
        status: 'fail',
        detail: 'sem MX',
        fix: 'sem isso as respostas nunca chegam e a cadência não para — configure o Resend Inbound para este domínio',
      }
    }

    return {
      status: 'ok',
      detail: records.map((m) => m.exchange).join(', ').slice(0, 90),
    }
  }),
)

// ---------------------------------------------------------------------------

printSection('Resumo')
process.exit(summarize(results))
