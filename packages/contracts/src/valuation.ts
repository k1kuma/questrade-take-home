import type { Asset } from './assets';

export type UpstreamName = 'coingecko' | 'frankfurter';
/** CAD is the valuation currency, so it is priced at 1 without any upstream. */
export type PriceSource = UpstreamName | 'fixed';
export type FailureReason = 'rate_limited' | 'timeout' | 'unavailable' | 'bad_response';

export type HoldingValuation = {
  asset: Asset;
  amount: string;
  /** Full upstream precision. */
  unitPriceCad: string;
  /** Rounded to cents. */
  subtotalCad: string;
  source: PriceSource;
  /** When the upstream says the price is from; for fiat, the ECB publish time of the rate's date. */
  asOf: string;
  stale: boolean;
  staleReason?: FailureReason;
};

export type SourceStatus =
  | { status: 'fresh' }
  | { status: 'stale'; reason: FailureReason; retryAt?: string };

export type PortfolioValuation = {
  portfolioId: string;
  currency: 'CAD';
  /** Sum of unrounded subtotals, rounded to cents; may differ by a cent from adding the rounded subtotals. */
  totalCad: string;
  /** 'degraded' when any holding is priced from a stale fallback. */
  status: 'complete' | 'degraded';
  computedAt: string;
  holdings: HoldingValuation[];
  /** Only the upstreams this portfolio needed. */
  sources: Partial<Record<UpstreamName, SourceStatus>>;
};

export type UnavailableAsset = {
  asset: Asset;
  source: UpstreamName;
  reason: FailureReason;
};

export type PricesUnavailableError = {
  error: {
    code: 'PRICES_UNAVAILABLE';
    message: string;
    assets: UnavailableAsset[];
    retryAfterSeconds: number;
  };
};
