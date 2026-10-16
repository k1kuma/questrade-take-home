# Decisions

The choices behind this repo, the trade-offs I accepted, and what I'd do with more time. Setup steps are in the [README](README.md).

## Stack and repo layout

- **TypeScript end to end, one npm-workspaces monorepo**: `apps/api`, `apps/web` (Vite + React), and `packages/contracts` (zod schemas and response types shared by the API and the React app). One language means the client and server can't drift on the API contract; changing a response type breaks the type check in both apps. Turborepo/Nx would be overkill at this size.
- **`npm start` at the root runs both apps** with `concurrently`. Each log line is prefixed `[api]` or `[web]`, and `--kill-others-on-fail` means a crash in one stops the other instead of leaving half the app running. `npm run start:api` and `npm run start:web` run each alone.
- **`npm start` runs the TypeScript directly via `tsx`**, with no build step. Shortcut for the timebox: in production I'd compile to `dist/` and run plain `node`.
- **No Docker.** See the next section.

## Why no Docker

The brief accepts either "a local `npm start` (or `docker compose up`)". I considered Docker seriously, because it decides more than packaging: with `docker compose up` as the way to run it, the backend could have been written in any language.

**What Docker would have given me**
- **A reproducible environment:** reviewers need only Docker, not a particular Node version.
- **Freedom to choose the backend language**, e.g. Go, whose `singleflight` package already implements request-merging.
- **Easy extra services:** Postgres or Redis are a few lines in a compose file.
- **It looks closer to production**, although the brief rules deployment out of scope.

**What it would have cost, within a 4–5 hour budget**
- **A persistence trap.** A SQLite file inside a container disappears when the container is recreated unless a named volume is set up. "Portfolios must survive a restart" is a stated requirement, so this is easy to fail by accident.
- **The native module.** `better-sqlite3` compiles native code for its platform. A `node_modules` built on macOS and mounted into a Linux container breaks, so the image has to build its own.
- **A slower development loop.** Image rebuilds, file watching through bind mounts on macOS, and attaching a debugger all add friction.
- **Networking.** The browser calls `localhost`, but containers reach each other by service name, which complicates the API proxy and CORS.
- **Live-demo risk.** The follow-up call means running everything on a shared screen. Docker Desktop, image builds and port clashes are each one more thing that can fail in front of the interviewers.

**Decision:** TypeScript was my strongest language, so the language freedom wasn't worth much, and every cost above was real. The repo runs on a stock Node 22+ with `npm install && npm start`. SQLite needs no server, so nothing is missing that a compose file would have supplied.

**When I'd add it:** as soon as there's a second process to run (Postgres or Redis for multiple API instances), or a deployment target. At that point the compose file pays for itself, with a named volume for data and the image building its own native modules.

## HTTP framework: Express 5

- **Express over Fastify** because it's what I know well enough to defend line by line.
- What Fastify would add is covered elsewhere:
  - zod handles validation.
  - A single error-handling middleware gives every error the same JSON shape.
- Express 5 passes errors from async handlers to the error middleware automatically, so handlers need no wrapper.
- Fastify's speed advantage doesn't matter here: every slow request is waiting on CoinGecko, not on the framework.
- `createApp(deps)` builds the app without starting a server, and receives its dependencies as parameters. Tests run against it with supertest and an in-memory database.

## Storage: SQLite (`better-sqlite3`)

**Why**
- **No setup**: the database is a single file. `npm start` is the whole setup and portfolios survive restarts.
- **Real transactions**: replacing a portfolio's holdings is all or nothing.
- **Constraints enforced by the database**: foreign keys, plus a primary key that rejects duplicate assets in a portfolio.
- **Cheap history queries**: an index on `(portfolio_id, computed_at)` keeps history reads fast.
- **Easy tests**: each test gets its own `:memory:` database.

**Trade-offs I accepted**
- **One writer at a time and one process only.** The file can't be shared safely between API instances. Running multiple instances would mean moving to Postgres (and moving the price cache to Redis).
- **No decimal or timestamp types.** Amounts are stored as decimal strings in `TEXT` columns. Timestamps are milliseconds since the epoch in `INTEGER` columns.
- **Weak typing by default**, so every table is declared `STRICT`.
- **No built-in data retention** (unlike TimescaleDB), so trimming history has to be done in application code.
- **Synchronous queries block the server.** That's fine for indexed lookups on a local file; it would matter for large unindexed scans.

**Connection settings**
- `journal_mode=WAL`: reads can happen while a write is in progress.
- `foreign_keys=ON`: SQLite leaves foreign keys off unless told otherwise.
- `busy_timeout=5000`: wait briefly for a lock instead of failing immediately.
- `synchronous=NORMAL`: the usual pairing with WAL.
- `auto_vacuum=INCREMENTAL`: lets the file shrink after history is trimmed. It must be set before the first table is created.

**Driver:** `better-sqlite3` is mature and synchronous. `node:sqlite` needs no native build but is still marked experimental in Node 24.

## Data model

| Table | Status | Shape |
|---|---|---|
| `portfolios` | built | `id` (UUID), `name` (required, 1–100 characters, enforced by a `CHECK`), `created_at`, `updated_at` |
| `holdings` | built | one row per holding: `(portfolio_id, asset)` primary key, `amount TEXT` |
| `price_cache` | built | last known good price per asset: `price_cad`, `source`, `as_of` (when the upstream says the price is from), `fetched_at` (when we received it) |
| `valuations` | built | one snapshot per distinct valuation: `computed_at`, `total_cad`, `status`, `fingerprint`, per-holding `breakdown` JSON. Indexed on `(portfolio_id, computed_at)` |

