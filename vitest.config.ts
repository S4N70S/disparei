import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url))

export default defineConfig({
  test: {
    include: ['packages/**/*.test.ts', 'apps/**/*.test.ts'],
    environment: 'node',
  },
  resolve: {
    alias: {
      '@disparei/db': r('./packages/db/src/index.ts'),
      '@disparei/core': r('./packages/core/src/index.ts'),
      '@disparei/email': r('./packages/email/src/index.ts'),
    },
  },
})
