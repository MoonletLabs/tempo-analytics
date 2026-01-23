import type { Address } from 'viem'

export const env = {
  port: Number.parseInt(process.env.PORT ?? '8787', 10),
  rpcUrl: process.env.TEMPO_RPC_URL ?? 'https://rpc.moderato.tempo.xyz',
  tokenlistUrl:
    process.env.TEMPO_TOKENLIST_URL ?? 'https://tokenlist.tempo.xyz/list/42431',
  // Public RPC can be rate limited; cap the scanned block window by default.
  maxScanBlocks: BigInt(process.env.TEMPO_MAX_SCAN_BLOCKS ?? '20000'),
  chainId: 42431,
  contracts: {
    feeManager: '0xfeec000000000000000000000000000000000000' as Address,
    tip403Registry: '0x403c000000000000000000000000000000000000' as Address,
  },
} as const
