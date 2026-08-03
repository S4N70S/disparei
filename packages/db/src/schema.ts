import { relations, sql } from 'drizzle-orm'
import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const providerEnum = pgEnum('provider', ['resend', 'smtp'])

export const contactStatusEnum = pgEnum('contact_status', [
  'active',
  'unsubscribed',
  'bounced',
  'complained',
])

/**
 * `negative_reply` existe para o operador suprimir manualmente quem respondeu
 * pedindo para não ser contatado sem clicar no descadastro — que é como a
 * maioria das pessoas responde na prática.
 */
export const suppressionReasonEnum = pgEnum('suppression_reason', [
  'unsubscribe',
  'bounce',
  'complaint',
  'manual',
  'negative_reply',
])

export const campaignStatusEnum = pgEnum('campaign_status', [
  'draft',
  'active',
  'paused',
  'finished',
])

export const enrollmentStatusEnum = pgEnum('enrollment_status', [
  'active',
  'replied',
  'bounced',
  'unsubscribed',
  'finished',
  'paused',
])

export const messageStatusEnum = pgEnum('message_status', [
  'queued',
  'sent',
  'delivered',
  'bounced',
  'complained',
  'failed',
])

export const replyClassificationEnum = pgEnum('reply_classification', [
  'unclassified',
  'interested',
  'not_interested',
  'out_of_office',
  'negative',
])

// ---------------------------------------------------------------------------
// Tenancy
// ---------------------------------------------------------------------------

export const workspaces = pgTable('workspaces', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  /** Usados no rodapé exigido pela LGPD. */
  legalName: text('legal_name'),
  cnpj: text('cnpj'),
  privacyPolicyUrl: text('privacy_policy_url'),
  privacyEmail: text('privacy_email'),
  postalAddress: text('postal_address'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    email: text('email').notNull(),
    name: text('name'),
    passwordHash: text('password_hash').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('users_email_uq').on(t.email)],
)

// ---------------------------------------------------------------------------
// Remetentes
// ---------------------------------------------------------------------------

export const sendingAccounts = pgTable(
  'sending_accounts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    provider: providerEnum('provider').notNull(),
    label: text('label').notNull(),
    fromName: text('from_name').notNull(),
    fromEmail: text('from_email').notNull(),
    /** Credenciais cifradas com AES-256-GCM (ver packages/core/src/crypto.ts). */
    credentials: text('credentials').notNull(),
    /**
     * Token curto que compõe o Reply-To (`r.<token>@inbound.<dominio>`).
     * É o que liga uma resposta recebida de volta ao enrollment.
     */
    replyToken: text('reply_token').notNull(),
    dailyCap: integer('daily_cap').notNull().default(50),
    /** Dia da rampa de warmup; NULL = já aquecida, usa o dailyCap cheio. */
    warmupStartedAt: timestamp('warmup_started_at', { withTimezone: true }),
    timezone: text('timezone').notNull().default('America/Sao_Paulo'),
    active: boolean('active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('sending_accounts_ws_idx').on(t.workspaceId),
    uniqueIndex('sending_accounts_reply_token_uq').on(t.replyToken),
  ],
)

// ---------------------------------------------------------------------------
// Contatos e listas
// ---------------------------------------------------------------------------

export const contacts = pgTable(
  'contacts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    email: text('email').notNull(),
    firstName: text('first_name'),
    lastName: text('last_name'),
    company: text('company'),
    title: text('title'),
    /** Colunas extras do CSV, disponíveis como {{variáveis}} no template. */
    custom: jsonb('custom').$type<Record<string, string>>().notNull().default({}),
    status: contactStatusEnum('status').notNull().default('active'),
    source: text('source'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('contacts_ws_email_uq').on(t.workspaceId, t.email)],
)

export const lists = pgTable(
  'lists',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('lists_ws_idx').on(t.workspaceId)],
)

