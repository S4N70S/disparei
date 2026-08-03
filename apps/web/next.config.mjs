import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/*
 * O Next.js procura `.env` na pasta do próprio app, não na raiz do monorepo.
 * Como o `.env` é único e fica na raiz (para os scripts e o drizzle-kit
 * enxergarem o mesmo arquivo), carregamos aqui — este módulo é avaliado antes
 * do servidor subir.
 *
 * Em produção não existe arquivo: as variáveis vêm do painel da Vercel, e o
 * `existsSync` faz isto virar no-op.
 */
const rootEnv = fileURLToPath(new URL('../../.env', import.meta.url))
if (existsSync(rootEnv)) {
  // Não sobrescreve o que já veio do ambiente.
  process.loadEnvFile(rootEnv)
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Os packages do monorepo são consumidos como TypeScript-fonte.
  transpilePackages: ['@disparei/core', '@disparei/db', '@disparei/email'],
  // Dependências server-only: fora do bundle do webpack.
  serverExternalPackages: ['postgres', 'nodemailer'],
  experimental: {
    serverActions: { bodySizeLimit: '10mb' }, // import de CSV
  },
}

export default nextConfig
