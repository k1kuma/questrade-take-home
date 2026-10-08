import path from 'node:path';
import type { PricingSettings } from './pricing/priceService';
import type { SimulatedFailure } from './pricing/simulate';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

function parsePositiveInt(name: string, value: string | undefined, fallback: number): number {
  if (value === undefined || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`Invalid ${name}: ${value}`);
  }
  return parsed;
}

function parsePort(value: string | undefined, fallback: number): number {
  if (value === undefined || value === '') return fallback;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid PORT: ${value}`);
  }
  return port;
}

function parseSimulation(value: string | undefined): SimulatedFailure | undefined {
  if (value === undefined || value === '') return undefined;
  if (value === '429' || value === 'timeout') return value;
  throw new Error(`Invalid SIMULATE_COINGECKO: ${value} (expected 429 or timeout)`);
}

export const config = {
  port: parsePort(process.env.PORT, 3000),
  // Relative paths resolve against the API package directory, where npm runs the script.
  dbPath: path.resolve(process.env.DB_PATH ?? 'data/portfolio.db'),
  // Optional: without it the keyless public tier is used.
  coingeckoApiKey: process.env.COINGECKO_API_KEY?.trim() || undefined,
  simulateCoingecko: parseSimulation(process.env.SIMULATE_COINGECKO),
  upstreamTimeoutMs: 4000,
  pricing: {
    // CoinGecko's own CDN caches simple/price for 60s (s-maxage=60).
    cryptoFreshMs: MINUTE,
    cryptoMaxStaleMs: DAY,
    // Must exceed the longest gap between ECB publishes (Easter, about 5 days).
    fiatMaxStaleMs: parsePositiveInt('FIAT_MAX_STALE_DAYS', process.env.FIAT_MAX_STALE_DAYS, 7) * DAY,
    fiatRecheckMs: 30 * MINUTE,
    failureBackoffMs: MINUTE,
  } satisfies PricingSettings,
  history: {
    retentionMs: parsePositiveInt('HISTORY_RETENTION_DAYS', process.env.HISTORY_RETENTION_DAYS, 90) * DAY,
    retentionIntervalMs: HOUR,
  },
};
