# Deploy

Tudo em plano gratuito: **Vercel** (app) + **Supabase** (banco e cron). Não há segundo serviço para manter.

## Como os envios acontecem

Não existe fila nem processo contínuo. Cada contato carrega o próprio horário em `enrollments.next_send_at`, gravado com intervalos aleatórios no momento da matrícula. Um cron chama `/api/cron/tick` a cada poucos minutos e o endpoint envia quem venceu.

```
pg_cron (Supabase)  ──a cada 2 min──▶  /api/cron/tick  ──▶  envia até 3
                                              │
                                       Postgres: next_send_at
```

O ritmo vive no banco, não na infraestrutura. Isso é o que permite rodar em serverless sem perder o espaçamento entre envios — que é justamente o que evita o padrão de rajada que os filtros anti-spam reconhecem.

**Capacidade:** 3 envios a cada 2 minutos ≈ 2.000/dia. Uma operação saudável usa 50 a 150.

---

## 1. Vercel

O [vercel.json](../vercel.json) já configura build do workspace web, saída em `apps/web/.next` e região `gru1` (São Paulo).

```bash
npx vercel
```

**Mantenha o Root Directory na raiz do repositório** — o `vercel.json` aponta para o app, e os packages do monorepo precisam estar acessíveis no build.

### Variáveis de ambiente

Settings → Environment Variables, para **Production** e **Preview**:

| Variável | Valor |
|---|---|
| `DATABASE_URL` | Supabase, Transaction pooler (6543) |
| `ENCRYPTION_KEY` | o mesmo do `.env` local |
| `TOKEN_SECRET` | o mesmo do `.env` local |
| `CRON_SECRET` | o mesmo do `.env` local |
| `APP_PASSWORD` | senha do painel |
| `APP_URL` | `https://app.budsmeet.com.br` |
| `INBOUND_DOMAIN` | `inbound.budsmeet.com.br` |
| `RESEND_API_KEY` | Resend → API Keys |
| `RESEND_WEBHOOK_SECRET` | Resend → webhook de **eventos** → signing secret |
| `RESEND_INBOUND_WEBHOOK_SECRET` | Resend → webhook de **inbound** → signing secret |
| `MAX_SENDS_PER_TICK` | `3` |

> `ENCRYPTION_KEY` e `TOKEN_SECRET` precisam ser **idênticos** aos do `.env` local. São eles que cifram as credenciais SMTP e assinam os tokens de `Reply-To`. Se mudarem, as caixas já cadastradas param de decifrar e toda resposta recebida vira token inválido — silenciosamente.

### Por que existe uma `optionalDependencies` estranha em `apps/web/package.json`

`@tailwindcss/oxide-linux-x64-gnu` está declarada explicitamente por causa do
[bug #4828 do npm](https://github.com/npm/cli/issues/4828): o lockfile gerado
no macOS registra só o binário nativo do macOS. Na Vercel, que builda em Linux
x64, o build quebrava com `Cannot find native binding` ao processar o CSS.

Declarar como opcional resolve sem efeito colateral — o npm ignora o pacote em
plataformas que não batem com `os`/`cpu`, então no macOS nada muda.

**Se um dia atualizar o Tailwind**, atualize essa versão junto; ela precisa
acompanhar a do `@tailwindcss/oxide`.

### Domínio

Settings → Domains → `app.budsmeet.com.br`. Na Hostinger:

```
CNAME   app   cname.vercel-dns.com
```

Não encoste no MX da raiz — é do Google Workspace, em zona separada.

---

## 2. Cron no Supabase

O Cron da Vercel no plano Hobby roda **uma vez por dia**, o que não serve. Usamos o `pg_cron` do Supabase, que é gratuito e aceita frequência por minuto.

No **SQL Editor** do Supabase:

```sql
create extension if not exists pg_cron;
create extension if not exists pg_net;
```

> Rode este bloco **antes** do `cron.schedule`. Sem ele o Postgres responde
> `schema "cron" does not exist` — a extensão vem desabilitada por padrão e é
> ela que cria o schema.

```sql
select cron.schedule(
  'disparei-tick',
  '*/2 * * * *',
  $$
  select net.http_post(
    url     := 'https://app.budsmeet.com.br/api/cron/tick',
    headers := '{"x-cron-secret": "COLE_AQUI_O_CRON_SECRET"}'::jsonb
  );
  $$
);
```

Conferir agendamento e execuções:

```sql
select * from cron.job;
select * from cron.job_run_details order by start_time desc limit 20;
```

Para remover:

```sql
select cron.unschedule('disparei-tick');
```

> O `pg_net` dispara a requisição de forma assíncrona e não espera resposta. Se precisar depurar, olhe os logs de função na Vercel — cada tick loga uma linha JSON com `sent`, `retried` e `skipped`.

---

## 3. Webhooks no Resend

Só depois do app publicado:

| Endpoint | Eventos |
|---|---|
| `https://app.budsmeet.com.br/api/webhooks/resend` | `email.delivered`, `email.bounced`, `email.complained`, `email.opened`, `email.clicked` |
| `https://app.budsmeet.com.br/api/webhooks/inbound` | `email.received` |

O Resend gera um signing secret **por webhook**. Copie cada um para a sua
variável — `RESEND_WEBHOOK_SECRET` para o de eventos e
`RESEND_INBOUND_WEBHOOK_SECRET` para o de inbound — e faça redeploy.

Usar o mesmo valor nos dois faz um dos endpoints rejeitar toda entrega como
assinatura inválida, e a falha é silenciosa: o Resend registra erro de
entrega e a cadência simplesmente nunca para.

---

## 4. Verificação pós-deploy

```bash
curl -s -o /dev/null -w "%{http_code}\n" https://app.budsmeet.com.br/login
```

`200` esperado.

```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST https://app.budsmeet.com.br/api/webhooks/resend
```

`401` esperado — a assinatura Svix rejeitando POST sem cabeçalho. Se vier `200`, o `RESEND_WEBHOOK_SECRET` não chegou ao ambiente e o endpoint que suprime contatos está aberto.

```bash
curl -s -o /dev/null -w "%{http_code}\n" https://app.budsmeet.com.br/api/cron/tick
```

`401` esperado. Com o segredo, deve responder `200` e um resumo:

```bash
curl -s -H "x-cron-secret: SEU_CRON_SECRET" https://app.budsmeet.com.br/api/cron/tick
```

Depois, no painel: `/setup` → `/configuracoes` (dados legais + caixa SMTP do Google) → `/contatos` → `/campanhas`.

---

## Quando a fila voltaria a fazer sentido

O desenho atual cobre com folga o volume de uma operação de prospecção. Se um dia você precisar de milhares de envios por hora, ou de vários workspaces disputando as mesmas caixas, aí compensa reintroduzir fila com worker dedicado. Até lá, seria complexidade sem contrapartida.
