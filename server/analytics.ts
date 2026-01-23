import type { Address, Hex } from 'viem'
import { formatUnits } from 'viem'

import { feeManager, tip20, tip403 } from './abis'
import { cacheGet, cacheSet } from './cache'
import { env } from './env'
import {
  blockRangeForWindow,
  getLogsChunked,
  parseBytes32Memo,
} from './logs'
import { publicClient } from './rpc'
import { withRpcRetry } from './retry'
import { applyApproxTimestamps, getTimeModel } from './timeModel'
import type { TempoToken } from './tokenlist'
import { fetchTokenlist } from './tokenlist'

const MAX_EVENTS = Number.parseInt(process.env.TEMPO_MAX_EVENTS ?? '1000', 10)

export type MemoTransfer = {
  token: Pick<TempoToken, 'address' | 'symbol' | 'name' | 'decimals' | 'logoURI'>
  from: Address
  to: Address
  amount: string
  rawAmount: string
  memo: Hex
  txHash: Hex
  blockNumber: number
  timestamp: number
}

export type FeePayment = {
  token: Pick<TempoToken, 'address' | 'symbol' | 'name' | 'decimals' | 'logoURI'>
  payer: Address
  sender?: Address
  sponsored?: boolean
  amount: string
  rawAmount: string
  txHash: Hex
  blockNumber: number
  timestamp: number
}

export type FeeAmmPool = {
  userToken: Pick<TempoToken, 'address' | 'symbol' | 'name' | 'decimals' | 'logoURI'>
  validatorToken: Pick<TempoToken, 'address' | 'symbol' | 'name' | 'decimals' | 'logoURI'>
  reserveUserToken: string
  reserveValidatorToken: string
}

export type FeeAmmSummary = {
  pools: FeeAmmPool[]
  totalLiquidityByToken: Record<string, string>
}

export type ComplianceEvent =
  | {
      type: 'PolicyCreated'
      policyId: string
      updater: Address
      policyType: number
      txHash: Hex
      blockNumber: number
      timestamp: number
    }
  | {
      type: 'PolicyAdminUpdated'
      policyId: string
      updater: Address
      admin: Address
      txHash: Hex
      blockNumber: number
      timestamp: number
    }
  | {
      type: 'WhitelistUpdated'
      policyId: string
      updater: Address
      account: Address
      allowed: boolean
      txHash: Hex
      blockNumber: number
      timestamp: number
    }
  | {
      type: 'BlacklistUpdated'
      policyId: string
      updater: Address
      account: Address
      restricted: boolean
      txHash: Hex
      blockNumber: number
      timestamp: number
    }

export type DashboardResponse = {
  windowSeconds: number
  range: { fromBlock: string; toBlock: string }
  tokens: TempoToken[]
  memoTransfers: MemoTransfer[]
  fees: FeePayment[]
  compliance: ComplianceEvent[]
  aggregates: {
    totalTransferCount: number
    memoTransferCount: number
    memoTransferVolumeByToken: Record<string, string>
    feePaidByToken: Record<string, string>
    complianceEventCount: number
    uniqueMemos: number
    uniqueFeePayers: number
    sponsoredFeePayments: number
    sponsoredFeePaymentRate: number
    uniqueComplianceUpdaters: number
    uniquePolicyIds: number
    uniqueAffectedAddresses: number
  }
  feeAmm: FeeAmmSummary
}

function tokenRef(t: TempoToken) {
  return {
    address: t.address,
    symbol: t.symbol,
    name: t.name,
    decimals: t.decimals,
    logoURI: t.logoURI,
  } as const
}

async function attachTimestamps<T extends { blockNumber: number }>(
  items: T[],
): Promise<(T & { timestamp: number })[]> {
  // Fast path: approximate timestamps using a short-lived time model.
  // This avoids N x eth_getBlockByNumber calls on the public RPC.
  const model = await getTimeModel()
  return applyApproxTimestamps(items, model)
}

