import type { FailureReason, HoldingValuation, UpstreamName } from '@portfolio/contracts';

const cad = new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' });
// Unit prices span $0.13 (DOGE) to $120,000 (BTC), so precision is by significant digits.
const unitPrice = new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD', maximumSignificantDigits: 8 });
const dateTime = new Intl.DateTimeFormat('en-CA', { dateStyle: 'medium', timeStyle: 'medium' });
const day = new Intl.DateTimeFormat('en-CA', { dateStyle: 'medium' });

// Number() is display-only; all arithmetic happened server-side in decimals.
export const formatCad = (value: string) => cad.format(Number(value));
export const formatUnitPrice = (value: string) => unitPrice.format(Number(value));
export const formatDateTime = (iso: string) => dateTime.format(new Date(iso));

export function describeAsOf(holding: HoldingValuation): string {
  switch (holding.source) {
    case 'frankfurter':
      return `ECB rate of ${day.format(new Date(holding.asOf))}`;
    case 'coingecko':
      return formatDateTime(holding.asOf);
    case 'fixed':
      return 'Base currency';
  }
}

export const SOURCE_LABEL: Record<UpstreamName, string> = {
  coingecko: 'CoinGecko (crypto prices)',
  frankfurter: 'Frankfurter / ECB (exchange rates)',
};

export const REASON_TEXT: Record<FailureReason, string> = {
  rate_limited: 'is rate-limiting requests',
  timeout: 'timed out',
  unavailable: 'is unavailable',
  bad_response: 'returned an unexpected response',
};
