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

import './App.css'

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

function formatTs(ts: number) {
  if (!ts) return '-'
  return new Date(ts * 1000).toISOString().replace('T', ' ').slice(0, 19)
}

function short(s: string) {
  if (!s) return ''
  return `${s.slice(0, 6)}…${s.slice(-4)}`
}

function tokenIconUrl(token: { address: string; logoURI?: string }): string {
  // Local icons are served from /public/token-icons
  return `/token-icons/${token.address.toLowerCase()}.svg`
}

function TokenBadge({ token }: { token: { address: string; symbol: string; logoURI?: string } }) {
  return (
    <span className="tokenBadge">
      <img
        className="tokenIcon"
        src={tokenIconUrl(token)}
        alt=""
        onError={(e) => {
          if (!token.logoURI) return
          const img = e.currentTarget
          if (img.dataset.fallback === '1') return
          img.dataset.fallback = '1'
          img.src = token.logoURI
        }}
      />
      <span aria-label={token.symbol}>{token.symbol}</span>
    </span>
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
      <text x={px} y={py} dy={14} textAnchor="middle" fill="rgba(255,255,255,0.55)" fontSize={12}>
        {sym}
      </text>
    )
  }

  const href = tokenIconUrl(token)
  return (
    <g transform={`translate(${px},${py})`}>
      <image href={href} xlinkHref={href} x={-18} y={0} width={14} height={14} />
      <text x={0} y={12} textAnchor="start" fill="rgba(255,255,255,0.55)" fontSize={12}>
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
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 6 }}>
      {items.map((it) => {
        const sym = it.value ?? ''
        const token = tokenBySymbol.get(sym)
        const href = token ? tokenIconUrl(token) : undefined
        return (
          <div key={sym} style={{ display: 'inline-flex', gap: 8, alignItems: 'center', fontSize: 12 }}>
            <span
              style={{
                width: 10,
                height: 10,
                borderRadius: 999,
                background: it.color ?? 'rgba(255,255,255,0.5)',
                display: 'inline-block',
              }}
            />
            {href ? <img className="tokenIcon" src={href} alt={sym} /> : null}
            <span style={{ color: 'rgba(255,255,255,0.72)' }}>{sym}</span>
          </div>
        )
      })}
    </div>
  )
}

function toNumber(v: string): number {
  const n = Number.parseFloat(v)
  return Number.isFinite(n) ? n : 0
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

  // Histogram of reuse
  const hist = {
    '1': 0,
    '2-5': 0,
    '6-20': 0,
    '21+': 0,
  }
  for (const m of all) {
    if (m.count === 1) hist['1'] += 1
    else if (m.count <= 5) hist['2-5'] += 1
    else if (m.count <= 20) hist['6-20'] += 1
    else hist['21+'] += 1
  }
  const histogram = Object.entries(hist).map(([bucket, memos]) => ({ bucket, memos }))

  // Concentration curve (Pareto) by count
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

function bucketSumByToken(
  fees: FeePayment[],
  windowSeconds: number,
): Array<Record<string, number | string>> {
  const withTs = fees.filter((f) => f.timestamp > 0)
  if (!withTs.length) return []
  const maxTs = Math.max(...withTs.map((i) => i.timestamp))
  const minTs = maxTs - windowSeconds
  const bucketSize = windowSeconds <= 3600 ? 300 : windowSeconds <= 6 * 3600 ? 900 : 3600
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
    const date = new Date(ts * 1000)
    const t = windowSeconds <= 3600 ? date.toISOString().slice(11, 16) : date.toISOString().slice(11, 13) + ':00'
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
  const bucketSize = windowSeconds <= 3600 ? 300 : windowSeconds <= 6 * 3600 ? 900 : 3600
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
    const date = new Date(ts * 1000)
    const t = windowSeconds <= 3600 ? date.toISOString().slice(11, 16) : date.toISOString().slice(11, 13) + ':00'
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

  const bucketSize =
    windowSeconds <= 3600
      ? 300
      : windowSeconds <= 6 * 3600
        ? 900
        : 3600

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
    const date = new Date(ts * 1000)
    const t =
      windowSeconds <= 3600
        ? date.toISOString().slice(11, 16)
        : date.toISOString().slice(11, 13) + ':00'
    out.push({ t, count: buckets.get(b) ?? 0 })
  }
  return out
}

