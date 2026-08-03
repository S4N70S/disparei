/**
 * Parser de CSV para importação de listas.
 *
 * Feito à mão em vez de dependência porque precisamos de duas coisas que as
 * libs genéricas não dão de graça: detecção de delimitador (planilha
 * brasileira exporta com `;` por padrão do Excel pt-BR) e tolerância a
 * arquivo sujo — lista de prospecção raramente vem limpa.
 */

export type ParsedCsv = {
  headers: string[]
  rows: string[][]
  delimiter: string
}

const CANDIDATE_DELIMITERS = [',', ';', '\t', '|']

export function detectDelimiter(sample: string): string {
  const firstLine = sample.split(/\r?\n/, 1)[0] ?? ''
  let best = ','
  let bestCount = 0

  for (const d of CANDIDATE_DELIMITERS) {
    // Conta apenas fora de aspas, senão um campo "Cargo: Diretor, Vendas"
    // faria a vírgula ganhar de um arquivo que na verdade usa ponto e vírgula.
    let count = 0
    let inQuotes = false
    for (let i = 0; i < firstLine.length; i++) {
      const ch = firstLine[i]
      if (ch === '"') inQuotes = !inQuotes
      else if (ch === d && !inQuotes) count++
    }
    if (count > bestCount) {
      best = d
      bestCount = count
    }
  }

  return best
}

export function parseCsv(input: string, delimiter?: string): ParsedCsv {
  // BOM do Excel vira parte do primeiro header se não for removido.
  const text = input.replace(/^﻿/, '')
  const d = delimiter ?? detectDelimiter(text)

  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  let i = 0

  while (i < text.length) {
    const ch = text[i]!

    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i += 2
          continue
        }
        inQuotes = false
        i++
        continue
      }
      field += ch
      i++
      continue
    }

    if (ch === '"') {
      inQuotes = true
      i++
      continue
    }

    if (ch === d) {
      row.push(field)
      field = ''
      i++
      continue
    }

    if (ch === '\r') {
      i++
      continue
    }

    if (ch === '\n') {
      row.push(field)
      rows.push(row)
      row = []
      field = ''
      i++
      continue
    }

    field += ch
    i++
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field)
    rows.push(row)
  }

  const headerRow = rows.shift() ?? []
  const headers = headerRow.map((h) => h.trim())

  // Descarta linhas totalmente vazias (rodapé de planilha, linha em branco final).
  const dataRows = rows.filter((r) => r.some((c) => c.trim() !== ''))

  return { headers, rows: dataRows, delimiter: d }
}

export type FieldKey =
  | 'email'
  | 'firstName'
  | 'lastName'
  | 'company'
  | 'title'
  | 'ignore'
  | 'custom'

/** Sinônimos pt-BR e en para adivinhar o mapeamento e poupar cliques. */
const HEADER_HINTS: ReadonlyArray<[FieldKey, RegExp]> = [
  ['email', /^(e-?mail|email_?address|endere[çc]o\s*de\s*e-?mail|mail)$/i],
  ['firstName', /^(first_?name|nome|primeiro_?nome|given_?name|nome_?contato)$/i],
  ['lastName', /^(last_?name|sobrenome|surname|family_?name|[úu]ltimo_?nome)$/i],
  ['company', /^(company|empresa|organiza[çc][ãa]o|organization|account|raz[ãa]o_?social)$/i],
  ['title', /^(title|cargo|job_?title|position|fun[çc][ãa]o|posi[çc][ãa]o)$/i],
]

export function suggestMapping(headers: string[]): Record<string, FieldKey> {
  const mapping: Record<string, FieldKey> = {}
  const taken = new Set<FieldKey>()

  for (const header of headers) {
    const normalized = header.trim()
    let matched: FieldKey = 'custom'

    for (const [key, re] of HEADER_HINTS) {
      if (!taken.has(key) && re.test(normalized)) {
        matched = key
        taken.add(key)
        break
      }
    }

    mapping[header] = matched
  }

  return mapping
}

export type MappedRow = {
  email: string
  firstName?: string
  lastName?: string
  company?: string
  title?: string
  custom: Record<string, string>
}

/** Converte a chave de uma coluna livre em nome de variável de template. */
export function toVariableName(header: string): string {
  return header
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

export function applyMapping(
  parsed: ParsedCsv,
  mapping: Record<string, FieldKey>,
): MappedRow[] {
  return parsed.rows.map((cells) => {
    const out: MappedRow = { email: '', custom: {} }

    parsed.headers.forEach((header, idx) => {
      const value = (cells[idx] ?? '').trim()
      if (value === '') return

      switch (mapping[header]) {
        case 'email':
          out.email = value
          break
        case 'firstName':
          out.firstName = value
          break
        case 'lastName':
          out.lastName = value
          break
        case 'company':
          out.company = value
          break
        case 'title':
          out.title = value
          break
        case 'custom':
          out.custom[toVariableName(header)] = value
          break
        case 'ignore':
        default:
          break
      }
    })

    return out
  })
}
