import { memo, useCallback, useMemo, useReducer, useState, type FormEvent } from 'react';
import {
  ASSETS,
  CRYPTO_ASSETS,
  FIAT_ASSETS,
  PortfolioInputSchema,
  type ApiError,
  type Portfolio,
} from '@portfolio/contracts';
import { ApiRequestError } from '../../api/client';
import { useUpdatePortfolio } from '../../api/hooks';
import {
  draftReducer,
  isDirty,
  toDraft,
  toFieldErrors,
  toRequest,
  type DraftAction,
  type DraftRow,
  type FieldErrors,
} from './draft';

type Props = { portfolio: Portfolio; onDone: () => void };

/**
 * Edits a copy of the portfolio taken when editing starts; nothing is sent until Save.
 * The draft lives here, so typing re-renders only this form, never the value panel.
 */
export function HoldingsEditor({ portfolio, onDone }: Props) {
  const [draft, dispatch] = useReducer(draftReducer, portfolio, toDraft);
  const [errors, setErrors] = useState<FieldErrors>({});
  const save = useUpdatePortfolio(portfolio.id);
  const dirty = useMemo(() => isDirty(draft, portfolio), [draft, portfolio]);

  // Stable (dispatch and setErrors never change), so memoized rows don't re-render when another row changes.
  const edit = useCallback((action: DraftAction) => {
    dispatch(action);
    const fieldKey =
      action.type === 'editRow' ? `${action.key}.${action.field}` : action.type === 'rename' ? 'name' : undefined;
    if (fieldKey) setErrors((current) => (fieldKey in current ? withoutKey(current, fieldKey) : current));
  }, []);

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    const request = toRequest(draft);
    const checked = PortfolioInputSchema.safeParse(request);
    if (!checked.success) {
      const details = checked.error.issues.map((issue) => ({ path: issue.path.map(String).join('.'), message: issue.message }));
      setErrors(toFieldErrors(details, draft.rows));
      return;
    }
    setErrors({});
    save.mutate(request, {
      onSuccess: onDone,
      onError: (error) => setErrors(serverErrors(error, draft.rows)),
    });
  };

  return (
    <form onSubmit={onSubmit} className="editor" aria-label="Edit portfolio">
      <label>
        Name{' '}
        <input
          value={draft.name}
          onChange={(event) => edit({ type: 'rename', name: event.target.value })}
          aria-invalid={errors.name ? true : undefined}
          disabled={save.isPending}
        />
      </label>
      {errors.name && <FieldError message={errors.name} />}

      <table>
        <thead>
          <tr>
            <th scope="col">Asset</th>
            <th scope="col">Amount</th>
            <th scope="col">
              <span className="visually-hidden">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {draft.rows.map((row) => (
            <EditableRow
              key={row.key}
              row={row}
              assetError={errors[`${row.key}.asset`]}
              amountError={errors[`${row.key}.amount`]}
              onEdit={edit}
              disabled={save.isPending}
            />
          ))}
        </tbody>
      </table>
      {draft.rows.length === 0 && <p>No holdings. Add one, or save an empty portfolio.</p>}

      <p>
        <button
          type="button"
          onClick={() => edit({ type: 'addRow' })}
          disabled={save.isPending || draft.rows.length >= ASSETS.length}
        >
          Add holding
        </button>{' '}
        <button type="submit" disabled={!dirty || save.isPending}>
          {save.isPending ? 'Saving…' : 'Save'}
        </button>{' '}
        <button type="button" onClick={onDone} disabled={save.isPending}>
          Cancel
        </button>
      </p>
      {errors.form && <p role="alert" className="banner banner-error">{errors.form}</p>}
    </form>
  );
}

type RowProps = {
  row: DraftRow;
  assetError: string | undefined;
  amountError: string | undefined;
  onEdit: (action: DraftAction) => void;
  disabled: boolean;
};

// Props are the row object, two strings and stable callbacks, so editing one row re-renders only that row.
const EditableRow = memo(function EditableRow({ row, assetError, amountError, onEdit, disabled }: RowProps) {
  return (
    <tr>
      <td>
        <select
          aria-label="Asset"
          value={row.asset}
          onChange={(event) => onEdit({ type: 'editRow', key: row.key, field: 'asset', value: event.target.value })}
          aria-invalid={assetError ? true : undefined}
          disabled={disabled}
        >
          <optgroup label="Crypto">
            {CRYPTO_ASSETS.map((asset) => (
              <option key={asset}>{asset}</option>
            ))}
          </optgroup>
          <optgroup label="Fiat">
            {FIAT_ASSETS.map((asset) => (
              <option key={asset}>{asset}</option>
            ))}
          </optgroup>
        </select>
        {assetError && <FieldError message={assetError} />}
      </td>
      <td>
        <input
          aria-label={`${row.asset} amount`}
          inputMode="decimal"
          value={row.amount}
          onChange={(event) => onEdit({ type: 'editRow', key: row.key, field: 'amount', value: event.target.value })}
          aria-invalid={amountError ? true : undefined}
          disabled={disabled}
        />
        {amountError && <FieldError message={amountError} />}
      </td>
      <td>
        <button
          type="button"
          onClick={() => onEdit({ type: 'removeRow', key: row.key })}
          aria-label={`Remove ${row.asset}`}
          disabled={disabled}
        >
          Remove
        </button>
      </td>
    </tr>
  );
});

function FieldError({ message }: { message: string }) {
  return <span className="field-error">{message}</span>;
}

function withoutKey(errors: FieldErrors, key: string): FieldErrors {
  const { [key]: _removed, ...rest } = errors;
  return rest;
}

function serverErrors(error: Error, rows: DraftRow[]): FieldErrors {
  if (error instanceof ApiRequestError) {
    const details = (error.body as Partial<ApiError> | undefined)?.error?.details;
    if (error.status === 400 && details?.length) return toFieldErrors(details, rows);
    return { form: `Could not save: ${error.message}` };
  }
  return { form: 'Could not save: the API could not be reached. Your changes are still here.' };
}
