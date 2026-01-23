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
  let chunk = 5000n
  let start = fromBlock

  while (start <= toBlock) {
    const end = start + chunk - 1n > toBlock ? toBlock : start + chunk - 1n

    // eslint-disable-next-line no-await-in-loop
    const part = await limit(async () => {
      try {
        return await withRpcRetry(() => fetch({ fromBlock: start, toBlock: end }))
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        const retry = parseRetryRange(msg)
        if (retry) {
          return await withRpcRetry(() => fetch({ fromBlock: retry.from, toBlock: retry.to }))
        }
        if (msg.toLowerCase().includes('query exceeds max results') && chunk > minChunk) {
          chunk = chunk / 2n
          if (chunk < minChunk) chunk = minChunk
          return await withRpcRetry(() => fetch({ fromBlock: start, toBlock: end }))
        }
        throw err
      }
    })
    results.push(...part)
    start = end + 1n
  }

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
