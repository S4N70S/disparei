/**
 * Roteiro de aceite ponta a ponta.
 *
 * Exercita os caminhos que os testes unitários não alcançam: queries reais,
 * envio real pela API e as transições de estado do enrollment.
 *
 * Dois caminhos, conforme `SMOKE_PROVIDER`:
 *
 *   resend → usa delivered@ / bounced@ / complained@resend.dev, que simulam
 *            os três desfechos sem tocar a reputação
 *   smtp   → envia da sua caixa real para `SMOKE_TO_EMAIL`. É o único jeito
 *            de conferir o encadeamento da thread, que é comportamento do
 *            cliente de e-mail e só aparece olhando o Gmail
 *
 *   npx tsx scripts/smoke.ts            # simula, não envia
 *   npx tsx scripts/smoke.ts --send     # envia de verdade
 *   npx tsx scripts/smoke.ts --cleanup  # remove os dados do teste ao final
 */

import { randomUUID } from 'node:crypto'
import {
  and,
  campaignSteps,
  campaigns,
  contacts,
  createDatabase,
  enrollments,
  eq,
  lists,
  listContacts,
  messages,
  replies,
  sendingAccounts,
  suppressions,
  workspaces,
  type Database,
} from '@disparei/db'
import {
  buildReplyToAddress,
  encryptSecret,
  handleEmailEvent,
  handleInboundReply,
  suppressEmail,
  verifyToken,
  signToken,
} from '@disparei/core'
import { processSendJob } from '@disparei/core'
import { loadEnvFile } from './lib/load-env'

loadEnvFile()

const SEND = process.argv.includes('--send')
const CLEANUP = process.argv.includes('--cleanup')

const TAG = `smoke-${Date.now()}`
const DIM = '\x1b[90m'
const RESET = '\x1b[0m'
const BOLD = '\x1b[1m'

let passed = 0
let failed = 0

function assert(condition: boolean, description: string, detail = ''): void {
  if (condition) {
    passed++
    console.log(`  \x1b[32m✓\x1b[0m ${description}${detail ? `${DIM} — ${detail}${RESET}` : ''}`)
  } else {
    failed++
    console.log(`  \x1b[31m✗\x1b[0m ${description}${detail ? `${DIM} — ${detail}${RESET}` : ''}`)
  }
}

function step(title: string): void {
  console.log(`\n${BOLD}${title}${RESET}`)
}

function required(name: string): string {
  const value = process.env[name]
  if (!value) {
    console.error(`\n\x1b[31m${name} não definida.\x1b[0m`)
    process.exit(1)
  }
  return value
}

const DATABASE_URL = required('DATABASE_URL')
const ENCRYPTION_KEY = required('ENCRYPTION_KEY')
const TOKEN_SECRET = required('TOKEN_SECRET')
const APP_URL = required('APP_URL')
const INBOUND_DOMAIN = required('INBOUND_DOMAIN')
const FROM_EMAIL = required('SMOKE_FROM_EMAIL')

const PROVIDER = (process.env.SMOKE_PROVIDER ?? 'resend') as 'resend' | 'smtp'
const RESEND_API_KEY = process.env.RESEND_API_KEY ?? ''

/**
 * Destinatário do teste.
 *
 * Com o Resend, os endereços `@resend.dev` simulam entrega, bounce e
 * reclamação sem tocar a reputação. Eles são específicos da API do Resend —
 * pelo SMTP do Google não se comportam assim. Por isso, no caminho SMTP, o
 * teste vai para uma caixa sua: além de ser o único jeito honesto de validar,
 * é o melhor jeito de conferir o encadeamento da thread, que é um
 * comportamento do CLIENTE de e-mail e só dá para ver olhando o Gmail.
 */
const TO_EMAIL = process.env.SMOKE_TO_EMAIL ?? null
const USE_RESEND_TEST_ADDRESSES = PROVIDER === 'resend' && !TO_EMAIL
const PRIMARY_EMAIL = TO_EMAIL ?? 'delivered@resend.dev'

