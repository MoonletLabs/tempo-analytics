import { useEffect, useState } from 'react'
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import {
  Activity,
  Coins,
  FileText,
  Hash,
  Send,
  Shield,
  Users,
  Wallet,
} from 'lucide-react'

import { formatTs, short, toNumber, formatDelta, formatDeltaPct, tokenIconUrl } from '@/lib/utils'
import { Header } from '@/components/layout/header'
import { Footer } from '@/components/layout/footer'
import { StatCard } from '@/components/stat-card'
import { ChartCard } from '@/components/chart-card'
import { TokenBadge } from '@/components/token-badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'

// Types
type Token = {
  address: string
  symbol: string
  name: string
  decimals: number
  logoURI?: string
}

type MemoTransfer = {
  token: Pick<Token, 'address' | 'symbol' | 'name' | 'logoURI'>
  from: string
  to: string
  amount: string
  memo: string
  txHash: string
  blockNumber: number
  timestamp: number
}

type FeePayment = {
  token: Pick<Token, 'address' | 'symbol' | 'name' | 'logoURI'>
  payer: string
  sender?: string
  sponsored?: boolean
  amount: string
  txHash: string
  blockNumber: number
  timestamp: number
}

type FeeAmmPool = {
  userToken: Pick<Token, 'address' | 'symbol' | 'name' | 'logoURI'>
  validatorToken: Pick<Token, 'address' | 'symbol' | 'name' | 'logoURI'>
  reserveUserToken: string
  reserveValidatorToken: string
}

type FeeAmmSummary = {
  pools: FeeAmmPool[]
  totalLiquidityByToken: Record<string, string>
}

type ComplianceEvent = {
  type: string
  policyId: string
  txHash: string
  blockNumber: number
  timestamp: number
} & Record<string, unknown>

