import cors from 'cors'
import express from 'express'
import path from 'node:path'

import { buildDashboard, getComplianceEvents, getFeePayments, getMemoTransfers, normalizeMemoParam } from './analytics'
import { env } from './env'
import { publicClient } from './rpc'

const app = express()
app.disable('x-powered-by')

app.use(cors())

// Fixed 1-hour window for fast queries (no caching needed)
const DASHBOARD_WINDOW = 3600

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

app.listen(env.port, () => {
  // eslint-disable-next-line no-console
  console.log(`tempo-analytics server listening on http://localhost:${env.port}`)
})
