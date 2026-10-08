import { describe, expect, it, vi } from 'vitest';
import { CoinGeckoClient } from './coingecko';
import { UpstreamError } from './errors';
import { FrankfurterClient } from './frankfurter';
import { parseRetryAfter, type FetchFn } from './http';
import { simulatedFailureFetch } from './simulate';

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

  it('omits coins CoinGecko does not return', async () => {
    const client = new CoinGeckoClient({
      fetchFn: fetchReturning(jsonResponse({ bitcoin: { cad: 100, last_updated_at: 1 } })),
    });

    const quotes = await client.getPrices(['BTC', 'SOL']);

    expect(quotes.map((q) => q.asset)).toEqual(['BTC']);
  });

  it('does not call upstream for an empty asset list', async () => {
    const fetchFn = vi.fn<FetchFn>();

    expect(await new CoinGeckoClient({ fetchFn }).getPrices([])).toEqual([]);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('sends the demo API key header only when configured', async () => {
    const body = { bitcoin: { cad: 1, last_updated_at: 1 } };
    const withKey = fetchReturning(jsonResponse(body));
    const withoutKey = fetchReturning(jsonResponse(body));

    await new CoinGeckoClient({ fetchFn: withKey, apiKey: 'demo-key' }).getPrices(['BTC']);
    await new CoinGeckoClient({ fetchFn: withoutKey }).getPrices(['BTC']);

    const headers = (fn: typeof withKey) => new Headers(fn.mock.calls[0]![1]?.headers);
    expect(headers(withKey).get('x-cg-demo-api-key')).toBe('demo-key');
    expect(headers(withoutKey).has('x-cg-demo-api-key')).toBe(false);
  });

  it('reports a 429 as rate_limited with the Retry-After delay', async () => {
    const client = new CoinGeckoClient({
      fetchFn: fetchReturning(jsonResponse({ status: {} }, { status: 429, headers: { 'retry-after': '30' } })),
    });

    const err = await captureError(client.getPrices(['BTC']));

    expect(err).toMatchObject({ source: 'coingecko', reason: 'rate_limited', retryAfterMs: 30_000 });
  });

  it('reports a 429 without Retry-After as rate_limited with no delay hint', async () => {
    const client = new CoinGeckoClient({ fetchFn: fetchReturning(new Response('', { status: 429 })) });

    const err = await captureError(client.getPrices(['BTC']));

    expect(err.reason).toBe('rate_limited');
    expect(err.retryAfterMs).toBeUndefined();
  });

  it('times out instead of waiting forever', async () => {
    const client = new CoinGeckoClient({ fetchFn: hangingFetch, timeoutMs: 20 });

    const err = await captureError(client.getPrices(['BTC']));

    expect(err).toMatchObject({ source: 'coingecko', reason: 'timeout' });
  });

  it('reports server errors and network failures as unavailable', async () => {
    const serverError = new CoinGeckoClient({ fetchFn: fetchReturning(new Response('oops', { status: 503 })) });
    const networkError = new CoinGeckoClient({
      fetchFn: vi.fn<FetchFn>().mockRejectedValue(new TypeError('fetch failed')),
    });

    expect((await captureError(serverError.getPrices(['BTC']))).reason).toBe('unavailable');
    expect((await captureError(networkError.getPrices(['BTC']))).reason).toBe('unavailable');
  });

  it('rejects responses that are not JSON or have the wrong shape', async () => {
    const notJson = new CoinGeckoClient({ fetchFn: fetchReturning(new Response('<html>', { status: 200 })) });
    const wrongShape = new CoinGeckoClient({
      fetchFn: fetchReturning(jsonResponse({ bitcoin: { cad: 'lots', last_updated_at: 1 } })),
    });

    expect((await captureError(notJson.getPrices(['BTC']))).reason).toBe('bad_response');
    expect((await captureError(wrongShape.getPrices(['BTC']))).reason).toBe('bad_response');
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

  it('fails as bad_response when the CAD rate is missing', async () => {
    const client = new FrankfurterClient({
      fetchFn: fetchReturning(jsonResponse({ amount: 1, base: 'EUR', date: '2026-10-02', rates: { USD: 1.1 } })),
    });

    const err = await captureError(client.getLatestRates());

    expect(err).toMatchObject({ source: 'frankfurter', reason: 'bad_response' });
  });

  it('times out instead of waiting forever', async () => {
    const client = new FrankfurterClient({ fetchFn: hangingFetch, timeoutMs: 20 });

    expect((await captureError(client.getLatestRates())).reason).toBe('timeout');
  });
});

describe('CoinGeckoClient.checkApiKey', () => {
  it('calls /ping with the key and reports valid, rejected or unverified', async () => {
    const ok = fetchReturning(jsonResponse({ gecko_says: '(V3) To the Moon!' }));
    const unauthorized = fetchReturning(jsonResponse({ status: { error_code: 10002 } }, { status: 401 }));
    const networkDown = vi.fn<FetchFn>().mockRejectedValue(new TypeError('fetch failed'));

    expect(await new CoinGeckoClient({ fetchFn: ok, apiKey: 'good' }).checkApiKey()).toBe('valid');
    expect(await new CoinGeckoClient({ fetchFn: unauthorized, apiKey: 'typo' }).checkApiKey()).toBe('rejected');
    expect(await new CoinGeckoClient({ fetchFn: networkDown, apiKey: 'good' }).checkApiKey()).toBe('unverified');

    const [url, init] = ok.mock.calls[0]!;
    expect(String(url)).toBe('https://api.coingecko.com/api/v3/ping');
    expect(new Headers(init?.headers).get('x-cg-demo-api-key')).toBe('good');
  });

  it('makes no call when there is no key', async () => {
    const fetchFn = vi.fn<FetchFn>();

    expect(await new CoinGeckoClient({ fetchFn }).checkApiKey()).toBe('unverified');
    expect(fetchFn).not.toHaveBeenCalled();
  });
});

describe('simulatedFailureFetch (SIMULATE_COINGECKO)', () => {
  it('fails exactly like a real 429 or a real timeout would', async () => {
    const rateLimited = new CoinGeckoClient({ fetchFn: simulatedFailureFetch('429') });
    const timedOut = new CoinGeckoClient({ fetchFn: simulatedFailureFetch('timeout'), timeoutMs: 20 });

    expect(await captureError(rateLimited.getPrices(['BTC']))).toMatchObject({
      reason: 'rate_limited',
      retryAfterMs: 60_000,
    });
    expect((await captureError(timedOut.getPrices(['BTC']))).reason).toBe('timeout');
  });
});

describe('parseRetryAfter', () => {
  const now = Date.parse('2026-10-04T12:00:00Z');

  it('parses delta-seconds and HTTP dates', () => {
    expect(parseRetryAfter('120', now)).toBe(120_000);
    expect(parseRetryAfter('Sun, 04 Oct 2026 12:00:45 GMT', now)).toBe(45_000);
  });

  it('clamps past dates to zero and ignores missing or garbage values', () => {
    expect(parseRetryAfter('Sun, 04 Oct 2026 11:00:00 GMT', now)).toBe(0);
    expect(parseRetryAfter(null, now)).toBeUndefined();
    expect(parseRetryAfter('soon', now)).toBeUndefined();
  });
});
