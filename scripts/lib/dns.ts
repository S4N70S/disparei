import { Resolver, resolve4, resolveNs } from 'node:dns/promises'

/**
 * Consulta DNS pelo nameserver autoritativo do domínio.
 *
 * O resolver do sistema serve resposta em cache, e durante a configuração de
 * DNS todo registro é recém-alterado — é justamente quando o cache mente. Um
 * SPF publicado há 5 minutos aparece como ausente por até uma hora, e o
 * usuário vai caçar um problema que não existe (ou pior: republicar o
 * registro e criar um SPF duplicado, que invalida os dois).
 */

const cache = new Map<string, Resolver | null>()

/** Sobe do subdomínio até achar quem responde NS. */
async function findAuthoritative(domain: string): Promise<Resolver | null> {
  const labels = domain.split('.')

  for (let i = 0; i < labels.length - 1; i++) {
    const zone = labels.slice(i).join('.')
    try {
      const nameservers = await resolveNs(zone)
      if (nameservers.length === 0) continue

      const ips = (
        await Promise.all(
          nameservers.map((ns) => resolve4(ns).catch(() => [] as string[])),
        )
      ).flat()

      if (ips.length === 0) continue

      const resolver = new Resolver()
      resolver.setServers(ips)
      return resolver
    } catch {
      // Zona não delegada nesse nível — tenta o próximo rótulo acima.
    }
  }

  return null
}

async function resolverFor(domain: string): Promise<Resolver | null> {
  const key = domain.toLowerCase()
  if (!cache.has(key)) cache.set(key, await findAuthoritative(key))
  return cache.get(key) ?? null
}

export type LookupResult<T> = {
  records: T[]
  /** `false` quando caímos no resolver do sistema e a resposta pode ser velha. */
  authoritative: boolean
}

export async function lookupTxt(name: string): Promise<LookupResult<string>> {
  const resolver = await resolverFor(name)

  if (resolver) {
    try {
      const records = await resolver.resolveTxt(name)
      return { records: records.map((chunks) => chunks.join('')), authoritative: true }
    } catch {
      return { records: [], authoritative: true } // NXDOMAIN autoritativo
    }
  }

  try {
    const { resolveTxt } = await import('node:dns/promises')
    const records = await resolveTxt(name)
    return { records: records.map((chunks) => chunks.join('')), authoritative: false }
  } catch {
    return { records: [], authoritative: false }
  }
}

export async function lookupMx(
  name: string,
): Promise<LookupResult<{ exchange: string; priority: number }>> {
  const resolver = await resolverFor(name)

  if (resolver) {
    try {
      return { records: await resolver.resolveMx(name), authoritative: true }
    } catch {
      return { records: [], authoritative: true }
    }
  }

  try {
    const { resolveMx } = await import('node:dns/promises')
    return { records: await resolveMx(name), authoritative: false }
  } catch {
    return { records: [], authoritative: false }
  }
}
