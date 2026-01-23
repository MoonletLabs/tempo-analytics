// server/index.ts
import cors from "cors";
import express from "express";
import path from "path";

// server/analytics.ts
import { formatUnits } from "viem";

// server/abis.ts
import { parseAbiItem } from "viem";
var tip20 = {
  transfer: parseAbiItem(
    "event Transfer(address indexed from, address indexed to, uint256 amount)"
  ),
  transferWithMemo: parseAbiItem(
    "event TransferWithMemo(address indexed from, address indexed to, uint256 amount, bytes32 indexed memo)"
  )
};
var tip403 = {
  policyCreated: parseAbiItem(
    "event PolicyCreated(uint64 indexed policyId, address indexed updater, uint8 policyType)"
  ),
  policyAdminUpdated: parseAbiItem(
    "event PolicyAdminUpdated(uint64 indexed policyId, address indexed updater, address indexed admin)"
  ),
  whitelistUpdated: parseAbiItem(
    "event WhitelistUpdated(uint64 indexed policyId, address indexed updater, address indexed account, bool allowed)"
  ),
  blacklistUpdated: parseAbiItem(
    "event BlacklistUpdated(uint64 indexed policyId, address indexed updater, address indexed account, bool restricted)"
  )
};
var feeManager = {
  getPool: parseAbiItem(
    "function getPool(address userToken, address validatorToken) view returns (uint256 reserveUserToken, uint256 reserveValidatorToken)"
  )
};

// server/cache.ts
import { LRUCache } from "lru-cache";
var cache = new LRUCache({
  max: 500
});
function cacheGet(key) {
  const hit = cache.get(key);
  if (!hit) return void 0;
  if (Date.now() > hit.expiresAt) {
    cache.delete(key);
    return void 0;
  }
  return hit.value;
}
function cacheSet(key, value, ttlMs) {
  cache.set(key, { value, expiresAt: Date.now() + ttlMs });
}

// server/env.ts
var env = {
  port: Number.parseInt(process.env.PORT ?? "8787", 10),
  rpcUrl: process.env.TEMPO_RPC_URL ?? "https://rpc.moderato.tempo.xyz",
  tokenlistUrl: process.env.TEMPO_TOKENLIST_URL ?? "https://tokenlist.tempo.xyz/list/42431",
  // Public RPC can be rate limited; cap the scanned block window by default.
  maxScanBlocks: BigInt(process.env.TEMPO_MAX_SCAN_BLOCKS ?? "20000"),
  chainId: 42431,
  contracts: {
    feeManager: "0xfeec000000000000000000000000000000000000",
    tip403Registry: "0x403c000000000000000000000000000000000000"
  }
};

// server/logs.ts
import pLimit from "p-limit";
import { isHex } from "viem";

// server/rpc.ts
import { createPublicClient, http } from "viem";
var tempoTestnet = {
  id: env.chainId,
  name: "Tempo Testnet (Moderato)",
  nativeCurrency: {
    name: "USD",
    symbol: "USD",
    decimals: 18
  },
  rpcUrls: {
    default: { http: [env.rpcUrl] }
  },
  contracts: {
    multicall3: {
      address: "0xcA11bde05977b3631167028862bE2a173976CA11"
    }
  }
};
var publicClient = createPublicClient({
  chain: tempoTestnet,
  transport: http(env.rpcUrl, {
    timeout: 3e4
  })
});

