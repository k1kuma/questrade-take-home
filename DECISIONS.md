# Decisions

The choices behind this repo, the trade-offs I accepted, and what I'd do with more time. Setup steps are in the [README](README.md).

## Stack

- **TypeScript end to end, one npm-workspaces monorepo**: `apps/api` (Express), `apps/web` (Vite + React), and `packages/contracts` (zod schemas and response types shared by both). Changing a response type breaks the type check in both apps, so client and server can't drift on the API contract.
- **`npm start` runs both apps** with `concurrently`, executing TypeScript directly via `tsx`. Shortcut for the timebox: in production I'd compile to `dist/` and run plain `node`.

## Storage: SQLite (`better-sqlite3`)

**Why**
- **No setup**: the database is a single file, so `npm start` is the whole setup and portfolios survive restarts.
- **Real transactions**: replacing a portfolio's holdings is all or nothing.
- **Constraints enforced by the database**: foreign keys, plus a primary key that rejects duplicate assets in a portfolio.
- **Cheap history queries** via an index on `(portfolio_id, computed_at)`, and each test gets its own `:memory:` database.

**Trade-offs I accepted**
- **One writer and one process only.** Running multiple API instances would mean moving to Postgres (and the price cache to Redis).
- **No decimal or timestamp types.** Amounts are decimal strings in `TEXT` columns; timestamps are epoch milliseconds in `INTEGER` columns. Every table is `STRICT` to counter SQLite's weak typing.
- **No built-in retention**, so trimming history is done in application code.
- **Synchronous queries block the server.** Fine for indexed lookups on a local file; it would matter for large scans.

## Data model

| Table | Shape |
|---|---|
| `portfolios` | `id` (UUID), `name` (1–100 characters), `created_at`, `updated_at` |
| `holdings` | one row per holding: `(portfolio_id, asset)` primary key, `amount TEXT` |
| `price_cache` | last known good price per asset: `price_cad`, `source`, `as_of` (when the upstream says the price is from), `fetched_at` (when we received it) |
| `valuations` | one snapshot per distinct valuation: `computed_at`, `total_cad`, `status`, `fingerprint`, per-holding `breakdown` JSON |

- **One row per holding, not a JSON column on `portfolios`.** The database enforces one row per asset and cascades deletes. A JSON column would also work, since a portfolio is always read whole, but the duplicate-asset rule would then live only in the application.
- **`PUT` replaces the full list of holdings** in one transaction. That matches how the edit form saves, and an invalid `PUT` leaves the stored holdings untouched.
- **`price_cache` stores two timestamps** because they mean different things: `as_of` decides whether a price is too old to use as a fallback; `fetched_at` decides whether to ask the upstream again.
- **Amounts** are validated as positive numbers or decimal strings and stored in canonical form via `decimal.js`, so precision beyond a float survives. The brief's bare-array body is accepted as-is.

## Normalising the two upstreams

Both APIs are converted into one internal shape (asset, CAD price as a decimal string, `asOf`, `fetchedAt`) by two small clients. Nothing outside `pricing/` sees CoinGecko coin ids or Frankfurter's EUR base.

| | CoinGecko `/simple/price` | Frankfurter `/v1/latest?base=EUR` |
|---|---|---|
| Asset identity | Coin ids (`bitcoin`), mapped from tickers by a typed record, so adding a coin without an id is a compile error | ISO codes, used directly |
| Quote | Already in CAD (asked with `precision=full`; by default BTC came back as whole dollars) | Units per EUR: CAD price of X is `rates.CAD / rates.X` with `decimal.js` |
| Timestamp | Unix seconds, per coin | A date only; `asOf` becomes 16:00 Frankfurt time, the ECB publish time |
| Cadence and limits | Continuous; CDN caches 60 s; ~10–30 calls/min keyless, 429 with `Retry-After` | Once per working day; no published limit |

- **Responses are validated with zod** before use, so an unexpected shape becomes an error instead of `NaN` in a total.
- **One error type, `UpstreamError`**, with a reason: `rate_limited`, `timeout`, `unavailable` or `bad_response`. The reason is what the API response shows as `staleReason`.
- **Every call has a 4-second timeout** covering headers and body, so a stalled upstream can't hold a request open.

