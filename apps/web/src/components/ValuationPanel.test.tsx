import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PortfolioValuation, PricesUnavailableError } from '@portfolio/contracts';
import { ValuationPanel } from './ValuationPanel';

function renderWithResponse(response: Response) {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response));
  const client = new QueryClient();
  render(
    <QueryClientProvider client={client}>
      <ValuationPanel portfolioId="p1" />
    </QueryClientProvider>,
  );
}

const json = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), { ...init, headers: { 'content-type': 'application/json', ...init.headers } });

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('ValuationPanel', () => {
  it('makes a degraded valuation visibly not-live: banner, total badge and stale rows', async () => {
    const degraded: PortfolioValuation = {
      portfolioId: 'p1',
      currency: 'CAD',
      totalCad: '61420.00',
      status: 'degraded',
      computedAt: '2026-10-05T12:00:00.000Z',
      holdings: [
        { asset: 'BTC', amount: '0.5', unitPriceCad: '120000', subtotalCad: '60000.00', source: 'coingecko', asOf: '2026-10-05T11:55:00.000Z', stale: true, staleReason: 'rate_limited' },
        { asset: 'USD', amount: '1000', unitPriceCad: '1.42', subtotalCad: '1420.00', source: 'frankfurter', asOf: '2026-10-05T14:00:00.000Z', stale: false },
      ],
      sources: {
        coingecko: { status: 'stale', reason: 'rate_limited', retryAt: '2026-10-05T12:01:00.000Z' },
        frankfurter: { status: 'fresh' },
      },
    };

    renderWithResponse(json(degraded));

    // The loading message is also role="status", so wait for the banner's own text.
    const banner = (await screen.findByText('Some prices are not live.')).closest('[role="status"]')!;
    expect(banner.textContent).toMatch(/CoinGecko \(crypto prices\) is rate-limiting requests/);
    expect(screen.getByText('includes stale prices')).toBeTruthy();

    const btcRow = screen.getByRole('row', { name: /BTC/ });
    expect(btcRow.className).toBe('stale');
    expect(within(btcRow).getByText(/Stale: source is rate-limiting requests/)).toBeTruthy();
    expect(screen.getByRole('row', { name: /USD/ }).className).toBe('');
  });

  it('on 503 explains which assets cannot be priced, shows no total, and counts down to a retry', async () => {
    const unavailable: PricesUnavailableError = {
      error: {
        code: 'PRICES_UNAVAILABLE',
        message: 'Some holdings have no usable price.',
        assets: [{ asset: 'BTC', source: 'coingecko', reason: 'rate_limited' }],
        retryAfterSeconds: 30,
      },
    };

    renderWithResponse(json(unavailable, { status: 503, headers: { 'retry-after': '30' } }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/can't be valued right now/);
    expect(alert.textContent).toMatch(/BTC: CoinGecko \(crypto prices\) is rate-limiting requests/);
    expect(alert.textContent).toMatch(/Retrying automatically in 30s/);
    expect(screen.queryByText(/Total value/)).toBeNull();
  });
});
