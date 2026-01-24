import { LRUCache } from 'lru-cache'

type CacheValue = {
  expiresAt: number
  value: unknown
}

const cache = new LRUCache<string, CacheValue>({
  max: 500,
  // Automatically delete expired entries when accessed
  updateAgeOnGet: false,
})

// Periodic cleanup of expired entries (every 5 minutes)
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000

function cleanupExpiredEntries() {
  const now = Date.now()
  let cleaned = 0
  for (const [key, value] of cache.entries()) {
    if (now > value.expiresAt) {
      cache.delete(key)
      cleaned++
    }
  }
  if (cleaned > 0) {
    console.log(`[cache] Cleaned up ${cleaned} expired entries`)
  }
}

// Start periodic cleanup
setInterval(cleanupExpiredEntries, CLEANUP_INTERVAL_MS)

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

// Export for testing/monitoring
export function getCacheStats() {
  return {
    size: cache.size,
    max: cache.max,
  }
}
