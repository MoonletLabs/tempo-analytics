function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms))
}

function parseRetryAfterMs(message: string): number | undefined {
  const m = message.match(/try again in\s+(\d+)ms/i)
  if (!m) return undefined
  return Number.parseInt(m[1], 10)
}

function isRateLimitError(err: unknown): boolean {
  const msg =
    err instanceof Error
      ? err.message
      : typeof err === 'string'
        ? err
        : JSON.stringify(err)
  return (
    msg.includes('Status: 429') ||
    msg.toLowerCase().includes('rate limited') ||
    msg.includes('"code":-32005')
  )
}

function isTransientRpcError(err: unknown): boolean {
  const msg =
    err instanceof Error
      ? err.message
      : typeof err === 'string'
        ? err
        : JSON.stringify(err)

  const transientStatuses = [500, 502, 503, 504, 520, 522, 524]
  for (const s of transientStatuses) {
    if (msg.includes(`Status: ${s}`)) return true
  }
  if (msg.toLowerCase().includes('fetch failed')) return true
  if (msg.toLowerCase().includes('socket hang up')) return true
  if (msg.toLowerCase().includes('econnreset')) return true
  return false
}

export async function withRpcRetry<T>(fn: () => Promise<T>): Promise<T> {
  let lastErr: unknown
  for (let attempt = 0; attempt < 20; attempt++) {
    try {
      // eslint-disable-next-line no-await-in-loop
      return await fn()
    } catch (err) {
      lastErr = err
      if (!isRateLimitError(err) && !isTransientRpcError(err)) throw err
      const msg =
        err instanceof Error
          ? err.message
          : typeof err === 'string'
            ? err
            : JSON.stringify(err)
      const retryAfter = parseRetryAfterMs(msg)
      const backoff = Math.min(10_000, 200 * 2 ** Math.min(6, attempt))
      // eslint-disable-next-line no-await-in-loop
      await sleep(Math.max(retryAfter ?? 0, backoff))
    }
  }
  throw lastErr
}
