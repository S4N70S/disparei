import { resolveMx } from 'node:dns/promises'

/**
 * Caixas coletivas. Não são pessoas: têm engajamento baixíssimo, taxa de
 * reclamação alta e são endereço favorito de spam trap. Descartar na
 * importação é a defesa mais barata contra bounce e complaint.
 */
export const ROLE_PREFIXES = new Set([
  'abuse', 'admin', 'administrator', 'all', 'atendimento', 'billing', 'compras',
  'contact', 'contato', 'comercial', 'cs', 'dev', 'diretoria', 'editor',
  'faturamento', 'financeiro', 'help', 'hello', 'hr', 'info', 'jobs',
  'juridico', 'mail', 'marketing', 'noreply', 'no-reply', 'ouvidoria',
  'postmaster', 'privacy', 'rh', 'sac', 'sales', 'security', 'suporte',
  'support', 'team', 'vendas', 'webmaster',
])

/** Domínios descartáveis — nunca são prospect real. */
export const DISPOSABLE_DOMAINS = new Set([
  '10minutemail.com', 'guerrillamail.com', 'mailinator.com', 'tempmail.com',
  'temp-mail.org', 'throwawaymail.com', 'yopmail.com', 'trashmail.com',
  'sharklasers.com', 'getnada.com',
])

/**
 * Domínios de e-mail pessoal. Não são inválidos, mas em prospecção B2B
 * costumam indicar lista de baixa qualidade — sinalizamos sem descartar.
 */
export const FREE_DOMAINS = new Set([
  'gmail.com', 'hotmail.com', 'outlook.com', 'yahoo.com', 'yahoo.com.br',
  'live.com', 'icloud.com', 'bol.com.br', 'uol.com.br', 'terra.com.br',
  'globo.com', 'proton.me', 'protonmail.com',
])

export type ValidationReason =
  | 'invalid_syntax'
  | 'role_based'
  | 'disposable'
  | 'no_mx'
  | 'duplicate'
  | 'suppressed'

export type ValidationResult = {
  email: string
  valid: boolean
  reason?: ValidationReason
  /** Avisos não bloqueiam a importação. */
  warnings: string[]
}

// Deliberadamente mais restritivo que a RFC 5322: em prospecção, um endereço
// exótico quase sempre é erro de digitação ou de parsing do CSV.
const SYNTAX = /^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*@(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/i

export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase()
}

export function emailDomain(email: string): string {
  return email.slice(email.lastIndexOf('@') + 1)
}

export function emailLocalPart(email: string): string {
  return email.slice(0, email.lastIndexOf('@'))
}

/** Validação síncrona — sem I/O. A checagem de MX é separada e assíncrona. */
export function validateSyntax(rawEmail: string): ValidationResult {
  const email = normalizeEmail(rawEmail)
  const warnings: string[] = []

  if (!SYNTAX.test(email)) {
    return { email, valid: false, reason: 'invalid_syntax', warnings }
  }

  const domain = emailDomain(email)
  const local = emailLocalPart(email)

  if (DISPOSABLE_DOMAINS.has(domain)) {
    return { email, valid: false, reason: 'disposable', warnings }
  }

  // `+tag` costuma ser resíduo de scraping.
  const basePrefix = (local.split('+')[0] ?? local).replace(/[._-]+$/, '')
  if (ROLE_PREFIXES.has(basePrefix)) {
    return { email, valid: false, reason: 'role_based', warnings }
  }

  if (FREE_DOMAINS.has(domain)) warnings.push('free_domain')

  return { email, valid: true, warnings }
}

const mxCache = new Map<string, boolean>()

/**
 * Confirma que o domínio aceita e-mail. Resolve por domínio (não por
 * endereço) e cacheia: uma lista de 1k contatos costuma ter poucas centenas
 * de domínios distintos.
 */
export async function hasMxRecord(domain: string): Promise<boolean> {
  const cached = mxCache.get(domain)
  if (cached !== undefined) return cached

  let result = false
  try {
    const records = await resolveMx(domain)
    result = records.length > 0
  } catch {
    result = false // NXDOMAIN ou sem MX
  }

  mxCache.set(domain, result)
  return result
}

/** Validação completa de um lote, com MX resolvido uma vez por domínio. */
export async function validateBatch(
  rawEmails: string[],
  options: { checkMx?: boolean } = {},
): Promise<ValidationResult[]> {
  const results = rawEmails.map(validateSyntax)
  if (options.checkMx === false) return results

  const domains = new Set(
    results.filter((r) => r.valid).map((r) => emailDomain(r.email)),
  )
  const mxByDomain = new Map<string, boolean>()
  await Promise.all(
    [...domains].map(async (d) => {
      mxByDomain.set(d, await hasMxRecord(d))
    }),
  )

  return results.map((r) => {
    if (!r.valid) return r
    if (mxByDomain.get(emailDomain(r.email)) === false) {
      return { ...r, valid: false, reason: 'no_mx' as const }
    }
    return r
  })
}
