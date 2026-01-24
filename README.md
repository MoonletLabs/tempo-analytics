# Tempo Analytics Dashboard

A comprehensive real-time analytics platform for monitoring the Tempo Network (Testnet - Moderato). The dashboard provides deep insights into network activity, memo transfers, fee payments, compliance events, and Fee AMM pool health through intuitive visualizations and detailed data exploration tools.

## Features

### Analytics Dashboard
- **8 Key Metrics**: Total transfers, memo transfers, unique memos, fee payments, unique fee payers, sponsored fees, compliance events, and block range
- **15+ Interactive Charts**: Counterparty analysis, token analytics, memo analytics, fee analytics, compliance tracking, and activity over time
- **Payments Funnel**: Breakdown of total transfers → memo transfers → sponsored fee transfers
- **Real-time Updates**: Data refreshes automatically with delta indicators showing changes

### Data Explorer
- **Memo Transfers Table**: Paginated table with full transaction details
- **Compliance Events Table**: TIP-403 registry events with color-coded badges
- **Fee AMM Pools Table**: Complete pool reserve information
- **Fee Summary**: Quick view of fees paid per token

### Memo Explorer
- **Memo Search**: Search for all transfers with a specific memo (bytes32)
- **Detailed Results**: Full transaction details with links to Tempo Explorer
- **Pagination**: Efficient navigation through large result sets

## Quick Start

### Local Development

```bash
yarn install
yarn dev
```

The dashboard will be available at `http://localhost:8787`

If port `8787` is busy, specify a different port:

```bash
PORT=8788 yarn dev
```

### Docker Deployment (Recommended)

```bash
docker compose up --build -d
```

The dashboard will be available at `http://localhost:8080`

Build artifacts (`dist/` and `dist-server/`) are generated inside the Docker build and are gitignored.

## Configuration

### Environment Variables

```bash
# Tempo RPC URL (recommended: use SSH tunnel for your own RPC)
TEMPO_RPC_URL=http://127.0.0.1:8545

# Token list URL
TEMPO_TOKENLIST_URL=https://tokenlist.tempo.xyz/list/42431

# Maximum blocks to scan (only recommended on your own RPC)
TEMPO_MAX_SCAN_BLOCKS=100000

# Server port (default: 8787)
PORT=8787
```

### Docker Configuration Examples

```bash
# Use your own Tempo RPC (recommended: via SSH tunnel)
TEMPO_RPC_URL=http://127.0.0.1:8545 docker compose up --build -d

# Scan more blocks (only recommended on your own RPC)
TEMPO_MAX_SCAN_BLOCKS=100000 docker compose up --build -d
```

## API Endpoints

### `/api/dashboard`
Returns comprehensive dashboard data for the last hour (3600 seconds), including tokens, memo transfers, fees, compliance events, aggregates, and fee AMM data.

**Response**: Dashboard data with all metrics and events

### `/api/memo/:memo`
Searches for all transfers with a specific memo identifier (bytes32 hex format).

**Parameters**: `memo` - 32-byte hex string (0x + 64 hex characters)

**Response**: Array of transfers matching the memo

### `/api/fees`
Returns fee payment events within the time window.

**Response**: Fee payment data with FeeManager contract address

### `/api/compliance`
Returns TIP-403 compliance events within the time window.

**Response**: Compliance event data with registry contract address

### `/api/health`
Health check endpoint for monitoring.

**Response**: Chain ID, RPC URL, and latest block number

## Architecture

### Frontend
- **React 19** with TypeScript
- **Vite** for fast development and optimized builds
- **Tailwind CSS** for responsive, modern styling
- **Recharts** for interactive data visualizations
- **Radix UI** for accessible component primitives

### Backend
- **Node.js** with Express
- **Viem** for Ethereum/blockchain interactions
- **LRU Cache** for efficient in-memory caching
- **Multi-layer caching** with automatic cache warming

### Performance Features
- **Multi-layer caching**: Dashboard (5min), fees (5min), compliance (5min), token list (30min)
- **Cache warming**: Background pre-population every 3 minutes
- **HTTP caching**: 10-second cache headers on API responses
- **Chunked log fetching**: Intelligent block range chunking
- **RPC retry logic**: Automatic retry with exponential backoff
- **Approximate timestamps**: Fast timestamp estimation without N block queries

## Data Sources

### On-Chain Data
- **TIP-20 Token Transfers**: Standard `Transfer` events
- **TIP-20 Memo Transfers**: `TransferWithMemo` events
- **Fee Manager**: Transfers to FeeManager contract (`0xfeec000000000000000000000000000000000000`)
- **TIP-403 Registry**: Compliance policy events (`0x403c000000000000000000000000000000000000`)
  - PolicyCreated
  - PolicyAdminUpdated
  - WhitelistUpdated
  - BlacklistUpdated
- **Fee AMM**: Pool reserves via `getPool` contract calls

### External Data
- **Token List**: Fetched from configurable URL (default: `https://tokenlist.tempo.xyz/list/42431`)
- **Tempo Explorer**: Transaction links to `explore.tempo.xyz`

## Time Window

The dashboard uses a **fixed 1-hour window** (3600 seconds) for all analytics, providing consistent and comparable data. The block range is dynamically calculated based on average block time, with a configurable maximum scan limit to prevent excessive blockchain scanning.

## Deployment

### Nginx + Cloudflare

This Docker Compose setup exposes only port `8080` on the host. Nginx forwards both the web UI and `/api/*` to the app container.

Cloudflare proxy supports HTTP ports like 80/8080/8880. If you want to use Cloudflare (orange cloud) without opening 443 on the VM, point your domain to the VM and set the origin port to `8080`.

### Production Build

```bash
yarn build
yarn start
```

Or with custom port:

```bash
PORT=8790 yarn serve:prod
```

## Development

### Scripts

- `yarn dev` - Start development server with hot reload
- `yarn build` - Build for production
- `yarn start` - Start production server
- `yarn lint` - Run ESLint
- `yarn preview` - Preview production build

### Project Structure

```
├── src/              # Frontend React application
│   ├── components/   # React components
│   ├── lib/          # Utilities
│   └── App.tsx       # Main app component
├── server/           # Backend Express API
│   ├── analytics.ts  # Data aggregation logic
│   ├── cache.ts      # Caching utilities
│   ├── logs.ts       # Event log parsing
│   └── index.ts      # API server
└── public/          # Static assets
```

## License

Private project - All rights reserved