**Valuation response:** every holding has `amount`, `unitPriceCad`, `subtotalCad`, `source`, `asOf` and `stale`. Money is computed with `decimal.js` and sent as strings; subtotals are rounded to cents and the total is rounded once from the unrounded subtotals, so it may differ by a cent from the displayed subtotals.

## Caching and freshness

The goal is to make upstream traffic depend on the clock, not on how many clients are asking. Everything sits behind `PriceService.getPrices(assets)`, which never fails because of an upstream: each asset comes back `fresh`, `stale` (with a reason) or `unavailable` (with a reason).

**Crypto: fetch on demand, cache per asset for 60 seconds**
- **The core rule:** each coin is requested from CoinGecko at most once per 60 seconds, success or failure, however many requests arrive. 60 seconds matches CoinGecko's own CDN cache, so asking more often mostly returns the same price.
- **Simultaneous requests share one call.** While a coin is being fetched, other requests wait on the same in-flight fetch. Ten clients in a minute cause at most one CoinGecko call; a test checks this, and a live run of 10 simultaneous requests made exactly one.
- **Calls batch other coins on the way:** an outgoing call also includes any cached coin more than halfway through its 60 seconds, so portfolios with different coins mostly share calls.
- **No serving old prices during a refresh.** After 60 seconds the next request waits for a fresh price; otherwise a "stale" label would appear during normal use.
- **Rejected:** a background job refreshing every N seconds. It keeps traffic flat but spends calls when nobody is looking. It's the better design once there are many portfolios.

**Fiat: exploit the once-a-day ECB schedule**
- **One call gets every currency** (EUR base), and each CAD price is computed as `EURCAD / EURX`. I avoided `?base=CAD` because Frankfurter rounds those cross rates and inverting rounds a second time.
- **The rate table is fetched again only after the next expected ECB publish** (16:00 Frankfurt time on weekdays, correct across summer and winter time): about one call per working day.
- **"Fresh" means we've checked since the last expected publish**, whatever date the rate carries. Friday's rate on Sunday is correctly fresh, because it is the current rate.
- **If the expected date hasn't appeared** (ECB late, or a holiday), we check again every 30 minutes. I didn't model ECB holidays; on those days that costs at most 48 extra calls, and only while clients are asking.

**CAD** is priced at exactly 1 (`source: fixed`) and never touches an upstream.

**Call budget:** CoinGecko at most one call per coin per 60 seconds (about 1 a minute in practice, thanks to batching); Frankfurter about one per working day. The budget doesn't grow with traffic or portfolios. It does grow with API instances, since each has its own cache, which is why Redis comes before a second instance.

**Restarts:** every successful fetch is written to `price_cache` and read back at startup, so a restart makes no extra calls and fallback prices survive.

## Upstream failure handling

- **Back off after any failure.** After a 429, timeout, 5xx or malformed response, no calls go to that upstream until its `Retry-After` time, or 60 seconds without one. The rate limit is per account, so the back-off covers every coin.
- **Fall back to the last known good price, labelled `stale` with the reason**, if it isn't too old:
  - **Crypto: 24 hours.** Crypto can move several percent in a day.
  - **Fiat: 7 days** (configurable). The longest normal gap between ECB publishes is about 5 days at Easter, so less would reject the genuinely current rate during a holiday outage.
  - Beyond those limits, or with nothing cached, the asset is `unavailable`.
- **Only the failing upstream is affected.** A CoinGecko outage doesn't touch USD/EUR holdings, and vice versa.
- **The server never retries within a request.** A retry doubles the client's wait and spends rate-limit budget while the upstream is struggling. Requests during a back-off are answered immediately from the fallback. Retrying is left to the client.

**What `GET /portfolios/:id/value` returns:**

