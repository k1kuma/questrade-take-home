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

  it('refreshes cached coins past half their window in the same call', async () => {
    const { service, clock, coingecko } = setup({ start });
    await service.getPrices(['ETH']);
    clock.t += 40 * SECOND;

    await service.getPrices(['BTC']);

    expect(coingecko).toHaveBeenLastCalledWith(['BTC', 'ETH']);
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

  it('reports unavailable when CoinGecko fails and nothing is cached', async () => {
    const { service, coingecko } = setup({ start });
    coingecko.mockRejectedValue(new UpstreamError('coingecko', 'timeout', 'timed out'));

    const [result] = await service.getPrices(['BTC']);

    expect(result).toMatchObject({ status: 'unavailable', asset: 'BTC', reason: 'timeout' });
  });

  it('stops falling back to a crypto price once it is more than 24 hours old', async () => {
    const { service, clock, coingecko } = setup({ start });
    await service.getPrices(['BTC']);
    coingecko.mockRejectedValue(new UpstreamError('coingecko', 'unavailable', 'HTTP 503'));

    clock.t += 23 * HOUR;
    expect((await service.getPrices(['BTC']))[0]!.status).toBe('stale');

    clock.t += HOUR;
    expect((await service.getPrices(['BTC']))[0]!.status).toBe('unavailable');
  });

  it('does not re-ask for a coin CoinGecko omitted until its window passes', async () => {
    const { service, clock, coingecko } = setup({ start });
    coingecko.mockResolvedValue([]);

    const [first] = await service.getPrices(['SOL']);
    clock.t += 30 * SECOND;
    await service.getPrices(['SOL']);

    expect(first).toMatchObject({ status: 'unavailable', reason: 'bad_response' });
    expect(coingecko).toHaveBeenCalledTimes(1);
  });

  it('serves persisted prices after a restart without calling CoinGecko', async () => {
    const first = setup({ start });
    await first.service.getPrices(['BTC']);

    const second = setup({ start, db: first.db });
    second.clock.t = first.clock.t + 30 * SECOND;
    const [result] = await second.service.getPrices(['BTC']);

    expect(result).toMatchObject({ status: 'fresh', priceCad: '120000' });
    expect(second.coingecko).not.toHaveBeenCalled();
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

  it('rechecks every 30 minutes while the ECB has not published the expected date', async () => {
    // Monday 16:05 Frankfurt, but Frankfurter still serves Friday.
    const { service, clock, frankfurter } = setup({ start: '2026-10-05T14:05:00Z', rateDate: '2026-10-02' });

    const [late] = await service.getPrices(['USD']);
    expect(late!.status).toBe('fresh');

    clock.t += 20 * MINUTE;
    await service.getPrices(['USD']);
    expect(frankfurter).toHaveBeenCalledTimes(1);

    clock.t += 11 * MINUTE;
    await service.getPrices(['USD']);
    expect(frankfurter).toHaveBeenCalledTimes(2);
  });

  it('falls back to rates up to 7 days old while Frankfurter fails, then reports unavailable', async () => {
    // Tuesday 2026-10-06 17:00 Frankfurt; that day's rates are published at 14:00 UTC.
    const { service, clock, frankfurter } = setup({ start: '2026-10-06T15:00:00Z', rateDate: '2026-10-06' });
    await service.getPrices(['USD']);
    frankfurter.mockRejectedValue(new UpstreamError('frankfurter', 'unavailable', 'HTTP 502'));

    clock.t = Date.parse('2026-10-07T14:30:00Z');
    expect((await service.getPrices(['USD']))[0]).toMatchObject({ status: 'stale', reason: 'unavailable' });

    clock.t = Date.parse('2026-10-13T13:59:00Z');
    expect((await service.getPrices(['USD']))[0]!.status).toBe('stale');

    clock.t = Date.parse('2026-10-13T14:01:00Z');
    expect((await service.getPrices(['USD']))[0]!.status).toBe('unavailable');
  });

  it('prices CAD at 1 without calling any upstream', async () => {
    const { service, coingecko, frankfurter } = setup({ start: '2026-10-06T12:00:00Z' });

    const [cad] = await service.getPrices(['CAD']);

    expect(cad).toMatchObject({ status: 'fresh', priceCad: '1', source: 'fixed' });
    expect(coingecko).not.toHaveBeenCalled();
    expect(frankfurter).not.toHaveBeenCalled();
  });
});

describe('PriceService: mixed portfolio', () => {
  it('returns results in request order, degrading only the failing source', async () => {
    const { service, coingecko } = setup({ start: '2026-10-06T15:00:00Z', rateDate: '2026-10-06' });
    coingecko.mockRejectedValue(rateLimited());

    const results = await service.getPrices(['USD', 'BTC', 'CAD', 'EUR'] as const);

    expect(results.map((r) => [r.asset, r.status])).toEqual([
      ['USD', 'fresh'],
      ['BTC', 'unavailable'],
      ['CAD', 'fresh'],
      ['EUR', 'fresh'],
    ]);
  });
});
