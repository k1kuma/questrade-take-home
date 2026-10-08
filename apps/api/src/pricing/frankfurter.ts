import Decimal from 'decimal.js';
import { z } from 'zod';
import { FIAT_ASSETS, type FiatAsset } from '@portfolio/contracts';
import { UpstreamError } from './errors';
import { fetchJson, type FetchFn } from './http';

const LatestSchema = z.object({
  base: z.literal('EUR'),
  date: z.iso.date(),
  rates: z.record(z.string(), z.number().positive()),
});

export type FiatQuote = {
  asset: FiatAsset;
  priceCad: string;
};

export type FiatRates = {
  /** ECB reference date the rates belong to, YYYY-MM-DD. */
  rateDate: string;
  quotes: FiatQuote[];
};

export type FrankfurterOptions = {
  fetchFn?: FetchFn;
  timeoutMs?: number;
  // Trailing slash matters: new URL('latest', base) replaces the last path segment otherwise.
  baseUrl?: string;
};

export class FrankfurterClient {
  private readonly fetchFn: FetchFn;
  private readonly timeoutMs: number;
  private readonly baseUrl: string;

  constructor(options: FrankfurterOptions = {}) {
    this.fetchFn = options.fetchFn ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 4000;
    this.baseUrl = options.baseUrl ?? 'https://api.frankfurter.dev/v1/';
  }

  /** CAD price of every supported fiat currency from one call; currencies the ECB didn't publish are omitted. */
  async getLatestRates(): Promise<FiatRates> {
    // ECB publishes EUR-based rates; base=CAD would return rounded cross rates that we'd round again inverting.
    const url = new URL('latest', this.baseUrl);
    url.searchParams.set('base', 'EUR');

    const body = await fetchJson(url, {
      source: 'frankfurter',
      fetchFn: this.fetchFn,
      timeoutMs: this.timeoutMs,
    });

    const parsed = LatestSchema.safeParse(body);
    if (!parsed.success) {
      throw new UpstreamError('frankfurter', 'bad_response', 'Unexpected Frankfurter response shape', undefined, {
        cause: parsed.error,
      });
    }
    const { date, rates } = parsed.data;
    const eurInCad = rates.CAD;
    if (eurInCad === undefined) {
      throw new UpstreamError('frankfurter', 'bad_response', 'Frankfurter response has no CAD rate');
    }

    const quotes = FIAT_ASSETS.flatMap((asset): FiatQuote[] => {
      if (asset === 'CAD') return [{ asset, priceCad: '1' }];
      if (asset === 'EUR') return [{ asset, priceCad: new Decimal(eurInCad).toFixed() }];
      const eurInAsset = rates[asset];
      if (eurInAsset === undefined) return [];
      // 1 X = (CAD per EUR) / (X per EUR) CAD
      return [{ asset, priceCad: new Decimal(eurInCad).div(eurInAsset).toFixed() }];
    });

    return { rateDate: date, quotes };
  }
}
