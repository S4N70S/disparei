import type { Block } from './blocks'

/**
 * Biblioteca de toques.
 *
 * Cada toque de uma cadência tem uma função distinta. Sequência que repete a
 * mesma mensagem em tom mais insistente não converte — cansa. O que funciona é
 * mudar o ângulo a cada toque: relevância, prova, novo problema, saída digna.
 *
 * Os rascunhos são propositalmente incompletos, com reticências onde o
 * operador precisa colocar contexto real. Template preenchido demais vira
 * e-mail genérico enviado sem edição, que é pior do que campo em branco.
 */

export type TouchPurpose =
  | 'opening'
  | 'bump'
  | 'social_proof'
  | 'new_angle'
  | 'resource'
  | 'breakup'

export type TouchTemplate = {
  purpose: TouchPurpose
  label: string
  /** O que este toque faz na cadência — aparece no card do canvas. */
  role: string
  /** Por que ele funciona. Mostrado ao escolher na biblioteca. */
  rationale: string
  subject: string
  blocks: Block[]
  /** Dias úteis sugeridos desde o toque anterior. */
  suggestedWaitDays: number
  /** Follow-up encadeia na thread; abertura, não. */
  sameThread: boolean
}

export const TOUCH_LIBRARY: readonly TouchTemplate[] = [
  {
    purpose: 'opening',
    label: 'Abertura com relevância',
    role: 'Estabelece por que você e por que agora',
    rationale:
      'O primeiro toque só precisa provar que a mensagem não é disparo genérico. Uma observação específica sobre a empresa vale mais que qualquer descrição do seu produto.',
    subject: '{Pergunta rápida|Ideia} sobre {{company|sua operação}}',
    blocks: [
      { type: 'text', html: 'Oi {{first_name|tudo bem}},' },
      {
        type: 'text',
        html: 'Vi que a {{company|sua empresa}} ... <i>(observação específica: contratação, lançamento, notícia, algo do site)</i>',
      },
      {
        type: 'text',
        html: 'Trabalho com ... e normalmente isso aparece como ... <i>(o problema, na linguagem de quem vive ele)</i>',
      },
      { type: 'text', html: 'Faz sentido conversarmos 15 minutos?' },
      { type: 'signature', html: 'Abraço,<br>Diego' },
    ],
    suggestedWaitDays: 0,
    sameThread: false,
  },
  {
    purpose: 'bump',
    label: 'Bump curto',
    role: 'Sobe a thread sem repetir o argumento',
    rationale:
      'Duas linhas, no máximo. O objetivo é reaparecer no topo da caixa, não reargumentar. Bump longo soa como insistência; bump curto soa como organização.',
    subject: '',
    blocks: [
      { type: 'text', html: 'Oi {{first_name|tudo bem}}, subindo este e-mail caso tenha passado batido.' },
      { type: 'text', html: 'Vale uma conversa rápida?' },
    ],
    suggestedWaitDays: 3,
    sameThread: true,
  },
  {
    purpose: 'social_proof',
    label: 'Prova social',
    role: 'Mostra resultado em empresa parecida',
    rationale:
      'Caso concreto de uma empresa do mesmo porte ou setor. Número específico vale mais que adjetivo — "reduziu 40% do tempo de resposta" funciona, "resultados expressivos" não.',
    subject: '',
    blocks: [
      { type: 'text', html: '{{first_name|Oi}}, deixo um caso parecido com o de vocês.' },
      {
        type: 'text',
        html: 'A <b>...</b> tinha ... e depois de ... passou a ... <i>(número específico, prazo real)</i>',
      },
      { type: 'text', html: 'Se fizer sentido, te mostro como aplicaria na {{company|sua operação}}.' },
    ],
    suggestedWaitDays: 4,
    sameThread: true,
  },
  {
    purpose: 'new_angle',
    label: 'Ângulo novo',
    role: 'Troca o problema abordado',
    rationale:
      'Se o primeiro ângulo não pegou, talvez você tenha errado a dor, não a pessoa. Este toque aposta em outro problema que o mesmo cargo costuma ter.',
    subject: '',
    blocks: [
      { type: 'text', html: '{{first_name|Oi}}, mudando de assunto.' },
      {
        type: 'text',
        html: 'Outra coisa que aparece muito em ... é ... <i>(problema diferente, mesmo cargo)</i>',
      },
      { type: 'text', html: 'É prioridade aí neste momento?' },
    ],
    suggestedWaitDays: 4,
    sameThread: true,
  },
  {
    purpose: 'resource',
    label: 'Recurso sem pedido',
    role: 'Entrega valor sem pedir reunião',
    rationale:
      'Um toque que não pede nada quebra o padrão da sequência e costuma gerar resposta justamente por isso. Material útil de verdade, não isca disfarçada.',
    subject: '',
    blocks: [
      { type: 'text', html: '{{first_name|Oi}}, sem pedir nada desta vez.' },
      {
        type: 'text',
        html: 'Montei ... que pode ser útil para vocês, independente de conversarmos. <i>(checklist, análise, comparativo)</i>',
      },
      { type: 'text', html: 'Se quiser, respondo com o link.' },
    ],
    suggestedWaitDays: 5,
    sameThread: true,
  },
  {
    purpose: 'breakup',
    label: 'Encerramento',
    role: 'Fecha a cadência deixando a porta aberta',
    rationale:
      'O toque com maior taxa de resposta de toda a sequência. Encerrar de forma digna aciona a aversão à perda e, mais importante, respeita o silêncio de quem não tem interesse.',
    subject: '',
    blocks: [
      {
        type: 'text',
        html: '{{first_name|Oi}}, sem retorno imagino que não seja prioridade agora — o que é completamente justo.',
      },
      { type: 'text', html: 'Encerro por aqui e não volto a incomodar.' },
      { type: 'text', html: 'Se mudar em algum momento, é só responder este e-mail.' },
    ],
    suggestedWaitDays: 5,
    sameThread: true,
  },
] as const

