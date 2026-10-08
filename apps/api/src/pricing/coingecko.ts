import Decimal from 'decimal.js';
import { z } from 'zod';
import type { CryptoAsset } from '@portfolio/contracts';
import { UpstreamError } from './errors';
import { fetchJson, type FetchFn } from './http';

// Record<CryptoAsset, …> makes adding a crypto asset without an id a compile error.
const COIN_IDS: Record<CryptoAsset, string> = {
  BTC: 'bitcoin',
  ETH: 'ethereum',
  SOL: 'solana',
  XRP: 'ripple',
  ADA: 'cardano',
  DOGE: 'dogecoin',
  LTC: 'litecoin',
  USDT: 'tether',
  USDC: 'usd-coin',
};

const SimplePriceSchema = z.record(
  z.string(),
  z.object({ cad: z.number().positive(), last_updated_at: z.number().int().positive() }),
);

export type CryptoQuote = {
  asset: CryptoAsset;
  priceCad: string;
  /** When CoinGecko last updated this price, epoch ms. */
  lastUpdatedAt: number;
};

export type CoinGeckoOptions = {
  fetchFn?: FetchFn;
  timeoutMs?: number;
  apiKey?: string;
  // Trailing slash matters: new URL('simple/price', base) replaces the last path segment otherwise.
  baseUrl?: string;
};

export type ApiKeyCheck = 'valid' | 'rejected' | 'unverified';

export class CoinGeckoClient {
  private readonly fetchFn: FetchFn;
  private readonly timeoutMs: number;
  private readonly apiKey: string | undefined;
  private readonly baseUrl: string;

  constructor(options: CoinGeckoOptions = {}) {
    this.fetchFn = options.fetchFn ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 4000;
    this.apiKey = options.apiKey;
    this.baseUrl = options.baseUrl ?? 'https://api.coingecko.com/api/v3/';
  }

  /**
   * simple/price silently treats a bad key as keyless (lower rate limit), but /ping rejects it with 401.
   * Never throws: anything other than a clear yes or no is 'unverified'.
   */
  async checkApiKey(): Promise<ApiKeyCheck> {
    if (!this.apiKey) return 'unverified';
    try {
      const res = await this.fetchFn(new URL('ping', this.baseUrl), {
        headers: { 'x-cg-demo-api-key': this.apiKey },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      await res.body?.cancel();
      if (res.ok) return 'valid';
      return res.status === 401 || res.status === 403 ? 'rejected' : 'unverified';
    } catch {
      return 'unverified';
    }
  }

  /** One upstream call for all requested coins; coins CoinGecko doesn't return are omitted. */
  async getPrices(assets: readonly CryptoAsset[]): Promise<CryptoQuote[]> {
    if (assets.length === 0) return [];

    const url = new URL('simple/price', this.baseUrl);
    url.searchParams.set('ids', assets.map((asset) => COIN_IDS[asset]).join(','));
    url.searchParams.set('vs_currencies', 'cad');
    url.searchParams.set('include_last_updated_at', 'true');
    // Without this CoinGecko rounds prices, e.g. BTC to whole dollars.
    url.searchParams.set('precision', 'full');

    const body = await fetchJson(url, {
      source: 'coingecko',
      fetchFn: this.fetchFn,
      timeoutMs: this.timeoutMs,
      ...(this.apiKey && { headers: { 'x-cg-demo-api-key': this.apiKey } }),
    });

    const parsed = SimplePriceSchema.safeParse(body);
    if (!parsed.success) {
      throw new UpstreamError('coingecko', 'bad_response', 'Unexpected CoinGecko response shape', undefined, {
        cause: parsed.error,
      });
    }

    return assets.flatMap((asset) => {
      const entry = parsed.data[COIN_IDS[asset]];
      if (!entry) return [];
      return [
        {
          asset,
          priceCad: new Decimal(entry.cad).toFixed(),
          lastUpdatedAt: entry.last_updated_at * 1000,
        },
      ];
    });
  }
}
