import { describe, expect, it } from 'vitest';
import type { Portfolio } from '@portfolio/contracts';
import { draftReducer, isDirty, toDraft, toFieldErrors, toRequest } from './draft';

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

  it('adds a row for the first asset not already held, and removes rows by key', () => {
    const draft = toDraft(saved);

    const added = draftReducer(draft, { type: 'addRow' });
    const removed = draftReducer(added, { type: 'removeRow', key: draft.rows[0]!.key });

    expect(added.rows.at(-1)).toMatchObject({ asset: 'ETH', amount: '' });
    expect(removed.rows.map((row) => row.asset)).toEqual(['USD', 'EUR', 'ETH']);
  });
});

describe('draft helpers', () => {
  it('is dirty only when the name or holdings differ from what was saved', () => {
    const draft = toDraft(saved);

    expect(isDirty(draft, saved)).toBe(false);
    expect(isDirty(draftReducer(draft, { type: 'rename', name: 'Pension' }), saved)).toBe(true);
  });

  it('maps validation paths onto row keys, so errors follow rows', () => {
    const draft = toDraft(saved);

    const errors = toFieldErrors(
      [
        { path: 'name', message: 'Name is required' },
        { path: 'holdings.1.amount', message: 'Bad amount' },
        { path: 'holdings', message: 'Too many holdings' },
      ],
      draft.rows,
    );

    expect(errors).toEqual({
      name: 'Name is required',
      [`${draft.rows[1]!.key}.amount`]: 'Bad amount',
      form: 'Too many holdings',
    });
    expect(toRequest(draft).holdings[1]).toEqual({ asset: 'USD', amount: '2500' });
  });
});
