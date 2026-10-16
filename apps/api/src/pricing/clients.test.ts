import { describe, expect, it, vi } from 'vitest';
import { CoinGeckoClient } from './coingecko';
import { UpstreamError } from './errors';
import { FrankfurterClient } from './frankfurter';
import type { FetchFn } from './http';

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { 'content-type': 'application/json', ...init.headers },
  });
}

function fetchReturning(response: Response) {
  return vi.fn<FetchFn>().mockResolvedValue(response);
}

// Never resolves on its own; rejects the way real fetch does when its signal aborts.
const hangingFetch: FetchFn = (_url, init) =>
  new Promise((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
  });

async function captureError(promise: Promise<unknown>): Promise<UpstreamError> {
  const err = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(UpstreamError);
  return err as UpstreamError;
}

describe('CoinGeckoClient', () => {
  it('fetches every requested coin in a single call and normalizes the response', async () => {
    const fetchFn = fetchReturning(
      jsonResponse({
        bitcoin: { cad: 121858.41610077313, last_updated_at: 1791142360 },
        ethereum: { cad: 3853.58, last_updated_at: 1791142355 },
      }),
    );
    const client = new CoinGeckoClient({ fetchFn });

    const quotes = await client.getPrices(['BTC', 'ETH']);

    expect(fetchFn).toHaveBeenCalledTimes(1);
    const url = new URL(String(fetchFn.mock.calls[0]![0]));
    expect(url.origin + url.pathname).toBe('https://api.coingecko.com/api/v3/simple/price');
    expect(url.searchParams.get('ids')).toBe('bitcoin,ethereum');
    expect(url.searchParams.get('vs_currencies')).toBe('cad');
    expect(url.searchParams.get('precision')).toBe('full');
    expect(quotes).toEqual([
      { asset: 'BTC', priceCad: '121858.41610077313', lastUpdatedAt: 1791142360000 },
      { asset: 'ETH', priceCad: '3853.58', lastUpdatedAt: 1791142355000 },
    ]);
  });

  it('reports a 429 as rate_limited with the Retry-After delay', async () => {
    const client = new CoinGeckoClient({
      fetchFn: fetchReturning(jsonResponse({ status: {} }, { status: 429, headers: { 'retry-after': '30' } })),
    });

    const err = await captureError(client.getPrices(['BTC']));

    expect(err).toMatchObject({ source: 'coingecko', reason: 'rate_limited', retryAfterMs: 30_000 });
  });

  it('times out instead of waiting forever', async () => {
    const client = new CoinGeckoClient({ fetchFn: hangingFetch, timeoutMs: 20 });

    const err = await captureError(client.getPrices(['BTC']));

    expect(err).toMatchObject({ source: 'coingecko', reason: 'timeout' });
  });
});

describe('FrankfurterClient', () => {
  it('converts EUR-based ECB rates into CAD prices for every fiat asset', async () => {
    const fetchFn = fetchReturning(
      jsonResponse({ amount: 1, base: 'EUR', date: '2026-10-02', rates: { CAD: 1.5984, USD: 1.1225, JPY: 176.99 } }),
    );

    const { rateDate, quotes } = await new FrankfurterClient({ fetchFn }).getLatestRates();

    const url = new URL(String(fetchFn.mock.calls[0]![0]));
    expect(url.origin + url.pathname).toBe('https://api.frankfurter.dev/v1/latest');
    expect(url.searchParams.get('base')).toBe('EUR');
    expect(rateDate).toBe('2026-10-02');
    expect(Object.fromEntries(quotes.map((q) => [q.asset, q.priceCad]))).toEqual({
      CAD: '1',
      EUR: '1.5984',
      USD: '1.4239643652561247216',
      JPY: '0.0090310187016215605401',
    });
  });
});