async function fetchMemoTransfersRpc(windowSeconds: number, memo?: Hex) {
  const [{ tokens }, range] = await Promise.all([
    fetchTokenlist(),
    blockRangeForWindow(windowSeconds),
  ])

  const tokenByAddress = new Map<string, TempoToken>(
    tokens.map((t) => [t.address.toLowerCase(), t]),
  )
  const tokenAddresses = tokens.map((t) => t.address)

  const transfers: Omit<MemoTransfer, 'timestamp'>[] = []

  const logs = await getLogsChunked({
    fromBlock: range.fromBlock,
    toBlock: range.toBlock,
    fetch: async ({ fromBlock, toBlock }) =>
      publicClient.getLogs({
        address: tokenAddresses,
        event: tip20.transferWithMemo,
        args: memo ? { memo } : undefined,
        fromBlock,
        toBlock,
      }),
  })

  for (const l of logs) {
    const token = tokenByAddress.get(l.address.toLowerCase())
    if (!token) continue
    transfers.push({
      token: tokenRef(token),
      from: l.args.from,
      to: l.args.to,
      memo: l.args.memo,
      amount: formatUnits(l.args.amount, token.decimals),
      rawAmount: l.args.amount.toString(),
      txHash: l.transactionHash,
      blockNumber: Number(l.blockNumber),
    })
  }

  transfers.sort((a, b) => b.blockNumber - a.blockNumber)
  return attachTimestamps(transfers.slice(0, MAX_EVENTS))
}

async function fetchFeePaymentsRpc(windowSeconds: number) {
  const [{ tokens }, range] = await Promise.all([
    fetchTokenlist(),
    blockRangeForWindow(windowSeconds),
  ])

  const tokenByAddress = new Map<string, TempoToken>(
    tokens.map((t) => [t.address.toLowerCase(), t]),
  )
  const tokenAddresses = tokens.map((t) => t.address)

  let logs = await getLogsChunked({
    fromBlock: range.fromBlock,
    toBlock: range.toBlock,
    fetch: async ({ fromBlock, toBlock }) =>
      publicClient.getLogs({
        address: tokenAddresses,
        event: tip20.transfer,
        args: { to: env.contracts.feeManager },
        fromBlock,
        toBlock,
      }),
  })

  if (!logs.length) {
    logs = await getLogsChunked({
      fromBlock: range.fromBlock,
      toBlock: range.toBlock,
      fetch: async ({ fromBlock, toBlock }) =>
        publicClient.getLogs({
          address: tokenAddresses,
          event: tip20.transferWithMemo,
          args: { to: env.contracts.feeManager },
          fromBlock,
          toBlock,
        }),
    })
  }

  const fees: Omit<FeePayment, 'timestamp'>[] = []
  for (const l of logs) {
    const token = tokenByAddress.get(l.address.toLowerCase())
    if (!token) continue
    fees.push({
      token: tokenRef(token),
      payer: l.args.from,
      amount: formatUnits(l.args.amount, token.decimals),
      rawAmount: l.args.amount.toString(),
      txHash: l.transactionHash,
      blockNumber: Number(l.blockNumber),
    })
  }

  fees.sort((a, b) => b.blockNumber - a.blockNumber)
  return attachTimestamps(fees.slice(0, MAX_EVENTS))
}

async function fetchTotalTransfersRpc(windowSeconds: number) {
  const [{ tokens }, range] = await Promise.all([
    fetchTokenlist(),
    blockRangeForWindow(windowSeconds),
  ])

  const tokenAddresses = tokens.map((t) => t.address)

  let logs = await getLogsChunked({
    fromBlock: range.fromBlock,
    toBlock: range.toBlock,
    fetch: async ({ fromBlock, toBlock }) =>
      publicClient.getLogs({
        address: tokenAddresses,
        event: tip20.transfer,
        fromBlock,
        toBlock,
      }),
  })

  if (!logs.length) {
    logs = await getLogsChunked({
      fromBlock: range.fromBlock,
      toBlock: range.toBlock,
      fetch: async ({ fromBlock, toBlock }) =>
        publicClient.getLogs({
          address: tokenAddresses,
          event: tip20.transferWithMemo,
          fromBlock,
          toBlock,
        }),
    })
  }

  return logs.slice(0, MAX_EVENTS).length
}