export const listContacts = pgTable(
  'list_contacts',
  {
    listId: uuid('list_id')
      .notNull()
      .references(() => lists.id, { onDelete: 'cascade' }),
    contactId: uuid('contact_id')
      .notNull()
      .references(() => contacts.id, { onDelete: 'cascade' }),
    addedAt: timestamp('added_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('list_contacts_pk').on(t.listId, t.contactId),
    index('list_contacts_contact_idx').on(t.contactId),
  ],
)

/**
 * Lista de bloqueio consultada NO MOMENTO DO ENVIO, não só na importação.
 * Uma linha suprime por `email` OU por `domain` (o outro campo fica NULL).
 */
export const suppressions = pgTable(
  'suppressions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    email: text('email'),
    domain: text('domain'),
    reason: suppressionReasonEnum('reason').notNull(),
    note: text('note'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('suppressions_ws_email_uq')
      .on(t.workspaceId, t.email)
      .where(sql`${t.email} is not null`),
    uniqueIndex('suppressions_ws_domain_uq')
      .on(t.workspaceId, t.domain)
      .where(sql`${t.domain} is not null`),
  ],
)

// ---------------------------------------------------------------------------
// Campanhas
// ---------------------------------------------------------------------------

/** Janela de envio, avaliada no timezone informado. */
export type SendWindow = {
  /** 1 = segunda ... 7 = domingo (ISO-8601). */
  daysOfWeek: number[]
  /** Minutos desde a meia-noite. 540 = 09:00. */
  startMinute: number
  endMinute: number
  timezone: string
}

export const campaigns = pgTable(
  'campaigns',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    listId: uuid('list_id').references(() => lists.id, { onDelete: 'set null' }),
    status: campaignStatusEnum('status').notNull().default('draft'),
    sendWindow: jsonb('send_window').$type<SendWindow>().notNull(),
    sendingAccountIds: uuid('sending_account_ids').array().notNull().default(sql`'{}'`),
    /** Teto da campanha; o teto por caixa continua valendo em paralelo. */
    dailyCap: integer('daily_cap').notNull().default(100),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('campaigns_ws_idx').on(t.workspaceId)],
)

export const campaignSteps = pgTable(
  'campaign_steps',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => campaigns.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
    /** Espera em DIAS ÚTEIS desde o passo anterior. 0 no primeiro passo. */
    waitDays: integer('wait_days').notNull().default(0),
    subjectVariants: text('subject_variants').array().notNull(),
    bodyVariants: text('body_variants').array().notNull(),
    /** Se true, encadeia na thread do passo anterior (In-Reply-To/References). */
    sameThread: boolean('same_thread').notNull().default(true),
  },
  (t) => [uniqueIndex('campaign_steps_pos_uq').on(t.campaignId, t.position)],
)

export const enrollments = pgTable(
  'enrollments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => campaigns.id, { onDelete: 'cascade' }),
    contactId: uuid('contact_id')
      .notNull()
      .references(() => contacts.id, { onDelete: 'cascade' }),
    status: enrollmentStatusEnum('status').notNull().default('active'),
    /** Índice do próximo passo a enviar (0 = ainda não enviou nada). */
    currentStep: integer('current_step').notNull().default(0),
    /**
     * Quando o próximo passo deve sair. É o relógio inteiro do sistema:
     * sem fila externa, o espaçamento entre envios vive aqui.
     */
    nextSendAt: timestamp('next_send_at', { withTimezone: true }),
    /**
     * Tentativas de envio do passo atual. Zera a cada passo concluído.
     * Substitui o retry que antes vinha do BullMQ.
     */
    sendAttempts: integer('send_attempts').notNull().default(0),
    lastError: text('last_error'),
    /** Cadeia de Message-IDs RFC, na ordem de envio — alimenta o `References`. */
    threadMessageIds: text('thread_message_ids').array().notNull().default(sql`'{}'`),
    /** Assunto do primeiro passo; os follow-ups reusam com prefixo `Re:`. */
    threadSubject: text('thread_subject'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('enrollments_campaign_contact_uq').on(t.campaignId, t.contactId),
    // Índice que sustenta a query do scheduler a cada minuto.
    index('enrollments_due_idx').on(t.status, t.nextSendAt),
  ],
)

export const messages = pgTable(
  'messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    enrollmentId: uuid('enrollment_id')
      .notNull()
      .references(() => enrollments.id, { onDelete: 'cascade' }),
    stepId: uuid('step_id').references(() => campaignSteps.id, { onDelete: 'set null' }),
    sendingAccountId: uuid('sending_account_id').references(() => sendingAccounts.id, {
      onDelete: 'set null',
    }),
    stepPosition: integer('step_position').notNull(),
    subjectVariant: integer('subject_variant').notNull().default(0),
    bodyVariant: integer('body_variant').notNull().default(0),
    /** ID interno do provedor (ex.: id do Resend). */
    providerMessageId: text('provider_message_id'),
    /** Message-ID RFC 5322 — é o que encadeia a thread. */
    rfcMessageId: text('rfc_message_id'),
    subject: text('subject').notNull(),
    bodyRendered: text('body_rendered').notNull(),
    status: messageStatusEnum('status').notNull().default('queued'),
    error: text('error'),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),
    openedAt: timestamp('opened_at', { withTimezone: true }),
    clickedAt: timestamp('clicked_at', { withTimezone: true }),
    bouncedAt: timestamp('bounced_at', { withTimezone: true }),
    complainedAt: timestamp('complained_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('messages_enrollment_idx').on(t.enrollmentId),
    index('messages_ws_sent_idx').on(t.workspaceId, t.sentAt),
    uniqueIndex('messages_provider_id_uq')
      .on(t.providerMessageId)
      .where(sql`${t.providerMessageId} is not null`),
    // Contagem do cap diário por caixa.
    index('messages_account_sent_idx').on(t.sendingAccountId, t.sentAt),
  ],
)

