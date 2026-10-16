import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import type { CoinGeckoClient } from '../pricing/coingecko';
import { UpstreamError } from '../pricing/errors';
import type { FrankfurterClient } from '../pricing/frankfurter';
import { createTestApp } from '../testApp';

const SECOND = 1000;
const iso = (ms: number) => new Date(ms).toISOString();

// Tuesday 17:00 Frankfurt: that day's ECB rates (published 14:00 UTC) are the latest.
function setup(start = '2026-10-06T15:00:00Z') {
  const clock = { t: Date.parse(start) };
  const market = { btc: '120000' };
  const getPrices = vi.fn<CoinGeckoClient['getPrices']>(async (assets) =>
    assets.map((asset) => ({
      asset,
      priceCad: asset === 'BTC' ? market.btc : '3800',
      lastUpdatedAt: clock.t - 10 * SECOND,
    })),
  );
  const getLatestRates = vi.fn<FrankfurterClient['getLatestRates']>(async () => ({
    rateDate: '2026-10-06',
    quotes: [
      { asset: 'USD', priceCad: '1.42' },
      { asset: 'EUR', priceCad: '1.6' },
    ],
  }));
  const { app, db } = createTestApp({ now: () => clock.t, getPrices, getLatestRates });

  const createPortfolio = async (holdings: { asset: string; amount: number | string }[]) =>
    (await request(app).post('/portfolios').send(holdings)).body.id as string;
  const snapshotCount = () =>
    (db.prepare('SELECT COUNT(*) AS n FROM valuations').get() as { n: number }).n;

  return { app, clock, market, getPrices, getLatestRates, createPortfolio, snapshotCount };
}

describe('GET /portfolios/:id/value', () => {
  it('values every holding in CAD with one consistent shape and records a snapshot', async () => {
    const { app, clock, createPortfolio, snapshotCount } = setup();
    const id = await createPortfolio([
      { asset: 'BTC', amount: 0.5 },
      { asset: 'USD', amount: 2500 },
      { asset: 'CAD', amount: '100.5' },
      { asset: 'EUR', amount: '0.333' },
    ]);

    const res = await request(app).get(`/portfolios/${id}/value`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      portfolioId: id,
      currency: 'CAD',
      // 60000 + 3550 + 100.5 + 0.5328, rounded once at the end.
      totalCad: '63651.03',
      status: 'complete',
      computedAt: iso(clock.t),
      holdings: [
        { asset: 'BTC', amount: '0.5', unitPriceCad: '120000', subtotalCad: '60000.00', source: 'coingecko', asOf: iso(clock.t - 10 * SECOND), stale: false },
        { asset: 'USD', amount: '2500', unitPriceCad: '1.42', subtotalCad: '3550.00', source: 'frankfurter', asOf: '2026-10-06T14:00:00.000Z', stale: false },
        { asset: 'CAD', amount: '100.5', unitPriceCad: '1', subtotalCad: '100.50', source: 'fixed', asOf: iso(clock.t), stale: false },
        { asset: 'EUR', amount: '0.333', unitPriceCad: '1.6', subtotalCad: '0.53', source: 'frankfurter', asOf: '2026-10-06T14:00:00.000Z', stale: false },
      ],
      sources: { coingecko: { status: 'fresh' }, frankfurter: { status: 'fresh' } },
    });
    expect(snapshotCount()).toBe(1);
  });

  it('when CoinGecko rate-limits, returns a degraded 200 that labels exactly which prices are stale', async () => {
    const { app, clock, getPrices, createPortfolio, snapshotCount } = setup();
    const id = await createPortfolio([
      { asset: 'BTC', amount: 1 },
      { asset: 'USD', amount: 100 },
    ]);
    await request(app).get(`/portfolios/${id}/value`);
    const lastGoodAt = clock.t;

    clock.t += 61 * SECOND;
    getPrices.mockRejectedValue(new UpstreamError('coingecko', 'rate_limited', 'HTTP 429', 120 * SECOND));
    const degraded = await request(app).get(`/portfolios/${id}/value`);

    expect(degraded.status).toBe(200);
    expect(degraded.body.status).toBe('degraded');
    expect(degraded.body.totalCad).toBe('120142.00');
    expect(degraded.body.holdings[0]).toMatchObject({
      asset: 'BTC',
      unitPriceCad: '120000',
      asOf: iso(lastGoodAt - 10 * SECOND),
      stale: true,
      staleReason: 'rate_limited',
    });
    expect(degraded.body.holdings[1]).toMatchObject({ asset: 'USD', stale: false });
    expect(degraded.body.sources).toEqual({
      coingecko: { status: 'stale', reason: 'rate_limited', retryAt: iso(clock.t + 120 * SECOND) },
      frankfurter: { status: 'fresh' },
    });
    expect(snapshotCount()).toBe(2);

    // Within the Retry-After window: no new upstream call, and no duplicate snapshot.
    clock.t += 30 * SECOND;
    const again = await request(app).get(`/portfolios/${id}/value`);
    expect(again.body.status).toBe('degraded');
    expect(getPrices).toHaveBeenCalledTimes(2);
    expect(snapshotCount()).toBe(2);
  });

  it('returns 503 with Retry-After, and no partial total, when a holding has no usable price', async () => {
    const { app, getPrices, createPortfolio, snapshotCount } = setup();
    getPrices.mockRejectedValue(new UpstreamError('coingecko', 'rate_limited', 'HTTP 429', 90 * SECOND));
    const id = await createPortfolio([
      { asset: 'BTC', amount: 1 },
      { asset: 'USD', amount: 100 },
    ]);

    const res = await request(app).get(`/portfolios/${id}/value`);

    expect(res.status).toBe(503);
    expect(res.headers['retry-after']).toBe('90');
    expect(res.body).toEqual({
      error: {
        code: 'PRICES_UNAVAILABLE',
        message: expect.any(String),
        assets: [{ asset: 'BTC', source: 'coingecko', reason: 'rate_limited' }],
        retryAfterSeconds: 90,
      },
    });
    expect(snapshotCount()).toBe(0);
  });

  it('records a new snapshot only when something that affects the value changes', async () => {
    const { app, clock, market, getPrices, createPortfolio, snapshotCount } = setup();
    const id = await createPortfolio([{ asset: 'BTC', amount: 1 }]);

    for (let i = 0; i < 3; i++) {
      await request(app).get(`/portfolios/${id}/value`);
      clock.t += 10 * SECOND;
    }
    expect(getPrices).toHaveBeenCalledTimes(1);
    expect(snapshotCount()).toBe(1);

    clock.t += 61 * SECOND;
    market.btc = '121000';
    await request(app).get(`/portfolios/${id}/value`);
    expect(snapshotCount()).toBe(2);

    // Re-fetched with a newer asOf but the same price: same value, no new point.
    clock.t += 61 * SECOND;
    await request(app).get(`/portfolios/${id}/value`);
    expect(getPrices).toHaveBeenCalledTimes(3);
    expect(snapshotCount()).toBe(2);
  });
});
