import { createApp } from './app';
import { config } from './config';
import { openDatabase } from './db/connection';
import { PortfolioRepository } from './portfolios/repository';
import { CoinGeckoClient } from './pricing/coingecko';
import { FrankfurterClient } from './pricing/frankfurter';
import { PriceService } from './pricing/priceService';
import { PriceStore } from './pricing/priceStore';
import { simulatedFailureFetch } from './pricing/simulate';
import { ValuationRepository } from './valuation/repository';
import { startHistoryRetention } from './valuation/retention';
import { ValuationService } from './valuation/valuationService';

const db = openDatabase(config.dbPath);

const coingecko = new CoinGeckoClient({
  apiKey: config.coingeckoApiKey,
  timeoutMs: config.upstreamTimeoutMs,
  ...(config.simulateCoingecko && { fetchFn: simulatedFailureFetch(config.simulateCoingecko) }),
});
const frankfurter = new FrankfurterClient({ timeoutMs: config.upstreamTimeoutMs });
const prices = new PriceService({ coingecko, frankfurter, store: new PriceStore(db), settings: config.pricing });
const snapshots = new ValuationRepository(db);

const app = createApp({
  portfolios: new PortfolioRepository(db),
  valuations: new ValuationService(prices, snapshots),
});

const stopRetention = startHistoryRetention(snapshots, {
  retentionMs: config.history.retentionMs,
  intervalMs: config.history.retentionIntervalMs,
});

const DAY = 86_400_000;
console.info(
  `Config: db=${config.dbPath}, fiat fallback ${config.pricing.fiatMaxStaleMs / DAY}d, ` +
    `history retention ${config.history.retentionMs / DAY}d`,
);
if (config.simulateCoingecko) {
  console.warn(`SIMULATE_COINGECKO=${config.simulateCoingecko}: every CoinGecko call will fail`);
}
console.info(`CoinGecko: ${config.coingeckoApiKey ? 'demo API key' : 'keyless public tier'}`);
// Not awaited: a slow or failed check must never delay or block startup.
if (config.coingeckoApiKey && !config.simulateCoingecko) {
  void coingecko.checkApiKey().then((result) => {
    if (result === 'valid') console.info('CoinGecko: API key accepted');
    else if (result === 'rejected') {
      console.warn('CoinGecko: COINGECKO_API_KEY was rejected; running at keyless (public) rate limits');
    } else console.warn('CoinGecko: could not verify the API key (network error or CoinGecko unavailable)');
  });
}

const server = app.listen(config.port, (error) => {
  if (error) throw error;
  console.info(`API listening on http://localhost:${config.port}`);
});

const SHUTDOWN_TIMEOUT_MS = 10_000;
let shuttingDown = false;

/** Stop taking requests, let in-flight ones finish, then close SQLite (which checkpoints the WAL into the db file). */
function shutdown(signal: NodeJS.Signals): void {
  if (shuttingDown) {
    console.warn(`${signal} again: forcing exit`);
    process.exit(1);
  }
  shuttingDown = true;
  console.info(`${signal} received: shutting down (send again to force)`);
  stopRetention();
  // A request waiting on an upstream can take up to its 4s timeout; don't wait forever on anything else.
  setTimeout(() => {
    console.error(`Shutdown took over ${SHUTDOWN_TIMEOUT_MS / 1000}s: forcing exit`);
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS).unref();
  server.close(() => {
    db.close();
    console.info('HTTP server and database closed');
  });
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