export async function getMemoTransfers(windowSeconds: number, memo?: Hex) {
  return fetchMemoTransfersRpc(windowSeconds, memo)
}

export async function getFeePayments(windowSeconds: number) {
  return fetchFeePaymentsRpc(windowSeconds)
}

export async function getTotalTransfers(windowSeconds: number) {
  return fetchTotalTransfersRpc(windowSeconds)
}

export async function getFeeAmmSummary(): Promise<FeeAmmSummary> {
  const cacheKey = 'feeAmmSummary'
  const cached = cacheGet<FeeAmmSummary>(cacheKey)
  if (cached) return cached

  const { tokens } = await fetchTokenlist()
  const byAddress = new Map<string, TempoToken>(tokens.map((t) => [t.address.toLowerCase(), t]))

  const pools: FeeAmmPool[] = []
  const totalRawByToken = new Map<string, bigint>()

  const pairs: Array<{ user: TempoToken; validator: TempoToken }> = []
  for (const userToken of tokens) {
    for (const validatorToken of tokens) {
      if (userToken.address.toLowerCase() === validatorToken.address.toLowerCase()) continue
      pairs.push({ user: userToken, validator: validatorToken })
    }
  }

  const results = await withRpcRetry(() =>
    publicClient.multicall({
      allowFailure: true,
      contracts: pairs.map((p) => ({
        address: env.contracts.feeManager,
        abi: [feeManager.getPool],
        functionName: 'getPool',
        args: [p.user.address, p.validator.address],
      })),
    }),
  )

  for (let i = 0; i < pairs.length; i++) {
    const r = results[i]
    if (!r || r.status !== 'success') continue
    const [ru, rv] = r.result as readonly [bigint, bigint]
    const reserveUser = BigInt(ru)
    const reserveValidator = BigInt(rv)
    if (reserveUser === 0n && reserveValidator === 0n) continue

    const userToken = pairs[i].user
    const validatorToken = pairs[i].validator
    const u = byAddress.get(userToken.address.toLowerCase())
    const v = byAddress.get(validatorToken.address.toLowerCase())
    if (!u || !v) continue

    totalRawByToken.set(u.symbol, (totalRawByToken.get(u.symbol) ?? 0n) + reserveUser)
    totalRawByToken.set(v.symbol, (totalRawByToken.get(v.symbol) ?? 0n) + reserveValidator)

    pools.push({
      userToken: tokenRef(u),
      validatorToken: tokenRef(v),
      reserveUserToken: formatUnits(reserveUser, u.decimals),
      reserveValidatorToken: formatUnits(reserveValidator, v.decimals),
    })
  }

  pools.sort((a, b) =>
    a.userToken.symbol === b.userToken.symbol
      ? a.validatorToken.symbol.localeCompare(b.validatorToken.symbol)
      : a.userToken.symbol.localeCompare(b.userToken.symbol),
  )

  const totalLiquidityByToken: Record<string, string> = {}
  for (const token of tokens) {
    const raw = totalRawByToken.get(token.symbol) ?? 0n
    totalLiquidityByToken[token.symbol] = formatUnits(raw, token.decimals)
  }

  const out = { pools, totalLiquidityByToken }
  cacheSet(cacheKey, out, 5 * 60 * 1000)
  return out
}

