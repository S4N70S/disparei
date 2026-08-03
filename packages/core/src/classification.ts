export type Classification =
  | 'unclassified'
  | 'interested'
  | 'not_interested'
  | 'out_of_office'
  | 'negative'

/**
 * Triagem automática de respostas.
 *
 * Serve para priorizar a fila do vendedor e para detectar pedidos explícitos
 * de remoção — muita gente pede para sair respondendo o e-mail em vez de
 * clicar no descadastro, e ignorar isso é violação de LGPD, não descuido.
 *
 * É heurística de primeira passada: o operador sempre pode reclassificar na
 * inbox. O que NÃO fazemos é retomar cadência com base nela — qualquer
 * resposta, de qualquer tipo, para a sequência.
 */

const PATTERNS: ReadonlyArray<{ classification: Classification; terms: RegExp }> = [
  {
    // Auto-resposta precisa vir primeiro: "estou de férias, não tenho
    // interesse em nada" classificaria errado na ordem inversa.
    classification: 'out_of_office',
    terms:
      /\b(f[ée]rias|ausente do escrit[óo]rio|estarei fora|resposta autom[áa]tica|out of office|automatic reply|auto[- ]?reply|licen[çc]a m[ée]dica|retorno (?:no )?dia)\b/i,
  },
  {
    classification: 'negative',
    terms:
      // `remov\w*` cobre remova/remove/remover/removam — em português a
      // conjugação varia e uma lista fechada de formas deixa passar pedido
      // legítimo de descadastro, que é falha de LGPD.
      /\b(remov\w*\s+(?:meu|este|o|nosso|meus)?\s*(?:e-?mail|contato|endere[çc]o|cadastro)|remov\w*\s+(?:me\s+)?d[ae]\s+(?:sua\s+)?lista|me\s+(?:tire|remova|remove|descadastre|exclua)|descadastr\w*|pare\s+de\s+(?:enviar|mandar)|n[ãa]o\s+(?:me\s+)?(?:envie|mande|escreva)\s+mais|unsubscribe|stop\s+emailing|take\s+me\s+off|spam)\b/i,
  },
  {
    classification: 'not_interested',
    terms:
      /\b(n[ãa]o\s+(?:tenho|temos|há|ha)\s+interesse|sem\s+interesse|n[ãa]o\s+(?:é|e)\s+prioridade|no\s+momento\s+n[ãa]o|agora\s+n[ãa]o|not\s+interested|no,?\s+thanks|n[ãa]o\s+faz\s+sentido|j[áa]\s+(?:temos|usamos)\b)/i,
  },
  {
    classification: 'interested',
    terms:
      /\b(tenho\s+interesse|me\s+interessa|vamos\s+(?:conversar|marcar|falar)|podemos\s+(?:conversar|marcar|falar)|pode\s+(?:me\s+)?(?:ligar|chamar)|agenda\w*|reuni[ãa]o|call|me\s+manda\s+(?:mais|o)|gostaria\s+de\s+saber\s+mais|faz\s+sentido|interessante|qual\s+(?:o\s+)?(?:valor|pre[çc]o))\b/i,
  },
]

/**
 * Remove a parte citada da resposta.
 *
 * Sem isso a heurística leria o NOSSO texto original, que está cheio de
 * gatilhos de "interessado" — e classificaria toda resposta como positiva.
 */
export function stripQuotedText(body: string): string {
  const cutoffs = [
    /^\s*>/m,
    /^\s*(?:Em|On)\s.+(?:escreveu|wrote):/m,
    /^\s*-{2,}\s*(?:Mensagem original|Original Message|Forwarded message)/im,
    /^\s*De:\s.+$/m,
    /^\s*From:\s.+$/m,
  ]

  let cut = body.length
  for (const re of cutoffs) {
    const m = re.exec(body)
    if (m && m.index < cut) cut = m.index
  }

  return body.slice(0, cut).trim()
}

export function classifyReply(body: string | null | undefined): Classification {
  if (!body) return 'unclassified'

  const text = stripQuotedText(body)
  if (text.length === 0) return 'unclassified'

  for (const { classification, terms } of PATTERNS) {
    if (terms.test(text)) return classification
  }

  return 'unclassified'
}

/**
 * Resposta que exige supressão imediata. Só o pedido explícito de remoção
 * entra aqui — "não tenho interesse agora" não é pedido de descadastro, e
 * suprimir por isso jogaria fora contato reaproveitável no futuro.
 */
export function requiresSuppression(classification: Classification): boolean {
  return classification === 'negative'
}
