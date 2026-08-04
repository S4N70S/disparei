import { blocksToPlainText, type Block } from './blocks'

/**
 * Verificações de entregabilidade, rodadas enquanto o operador escreve.
 *
 * Não bloqueiam nada — informam. A ideia é que a decisão de colocar uma
 * imagem num e-mail frio seja consciente, e não uma descoberta feita três
 * semanas depois quando a reputação do domínio já caiu.
 *
 * Os limites vêm do que a operação suporta: o Resend suspende acima de 0,08%
 * de reclamação, e cada sinal aqui empurra nessa direção.
 */

export type Severity = 'info' | 'warning' | 'critical'

export type Check = {
  id: string
  severity: Severity
  title: string
  detail: string
}

export type DeliverabilityInput = {
  subject: string
  blocks: Block[]
  /** SMTP = prospecção fria, onde o peso do HTML custa mais caro. */
  provider: 'resend' | 'smtp'
}

export type DeliverabilityReport = {
  checks: Check[]
  /** 0 = e-mail pesado e arriscado · 100 = texto limpo estilo 1:1. */
  score: number
  wordCount: number
  linkCount: number
  imageCount: number
}

/** Acima disso, cold email começa a perder resposta. */
export const MAX_WORDS = 150
export const MAX_SUBJECT_CHARS = 60

/**
 * Termos que filtros bayesianos pontuam negativamente. Lista curta e focada
 * em português comercial — a exaustividade não compensa o ruído.
 */
const SPAM_TRIGGERS = [
  'grátis', 'gratis', 'promoção', 'promocao', 'desconto', 'oferta imperdível',
  'oferta imperdivel', 'clique aqui', 'compre agora', 'urgente', 'última chance',
  'ultima chance', 'garantido', 'sem compromisso', 'ganhe dinheiro', 'renda extra',
  '100%', 'imperdível', 'imperdivel', 'exclusivo', 'aproveite já', 'aproveite ja',
]

const VARIABLE_PATTERN = /\{\{\s*[a-z0-9_]+/i

function countLinks(blocks: Block[]): number {
  return blocks.reduce((n, b) => {
    if (b.type === 'button') return n + 1
    if (b.type === 'text' || b.type === 'signature') {
      return n + (b.html.match(/<a\s/gi)?.length ?? 0)
    }
    return n
  }, 0)
}

function countImages(blocks: Block[]): number {
  return blocks.filter((b) => b.type === 'image').length
}

export function analyzeDeliverability(input: DeliverabilityInput): DeliverabilityReport {
  const { subject, blocks, provider } = input
  const checks: Check[] = []

  const text = blocksToPlainText(blocks)
  const wordCount = text ? text.split(/\s+/).filter(Boolean).length : 0
  const linkCount = countLinks(blocks)
  const imageCount = countImages(blocks)
  const isCold = provider === 'smtp'

  // ---- Tamanho -----------------------------------------------------------

  if (wordCount > MAX_WORDS) {
    checks.push({
      id: 'length',
      severity: wordCount > MAX_WORDS * 2 ? 'critical' : 'warning',
      title: `Corpo com ${wordCount} palavras`,
      detail: `Acima de ${MAX_WORDS} a taxa de resposta cai. E-mail frio que funciona cabe na tela do celular sem rolar.`,
    })
  } else if (wordCount === 0) {
    checks.push({
      id: 'empty',
      severity: 'critical',
      title: 'Corpo vazio',
      detail: 'Adicione ao menos um bloco de texto.',
    })
  }

  // ---- Links -------------------------------------------------------------

  if (linkCount > 1) {
    checks.push({
      id: 'links',
      severity: linkCount > 3 ? 'critical' : 'warning',
      title: `${linkCount} links no corpo`,
      detail: isCold
        ? 'Em prospecção fria, um link só. Vários links são o padrão de newsletter e é assim que o filtro classifica.'
        : 'Muitos links diluem o clique e pesam na classificação.',
    })
  }

  // ---- Imagens -----------------------------------------------------------

  if (imageCount > 0) {
    checks.push({
      id: 'images',
      severity: isCold ? 'critical' : 'info',
      title: `${imageCount} imagem(ns)`,
      detail: isCold
        ? 'Esta campanha usa caixa SMTP, ou seja, prospecção fria. Imagem denuncia disparo em massa: ninguém manda e-mail 1:1 com banner. Considere remover.'
        : 'Aceitável em nutrição opt-in. Garanta que o texto se sustenta sozinho, porque muitos clientes bloqueiam imagem por padrão.',
    })
  }

  // ---- Assunto -----------------------------------------------------------

  if (!subject.trim()) {
    checks.push({
      id: 'subject-empty',
      severity: 'info',
      title: 'Assunto vazio',
      detail: 'Follow-up sem assunto herda a thread do primeiro toque com prefixo Re:, que é o comportamento desejado.',
    })
  } else if (subject.length > MAX_SUBJECT_CHARS) {
    checks.push({
      id: 'subject-length',
      severity: 'warning',
      title: `Assunto com ${subject.length} caracteres`,
      detail: `Acima de ${MAX_SUBJECT_CHARS} o celular corta. O que importa tem que caber no começo.`,
    })
  }

  // ---- Palavras de gatilho ------------------------------------------------

  const haystack = `${subject} ${text}`.toLowerCase()
  const found = SPAM_TRIGGERS.filter((t) => haystack.includes(t))
  if (found.length > 0) {
    checks.push({
      id: 'spam-words',
      severity: found.length > 2 ? 'critical' : 'warning',
      title: `Termo de risco: ${found.slice(0, 3).join(', ')}`,
      detail: 'Vocabulário de promoção em massa. Filtro pontua negativamente e o leitor desconfia.',
    })
  }

  // ---- Personalização -----------------------------------------------------

  const hasVariable = VARIABLE_PATTERN.test(subject) || blocks.some(
    (b) => (b.type === 'text' || b.type === 'signature') && VARIABLE_PATTERN.test(b.html),
  )
  if (!hasVariable && wordCount > 0) {
    checks.push({
      id: 'no-personalization',
      severity: isCold ? 'warning' : 'info',
      title: 'Nenhuma variável de personalização',
      detail: 'Sem {{first_name}} ou {{company}}, todos recebem texto idêntico — o que é assinatura de disparo em massa para o filtro e óbvio para quem lê.',
    })
  }

  // ---- Índice -------------------------------------------------------------

  const penalty = checks.reduce((sum, c) => {
    if (c.severity === 'critical') return sum + 30
    if (c.severity === 'warning') return sum + 15
    return sum + 3
  }, 0)

  return {
    checks,
    score: Math.max(0, Math.min(100, 100 - penalty)),
    wordCount,
    linkCount,
    imageCount,
  }
}

export function scoreLabel(score: number): { label: string; tone: 'green' | 'amber' | 'red' } {
  if (score >= 80) return { label: 'Leve', tone: 'green' }
  if (score >= 50) return { label: 'Atenção', tone: 'amber' }
  return { label: 'Pesado', tone: 'red' }
}