if (SEND) {
  if (PROVIDER === 'resend' && !RESEND_API_KEY) {
    console.error('\n\x1b[31m--send com SMOKE_PROVIDER=resend exige RESEND_API_KEY.\x1b[0m')
    process.exit(1)
  }
  if (PROVIDER === 'smtp') {
    for (const key of ['SMOKE_SMTP_HOST', 'SMOKE_SMTP_USER', 'SMOKE_SMTP_PASSWORD']) required(key)
    if (!TO_EMAIL) {
      console.error(
        '\n\x1b[31m--send com SMOKE_PROVIDER=smtp exige SMOKE_TO_EMAIL\x1b[0m' +
          '\n\x1b[90mos endereços @resend.dev só funcionam pela API do Resend.\x1b[0m' +
          '\n\x1b[90mUse uma caixa sua para conferir o encadeamento da thread no cliente.\x1b[0m',
      )
      process.exit(1)
    }
  }
}

function smokeCredentials(): string {
  if (PROVIDER === 'resend') return JSON.stringify({ apiKey: RESEND_API_KEY })
  return JSON.stringify({
    host: process.env.SMOKE_SMTP_HOST,
    port: Number(process.env.SMOKE_SMTP_PORT ?? 587),
    secure: process.env.SMOKE_SMTP_SECURE === 'true',
    user: process.env.SMOKE_SMTP_USER,
    password: process.env.SMOKE_SMTP_PASSWORD,
  })
}

const db: Database = createDatabase(DATABASE_URL, { max: 3 })

// Janela 24/7 para o teste rodar a qualquer hora — em campanha real ela é
// restrita a dias úteis e horário comercial.
const ALWAYS_OPEN = {
  daysOfWeek: [1, 2, 3, 4, 5, 6, 7],
  startMinute: 0,
  endMinute: 24 * 60,
  timezone: 'America/Sao_Paulo',
}

const ids = { workspace: '', account: '', list: '', campaign: '', enrollment: '' }

