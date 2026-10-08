import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PortfolioList } from '@portfolio/contracts';
import { App } from '../App';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('PortfoliosPage (the root route)', () => {
  it('lists every portfolio by name with its holding count, linking to its own page', async () => {
    const list: PortfolioList = {
      portfolios: [
        { id: 'p1', name: 'Retirement', assets: ['BTC', 'USD'], createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-05T00:00:00.000Z' },
        { id: 'p2', name: 'Portfolio 2', assets: [], createdAt: '2026-10-02T00:00:00.000Z', updatedAt: '2026-10-02T00:00:00.000Z' },
      ],
    };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(list))));

    render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter initialEntries={['/']}>
          <App />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect((await screen.findByRole('link', { name: 'Retirement' })).getAttribute('href')).toBe('/portfolios/p1');
    expect(screen.getByRole('link', { name: 'Portfolio 2' }).getAttribute('href')).toBe('/portfolios/p2');
    const cells = (name: RegExp) => within(screen.getByRole('row', { name })).getAllByRole('cell').map((c) => c.textContent);
    expect(cells(/Retirement/).slice(0, 2)).toEqual(['Retirement', '2']);
    expect(cells(/Portfolio 2/).slice(0, 2)).toEqual(['Portfolio 2', '0']);
  });
});
