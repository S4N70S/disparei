/**
 * Imprime a impressão digital dos segredos locais.
 *
 * Serve para comparar com o que `/api/health` reporta em produção. Como as
 * variáveis são marcadas Sensitive na Vercel, não dá para lê-las de volta —
 * comparar digests é o único jeito de saber se os dois ambientes têm o mesmo
 * valor sem expor nenhum deles.
 *
 *   npx tsx scripts/fingerprint.ts
 */

import { createHash, createHmac } from 'node:crypto'
import { loadEnvFile } from './lib/load-env'

loadEnvFile()

const secret = process.env.TOKEN_SECRET
if (!secret) {
  console.error('TOKEN_SECRET não definida no .env')
  process.exit(1)
}

function fingerprint(value: string | undefined): string {
  if (!value) return '(vazia)'
  const mac = createHmac('sha256', secret!).update(value).digest()
  return createHash('sha256').update(mac).digest('hex').slice(0, 12)
}

console.log('\nImpressão digital dos segredos locais:\n')
for (const key of ['APP_PASSWORD', 'ENCRYPTION_KEY', 'CRON_SECRET', 'TOKEN_SECRET'] as const) {
  console.log(`  ${key.padEnd(16)} ${fingerprint(process.env[key])}`)
}
console.log(
  '\nCompare com: curl -s $APP_URL/api/health | python3 -m json.tool\n' +
    'Digest diferente = o valor na Vercel não é o mesmo daqui.\n',
)