function App() {
  const [window, setWindow] = useState<'1h' | '6h' | '24h'>('1h')
  const [memoQuery, setMemoQuery] = useState('')
  const [data, setData] = useState<DashboardResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showingCached, setShowingCached] = useState(false)

  async function load() {
    const cacheKey = `tempoDashboard:${window}`
    try {
      const cachedRaw = localStorage.getItem(cacheKey)
      if (cachedRaw) {
        const cached = JSON.parse(cachedRaw) as DashboardResponse
        setData(cached)
        setShowingCached(true)
        setLoading(false)
      } else {
        setShowingCached(false)
        setLoading(true)
      }
    } catch {
      setShowingCached(false)
      setLoading(true)
    }

    setError(null)
    try {
      const res = await fetch(`/api/dashboard?window=${window}`)
      if (!res.ok) throw new Error(`API error: ${res.status} ${res.statusText}`)
      const json = (await res.json()) as DashboardResponse
      setData(json)
      setShowingCached(false)
      try {
        localStorage.setItem(cacheKey, JSON.stringify(json))
      } catch {
        // ignore
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [window])

  const memoStats = data ? buildTopMemoData(data.memoTransfers) : null
  const feePayerStats = data ? buildTopFeePayers(data.fees) : null
  const complianceStats = data ? buildTopUpdaters(data.compliance) : null

  const feesSeries = data ? bucketSumByToken(data.fees, data.windowSeconds) : []
  const complianceSeries = data ? bucketComplianceByType(data.compliance, data.windowSeconds) : []

  const sponsorKnown = data ? data.fees.filter((f) => typeof f.sponsored === 'boolean').length : 0
  const sponsored = data ? data.fees.filter((f) => f.sponsored === true).length : 0
  const selfPaid = Math.max(0, sponsorKnown - sponsored)

  const feeAmmLiquidity = data ? buildTokenBarData(data.feeAmm.totalLiquidityByToken) : []

  const tokenBySymbol = new Map(
    (data?.tokens ?? []).map((t) => [t.symbol, { address: t.address, symbol: t.symbol, logoURI: t.logoURI }]),
  )

  const tokenColors: Record<string, string> = {
    pathUSD: '#67e8f9',
    alphaUSD: '#fbbf24',
    betaUSD: '#c4b5fd',
    thetaUSD: '#34d399',
  }

  const tooltipCommon = {
    contentStyle: {
      background: 'rgba(10, 14, 20, 0.96)',
      border: '1px solid rgba(255,255,255,0.16)',
      borderRadius: 10,
      boxShadow: '0 18px 45px rgba(0,0,0,0.55)',
    },
    labelStyle: { color: 'rgba(255,255,255,0.9)' },
    itemStyle: { color: 'rgba(255,255,255,0.9)' },
    cursor: { fill: 'rgba(255,255,255,0.06)' },
  } as const

  return (
    <div className="shell">
      <header className="header">
        <div>
          <div className="title">Tempo Analytics</div>
          <div className="subtitle">
            Testnet (Moderato) · chainId 42431 · public RPC
          </div>
        </div>

        <div className="controls">
          <select value={window} onChange={(e) => setWindow(e.target.value as '1h' | '6h' | '24h')}>
            <option value="1h">1h</option>
            <option value="6h">6h</option>
            <option value="24h">24h</option>
          </select>
          <button onClick={() => void load()} disabled={loading}>
            Refresh
          </button>
        </div>
      </header>

      <section className="card">
        <div className="row">
          <input
            value={memoQuery}
            onChange={(e) => setMemoQuery(e.target.value)}
            placeholder="Memo (bytes32 hex), e.g. 0x…"
          />
          <a
            className={`btn ${memoQuery.length !== 66 ? 'disabled' : ''}`}
            href={memoQuery.length === 66 ? `/api/memo/${memoQuery}?window=${window}` : undefined}
            target="_blank"
            rel="noreferrer"
          >
            Query Memo API
          </a>
        </div>
        <div className="hint">
          Tip: memo must be a 32-byte hex string (0x + 64 hex). Public RPC is rate limited; analytics scans are capped by block count.
        </div>
      </section>

      {loading && <div className="muted">Loading…</div>}
      {!loading && showingCached && <div className="muted">Showing cached data; refreshing…</div>}
      {error && <div className="error">{error}</div>}

      {data && (
        <>
          <section className="grid">
            <div className="stat">
              <div className="k">Memo transfers</div>
              <div className="v">{data.aggregates.memoTransferCount}</div>
            </div>
            <div className="stat">
              <div className="k">Unique memos</div>
              <div className="v">{data.aggregates.uniqueMemos}</div>
            </div>
            <div className="stat">
              <div className="k">Fee payments</div>
              <div className="v">{data.fees.length}</div>
            </div>
            <div className="stat">
              <div className="k">Unique fee payers</div>
              <div className="v">{data.aggregates.uniqueFeePayers}</div>
            </div>
            <div className="stat">
              <div className="k">Sponsored fee payments</div>
              <div className="v">{(data.aggregates.sponsoredFeePaymentRate * 100).toFixed(1)}%</div>
            </div>
            <div className="stat">
              <div className="k">Compliance events</div>
              <div className="v">{data.aggregates.complianceEventCount}</div>
            </div>
            <div className="stat">
              <div className="k">Affected addresses</div>
              <div className="v">{data.aggregates.uniqueAffectedAddresses}</div>
            </div>
            <div className="stat">
              <div className="k">Block range</div>
              <div className="v">
                {data.range.fromBlock}–{data.range.toBlock}
              </div>
            </div>
          </section>

          <section className="charts">
            <div className="chartCard">
              <div className="chartTitle">
                <div className="label">Activity Over Time</div>
                <div className="meta">bucketed from sampled events</div>
              </div>
              <div style={{ width: '100%', height: 260 }}>
                <ResponsiveContainer>
                  <LineChart
                    data={(() => {
                      const memo = bucketCounts(data.memoTransfers, data.windowSeconds)
                      const fees = bucketCounts(data.fees, data.windowSeconds)
                      const comp = bucketCounts(data.compliance, data.windowSeconds)
                      const byT = new Map<string, { t: string; memos: number; fees: number; policies: number }>()
                      for (const row of memo) {
                        byT.set(row.t, { t: row.t, memos: row.count, fees: 0, policies: 0 })
                      }
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
                    <CartesianGrid stroke="rgba(255,255,255,0.08)" strokeDasharray="3 3" />
                    <XAxis dataKey="t" stroke="rgba(255,255,255,0.55)" tick={{ fontSize: 12 }} />
                    <YAxis stroke="rgba(255,255,255,0.55)" tick={{ fontSize: 12 }} />
                    <Tooltip
                      {...tooltipCommon}
                    />
                    <Legend />
                    <Line type="monotone" dataKey="memos" stroke="#fbbf24" strokeWidth={2} dot={false} />
                    <Line type="monotone" dataKey="fees" stroke="#67e8f9" strokeWidth={2} dot={false} />
                    <Line type="monotone" dataKey="policies" stroke="#c4b5fd" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="chartCard">
              <div className="chartTitle">
                <div className="label">Fees Paid By Token</div>
                <div className="meta">to FeeManager</div>
              </div>
              <div style={{ width: '100%', height: 260 }}>
                <ResponsiveContainer>
                  <PieChart>
                    <Tooltip
                      {...tooltipCommon}
                    />
                    <Pie
                      data={buildTokenBarData(data.aggregates.feePaidByToken)}
                      dataKey="value"
                      nameKey="token"
                      innerRadius={55}
                      outerRadius={95}
                      paddingAngle={2}
                    >
                      {buildTokenBarData(data.aggregates.feePaidByToken).map((e) => (
                        <Cell key={e.token} fill={tokenColors[e.token] ?? '#67e8f9'} />
                      ))}
                    </Pie>
                    <Legend content={(p) => <TokenLegend tokenBySymbol={tokenBySymbol} payload={p.payload as any} />} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </div>
          </section>

          <section className="charts">
            <div className="chartCard">
              <div className="chartTitle">
                <div className="label">Memo Transfer Volume By Token</div>
                <div className="meta">units in token decimals</div>
              </div>
              <div style={{ width: '100%', height: 260 }}>
                <ResponsiveContainer>
                  <BarChart data={buildTokenBarData(data.aggregates.memoTransferVolumeByToken)}>
                    <CartesianGrid stroke="rgba(255,255,255,0.08)" strokeDasharray="3 3" />
                    <XAxis
                      dataKey="token"
                      stroke="rgba(255,255,255,0.55)"
                      tick={(p) => <TokenAxisTick {...(p as any)} tokenBySymbol={tokenBySymbol} />}
                    />
                    <YAxis stroke="rgba(255,255,255,0.55)" tick={{ fontSize: 12 }} />
                    <Tooltip
                      {...tooltipCommon}
                    />
                    <Bar dataKey="value" fill="#fbbf24" radius={[8, 8, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="chartCard">
              <div className="chartTitle">
                <div className="label">Top Fee Payments (sample)</div>
                <div className="meta">last {Math.min(12, data.fees.length)} events</div>
              </div>
              <div style={{ width: '100%', height: 260 }}>
                <ResponsiveContainer>
                  <BarChart
                    data={data.fees
                      .slice(0, 12)
                      .map((f) => ({ token: f.token.symbol, amount: toNumber(f.amount) }))
                      .reverse()}
                  >
                    <CartesianGrid stroke="rgba(255,255,255,0.08)" strokeDasharray="3 3" />
                    <XAxis
                      dataKey="token"
                      stroke="rgba(255,255,255,0.55)"
                      tick={(p) => <TokenAxisTick {...(p as any)} tokenBySymbol={tokenBySymbol} />}
                    />
                    <YAxis stroke="rgba(255,255,255,0.55)" tick={{ fontSize: 12 }} />
                    <Tooltip
                      {...tooltipCommon}
                    />
                    <Bar dataKey="amount" fill="#67e8f9" radius={[8, 8, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </section>

          {memoStats && feePayerStats && complianceStats && (
            <>
              <section className="charts">
                <div className="chartCard">
                  <div className="chartTitle">
                    <div className="label">Top Memos By Count</div>
                    <div className="meta">reconciliation identifiers</div>
                  </div>
                  <div style={{ width: '100%', height: 260 }}>
                    <ResponsiveContainer>
                      <BarChart
                        data={memoStats.topByCount.map((m) => ({
                          memo: short(m.memo),
                          memoFull: m.memo,
                          count: m.count,
                        }))}
                      >
                        <CartesianGrid stroke="rgba(255,255,255,0.08)" strokeDasharray="3 3" />
                        <XAxis dataKey="memo" stroke="rgba(255,255,255,0.55)" tick={{ fontSize: 12 }} />
                        <YAxis stroke="rgba(255,255,255,0.55)" tick={{ fontSize: 12 }} />
                        <Tooltip
                          formatter={(value, _name, props) => [value, (props.payload as any).memoFull]}
                          {...tooltipCommon}
                        />
                        <Bar dataKey="count" fill="#fbbf24" radius={[8, 8, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                <div className="chartCard">
                  <div className="chartTitle">
                    <div className="label">Memo Reuse Distribution</div>
                    <div className="meta">how many memos repeat</div>
                  </div>
                  <div style={{ width: '100%', height: 260 }}>
                    <ResponsiveContainer>
                      <BarChart data={memoStats.histogram}>
                        <CartesianGrid stroke="rgba(255,255,255,0.08)" strokeDasharray="3 3" />
                        <XAxis dataKey="bucket" stroke="rgba(255,255,255,0.55)" tick={{ fontSize: 12 }} />
                        <YAxis stroke="rgba(255,255,255,0.55)" tick={{ fontSize: 12 }} />
                        <Tooltip
                          {...tooltipCommon}
                        />
                        <Bar dataKey="memos" fill="#c4b5fd" radius={[8, 8, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </section>

              <section className="charts">
                <div className="chartCard">
                  <div className="chartTitle">
                    <div className="label">Memo Concentration (Pareto)</div>
                    <div className="meta">cumulative share by top N memos</div>
                  </div>
                  <div style={{ width: '100%', height: 260 }}>
                    <ResponsiveContainer>
                      <LineChart data={memoStats.concentration} margin={{ top: 8, right: 10, bottom: 0, left: 0 }}>
                        <CartesianGrid stroke="rgba(255,255,255,0.08)" strokeDasharray="3 3" />
                        <XAxis dataKey="rank" stroke="rgba(255,255,255,0.55)" tick={{ fontSize: 12 }} />
                        <YAxis stroke="rgba(255,255,255,0.55)" tick={{ fontSize: 12 }} domain={[0, 100]} />
                        <Tooltip
                          {...tooltipCommon}
                        />
                        <Line type="monotone" dataKey="cumulativeShare" stroke="#34d399" strokeWidth={2} dot={false} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                <div className="chartCard">
                  <div className="chartTitle">
                    <div className="label">Top Fee Payers</div>
                    <div className="meta">top10 concentration {feePayerStats.concentrationTop10.toFixed(1)}%</div>
                  </div>
                  <div style={{ width: '100%', height: 260 }}>
                    <ResponsiveContainer>
                      <BarChart
                        data={feePayerStats.top.map((p) => ({
                          payer: short(p.payer),
                          payerFull: p.payer,
                          total: p.total,
                          count: p.count,
                        }))}
                      >
                        <CartesianGrid stroke="rgba(255,255,255,0.08)" strokeDasharray="3 3" />
                        <XAxis dataKey="payer" stroke="rgba(255,255,255,0.55)" tick={{ fontSize: 12 }} />
                        <YAxis stroke="rgba(255,255,255,0.55)" tick={{ fontSize: 12 }} />
                        <Tooltip
                          formatter={(value, name, props) =>
                            name === 'total'
                              ? [value, `total (${(props.payload as any).payerFull})`]
                              : [value, name]}
                          {...tooltipCommon}
                        />
                        <Bar dataKey="total" fill="#67e8f9" radius={[8, 8, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </section>

              <section className="charts">
                <div className="chartCard">
                  <div className="chartTitle">
                    <div className="label">Fees Over Time (By Token)</div>
                    <div className="meta">stacked · sampled from fee transfers</div>
                  </div>
                  <div style={{ width: '100%', height: 260 }}>
                    <ResponsiveContainer>
                  <AreaChart data={feesSeries} margin={{ top: 8, right: 10, bottom: 0, left: 0 }}>
                        <CartesianGrid stroke="rgba(255,255,255,0.08)" strokeDasharray="3 3" />
                        <XAxis dataKey="t" stroke="rgba(255,255,255,0.55)" tick={{ fontSize: 12 }} />
                        <YAxis stroke="rgba(255,255,255,0.55)" tick={{ fontSize: 12 }} />
                        <Tooltip
                          {...tooltipCommon}
                        />
                    <Legend content={(p) => <TokenLegend tokenBySymbol={tokenBySymbol} payload={p.payload as any} />} />
                    {Object.keys(data.aggregates.feePaidByToken).map((sym) => (
                      <Area
                            key={sym}
                            type="monotone"
                            dataKey={sym}
                            stackId="1"
                            stroke={tokenColors[sym] ?? '#67e8f9'}
                            fill={tokenColors[sym] ?? '#67e8f9'}
                            fillOpacity={0.22}
                            strokeWidth={2}
                            dot={false}
                          />
                        ))}
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                <div className="chartCard">
                  <div className="chartTitle">
                    <div className="label">Sponsorship Split</div>
                    <div className="meta">fee payer != tx sender</div>
                  </div>
                  <div style={{ width: '100%', height: 260 }}>
                    <ResponsiveContainer>
                  <PieChart>
                        <Tooltip
                          {...tooltipCommon}
                        />
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
                      fill="#67e8f9"
                    />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </div>
          </section>

              <section className="charts">
                <div className="chartCard">
                  <div className="chartTitle">
                    <div className="label">Compliance Events Over Time</div>
                    <div className="meta">TIP-403 registry activity</div>
                  </div>
                  <div style={{ width: '100%', height: 260 }}>
                    <ResponsiveContainer>
                      <BarChart data={complianceSeries} margin={{ top: 8, right: 10, bottom: 0, left: 0 }}>
                        <CartesianGrid stroke="rgba(255,255,255,0.08)" strokeDasharray="3 3" />
                        <XAxis dataKey="t" stroke="rgba(255,255,255,0.55)" tick={{ fontSize: 12 }} />
                        <YAxis stroke="rgba(255,255,255,0.55)" tick={{ fontSize: 12 }} />
                        <Tooltip
                          {...tooltipCommon}
                        />
                        <Legend />
                        <Bar dataKey="WhitelistUpdated" stackId="1" fill="#34d399" />
                        <Bar dataKey="BlacklistUpdated" stackId="1" fill="#fb7185" />
                        <Bar dataKey="PolicyAdminUpdated" stackId="1" fill="#c4b5fd" />
                        <Bar dataKey="PolicyCreated" stackId="1" fill="#fbbf24" />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                <div className="chartCard">
                  <div className="chartTitle">
                    <div className="label">Top Compliance Updaters</div>
                    <div className="meta">who changes policies most</div>
                  </div>
                  <div style={{ width: '100%', height: 260 }}>
                    <ResponsiveContainer>
                      <BarChart
                        data={complianceStats.topUpdaters.map((u) => ({
                          updater: short(u.updater),
                          updaterFull: u.updater,
                          count: u.count,
                        }))}
                      >
                        <CartesianGrid stroke="rgba(255,255,255,0.08)" strokeDasharray="3 3" />
                        <XAxis dataKey="updater" stroke="rgba(255,255,255,0.55)" tick={{ fontSize: 12 }} />
                        <YAxis stroke="rgba(255,255,255,0.55)" tick={{ fontSize: 12 }} />
                        <Tooltip
                          formatter={(value, _name, props) => [value, (props.payload as any).updaterFull]}
                          {...tooltipCommon}
                        />
                        <Bar dataKey="count" fill="#c4b5fd" radius={[8, 8, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </section>

              <section className="charts">
                <div className="chartCard">
                  <div className="chartTitle">
                    <div className="label">Most Changed Policies</div>
                    <div className="meta">policyId churn</div>
                  </div>
                  <div style={{ width: '100%', height: 260 }}>
                    <ResponsiveContainer>
                      <BarChart data={complianceStats.topPolicies}>
                        <CartesianGrid stroke="rgba(255,255,255,0.08)" strokeDasharray="3 3" />
                        <XAxis dataKey="policyId" stroke="rgba(255,255,255,0.55)" tick={{ fontSize: 12 }} />
                        <YAxis stroke="rgba(255,255,255,0.55)" tick={{ fontSize: 12 }} />
                        <Tooltip
                          {...tooltipCommon}
                        />
                        <Bar dataKey="changes" fill="#fb7185" radius={[8, 8, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                <div className="chartCard">
                  <div className="chartTitle">
                    <div className="label">Fee AMM Total Liquidity</div>
                    <div className="meta">sum of pool reserves by token</div>
                  </div>
                  <div style={{ width: '100%', height: 260 }}>
                    <ResponsiveContainer>
                      <BarChart data={feeAmmLiquidity}>
                        <CartesianGrid stroke="rgba(255,255,255,0.08)" strokeDasharray="3 3" />
                        <XAxis
                          dataKey="token"
                          stroke="rgba(255,255,255,0.55)"
                          tick={(p) => <TokenAxisTick {...(p as any)} tokenBySymbol={tokenBySymbol} />}
                        />
                        <YAxis stroke="rgba(255,255,255,0.55)" tick={{ fontSize: 12 }} />
                        <Tooltip
                          {...tooltipCommon}
                        />
                        <Bar dataKey="value" fill="#34d399" radius={[8, 8, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </section>

              <section className="card">
                <div className="sectionTitle">Fee AMM Pools (sample)</div>
                <table>
                  <thead>
                    <tr>
                      <th>User Token</th>
                      <th>Validator Token</th>
                      <th>User Reserve</th>
                      <th>Validator Reserve</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.feeAmm.pools.slice(0, 30).map((p, idx) => (
                      <tr key={`${p.userToken.symbol}:${p.validatorToken.symbol}:${idx}`}>
                        <td>
                          <TokenBadge token={p.userToken} />
                        </td>
                        <td>
                          <TokenBadge token={p.validatorToken} />
                        </td>
                        <td className="mono">{p.reserveUserToken}</td>
                        <td className="mono">{p.reserveValidatorToken}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
            </>
          )}

          <section className="card">
            <div className="sectionTitle">Fee Paid (to FeeManager)</div>
            <div className="chips">
              {Object.entries(data.aggregates.feePaidByToken).map(([sym, amt]) => {
                const token = data.tokens.find((t) => t.symbol === sym)
                return (
                  <div className="chip" key={sym}>
                    {token ? <TokenBadge token={token} /> : <span>{sym}</span>}
                    <span className="chipSep">:</span>
                    <span className="mono chipValue">{amt}</span>
                  </div>
                )
              })}
            </div>
          </section>

          <section className="card">
            <div className="sectionTitle">Recent Memo Transfers</div>
            <table>
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
                {data.memoTransfers.slice(0, 25).map((t) => (
                  <tr key={`${t.txHash}:${t.memo}`}> 
                    <td className="mono">{formatTs(t.timestamp)}</td>
                    <td>
                      <TokenBadge token={t.token} />
                    </td>
                    <td className="mono">{t.amount}</td>
                    <td className="mono">{short(t.from)}</td>
                    <td className="mono">{short(t.to)}</td>
                    <td className="mono">{short(t.memo)}</td>
                    <td className="mono">
                      <a href={`https://explore.tempo.xyz/tx/${t.txHash}`} target="_blank" rel="noreferrer">
                        {short(t.txHash)}
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <section className="card">
            <div className="sectionTitle">Recent Compliance Events (TIP-403)</div>
            <table>
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Type</th>
                  <th>Policy</th>
                  <th>Tx</th>
                </tr>
              </thead>
              <tbody>
                {data.compliance.slice(0, 25).map((e) => (
                  <tr key={`${e.txHash}:${e.type}:${e.policyId}`}> 
                    <td className="mono">{formatTs(e.timestamp)}</td>
                    <td>{e.type}</td>
                    <td className="mono">{e.policyId}</td>
                    <td className="mono">
                      <a href={`https://explore.tempo.xyz/tx/${e.txHash}`} target="_blank" rel="noreferrer">
                        {short(e.txHash)}
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </>
      )}
    </div>
  )
}

export default App