| Situation | Response |
|---|---|
| All prices fresh | `200`, `status: "complete"` |
| Some prices stale, every asset priced | `200`, `status: "degraded"`. Affected holdings have `stale: true`, `asOf` and `staleReason`; `sources` says which upstream is stale and when it will be retried |
| Any asset `unavailable` | `503` with `Retry-After` and the unpriced assets with reasons. **No total is returned** |

- **Degraded is a 200:** the answer is still meaningful, and honesty comes from explicit labels on each holding and source.
- **503 instead of a partial total:** a total that leaves out a holding is wrong even with a label on it.
- **`Retry-After` is the latest recovery time** among the upstreams the portfolio needs, since a retry only succeeds once all have recovered.
- **`SIMULATE_COINGECKO=429|timeout`** swaps CoinGecko's `fetch` for a failing one, so the real failure path can be demonstrated live. Checked: a cached portfolio got a degraded 200 with CoinGecko `rate_limited` and Frankfurter `fresh`; a never-fetched coin got a 503 with `Retry-After: 60`; CoinGecko was called once, then left alone.

**CoinGecko API key:** optional, keyless by default, set via a git-ignored `.env.local`. It changes nothing in the design, because the Demo plan can still throttle or fail. An invalid key silently falls back to public-tier limits on `/simple/price`, so the server checks it once at startup with `/ping` (which does reject bad keys) and logs the result, without delaying startup.

## Valuation history

**Recording**
- **A snapshot is recorded when a value is computed, unless nothing affecting the value changed** since the previous one. Ten clients answered from the same cached prices would otherwise write ten identical rows.
- **"Changed" is a fingerprint:** a hash of each holding's asset, amount, unit price and stale flag, compared with the latest snapshot inside one transaction. The stale flag is included, so the switch to degraded and back appears in the history.
- **Degraded valuations are recorded with `status: "degraded"`** so the chart can mark them. 503s are never recorded: there's no total.
- **Live check:** 11 simultaneous requests wrote 1 snapshot.
- **Trade-off:** points exist only when the value changed and someone looked. For continuous history I'd add a scheduled job valuing active portfolios.
- **Editing never rewrites history.** The next valuation records a new point because amounts are part of the fingerprint.

**Reading: `GET /portfolios/:id/history?from&to&maxPoints`**
- **`maxPoints` defaults to 500, capped at 2000**, so responses stay small however long the history grows.
- **Within the cap, points are raw.** Beyond it, the range is split into equal time buckets in one SQL `GROUP BY`, and the response says `downsampled: true`.
- **Downsampling keeps real values:** each bucket returns its latest real snapshot. An average would invent totals that never existed.
- **Downsampling can't hide a degraded period:** a bucket is degraded if any snapshot in it was.
- **Measured:** a 1-day window (about 1,150 snapshots) takes 1.4 ms; 400,000 snapshots take 122 ms, which blocks the synchronous driver. Retention keeps realistic sizes far below that.

**Stopping growth**
- **The biggest lever is upstream of retention:** skipping unchanged snapshots means a portfolio nobody views writes nothing.
- **Retention:** a job deletes snapshots older than `HISTORY_RETENTION_DAYS` (default 90) at startup and hourly, in batches of 5,000 so it never holds the write lock long, then returns the space with `incremental_vacuum`.
- **Deletion is the timeboxed version.** In production I'd keep raw points for a few days, hourly roll-ups for months and daily roll-ups for good.

## Front end

**Stack:** Vite + React 19 + TanStack Query + React Router, no component library. `/` lists portfolios; `/portfolios/:id` shows the value, the history chart and an **Edit portfolio** modal.

**Where state lives**
- **Server data** lives only in TanStack Query's cache, never copied into component state, so there's no second version to drift out of date.
- **The open portfolio** is in the URL, so reloads, the back button and shared links work without a state library.
- **Unsaved edits** live in a `useReducer` inside the form, copied from the saved portfolio when the editor opens. Nothing is sent until **Save**, closing discards the draft, and background refetches don't touch it.
- **Timers** (slow-load message, retry countdown) live in the small components that display them, so each tick re-renders only those.

**What re-renders when a holding is edited:** only the edited row. The reducer (plain, unit-tested functions) returns a new object for that row only; each row is memoised, with a stable callback and a stable client-side key; and the value panel and chart don't hold the draft, so they don't re-render.

