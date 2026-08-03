import type { Workspace } from '@disparei/db'
import { signAddressToken, signToken, verifyAddressToken } from './crypto'

/**
 * Conformidade LGPD para prospecção B2B.
 *
 * A base legal aqui é legítimo interesse (Art. 7º, IX) — não consentimento.
 * Ela só se sustenta se o destinatário conseguir identificar quem enviou, de
 * onde veio o dado e como sair, sem atrito. A ANPD fiscaliza desde 2025, com
 * multa de até 2% do faturamento (teto R$ 50M).
 *
 * Por isso o rodapé é montado aqui e concatenado no worker: o usuário da
 * ferramenta não pode removê-lo pelo editor de template.
 */

export type ComplianceContext = {
  workspace: Pick<
    Workspace,
    'legalName' | 'name' | 'cnpj' | 'privacyPolicyUrl' | 'privacyEmail' | 'postalAddress'
  >
  unsubscribeUrl: string
  /** Como o endereço foi obtido — exigência de transparência da LGPD. */
  dataSourceNote?: string
}

export function buildUnsubscribeUrl(
  baseUrl: string,
  enrollmentId: string,
  secret: string,
): string {
  return `${baseUrl.replace(/\/$/, '')}/unsubscribe/${signToken(enrollmentId, secret)}`
}

/**
 * `r.<token>@inbound.<dominio>` — liga a resposta de volta ao enrollment.
 *
 * É este endereço que torna a parada por resposta determinística: não
 * dependemos de casar assunto ou remetente, que falha assim que a pessoa
 * encaminha para um colega ou responde de outro endereço.
 */
export function buildReplyToAddress(
  enrollmentId: string,
  inboundDomain: string,
  secret: string,
): string {
  return `r.${signAddressToken(enrollmentId, secret)}@${inboundDomain}`
}

/** Extrai o enrollmentId de um destinatário de resposta. `null` se não for nosso. */
export function parseReplyToAddress(address: string, secret: string): string | null {
  // Aceita tanto "Nome <a@b>" quanto "a@b".
  const bare = (address.match(/<([^>]+)>/)?.[1] ?? address).trim()
  const at = bare.lastIndexOf('@')
  if (at <= 0) return null

  const local = bare.slice(0, at).toLowerCase()
  if (!local.startsWith('r.')) return null

  return verifyAddressToken(local.slice(2), secret)
}

export function buildFooterHtml(ctx: ComplianceContext): string {
  const w = ctx.workspace
  const identity = [w.legalName ?? w.name, w.cnpj ? `CNPJ ${w.cnpj}` : null, w.postalAddress]
    .filter(Boolean)
    .join(' · ')

  const source =
    ctx.dataSourceNote ??
    'Obtivemos seu e-mail profissional em fontes públicas de dados empresariais.'

  const links = [
    `<a href="${ctx.unsubscribeUrl}" style="color:#666;">Não quero mais receber</a>`,
    w.privacyPolicyUrl
      ? `<a href="${w.privacyPolicyUrl}" style="color:#666;">Política de Privacidade</a>`
      : null,
    w.privacyEmail ? `<a href="mailto:${w.privacyEmail}" style="color:#666;">${w.privacyEmail}</a>` : null,
  ]
    .filter(Boolean)
    .join(' · ')

  return [
    '<div style="margin-top:24px;padding-top:12px;border-top:1px solid #e5e5e5;font-size:11px;line-height:1.5;color:#888;font-family:Arial,sans-serif;">',
    `<p style="margin:0 0 4px;">${identity}</p>`,
    `<p style="margin:0 0 4px;">${source} Tratamos seus dados com base no legítimo interesse (art. 7º, IX, da LGPD) para comunicação profissional.</p>`,
    `<p style="margin:0;">${links}</p>`,
    '</div>',
  ].join('')
}

export function buildFooterText(ctx: ComplianceContext): string {
  const w = ctx.workspace
  const identity = [w.legalName ?? w.name, w.cnpj ? `CNPJ ${w.cnpj}` : null, w.postalAddress]
    .filter(Boolean)
    .join(' · ')

  return [
    '',
    '---',
    identity,
    ctx.dataSourceNote ??
      'Obtivemos seu e-mail profissional em fontes públicas de dados empresariais.',
    'Tratamos seus dados com base no legítimo interesse (art. 7º, IX, da LGPD).',
    `Para não receber mais: ${ctx.unsubscribeUrl}`,
    w.privacyPolicyUrl ? `Política de Privacidade: ${w.privacyPolicyUrl}` : null,
  ]
    .filter((l) => l !== null)
    .join('\n')
}

/**
 * Headers de descadastro.
 *
 * `List-Unsubscribe-Post` habilita o botão nativo de "cancelar inscrição" do
 * Gmail e do Outlook. Ele é o que faz o destinatário irritado clicar em
 * descadastrar em vez de marcar como spam — e complaint é o que derruba
 * reputação de domínio.
 */
export function buildComplianceHeaders(params: {
  unsubscribeUrl: string
  privacyEmail?: string | null
}): Record<string, string> {
  const targets = [`<${params.unsubscribeUrl}>`]
  if (params.privacyEmail) {
    targets.unshift(`<mailto:${params.privacyEmail}?subject=unsubscribe>`)
  }

  return {
    'List-Unsubscribe': targets.join(', '),
    'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
  }
}

/** Junta corpo e rodapé sem depender do template ter (ou não) `<body>`. */
export function appendFooter(bodyHtml: string, footerHtml: string): string {
  if (/<\/body>/i.test(bodyHtml)) {
    return bodyHtml.replace(/<\/body>/i, `${footerHtml}</body>`)
  }
  return `${bodyHtml}${footerHtml}`
}
