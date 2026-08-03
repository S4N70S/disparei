import type { ValidationReason } from '@disparei/core'

/**
 * Rótulos do relatório de importação.
 *
 * Vivem fora de `actions.ts` porque um módulo `'use server'` só pode exportar
 * funções async — helpers síncronos quebram o build.
 */
const REASON_LABEL: Record<ValidationReason, string> = {
  invalid_syntax: 'sintaxe inválida',
  role_based: 'caixa coletiva (contato@, vendas@…)',
  disposable: 'domínio descartável',
  no_mx: 'domínio sem servidor de e-mail',
  duplicate: 'duplicado no arquivo',
  suppressed: 'na lista de supressão',
}

export function reasonLabel(reason: ValidationReason): string {
  return REASON_LABEL[reason] ?? reason
}

export type ImportReport = {
  totalRows: number
  imported: number
  discarded: Array<{ email: string; reason: ValidationReason }>
  warnings: Array<{ email: string; warning: string }>
  listName: string
}