// server/retry.ts
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
function parseRetryAfterMs(message) {
  const m = message.match(/try again in\s+(\d+)ms/i);
  if (!m) return void 0;
  return Number.parseInt(m[1], 10);
}
function isRateLimitError(err) {
  const msg = err instanceof Error ? err.message : typeof err === "string" ? err : JSON.stringify(err);
  return msg.includes("Status: 429") || msg.toLowerCase().includes("rate limited") || msg.includes('"code":-32005');
}
function isTransientRpcError(err) {
  const msg = err instanceof Error ? err.message : typeof err === "string" ? err : JSON.stringify(err);
  const transientStatuses = [500, 502, 503, 504, 520, 522, 524];
  for (const s of transientStatuses) {
    if (msg.includes(`Status: ${s}`)) return true;
  }
  if (msg.toLowerCase().includes("fetch failed")) return true;
  if (msg.toLowerCase().includes("socket hang up")) return true;
  if (msg.toLowerCase().includes("econnreset")) return true;
  return false;
}
async function withRpcRetry(fn) {
  let lastErr;
  for (let attempt = 0; attempt < 20; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (!isRateLimitError(err) && !isTransientRpcError(err)) throw err;
      const msg = err instanceof Error ? err.message : typeof err === "string" ? err : JSON.stringify(err);
      const retryAfter = parseRetryAfterMs(msg);
      const backoff = Math.min(1e4, 200 * 2 ** Math.min(6, attempt));
      await sleep(Math.max(retryAfter ?? 0, backoff));
    }
  }
  throw lastErr;
}