/** Cadência padrão ao abrir o builder: 4 toques, o mínimo defensável. */
export const DEFAULT_SEQUENCE: readonly TouchPurpose[] = [
  'opening',
  'bump',
  'social_proof',
  'breakup',
]

export function findTouch(purpose: TouchPurpose): TouchTemplate {
  const found = TOUCH_LIBRARY.find((t) => t.purpose === purpose)
  if (!found) throw new Error(`Toque desconhecido: ${purpose}`)
  return found
}

/**
 * Avalia a forma da cadência montada.
 *
 * Os dados públicos de 2026 são consistentes: boa parte das respostas vem dos
 * toques posteriores ao primeiro, e o ponto ideal fica entre 4 e 7. Sequência
 * de 1 ou 2 toques desiste antes de o follow-up ter chance.
 */
export function reviewSequence(steps: Array<{ purpose?: string; waitDays: number }>): string[] {
  const notes: string[] = []

  if (steps.length === 0) return ['A sequência está vazia.']
  if (steps.length < 3) {
    notes.push(
      `${steps.length} toque(s): curto demais. A maior parte das respostas vem dos toques posteriores ao primeiro — abaixo de 4 você desiste antes da hora.`,
    )
  }
  if (steps.length > 7) {
    notes.push(
      `${steps.length} toques: acima de 7 a taxa de reclamação sobe mais rápido do que a de resposta.`,
    )
  }
  if (!steps.some((s) => s.purpose === 'breakup')) {
    notes.push(
      'Sem toque de encerramento. Ele costuma ter a maior taxa de resposta da sequência, e encerrar de forma explícita reduz reclamação de spam.',
    )
  }

  const curtos = steps.slice(1).filter((s) => s.waitDays < 2).length
  if (curtos > 0) {
    notes.push(
      `${curtos} intervalo(s) abaixo de 2 dias úteis. Cadência apertada lê como perseguição e aumenta descadastro.`,
    )
  }

  return notes
}
