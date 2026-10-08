import type { ReactNode } from 'react';
import type { PortfolioValuation, PricesUnavailableError } from '@portfolio/contracts';
import { ApiRequestError } from '../api/client';
import { useValuation } from '../api/hooks';
import { formatCad, formatDateTime, REASON_TEXT, SOURCE_LABEL } from '../format';
import { useCountdown, useDelayedFlag } from '../hooks';
import { FreshnessBanner, HoldingsTable } from './ValuationDetails';

export function ValuationPanel({ portfolioId }: { portfolioId: string }) {
  const { data, error, isPending, isFetching, refetch, errorUpdatedAt } = useValuation(portfolioId);

  // Pending = nothing to show yet; TanStack keeps it pending through transient retries too.
  if (isPending) return <LoadingValue />;

  return (
    <section aria-label="Portfolio value">
      {error && (
        <ErrorNotice
          // A new failure restarts the Retry-After countdown.
          key={errorUpdatedAt}
          error={error}
          shownValuesFrom={data?.computedAt}
          onRetry={() => void refetch()}
        />
      )}
      {data && <ValuationSummary valuation={data} refreshing={isFetching} />}
    </section>
  );
}

function LoadingValue() {
  const slow = useDelayedFlag(1000);
  return (
    <p role="status" aria-busy="true">
      Loading portfolio value…
      {slow && ' Fetching live prices from CoinGecko and the ECB can take a few seconds.'}
    </p>
  );
}

function ValuationSummary({ valuation, refreshing }: { valuation: PortfolioValuation; refreshing: boolean }) {
  return (
    <>
      <FreshnessBanner valuation={valuation} />
      <p className="total">
        Total value: <strong>{formatCad(valuation.totalCad)}</strong>
        {valuation.status === 'degraded' && <span className="badge">includes stale prices</span>}
      </p>
      <p className="meta">
        Computed {formatDateTime(valuation.computedAt)}
        {refreshing && <span aria-live="polite"> · Refreshing…</span>}
      </p>
      <HoldingsTable holdings={valuation.holdings} />
    </>
  );
}

type ErrorNoticeProps = { error: Error; shownValuesFrom: string | undefined; onRetry: () => void };

function ErrorNotice({ error, shownValuesFrom, onRetry }: ErrorNoticeProps) {
  const staleNote = shownValuesFrom && (
    <> The values below are from the last successful refresh at {formatDateTime(shownValuesFrom)}.</>
  );

  if (error instanceof ApiRequestError && error.pricesUnavailable) {
    return (
      <PricesUnavailableNotice
        details={error.pricesUnavailable}
        retryAfterSeconds={error.retryAfterSeconds ?? error.pricesUnavailable.retryAfterSeconds}
        staleNote={staleNote}
        onRetry={onRetry}
      />
    );
  }
  if (error instanceof ApiRequestError && error.status === 404) {
    return <div role="alert" className="banner banner-error">This portfolio no longer exists. Choose another one above.</div>;
  }
  const cause = error instanceof ApiRequestError ? error.message : 'The API could not be reached.';
  return (
    <div role="alert" className="banner banner-error">
      <strong>{shownValuesFrom ? 'Could not refresh the value.' : 'Could not load the value.'}</strong> {cause}
      {staleNote} <button onClick={onRetry}>Retry</button>
    </div>
  );
}

type PricesUnavailableNoticeProps = {
  details: PricesUnavailableError['error'];
  retryAfterSeconds: number;
  staleNote: ReactNode;
  onRetry: () => void;
};

function PricesUnavailableNotice({ details, retryAfterSeconds, staleNote, onRetry }: PricesUnavailableNoticeProps) {
  const remaining = useCountdown(retryAfterSeconds, onRetry);
  return (
    <div role="alert" className="banner banner-error">
      <strong>The portfolio can't be valued right now.</strong> There is no usable price for:
      <ul>
        {details.assets.map((asset) => (
          <li key={asset.asset}>
            {asset.asset}: {SOURCE_LABEL[asset.source]} {REASON_TEXT[asset.reason]}
          </li>
        ))}
      </ul>
      No total is shown rather than a partial one.{staleNote}{' '}
      {remaining > 0 ? `Retrying automatically in ${remaining}s.` : 'Retrying…'}{' '}
      <button onClick={onRetry}>Try now</button>
    </div>
  );
}
