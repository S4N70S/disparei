import { createHmac, timingSafeEqual } from 'node:crypto'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { db, eq, workspaces } from '@disparei/db'
import { env } from './env'

const COOKIE = 'disparei_session'
const MAX_AGE_SECONDS = 60 * 60 * 24 * 7

/**
 * Sessão do v1: workspace único, uma senha.
 *
 * Deliberadamente simples — o schema já é multi-tenant, então trocar isto por
 * autenticação real depois não mexe em nenhuma query.
 */
function sign(value: string): string {
  return createHmac('sha256', env().TOKEN_SECRET).update(value).digest('base64url')
}

export function verifyPassword(password: string): boolean {
  const a = Buffer.from(sign(password))
  const b = Buffer.from(sign(env().APP_PASSWORD))
  return a.length === b.length && timingSafeEqual(a, b)
}

export async function createSession(): Promise<void> {
  const issuedAt = Date.now().toString()
  const store = await cookies()
  store.set(COOKIE, `${issuedAt}.${sign(issuedAt)}`, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: MAX_AGE_SECONDS,
    path: '/',
  })
}

export async function destroySession(): Promise<void> {
  const store = await cookies()
  store.delete(COOKIE)
}

export async function isAuthenticated(): Promise<boolean> {
  const store = await cookies()
  const raw = store.get(COOKIE)?.value
  if (!raw) return false

  const [issuedAt, mac] = raw.split('.')
  if (!issuedAt || !mac) return false

  const expected = sign(issuedAt)
  const a = Buffer.from(mac)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !timingSafeEqual(a, b)) return false

  return Date.now() - Number(issuedAt) < MAX_AGE_SECONDS * 1000
}

/** Workspace atual. No v1 é sempre o primeiro (e único). */
export async function requireWorkspace() {
  if (!(await isAuthenticated())) redirect('/login')

  const [workspace] = await db().select().from(workspaces).limit(1)
  if (!workspace) redirect('/setup')

  return workspace
}

export async function currentWorkspaceId(): Promise<string> {
  return (await requireWorkspace()).id
}

export async function findWorkspaceById(id: string) {
  const [w] = await db().select().from(workspaces).where(eq(workspaces.id, id)).limit(1)
  return w
}
