import type { Asset } from '@portfolio/contracts';
import type { UpstreamFailureReason, UpstreamSource } from './errors';
import type { SourceFailure } from './sourceHealth';

export type CachedPrice = {
  asset: Asset;
  source: UpstreamSource;
  priceCad: string;
  /** When the upstream says the price is from, epoch ms. */
  asOf: number;
  /** When we received it, epoch ms. */
  fetchedAt: number;
};

type Failure = { reason: UpstreamFailureReason; retryAt?: number };

/** CAD is the valuation currency, so it is priced at 1 without any upstream. */
export type PriceSource = UpstreamSource | 'fixed';

export type PriceResult =
  | ({ status: 'fresh' } & Omit<CachedPrice, 'source'> & { source: PriceSource })
  | ({ status: 'stale' } & CachedPrice & Failure)
  | ({ status: 'unavailable'; asset: Asset; source: UpstreamSource } & Failure);

/** The result for an asset whose price could not be refreshed just now. */
export function staleOrUnavailable(
  asset: Asset,
  source: UpstreamSource,
  price: CachedPrice | undefined,
  failure: SourceFailure | undefined,
  maxStaleMs: number,
  now: number,
): PriceResult {
  // Not fresh with no recorded failure means the upstream answered but left this asset out.
  const reason = failure?.reason ?? 'bad_response';
  const retryAt = failure?.retryAt;
  if (price && now - price.asOf <= maxStaleMs) {
    return { status: 'stale', ...price, reason, retryAt };
  }
  return { status: 'unavailable', asset, source, reason, retryAt };
}