// server/logs.ts
function parseRetryRange(message) {
  const m = message.match(/retry with the range\s+(\d+)-(\d+)/i);
  if (!m) return void 0;
  return { from: BigInt(m[1]), to: BigInt(m[2]) };
}
async function getBlockTimestampSeconds(blockNumber) {
  const cacheKey = `blockTs:${blockNumber.toString()}`;
  const cached = cacheGet(cacheKey);
  if (cached !== void 0) return cached;
  const block = await withRpcRetry(() => publicClient.getBlock({ blockNumber }));
  const ts = BigInt(block.timestamp);
  cacheSet(cacheKey, ts, 10 * 60 * 1e3);
  return ts;
}
async function blockRangeForWindow(windowSeconds) {
  const latest = await withRpcRetry(() => publicClient.getBlockNumber());
  const latestTs = await getBlockTimestampSeconds(latest);
  const sampleDelta = 2000n;
  const sampleBlock = latest > sampleDelta ? latest - sampleDelta : 0n;
  const sampleTs = await getBlockTimestampSeconds(sampleBlock);
  const dt = Number(latestTs - sampleTs);
  const dn = Number(latest - sampleBlock);
  const avgSecondsPerBlock = dn > 0 ? Math.max(0.2, dt / dn) : 1;
  const estBlocks = BigInt(Math.ceil(windowSeconds / avgSecondsPerBlock));
  const estFrom = latest > estBlocks ? latest - estBlocks : 0n;
  const hardCapFrom = latest > env.maxScanBlocks ? latest - env.maxScanBlocks : 0n;
  const fromBlock = estFrom < hardCapFrom ? hardCapFrom : estFrom;
  return { fromBlock, toBlock: latest };
}
async function getLogsChunked({
  fromBlock,
  toBlock,
  fetch: fetch2
}) {
  const limit = pLimit(4);
  const results = [];
  const minChunk = 200n;
  let chunk = 5000n;
  let start = fromBlock;
  while (start <= toBlock) {
    const end = start + chunk - 1n > toBlock ? toBlock : start + chunk - 1n;
    const part = await limit(async () => {
      try {
        return await withRpcRetry(() => fetch2({ fromBlock: start, toBlock: end }));
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        const retry = parseRetryRange(msg);
        if (retry) {
          return await withRpcRetry(() => fetch2({ fromBlock: retry.from, toBlock: retry.to }));
        }
        if (msg.toLowerCase().includes("query exceeds max results") && chunk > minChunk) {
          chunk = chunk / 2n;
          if (chunk < minChunk) chunk = minChunk;
          return await withRpcRetry(() => fetch2({ fromBlock: start, toBlock: end }));
        }
        throw err;
      }
    });
    results.push(...part);
    start = end + 1n;
  }
  const seen = /* @__PURE__ */ new Set();
  return results.filter((l) => {
    const key = `${l.transactionHash}:${l.logIndex}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
function parseBytes32Memo(memo) {
  if (!isHex(memo)) throw new Error("memo must be hex");
  if (memo.length !== 66) throw new Error("memo must be 32 bytes (0x + 64 hex)");
  return memo;
}

// server/timeModel.ts
async function getTimeModel() {
  const cacheKey = "timeModel";
  const cached = cacheGet(cacheKey);
  if (cached) return cached;
  const latestBlock = await withRpcRetry(() => publicClient.getBlockNumber());
  const sampleDelta = 2000n;
  const sampleBlock = latestBlock > sampleDelta ? latestBlock - sampleDelta : 0n;
  const latest = await withRpcRetry(() => publicClient.getBlock({ blockNumber: latestBlock }));
  const sample = await withRpcRetry(() => publicClient.getBlock({ blockNumber: sampleBlock }));
  const latestTs = Number(latest.timestamp);
  const sampleTs = Number(sample.timestamp);
  const dt = Math.max(1, latestTs - sampleTs);
  const dn = Number(latestBlock - sampleBlock);
  const avgSecondsPerBlock = dn > 0 ? Math.max(0.2, dt / dn) : 1;
  const out = { latestBlock, latestTs, avgSecondsPerBlock };
  cacheSet(cacheKey, out, 30 * 1e3);
  return out;
}
function applyApproxTimestamps(items, model) {
  return items.map((i) => {
    const deltaBlocks = Number(model.latestBlock) - i.blockNumber;
    const approx = model.latestTs - Math.max(0, Math.round(deltaBlocks * model.avgSecondsPerBlock));
    return { ...i, timestamp: approx };
  });
}

// server/tokenlist.ts
async function fetchTokenlist() {
  const cacheKey = `tokenlist:${env.tokenlistUrl}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;
  const res = await fetch(env.tokenlistUrl, {
    headers: {
      accept: "application/json"
    }
  });
  if (!res.ok) {
    throw new Error(`tokenlist fetch failed: ${res.status} ${res.statusText}`);
  }
  const data = await res.json();
  const filtered = {
    name: data.name,
    tokens: (data.tokens ?? []).filter((t) => t.chainId === env.chainId)
  };
  cacheSet(cacheKey, filtered, 30 * 60 * 1e3);
  return filtered;
}

// server/analytics.ts
function tokenRef(t) {
  return {
    address: t.address,
    symbol: t.symbol,
    name: t.name,
    decimals: t.decimals,
    logoURI: t.logoURI
  };
}
async function attachTimestamps(items) {
  const model = await getTimeModel();
  return applyApproxTimestamps(items, model);
}
async function getMemoTransfers(windowSeconds, memo) {
  const [{ tokens }, range] = await Promise.all([
    fetchTokenlist(),
    blockRangeForWindow(windowSeconds)
  ]);
  const tokenByAddress = new Map(
    tokens.map((t) => [t.address.toLowerCase(), t])
  );
  const tokenAddresses = tokens.map((t) => t.address);
  const transfers = [];
  const logs = await getLogsChunked({
    fromBlock: range.fromBlock,
    toBlock: range.toBlock,
    fetch: async ({ fromBlock, toBlock }) => publicClient.getLogs({
      address: tokenAddresses,
      event: tip20.transferWithMemo,
      args: memo ? { memo } : void 0,
      fromBlock,
      toBlock
    })
  });
  for (const l of logs) {
    const token = tokenByAddress.get(l.address.toLowerCase());
    if (!token) continue;
    transfers.push({
      token: tokenRef(token),
      from: l.args.from,
      to: l.args.to,
      memo: l.args.memo,
      amount: formatUnits(l.args.amount, token.decimals),
      rawAmount: l.args.amount.toString(),
      txHash: l.transactionHash,
      blockNumber: Number(l.blockNumber)
    });
  }
  transfers.sort((a, b) => b.blockNumber - a.blockNumber);
  return attachTimestamps(transfers.slice(0, 250));
}
async function getFeePayments(windowSeconds) {
  const [{ tokens }, range] = await Promise.all([
    fetchTokenlist(),
    blockRangeForWindow(windowSeconds)
  ]);
  const tokenByAddress = new Map(
    tokens.map((t) => [t.address.toLowerCase(), t])
  );
  const tokenAddresses = tokens.map((t) => t.address);
  const fees = [];
  const logs = await getLogsChunked({
    fromBlock: range.fromBlock,
    toBlock: range.toBlock,
    fetch: async ({ fromBlock, toBlock }) => publicClient.getLogs({
      address: tokenAddresses,
      event: tip20.transfer,
      args: { to: env.contracts.feeManager },
      fromBlock,
      toBlock
    })
  });
  for (const l of logs) {
    const token = tokenByAddress.get(l.address.toLowerCase());
    if (!token) continue;
    fees.push({
      token: tokenRef(token),
      payer: l.args.from,
      amount: formatUnits(l.args.amount, token.decimals),
      rawAmount: l.args.amount.toString(),
      txHash: l.transactionHash,
      blockNumber: Number(l.blockNumber)
    });
  }
  fees.sort((a, b) => b.blockNumber - a.blockNumber);
  const withTs = await attachTimestamps(fees.slice(0, 250));
  const uniqueTx = [...new Set(withTs.map((f) => f.txHash))].slice(0, 60);
  const senderByTx = /* @__PURE__ */ new Map();
  await Promise.all(
    uniqueTx.map(async (hash) => {
      try {
        const tx = await withRpcRetry(() => publicClient.getTransaction({ hash }));
        senderByTx.set(hash, tx.from);
      } catch {
      }
    })
  );
  return withTs.map((f) => {
    const sender = senderByTx.get(f.txHash);
    const sponsored = sender ? sender.toLowerCase() !== f.payer.toLowerCase() : void 0;
    return { ...f, sender, sponsored };
  });
}
async function getFeeAmmSummary() {
  const cacheKey = "feeAmmSummary";
  const cached = cacheGet(cacheKey);
  if (cached) return cached;
  const { tokens } = await fetchTokenlist();
  const byAddress = new Map(tokens.map((t) => [t.address.toLowerCase(), t]));
  const pools = [];
  const totalRawByToken = /* @__PURE__ */ new Map();
  const pairs = [];
  for (const userToken of tokens) {
    for (const validatorToken of tokens) {
      if (userToken.address.toLowerCase() === validatorToken.address.toLowerCase()) continue;
      pairs.push({ user: userToken, validator: validatorToken });
    }
  }
  const results = await withRpcRetry(
    () => publicClient.multicall({
      allowFailure: true,
      contracts: pairs.map((p) => ({
        address: env.contracts.feeManager,
        abi: [feeManager.getPool],
        functionName: "getPool",
        args: [p.user.address, p.validator.address]
      }))
    })
  );
  for (let i = 0; i < pairs.length; i++) {
    const r = results[i];
    if (!r || r.status !== "success") continue;
    const [ru, rv] = r.result;
    const reserveUser = BigInt(ru);
    const reserveValidator = BigInt(rv);
    if (reserveUser === 0n && reserveValidator === 0n) continue;
    const userToken = pairs[i].user;
    const validatorToken = pairs[i].validator;
    const u = byAddress.get(userToken.address.toLowerCase());
    const v = byAddress.get(validatorToken.address.toLowerCase());
    if (!u || !v) continue;
    totalRawByToken.set(u.symbol, (totalRawByToken.get(u.symbol) ?? 0n) + reserveUser);
    totalRawByToken.set(v.symbol, (totalRawByToken.get(v.symbol) ?? 0n) + reserveValidator);
    pools.push({
      userToken: tokenRef(u),
      validatorToken: tokenRef(v),
      reserveUserToken: formatUnits(reserveUser, u.decimals),
      reserveValidatorToken: formatUnits(reserveValidator, v.decimals)
    });
  }
  pools.sort(
    (a, b) => a.userToken.symbol === b.userToken.symbol ? a.validatorToken.symbol.localeCompare(b.validatorToken.symbol) : a.userToken.symbol.localeCompare(b.userToken.symbol)
  );
  const totalLiquidityByToken = {};
  for (const token of tokens) {
    const raw = totalRawByToken.get(token.symbol) ?? 0n;
    totalLiquidityByToken[token.symbol] = formatUnits(raw, token.decimals);
  }
  const out = { pools, totalLiquidityByToken };
  cacheSet(cacheKey, out, 5 * 60 * 1e3);
  return out;
}
async function getComplianceEvents(windowSeconds) {
  const range = await blockRangeForWindow(windowSeconds);
  const [policyCreated, policyAdminUpdated, whitelistUpdated, blacklistUpdated] = await Promise.all([
    getLogsChunked({
      fromBlock: range.fromBlock,
      toBlock: range.toBlock,
      fetch: async ({ fromBlock, toBlock }) => publicClient.getLogs({
        address: env.contracts.tip403Registry,
        event: tip403.policyCreated,
        fromBlock,
        toBlock
      })
    }),
    getLogsChunked({
      fromBlock: range.fromBlock,
      toBlock: range.toBlock,
      fetch: async ({ fromBlock, toBlock }) => publicClient.getLogs({
        address: env.contracts.tip403Registry,
        event: tip403.policyAdminUpdated,
        fromBlock,
        toBlock
      })
    }),
    getLogsChunked({
      fromBlock: range.fromBlock,
      toBlock: range.toBlock,
      fetch: async ({ fromBlock, toBlock }) => publicClient.getLogs({
        address: env.contracts.tip403Registry,
        event: tip403.whitelistUpdated,
        fromBlock,
        toBlock
      })
    }),
    getLogsChunked({
      fromBlock: range.fromBlock,
      toBlock: range.toBlock,
      fetch: async ({ fromBlock, toBlock }) => publicClient.getLogs({
        address: env.contracts.tip403Registry,
        event: tip403.blacklistUpdated,
        fromBlock,
        toBlock
      })
    })
  ]);
  const raw = [];
  for (const l of policyCreated) {
    raw.push({
      type: "PolicyCreated",
      policyId: l.args.policyId.toString(),
      updater: l.args.updater,
      policyType: Number(l.args.policyType),
      txHash: l.transactionHash,
      blockNumber: Number(l.blockNumber)
    });
  }
  for (const l of policyAdminUpdated) {
    raw.push({
      type: "PolicyAdminUpdated",
      policyId: l.args.policyId.toString(),
      updater: l.args.updater,
      admin: l.args.admin,
      txHash: l.transactionHash,
      blockNumber: Number(l.blockNumber)
    });
  }
  for (const l of whitelistUpdated) {
    raw.push({
      type: "WhitelistUpdated",
      policyId: l.args.policyId.toString(),
      updater: l.args.updater,
      account: l.args.account,
      allowed: l.args.allowed,
      txHash: l.transactionHash,
      blockNumber: Number(l.blockNumber)
    });
  }
  for (const l of blacklistUpdated) {
    raw.push({
      type: "BlacklistUpdated",
      policyId: l.args.policyId.toString(),
      updater: l.args.updater,
      account: l.args.account,
      restricted: l.args.restricted,
      txHash: l.transactionHash,
      blockNumber: Number(l.blockNumber)
    });
  }
  raw.sort((a, b) => b.blockNumber - a.blockNumber);
  return attachTimestamps(raw.slice(0, 250));
}
async function buildDashboard(windowSeconds) {
  const cacheKey = `dashboard:${windowSeconds}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;
  const [tokenlist, range, memoTransfers, fees, compliance, feeAmm] = await Promise.all([
    fetchTokenlist(),
    blockRangeForWindow(windowSeconds),
    getMemoTransfers(windowSeconds),
    getFeePayments(windowSeconds),
    getComplianceEvents(windowSeconds),
    getFeeAmmSummary()
  ]);
  const memoTransferVolumeByToken = {};
  for (const t of memoTransfers) {
    memoTransferVolumeByToken[t.token.symbol] = (memoTransferVolumeByToken[t.token.symbol] ?? 0n) + BigInt(t.rawAmount);
  }
  const feePaidByToken = {};
  for (const f of fees) {
    feePaidByToken[f.token.symbol] = (feePaidByToken[f.token.symbol] ?? 0n) + BigInt(f.rawAmount);
  }
  const memoTransferVolumeByTokenFormatted = {};
  for (const token of tokenlist.tokens) {
    const raw = memoTransferVolumeByToken[token.symbol] ?? 0n;
    memoTransferVolumeByTokenFormatted[token.symbol] = formatUnits(raw, token.decimals);
  }
  const feePaidByTokenFormatted = {};
  for (const token of tokenlist.tokens) {
    const raw = feePaidByToken[token.symbol] ?? 0n;
    feePaidByTokenFormatted[token.symbol] = formatUnits(raw, token.decimals);
  }
  const uniqueMemos = new Set(memoTransfers.map((t) => t.memo.toLowerCase())).size;
  const uniqueFeePayers = new Set(fees.map((f) => f.payer.toLowerCase())).size;
  const sponsoredFeePayments = fees.filter((f) => f.sponsored === true).length;
  const sponsoredDenom = fees.filter((f) => f.sponsored !== void 0).length;
  const sponsoredFeePaymentRate = sponsoredDenom > 0 ? sponsoredFeePayments / sponsoredDenom : 0;
  const uniqueComplianceUpdaters = new Set(compliance.map((e) => e.updater.toLowerCase())).size;
  const uniquePolicyIds = new Set(compliance.map((e) => e.policyId)).size;
  const affected = /* @__PURE__ */ new Set();
  for (const e of compliance) {
    if (e.type === "WhitelistUpdated") affected.add(e.account.toLowerCase());
    if (e.type === "BlacklistUpdated") affected.add(e.account.toLowerCase());
  }
  const out = {
    windowSeconds,
    range: {
      fromBlock: range.fromBlock.toString(),
      toBlock: range.toBlock.toString()
    },
    tokens: tokenlist.tokens,
    memoTransfers: memoTransfers.slice(0, 100),
    fees: fees.slice(0, 100),
    compliance: compliance.slice(0, 100),
    aggregates: {
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
      uniqueAffectedAddresses: affected.size
    },
    feeAmm
  };
  cacheSet(cacheKey, out, 2 * 60 * 1e3);
  return out;
}
function normalizeMemoParam(memo) {
  return parseBytes32Memo(memo);
}

// server/timeWindow.ts
import { z } from "zod";
var windowSchema = z.string().optional().transform((v) => v ?? "24h").refine(
  (v) => /^[0-9]+(h|d)$/.test(v),
  "window must be like 24h or 7d"
);
function parseWindowSeconds(raw) {
  const value = windowSchema.parse(raw);
  const amount = Number.parseInt(value.slice(0, -1), 10);
  const unit = value.slice(-1);
  if (!Number.isFinite(amount) || amount <= 0) return 24 * 3600;
  return unit === "h" ? amount * 3600 : amount * 24 * 3600;
}

// server/index.ts
var app = express();
app.disable("x-powered-by");
app.use(cors());
app.use("/api", (_req, res, next) => {
  res.setHeader("Cache-Control", "public, max-age=30");
  next();
});
app.get("/api/health", async (_req, res) => {
  try {
    const latestBlock = await publicClient.getBlockNumber();
    res.json({
      ok: true,
      chainId: env.chainId,
      rpcUrl: env.rpcUrl,
      latestBlock: latestBlock.toString()
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
});
app.get("/api/dashboard", async (req, res) => {
  try {
    const windowSeconds = parseWindowSeconds(req.query.window);
    const data = await buildDashboard(windowSeconds);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});
app.get("/api/memo/:memo", async (req, res) => {
  try {
    const windowSeconds = parseWindowSeconds(req.query.window);
    const memo = normalizeMemoParam(req.params.memo);
    const data = await getMemoTransfers(windowSeconds, memo);
    res.json({ windowSeconds, memo, transfers: data });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});
app.get("/api/fees", async (req, res) => {
  try {
    const windowSeconds = parseWindowSeconds(req.query.window);
    const data = await getFeePayments(windowSeconds);
    res.json({ windowSeconds, feeManager: env.contracts.feeManager, payments: data });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});
app.get("/api/compliance", async (req, res) => {
  try {
    const windowSeconds = parseWindowSeconds(req.query.window);
    const data = await getComplianceEvents(windowSeconds);
    res.json({ windowSeconds, registry: env.contracts.tip403Registry, events: data });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});
if (process.env.NODE_ENV === "production") {
  const distDir = path.resolve(process.cwd(), "dist");
  app.use(express.static(distDir));
  app.get("*", (_req, res) => {
    res.sendFile(path.join(distDir, "index.html"));
  });
}
app.listen(env.port, () => {
  console.log(`tempo-analytics server listening on http://localhost:${env.port}`);
});
