/**
 * Blocos do corpo do e-mail.
 *
 * São artefato de EDIÇÃO, não de envio. O motor continua consumindo o HTML
 * gravado em `campaign_steps.bodyVariants`; os blocos são renderizados para
 * esse HTML no momento de salvar. Isso mantém o caminho de envio — já
 * validado em produção — sem nenhuma alteração, e permite abandonar os blocos
 * no futuro sem migrar dado nenhum.
 *
 * A saída é deliberadamente pobre: coluna única, estilos inline, sem tabela
 * aninhada e sem `<style>`. Cold email performa melhor parecendo texto
 * digitado por uma pessoa, e cada quilobyte de HTML decorativo é sinal que o
 * filtro usa contra você.
 */

export type Block =
  | { type: 'text'; html: string }
  | { type: 'heading'; text: string; level: 2 | 3 }
  | { type: 'button'; label: string; url: string }
  | { type: 'image'; url: string; alt: string }
  | { type: 'divider' }
  | { type: 'spacer'; size: 'sm' | 'md' | 'lg' }
  | { type: 'signature'; html: string }

export type BlockType = Block['type']

const ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ESCAPES[c] ?? c)
}

/**
 * Sanitiza URL antes de virar `href` ou `src`.
 *
 * Sem isso, um `javascript:` colado no campo de link viraria script no corpo
 * do e-mail. A maioria dos clientes bloqueia, mas o preview roda no navegador
 * do operador — e ali executaria.
 */
export function safeUrl(raw: string): string {
  const url = raw.trim()
  if (/^https?:\/\//i.test(url) || /^mailto:/i.test(url)) return escapeHtml(url)
  return '#'
}

/**
 * Rich text vindo do editor.
 *
 * Só um punhado de tags sobrevive. Lista fechada em vez de bloqueio de tags
 * perigosas: o que não está aqui vira texto, então uma tag nova ou exótica
 * falha para o lado seguro.
 */
const ALLOWED_INLINE = /^(b|strong|i|em|u|br|p|ul|ol|li|a)$/i

export function sanitizeRichText(html: string): string {
  return html.replace(/<([^>]*)>/g, (match, inner: string) => {
    const raw = inner.trim()
    const closing = raw.startsWith('/')
    // O `/` precisa sair ANTES do split: em `</b>` ele viraria o primeiro
    // campo e o nome da tag se perderia.
    const name = raw.replace(/^\//, '').split(/[\s/>]/)[0]?.toLowerCase() ?? ''

    if (!ALLOWED_INLINE.test(name)) return escapeHtml(match)

    // Em <a>, só o href sobrevive — e passa pelo safeUrl. Todo o resto
    // (incluindo onclick e style) é descartado.
    if (name === 'a' && !closing) {
      const href = /href\s*=\s*["']([^"']*)["']/i.exec(raw)?.[1] ?? ''
      return `<a href="${safeUrl(href)}" style="color:#4f46e5;">`
    }

    return `<${closing ? '/' : ''}${name}>`
  })
}

const SPACER_PX: Record<'sm' | 'md' | 'lg', number> = { sm: 8, md: 16, lg: 32 }

const BASE_TEXT =
  'margin:0 0 12px;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.6;color:#18181b;'

function renderBlock(block: Block): string {
  switch (block.type) {
    case 'text':
      return `<p style="${BASE_TEXT}">${sanitizeRichText(block.html)}</p>`

    case 'heading': {
      const size = block.level === 2 ? 20 : 17
      return `<h${block.level} style="margin:0 0 12px;font-family:Arial,Helvetica,sans-serif;font-size:${size}px;line-height:1.4;color:#18181b;">${escapeHtml(block.text)}</h${block.level}>`
    }

    case 'button':
      // Link estilizado, não imagem: sobrevive a cliente com imagens bloqueadas
      // e continua clicável mesmo quando o CSS é descartado.
      return `<p style="margin:0 0 16px;"><a href="${safeUrl(block.url)}" style="display:inline-block;padding:10px 20px;background:#4f46e5;color:#ffffff;font-family:Arial,Helvetica,sans-serif;font-size:15px;text-decoration:none;border-radius:6px;">${escapeHtml(block.label)}</a></p>`

    case 'image':
      return `<p style="margin:0 0 12px;"><img src="${safeUrl(block.url)}" alt="${escapeHtml(block.alt)}" style="max-width:100%;height:auto;display:block;"></p>`

    case 'divider':
      return '<hr style="border:none;border-top:1px solid #e4e4e7;margin:20px 0;">'

    case 'spacer':
      return `<div style="height:${SPACER_PX[block.size]}px;line-height:${SPACER_PX[block.size]}px;">&nbsp;</div>`

    case 'signature':
      return `<div style="${BASE_TEXT}margin-top:16px;">${sanitizeRichText(block.html)}</div>`

    default: {
      const exhaustive: never = block
      throw new Error(`Bloco não suportado: ${JSON.stringify(exhaustive)}`)
    }
  }
}

export function renderBlocksToHtml(blocks: Block[]): string {
  return blocks.map(renderBlock).join('\n')
}

/**
 * Converte HTML existente de volta para blocos, na melhor aproximação.
 *
 * Necessário para abrir no builder uma campanha criada antes dos blocos
 * existirem. Sem isso, editar uma campanha antiga apagaria o corpo.
 */
export function htmlToBlocks(html: string): Block[] {
  const trimmed = html.trim()
  if (!trimmed) return [{ type: 'text', html: '' }]

  const paragraphs = trimmed
    .split(/<\/p>|<br\s*\/?>\s*<br\s*\/?>/i)
    .map((p) => p.replace(/<p[^>]*>/i, '').trim())
    .filter(Boolean)

  if (paragraphs.length === 0) return [{ type: 'text', html: trimmed }]
  return paragraphs.map((p) => ({ type: 'text' as const, html: p }))
}

/** Texto puro dos blocos — alimenta as verificações de entregabilidade. */
export function blocksToPlainText(blocks: Block[]): string {
  return blocks
    .map((b) => {
      switch (b.type) {
        case 'text':
        case 'signature':
          return b.html.replace(/<[^>]+>/g, ' ')
        case 'heading':
          return b.text
        case 'button':
          return b.label
        case 'image':
          return b.alt
        default:
          return ''
      }
    })
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
}