- **One row per holding, not a JSON column on `portfolios`.** The database enforces one row per asset and cascades deletes. A JSON column would also work, since a portfolio is always read whole, but the rule against duplicate assets would then live only in the application.
- **`PUT` replaces the full list of holdings** in one transaction, rather than patching individual holdings. That matches how the edit form saves, and an invalid `PUT` leaves the stored holdings untouched.
- **`GET /portfolios`** returns the most recently updated portfolios first, with their assets, so the UI can pick one. It's backed by an index on `updated_at`, with `?limit` (default 50, maximum 200) so the response can't grow without bound. The assets are loaded in one extra query for the whole page, not one query per portfolio. The brief didn't ask for it, but without it the UI has no way to find a portfolio.
- **`price_cache` stores two timestamps** because they mean different things. `as_of` decides whether a price is too old to use as a fallback; `fetched_at` decides whether we need to ask the upstream again.
- **Migrations** are an append-only list of SQL scripts. The database's `PRAGMA user_version` records how many have run. `migrate(db, target)` can stop at a version, so a test can build an old schema, insert rows, and check that a later migration upgrades real data correctly.
- **Portfolio names are required, added by a migration after the fact.** SQLite's `ADD COLUMN` can't add a `NOT NULL` column without a default. The migration therefore uses a placeholder default that only satisfies the constraint for rows that already exist, then renames those rows "Portfolio 1…N" in creation order in the same transaction. Names aren't unique; the UUID stays the identity.

## Input validation

- **Two body forms, decided by shape:**
  - **`{ name, holdings }`** requires a non-blank name (trimmed, at most 100 characters).
  - **The brief's bare array** means "holdings only": `POST` names the portfolio "Portfolio N", and `PUT` keeps the current name.
  - **Why:** I wanted every portfolio to have a name without making the brief's own example request fail with a 400. N is counted inside the insert transaction, so two simultaneous creates can't get the same number. N is the number of portfolios plus one, so after deletions, numbers could repeat; names aren't identities, so that's acceptable.
- Asset codes are trimmed and upper-cased, checked against a fixed list (9 cryptocurrencies plus the 30 ECB currencies Frankfurter publishes), and duplicates are rejected.
- Amounts can be JSON numbers or decimal strings. They must be positive and are stored in a canonical form via `decimal.js` (`"007.50"` becomes `"7.5"`, `1e-7` becomes `"0.0000001"`). Strings keep precision beyond what a float can hold.
- Empty portfolios are allowed, because the edit form can remove every holding.
- **Known limitation:** duplicate assets are only reported once every holding's fields are valid, because zod skips whole-object checks while individual fields are failing.

## Upstream clients

**The two APIs differ in almost every way that matters, and both are normalised into one internal shape** (`CachedPrice`: asset, CAD price as a decimal string, `asOf`, `fetchedAt`):

| | CoinGecko `GET /simple/price?ids=bitcoin,ethereum&vs_currencies=cad&include_last_updated_at=true&precision=full` | Frankfurter `GET /v1/latest?base=EUR` |
|---|---|---|
| Response | `{ "bitcoin": { "cad": 114911.87, "last_updated_at": 1792170000 } }` | `{ "amount": 1, "base": "EUR", "date": "2026-10-16", "rates": { "CAD": 1.5935, "USD": 1.1253, … } }` |
| Asset identity | Coin ids (`bitcoin`), mapped from tickers by a `Record<CryptoAsset, string>`, so adding a coin without an id is a compile error | ISO codes (`USD`), used directly |
| Quote | Already in CAD | Units **per EUR**: CAD price of X is `rates.CAD / rates.X`, computed with `decimal.js` |
| Timestamp | Unix seconds, per coin | A date only. `asOf` becomes 16:00 Frankfurt time on that date, the ECB publish time |
| Update cadence | Continuous; its CDN caches for 60 s | Once per working day |
| Missing data | Unknown ids silently left out | Unpublished currencies left out; a missing `CAD` rate is a `bad_response` |
| Limits | ~10–30 calls/min keyless, 429 with `Retry-After` | No published limit |

- **Two small classes, `CoinGeckoClient` and `FrankfurterClient`**, which convert each API's response into prices in CAD stored as decimal strings. Nothing outside `pricing/` sees CoinGecko coin ids or the EUR base.
- **Upstream responses are validated with zod** before use. An unexpected shape becomes an error instead of producing `NaN` values in a total.
- **One error type, `UpstreamError`**, carrying the source and a reason: `rate_limited` (with the delay from `Retry-After`, if given), `timeout`, `unavailable` (HTTP 5xx or a network failure), or `bad_response`. One type with a reason field keeps the failure handling a single `switch`, and the reason is what the API response shows (`staleReason`).
- **Every call has a timeout** (`AbortSignal.timeout`, default 4 s). It covers both the wait for headers and reading the body, so a stalled upstream can't hold a request open.
- **CoinGecko is asked for `precision=full`.** By default it rounds prices; BTC came back as whole dollars.
- **Coins missing from a response are left out**, not treated as an error. CoinGecko silently omits ids it doesn't recognise, and one missing coin shouldn't throw away the rest. The price service treats a missing coin as "no price" (`bad_response`) and doesn't ask for it again until its 60 seconds pass.
- **`fetch` can be swapped in tests**, so they cover 429, timeouts and malformed responses without network calls.

## Caching and freshness

The goal is to make upstream traffic depend on the clock, not on how many clients are asking. All of it sits behind one call, `PriceService.getPrices(assets)`. That call never fails because of an upstream; each asset comes back `fresh`, `stale` (with a reason), or `unavailable` (with a reason).

