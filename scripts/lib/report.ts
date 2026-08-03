export type Status = 'ok' | 'warn' | 'fail' | 'skip'

export type CheckResult = {
  name: string
  status: Status
  detail: string
  /** O que fazer para resolver — só aparece quando não está ok. */
  fix?: string
}

const ICON: Record<Status, string> = {
  ok: '[32m✓[0m',
  warn: '[33m![0m',
  fail: '[31m✗[0m',
  skip: '[90m–[0m',
}

const DIM = '[90m'
const RESET = '[0m'
const BOLD = '[1m'

export function printSection(title: string): void {
  console.log(`\n${BOLD}${title}${RESET}`)
}

export function printResult(result: CheckResult): void {
  console.log(`  ${ICON[result.status]} ${result.name}${DIM} — ${result.detail}${RESET}`)
  if (result.fix && result.status !== 'ok' && result.status !== 'skip') {
    console.log(`      ${DIM}→ ${result.fix}${RESET}`)
  }
}

export function summarize(results: CheckResult[]): number {
  const failed = results.filter((r) => r.status === 'fail').length
  const warned = results.filter((r) => r.status === 'warn').length
  const passed = results.filter((r) => r.status === 'ok').length

  console.log(
    `\n${BOLD}${passed} ok · ${warned} atenção · ${failed} bloqueando${RESET}\n`,
  )

  return failed > 0 ? 1 : 0
}

export async function check(
  name: string,
  fn: () => Promise<Omit<CheckResult, 'name'>>,
): Promise<CheckResult> {
  try {
    const result = { name, ...(await fn()) }
    printResult(result)
    return result
  } catch (error) {
    const result: CheckResult = {
      name,
      status: 'fail',
      detail: (error as Error).message.slice(0, 200),
    }
    printResult(result)
    return result
  }
}
