import pLimit from 'p-limit'
import type { Block, Log } from 'viem'
import { Hex, isHex } from 'viem'

import { cacheGet, cacheSet } from './cache'
import { env } from './env'
import { publicClient } from './rpc'
import { withRpcRetry } from './retry'

export type BlockRange = {
  fromBlock: bigint
  toBlock: bigint
}

function parseRetryRange(message: string): { from: bigint; to: bigint } | undefined {
  const m = message.match(/retry with the range\s+(\d+)-(\d+)/i)
  if (!m) return undefined
  return { from: BigInt(m[1]), to: BigInt(m[2]) }
}

export async function getBlockTimestampSeconds(blockNumber: bigint): Promise<bigint> {
  const cacheKey = `blockTs:${blockNumber.toString()}`
  const cached = cacheGet<bigint>(cacheKey)
  if (cached !== undefined) return cached
  const block = (await withRpcRetry(() => publicClient.getBlock({ blockNumber }))) as Block
  const ts = BigInt(block.timestamp)
  cacheSet(cacheKey, ts, 10 * 60 * 1000)
  return ts
}

export async function blockRangeForWindow(windowSeconds: number): Promise<BlockRange> {
  const latest = await withRpcRetry(() => publicClient.getBlockNumber())
  const latestTs = await getBlockTimestampSeconds(latest)
  // Estimate block range from average block time.
  const sampleDelta = 2000n
  const sampleBlock = latest > sampleDelta ? latest - sampleDelta : 0n
  const sampleTs = await getBlockTimestampSeconds(sampleBlock)
  const dt = Number(latestTs - sampleTs)
  const dn = Number(latest - sampleBlock)
  const avgSecondsPerBlock = dn > 0 ? Math.max(0.2, dt / dn) : 1

  const estBlocks = BigInt(Math.ceil(windowSeconds / avgSecondsPerBlock))
  const estFrom = latest > estBlocks ? latest - estBlocks : 0n

  const hardCapFrom = latest > env.maxScanBlocks ? latest - env.maxScanBlocks : 0n
  const fromBlock = estFrom < hardCapFrom ? hardCapFrom : estFrom

  return { fromBlock, toBlock: latest }
}

export type GetLogsArgs<TLog> = {
  fromBlock: bigint
  toBlock: bigint
  fetch: (range: { fromBlock: bigint; toBlock: bigint }) => Promise<TLog[]>
}

export async function getLogsChunked<TLog extends Log>({
  fromBlock,
  toBlock,
  fetch,
}: GetLogsArgs<TLog>): Promise<TLog[]> {
  const limit = pLimit(4)
  const results: TLog[] = []

  const minChunk = 200n
  const chunk = 5000n

  const ranges: Array<{ start: bigint; end: bigint }> = []
  for (let start = fromBlock; start <= toBlock; start += chunk) {
    const end = start + chunk - 1n > toBlock ? toBlock : start + chunk - 1n
    ranges.push({ start, end })
  }

  const fetchRange = async (start: bigint, end: bigint): Promise<TLog[]> =>
    limit(async () => {
      try {
        return await withRpcRetry(() => fetch({ fromBlock: start, toBlock: end }))
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        const retry = parseRetryRange(msg)
        if (retry) {
          return await fetchRange(retry.from, retry.to)
        }
        if (msg.toLowerCase().includes('query exceeds max results')) {
          const size = end - start + 1n
          if (size <= minChunk) throw err
          const mid = start + size / 2n
          const [left, right] = await Promise.all([
            fetchRange(start, mid),
            fetchRange(mid + 1n, end),
          ])
          return [...left, ...right]
        }
        throw err
      }
    })

  const parts = await Promise.all(ranges.map((range) => fetchRange(range.start, range.end)))
  for (const part of parts) results.push(...part)

  // Deduplicate defensively (txHash + logIndex)
  const seen = new Set<string>()
  return results.filter((l) => {
    const key = `${l.transactionHash}:${l.logIndex}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export function parseBytes32Memo(memo: string): Hex {
  if (!isHex(memo)) throw new Error('memo must be hex')
  if (memo.length !== 66) throw new Error('memo must be 32 bytes (0x + 64 hex)')
  return memo as Hex
}
