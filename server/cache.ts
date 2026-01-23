import { LRUCache } from 'lru-cache'

type CacheValue = {
  expiresAt: number
  value: unknown
}

const cache = new LRUCache<string, CacheValue>({
  max: 500,
})

export function cacheGet<T>(key: string): T | undefined {
  const hit = cache.get(key)
  if (!hit) return undefined
  if (Date.now() > hit.expiresAt) {
    cache.delete(key)
    return undefined
  }
  return hit.value as T
}

export function cacheSet<T>(key: string, value: T, ttlMs: number): void {
  cache.set(key, { value, expiresAt: Date.now() + ttlMs })
}