type DashboardResponse = {
  windowSeconds: number
  range: { fromBlock: string; toBlock: string }
  tokens: Token[]
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

// Utility functions
function pickBucketSizeSeconds(windowSeconds: number): number {
  const targetPoints = 120
  const ideal = windowSeconds / targetPoints
  const options = [60, 300, 900, 3600, 21600, 86400]
  for (const s of options) {
    if (s >= ideal) return s
  }
  return 86400
}

function formatBucketLabel(windowSeconds: number, tsSeconds: number): string {
  const iso = new Date(tsSeconds * 1000).toISOString()
  if (windowSeconds <= 3600) return iso.slice(11, 16)
  if (windowSeconds <= 24 * 3600) return iso.slice(11, 13) + ':00'
  if (windowSeconds <= 14 * 24 * 3600) return iso.slice(5, 10) + ' ' + iso.slice(11, 13) + ':00'
  return iso.slice(5, 10)
}

function buildTokenBarData(map: Record<string, string>) {
  return Object.entries(map)
    .map(([token, value]) => ({ token, value: toNumber(value) }))
    .sort((a, b) => b.value - a.value)
}

function buildTopMemoData(transfers: MemoTransfer[]) {
  const byMemo = new Map<string, { memo: string; count: number; volume: number }>()
  for (const t of transfers) {
    const m = t.memo
    const cur = byMemo.get(m) ?? { memo: m, count: 0, volume: 0 }
    cur.count += 1
    cur.volume += toNumber(t.amount)
    byMemo.set(m, cur)
  }
  const all = [...byMemo.values()]
  const topByCount = [...all].sort((a, b) => b.count - a.count).slice(0, 12)
  const topByVolume = [...all].sort((a, b) => b.volume - a.volume).slice(0, 12)

  const hist = { '1': 0, '2-5': 0, '6-20': 0, '21+': 0 }
  for (const m of all) {
    if (m.count === 1) hist['1'] += 1
    else if (m.count <= 5) hist['2-5'] += 1
    else if (m.count <= 20) hist['6-20'] += 1
    else hist['21+'] += 1
  }
  const histogram = Object.entries(hist).map(([bucket, memos]) => ({ bucket, memos }))

  const sorted = [...all].sort((a, b) => b.count - a.count)
  const total = sorted.reduce((s, x) => s + x.count, 0)
  let cum = 0
  const concentration = sorted.slice(0, 20).map((x, idx) => {
    cum += x.count
    return { rank: idx + 1, cumulativeShare: total > 0 ? (cum / total) * 100 : 0 }
  })

  return { topByCount, topByVolume, histogram, concentration }
}

function buildTopFeePayers(fees: FeePayment[]) {
  const byPayer = new Map<string, { payer: string; total: number; count: number }>()
  for (const f of fees) {
    const p = f.payer
    const cur = byPayer.get(p) ?? { payer: p, total: 0, count: 0 }
    cur.total += toNumber(f.amount)
    cur.count += 1
    byPayer.set(p, cur)
  }
  const all = [...byPayer.values()].sort((a, b) => b.total - a.total)
  const total = all.reduce((s, x) => s + x.total, 0)
  const top10 = all.slice(0, 10).reduce((s, x) => s + x.total, 0)
  return {
    top: all.slice(0, 12),
    concentrationTop10: total > 0 ? (top10 / total) * 100 : 0,
  }
}

function buildTopCounterparties(transfers: MemoTransfer[]) {
  const bySender = new Map<string, { address: string; count: number; volume: number }>()
  const byReceiver = new Map<string, { address: string; count: number; volume: number }>()
  for (const t of transfers) {
    const amt = toNumber(t.amount)
    const s = bySender.get(t.from) ?? { address: t.from, count: 0, volume: 0 }
    s.count += 1
    s.volume += amt
    bySender.set(t.from, s)

    const r = byReceiver.get(t.to) ?? { address: t.to, count: 0, volume: 0 }
    r.count += 1
    r.volume += amt
    byReceiver.set(t.to, r)
  }

  const topSenders = [...bySender.values()].sort((a, b) => b.volume - a.volume).slice(0, 10)
  const topReceivers = [...byReceiver.values()].sort((a, b) => b.volume - a.volume).slice(0, 10)
  return { topSenders, topReceivers }
}

function buildTokenDominance(map: Record<string, string>) {
  const rows = Object.entries(map).map(([token, value]) => ({ token, value: toNumber(value) }))
  const total = rows.reduce((s, x) => s + x.value, 0)
  return rows
    .map((r) => ({ ...r, share: total > 0 ? (r.value / total) * 100 : 0 }))
    .sort((a, b) => b.value - a.value)
}

function bucketSumByToken(
  fees: FeePayment[],
  windowSeconds: number,
): Array<Record<string, number | string>> {
  const withTs = fees.filter((f) => f.timestamp > 0)
  if (!withTs.length) return []
  const maxTs = Math.max(...withTs.map((i) => i.timestamp))
  const minTs = maxTs - windowSeconds
  const bucketSize = pickBucketSizeSeconds(windowSeconds)
  const tokens = [...new Set(withTs.map((f) => f.token.symbol))]

  const buckets = new Map<number, Record<string, number>>()
  for (const f of withTs) {
    if (f.timestamp < minTs) continue
    const b = Math.floor((f.timestamp - minTs) / bucketSize)
    const row = buckets.get(b) ?? Object.fromEntries(tokens.map((t) => [t, 0]))
    row[f.token.symbol] = (row[f.token.symbol] ?? 0) + toNumber(f.amount)
    buckets.set(b, row)
  }

  const out: Array<Record<string, number | string>> = []
  const maxBucket = Math.floor(windowSeconds / bucketSize)
  for (let b = 0; b <= maxBucket; b++) {
    const ts = minTs + b * bucketSize
    const t = formatBucketLabel(windowSeconds, ts)
    const row = buckets.get(b) ?? Object.fromEntries(tokens.map((tk) => [tk, 0]))
    out.push({ t, ...row })
  }
  return out
}

function bucketComplianceByType(
  events: ComplianceEvent[],
  windowSeconds: number,
): Array<Record<string, number | string>> {
  const withTs = events.filter((e) => e.timestamp > 0)
  if (!withTs.length) return []
  const maxTs = Math.max(...withTs.map((i) => i.timestamp))
  const minTs = maxTs - windowSeconds
  const bucketSize = pickBucketSizeSeconds(windowSeconds)
  const types = ['PolicyCreated', 'PolicyAdminUpdated', 'WhitelistUpdated', 'BlacklistUpdated']

  const buckets = new Map<number, Record<string, number>>()
  for (const e of withTs) {
    if (e.timestamp < minTs) continue
    const b = Math.floor((e.timestamp - minTs) / bucketSize)
    const row = buckets.get(b) ?? Object.fromEntries(types.map((t) => [t, 0]))
    row[e.type] = (row[e.type] ?? 0) + 1
    buckets.set(b, row)
  }

  const out: Array<Record<string, number | string>> = []
  const maxBucket = Math.floor(windowSeconds / bucketSize)
  for (let b = 0; b <= maxBucket; b++) {
    const ts = minTs + b * bucketSize
    const t = formatBucketLabel(windowSeconds, ts)
    const row = buckets.get(b) ?? Object.fromEntries(types.map((x) => [x, 0]))
    out.push({ t, ...row })
  }
  return out
}

function buildTopUpdaters(events: ComplianceEvent[]) {
  const byUpdater = new Map<string, number>()
  const byPolicy = new Map<string, number>()
  for (const e of events) {
    const updater = (e.updater as string | undefined) ?? ''
    if (updater) byUpdater.set(updater, (byUpdater.get(updater) ?? 0) + 1)
    byPolicy.set(e.policyId, (byPolicy.get(e.policyId) ?? 0) + 1)
  }
  const topUpdaters = [...byUpdater.entries()]
    .map(([updater, count]) => ({ updater, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 12)
  const topPolicies = [...byPolicy.entries()]
    .map(([policyId, changes]) => ({ policyId, changes }))
    .sort((a, b) => b.changes - a.changes)
    .slice(0, 12)
  return { topUpdaters, topPolicies }
}

function bucketCounts(
  items: Array<{ timestamp: number }>,
  windowSeconds: number,
): Array<{ t: string; count: number }> {
  const withTs = items.filter((i) => i.timestamp > 0)
  if (!withTs.length) return []

  const maxTs = Math.max(...withTs.map((i) => i.timestamp))
  const minTs = maxTs - windowSeconds
  const bucketSize = pickBucketSizeSeconds(windowSeconds)

  const buckets = new Map<number, number>()
  for (const i of withTs) {
    const ts = i.timestamp
    if (ts < minTs) continue
    const b = Math.floor((ts - minTs) / bucketSize)
    buckets.set(b, (buckets.get(b) ?? 0) + 1)
  }

  const out: Array<{ t: string; count: number }> = []
  const maxBucket = Math.floor(windowSeconds / bucketSize)
  for (let b = 0; b <= maxBucket; b++) {
    const ts = minTs + b * bucketSize
    const t = formatBucketLabel(windowSeconds, ts)
    out.push({ t, count: buckets.get(b) ?? 0 })
  }
  return out
}

function usePagination(total: number, initialPageSize = 25) {
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState(initialPageSize)
  const pages = Math.max(1, Math.ceil(total / pageSize))

  useEffect(() => {
    if (page > pages - 1) setPage(pages - 1)
  }, [page, pages])

  return {
    page,
    pageSize,
    pages,
    setPage,
    setPageSize,
    start: page * pageSize,
    end: page * pageSize + pageSize,
  }
}

// Chart colors
const tokenColors: Record<string, string> = {
  pathUSD: '#3b82f6',
  alphaUSD: '#f59e0b',
  betaUSD: '#8b5cf6',
  thetaUSD: '#10b981',
}

const chartColors = {
  primary: '#3b82f6',
  secondary: '#8b5cf6',
  tertiary: '#10b981',
  quaternary: '#f59e0b',
  danger: '#ef4444',
}

// Custom Tooltip for recharts
function CustomTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ name: string; value: number; color?: string }>; label?: string }) {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded-xl border border-slate-200 bg-white/95 p-3 shadow-xl backdrop-blur dark:border-slate-700 dark:bg-slate-800/95">
      <p className="mb-2 text-xs font-medium text-slate-500 dark:text-slate-400">{label}</p>
      {payload.map((entry, i) => (
        <div key={i} className="flex items-center gap-2 text-sm">
          <span
            className="h-2 w-2 rounded-full"
            style={{ backgroundColor: entry.color || chartColors.primary }}
          />
          <span className="text-slate-600 dark:text-slate-300">{entry.name}:</span>
          <span className="font-medium text-slate-900 dark:text-white">
            {typeof entry.value === 'number' ? entry.value.toLocaleString() : entry.value}
          </span>
        </div>
      ))}
    </div>
  )
}

