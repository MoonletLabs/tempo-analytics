import cors from 'cors'
import express from 'express'
import path from 'node:path'

import { buildDashboard, getComplianceEvents, getFeePayments, getMemoTransfers, normalizeMemoParam } from './analytics'
import { env } from './env'
import { parseWindowSeconds } from './timeWindow'
import { publicClient } from './rpc'

const app = express()
app.disable('x-powered-by')

app.use(cors())

// Light caching for API responses (public RPC is slow/rate-limited)
app.use('/api', (_req, res, next) => {
  res.setHeader('Cache-Control', 'public, max-age=30')
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

app.get('/api/dashboard', async (req, res) => {
  try {
    const windowSeconds = parseWindowSeconds(req.query.window as string | undefined)
    const data = await buildDashboard(windowSeconds)
    res.json(data)
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) })
  }
})

app.get('/api/memo/:memo', async (req, res) => {
  try {
    const windowSeconds = parseWindowSeconds(req.query.window as string | undefined)
    const memo = normalizeMemoParam(req.params.memo)
    const data = await getMemoTransfers(windowSeconds, memo)
    res.json({ windowSeconds, memo, transfers: data })
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) })
  }
})

app.get('/api/fees', async (req, res) => {
  try {
    const windowSeconds = parseWindowSeconds(req.query.window as string | undefined)
    const data = await getFeePayments(windowSeconds)
    res.json({ windowSeconds, feeManager: env.contracts.feeManager, payments: data })
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) })
  }
})

app.get('/api/compliance', async (req, res) => {
  try {
    const windowSeconds = parseWindowSeconds(req.query.window as string | undefined)
    const data = await getComplianceEvents(windowSeconds)
    res.json({ windowSeconds, registry: env.contracts.tip403Registry, events: data })
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
