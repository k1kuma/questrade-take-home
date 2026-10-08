import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ApiError, Portfolio } from '@portfolio/contracts';
import { HoldingsEditor } from './HoldingsEditor';

const saved: Portfolio = {
  id: 'p1',
  name: 'Retirement',
  holdings: [
    { asset: 'BTC', amount: '0.5' },
    { asset: 'USD', amount: '2500' },
  ],
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function renderEditor(fetchMock = vi.fn()) {
  vi.stubGlobal('fetch', fetchMock);
  const onDone = vi.fn();
  render(
    <QueryClientProvider client={new QueryClient()}>
      <HoldingsEditor portfolio={saved} onDone={onDone} />
    </QueryClientProvider>,
  );
  return { fetchMock, onDone };
}

const type = (label: string | RegExp, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('HoldingsEditor', () => {
  it('validates with the shared schema before sending anything', async () => {
    const { fetchMock } = renderEditor();

    type('BTC amount', 'abc');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText(/Amount must be a positive decimal/)).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sends one PUT with the edited name and holdings, then closes', async () => {
    const fetchMock = vi.fn().mockResolvedValue(json({ ...saved, name: 'Pension' }));
    const { onDone } = renderEditor(fetchMock);

    type('Name', 'Pension');
    type('USD amount', '3000');
    fireEvent.click(screen.getByRole('button', { name: 'Add holding' }));
    type('ETH amount', '1.25');
    fireEvent.click(screen.getByRole('button', { name: 'Remove BTC' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await vi.waitFor(() => expect(onDone).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('/api/portfolios/p1');
    expect(init.method).toBe('PUT');
    expect(JSON.parse(init.body)).toEqual({
      name: 'Pension',
      holdings: [
        { asset: 'USD', amount: '3000' },
        { asset: 'ETH', amount: '1.25' },
      ],
    });
  });

  it('shows a server validation error next to the row it belongs to, keeping the edits', async () => {
    const rejected: ApiError = {
      error: {
        code: 'VALIDATION_FAILED',
        message: 'Request body is invalid',
        details: [{ path: 'holdings.1.amount', message: 'Rejected by the server' }],
      },
    };
    renderEditor(vi.fn().mockResolvedValue(json(rejected, 400)));

    type('USD amount', '3000');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    const message = await screen.findByText('Rejected by the server');
    expect(message.closest('tr')?.textContent).toMatch(/USD/);
    expect((screen.getByLabelText('USD amount') as HTMLInputElement).value).toBe('3000');
  });
});
