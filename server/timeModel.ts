import { cacheGet, cacheSet } from './cache'
import { publicClient } from './rpc'
import { withRpcRetry } from './retry'

export type TimeModel = {
  latestBlock: bigint
  latestTs: number
  avgSecondsPerBlock: number
}

export async function getTimeModel(): Promise<TimeModel> {
  const cacheKey = 'timeModel'
  const cached = cacheGet<TimeModel>(cacheKey)
  if (cached) return cached

  const latestBlock = await withRpcRetry(() => publicClient.getBlockNumber())
  const sampleDelta = 2000n
  const sampleBlock = latestBlock > sampleDelta ? latestBlock - sampleDelta : 0n

  const latest = await withRpcRetry(() => publicClient.getBlock({ blockNumber: latestBlock }))
  const sample = await withRpcRetry(() => publicClient.getBlock({ blockNumber: sampleBlock }))

  const latestTs = Number(latest.timestamp)
  const sampleTs = Number(sample.timestamp)

  const dt = Math.max(1, latestTs - sampleTs)
  const dn = Number(latestBlock - sampleBlock)
  const avgSecondsPerBlock = dn > 0 ? Math.max(0.2, dt / dn) : 1

  const out = { latestBlock, latestTs, avgSecondsPerBlock }
  cacheSet(cacheKey, out, 30 * 1000)
  return out
}

export function applyApproxTimestamps<T extends { blockNumber: number }>(
  items: T[],
  model: TimeModel,
): (T & { timestamp: number })[] {
  return items.map((i) => {
    const deltaBlocks = Number(model.latestBlock) - i.blockNumber
    const approx = model.latestTs - Math.max(0, Math.round(deltaBlocks * model.avgSecondsPerBlock))
    return { ...i, timestamp: approx }
  })
}
