import { describe, expect, it } from 'vitest'
import {
  blocksToPlainText,
  escapeHtml,
  htmlToBlocks,
  renderBlocksToHtml,
  safeUrl,
  sanitizeRichText,
  type Block,
} from './blocks'

describe('safeUrl', () => {
  it('aceita http, https e mailto', () => {
    expect(safeUrl('https://acme.com')).toBe('https://acme.com')
    expect(safeUrl('http://acme.com')).toBe('http://acme.com')
    expect(safeUrl('mailto:a@b.com')).toBe('mailto:a@b.com')
  })

  it.each([
    'javascript:alert(1)',
    'JaVaScRiPt:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'vbscript:msgbox',
    '/caminho-relativo',
  ])('neutraliza esquema perigoso ou relativo: %s', (url) => {
    // O preview roda no navegador do operador — ali um javascript: executaria.
    expect(safeUrl(url)).toBe('#')
  })

  it('escapa aspas para não escapar do atributo', () => {
    expect(safeUrl('https://a.com/"onload="alert(1)')).not.toContain('"onload')
  })
})

describe('sanitizeRichText', () => {
  it('preserva formatação básica', () => {
    expect(sanitizeRichText('<b>oi</b> <i>tudo</i> <br> bem')).toBe(
      '<b>oi</b> <i>tudo</i> <br> bem',
    )
  })

  it('transforma tag não permitida em texto', () => {
    const out = sanitizeRichText('<script>alert(1)</script>oi')
    expect(out).not.toContain('<script>')
    expect(out).toContain('&lt;script&gt;')
  })

  it('remove atributos de evento das tags permitidas', () => {
    const out = sanitizeRichText('<b onclick="alert(1)">oi</b>')
    expect(out).toBe('<b>oi</b>')
  })

  it('mantém href do link mas sanitiza o esquema', () => {
    expect(sanitizeRichText('<a href="https://acme.com">x</a>')).toContain('href="https://acme.com"')
    expect(sanitizeRichText('<a href="javascript:alert(1)">x</a>')).toContain('href="#"')
  })

  it('descarta iframe e object', () => {
    const out = sanitizeRichText('<iframe src="x"></iframe><object></object>')
    expect(out).not.toMatch(/<(iframe|object)/)
  })
})

describe('renderBlocksToHtml', () => {
  it('renderiza parágrafo com estilo inline', () => {
    const out = renderBlocksToHtml([{ type: 'text', html: 'Oi Diego' }])
    expect(out).toContain('Oi Diego')
    expect(out).toContain('font-family')
  })

  it('renderiza título no nível pedido', () => {
    expect(renderBlocksToHtml([{ type: 'heading', text: 'Título', level: 2 }])).toMatch(/<h2/)
    expect(renderBlocksToHtml([{ type: 'heading', text: 'Título', level: 3 }])).toMatch(/<h3/)
  })

  it('renderiza botão como link, não imagem', () => {
    // Cliente com imagens bloqueadas ainda mostra e permite clicar.
    const out = renderBlocksToHtml([{ type: 'button', label: 'Agendar', url: 'https://cal.com/x' }])
    expect(out).toContain('<a href="https://cal.com/x"')
    expect(out).not.toContain('<img')
    expect(out).toContain('Agendar')
  })

  it('escapa conteúdo do usuário no título e no botão', () => {
    const out = renderBlocksToHtml([
      { type: 'heading', text: '<script>x</script>', level: 2 },
      { type: 'button', label: '"><script>y</script>', url: 'https://a.com' },
    ])
    expect(out).not.toContain('<script>')
  })

  it('não emite tabela aninhada nem bloco style', () => {
    const todos: Block[] = [
      { type: 'text', html: 'a' },
      { type: 'heading', text: 'b', level: 2 },
      { type: 'button', label: 'c', url: 'https://a.com' },
      { type: 'image', url: 'https://a.com/i.png', alt: 'd' },
      { type: 'divider' },
      { type: 'spacer', size: 'md' },
      { type: 'signature', html: 'e' },
    ]
    const out = renderBlocksToHtml(todos)
    expect(out).not.toMatch(/<table/i)
    expect(out).not.toMatch(/<style/i)
  })

  it('imagem sai responsiva', () => {
    const out = renderBlocksToHtml([{ type: 'image', url: 'https://a.com/i.png', alt: 'logo' }])
    expect(out).toContain('max-width:100%')
    expect(out).toContain('alt="logo"')
  })

  it('junta os blocos na ordem recebida', () => {
    const out = renderBlocksToHtml([
      { type: 'text', html: 'primeiro' },
      { type: 'text', html: 'segundo' },
    ])
    expect(out.indexOf('primeiro')).toBeLessThan(out.indexOf('segundo'))
  })

  it('devolve string vazia para lista vazia', () => {
    expect(renderBlocksToHtml([])).toBe('')
  })
})

describe('htmlToBlocks', () => {
  it('converte parágrafos em blocos de texto', () => {
    const blocks = htmlToBlocks('<p>um</p><p>dois</p>')
    expect(blocks).toHaveLength(2)
    expect(blocks[0]).toEqual({ type: 'text', html: 'um' })
  })

  it('não perde conteúdo de campanha antiga sem marcação', () => {
    // Abrir no builder uma campanha criada antes dos blocos não pode apagar
    // o corpo.
    const blocks = htmlToBlocks('texto solto')
    expect(blocksToPlainText(blocks)).toContain('texto solto')
  })

  it('devolve um bloco vazio para entrada vazia', () => {
    expect(htmlToBlocks('')).toEqual([{ type: 'text', html: '' }])
  })
})

describe('blocksToPlainText', () => {
  it('extrai texto de todos os tipos relevantes', () => {
    const out = blocksToPlainText([
      { type: 'heading', text: 'Título', level: 2 },
      { type: 'text', html: '<b>corpo</b> aqui' },
      { type: 'button', label: 'Clique', url: 'https://a.com' },
      { type: 'divider' },
    ])
    expect(out).toBe('Título corpo aqui Clique')
  })
})

describe('escapeHtml', () => {
  it('escapa os cinco caracteres perigosos', () => {
    expect(escapeHtml(`<>&"'`)).toBe('&lt;&gt;&amp;&quot;&#39;')
  })
})
