import type { Address } from 'viem'

import { cacheGet, cacheSet } from './cache'
import { env } from './env'

export type TempoToken = {
  chainId: number
  address: Address
  name: string
  symbol: string
  decimals: number
  logoURI?: string
}

type TokenList = {
  name: string
  tokens: TempoToken[]
}

export async function fetchTokenlist(): Promise<TokenList> {
  const cacheKey = `tokenlist:${env.tokenlistUrl}`
  const cached = cacheGet<TokenList>(cacheKey)
  if (cached) return cached

  const res = await fetch(env.tokenlistUrl, {
    headers: {
      accept: 'application/json',
    },
  })
  if (!res.ok) {
    throw new Error(`tokenlist fetch failed: ${res.status} ${res.statusText}`)
  }

  const data = (await res.json()) as TokenList
  const filtered: TokenList = {
    name: data.name,
    tokens: (data.tokens ?? []).filter((t) => t.chainId === env.chainId),
  }

  cacheSet(cacheKey, filtered, 30 * 60 * 1000)
  return filtered
}
