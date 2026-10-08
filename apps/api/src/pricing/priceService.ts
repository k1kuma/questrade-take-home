import { isCryptoAsset, type Asset, type FiatAsset } from '@portfolio/contracts';
import type { CoinGeckoClient } from './coingecko';
import { CryptoPriceCache } from './cryptoPriceCache';
import { FiatRateCache } from './fiatRateCache';
import type { FrankfurterClient } from './frankfurter';
import type { PriceStore } from './priceStore';
import type { PriceResult } from './types';

export type PricingSettings = {
  cryptoFreshMs: number;
  cryptoMaxStaleMs: number;
  fiatMaxStaleMs: number;
  fiatRecheckMs: number;
  failureBackoffMs: number;
};

export type PriceServiceOptions = {
  coingecko: Pick<CoinGeckoClient, 'getPrices'>;
  frankfurter: Pick<FrankfurterClient, 'getLatestRates'>;
  store: PriceStore;
  settings: PricingSettings;
  now?: () => number;
};

/** One entry point for CAD prices of any supported asset; hides which upstream and cache serves each. */
export class PriceService {
  private readonly crypto: CryptoPriceCache;
  private readonly fiat: FiatRateCache;
  private readonly now: () => number;

  constructor({ coingecko, frankfurter, store, settings, now = Date.now }: PriceServiceOptions) {
    this.now = now;
    const cached = store.loadAll();
    this.crypto = new CryptoPriceCache(
      {
        client: coingecko,
        store,
        now,
        freshMs: settings.cryptoFreshMs,
        maxStaleMs: settings.cryptoMaxStaleMs,
        backoffMs: settings.failureBackoffMs,
      },
      cached.filter((price) => price.source === 'coingecko'),
    );
    this.fiat = new FiatRateCache(
      {
        client: frankfurter,
        store,
        now,
        maxStaleMs: settings.fiatMaxStaleMs,
        recheckMs: settings.fiatRecheckMs,
        backoffMs: settings.failureBackoffMs,
      },
      cached.filter((price) => price.source === 'frankfurter'),
    );
  }

  /** Results in the same order as the requested assets. Never rejects because of an upstream failure. */
  async getPrices(assets: readonly Asset[]): Promise<PriceResult[]> {
    const crypto = assets.filter(isCryptoAsset);
    const fiat = assets.filter((asset): asset is FiatAsset => !isCryptoAsset(asset) && asset !== 'CAD');
    const [cryptoResults, fiatResults] = await Promise.all([this.crypto.get(crypto), this.fiat.get(fiat)]);

    const byAsset = new Map<Asset, PriceResult>([...cryptoResults, ...fiatResults].map((r) => [r.asset, r]));
    const now = this.now();
    return assets.map((asset) =>
      asset === 'CAD'
        ? { status: 'fresh', asset, source: 'fixed', priceCad: '1', asOf: now, fetchedAt: now }
        : byAsset.get(asset)!,
    );
  }
}
