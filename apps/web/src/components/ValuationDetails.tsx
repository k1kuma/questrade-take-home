import { memo } from 'react';
import type { HoldingValuation, PortfolioValuation } from '@portfolio/contracts';
import { describeAsOf, formatAmount, formatCad, REASON_TEXT, SOURCE_LABEL } from '../format';

/** Rendered only for degraded valuations: says which upstream failed and that the affected prices are not live. */
export function FreshnessBanner({ valuation }: { valuation: PortfolioValuation }) {
  if (valuation.status === 'complete') return null;
  const staleSources = (Object.keys(valuation.sources) as (keyof typeof valuation.sources)[]).flatMap((name) => {
    const source = valuation.sources[name];
    return source?.status === 'stale' ? [{ name, ...source }] : [];
  });

  return (
    <div role="status" className="banner banner-warning">
      <strong>Some prices are not live.</strong> The total uses the last good price for each holding marked
      stale below.
      <ul>
        {staleSources.map((source) => (
          <li key={source.name}>
            {SOURCE_LABEL[source.name]} {REASON_TEXT[source.reason]}
            {source.retryAt && ` (next attempt after ${new Date(source.retryAt).toLocaleTimeString('en-CA')})`}
          </li>
        ))}
      </ul>
    </div>
  );
}

// Memoized: TanStack Query keeps `holdings` referentially equal when a refetch returns identical data.
export const HoldingsTable = memo(function HoldingsTable({ holdings }: { holdings: HoldingValuation[] }) {
  if (holdings.length === 0) return <p className="empty">This portfolio has no holdings.</p>;
  return (
    <div className="table-scroll">
      <table className="holdings-table">
        <thead>
          <tr>
            <th scope="col">Asset</th>
            <th scope="col" className="num">Amount</th>
            <th scope="col" className="num">Unit price</th>
            <th scope="col" className="num">Subtotal</th>
            <th scope="col" className="text-right">
              Price as of
            </th>
          </tr>
        </thead>
        <tbody>
          {holdings.map((holding) => (
            <tr key={holding.asset} className={holding.stale ? 'stale' : undefined}>
              <th scope="row" className="cell-asset">
                {holding.asset}
              </th>
              <td className="num cell-amount" data-label="Amount">
                {formatAmount(holding.amount)}
              </td>
              <td className="num cell-price" data-label="Unit price">
                {formatCad(holding.unitPriceCad)}
              </td>
              <td className="num cell-subtotal">{formatCad(holding.subtotalCad)}</td>
              <td className="meta text-right cell-asof" data-label="As of">
                {describeAsOf(holding)}
                {holding.stale && holding.staleReason && (
                  <span className="badge">Stale: source {REASON_TEXT[holding.staleReason]}</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
});