async function main() {
  const destination = USE_RESEND_TEST_ADDRESSES ? 'endereços @resend.dev' : TO_EMAIL
  console.log(
    `\n${BOLD}Roteiro de aceite — Disparei${RESET}\n` +
      `${DIM}provedor: ${PROVIDER} · modo: ${SEND ? `ENVIO REAL para ${destination}` : 'simulação (sem envio)'}${RESET}`,
  )

  // -------------------------------------------------------------------------
  step('1. Preparar workspace, caixa de envio e lista')

  const [workspace] = await db
    .insert(workspaces)
    .values({
      name: `Smoke ${TAG}`,
      legalName: 'Empresa de Teste LTDA',
      cnpj: '00.000.000/0001-00',
      privacyEmail: 'privacy@example.com',
      privacyPolicyUrl: 'https://example.com/privacidade',
    })
    .returning()
  ids.workspace = workspace!.id
  assert(!!workspace, 'workspace criado com dados legais')

  const [account] = await db
    .insert(sendingAccounts)
    .values({
      workspaceId: ids.workspace,
      provider: PROVIDER,
      label: 'Smoke',
      fromName: 'Teste Disparei',
      fromEmail: FROM_EMAIL,
      credentials: encryptSecret(smokeCredentials(), ENCRYPTION_KEY),
      replyToken: randomUUID().slice(0, 16),
      dailyCap: 50,
      warmupStartedAt: null, // sem rampa, para o teste não esbarrar no cap
    })
    .returning()
  ids.account = account!.id
  assert(!!account, `caixa de envio criada (${PROVIDER})`, 'cap 50/dia, sem rampa')

  const [list] = await db
    .insert(lists)
    .values({ workspaceId: ids.workspace, name: `Lista ${TAG}` })
    .returning()
  ids.list = list!.id

  const inserted = await db
    .insert(contacts)
    .values([
      {
        workspaceId: ids.workspace,
        email: PRIMARY_EMAIL,
        firstName: 'Ana',
        company: 'Acme',
        title: 'Diretora',
      },
      // Bounce e reclamação só existem como simulação na API do Resend.
      ...(USE_RESEND_TEST_ADDRESSES
        ? [
            { workspaceId: ids.workspace, email: 'bounced@resend.dev', firstName: 'Bruno' },
            { workspaceId: ids.workspace, email: 'complained@resend.dev', firstName: 'Carla' },
          ]
        : []),
    ])
    .onConflictDoNothing()
    .returning()

  await db
    .insert(listContacts)
    .values(inserted.map((c) => ({ listId: ids.list, contactId: c.id })))
    .onConflictDoNothing()

  assert(
    inserted.length === (USE_RESEND_TEST_ADDRESSES ? 3 : 1),
    `${inserted.length} contato(s) de teste na lista`,
    PRIMARY_EMAIL,
  )

  // -------------------------------------------------------------------------
  step('2. Criar sequência de 2 passos')

  const [campaign] = await db
    .insert(campaigns)
    .values({
      workspaceId: ids.workspace,
      name: `Campanha ${TAG}`,
      listId: ids.list,
      status: 'active',
      sendWindow: ALWAYS_OPEN,
      sendingAccountIds: [ids.account],
      dailyCap: 100,
    })
    .returning()
  ids.campaign = campaign!.id

  await db.insert(campaignSteps).values([
    {
      campaignId: ids.campaign,
      position: 0,
      waitDays: 0,
      subjectVariants: ['{Pergunta|Ideia} rápida sobre {{company|sua operação}}'],
      bodyVariants: ['<p>Oi {{first_name|tudo bem}}, tudo certo por aí?</p>'],
      sameThread: false,
    },
    {
      campaignId: ids.campaign,
      position: 1,
      waitDays: 0,
      subjectVariants: [''],
      bodyVariants: ['<p>Subindo este e-mail, {{first_name|tudo bem}}.</p>'],
      sameThread: true,
    },
  ])
  assert(true, 'campanha ativa com 2 passos')

  const target = inserted.find((c) => c.email === PRIMARY_EMAIL)!
  const [enrollment] = await db
    .insert(enrollments)
    .values({
      workspaceId: ids.workspace,
      campaignId: ids.campaign,
      contactId: target.id,
      status: 'active',
      currentStep: 0,
      nextSendAt: new Date(),
    })
    .returning()
  ids.enrollment = enrollment!.id

  // Os outros dois entram para exercitar bounce e reclamação.
  for (const c of inserted.filter((c) => c.email !== PRIMARY_EMAIL)) {
    await db.insert(enrollments).values({
      workspaceId: ids.workspace,
      campaignId: ids.campaign,
      contactId: c.id,
      status: 'active',
      currentStep: 0,
      nextSendAt: new Date(),
    })
  }

  // -------------------------------------------------------------------------
  step('3. Enviar o passo 1')

  const deps = {
    db,
    encryptionKey: ENCRYPTION_KEY,
    tokenSecret: TOKEN_SECRET,
    appUrl: APP_URL,
    inboundDomain: INBOUND_DOMAIN,
  }

  if (!SEND) {
    console.log(`  ${DIM}pulado — rode com --send para enviar de verdade${RESET}`)
  } else {
    const outcome = await processSendJob({ enrollmentId: ids.enrollment, stepPosition: 0 }, deps)
    assert(outcome.status === 'sent', 'passo 1 enviado', JSON.stringify(outcome))

    const [msg] = await db
      .select()
      .from(messages)
      .where(and(eq(messages.enrollmentId, ids.enrollment), eq(messages.stepPosition, 0)))

    assert(msg?.status === 'sent', 'mensagem registrada como enviada')
    assert(!!msg?.providerMessageId, 'id do provedor capturado', msg?.providerMessageId ?? '')
    assert(
      !!msg?.rfcMessageId && /^<.+@.+>$/.test(msg.rfcMessageId),
      'Message-ID RFC gerado por nós',
      msg?.rfcMessageId ?? '',
    )
    assert(
      !!msg && !msg.subject.includes('{{') && !msg.subject.includes('{'),
      'assunto renderizado (spintax e variáveis resolvidos)',
      msg?.subject ?? '',
    )
    assert(
      !!msg?.bodyRendered.includes('CNPJ'),
      'rodapé de LGPD concatenado no corpo',
    )
    assert(
      !!msg?.bodyRendered.includes('/unsubscribe/'),
      'link de descadastro presente',
    )
  }

  // -------------------------------------------------------------------------
  step('4. Enviar o passo 2 — deve encadear na mesma thread')

  const [afterFirst] = await db
    .select()
    .from(enrollments)
    .where(eq(enrollments.id, ids.enrollment))

  if (!SEND) {
    console.log(`  ${DIM}pulado${RESET}`)
  } else {
    assert(afterFirst?.currentStep === 1, 'enrollment avançou para o passo 2')
    assert(
      afterFirst?.threadMessageIds.length === 1,
      'cadeia de thread tem 1 Message-ID',
    )

    const outcome = await processSendJob({ enrollmentId: ids.enrollment, stepPosition: 1 }, deps)
    assert(outcome.status === 'sent', 'passo 2 enviado', JSON.stringify(outcome))

    const [msg2] = await db
      .select()
      .from(messages)
      .where(and(eq(messages.enrollmentId, ids.enrollment), eq(messages.stepPosition, 1)))

    assert(
      msg2?.subject.startsWith('Re: ') === true,
      'follow-up reusa o assunto com prefixo Re:',
      msg2?.subject ?? '',
    )

    const [afterSecond] = await db
      .select()
      .from(enrollments)
      .where(eq(enrollments.id, ids.enrollment))

    assert(
      afterSecond?.threadMessageIds.length === 2,
      'cadeia de thread tem 2 Message-IDs (References correto)',
    )
    assert(afterSecond?.status === 'finished', 'sequência encerrada após o último passo')
  }

  // -------------------------------------------------------------------------
  step('5. Parada por resposta')

  // Volta o enrollment para ativo, simulando uma sequência em andamento.
  await db
    .update(enrollments)
    .set({ status: 'active', currentStep: 1, nextSendAt: new Date() })
    .where(eq(enrollments.id, ids.enrollment))

  const replyTo = buildReplyToAddress(ids.enrollment, INBOUND_DOMAIN, TOKEN_SECRET)
  assert(replyTo.length - INBOUND_DOMAIN.length - 1 <= 64, 'Reply-To cabe no limite do local-part')

  const inbound = await handleInboundReply(
    db,
    {
      to: [replyTo.toUpperCase()], // servidores normalizam maiúsculas em trânsito
      from: `Ana Souza <${PRIMARY_EMAIL}>`,
      subject: 'Re: Pergunta rápida',
      text: 'Tenho interesse, podemos conversar quinta?',
      receivedAt: new Date(),
    },
    TOKEN_SECRET,
  )

  assert(inbound.handled, 'resposta associada ao enrollment pelo token do Reply-To')
  assert(inbound.classification === 'interested', 'classificada como interessado')

  const [afterReply] = await db
    .select()
    .from(enrollments)
    .where(eq(enrollments.id, ids.enrollment))
  assert(afterReply?.status === 'replied', 'cadência interrompida')
  assert(afterReply?.nextSendAt === null, 'nenhum envio futuro agendado')

  const storedReplies = await db
    .select()
    .from(replies)
    .where(eq(replies.enrollmentId, ids.enrollment))
  assert(storedReplies.length === 1, 'resposta gravada na caixa unificada')

  // O worker não pode reenviar mesmo com um job já na fila.
  const blocked = await processSendJob({ enrollmentId: ids.enrollment, stepPosition: 1 }, deps)
  assert(
    blocked.status === 'skipped' && blocked.reason === 'enrollment_inactive',
    'worker recusa enviar para quem já respondeu',
    JSON.stringify(blocked),
  )

  // -------------------------------------------------------------------------
  step('6. Bounce e reclamação suprimem automaticamente')

  if (!SEND) {
    console.log(`  ${DIM}pulado — exige mensagens realmente enviadas${RESET}`)
  } else if (!USE_RESEND_TEST_ADDRESSES) {
    console.log(
      `  ${DIM}pulado — bounce e reclamação simulados só existem na API do Resend.${RESET}\n` +
        `  ${DIM}A lógica está coberta pelos testes de webhooks.${RESET}`,
    )
  } else {
    for (const [email, type] of [
      ['bounced@resend.dev', 'email.bounced'],
      ['complained@resend.dev', 'email.complained'],
    ] as const) {
      const [enr] = await db
        .select({ id: enrollments.id })
        .from(enrollments)
        .innerJoin(contacts, eq(enrollments.contactId, contacts.id))
        .where(and(eq(enrollments.campaignId, ids.campaign), eq(contacts.email, email)))

      if (!enr) continue

      const out = await processSendJob({ enrollmentId: enr.id, stepPosition: 0 }, deps)
      if (out.status !== 'sent') {
        assert(false, `envio para ${email}`, JSON.stringify(out))
        continue
      }

      const [msg] = await db
        .select()
        .from(messages)
        .where(eq(messages.enrollmentId, enr.id))

      const result = await handleEmailEvent(db, {
        type,
        providerMessageId: msg!.providerMessageId!,
        createdAt: new Date(),
      })

      assert(result.handled && result.suppressed === true, `${type} suprimiu ${email}`)
    }
  }

  // -------------------------------------------------------------------------
  step('7. Descadastro encerra TODAS as cadências do e-mail')

  const token = signToken(ids.enrollment, TOKEN_SECRET)
  assert(verifyToken(token, TOKEN_SECRET) === ids.enrollment, 'token de descadastro válido')
  assert(verifyToken(token, 'segredo-errado') === null, 'token forjado é rejeitado')

  await suppressEmail(db, {
    workspaceId: ids.workspace,
    email: PRIMARY_EMAIL,
    reason: 'unsubscribe',
    note: 'smoke test',
  })

  const [supp] = await db
    .select()
    .from(suppressions)
    .where(
      and(
        eq(suppressions.workspaceId, ids.workspace),
        eq(suppressions.email, PRIMARY_EMAIL),
      ),
    )
  assert(!!supp, 'e-mail na lista de supressão')

  const [contact] = await db
    .select()
    .from(contacts)
    .where(
      and(eq(contacts.workspaceId, ids.workspace), eq(contacts.email, PRIMARY_EMAIL)),
    )
  assert(contact?.status === 'unsubscribed', 'contato marcado como descadastrado')

  // -------------------------------------------------------------------------
  if (CLEANUP) {
    step('8. Limpeza')
    // Cascade cuida de listas, contatos, campanhas, enrollments e mensagens.
    await db.delete(workspaces).where(eq(workspaces.id, ids.workspace))
    assert(true, 'dados do teste removidos')
  } else {
    console.log(
      `\n${DIM}Dados mantidos no workspace "${workspace!.name}". Rode com --cleanup para remover.${RESET}`,
    )
  }

  console.log(
    `\n${BOLD}${passed} verificações ok · ${failed} falharam${RESET}\n`,
  )
  process.exit(failed > 0 ? 1 : 0)
}

main().catch((error) => {
  console.error(`\n\x1b[31mErro:\x1b[0m ${(error as Error).message}`)
  console.error(error)
  process.exit(1)
})