**Saving:** validation reuses the API's zod schema from `contracts`, so client and server rules can't drift and both kinds of error appear next to the right field. After a save, the portfolio cache is updated from the response and the old valuation is discarded, since it describes holdings that no longer exist. A failed save keeps the edits in the form.

**History chart (visx)**
- **The browser never receives thousands of points.** `maxPoints` follows the measured chart width (about one point per pixel, in steps so small resizes reuse the cached response), and the API downsamples in SQL.
- **Rendering is cheap:** one `<path>` for the whole line, no animations, and the axes and line are memoised, so mouse movement re-renders only the crosshair and tooltip.
- **Library:** visx's low-level packages (d3 scales plus React SVG primitives) keep the chart code small and explicit. Rejected: Recharts (default animation, hidden rendering) and uPlot (imperative, outside React).
- **Honest about the data:** real snapshots get a dot, the tooltip reports only real snapshots, and stale-price valuations get a marker that downsampling can't hide.

**Loading, failure and stale states:** the value is fetched when a portfolio opens and after a save, never on a timer, so history points come only from real views.

| State | UI |
|---|---|
| First load | A loading message, plus a note after 1 second that live prices can take a few seconds, so a slow upstream reads as expected rather than broken |
| `degraded` | A banner naming the failing source and reason, a stale-prices badge on the total, and stale rows highlighted |
| 503 | The unpriced assets and why, no total, and a `Retry-After` countdown that retries automatically |
| Refresh fails | Old values stay visible, labelled with their time, never shown silently as current |
| 404 / network error | A message and a Retry button |

TanStack retries only network failures and 5xx other than 503; the 503 countdown honours `Retry-After` instead.

## Tests

Following the brief's "one meaningful test beats twenty trivial ones", every test checks a requirement. `npm test` runs 18 API tests (Vitest + supertest, in-memory SQLite, `fetch` replaced so there are no network calls) and 6 web tests (Vitest + Testing Library).

- **The one I'd point to first:** when CoinGecko rate-limits, `/value` returns a degraded 200 that labels exactly which prices are stale.
- **Failure:** no calls until `Retry-After` passes; a holding with no usable price gives a 503 and no partial total.
- **Good citizen:** 10 concurrent requests share one CoinGecko call; Friday's ECB rates stay fresh all weekend.
- **Storage and history:** a portfolio survives a restart; snapshots only on change; downsampling keeps real values and degraded periods.
- **Front end:** degraded and 503 states render honestly; a full edit sends one `PUT`; editing one row leaves the others untouched; `maxPoints` follows chart width.

## How I'd extend it

- **10x the portfolios or requests.** Upstream traffic wouldn't change, since the price cache is shared. The single process breaks first: move the price cache and in-flight sharing to Redis (with a lock so one instance fetches for all), then data to Postgres.
- **Background price refresh.** A scheduler fetching every held coin every 60 seconds gives one CoinGecko call a minute and an always-warm cache, at the cost of calls when nobody is looking. I'd limit it to recently viewed portfolios.
- **Two users edit the same portfolio.** Today the last write wins. I'd return an `ETag` from `updated_at`, require `If-Match` on `PUT`, and answer a mismatch with `409 Conflict`. The draft is already separate from saved data, so this is mostly UI.
- **A year or more of history.** Hourly and daily roll-up tables using the same "last snapshot, degraded if any" rule, with the endpoint picking the tier from the range and `maxPoints`.

## Shortcuts and what I'd do with more time

- Compile to `dist/` instead of running TypeScript through `tsx`.
- Move the price cache to Redis and SQLite to Postgres to run more than one API instance.
- Model ECB holidays instead of polling every 30 minutes on those days.
- Replace the fixed asset list with lists fetched from Frankfurter and CoinGecko.
- Structured logs with a request id that tags upstream calls, plus counters for upstream calls, cache hits and 429s.
- Prevent overwrites between editors with `If-Match`, and warn about unsaved edits when navigating away.
