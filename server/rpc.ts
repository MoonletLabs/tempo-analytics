import { createPublicClient, http } from 'viem'
import type { Chain } from 'viem'

import { env } from './env'

const tempoTestnet: Chain = {
  id: env.chainId,
  name: 'Tempo Testnet (Moderato)',
  nativeCurrency: {
    name: 'USD',
    symbol: 'USD',
    decimals: 18,
  },
  rpcUrls: {
    default: { http: [env.rpcUrl] },
  },
  contracts: {
    multicall3: {
      address: '0xcA11bde05977b3631167028862bE2a173976CA11',
    },
  },
}

export const publicClient = createPublicClient({
  chain: tempoTestnet,
  transport: http(env.rpcUrl, {
    timeout: 30_000,
  }),
})
