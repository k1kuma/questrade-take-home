import type Database from 'better-sqlite3';
import { createApp } from './app';
import { openDatabase } from './db/connection';
import { PortfolioRepository } from './portfolios/repository';
import type { CoinGeckoClient } from './pricing/coingecko';
import type { FrankfurterClient } from './pricing/frankfurter';
import { PriceService, type PricingSettings } from './pricing/priceService';
import { PriceStore } from './pricing/priceStore';
import { ValuationRepository } from './valuation/repository';
import { ValuationService } from './valuation/valuationService';

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

export const TEST_PRICING: PricingSettings = {
  cryptoFreshMs: MINUTE,
  cryptoMaxStaleMs: DAY,
  fiatMaxStaleMs: 7 * DAY,
  fiatRecheckMs: 30 * MINUTE,
  failureBackoffMs: MINUTE,
};

function unexpectedUpstreamCall(name: string) {
  return async (): Promise<never> => {
    throw new Error(`Unexpected ${name} call in test`);
  };
}

export type TestAppOptions = {
  db?: Database.Database;
  now?: () => number;
  getPrices?: CoinGeckoClient['getPrices'];
  getLatestRates?: FrankfurterClient['getLatestRates'];
};

/** The real app and services over SQLite, with fake upstream clients. */
export function createTestApp(options: TestAppOptions = {}) {
  const db = options.db ?? openDatabase(':memory:');
  const now = options.now ?? Date.now;
  const prices = new PriceService({
    coingecko: { getPrices: options.getPrices ?? unexpectedUpstreamCall('CoinGecko') },
    frankfurter: { getLatestRates: options.getLatestRates ?? unexpectedUpstreamCall('Frankfurter') },
    store: new PriceStore(db),
    settings: TEST_PRICING,
    now,
  });
  const app = createApp({
    portfolios: new PortfolioRepository(db),
    valuations: new ValuationService(prices, new ValuationRepository(db), now),
  });
  return { app, db };
}
