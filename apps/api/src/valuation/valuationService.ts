import { createHash } from 'node:crypto';
import Decimal from 'decimal.js';
import type {
  HistoryQuery,
  HoldingValuation,
  Portfolio,
  PortfolioValuation,
  SourceStatus,
  UnavailableAsset,
  ValuationHistory,
} from '@portfolio/contracts';
import type { PriceService } from '../pricing/priceService';
import type { PriceResult } from '../pricing/types';
import type { ValuationRepository } from './repository';

type PricedResult = Exclude<PriceResult, { status: 'unavailable' }>;
type UnavailableResult = Extract<PriceResult, { status: 'unavailable' }>;

export type ValuationOutcome =
  | { kind: 'valued'; valuation: PortfolioValuation }
  | { kind: 'unavailable'; assets: UnavailableAsset[]; retryAfterSeconds: number };

function toCents(value: Decimal): string {
  return value.toFixed(2, Decimal.ROUND_HALF_EVEN);
}

function summarizeSources(prices: readonly PricedResult[]): PortfolioValuation['sources'] {
  const sources: PortfolioValuation['sources'] = {};
  for (const price of prices) {
    if (price.source === 'fixed') continue;
    const current: SourceStatus = sources[price.source] ?? { status: 'fresh' };
    if (price.status === 'stale' && current.status === 'fresh') {
      sources[price.source] = {
        status: 'stale',
        reason: price.reason,
        ...(price.retryAt !== undefined && { retryAt: new Date(price.retryAt).toISOString() }),
      };
    } else {
      sources[price.source] = current;
    }
  }
  return sources;
}

export class ValuationService {
  constructor(
    private readonly prices: PriceService,
    private readonly snapshots: ValuationRepository,
    private readonly now: () => number = Date.now,
    private readonly defaultRetryMs = 60_000,
  ) {}

  async value(portfolio: Portfolio): Promise<ValuationOutcome> {
    const results = await this.prices.getPrices(portfolio.holdings.map((holding) => holding.asset));
    const now = this.now();

    const priced: PricedResult[] = [];
    const unavailable: UnavailableResult[] = [];
    for (const result of results) {
      if (result.status === 'unavailable') unavailable.push(result);
      else priced.push(result);
    }

    // A total missing a holding is wrong even if labelled, so refuse rather than return a partial one.
    if (unavailable.length > 0) {
      // A retry only succeeds once every needed upstream has recovered.
      const retryAt = Math.max(...unavailable.map((r) => r.retryAt ?? now + this.defaultRetryMs));
      return {
        kind: 'unavailable',
        assets: unavailable.map(({ asset, source, reason }) => ({ asset, source, reason })),
        retryAfterSeconds: Math.max(1, Math.ceil((retryAt - now) / 1000)),
      };
    }

    let total = new Decimal(0);
    const holdings = portfolio.holdings.map((holding, index): HoldingValuation => {
      const price = priced[index]!;
      const subtotal = new Decimal(holding.amount).times(price.priceCad);
      total = total.plus(subtotal);
      return {
        asset: holding.asset,
        amount: holding.amount,
        unitPriceCad: price.priceCad,
        subtotalCad: toCents(subtotal),
        source: price.source,
        asOf: new Date(price.asOf).toISOString(),
        stale: price.status === 'stale',
        ...(price.status === 'stale' && { staleReason: price.reason }),
      };
    });

    const valuation: PortfolioValuation = {
      portfolioId: portfolio.id,
      currency: 'CAD',
      totalCad: toCents(total),
      status: holdings.some((holding) => holding.stale) ? 'degraded' : 'complete',
      computedAt: new Date(now).toISOString(),
      holdings,
      sources: summarizeSources(priced),
    };

    this.snapshots.recordIfChanged({
      portfolioId: portfolio.id,
      computedAt: now,
      totalCad: valuation.totalCad,
      status: valuation.status,
      // Only what changes the value; asOf is excluded so an unchanged price re-confirmed later is not a new point.
      fingerprint: createHash('sha256')
        .update(JSON.stringify(holdings.map((h) => [h.asset, h.amount, h.unitPriceCad, h.stale])))
        .digest('hex'),
      breakdown: holdings,
    });

    return { kind: 'valued', valuation };
  }

  history(portfolioId: string, query: HistoryQuery): ValuationHistory {
    const to = query.to ? Date.parse(query.to) : this.now();
    const earliest = this.snapshots.earliestComputedAt(portfolioId) ?? to;
    const from = query.from ? Date.parse(query.from) : Math.min(earliest, to);
    const { points, downsampled } = this.snapshots.history({ portfolioId, from, to }, query.maxPoints);
    return {
      portfolioId,
      from: new Date(from).toISOString(),
      to: new Date(to).toISOString(),
      downsampled,
      points,
    };
  }
}