export const replies = pgTable(
  'replies',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    enrollmentId: uuid('enrollment_id').references(() => enrollments.id, {
      onDelete: 'cascade',
    }),
    messageId: uuid('message_id').references(() => messages.id, { onDelete: 'set null' }),
    fromEmail: text('from_email').notNull(),
    fromName: text('from_name'),
    subject: text('subject'),
    text: text('text'),
    html: text('html'),
    classification: replyClassificationEnum('classification')
      .notNull()
      .default('unclassified'),
    readAt: timestamp('read_at', { withTimezone: true }),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('replies_ws_received_idx').on(t.workspaceId, t.receivedAt),
    index('replies_enrollment_idx').on(t.enrollmentId),
  ],
)

/** Log cru de todo webhook recebido — auditoria e reprocessamento. */
export const events = pgTable(
  'events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id').references(() => workspaces.id, {
      onDelete: 'cascade',
    }),
    source: text('source').notNull(),
    type: text('type').notNull(),
    payload: jsonb('payload').notNull(),
    /** Chave de idempotência do provedor; ignora reentrega duplicada. */
    dedupeKey: text('dedupe_key'),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('events_dedupe_uq')
      .on(t.dedupeKey)
      .where(sql`${t.dedupeKey} is not null`),
    index('events_type_idx').on(t.type, t.receivedAt),
  ],
)

// ---------------------------------------------------------------------------
// Relations
// ---------------------------------------------------------------------------

export const campaignsRelations = relations(campaigns, ({ many, one }) => ({
  steps: many(campaignSteps),
  enrollments: many(enrollments),
  list: one(lists, { fields: [campaigns.listId], references: [lists.id] }),
}))

export const campaignStepsRelations = relations(campaignSteps, ({ one }) => ({
  campaign: one(campaigns, {
    fields: [campaignSteps.campaignId],
    references: [campaigns.id],
  }),
}))

export const enrollmentsRelations = relations(enrollments, ({ one, many }) => ({
  campaign: one(campaigns, {
    fields: [enrollments.campaignId],
    references: [campaigns.id],
  }),
  contact: one(contacts, {
    fields: [enrollments.contactId],
    references: [contacts.id],
  }),
  messages: many(messages),
  replies: many(replies),
}))

export const messagesRelations = relations(messages, ({ one }) => ({
  enrollment: one(enrollments, {
    fields: [messages.enrollmentId],
    references: [enrollments.id],
  }),
  sendingAccount: one(sendingAccounts, {
    fields: [messages.sendingAccountId],
    references: [sendingAccounts.id],
  }),
}))

export const repliesRelations = relations(replies, ({ one }) => ({
  enrollment: one(enrollments, {
    fields: [replies.enrollmentId],
    references: [enrollments.id],
  }),
}))

export const listContactsRelations = relations(listContacts, ({ one }) => ({
  list: one(lists, { fields: [listContacts.listId], references: [lists.id] }),
  contact: one(contacts, {
    fields: [listContacts.contactId],
    references: [contacts.id],
  }),
}))

// ---------------------------------------------------------------------------
// Tipos inferidos
// ---------------------------------------------------------------------------

export type Workspace = typeof workspaces.$inferSelect
export type SendingAccount = typeof sendingAccounts.$inferSelect
export type Contact = typeof contacts.$inferSelect
export type NewContact = typeof contacts.$inferInsert
export type List = typeof lists.$inferSelect
export type Suppression = typeof suppressions.$inferSelect
export type Campaign = typeof campaigns.$inferSelect
export type CampaignStep = typeof campaignSteps.$inferSelect
export type Enrollment = typeof enrollments.$inferSelect
export type Message = typeof messages.$inferSelect
export type Reply = typeof replies.$inferSelect