export async function getComplianceEvents(windowSeconds: number) {
  const range = await blockRangeForWindow(windowSeconds)

  const [policyCreated, policyAdminUpdated, whitelistUpdated, blacklistUpdated] =
    await Promise.all([
      getLogsChunked({
        fromBlock: range.fromBlock,
        toBlock: range.toBlock,
        fetch: async ({ fromBlock, toBlock }) =>
          publicClient.getLogs({
            address: env.contracts.tip403Registry,
            event: tip403.policyCreated,
            fromBlock,
            toBlock,
          }),
      }),
      getLogsChunked({
        fromBlock: range.fromBlock,
        toBlock: range.toBlock,
        fetch: async ({ fromBlock, toBlock }) =>
          publicClient.getLogs({
            address: env.contracts.tip403Registry,
            event: tip403.policyAdminUpdated,
            fromBlock,
            toBlock,
          }),
      }),
      getLogsChunked({
        fromBlock: range.fromBlock,
        toBlock: range.toBlock,
        fetch: async ({ fromBlock, toBlock }) =>
          publicClient.getLogs({
            address: env.contracts.tip403Registry,
            event: tip403.whitelistUpdated,
            fromBlock,
            toBlock,
          }),
      }),
      getLogsChunked({
        fromBlock: range.fromBlock,
        toBlock: range.toBlock,
        fetch: async ({ fromBlock, toBlock }) =>
          publicClient.getLogs({
            address: env.contracts.tip403Registry,
            event: tip403.blacklistUpdated,
            fromBlock,
            toBlock,
          }),
      }),
    ])

  const raw: Omit<ComplianceEvent, 'timestamp'>[] = []
  for (const l of policyCreated) {
    raw.push({
      type: 'PolicyCreated',
      policyId: l.args.policyId.toString(),
      updater: l.args.updater,
      policyType: Number(l.args.policyType),
      txHash: l.transactionHash,
      blockNumber: Number(l.blockNumber),
    })
  }
  for (const l of policyAdminUpdated) {
    raw.push({
      type: 'PolicyAdminUpdated',
      policyId: l.args.policyId.toString(),
      updater: l.args.updater,
      admin: l.args.admin,
      txHash: l.transactionHash,
      blockNumber: Number(l.blockNumber),
    })
  }
  for (const l of whitelistUpdated) {
    raw.push({
      type: 'WhitelistUpdated',
      policyId: l.args.policyId.toString(),
      updater: l.args.updater,
      account: l.args.account,
      allowed: l.args.allowed,
      txHash: l.transactionHash,
      blockNumber: Number(l.blockNumber),
    })
  }
  for (const l of blacklistUpdated) {
    raw.push({
      type: 'BlacklistUpdated',
      policyId: l.args.policyId.toString(),
      updater: l.args.updater,
      account: l.args.account,
      restricted: l.args.restricted,
      txHash: l.transactionHash,
      blockNumber: Number(l.blockNumber),
    })
  }

  raw.sort((a, b) => b.blockNumber - a.blockNumber)
  return attachTimestamps(raw.slice(0, MAX_EVENTS))
}

