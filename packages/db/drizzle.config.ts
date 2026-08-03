import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { defineConfig } from 'drizzle-kit'

/**
 * O drizzle-kit não carrega `.env` sozinho — ele só lê `process.env`.
 *
 * Sobe a partir do diretório atual procurando o arquivo, porque o comando
 * pode ser disparado da raiz (`npm run db:migrate`) ou de dentro do package
 * (`npm run migrate`), e o cwd muda nos dois casos.
 */
function loadEnv(): void {
  let dir = process.cwd()

  for (let i = 0; i < 5; i++) {
    const candidate = resolve(dir, '.env')
    if (existsSync(candidate)) {
      process.loadEnvFile(candidate)
      return
    }
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
}

loadEnv()

/*
 * Migrations preferem o Session pooler (porta 5432).
 *
 * O Transaction pooler (6543) multiplexa conexões e não sustenta recursos de
 * sessão nem prepared statements — o runtime lida com isso via `prepare:
 * false`, mas o drizzle-kit aplica DDL e precisa de uma sessão de verdade.
 *
 * A conexão DIRETA (`db.<ref>.supabase.co`) não serve: a Supabase a publica
 * só em IPv6, e rede sem rota IPv6 falha com ENOTFOUND antes de tentar
 * conectar.
 */
const url = process.env.MIGRATE_DATABASE_URL || process.env.DATABASE_URL || ''

// `generate` só lê o schema e escreve SQL — não conecta em nada. Exigir a URL
// aqui impediria gerar migration sem ter banco provisionado.
const NEEDS_CONNECTION = ['migrate', 'push', 'pull', 'studio', 'check', 'up']
const command = process.argv.find((arg) => NEEDS_CONNECTION.includes(arg))

if (command && !url) {
  throw new Error(
    `DATABASE_URL não encontrada (necessária para "${command}").\n\n` +
      '  1. cp .env.example .env\n' +
      '  2. Supabase → Connect → Session pooler → copie em MIGRATE_DATABASE_URL\n' +
      '     (host aws-0-<região>.pooler.supabase.com, porta 5432)\n',
  )
}

if (command && /^postgresql:\/\/[^@]*@db\.[a-z0-9]+\.supabase\.co/.test(url)) {
  throw new Error(
    'A connection string é a DIRETA do Supabase, que só existe em IPv6 —\n' +
      'em rede sem IPv6 ela falha com ENOTFOUND.\n\n' +
      '  Use o Session pooler: Supabase → Connect → Session pooler\n' +
      '  Host:    aws-0-<região>.pooler.supabase.com\n' +
      '  Porta:   5432\n' +
      '  Usuário: postgres.<project-ref>   (não é só "postgres")\n',
  )
}

export default defineConfig({
  schema: './src/schema.ts',
  out: './migrations',
  dialect: 'postgresql',
  dbCredentials: { url },
  strict: true,
  verbose: true,
})
