# Portfolio Value Service

A small service that values a portfolio of crypto and fiat holdings in CAD, using live prices from [CoinGecko](https://www.coingecko.com/en/api) (crypto) and [Frankfurter](https://frankfurter.dev) (ECB exchange rates), plus a React page that consumes it.

The reasoning behind the design (storage, caching and freshness, failure handling, front-end state, chart performance, and what I'd change with more time) is in **[DECISIONS.md](DECISIONS.md)**.

## Requirements

- **Node.js 22 or newer** (developed on Node 24; `.nvmrc` pins 24). That's all. SQLite is embedded, and there's no Docker or database server to run.
- Internet access, for CoinGecko and Frankfurter.

## Setup and run

```sh
npm install
npm start
```

| | URL |
|---|---|
| Web app | http://localhost:5173 |
| API | http://localhost:3000 |

`npm start` runs both apps with `concurrently`, prefixing each log line `[api]` or `[web]`. To run one at a time:

```sh
npm run start:api    # API only
npm run start:web    # web app only (it forwards /api/* to http://localhost:3000)
npm run dev          # both, with the API restarting on file changes
```

Data is stored in `apps/api/data/portfolio.db`, which is created on first start and survives restarts. Delete `apps/api/data/` to start with an empty database. Press Ctrl-C to stop; the API finishes in-flight requests and closes the database cleanly.

### Configuration (optional)

Everything works with no configuration. To change a setting, copy `.env.example` to `.env.local` at the repository root (it's git-ignored):

| Variable | Default | Purpose |
|---|---|---|
| `COINGECKO_API_KEY` | *(none: keyless public tier)* | CoinGecko demo key, sent as `x-cg-demo-api-key`. Checked against `/ping` at startup, with the result logged |
| `PORT` | `3000` | API port |
| `DB_PATH` | `data/portfolio.db` | SQLite file, relative to `apps/api` |
| `FIAT_MAX_STALE_DAYS` | `7` | How old a cached ECB rate may be and still be used (labelled stale) when Frankfurter is down |
| `HISTORY_RETENTION_DAYS` | `90` | Valuation snapshots older than this are deleted (checked hourly) |
| `SIMULATE_COINGECKO` | *(off)* | `429` or `timeout`: makes every CoinGecko call fail, to demonstrate the failure handling |
| `API_URL` | `http://localhost:3000` | Where the web dev server forwards `/api/*` |

Invalid values stop the API at startup with a clear message.

## Using the app

1. Open http://localhost:5173. The home page lists portfolios. Click **New portfolio**: the form opens with BTC and USD rows at 0. **Create portfolio** stays disabled until at least one amount is above 0, and rows left at 0 aren't saved. Add or remove holdings as you like; leave the name blank to have it named "Portfolio N".
2. A portfolio's page shows:
   - the total in CAD;
   - each holding's unit price, subtotal and when its price is from;
   - an **Edit portfolio** button that opens the editor in a dialog (name, add, remove, change amounts; closing with unsaved changes asks first);
   - a **History** chart (24h / 7d / 30d / All).
3. To see the failure handling, stop the app, wait over a minute so the cached crypto prices expire, then run:

   ```sh
   SIMULATE_COINGECKO=429 npm start
   ```

   - A portfolio with cached prices shows a **degraded** banner, with stale rows marked.
   - A portfolio holding a coin that has never been priced shows **"can't be valued right now"** with a retry countdown, and no total. `SIMULATE_COINGECKO=timeout` does the same through a 4-second timeout.

## API

| Method & path | Description |
|---|---|
| `POST /portfolios` | Create. Body: the brief's bare array `[{ "asset": "BTC", "amount": 0.5 }, …]` (auto-named "Portfolio N"), or `{ "name": "…", "holdings": [ … ] }`. Returns `201` and the portfolio |
| `GET /portfolios?limit=50` | List, most recently updated first |
| `GET /portfolios/:id` | One portfolio |
| `PUT /portfolios/:id` | Replace the holdings (bare array keeps the name) or the name and holdings (`{ name, holdings }`) |
| `GET /portfolios/:id/value` | Current value in CAD with a per-holding breakdown. `200` with `status: "complete"` or `"degraded"` (stale prices labelled), or `503` with `Retry-After` when a holding can't be priced at all |
| `GET /portfolios/:id/history?from=&to=&maxPoints=500` | Valuation snapshots (time, total, status), downsampled to at most `maxPoints` |

Assets: `BTC ETH SOL XRP ADA DOGE LTC USDT USDC`, plus the 30 ECB currencies including `CAD`, `USD` and `EUR`. Amounts can be numbers or decimal strings.

```sh
ID=$(curl -s -X POST localhost:3000/portfolios -H 'Content-Type: application/json' \
  -d '[{"asset":"BTC","amount":0.5},{"asset":"ETH","amount":10},{"asset":"USD","amount":2500},{"asset":"EUR","amount":1000}]' \
  | node -p "JSON.parse(require('fs').readFileSync(0)).id")
curl -s localhost:3000/portfolios/$ID/value
curl -s "localhost:3000/portfolios/$ID/history?maxPoints=100"
```

## Tests and checks

```sh
npm test            # API (Vitest + supertest) and web (Vitest + Testing Library) tests
npm run typecheck   # TypeScript, all workspaces
npm run build -w @portfolio/web   # production build of the web app
```

Tests use in-memory SQLite and fake upstream clients, so they never call CoinGecko or Frankfurter. The suite is kept small: each test checks a requirement of the brief (the mapping is in [DECISIONS.md](DECISIONS.md#tests)). The test that best represents the brief is in `apps/api/src/valuation/valuation.test.ts`: *"when CoinGecko rate-limits, returns a degraded 200 that labels exactly which prices are stale"*.

## Layout

```
apps/api/            Express 5 + SQLite (better-sqlite3)
  src/portfolios/    CRUD routes and repository
  src/pricing/       CoinGecko / Frankfurter clients, price caches, ECB calendar
  src/valuation/     /value and /history, snapshots, retention
  src/db/            connection settings and migrations
apps/web/            Vite + React + TanStack Query + visx
  src/pages/         / (list) and /portfolios/:id
  src/components/    value panel, holdings editor, history chart
packages/contracts/  zod schemas and API types shared by both apps
```