export async function buildDashboard(windowSeconds: number): Promise<DashboardResponse> {
  const cacheKey = `dashboard:${windowSeconds}`
  const cached = cacheGet<DashboardResponse>(cacheKey)
  if (cached) return cached

  const [tokenlist, range, memoTransfers, fees, compliance, feeAmm, totalTransferCount] = await Promise.all([
    fetchTokenlist(),
    blockRangeForWindow(windowSeconds),
    getMemoTransfers(windowSeconds),
    getFeePayments(windowSeconds),
    getComplianceEvents(windowSeconds),
    getFeeAmmSummary(),
    getTotalTransfers(windowSeconds),
  ])

  const memoTransferVolumeByToken: Record<string, bigint> = {}
  for (const t of memoTransfers) {
    memoTransferVolumeByToken[t.token.symbol] =
      (memoTransferVolumeByToken[t.token.symbol] ?? 0n) + BigInt(t.rawAmount)
  }

  const feePaidByToken: Record<string, bigint> = {}
  for (const f of fees) {
    feePaidByToken[f.token.symbol] = (feePaidByToken[f.token.symbol] ?? 0n) + BigInt(f.rawAmount)
  }

  const memoTransferVolumeByTokenFormatted: Record<string, string> = {}
  for (const token of tokenlist.tokens) {
    const raw = memoTransferVolumeByToken[token.symbol] ?? 0n
    memoTransferVolumeByTokenFormatted[token.symbol] = formatUnits(raw, token.decimals)
  }

  const feePaidByTokenFormatted: Record<string, string> = {}
  for (const token of tokenlist.tokens) {
    const raw = feePaidByToken[token.symbol] ?? 0n
    feePaidByTokenFormatted[token.symbol] = formatUnits(raw, token.decimals)
  }

  const uniqueMemos = new Set(memoTransfers.map((t) => t.memo.toLowerCase())).size
  const uniqueFeePayers = new Set(fees.map((f) => f.payer.toLowerCase())).size
  // Sponsorship data removed for speed - would require individual tx lookups
  const sponsoredFeePayments = 0
  const sponsoredFeePaymentRate = 0

  const uniqueComplianceUpdaters = new Set(compliance.map((e) => e.updater.toLowerCase())).size
  const uniquePolicyIds = new Set(compliance.map((e) => e.policyId)).size
  const affected = new Set<string>()
  for (const e of compliance) {
    if (e.type === 'WhitelistUpdated') affected.add(e.account.toLowerCase())
    if (e.type === 'BlacklistUpdated') affected.add(e.account.toLowerCase())
  }

  const out: DashboardResponse = {
    windowSeconds,
    range: {
      fromBlock: range.fromBlock.toString(),
      toBlock: range.toBlock.toString(),
    },
    tokens: tokenlist.tokens,
    memoTransfers,
    fees,
    compliance,
    aggregates: {
      totalTransferCount,
      memoTransferCount: memoTransfers.length,
      memoTransferVolumeByToken: memoTransferVolumeByTokenFormatted,
      feePaidByToken: feePaidByTokenFormatted,
      complianceEventCount: compliance.length,
      uniqueMemos,
      uniqueFeePayers,
      sponsoredFeePayments,
      sponsoredFeePaymentRate,
      uniqueComplianceUpdaters,
      uniquePolicyIds,
      uniqueAffectedAddresses: affected.size,
    },
    feeAmm,
  }

  cacheSet(cacheKey, out, 2 * 60 * 1000)
  return out
}

export function normalizeMemoParam(memo: string): Hex {
  return parseBytes32Memo(memo)
}

// Separate endpoint for sponsorship calculation (slow - requires individual tx lookups)
export type SponsorshipData = {
  totalFeePayments: number
  sponsoredCount: number
  selfPaidCount: number
  unknownCount: number
  sponsorshipRate: number
}

export async function getSponsorshipData(windowSeconds: number): Promise<SponsorshipData> {
  const cacheKey = `sponsorship:${windowSeconds}`
  const cached = cacheGet<SponsorshipData>(cacheKey)
  if (cached) return cached

  const fees = await getFeePayments(windowSeconds)

  // Fetch transaction senders for sponsorship calculation
  const uniqueTxHashes = [...new Set(fees.map((f) => f.txHash))].slice(0, 100) // Limit to 100 tx lookups
  const senderByTx = new Map<string, Address>()

  // Batch fetch transactions
  await Promise.all(
    uniqueTxHashes.map(async (hash) => {
      try {
        const tx = await withRpcRetry(() => publicClient.getTransaction({ hash }))
        senderByTx.set(hash, tx.from)
      } catch {
        // ignore failed lookups
      }
    }),
  )

  let sponsoredCount = 0
  let selfPaidCount = 0
  let unknownCount = 0

  for (const fee of fees) {
    const sender = senderByTx.get(fee.txHash)
    if (!sender) {
      unknownCount++
      continue
    }
    const isSponsored = sender.toLowerCase() !== fee.payer.toLowerCase()
    if (isSponsored) {
      sponsoredCount++
    } else {
      selfPaidCount++
    }
  }

  const knownCount = sponsoredCount + selfPaidCount
  const sponsorshipRate = knownCount > 0 ? sponsoredCount / knownCount : 0

  const result: SponsorshipData = {
    totalFeePayments: fees.length,
    sponsoredCount,
    selfPaidCount,
    unknownCount,
    sponsorshipRate,
  }

  cacheSet(cacheKey, result, 2 * 60 * 1000)
  return result
}
