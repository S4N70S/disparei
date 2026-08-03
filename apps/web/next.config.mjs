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

const srcDir = fileURLToPath(new URL('./src', import.meta.url))

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Os packages do monorepo são consumidos como TypeScript-fonte.
  transpilePackages: ['@disparei/core', '@disparei/db', '@disparei/email'],
  /*
   * Sem `serverExternalPackages`.
   *
   * `postgres` e `nodemailer` já estiveram nessa lista, herdado de quando o
   * projeto usava bullmq (que tem drivers opcionais e reclamava no bundling).
   * Os dois são JavaScript puro e empacotam sem problema — deixá-los fora do
   * bundle faz a função serverless depender de o node_modules da raiz do
   * monorepo ser rastreado até o lambda, que é justamente onde isso quebra.
   */
  experimental: {
    serverActions: { bodySizeLimit: '10mb' }, // import de CSV
  },

  /*
   * O alias `@/` é declarado aqui, e não só no tsconfig.
   *
   * Num monorepo, o build da Vercel resolveu os `paths` do tsconfig em umas
   * passagens de compilação e não em outras — client components e route
   * handlers falhavam enquanto as páginas passavam. Declarar no bundler vale
   * para todas as passagens e não depende de o tsconfig ser encontrado a
   * partir do diretório em que o build foi disparado.
   */
  webpack: (config) => {
    config.resolve.alias = { ...config.resolve.alias, '@': srcDir }
    return config
  },
  turbopack: {
    resolveAlias: { '@/*': './src/*' },
  },
}

export default nextConfig
