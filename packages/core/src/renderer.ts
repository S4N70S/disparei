import { stablePick } from './hash'

export type RenderContext = Record<string, string | null | undefined>

export type RenderOptions = {
  /**
   * Semente da escolha determinística — na prática o `contact.id`.
   * Mesmo contato + mesmo template = sempre o mesmo resultado.
   */
  seed: string
  /** Escapa os valores das variáveis para HTML. Use `true` no corpo HTML. */
  escapeHtml?: boolean
  /** Registra variáveis referenciadas mas ausentes e sem fallback. */
  onMissing?: (key: string) => void
}

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}

function escapeHtmlValue(value: string): string {
  return value.replace(/[&<>"']/g, (c) => HTML_ESCAPES[c] ?? c)
}

/**
 * Resolve spintax `{a|b|c}`, com aninhamento.
 *
 * O scanner ignora `{{...}}` (variáveis) de propósito: a substituição de
 * variáveis acontece DEPOIS, e os valores vindos do CSV nunca são
 * reinterpretados como template. Sem isso, um contato com `{` no nome do cargo
 * quebraria o corpo do e-mail — ou pior, seria injetado como spintax.
 */
export function resolveSpintax(template: string, seed: string): string {
  let groupCounter = 0

  function parse(input: string, pos: number, stopAtBrace: boolean): [string, number] {
    let out = ''
    let i = pos

    while (i < input.length) {
      const ch = input[i]!

      if (ch === '{' && input[i + 1] === '{') {
        // Token de variável — copia intacto, incluindo o fechamento.
        const end = input.indexOf('}}', i + 2)
        if (end === -1) {
          out += input.slice(i)
          i = input.length
          break
        }
        out += input.slice(i, end + 2)
        i = end + 2
        continue
      }

      if (ch === '{') {
        const [resolved, next] = parseGroup(input, i + 1)
        out += resolved
        i = next
        continue
      }

      if (stopAtBrace && (ch === '|' || ch === '}')) break

      out += ch
      i++
    }

    return [out, i]
  }

  function parseGroup(input: string, pos: number): [string, number] {
    const options: string[] = []
    let i = pos

    for (;;) {
      const [option, next] = parse(input, i, true)
      options.push(option)
      i = next

      if (i >= input.length) break // grupo não fechado: trata o que veio como opção
      if (input[i] === '|') {
        i++
        continue
      }
      if (input[i] === '}') {
        i++
        break
      }
      break
    }

    // Cada grupo recebe uma semente própria; sem isso todos os grupos da
    // mensagem escolheriam sempre a mesma posição.
    const index = stablePick(options.length, seed, `spin:${groupCounter++}`)
    return [options[index] ?? '', i]
  }

  const [result] = parse(template, 0, false)
  return result
}

/**
 * Substitui `{{chave}}` e `{{chave|fallback}}`.
 *
 * O fallback existe porque lista de prospecção sempre tem buraco. Sem ele o
 * e-mail sai com "Olá ," — que é o sinal mais óbvio de disparo automatizado.
 */
export function substituteVariables(
  template: string,
  context: RenderContext,
  options: RenderOptions,
): string {
  return template.replace(/\{\{\s*([^}|]+?)\s*(?:\|\s*([^}]*?)\s*)?\}\}/g, (_m, rawKey, fallback) => {
    const key = String(rawKey).trim()
    const raw = context[key]
    const value = raw != null && raw.trim() !== '' ? raw : undefined

    if (value === undefined && fallback === undefined) {
      options.onMissing?.(key)
    }

    const resolved = value ?? (fallback !== undefined ? String(fallback) : '')
    return options.escapeHtml ? escapeHtmlValue(resolved) : resolved
  })
}

/** Spintax primeiro, variáveis depois — a ordem importa (ver `resolveSpintax`). */
export function render(
  template: string,
  context: RenderContext,
  options: RenderOptions,
): string {
  return substituteVariables(resolveSpintax(template, options.seed), context, options)
}

/** Monta o contexto de variáveis a partir do contato, achatando `custom`. */
export function contactToContext(contact: {
  email: string
  firstName?: string | null
  lastName?: string | null
  company?: string | null
  title?: string | null
  custom?: Record<string, string> | null
}): RenderContext {
  return {
    email: contact.email,
    first_name: contact.firstName,
    last_name: contact.lastName,
    full_name: [contact.firstName, contact.lastName].filter(Boolean).join(' ') || null,
    company: contact.company,
    title: contact.title,
    ...(contact.custom ?? {}),
  }
}

export type RenderedStep = {
  subject: string
  body: string
  subjectVariant: number
  bodyVariant: number
  missingVariables: string[]
}

/**
 * Renderiza um passo completo, escolhendo as variantes A/B de forma
 * determinística por contato — a atribuição não muda em retry nem em reenvio.
 */
export function renderStep(params: {
  subjectVariants: string[]
  bodyVariants: string[]
  context: RenderContext
  contactId: string
  stepId: string
  /** Follow-up reusa o assunto da thread com prefixo `Re:`. */
  threadSubject?: string | null
}): RenderedStep {
  const { subjectVariants, bodyVariants, context, contactId, stepId } = params
  const missing = new Set<string>()
  const onMissing = (k: string) => missing.add(k)

  const subjectVariant = stablePick(subjectVariants.length, contactId, stepId, 'subject')
  const bodyVariant = stablePick(bodyVariants.length, contactId, stepId, 'body')

  const subject = params.threadSubject
    ? withReplyPrefix(params.threadSubject)
    : render(subjectVariants[subjectVariant] ?? '', context, {
        seed: `${contactId}:${stepId}:subject`,
        onMissing,
      })

  const body = render(bodyVariants[bodyVariant] ?? '', context, {
    seed: `${contactId}:${stepId}:body`,
    escapeHtml: true,
    onMissing,
  })

  return {
    subject,
    body,
    subjectVariant,
    bodyVariant,
    missingVariables: [...missing],
  }
}

/** `Re:` só uma vez — `Re: Re: Re:` é assinatura de automação malfeita. */
export function withReplyPrefix(subject: string): string {
  return /^re:\s/i.test(subject) ? subject : `Re: ${subject}`
}
