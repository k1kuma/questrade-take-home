import { ASSETS, type Portfolio, type PortfolioRequest } from '@portfolio/contracts';

/** Values are kept as typed (strings) until save; parsing is the shared schema's job. */
export type DraftRow = { key: string; asset: string; amount: string };
export type Draft = { name: string; rows: DraftRow[] };

export type DraftAction =
  | { type: 'rename'; name: string }
  | { type: 'addRow' }
  | { type: 'removeRow'; key: string }
  | { type: 'editRow'; key: string; field: 'asset' | 'amount'; value: string };

let lastKey = 0;
// Stable row identity, so React keys and error messages stay with a row when another is removed.
const newKey = () => `row-${++lastKey}`;

export function toDraft(portfolio: Portfolio): Draft {
  return {
    name: portfolio.name,
    rows: portfolio.holdings.map((holding) => ({ key: newKey(), asset: holding.asset, amount: holding.amount })),
  };
}

/** Pure; unchanged rows keep their object identity, so memoized rows skip re-rendering. */
export function draftReducer(draft: Draft, action: DraftAction): Draft {
  switch (action.type) {
    case 'rename':
      return { ...draft, name: action.name };
    case 'addRow': {
      const used = new Set(draft.rows.map((row) => row.asset));
      const asset = ASSETS.find((candidate) => !used.has(candidate)) ?? '';
      return { ...draft, rows: [...draft.rows, { key: newKey(), asset, amount: '' }] };
    }
    case 'removeRow':
      return { ...draft, rows: draft.rows.filter((row) => row.key !== action.key) };
    case 'editRow':
      return {
        ...draft,
        rows: draft.rows.map((row) => (row.key === action.key ? { ...row, [action.field]: action.value } : row)),
      };
  }
}

export function toRequest(draft: Draft): PortfolioRequest {
  return {
    name: draft.name,
    holdings: draft.rows.map((row) => ({ asset: row.asset, amount: row.amount.trim() })),
  };
}

export function isDirty(draft: Draft, saved: Portfolio): boolean {
  const request = toRequest(draft);
  return request.name !== saved.name || JSON.stringify(request.holdings) !== JSON.stringify(saved.holdings);
}

/** Keys: 'name', `${rowKey}.asset`, `${rowKey}.amount`, or 'form' for anything not tied to one field. */
export type FieldErrors = Partial<Record<string, string>>;

/**
 * Maps validation details onto the draft. Client (zod) and server (400 details) use the same paths,
 * e.g. 'holdings.2.amount', so one mapping serves both.
 */
export function toFieldErrors(details: { path: string; message: string }[], rows: DraftRow[]): FieldErrors {
  const errors: FieldErrors = {};
  for (const { path, message } of details) {
    const [first, index, field] = path.split('.');
    const row = first === 'holdings' && index !== undefined ? rows[Number(index)] : undefined;
    const key = path === 'name' ? 'name' : row && field ? `${row.key}.${field}` : 'form';
    errors[key] ??= message;
  }
  return errors;
}
