import { describe, expect, it } from 'vitest';
import type { Portfolio } from '@portfolio/contracts';
import { draftReducer, toDraft } from './draft';

const saved: Portfolio = {
  id: 'p1',
  name: 'Retirement',
  holdings: [
    { asset: 'BTC', amount: '0.5' },
    { asset: 'USD', amount: '2500' },
    { asset: 'EUR', amount: '1000' },
  ],
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
};

describe('draftReducer', () => {
  it('replaces only the edited row, so the other rows keep their identity (and skip re-rendering)', () => {
    const draft = toDraft(saved);
    const [btc, usd, eur] = draft.rows;

    const next = draftReducer(draft, { type: 'editRow', key: usd!.key, field: 'amount', value: '3000' });

    expect(next.rows[0]).toBe(btc);
    expect(next.rows[1]).toEqual({ ...usd, amount: '3000' });
    expect(next.rows[1]).not.toBe(usd);
    expect(next.rows[2]).toBe(eur);
  });
});
