# Disparei

Plataforma de outbound para prospecção ativa por e-mail — sequências multi-toque, parada automática por resposta e controle de reputação.

O problema que ela resolve não é "enviar e-mail em massa". É **manter cadência de follow-up sem queimar domínio, e não perder a resposta quando ela chega.**

---

## Antes de começar: a restrição que define a arquitetura

A [Acceptable Use Policy do Resend](https://resend.com/legal/acceptable-use) proíbe o caso de uso de prospecção fria, textualmente: *"You are prohibited from sending unsolicited messages of any kind, including cold outreach, purchased lists, or scraped contact data."* Exige ainda complaint rate < 0,08% e bounce < 4%, com suspensão sem aviso.

Não é só política. É a razão técnica de Instantly, Smartlead e Lemlist **não** enviarem por ESP transacional: cold email precisa sair de uma caixa real e parecer 1:1. IP compartilhado de ESP transacional entrega prospecção fria em spam.

Por isso a camada de envio é abstrata (`EmailProvider`):

| Adapter | Quando usar |
|---|---|
| `ResendProvider` | Nutrição opt-in, follow-up de inbound, testes |
| `SmtpProvider` | **Prospecção fria** — sua caixa Google Workspace / Microsoft 365 |

Trocar de um para o outro é cadastro de caixa em Configurações, não mudança de código.

---

## Stack

Next.js 15 (App Router) · TypeScript · Postgres + Drizzle · Tailwind v4

```
apps/web        → UI, server actions, webhooks, descadastro, /api/cron/tick
packages/db     → schema Drizzle + migrations
packages/email  → EmailProvider, ResendProvider, SmtpProvider, Message-ID
packages/core   → renderer, agenda, warmup, validação, LGPD, envio, métricas
```

Sem fila e sem worker. Cada contato carrega o próprio horário em `next_send_at`, gravado com intervalos aleatórios na matrícula; um cron chama `/api/cron/tick` a cada 2 minutos e ele envia quem venceu. O ritmo vive no banco, não na infraestrutura — é o que permite rodar em serverless sem perder o espaçamento que evita o padrão de rajada.

## Como rodar

```bash
npm install
```

```bash
cp .env.example .env
```

Preencha `.env` (os comandos para gerar os segredos estão nos comentários). Só precisa de um Postgres — Supabase ou Neon funcionam sem ajuste.

```bash
npm run db:migrate
```

```bash
npm run dev
```

Acesse `http://localhost:3000`, entre com `APP_PASSWORD` e siga: **Configurações** (dados legais + caixa de envio) → **Contatos** (importar CSV) → **Campanhas** (criar sequência → matricular → ativar).

Em desenvolvimento, dispare o tick na mão em vez de configurar cron:

```bash
curl -H "x-cron-secret: $CRON_SECRET" http://localhost:3000/api/cron/tick
```

Para publicar, veja [docs/deploy.md](docs/deploy.md).

## Verificação

Lógica pura (não precisa de banco nem Redis):

```bash
npm test
```

```bash
npm run typecheck
```

### Preflight

Confere ambiente, banco, migrations, Redis, caixas de envio e — o mais importante — **SPF, DKIM, DMARC e o MX do domínio de inbound**:

```bash
npm run doctor
```

Defina `SENDING_DOMAIN` no `.env` para habilitar os checks de DNS. Sem autenticação de domínio, a mensagem cai em spam com a sequência perfeita: é o maior fator isolado de entregabilidade.

### Roteiro de aceite ponta a ponta

Usa os endereços de teste do Resend, que **não contam para reputação**:

| Endereço | Exercita |
|---|---|
| `delivered@resend.dev` | caminho feliz + webhook `email.delivered` |
| `bounced@resend.dev` | supressão automática por bounce |
| `complained@resend.dev` | supressão por reclamação |

```bash
npm run smoke
```

Sem flags ele **simula**, sem enviar nada. Para valer:

```bash
npm run smoke -- --send --cleanup
```

O que ele verifica: renderização com spintax e variáveis resolvidas, `Message-ID` RFC gerado por nós, rodapé de LGPD e link de descadastro no corpo, follow-up com prefixo `Re:` e cadeia de `References` correta, parada por resposta via token do `Reply-To` (inclusive com o endereço normalizado em maiúsculas), recusa de reenvio a quem já respondeu, supressão automática por bounce e reclamação, e descadastro encerrando todas as cadências do e-mail.

`SMOKE_PROVIDER` escolhe o caminho:

- **`resend`** — usa os endereços `@resend.dev`, que simulam os três desfechos. Requer `RESEND_API_KEY`.
- **`smtp`** — envia da sua caixa real para `SMOKE_TO_EMAIL`. Requer `SMOKE_SMTP_*`. É o único jeito de conferir o **encadeamento da thread**, que é comportamento do cliente de e-mail: você precisa abrir o Gmail e ver os dois e-mails agrupados na mesma conversa.

## Decisões que não são óbvias

**Geramos nosso próprio `Message-ID`.** O encadeamento do follow-up depende do `In-Reply-To` apontar para o ID real do passo anterior. Depender do valor devolvido pela API significaria quebrar a thread em silêncio se o contrato mudasse — o e-mail sairia normal, só deixaria de ser conversa.

**O espaçamento entre envios é gravado no banco, não na fila.** Cada contato recebe um `next_send_at` afastado do anterior por um intervalo sorteado. Rajada com intervalo constante é o padrão mais fácil de um filtro anti-spam reconhecer — e sem fila externa, o único lugar onde esse ritmo pode viver é o `next_send_at`.

**Supressão é reconferida no momento do envio.** Entre agendar e enviar passam horas; nesse intervalo o contato pode ter descadastrado por outra campanha.

**A parada por resposta usa token assinado no `Reply-To`,** não heurística de assunto. Casar por texto falha justamente nos casos reais: encaminhamento, resposta de outro endereço, assunto traduzido pelo cliente.

**Bounce é calculado sobre enviados, não sobre entregues.** Usar entregues no denominador exclui os bounces da conta e faz a taxa parecer menor do que a que o provedor usa para suspender.

**Abertura é métrica secundária.** O Apple MPP pré-carrega imagens e infla o número. A decisão se toma por taxa de resposta.

**O rodapé de LGPD é concatenado fora do editor de template** — o operador não consegue removê-lo. Ver [docs/lia.md](docs/lia.md).

## Fora do v1, deliberadamente

Multicanal (LinkedIn, telefone), copy por IA, enriquecimento e scraping de leads, billing e planos, warmup network entre usuários, domínio de tracking próprio.

O schema já nasce multi-tenant (`workspace_id` em tudo), então virar produto depois não exige reescrever query nenhuma.
