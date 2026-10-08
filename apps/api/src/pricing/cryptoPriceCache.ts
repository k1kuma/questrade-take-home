import type { CryptoAsset } from '@portfolio/contracts';
import type { CoinGeckoClient } from './coingecko';
import type { PriceStore } from './priceStore';
import { SourceHealth } from './sourceHealth';
import { staleOrUnavailable, type CachedPrice, type PriceResult } from './types';

export type CryptoPriceCacheOptions = {
  client: Pick<CoinGeckoClient, 'getPrices'>;
  store: PriceStore;
  now: () => number;
  freshMs: number;
  maxStaleMs: number;
  backoffMs: number;
};

/**
 * Asks CoinGecko about each coin at most once per freshMs, however many requests arrive.
 * Concurrent requests for the same coin share one in-flight call.
 */
export class CryptoPriceCache {
  private readonly prices = new Map<CryptoAsset, CachedPrice>();
  // Last successful check per coin, including checks where CoinGecko omitted the coin.
  private readonly checkedAt = new Map<CryptoAsset, number>();
  private readonly inFlight = new Map<CryptoAsset, Promise<void>>();
  private readonly health: SourceHealth;

  constructor(
    private readonly options: CryptoPriceCacheOptions,
    initial: readonly CachedPrice[],
  ) {
    this.health = new SourceHealth('coingecko', options.backoffMs);
    for (const price of initial) {
      const asset = price.asset as CryptoAsset;
      this.prices.set(asset, price);
      this.checkedAt.set(asset, price.fetchedAt);
    }
  }

  async get(assets: readonly CryptoAsset[]): Promise<PriceResult[]> {
    const now = this.options.now();
    const due = assets.filter((asset) => !this.inFlight.has(asset) && this.isDue(asset, now));
    if (due.length > 0 && !this.health.isBlocked(now)) {
      this.startFetch([...due, ...this.piggybackCandidates(due, now)]);
    }
    await Promise.all(new Set(assets.map((asset) => this.inFlight.get(asset))));

    const after = this.options.now();
    return assets.map((asset) => this.resolve(asset, after));
  }

  private isDue(asset: CryptoAsset, now: number): boolean {
    const checkedAt = this.checkedAt.get(asset);
    return checkedAt === undefined || now - checkedAt >= this.options.freshMs;
  }

  // Coins past half their freshness window ride along, so they rarely need a call of their own.
  private piggybackCandidates(due: readonly CryptoAsset[], now: number): CryptoAsset[] {
    return [...this.prices.keys()].filter(
      (asset) =>
        !due.includes(asset) &&
        !this.inFlight.has(asset) &&
        now - (this.checkedAt.get(asset) ?? 0) >= this.options.freshMs / 2,
    );
  }

  private startFetch(batch: CryptoAsset[]): void {
    const request = this.fetch(batch).finally(() => {
      for (const asset of batch) this.inFlight.delete(asset);
    });
    for (const asset of batch) this.inFlight.set(asset, request);
  }

  private async fetch(batch: CryptoAsset[]): Promise<void> {
    console.info(`[coingecko] fetching ${batch.join(', ')}`);
    let quotes;
    try {
      quotes = await this.options.client.getPrices(batch);
    } catch (err) {
      this.health.recordFailure(err, this.options.now());
      return;
    }
    const fetchedAt = this.options.now();
    this.health.recordSuccess();
    for (const asset of batch) this.checkedAt.set(asset, fetchedAt);
    const prices = quotes.map((quote): CachedPrice => {
      const price: CachedPrice = {
        asset: quote.asset,
        source: 'coingecko',
        priceCad: quote.priceCad,
        asOf: quote.lastUpdatedAt,
        fetchedAt,
      };
      this.prices.set(quote.asset, price);
      return price;
    });
    this.options.store.save(prices);
  }

  private resolve(asset: CryptoAsset, now: number): PriceResult {
    const price = this.prices.get(asset);
    if (price && now - price.fetchedAt < this.options.freshMs) return { status: 'fresh', ...price };
    return staleOrUnavailable(asset, 'coingecko', price, this.health.lastFailure, this.options.maxStaleMs, now);
  }
}
