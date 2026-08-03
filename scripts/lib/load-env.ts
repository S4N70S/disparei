import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/**
 * Carrega o `.env` da raiz do repositório.
 *
 * `npm run doctor` precisa funcionar sem o usuário exportar variável na mão —
 * caso contrário o primeiro contato com a ferramenta é um erro de
 * configuração que não é dele.
 */
export function loadEnvFile(): boolean {
  const path = fileURLToPath(new URL('../../.env', import.meta.url))
  if (!existsSync(path)) return false

  // Disponível no Node 20.12+. Não sobrescreve variáveis já exportadas.
  process.loadEnvFile(path)
  return true
}
