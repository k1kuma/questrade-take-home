import type Database from 'better-sqlite3';
import { describe, expect, it, vi } from 'vitest';
import { openDatabase } from '../db/connection';
import type { CoinGeckoClient, CryptoQuote } from './coingecko';
import { UpstreamError } from './errors';
import type { FiatRates, FrankfurterClient } from './frankfurter';
import { PriceService, type PricingSettings } from './priceService';
import { PriceStore } from './priceStore';

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const SETTINGS: PricingSettings = {
  cryptoFreshMs: MINUTE,
  cryptoMaxStaleMs: DAY,
  fiatMaxStaleMs: 7 * DAY,
  fiatRecheckMs: 30 * MINUTE,
  failureBackoffMs: MINUTE,
};

const COIN_PRICES: Record<string, string> = { BTC: '120000', ETH: '3800', SOL: '170' };

type Clock = { t: number };

function coinGeckoReturningPrices(clock: Clock) {
  return vi.fn<CoinGeckoClient['getPrices']>(async (assets) =>
    assets.map((asset): CryptoQuote => ({ asset, priceCad: COIN_PRICES[asset]!, lastUpdatedAt: clock.t - 5 * SECOND })),
  );
}

function frankfurterReturning(state: { rateDate: string }) {
  return vi.fn<FrankfurterClient['getLatestRates']>(async (): Promise<FiatRates> => ({
    rateDate: state.rateDate,
    quotes: [
      { asset: 'CAD', priceCad: '1' },
      { asset: 'USD', priceCad: '1.42' },
      { asset: 'EUR', priceCad: '1.6' },
    ],
  }));
}

function setup(options: { start: string; db?: Database.Database; rateDate?: string }) {
  const clock: Clock = { t: Date.parse(options.start) };
  const fiatState = { rateDate: options.rateDate ?? '2026-10-05' };
  const coingecko = coinGeckoReturningPrices(clock);
  const frankfurter = frankfurterReturning(fiatState);
  const db = options.db ?? openDatabase(':memory:');
  const service = new PriceService({
    coingecko: { getPrices: coingecko },
    frankfurter: { getLatestRates: frankfurter },
    store: new PriceStore(db),
    settings: SETTINGS,
    now: () => clock.t,
  });
  return { service, clock, coingecko, frankfurter, fiatState, db };
}

const rateLimited = (retryAfterMs?: number) =>
  new UpstreamError('coingecko', 'rate_limited', 'rate limited', retryAfterMs);

describe('PriceService: crypto', () => {
  const start = '2026-10-06T12:00:00Z';

  it('shares one CoinGecko call between concurrent requests for the same coins', async () => {
    const { service, coingecko } = setup({ start });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const original = coingecko.getMockImplementation()!;
    coingecko.mockImplementation(async (assets) => {
      await gate;
      return original(assets);
    });

    const requests = Array.from({ length: 10 }, () => service.getPrices(['BTC', 'ETH']));
    release();
    const results = await Promise.all(requests);

    expect(coingecko).toHaveBeenCalledTimes(1);
    expect(results.flat().every((r) => r.status === 'fresh')).toBe(true);
  });

  it('serves the cached price for 60 seconds, then asks CoinGecko again', async () => {
    const { service, clock, coingecko } = setup({ start });

    await service.getPrices(['BTC']);
    clock.t += 59 * SECOND;
    await service.getPrices(['BTC']);
    expect(coingecko).toHaveBeenCalledTimes(1);

    clock.t += 2 * SECOND;
    await service.getPrices(['BTC']);
    expect(coingecko).toHaveBeenCalledTimes(2);
  });

  it('after a 429, labels the last good price stale and makes no calls until Retry-After passes', async () => {
    const { service, clock, coingecko } = setup({ start });
    await service.getPrices(['BTC']);
    clock.t += 61 * SECOND;
    coingecko.mockRejectedValue(rateLimited(2 * MINUTE));

    const [degraded] = await service.getPrices(['BTC']);

    expect(degraded).toMatchObject({
      status: 'stale',
      priceCad: '120000',
      reason: 'rate_limited',
      retryAt: clock.t + 2 * MINUTE,
    });
    clock.t += MINUTE;
    await service.getPrices(['BTC', 'ETH']);
    expect(coingecko).toHaveBeenCalledTimes(2);

    clock.t += MINUTE + SECOND;
    await service.getPrices(['BTC']);
    expect(coingecko).toHaveBeenCalledTimes(3);
  });
});

describe('PriceService: fiat', () => {
  it("treats Friday's rates as fresh all weekend and refetches after Monday's publish", async () => {
    // Friday 2026-10-02 17:00 Frankfurt.
    const { service, clock, frankfurter, fiatState } = setup({ start: '2026-10-02T15:00:00Z', rateDate: '2026-10-02' });
    await service.getPrices(['USD']);

    clock.t = Date.parse('2026-10-04T20:00:00Z'); // Sunday
    const [sunday] = await service.getPrices(['USD']);
    expect(sunday).toMatchObject({ status: 'fresh', asOf: Date.parse('2026-10-02T14:00:00Z') });
    expect(frankfurter).toHaveBeenCalledTimes(1);

    fiatState.rateDate = '2026-10-05';
    clock.t = Date.parse('2026-10-05T14:01:00Z'); // Monday 16:01 Frankfurt
    await service.getPrices(['USD']);
    expect(frankfurter).toHaveBeenCalledTimes(2);
  });
});
