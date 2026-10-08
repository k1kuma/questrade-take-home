import { memo } from 'react';
import type { HoldingValuation, PortfolioValuation } from '@portfolio/contracts';
import { describeAsOf, formatCad, formatUnitPrice, REASON_TEXT, SOURCE_LABEL } from '../format';

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
  if (holdings.length === 0) return <p>This portfolio has no holdings.</p>;
  return (
    <table>
      <thead>
        <tr>
          <th scope="col">Asset</th>
          <th scope="col">Amount</th>
          <th scope="col">Unit price</th>
          <th scope="col">Subtotal</th>
          <th scope="col">Price as of</th>
        </tr>
      </thead>
      <tbody>
        {holdings.map((holding) => (
          <tr key={holding.asset} className={holding.stale ? 'stale' : undefined}>
            <th scope="row">{holding.asset}</th>
            <td>{holding.amount}</td>
            <td>{formatUnitPrice(holding.unitPriceCad)}</td>
            <td>{formatCad(holding.subtotalCad)}</td>
            <td>
              {describeAsOf(holding)}
              {holding.stale && holding.staleReason && (
                <span className="badge">Stale: source {REASON_TEXT[holding.staleReason]}</span>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
});