function TokenAxisTick({
  x,
  y,
  payload,
  tokenBySymbol,
}: {
  x?: number
  y?: number
  payload?: { value?: unknown }
  tokenBySymbol: Map<string, { address: string; symbol: string; logoURI?: string }>
}) {
  const sym = String(payload?.value ?? '')
  const token = tokenBySymbol.get(sym)
  const px = Number.isFinite(x) ? (x as number) : 0
  const py = Number.isFinite(y) ? (y as number) : 0

  if (!token) {
    return (
      <text x={px} y={py} dy={14} textAnchor="middle" fill="currentColor" fontSize={12} className="fill-slate-500 dark:fill-slate-400">
        {sym}
      </text>
    )
  }

  const href = tokenIconUrl(token)
  return (
    <g transform={`translate(${px},${py})`}>
      <image href={href} xlinkHref={href} x={-18} y={0} width={14} height={14} />
      <text x={0} y={12} textAnchor="start" fill="currentColor" fontSize={12} className="fill-slate-500 dark:fill-slate-400">
        {sym}
      </text>
    </g>
  )
}

function TokenLegend({
  payload,
  tokenBySymbol,
}: {
  payload?: Array<{ value?: string; color?: string }>
  tokenBySymbol: Map<string, { address: string; symbol: string; logoURI?: string }>
}) {
  const items = payload ?? []
  return (
    <div className="flex flex-wrap gap-3 pt-2">
      {items.map((it) => {
        const sym = it.value ?? ''
        const token = tokenBySymbol.get(sym)
        const href = token ? tokenIconUrl(token) : undefined
        return (
          <div key={sym} className="inline-flex items-center gap-2 text-xs">
            <span
              className="h-2.5 w-2.5 rounded-full"
              style={{ backgroundColor: it.color ?? chartColors.primary }}
            />
            {href && <img className="h-4 w-4 rounded-full" src={href} alt={sym} />}
            <span className="text-slate-600 dark:text-slate-400">{sym}</span>
          </div>
        )
      })}
    </div>
  )
}

