import type { Address } from 'viem'

export const env = {
  port: Number.parseInt(process.env.PORT ?? '8787', 10),
  rpcUrl: process.env.TEMPO_RPC_URL ?? 'https://public.moonlet.cloud/tempo',
  tokenlistUrl:
    process.env.TEMPO_TOKENLIST_URL ?? 'https://tokenlist.tempo.xyz/list/42431',
  // Cap scanned block window by default (increase on your own RPC if needed).
  maxScanBlocks: BigInt(process.env.TEMPO_MAX_SCAN_BLOCKS ?? '200000'),
  chainId: 42431,
  contracts: {
    feeManager: '0xfeec000000000000000000000000000000000000' as Address,
    tip403Registry: '0x403c000000000000000000000000000000000000' as Address,
  },
} as const
