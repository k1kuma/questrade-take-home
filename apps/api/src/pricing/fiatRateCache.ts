import type { FiatAsset } from '@portfolio/contracts';
import { ecbDate, latestPublishAt, publishAt } from './ecbCalendar';
import type { FrankfurterClient } from './frankfurter';
import type { PriceStore } from './priceStore';
import { SourceHealth } from './sourceHealth';
import { staleOrUnavailable, type CachedPrice, type PriceResult } from './types';

export type FiatRateCacheOptions = {
  client: Pick<FrankfurterClient, 'getLatestRates'>;
  store: PriceStore;
  now: () => number;
  maxStaleMs: number;
  recheckMs: number;
  backoffMs: number;
};

/**
 * ECB rates change once per working day, so the whole table is refetched only after the next
 * expected publish. A rate is fresh if we have checked Frankfurter since the latest expected
 * publish, whatever its date: Friday's rate on Sunday is the current rate.
 */
export class FiatRateCache {
  private readonly prices = new Map<FiatAsset, CachedPrice>();
  private fetchedAt: number | undefined;
  private rateDate: string | undefined;
  private inFlight: Promise<void> | undefined;
  private readonly health: SourceHealth;

  constructor(
    private readonly options: FiatRateCacheOptions,
    initial: readonly CachedPrice[],
  ) {
    this.health = new SourceHealth('frankfurter', options.backoffMs);
    for (const price of initial) this.prices.set(price.asset as FiatAsset, price);
    if (initial.length > 0) {
      this.fetchedAt = Math.max(...initial.map((p) => p.fetchedAt));
      this.rateDate = ecbDate(Math.max(...initial.map((p) => p.asOf)));
    }
  }

  async get(assets: readonly FiatAsset[]): Promise<PriceResult[]> {
    if (assets.length === 0) return [];
    const now = this.options.now();
    if (!this.inFlight && this.isDue(now) && !this.health.isBlocked(now)) {
      this.inFlight = this.fetch().finally(() => {
        this.inFlight = undefined;
      });
    }
    await this.inFlight;

    const after = this.options.now();
    const lastPublish = latestPublishAt(after);
    return assets.map((asset) => {
      const price = this.prices.get(asset);
      if (price && price.fetchedAt >= lastPublish) return { status: 'fresh', ...price };
      return staleOrUnavailable(asset, 'frankfurter', price, this.health.lastFailure, this.options.maxStaleMs, after);
    });
  }

  private isDue(now: number): boolean {
    if (this.fetchedAt === undefined || this.rateDate === undefined) return true;
    const lastPublish = latestPublishAt(now);
    if (this.fetchedAt < lastPublish) return true;
    // Checked since the publish time but still on an older date: the ECB is late or it's a holiday.
    return this.rateDate < ecbDate(lastPublish) && now - this.fetchedAt >= this.options.recheckMs;
  }

  private async fetch(): Promise<void> {
    console.info('[frankfurter] fetching latest rates');
    let rates;
    try {
      rates = await this.options.client.getLatestRates();
    } catch (err) {
      this.health.recordFailure(err, this.options.now());
      return;
    }
    const fetchedAt = this.options.now();
    this.health.recordSuccess();
    this.fetchedAt = fetchedAt;
    this.rateDate = rates.rateDate;
    const asOf = publishAt(rates.rateDate);
    const prices = rates.quotes
      .filter((quote) => quote.asset !== 'CAD')
      .map((quote): CachedPrice => {
        const price: CachedPrice = { asset: quote.asset, source: 'frankfurter', priceCad: quote.priceCad, asOf, fetchedAt };
        this.prices.set(quote.asset, price);
        return price;
      });
    this.options.store.save(prices);
  }
}
