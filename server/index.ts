import cors from 'cors'
import express from 'express'
import path from 'node:path'

import { buildDashboard, getComplianceEvents, getFeePayments, getMemoTransfers, normalizeMemoParam } from './analytics'
import { env } from './env'
import { publicClient } from './rpc'

const app = express()
app.disable('x-powered-by')

app.use(cors())

// Fixed 1-hour window for fast queries
const DASHBOARD_WINDOW = 3600

// Cache warming interval: 3 minutes
const CACHE_WARM_INTERVAL_MS = 3 * 60 * 1000

// Light caching for API responses
app.use('/api', (_req, res, next) => {
  res.setHeader('Cache-Control', 'public, max-age=10')
  next()
})

app.get('/api/health', async (_req, res) => {
  try {
    const latestBlock = await publicClient.getBlockNumber()
    res.json({
      ok: true,
      chainId: env.chainId,
      rpcUrl: env.rpcUrl,
      latestBlock: latestBlock.toString(),
    })
  } catch (err) {
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) })
  }
})

app.get('/api/dashboard', async (_req, res) => {
  try {
    const start = Date.now()
    const data = await buildDashboard(DASHBOARD_WINDOW)
    console.log(`[api] Dashboard built in ${Date.now() - start}ms`)
    res.json(data)
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) })
  }
})

app.get('/api/memo/:memo', async (req, res) => {
  try {
    const memo = normalizeMemoParam(req.params.memo)
    const data = await getMemoTransfers(DASHBOARD_WINDOW, memo)
    res.json({ windowSeconds: DASHBOARD_WINDOW, memo, transfers: data })
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) })
  }
})

app.get('/api/fees', async (_req, res) => {
  try {
    const data = await getFeePayments(DASHBOARD_WINDOW)
    res.json({ windowSeconds: DASHBOARD_WINDOW, feeManager: env.contracts.feeManager, payments: data })
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) })
  }
})

app.get('/api/compliance', async (_req, res) => {
  try {
    const data = await getComplianceEvents(DASHBOARD_WINDOW)
    res.json({ windowSeconds: DASHBOARD_WINDOW, registry: env.contracts.tip403Registry, events: data })
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) })
  }
})

// Production: serve built frontend from /dist
if (process.env.NODE_ENV === 'production') {
  const distDir = path.resolve(process.cwd(), 'dist')
  app.use(express.static(distDir))
  app.get('*', (_req, res) => {
    res.sendFile(path.join(distDir, 'index.html'))
  })
}

// Cache warming function - pre-populates cache in background
let isWarming = false
const WARM_TIMEOUT_MS = 2 * 60 * 1000 // 2 minutes max

async function warmCache() {
  // Prevent overlapping warm-ups
  if (isWarming) {
    console.log(`[cache-warm] Skipping - previous warm-up still in progress`)
    return
  }

  isWarming = true
  const timeoutId = setTimeout(() => {
    if (isWarming) {
      console.error(`[cache-warm] Timeout after ${WARM_TIMEOUT_MS}ms - forcing reset`)
      isWarming = false
    }
  }, WARM_TIMEOUT_MS)

  try {
    const start = Date.now()
    console.log(`[cache-warm] Starting cache warm-up...`)

    // Pre-populate dashboard cache (this will also warm sub-caches like memoTransfers, fees, compliance, etc.)
    await buildDashboard(DASHBOARD_WINDOW)

    // Also warm other endpoints that might be called separately
    await Promise.allSettled([
      getFeePayments(DASHBOARD_WINDOW),
      getComplianceEvents(DASHBOARD_WINDOW),
    ])

    const duration = Date.now() - start
    console.log(`[cache-warm] Cache warmed successfully in ${duration}ms`)
  } catch (err) {
    console.error(`[cache-warm] Error warming cache:`, err instanceof Error ? err.message : String(err))
  } finally {
    clearTimeout(timeoutId)
    isWarming = false
  }
}

// Store interval ID for potential cleanup
let cacheWarmInterval: NodeJS.Timeout | null = null

// Start cache warming immediately and then every 3 minutes
warmCache().catch((err) => {
  console.error(`[cache-warm] Initial warm-up failed:`, err instanceof Error ? err.message : String(err))
})
cacheWarmInterval = setInterval(warmCache, CACHE_WARM_INTERVAL_MS)

// Graceful shutdown handler (optional, for cleanup)
process.on('SIGTERM', () => {
  if (cacheWarmInterval) {
    clearInterval(cacheWarmInterval)
    console.log(`[cache-warm] Cache warming stopped`)
  }
})

app.listen(env.port, () => {
  // eslint-disable-next-line no-console
  console.log(`tempo-analytics server listening on http://localhost:${env.port}`)
  console.log(`[cache-warm] Cache warming enabled (every ${CACHE_WARM_INTERVAL_MS / 1000}s)`)
})