**Crypto (CoinGecko): fetch when a request needs a price, then cache it (`CryptoPriceCache`)**
- **The core rule:** we ask CoinGecko about each coin at most once per 60 seconds, whether the call succeeds or not, however many requests arrive.
- **Why 60 seconds:** CoinGecko's own CDN caches `simple/price` for 60 seconds (`cache-control: … s-maxage=60`), so asking more often mostly returns the same price anyway.
- **Prices are cached per asset**, so all portfolios share them; there's no per-portfolio cache.
- **Simultaneous requests share one call.** While a coin is being fetched, other requests for it wait on that same in-flight fetch instead of starting their own. Ten clients within a minute cause at most one CoinGecko call; a test checks this, and a live run with 10 simultaneous requests made exactly one call.
- **Calls pick up other coins on the way.** When a call goes out anyway, it also includes any cached coin more than halfway through its 60 seconds. `simple/price` accepts many ids in one call, so portfolios holding different coins mostly share calls.
- **Missing coins aren't re-asked straight away.** A coin CoinGecko left out of a response isn't asked about again until its 60 seconds pass, so one bad id can't cause a call on every request.
- **No serving stale data during a refresh.** After 60 seconds, the next request waits for a fresh price, rather than getting the old price while a refresh happens in the background. Otherwise a "stale" label would appear during normal use.
- **Rejected alternative:** a background job refreshing every N seconds. It keeps traffic flat, but spends calls when nobody is looking and needs a scheduler. It's the better design once there are many portfolios.

**Fiat (Frankfurter): exploit the once-a-day publishing schedule (`FiatRateCache`, `ecbCalendar`)**
- **One call gets everything.** A call with the native EUR base returns every currency, and each currency's CAD price is computed as `EURCAD / EURX` with `decimal.js`.
  - I avoided `?base=CAD`: Frankfurter rounds those cross rates to about 5 significant figures, and inverting them rounds a second time. EUR→CAD came back as 1.59839… instead of the ECB's 1.5984.