export default function App() {
  const [activeTab, setActiveTab] = useState('analytics')
  const [memoQuery, setMemoQuery] = useState('')
  const [memoResults, setMemoResults] = useState<MemoTransfer[]>([])
  const [memoLoading, setMemoLoading] = useState(false)
  const [memoError, setMemoError] = useState<string | null>(null)
  const [data, setData] = useState<DashboardResponse | null>(null)
  const [prevData, setPrevData] = useState<DashboardResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/dashboard')
      if (!res.ok) throw new Error(`API error: ${res.status} ${res.statusText}`)
      const json = (await res.json()) as DashboardResponse
      setPrevData(data ?? prevData)
      setData(json)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  async function runMemoSearch(memoOverride?: string) {
    const query = memoOverride ?? memoQuery
    if (query.length !== 66) return
    if (memoOverride) setMemoQuery(query)
    setMemoLoading(true)
    setMemoError(null)
    try {
      const res = await fetch(`/api/memo/${query}`)
      if (!res.ok) throw new Error(`API error: ${res.status} ${res.statusText}`)
      const json = (await res.json()) as { transfers: MemoTransfer[] }
      setMemoResults(json.transfers ?? [])
    } catch (e) {
      setMemoError(e instanceof Error ? e.message : String(e))
    } finally {
      setMemoLoading(false)
    }
  }

  const memoStats = data ? buildTopMemoData(data.memoTransfers) : null
  const feePayerStats = data ? buildTopFeePayers(data.fees) : null
  const complianceStats = data ? buildTopUpdaters(data.compliance) : null
  const counterpartyStats = data ? buildTopCounterparties(data.memoTransfers) : null
  const tokenDominance = data ? buildTokenDominance(data.aggregates.memoTransferVolumeByToken) : []

  const feesSeries = data ? bucketSumByToken(data.fees, data.windowSeconds) : []
  const complianceSeries = data ? bucketComplianceByType(data.compliance, data.windowSeconds) : []

  const sponsorKnown = data ? data.fees.filter((f) => typeof f.sponsored === 'boolean').length : 0
  const sponsored = data ? data.fees.filter((f) => f.sponsored === true).length : 0
  const selfPaid = Math.max(0, sponsorKnown - sponsored)

  const feeAmmLiquidity = data ? buildTokenBarData(data.feeAmm.totalLiquidityByToken) : []

  const liquidityRows = data
    ? (data.tokens ?? []).map((t) => {
        const liquidity = toNumber(data.feeAmm.totalLiquidityByToken[t.symbol] ?? '0')
        const demand = toNumber(data.aggregates.feePaidByToken[t.symbol] ?? '0')
        return {
          token: t.symbol,
          liquidity,
          demand,
          low: demand > liquidity && (liquidity > 0 || demand > 0),
        }
      })
    : []

  const liquidityAlerts = liquidityRows.filter((x) => x.low)

  const tokenBySymbol = new Map(
    (data?.tokens ?? []).map((t) => [t.symbol, { address: t.address, symbol: t.symbol, logoURI: t.logoURI }]),
  )

  const memoPager = usePagination(data?.memoTransfers.length ?? 0, 25)
  const compliancePager = usePagination(data?.compliance.length ?? 0, 25)
  const poolsPager = usePagination(data?.feeAmm.pools.length ?? 0, 25)
  const memoSearchPager = usePagination(memoResults.length, 25)

  const deltas = data && prevData ? {
    totalTransfers: formatDelta(data.aggregates.totalTransferCount, prevData.aggregates.totalTransferCount),
    memoTransfers: formatDelta(data.aggregates.memoTransferCount, prevData.aggregates.memoTransferCount),
    feePayments: formatDelta(data.fees.length, prevData.fees.length),
    uniqueFeePayers: formatDelta(data.aggregates.uniqueFeePayers, prevData.aggregates.uniqueFeePayers),
    sponsoredRate: formatDeltaPct(
      data.aggregates.sponsoredFeePaymentRate * 100,
      prevData.aggregates.sponsoredFeePaymentRate * 100,
    ),
    complianceEvents: formatDelta(data.aggregates.complianceEventCount, prevData.aggregates.complianceEventCount),
  } : null

  return (
    <div className="flex min-h-screen flex-col font-sans antialiased">
      <Header activeTab={activeTab} onTabChange={setActiveTab} />

      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-8 sm:px-6 lg:px-8">
        {/* Hero Section */}
        <div className="mb-6">
          <h1 className="text-3xl font-bold tracking-tight text-slate-900 dark:text-white sm:text-4xl">
            Tempo Analytics Dashboard
          </h1>
          <p className="mt-1 text-slate-600 dark:text-slate-400">
            Real-time analytics for Tempo Network · Last hour
          </p>
        </div>

        {/* Error message */}
        {error && (
          <Card className="mb-6 border-rose-200 bg-rose-50 dark:border-rose-800 dark:bg-rose-900/20">
            <CardContent className="py-4">
              <span className="text-rose-700 dark:text-rose-400">{error}</span>
            </CardContent>
          </Card>
        )}

        {/* Memo Explorer Tab */}
        {activeTab === 'memo' && (
          <Card>
            <CardHeader>
              <CardTitle>Search by Memo</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex gap-3">
                <Input
              value={memoQuery}
              onChange={(e) => setMemoQuery(e.target.value)}
                  placeholder="Memo (bytes32 hex), e.g. 0x..."
                  className="flex-1"
                />
                <Button onClick={() => void runMemoSearch()} disabled={memoQuery.length !== 66 || memoLoading}>
                  {memoLoading ? 'Searching...' : 'Search'}
                </Button>
          </div>
              <p className="mt-2 text-sm text-slate-500">Memo must be 32-byte hex (0x + 64 hex).</p>

              {memoError && (
                <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 p-4 text-rose-700 dark:border-rose-800 dark:bg-rose-900/20 dark:text-rose-400">
                  {memoError}
                </div>
              )}

              {memoResults.length > 0 && (
                <div className="mt-6">
                  <div className="mb-4 flex items-center justify-between">
                    <span className="text-sm text-slate-500">{memoResults.length} results</span>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                disabled={memoSearchPager.page === 0}
                onClick={() => memoSearchPager.setPage(memoSearchPager.page - 1)}
              >
                        Previous
                      </Button>
                      <span className="text-sm font-medium">
                        {memoSearchPager.page + 1} / {memoSearchPager.pages}
                      </span>
                      <Button
                        variant="outline"
                        size="sm"
                disabled={memoSearchPager.page + 1 >= memoSearchPager.pages}
                onClick={() => memoSearchPager.setPage(memoSearchPager.page + 1)}
              >
                Next
                      </Button>
            </div>
          </div>
                  <div className="overflow-x-auto">
                    <table className="data-table">
            <thead>
              <tr>
                <th>Time</th>
                <th>Token</th>
                <th>Amount</th>
                <th>From</th>
                <th>To</th>
                <th>Memo</th>
                <th>Tx</th>
              </tr>
            </thead>
            <tbody>
              {memoResults.slice(memoSearchPager.start, memoSearchPager.end).map((t) => (
                <tr key={`${t.txHash}:${t.memo}`}>
                            <td className="font-mono text-xs">{formatTs(t.timestamp)}</td>
                            <td><TokenBadge token={t.token} size="sm" /></td>
                            <td className="font-mono">{t.amount}</td>
                            <td className="font-mono text-xs">{short(t.from)}</td>
                            <td className="font-mono text-xs">{short(t.to)}</td>
                            <td className="font-mono text-xs">{short(t.memo)}</td>
                            <td>
                              <a
                                href={`https://explore.tempo.xyz/tx/${t.txHash}`}
                                target="_blank"
                                rel="noreferrer"
                                className="font-mono text-xs text-primary-600 hover:underline dark:text-primary-400"
                              >
                      {short(t.txHash)}
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Analytics Tab - Loading Skeleton */}
        {loading && activeTab === 'analytics' && (
          <>
            {/* Stats Grid Skeleton */}
            <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {[...Array(8)].map((_, i) => (
                <Card key={i}>
                  <CardContent className="p-6">
                    <div className="flex items-center justify-between">
                      <div className="space-y-2">
                        <Skeleton className="h-4 w-24" />
                        <Skeleton className="h-8 w-16" />
            </div>
                      <Skeleton className="h-10 w-10 rounded-xl" />
            </div>
                  </CardContent>
                </Card>
              ))}
            </div>

            {/* Charts Skeleton */}
            <Card className="mb-8">
              <CardHeader>
                <Skeleton className="h-6 w-40" />
              </CardHeader>
              <CardContent>
                <Skeleton className="h-24 w-full" />
              </CardContent>
            </Card>

            <div className="grid gap-6 lg:grid-cols-2">
              {[...Array(4)].map((_, i) => (
                <Card key={i}>
                  <CardHeader>
                    <Skeleton className="h-5 w-48" />
                    <Skeleton className="h-4 w-32" />
                  </CardHeader>
                  <CardContent>
                    <Skeleton className="h-64 w-full" />
                  </CardContent>
                </Card>
              ))}
            </div>
          </>
        )}

        {/* Analytics Tab */}
        {data && !loading && activeTab === 'analytics' && (
          <>
            {/* Stats Grid */}
            <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <StatCard
                title="Total Transfers"
                value={data.aggregates.totalTransferCount.toLocaleString()}
                delta={deltas?.totalTransfers}
                deltaType={deltas?.totalTransfers?.startsWith('+') ? 'positive' : 'neutral'}
                icon={Send}
              />
              <StatCard
                title="Memo Transfers"
                value={data.aggregates.memoTransferCount.toLocaleString()}
                delta={deltas?.memoTransfers}
                deltaType={deltas?.memoTransfers?.startsWith('+') ? 'positive' : 'neutral'}
                icon={FileText}
              />
              <StatCard
                title="Unique Memos"
                value={data.aggregates.uniqueMemos.toLocaleString()}
                icon={Hash}
              />
              <StatCard
                title="Fee Payments"
                value={data.fees.length.toLocaleString()}
                delta={deltas?.feePayments}
                deltaType={deltas?.feePayments?.startsWith('+') ? 'positive' : 'neutral'}
                icon={Coins}
              />
              <StatCard
                title="Unique Fee Payers"
                value={data.aggregates.uniqueFeePayers.toLocaleString()}
                delta={deltas?.uniqueFeePayers}
                deltaType={deltas?.uniqueFeePayers?.startsWith('+') ? 'positive' : 'neutral'}
                icon={Users}
              />
              <StatCard
                title="Sponsored Fees"
                value={`${(data.aggregates.sponsoredFeePaymentRate * 100).toFixed(1)}%`}
                delta={deltas?.sponsoredRate}
                icon={Wallet}
              />
              <StatCard
                title="Compliance Events"
                value={data.aggregates.complianceEventCount.toLocaleString()}
                delta={deltas?.complianceEvents}
                deltaType={deltas?.complianceEvents?.startsWith('+') ? 'positive' : 'neutral'}
                icon={Shield}
              />
              <StatCard
                title="Block Range"
                value={`${data.range.fromBlock} - ${data.range.toBlock}`}
                icon={Activity}
              />
            </div>

            {/* Payments Funnel */}
            <Card className="mb-8">
              <CardHeader>
                <CardTitle>Payments Funnel</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="data-table">
              <thead>
                <tr>
                  <th>Stage</th>
                  <th>Count</th>
                  <th>Share</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                        <td className="font-medium">Total transfers</td>
                        <td className="font-mono">{data.aggregates.totalTransferCount.toLocaleString()}</td>
                        <td className="font-mono">100%</td>
                </tr>
                <tr>
                        <td className="font-medium">Memo transfers (coverage)</td>
                        <td className="font-mono">{data.aggregates.memoTransferCount.toLocaleString()}</td>
                        <td className="font-mono">
                    {data.aggregates.totalTransferCount > 0
                      ? ((data.aggregates.memoTransferCount / data.aggregates.totalTransferCount) * 100).toFixed(1)
                      : '0'}%
                  </td>
                </tr>
                <tr>
                        <td className="font-medium">Sponsored fee transfers</td>
                        <td className="font-mono">{data.aggregates.sponsoredFeePayments.toLocaleString()}</td>
                        <td className="font-mono">
                    {data.aggregates.memoTransferCount > 0
                      ? ((data.aggregates.sponsoredFeePayments / data.aggregates.memoTransferCount) * 100).toFixed(1)
                      : '0'}%
                  </td>
                </tr>
              </tbody>
            </table>
              </div>
              </CardContent>
            </Card>

            {/* Charts Grid */}
            <div className="grid gap-6 lg:grid-cols-2">
              <ChartCard title="Top Counterparties (Senders)" description="By memoed transfer volume">
                <div className="h-64">
                <ResponsiveContainer>
                  <BarChart
                    data={counterpartyStats?.topSenders.map((r) => ({
                      address: short(r.address),
                      addressFull: r.address,
                      volume: r.volume,
                    }))}
                    margin={{ top: 8, right: 10, bottom: 0, left: 0 }}
                  >
                      <CartesianGrid strokeDasharray="3 3" className="stroke-slate-200 dark:stroke-slate-700" />
                      <XAxis dataKey="address" tick={{ fontSize: 12 }} className="fill-slate-500 dark:fill-slate-400" />
                      <YAxis tick={{ fontSize: 12 }} className="fill-slate-500 dark:fill-slate-400" />
                      <Tooltip content={<CustomTooltip />} />
                      <Bar dataKey="volume" fill={chartColors.quaternary} radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              </ChartCard>

              <ChartCard title="Top Counterparties (Receivers)" description="By memoed transfer volume">
                <div className="h-64">
                <ResponsiveContainer>
                  <BarChart
                    data={counterpartyStats?.topReceivers.map((r) => ({
                      address: short(r.address),
                      addressFull: r.address,
                      volume: r.volume,
                    }))}
                    margin={{ top: 8, right: 10, bottom: 0, left: 0 }}
                  >
                      <CartesianGrid strokeDasharray="3 3" className="stroke-slate-200 dark:stroke-slate-700" />
                      <XAxis dataKey="address" tick={{ fontSize: 12 }} className="fill-slate-500 dark:fill-slate-400" />
                      <YAxis tick={{ fontSize: 12 }} className="fill-slate-500 dark:fill-slate-400" />
                      <Tooltip content={<CustomTooltip />} />
                      <Bar dataKey="volume" fill={chartColors.primary} radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              </ChartCard>

              <ChartCard title="Token Dominance (Memo Volume)" description="Share of memoed volume">
                <div className="h-64">
                <ResponsiveContainer>
                  <PieChart>
                      <Tooltip content={<CustomTooltip />} />
                    <Pie
                      data={tokenDominance}
                      dataKey="value"
                      nameKey="token"
                      innerRadius={55}
                      outerRadius={95}
                      paddingAngle={2}
                    >
                      {tokenDominance.map((e) => (
                          <Cell key={e.token} fill={tokenColors[e.token] ?? chartColors.primary} />
                      ))}
                    </Pie>
                    <Legend content={(p) => <TokenLegend tokenBySymbol={tokenBySymbol} payload={p.payload as any} />} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              </ChartCard>

              <ChartCard
                title="Fee Demand vs Pool Reserves"
                description="Fee AMM liquidity health"
                action={
                  liquidityAlerts.length > 0 && (
                    <div className="flex gap-2">
                  {liquidityAlerts.map((r) => (
                        <Badge key={r.token} variant="warning">{r.token} low liquidity</Badge>
                  ))}
                </div>
                  )
                }
              >
                <div className="h-64">
                <ResponsiveContainer>
                  <BarChart
                    data={liquidityRows.map((r) => ({
                      token: r.token,
                      demand: r.demand,
                      reserve: r.liquidity,
                    }))}
                    margin={{ top: 8, right: 10, bottom: 0, left: 0 }}
                  >
                      <CartesianGrid strokeDasharray="3 3" className="stroke-slate-200 dark:stroke-slate-700" />
                    <XAxis
                      dataKey="token"
                      tick={(p) => <TokenAxisTick {...(p as any)} tokenBySymbol={tokenBySymbol} />}
                    />
                      <YAxis tick={{ fontSize: 12 }} className="fill-slate-500 dark:fill-slate-400" />
                      <Tooltip content={<CustomTooltip />} />
                    <Legend />
                      <Bar dataKey="demand" fill={chartColors.danger} radius={[6, 6, 0, 0]} />
                      <Bar dataKey="reserve" fill={chartColors.tertiary} radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              </ChartCard>

              <ChartCard title="Activity Over Time" description="Bucketed from sampled events">
                <div className="h-64">
                <ResponsiveContainer>
                  <LineChart
                    data={(() => {
                      const memo = bucketCounts(data.memoTransfers, data.windowSeconds)
                      const fees = bucketCounts(data.fees, data.windowSeconds)
                      const comp = bucketCounts(data.compliance, data.windowSeconds)
                      const byT = new Map<string, { t: string; memos: number; fees: number; policies: number }>()
                        for (const row of memo) byT.set(row.t, { t: row.t, memos: row.count, fees: 0, policies: 0 })
                      for (const row of fees) {
                        const cur = byT.get(row.t) ?? { t: row.t, memos: 0, fees: 0, policies: 0 }
                        cur.fees = row.count
                        byT.set(row.t, cur)
                      }
                      for (const row of comp) {
                        const cur = byT.get(row.t) ?? { t: row.t, memos: 0, fees: 0, policies: 0 }
                        cur.policies = row.count
                        byT.set(row.t, cur)
                      }
                      return [...byT.values()]
                    })()}
                    margin={{ top: 8, right: 10, bottom: 0, left: 0 }}
                  >
                      <CartesianGrid strokeDasharray="3 3" className="stroke-slate-200 dark:stroke-slate-700" />
                      <XAxis dataKey="t" tick={{ fontSize: 12 }} className="fill-slate-500 dark:fill-slate-400" />
                      <YAxis tick={{ fontSize: 12 }} className="fill-slate-500 dark:fill-slate-400" />
                      <Tooltip content={<CustomTooltip />} />
                    <Legend />
                      <Line type="monotone" dataKey="memos" stroke={chartColors.quaternary} strokeWidth={2} dot={false} />
                      <Line type="monotone" dataKey="fees" stroke={chartColors.primary} strokeWidth={2} dot={false} />
                      <Line type="monotone" dataKey="policies" stroke={chartColors.secondary} strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
              </ChartCard>

              <ChartCard title="Fees Paid By Token" description="To FeeManager">
                <div className="h-64">
                <ResponsiveContainer>
                  <PieChart>
                      <Tooltip content={<CustomTooltip />} />
                    <Pie
                      data={buildTokenBarData(data.aggregates.feePaidByToken)}
                      dataKey="value"
                      nameKey="token"
                      innerRadius={55}
                      outerRadius={95}
                      paddingAngle={2}
                    >
                      {buildTokenBarData(data.aggregates.feePaidByToken).map((e) => (
                          <Cell key={e.token} fill={tokenColors[e.token] ?? chartColors.primary} />
                      ))}
                    </Pie>
                    <Legend content={(p) => <TokenLegend tokenBySymbol={tokenBySymbol} payload={p.payload as any} />} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              </ChartCard>

              <ChartCard title="Memo Transfer Volume By Token" description="Units in token decimals">
                <div className="h-64">
                <ResponsiveContainer>
                  <BarChart data={buildTokenBarData(data.aggregates.memoTransferVolumeByToken)}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-slate-200 dark:stroke-slate-700" />
                    <XAxis
                      dataKey="token"
                      tick={(p) => <TokenAxisTick {...(p as any)} tokenBySymbol={tokenBySymbol} />}
                    />
                      <YAxis tick={{ fontSize: 12 }} className="fill-slate-500 dark:fill-slate-400" />
                      <Tooltip content={<CustomTooltip />} />
                      <Bar dataKey="value" fill={chartColors.quaternary} radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              </ChartCard>

              <ChartCard title="Top Fee Payments (sample)" description={`Last ${Math.min(12, data.fees.length)} events`}>
                <div className="h-64">
                <ResponsiveContainer>
                  <BarChart
                    data={data.fees
                      .slice(0, 12)
                      .map((f) => ({ token: f.token.symbol, amount: toNumber(f.amount) }))
                      .reverse()}
                  >
                      <CartesianGrid strokeDasharray="3 3" className="stroke-slate-200 dark:stroke-slate-700" />
                    <XAxis
                      dataKey="token"
                      tick={(p) => <TokenAxisTick {...(p as any)} tokenBySymbol={tokenBySymbol} />}
                    />
                      <YAxis tick={{ fontSize: 12 }} className="fill-slate-500 dark:fill-slate-400" />
                      <Tooltip content={<CustomTooltip />} />
                      <Bar dataKey="amount" fill={chartColors.primary} radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              </ChartCard>

          {memoStats && feePayerStats && complianceStats && (
            <>
                  <ChartCard title="Top Memos By Count" description="Reconciliation identifiers">
                    <div className="h-64">
                    <ResponsiveContainer>
                      <BarChart
                        data={memoStats.topByCount.map((m) => ({
                          memo: short(m.memo),
                          memoFull: m.memo,
                          count: m.count,
                        }))}
                      >
                          <CartesianGrid strokeDasharray="3 3" className="stroke-slate-200 dark:stroke-slate-700" />
                          <XAxis dataKey="memo" tick={{ fontSize: 12 }} className="fill-slate-500 dark:fill-slate-400" />
                          <YAxis tick={{ fontSize: 12 }} className="fill-slate-500 dark:fill-slate-400" />
                          <Tooltip content={<CustomTooltip />} />
                          <Bar dataKey="count" fill={chartColors.quaternary} radius={[6, 6, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                  </ChartCard>

                  <ChartCard title="Memo Reuse Distribution" description="How many memos repeat">
                    <div className="h-64">
                    <ResponsiveContainer>
                      <BarChart data={memoStats.histogram}>
                          <CartesianGrid strokeDasharray="3 3" className="stroke-slate-200 dark:stroke-slate-700" />
                          <XAxis dataKey="bucket" tick={{ fontSize: 12 }} className="fill-slate-500 dark:fill-slate-400" />
                          <YAxis tick={{ fontSize: 12 }} className="fill-slate-500 dark:fill-slate-400" />
                          <Tooltip content={<CustomTooltip />} />
                          <Bar dataKey="memos" fill={chartColors.secondary} radius={[6, 6, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                  </ChartCard>

                  <ChartCard title="Memo Concentration (Pareto)" description="Cumulative share by top N memos">
                    <div className="h-64">
                    <ResponsiveContainer>
                      <LineChart data={memoStats.concentration} margin={{ top: 8, right: 10, bottom: 0, left: 0 }}>
                          <CartesianGrid strokeDasharray="3 3" className="stroke-slate-200 dark:stroke-slate-700" />
                          <XAxis dataKey="rank" tick={{ fontSize: 12 }} className="fill-slate-500 dark:fill-slate-400" />
                          <YAxis tick={{ fontSize: 12 }} domain={[0, 100]} className="fill-slate-500 dark:fill-slate-400" />
                          <Tooltip content={<CustomTooltip />} />
                          <Line type="monotone" dataKey="cumulativeShare" stroke={chartColors.tertiary} strokeWidth={2} dot={false} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                  </ChartCard>

                  <ChartCard
                    title="Top Fee Payers"
                    description={`Top10 concentration ${feePayerStats.concentrationTop10.toFixed(1)}%`}
                  >
                    <div className="h-64">
                    <ResponsiveContainer>
                      <BarChart
                        data={feePayerStats.top.map((p) => ({
                          payer: short(p.payer),
                          payerFull: p.payer,
                          total: p.total,
                        }))}
                      >
                          <CartesianGrid strokeDasharray="3 3" className="stroke-slate-200 dark:stroke-slate-700" />
                          <XAxis dataKey="payer" tick={{ fontSize: 12 }} className="fill-slate-500 dark:fill-slate-400" />
                          <YAxis tick={{ fontSize: 12 }} className="fill-slate-500 dark:fill-slate-400" />
                          <Tooltip content={<CustomTooltip />} />
                          <Bar dataKey="total" fill={chartColors.primary} radius={[6, 6, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                  </ChartCard>

                  <ChartCard title="Fees Over Time (By Token)" description="Stacked · sampled from fee transfers">
                    <div className="h-64">
                    <ResponsiveContainer>
                  <AreaChart data={feesSeries} margin={{ top: 8, right: 10, bottom: 0, left: 0 }}>
                          <CartesianGrid strokeDasharray="3 3" className="stroke-slate-200 dark:stroke-slate-700" />
                          <XAxis dataKey="t" tick={{ fontSize: 12 }} className="fill-slate-500 dark:fill-slate-400" />
                          <YAxis tick={{ fontSize: 12 }} className="fill-slate-500 dark:fill-slate-400" />
                          <Tooltip content={<CustomTooltip />} />
                    <Legend content={(p) => <TokenLegend tokenBySymbol={tokenBySymbol} payload={p.payload as any} />} />
                    {Object.keys(data.aggregates.feePaidByToken).map((sym) => (
                      <Area
                            key={sym}
                            type="monotone"
                            dataKey={sym}
                            stackId="1"
                              stroke={tokenColors[sym] ?? chartColors.primary}
                              fill={tokenColors[sym] ?? chartColors.primary}
                              fillOpacity={0.3}
                            strokeWidth={2}
                          />
                        ))}
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                  </ChartCard>

                  <ChartCard title="Sponsorship Split" description="Fee payer != tx sender">
                    <div className="h-64">
                    <ResponsiveContainer>
                  <PieChart>
                          <Tooltip content={<CustomTooltip />} />
                    <Pie
                      data={[
                        { name: 'Sponsored', value: sponsored },
                        { name: 'Self-paid', value: selfPaid },
                      ]}
                          dataKey="value"
                          nameKey="name"
                          innerRadius={55}
                          outerRadius={95}
                          paddingAngle={2}
                          >
                            <Cell fill={chartColors.primary} />
                            <Cell fill={chartColors.secondary} />
                          </Pie>
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              </div>
                  </ChartCard>

                  <ChartCard title="Compliance Events Over Time" description="TIP-403 registry activity">
                    <div className="h-64">
                    <ResponsiveContainer>
                      <BarChart data={complianceSeries} margin={{ top: 8, right: 10, bottom: 0, left: 0 }}>
                          <CartesianGrid strokeDasharray="3 3" className="stroke-slate-200 dark:stroke-slate-700" />
                          <XAxis dataKey="t" tick={{ fontSize: 12 }} className="fill-slate-500 dark:fill-slate-400" />
                          <YAxis tick={{ fontSize: 12 }} className="fill-slate-500 dark:fill-slate-400" />
                          <Tooltip content={<CustomTooltip />} />
                        <Legend />
                          <Bar dataKey="WhitelistUpdated" stackId="1" fill={chartColors.tertiary} />
                          <Bar dataKey="BlacklistUpdated" stackId="1" fill={chartColors.danger} />
                          <Bar dataKey="PolicyAdminUpdated" stackId="1" fill={chartColors.secondary} />
                          <Bar dataKey="PolicyCreated" stackId="1" fill={chartColors.quaternary} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                  </ChartCard>

                  <ChartCard title="Top Compliance Updaters" description="Who changes policies most">
                    <div className="h-64">
                    <ResponsiveContainer>
                      <BarChart
                        data={complianceStats.topUpdaters.map((u) => ({
                          updater: short(u.updater),
                          updaterFull: u.updater,
                          count: u.count,
                        }))}
                      >
                          <CartesianGrid strokeDasharray="3 3" className="stroke-slate-200 dark:stroke-slate-700" />
                          <XAxis dataKey="updater" tick={{ fontSize: 12 }} className="fill-slate-500 dark:fill-slate-400" />
                          <YAxis tick={{ fontSize: 12 }} className="fill-slate-500 dark:fill-slate-400" />
                          <Tooltip content={<CustomTooltip />} />
                          <Bar dataKey="count" fill={chartColors.secondary} radius={[6, 6, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                  </ChartCard>

                  <ChartCard title="Most Changed Policies" description="Policy ID churn">
                    <div className="h-64">
                    <ResponsiveContainer>
                      <BarChart data={complianceStats.topPolicies}>
                          <CartesianGrid strokeDasharray="3 3" className="stroke-slate-200 dark:stroke-slate-700" />
                          <XAxis dataKey="policyId" tick={{ fontSize: 12 }} className="fill-slate-500 dark:fill-slate-400" />
                          <YAxis tick={{ fontSize: 12 }} className="fill-slate-500 dark:fill-slate-400" />
                          <Tooltip content={<CustomTooltip />} />
                          <Bar dataKey="changes" fill={chartColors.danger} radius={[6, 6, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                  </ChartCard>

                  <ChartCard title="Fee AMM Total Liquidity" description="Sum of pool reserves by token">
                    <div className="h-64">
                    <ResponsiveContainer>
                      <BarChart data={feeAmmLiquidity}>
                          <CartesianGrid strokeDasharray="3 3" className="stroke-slate-200 dark:stroke-slate-700" />
                        <XAxis
                          dataKey="token"
                          tick={(p) => <TokenAxisTick {...(p as any)} tokenBySymbol={tokenBySymbol} />}
                        />
                          <YAxis tick={{ fontSize: 12 }} className="fill-slate-500 dark:fill-slate-400" />
                          <Tooltip content={<CustomTooltip />} />
                          <Bar dataKey="value" fill={chartColors.tertiary} radius={[6, 6, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                  </ChartCard>
            </>
          )}
                </div>
            </>
          )}

        {/* Data Explorer Tab - Loading Skeleton */}
        {loading && activeTab === 'tables' && (
          <div className="space-y-6">
            <Card>
              <CardHeader>
                <Skeleton className="h-6 w-48" />
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-3">
                  {[...Array(4)].map((_, i) => (
                    <Skeleton key={i} className="h-10 w-32" />
                  ))}
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <Skeleton className="h-6 w-48" />
              </CardHeader>
              <CardContent>
                <Skeleton className="h-64 w-full" />
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <Skeleton className="h-6 w-40" />
              </CardHeader>
              <CardContent>
                <Skeleton className="h-64 w-full" />
              </CardContent>
            </Card>
          </div>
        )}

        {/* Data Explorer Tab */}
        {data && !loading && activeTab === 'tables' && (
          <div className="space-y-6">
            {/* Fee Paid Summary */}
            <Card>
              <CardHeader>
                <CardTitle>Fee Paid (to FeeManager)</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-3">
              {Object.entries(data.aggregates.feePaidByToken).map(([sym, amt]) => {
                const token = data.tokens.find((t) => t.symbol === sym)
                return (
                      <Badge key={sym} variant="secondary" className="gap-2 px-3 py-2 text-sm">
                        {token && <TokenBadge token={token} size="sm" />}
                        <span className="font-mono">{amt}</span>
                      </Badge>
                )
              })}
            </div>
              </CardContent>
            </Card>

            {/* Recent Memo Transfers */}
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle>Recent Memo Transfers</CardTitle>
                <div className="flex items-center gap-2">
                  <span className="text-sm text-slate-500">{data.memoTransfers.length} rows</span>
                  <Button variant="outline" size="sm" onClick={() => setActiveTab('memo')}>
                  Open Memo Explorer
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                <div className="mb-4 flex items-center justify-end gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={memoPager.page === 0}
                    onClick={() => memoPager.setPage(memoPager.page - 1)}
                  >
                    Previous
                  </Button>
                  <span className="text-sm font-medium">
                    {memoPager.page + 1} / {memoPager.pages}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                  disabled={memoPager.page + 1 >= memoPager.pages}
                  onClick={() => memoPager.setPage(memoPager.page + 1)}
                >
                  Next
                  </Button>
              </div>
                <div className="overflow-x-auto">
                  <table className="data-table">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Token</th>
                  <th>Amount</th>
                  <th>From</th>
                  <th>To</th>
                  <th>Memo</th>
                  <th>Tx</th>
                </tr>
              </thead>
              <tbody>
                {data.memoTransfers.slice(memoPager.start, memoPager.end).map((t) => (
                  <tr
                    key={`${t.txHash}:${t.memo}`}
                          className="cursor-pointer"
                    onClick={() => {
                            setActiveTab('memo')
                      void runMemoSearch(t.memo)
                    }}
                  >
                          <td className="font-mono text-xs">{formatTs(t.timestamp)}</td>
                          <td><TokenBadge token={t.token} size="sm" /></td>
                          <td className="font-mono">{t.amount}</td>
                          <td className="font-mono text-xs">{short(t.from)}</td>
                          <td className="font-mono text-xs">{short(t.to)}</td>
                          <td className="font-mono text-xs">{short(t.memo)}</td>
                          <td>
                            <a
                              href={`https://explore.tempo.xyz/tx/${t.txHash}`}
                              target="_blank"
                              rel="noreferrer"
                              className="font-mono text-xs text-primary-600 hover:underline dark:text-primary-400"
                              onClick={(e) => e.stopPropagation()}
                            >
                        {short(t.txHash)}
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
                </div>
              </CardContent>
            </Card>

            {/* Recent Compliance Events */}
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle>Recent Compliance Events (TIP-403)</CardTitle>
                <span className="text-sm text-slate-500">{data.compliance.length} rows</span>
              </CardHeader>
              <CardContent>
                <div className="mb-4 flex items-center justify-end gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={compliancePager.page === 0}
                    onClick={() => compliancePager.setPage(compliancePager.page - 1)}
                  >
                    Previous
                  </Button>
                  <span className="text-sm font-medium">
                    {compliancePager.page + 1} / {compliancePager.pages}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                  disabled={compliancePager.page + 1 >= compliancePager.pages}
                  onClick={() => compliancePager.setPage(compliancePager.page + 1)}
                >
                  Next
                  </Button>
              </div>
                <div className="overflow-x-auto">
                  <table className="data-table">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Type</th>
                  <th>Policy</th>
                  <th>Tx</th>
                </tr>
              </thead>
              <tbody>
                {data.compliance.slice(compliancePager.start, compliancePager.end).map((e) => (
                  <tr key={`${e.txHash}:${e.type}:${e.policyId}`}>
                          <td className="font-mono text-xs">{formatTs(e.timestamp)}</td>
                          <td>
                            <Badge
                              variant={
                                e.type === 'WhitelistUpdated' ? 'success' :
                                e.type === 'BlacklistUpdated' ? 'danger' :
                                'secondary'
                              }
                            >
                              {e.type}
                            </Badge>
                          </td>
                          <td className="font-mono text-xs">{e.policyId}</td>
                          <td>
                            <a
                              href={`https://explore.tempo.xyz/tx/${e.txHash}`}
                              target="_blank"
                              rel="noreferrer"
                              className="font-mono text-xs text-primary-600 hover:underline dark:text-primary-400"
                            >
                        {short(e.txHash)}
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
                </div>
              </CardContent>
            </Card>

            {/* Fee AMM Pools */}
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle>Fee AMM Pools</CardTitle>
                <span className="text-sm text-slate-500">{data.feeAmm.pools.length} pools</span>
              </CardHeader>
              <CardContent>
                <div className="mb-4 flex items-center justify-end gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={poolsPager.page === 0}
                    onClick={() => poolsPager.setPage(poolsPager.page - 1)}
                  >
                    Previous
                  </Button>
                  <span className="text-sm font-medium">
                    {poolsPager.page + 1} / {poolsPager.pages}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                  disabled={poolsPager.page + 1 >= poolsPager.pages}
                  onClick={() => poolsPager.setPage(poolsPager.page + 1)}
                >
                  Next
                  </Button>
              </div>
                <div className="overflow-x-auto">
                  <table className="data-table">
              <thead>
                <tr>
                  <th>User Token</th>
                  <th>Validator Token</th>
                  <th>User Reserve</th>
                  <th>Validator Reserve</th>
                </tr>
              </thead>
              <tbody>
                {data.feeAmm.pools.slice(poolsPager.start, poolsPager.end).map((p, idx) => (
                  <tr key={`${p.userToken.symbol}:${p.validatorToken.symbol}:${idx}`}>
                          <td><TokenBadge token={p.userToken} /></td>
                          <td><TokenBadge token={p.validatorToken} /></td>
                          <td className="font-mono">{p.reserveUserToken}</td>
                          <td className="font-mono">{p.reserveValidatorToken}</td>
                  </tr>
                ))}
              </tbody>
            </table>
                </div>
              </CardContent>
            </Card>
          </div>
        )}
      </main>

      <Footer />
    </div>
  )
}
