import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema'

export type Database = ReturnType<typeof createDatabase>

/**
 * O worker e o app web abrem pools separados de propósito: o worker é
 * long-running e sustenta conexões, o web (serverless) precisa de pool curto.
 */
export function createDatabase(url: string, options?: { max?: number }) {
  const client = postgres(url, {
    max: options?.max ?? 10,
    prepare: false, // compatível com pgBouncer/Supabase em modo transaction
  })
  return drizzle(client, { schema })
}

let cached: Database | undefined

/** Singleton para o app web, evitando esgotar o pool em hot reload. */
export function db(): Database {
  if (!cached) {
    const url = process.env.DATABASE_URL
    if (!url) throw new Error('DATABASE_URL não configurada')
    cached = createDatabase(url)
  }
  return cached
}
