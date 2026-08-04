import { z } from 'zod'

/**
 * Contrato entre o builder (cliente) e a server action.
 *
 * Vive num módulo próprio, e não em `actions.ts`, porque um arquivo
 * `'use server'` só pode exportar funções async — schema e tipo derivado
 * quebrariam o build.
 */

export const blockSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('text'), html: z.string() }),
  z.object({ type: z.literal('heading'), text: z.string(), level: z.union([z.literal(2), z.literal(3)]) }),
  z.object({ type: z.literal('button'), label: z.string(), url: z.string() }),
  z.object({ type: z.literal('image'), url: z.string(), alt: z.string() }),
  z.object({ type: z.literal('divider') }),
  z.object({ type: z.literal('spacer'), size: z.enum(['sm', 'md', 'lg']) }),
  z.object({ type: z.literal('signature'), html: z.string() }),
])

export const variantSchema = z.object({
  subject: z.string(),
  blocks: z.array(blockSchema),
})

export const stepSchema = z.object({
  /** Presente quando o passo já existe no banco. */
  id: z.string().uuid().optional(),
  label: z.string().min(1),
  purpose: z.string().optional(),
  waitDays: z.number().int().min(0).max(60),
  sameThread: z.boolean(),
  enabled: z.boolean(),
  variants: z.array(variantSchema).min(1).max(4),
})

export const sendWindowSchema = z.object({
  daysOfWeek: z.array(z.number().int().min(1).max(7)).min(1),
  startMinute: z.number().int().min(0).max(1440),
  endMinute: z.number().int().min(1).max(1440),
  timezone: z.string().min(1),
})

export const campaignDraftSchema = z.object({
  /** Presente ao editar. */
  id: z.string().uuid().optional(),
  name: z.string().min(1, 'Informe o nome da campanha'),
  listId: z.string().uuid('Selecione uma lista'),
  sendingAccountIds: z.array(z.string().uuid()).min(1, 'Selecione ao menos uma caixa de envio'),
  sendWindow: sendWindowSchema,
  dailyCap: z.number().int().min(1).max(10_000),
  steps: z.array(stepSchema).min(1, 'A sequência precisa de ao menos um toque'),
})

export type CampaignDraft = z.infer<typeof campaignDraftSchema>
export type StepDraft = z.infer<typeof stepSchema>
export type VariantDraft = z.infer<typeof variantSchema>

export type SaveResult =
  | { ok: true; campaignId: string }
  | { ok: false; error: string }
