import type { Block } from '@disparei/core/blocks'
import type { TouchTemplate } from '@disparei/core/touch-library'
import type { CampaignDraft } from '@/app/campanhas/draft'

/** Passo no estado do builder. `key` é local, para o arrastar-e-soltar. */
export type BuilderStep = {
  key: string
  id?: string
  label: string
  purpose?: string
  waitDays: number
  sameThread: boolean
  enabled: boolean
  /**
   * Travado quando já produziu envio: alterar o texto corromperia a
   * atribuição do teste A/B. Só posição e intervalo permanecem editáveis.
   */
  locked: boolean
  variants: Array<{ subject: string; blocks: Block[] }>
}

export type BuilderState = {
  id?: string
  name: string
  listId: string
  sendingAccountIds: string[]
  sendWindow: CampaignDraft['sendWindow']
  dailyCap: number
  steps: BuilderStep[]
}

export type BuilderOptions = {
  lists: Array<{ id: string; name: string }>
  accounts: Array<{ id: string; fromName: string; fromEmail: string; provider: 'resend' | 'smtp' }>
  library: readonly TouchTemplate[]
}

export function stepFromTemplate(template: TouchTemplate, isFirst: boolean): BuilderStep {
  return {
    key: crypto.randomUUID(),
    label: template.label,
    purpose: template.purpose,
    waitDays: isFirst ? 0 : template.suggestedWaitDays,
    sameThread: !isFirst && template.sameThread,
    enabled: true,
    locked: false,
    variants: [{ subject: isFirst ? template.subject : '', blocks: template.blocks }],
  }
}