- **The whole rate table is fetched again only after the next expected ECB publish:** 16:00 Frankfurt time on weekdays. The calendar converts that to UTC correctly in both summer and winter time; tests cover the October DST change. That's about one call per working day.
- **What "fresh" means for a rate:** we've successfully checked Frankfurter since the last expected publish, whatever date the rate carries. So Friday's rate on Sunday is correctly labelled fresh, because it is the current rate.
- **When the expected date hasn't appeared yet:** if we've checked since publish time but still have an older date (the ECB is late, or it's a holiday), we check again every 30 minutes. I didn't model ECB holidays: Good Friday, Easter Monday, May 1, and Dec 25 and 26. On those days this costs at most 48 extra calls a day, and only while clients are asking. With more time I'd add the holiday calendar.
- **`as_of` for a fiat rate is 16:00 Frankfurt time on its ECB date**, which makes it comparable with crypto's timestamps.

**CAD** is the valuation currency, priced at exactly 1 with the source `fixed`. It never touches an upstream, so a Frankfurter outage can't make CAD holdings unpriceable.

**Upstream call budget (the brief quotes CoinGecko at about 10–30 calls a minute)**
- **CoinGecko: at most one call per coin per 60 seconds**, however many clients or portfolios ask. With 9 supported coins the hard ceiling is 9 calls a minute, and in practice it's about 1, because coins due soon ride along in the same call. After a failure, nothing is sent until the upstream's `Retry-After` time (or 60 seconds without one). That's usually 60 seconds for CoinGecko, but a shorter hint is honoured. With a key set, there's one extra `/ping` at startup.
- **Frankfurter: about one call per working day**, plus at most two an hour while an expected ECB publish is late.
- **The budget doesn't grow with traffic or with the number of portfolios.** It does grow with the number of API instances, because each process has its own cache, and the rate limit is per account. That's why Redis comes before a second instance (see "How I'd extend it").

**Restart behaviour:** every successful fetch is written to `price_cache`, which is read back at startup. A restart within the 60 seconds makes no calls, and fallback prices survive. A test checks this.

## Upstream failure handling

**Built (in the price service)**
- **Back off after any failure.** When an upstream fails (429, timeout, 5xx or a malformed response), no further calls go to that upstream until its `Retry-After` time passes, or for 60 seconds if it didn't send one. The rate limit applies to the whole account, not per coin, so the back-off covers every coin.
- **Fall back to the last known good price, labelled `stale` with the failure reason**, provided the price isn't too old:
  - **Crypto: 24 hours.** Crypto can move several percent in a day.
  - **Fiat: 7 days**, configurable with `FIAT_MAX_STALE_DAYS`.
    - **Why not less:** the longest normal gap between ECB publishes is about 5 days, at Easter. Any shorter limit would reject the genuinely current rate during a Frankfurter outage over a holiday.
    - **Why not more:** 7 days leaves about 2 days of margin. Major currencies typically move only about 1% in a week, and the rate's date is always shown. Beyond about two weeks, an outage is probably structural (the API moved or changed), and failing is what gets it noticed.
  - Past those limits, or with nothing cached, the asset is `unavailable`.
- **Only the failing upstream is affected.** A CoinGecko outage doesn't affect USD/EUR holdings, and vice versa. If Frankfurter is down and CoinGecko is fine, crypto stays fresh and fiat holdings fall back to the last ECB rate (with its date), labelled stale: a degraded 200, not an error.
- **Timeouts and retries:** every upstream call has a 4-second timeout, and **the server never retries within a request.** A retry would double the wait for the client, and it would spend rate-limit budget at the moment the upstream is struggling. Instead, the failure starts a back-off, and every request during it is answered straight away from the fallback, without waiting on the upstream. Retrying is left to the client: TanStack retries network blips, and a 503's countdown honours `Retry-After`.

**How this maps to HTTP responses (`GET /portfolios/:id/value`):**

| Situation | Response |
|---|---|
| All prices fresh | `200`, `status: "complete"` |
| Some prices stale, but every asset has a usable price | `200`, `status: "degraded"`. Each affected holding has `stale: true`, its `asOf` time, and a `staleReason` (`rate_limited`, `timeout`, `unavailable`, `bad_response`). `sources.coingecko` / `sources.frankfurter` say which upstream is stale and when it will be retried |
| Any asset `unavailable` | `503` with a `Retry-After` header and the list of unpriced assets with reasons. **No total is returned** |

- **Degraded is a 200.** The service still produced a meaningful answer, and the honesty comes from explicit labels on each holding and source. Status 206 is meant for byte-range requests, so it would be the wrong signal.
- **Why 503 instead of a partial total:** the total is the main number. A total that leaves out a holding is wrong even with a label on it.
- **`Retry-After` is the *latest* recovery time among the upstreams the portfolio needs**, because a retry only succeeds once all of them have recovered. If the upstream gave no hint, it's 60 seconds.
- **Checked live with `SIMULATE_COINGECKO=429`:**
  - A portfolio with cached prices got a degraded 200, with the same total from the last good prices, CoinGecko labelled `rate_limited`, and Frankfurter still `fresh`.
  - A portfolio holding a never-fetched coin got a 503 with `Retry-After: 60`.
  - CoinGecko was called once, then left alone during the cooldown.

## Valuation response

- **One shape for every asset.** Each holding has `amount`, `unitPriceCad`, `subtotalCad`, `source` (`coingecko`, `frankfurter` or `fixed`), `asOf`, and `stale`. Clients never see CoinGecko ids, EUR-based rates or each API's own conventions.
- **Money rounding:**
  - Unit prices keep the upstream's full precision.
  - Subtotals are rounded to cents.
  - The total is the sum of the *unrounded* subtotals, rounded once (half-even). It can therefore differ by a cent from adding up the displayed subtotals; I chose the more accurate total over one that adds up visually.
  - Everything is computed with `decimal.js` and sent as strings, so no float rounding creeps in.
- **`asOf` is when the upstream says the price is from**, not when we fetched it. For fiat it's 16:00 Frankfurt time on the rate's ECB date, so a Friday rate shown on Sunday says so.

## CoinGecko API key

- **The key is optional, and keyless is the default.** Reviewers can run the service without signing up for anything.
- **With a key:** set `COINGECKO_API_KEY` in a git-ignored `.env.local`, and it's sent as the `x-cg-demo-api-key` header. `npm start` loads that file with Node's built-in `--env-file-if-exists`, so there's no `dotenv` dependency, and a missing file isn't an error. Tests never read it, so they stay hermetic.
- **The key changes nothing in the design.** The free Demo plan still has a per-minute limit and a monthly call cap, and CoinGecko can still return 429 or time out. The cache, the request-merging and the degraded responses are all built assuming that. At most one call per minute, running non-stop, would exceed a monthly cap in the low tens of thousands. That's another reason to fetch only when a client actually asks, rather than run a fixed background job.
- **An invalid key would fail silently, so the server checks it at startup.** I checked live:
  - `/simple/price` returns 200 for a bad key, apparently falling back to public-tier limits. A typo in the key wouldn't break anything; it would just quietly lower the rate limit, which would only show up as 429s arriving sooner than expected.
  - `/ping` does reject a bad key, with a 401.

  So when a key is set, the server calls `/ping` once at startup and logs `API key accepted`, a warning that the key was rejected and the app is running at public-tier limits, or that it couldn't verify the key.
  - **It never delays or blocks startup:** the call isn't awaited, and the method can't throw.
  - It's skipped while `SIMULATE_COINGECKO` is on, because every CoinGecko call fails deliberately then.
  - Checked against the real API: my key is `valid`, a fake one `rejected`.
- **`SIMULATE_COINGECKO=429|timeout`** swaps CoinGecko's `fetch` for one that returns a 429 (with `Retry-After: 60`) or hangs until the timeout fires. Everything above the network layer runs unchanged, so it demonstrates the real failure path, not a mocked one. The server logs a warning at startup when it's on, so it can't be left on unnoticed.

## Valuation history

**Recording (built)**
- **A snapshot is recorded when a value is computed, unless nothing that affects the value has changed since the previous snapshot.** That's a deliberate reading of "record a valuation snapshot whenever a portfolio's value is computed". Ten clients answered from the same cached prices would otherwise write ten identical rows, which is exactly the kind of growth the brief asks about.
- **How "changed" is decided:** each snapshot stores a fingerprint, a SHA-256 hash of each holding's asset, amount, unit price and stale flag. It's compared with the portfolio's latest snapshot inside one transaction.
  - `asOf` is left out on purpose, so a price that was re-fetched but hasn't moved doesn't create a point.
  - The stale flag is included, so the switch to degraded (and back) appears in the history.
- **Degraded valuations are recorded with `status: "degraded"`**, so the chart can mark them. **503s are never recorded**: there's no total to record.
- **Live check:** 11 simultaneous requests wrote 1 snapshot; the later rate-limited request wrote 1 `degraded` snapshot.
- **Trade-off:** history only has points when the value changed or someone looked. A gap means "unchanged or not viewed", so the chart marks each real snapshot with a dot, and the caption says when points are recorded. With continuous history needed, I'd add a background job valuing active portfolios on a fixed schedule.
- **`breakdown` JSON** (about 1 KB a snapshot) lets you explain any point later: which prices, from which source, and how stale. Dropping it is the first lever if storage matters.

**Reading: `GET /portfolios/:id/history?from&to&maxPoints` (built)**
- **The defaults:** `from` is the first snapshot, `to` is now, and `maxPoints` is 500, capped at 2000. Responses therefore stay small however long the history gets, and the client can request roughly one point per pixel of chart width.
- **Raw or downsampled:** if the range holds `maxPoints` or fewer snapshots, they're returned raw. Otherwise the range is split into equal time buckets, one point each, and the response says `downsampled: true`.
- **Downsampling keeps real values.** Each bucket's point is the **latest real snapshot** in it. An average would invent totals that never existed, and averaging decimal strings would mean converting them to floats.
- **Downsampling can't hide a degraded period.** A bucket is `degraded` if **any** snapshot in it was, so a rate-limited stretch stays visible at any zoom level.
- **The SQL is one `GROUP BY`** that relies on a documented SQLite behaviour called "bare columns". With exactly one `max()` aggregate, the other columns come from the row that holds the maximum.
  - A window-function version gives identical results but measured 3.4× slower: 422 ms against 122 ms on 400,000 rows.
  - It's SQLite-specific; on Postgres I'd use `DISTINCT ON`.
  - A test checks the SQL point by point against a plain TypeScript reference implementation.
- **Measured cost, single portfolio:**
  - A 1-day window of about 1,150 snapshots takes 1.4 ms.
  - 400,000 snapshots take 122 ms. Since better-sqlite3 is synchronous, that blocks the server for the whole query.
  - Retention caps the realistic size at about 130,000 (90 days × one per minute), which is roughly 40 ms.
  - With more time: run heavy queries in a worker thread, or read from pre-aggregated hourly and daily tables.

**Growth: retention (built)**
- **What it deletes:** a job removes snapshots older than `HISTORY_RETENTION_DAYS` (default 90). It runs once at startup and then hourly.
  - Deletion happens in batches of 5,000, each its own short transaction, so it never holds the write lock for long. A separate index on `computed_at` keeps it from scanning the whole table.
  - `PRAGMA incremental_vacuum` then gives the freed space back to the operating system.
  - Deleting 250,000 rows took 262 ms.
- **Failure handling:** a failed run is logged and retried next hour; it can't crash the server. The timer is `unref()`ed so it never keeps the process alive on its own.
- **Why deletion and not roll-ups:** deletion is the timeboxed version. In production I'd keep raw points for a few days, hourly roll-ups for months and daily roll-ups for good, so long charts never touch raw rows.
- **The bigger growth lever is upstream of retention:** skipping unchanged snapshots means a portfolio nobody looks at writes nothing.

**Edits and history**
- **Editing never rewrites history.** `PUT` replaces the holdings in one transaction and leaves the existing snapshots alone. Each snapshot's `breakdown` still says which holdings and prices produced that point.
- **The next valuation records a new point**, because the amounts are part of the fingerprint. The web app asks for that valuation straight after saving, so the edit shows up on the chart within a second.
- **The chart doesn't distinguish an edit from a price move:** both are a step. With more time I'd store a holdings version (or an `edited` event) with each snapshot, so the chart could mark edits, and a "performance" view could separate market movement from deposits and withdrawals.

## Front end

**Stack:** Vite + React 19 + TanStack Query + React Router (only its simplest mode: `BrowserRouter`, `Routes`, `Link`, `useParams`), with no CSS framework or component library. The Vite dev server forwards `/api/*` to the API, so the browser makes same-origin calls and the API needs no CORS setup.

**Styling:** one plain stylesheet ([index.css](apps/web/src/index.css)) with no preprocessor or CSS-in-JS. The colours, radii and component shapes (cards, alerts, badges, buttons, list tables) are borrowed from the TrackInsight enterprise app's design tokens and set as CSS custom properties. Interactive state is styled from ARIA attributes (`aria-pressed`, `aria-invalid`) rather than extra classes, so the look can't disagree with what assistive tech is told.
- **Responsive:** phones (under 600px), tablets (600–899px), desktop. Below 900px the holdings table becomes a grid of cards (two across on tablets, one on phones); below 600px the portfolio list stacks each row, header actions and the range switch go full width, and inputs are 16px so iOS doesn't zoom on focus. The `<table>` markup stays the same; only CSS changes, with `data-label` providing the labels the hidden column headers used to.
- Hover effects apply only on devices that can hover, and animations respect `prefers-reduced-motion`.

**Pages**
- **`/`** lists every portfolio (most recently updated first) as a table: **Name** (a link to its page), **No. of holdings**, **Last updated**. Its **New portfolio** button opens the same modal form as editing (`PortfolioForm`), starting with BTC and USD rows at 0. **Create** stays disabled until at least one amount is above 0, and rows still at 0 are left out of the request (the shared schema rejects a 0 amount, and 0 there means "not held"). The name is optional there: left blank, the form sends the brief's bare array and the API names it "Portfolio N". After creating, the app opens the new portfolio's page.
  - It deliberately doesn't show each portfolio's value. That would mean one `/value` call per row on every visit. The prices behind them are shared and cached, but it's still one request per portfolio, and a single CoinGecko failure would fill the list with errors.
  - It shows the API's first page of 50. Pagination is a "with more time" item.
- **`/portfolios/:id`** shows one portfolio: its name and an **Edit portfolio** button (which opens the holdings editor in a modal), the current value and the history chart. A direct link or a reload works, because Vite serves the app for any path that isn't `/api`.

**Where state lives**
- **Server data** (the portfolio list and valuations) lives only in TanStack Query's cache, never copied into component state. Copying it would create a second version that can drift out of date, which is the usual source of stale-UI bugs.
- **Which portfolio is open** lives in the URL path, read with `useParams`. Reloads, the back button and shared links all work, and there's no state library to explain.
- **Timers** (the slow-loading message and the retry countdown) live in the small component that displays them, so a tick each second re-renders only that component.

**Components**
- `PortfolioPage` reads the id from the URL and renders a `ValuationPanel` keyed by that id. The key means switching portfolios starts with fresh component state; an old portfolio's countdown can't carry over.
- `ValuationPanel` owns the query and decides which state to show. `FreshnessBanner` and `HoldingsTable` just display.
- **`HoldingsTable` is wrapped in `memo`.** When a background refetch returns identical holdings, TanStack Query reuses the same array object, so the table skips re-rendering.

**Holdings editor** (the brief asks where state lives and what re-renders when a holding is edited)
- **Two kinds of state, kept apart:**
  - **Saved data** is TanStack Query's `usePortfolio(id)`.
  - **Unsaved edits** live only inside the form (`PortfolioForm`, which `HoldingsEditor` wraps with the update mutation), in a `useReducer`, copied from the saved portfolio when **Edit** is clicked.
  - Nothing is sent until **Save**, and closing discards the copy simply by unmounting the editor.
  - **It's a modal on the native `<dialog>`** ([Modal.tsx](apps/web/src/components/Modal.tsx)). `showModal()` gives the focus trap, inert page and Esc handling, so there's no dialog library. A draft that isn't sent until Save is a self-contained task, and a modal stops the editor pushing the value and chart down the page or showing unsaved amounts next to the old total. On phones it's a full-screen sheet with Cancel/Save pinned to the bottom.
  - **Closing never drops edits silently.** Cancel, Esc, the × button and a backdrop click all go through one `requestClose`: with no changes it closes; with changes it swaps the footer for "Discard your unsaved changes?" (**Keep editing** / **Discard**); during a save it does nothing. Esc is handled on `keydown`, because browsers can skip the dialog's `cancel` event (Chrome does on a repeated Esc) and close it outright.
  - The two footers have different React `key`s. Without them React reused the button elements, so a focused **Keep editing** became the focused **Save** button mid-keypress and Enter saved the draft; a test pins this.
  - A refetch of the portfolio while you're editing (e.g. on tab focus) doesn't touch your edits, because the reducer was initialised once and isn't kept in sync.
- **The reducer ([draft.ts](apps/web/src/components/editor/draft.ts)) is plain functions with no React:** `rename`, `addRow`, `removeRow`, `editRow`. It's unit-tested directly.
  - Every row gets a stable client-side `key`, not its array index, so removing a row can't move another row's input or error message.
  - Values stay as typed strings until save, so `0.10` isn't silently turned into `0.1` while you type.
- **What re-renders when one amount changes:**
  1. The reducer returns a new draft in which only the edited row is a new object; the other rows are the same objects as before (a test checks this).
  2. `PortfolioForm` re-renders (its `HoldingsEditor` wrapper doesn't, since the draft isn't its state).
  3. Each `EditableRow` is `memo`ed and receives the row object, two error strings and a stable `edit` callback (`useCallback` with no dependencies, since `dispatch` and `setErrors` never change). So **only the edited row** re-renders.
  4. The page heading and `ValuationPanel` don't re-render at all, because the edits aren't in their state.
  5. Even opening and closing the editor doesn't re-render the value panel: that open/closed flag lives in a small `PortfolioHeader` component next to it.
- **Validation uses the same zod schema as the API** (`PortfolioInputSchema` from `contracts`), checked before anything is sent.
  - Client and server report errors with identical paths (`holdings.1.amount`), so one function, `toFieldErrors`, places both client and server errors next to the right field. It translates the index into the row's key at the moment of the error.
  - **The cost:** zod now ships to the browser, and the bundle grew from 82 kB to 120 kB gzipped. The benefit is that validation rules can't drift between client and server. The server still validates everything; the client check is only for faster feedback.
- **Saving** is `useUpdatePortfolio`, a `PUT` with `{ name, holdings }`. On success:
  - The response is written straight into the portfolio cache (`setQueryData`), so the heading shows the new name immediately with no extra `GET`.
  - The cached valuation is **discarded (`resetQueries`), not just marked out of date.** It was computed for the old holdings, so showing it with a "Refreshing…" note would display a total for a portfolio that no longer exists. The panel shows its loading state instead.
  - The list is marked out of date, but nothing waits for that. The `onSuccess` handlers deliberately return nothing; returning the invalidation's promise would make TanStack wait for the list to refetch before closing the editor. Creating a portfolio uses the same pattern.
- **If a save fails:** a 400 puts each server message next to its field. Any other failure shows a form-level message. In both cases your edits stay in the form.
- **Shortcuts:**
  - **Last write wins.** Two tabs editing the same portfolio silently overwrite each other. In production I'd send `If-Match` with the `updatedAt` the edit started from and return 409 on a mismatch.
  - Navigating away with unsaved edits doesn't warn you.

**History chart (visx)** (the brief asks how the chart stays responsive with thousands of points)
- **Library: visx's low-level packages**, not its ready-made `xychart`. Those packages are d3 scales plus React SVG building blocks (`LinePath`, `AxisLeft`, `Bar`, `useTooltip`, `useParentSize`), and the chart itself is about 120 lines of my code that I can explain line by line.
  - **Rejected:** `xychart` and Recharts animate by default and hide the rendering. uPlot is the fastest (canvas) but is driven by imperative code outside React.
  - **Bundle cost: +28 kB gzipped** (120 kB to 148 kB), all d3 scale/shape/time code. No animation library: `@react-spring` isn't installed.
- **The main reason it stays responsive: the browser never receives thousands of points.**
  - `maxPoints` comes from the measured chart width: about one point per pixel, rounded up to steps of 250, between 250 and 2000. A response never has more points than the chart can show.
  - The API downsamples in SQL, keeping each time bucket's latest real snapshot.
  - The step of 250 means small window resizes reuse the cached response instead of refetching. `useParentSize` also waits 200 ms after resizing stops before measuring, and ignores height changes. (Not the `ParentSize` component: it renders the chart in an absolutely positioned child, so the card around it collapsed to zero height.)
- **Rendering cost is one `<path>` for the whole line**, not one element per point. There are no per-point dots (only the few degraded points get a marker) and no animations.
- **Memoisation, aimed at what actually changes:**
  - Converting the points, building the scales, and the whole "static layer" (axes, line, markers) are memoised on the data and size.
  - Moving the mouse updates the tooltip's state and re-renders `HistoryChart`, but the static layer is the same element object, so React skips the path and axes entirely. Only the crosshair and tooltip re-render.
- **Line or Step, chosen by the user (Line by default).** Snapshots are recorded only when someone opens the portfolio and the value has changed, so what happened between two of them depends on the gap:
  - Between two close points (e.g. a save, or reopening the page soon after), the value most likely held, and **Step** (`curveStepAfter`) draws exactly that.
  - Across a gap where nobody looked, the value is unknown, and a step would claim it stayed flat. **Line** (`curveLinear`) joins the points directly, which is the usual reading of a value chart and doesn't pretend to know more.
  - I first shipped Step only. Seeing real data changed my mind: most history is "looked at occasionally", where steps overstate certainty, and an edit drew a wall rising from the bottom of the chart.
  - Either way, **real snapshots get a dot** (while they're at least 6 px apart on average), so interpolated stretches are visibly not observations.
- **The tooltip only ever reports a real snapshot.** In Step mode, it's the one in effect at the cursor (the last at or before it), not the nearest, which could be a value that hadn't happened yet. In Line mode, it's the nearest snapshot, because the values between points are interpolated. Both use one binary search (O(log n)) and are tested.
- **Honest about stale prices:** valuations made with stale prices get a yellow marker, and the summary under the chart says what the markers mean. Downsampling can't hide them, because a bucket is degraded if any snapshot in it was.
- **Ranges: 24h / 7d / 30d / All.** The range's start time is computed when the request is made, not stored in the query key, which would otherwise change on every render. While a new range or width loads, the previous chart stays visible (`keepPreviousData`) with an "Updating…" note.
  - When the data starts after the range does, the x-axis starts at the first snapshot, and the caption says so ("The chart starts at the first snapshot (…)"). Earlier, the axis always covered the whole range, which honestly showed the empty days but squeezed a few hours of real data into a sliver at the right edge.
- **Keeping it current:** every valuation may record a snapshot, so when a new valuation arrives, the history queries for that portfolio are marked out of date. That includes the reload after saving the editor.
- **Accessibility:** the SVG is `aria-hidden`. The text under it gives the point count, whether the data is downsampled, the latest value, the low and the high, so the information isn't only visual.

**Freshness: on demand, not polled**
- The value is fetched each time a portfolio's page opens (and again after saving an edit), and never on a timer, on tab focus or on reconnect (`refetchOnMount: 'always'`, no `refetchInterval`). Each valuation may record a history snapshot, so history points come only from someone actually opening that portfolio, never from a page left open. Reopening the page gets a current value.
- **While a re-fetch is in flight, the previous numbers stay visible** (e.g. when coming back to a portfolio already in the cache), with a small "Refreshing…" note.

**What the user sees, by state** (the brief asks about the 3-second wait and failures specifically)

| State | UI |
|---|---|
| First load | "Loading portfolio value…". After 1 second it adds *"Fetching live prices from CoinGecko and the ECB can take a few seconds"*, so a cache miss (up to the 4-second upstream timeout) reads as expected rather than broken. Under a second, there's no extra text and no flicker |
| `complete` | Total, computed time, and one row per holding showing when its price is from ("ECB rate of Oct 2" for fiat) |
| `degraded` | A warning banner naming the failing source and reason ("CoinGecko is rate-limiting requests; next attempt after 12:05"), an "includes stale prices" badge on the total, and stale rows highlighted with a reason badge |
| 503 | The unpriced assets and why, an explicit "No total is shown rather than a partial one", and a countdown from `Retry-After` that retries automatically when it reaches zero, plus a "Try now" button |
| Refresh fails with old data on screen | The old values stay visible, with a banner saying the refresh failed and the time they're from. Old numbers are never shown silently as current |
| 404 / network error | A clear message and a Retry button |

**Retries:** TanStack retries only network failures and 5xx other than 503, twice. It doesn't retry a 4xx (it won't change) or a 503 (the countdown handles that, honouring `Retry-After` instead of guessing). The countdown is the only timed fetch, and a 503 never records a snapshot.

**Tests:**
- `ValuationPanel` is rendered against mocked `fetch` responses to check that a degraded response shows its banner, badge and stale rows, and that a 503 shows the unpriced asset, no total, and the countdown.
- A routing test checks that `/` lists each portfolio as a link to `/portfolios/:id`.
- The editor's tests check that:
  - unedited rows keep their identity, so their memoisation works;
  - an invalid amount is blocked before any request is sent;
  - a full edit (rename, change, add, remove) sends exactly one `PUT` with the expected body;
  - a server 400 appears next to the right row, without losing the edits;
  - creating sends the bare array when the name is blank (so the API names it) and `{ name, holdings }` when it isn't, then opens the new portfolio;
  - it opens as a modal and closes straight away when nothing changed;
  - with unsaved changes, Cancel and Esc ask before discarding, and the confirmation's buttons are never reused as Save/Cancel.
- The chart's tests check:
  - the step-chart lookup at the exact edges (before the first point, on a point, after the last);
  - the y-axis padding, including for a flat line;
  - the width-to-`maxPoints` rule;
  - that it renders one path, with markers only for degraded snapshots;
  - that a single snapshot renders as a dot, and that every real snapshot gets a dot or a stale marker;
  - that Line and Step draw different paths, and that the line tooltip picks the nearest real snapshot (including ties and both ends).

## Tests

`npm test` runs 73 API tests (Vitest + supertest against an in-memory SQLite database, with `fetch` replaced, so there are no network calls) and 23 web tests (Vitest + Testing Library). The ones I'd point to first are about failure, because that's where the design matters:
- **429:** after a 429, the last good price is labelled stale, and no further calls are made until `Retry-After` passes. Through the HTTP API, a rate limit produces a degraded 200 that labels exactly which prices are stale.
- **No partial totals:** a holding with no usable price gives a 503 with `Retry-After` and no total.
- **Load:** concurrent requests for the same coins share one CoinGecko call; cached prices are served for 60 seconds; coins near expiry ride along.
- **Fallback limits:** crypto older than 24 hours and fiat older than 7 days become unavailable instead of being served.
- **Timeouts, 5xx, network errors and malformed JSON** each map to the right failure reason.
- **ECB calendar:** Friday's rate is fresh on Sunday; the 16:00 publish time is correct in both summer and winter time; rechecks every 30 minutes while a publish is late.
- **Restart:** portfolios and cached prices survive it, and no CoinGecko call is made within the 60 seconds.
- **History:** snapshots are recorded only on change; downsampling thousands of snapshots keeps real values and degraded periods; retention deletes in batches.
- **Front end:** see the test list under "Front end" above.

## How I'd extend it

These are the "what if…" changes I'd expect to be asked about, and what I'd do for each.

- **10x the portfolios or requests.**
  - Upstream traffic wouldn't change, because the price cache is shared and capped per coin.
  - What breaks first is the single process: SQLite allows one writer, and the cache is in memory. A second API instance would double the CoinGecko calls against the same account limit.
  - So the order is: the price cache and the in-flight sharing move to Redis first (with a lock, so one instance fetches for all); then Postgres for the data, so several API instances can run. Long history queries, which are synchronous in better-sqlite3, would move to a worker or to pre-aggregated tables.
- **Prices refresh in the background instead of on request.**
  - A scheduler would call `getPrices` for every coin any portfolio holds, every 60 seconds. That's one batched CoinGecko call a minute, whatever the traffic, and requests would always hit a warm cache.
  - The same job could value active portfolios on a schedule, giving the history evenly spaced points.
  - The cost: calls are made when nobody is looking, which counts against a monthly call cap. I'd only refresh portfolios viewed recently.
- **Two users edit the same portfolio at once.**
  - Today the last write wins.
  - I'd add optimistic concurrency: `GET` returns an `ETag` (from `updated_at`), `PUT` requires `If-Match`, and a mismatch returns `409 Conflict` with the current version.
  - The editor would then show what changed and let the user reapply their edits. The draft reducer already keeps edits separate from saved data, so this is mostly UI.
- **Auth and multiple users.** Out of scope in the brief, but the shape would be:
  - an identity provider (OIDC) and middleware that sets `req.user`;
  - an `owner_id` on `portfolios`;
  - every repository query scoped by owner, returning 404 rather than 403 for someone else's portfolio, so ids can't be probed.
  - Prices aren't per user, so the price cache stays global.
- **History keeps a year (or more) of data.**
  - Keep raw snapshots for 90 days, plus hourly and daily roll-up tables. Each roll-up row is the last snapshot in its period, with a "degraded" flag if any snapshot in it was, the same rule the downsampling query uses today.
  - The history endpoint would pick the tier from the requested range and `maxPoints`, so a one-year chart reads about 365 daily rows instead of scanning raw data.
  - On Postgres, TimescaleDB's continuous aggregates and retention policies do exactly this.

## Operations

- **Request log:** one line per request when it ends, for example `[http] GET /portfolios/…/value 200 412ms`. It hooks the response's `close` event rather than `finish`, so requests the browser cancels (TanStack aborts out-of-date queries) are logged as `aborted` instead of disappearing. Alongside the `[coingecko] fetching …` lines, that's enough to show live that ten requests caused one upstream call.
- **Startup summary:** the database path, fiat fallback limit, history retention, whether a CoinGecko key is in use (never the key itself) and the result of the key check, plus a warning when `SIMULATE_COINGECKO` is on.
- **Invalid settings stop startup.** A bad `PORT`, `FIAT_MAX_STALE_DAYS`, `HISTORY_RETENTION_DAYS` or `SIMULATE_COINGECKO` throws when the config is loaded, instead of running with a surprising value.
- **Graceful shutdown on Ctrl-C (SIGINT/SIGTERM):**
  1. Stop the retention timer.
  2. `server.close()`: stop accepting connections and let in-flight requests finish.
  3. Close SQLite. A clean close merges the write-ahead log back into the database file, so the `-wal` and `-shm` files are gone.
  4. Exit with code 0, because nothing is left running.

  A second Ctrl-C forces an immediate exit. So does a 10-second limit, since a request can be waiting up to 4 seconds on an upstream timeout. I checked this on a separate instance: one request, SIGINT, exit code 0, and only `portfolio.db` left on disk.
- **No `/health` endpoint:** the brief doesn't need one, and there's nothing to orchestrate. With a deployment target I'd add liveness and readiness endpoints (readiness checking the database).

## Shortcuts and what I'd do with more time

- Compile to `dist/` instead of running TypeScript through `tsx`.
- Move the in-memory price cache to Redis, and SQLite to Postgres, to run more than one API instance.
- Replace the fixed asset list with lists fetched from Frankfurter's `/currencies` endpoint and CoinGecko's coin list.
- Report duplicate assets alongside field errors, as one pass of validation.
- Switch to structured JSON logs (pino) with a request id that also tags the upstream calls made for that request, plus counters for upstream calls, cache hits and 429s.
- Prevent overwrites between two editors with `If-Match` on `PUT`, and warn about unsaved edits when navigating away.
- Paginate the portfolio list; it currently shows the 50 most recently updated.
