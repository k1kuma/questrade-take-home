import { memo, useCallback, useEffect, useId, useMemo, useReducer, useRef, useState, type FormEvent } from 'react';
import {
  ASSETS,
  CRYPTO_ASSETS,
  FIAT_ASSETS,
  HoldingsOnlyInputSchema,
  PortfolioInputSchema,
  type ApiError,
  type Portfolio,
  type PortfolioRequest,
} from '@portfolio/contracts';
import { ApiRequestError } from '../../api/client';
import { useUpdatePortfolio } from '../../api/hooks';
import { Modal } from '../Modal';
import {
  draftReducer,
  hasPositiveAmount,
  isDirty,
  toDraft,
  toFieldErrors,
  toRequest,
  withoutZeroAmounts,
  type DraftAction,
  type DraftRow,
  type DraftSource,
  type FieldErrors,
} from './draft';

type Props = { portfolio: Portfolio; onDone: () => void };

/** Edits a copy of the portfolio taken when editing starts; nothing is sent until Save. */
export function HoldingsEditor({ portfolio, onDone }: Props) {
  const save = useUpdatePortfolio(portfolio.id);
  return (
    <PortfolioForm
      title="Edit portfolio"
      initial={portfolio}
      submitLabel="Save"
      pendingLabel="Saving…"
      requireChanges
      isPending={save.isPending}
      onSubmit={(request, onError) => save.mutate(request, { onSuccess: onDone, onError })}
      onClose={onDone}
    />
  );
}

export type PortfolioFormProps = {
  title: string;
  initial: DraftSource;
  submitLabel: string;
  pendingLabel: string;
  /** Edit: Save stays disabled until something changes. */
  requireChanges?: boolean;
  /** Create: submit stays disabled until a holding has an amount above 0, and rows left at 0 are not sent. */
  requirePositiveAmount?: boolean;
  /** Create: a blank name is allowed, and the API names the portfolio "Portfolio N". */
  optionalName?: boolean;
  isPending: boolean;
  /** Called with a request that passed the shared schema; call onError if the server rejects it. */
  onSubmit: (request: PortfolioRequest, onError: (error: Error) => void) => void;
  onClose: () => void;
};

/**
 * The name-and-holdings form in a modal, shared by editing and creating.
 * The draft lives here, so typing re-renders only this form, never the value panel.
 */
export function PortfolioForm({
  title,
  initial,
  submitLabel,
  pendingLabel,
  requireChanges = false,
  requirePositiveAmount = false,
  optionalName = false,
  isPending,
  onSubmit: submit,
  onClose,
}: PortfolioFormProps) {
  const [draft, dispatch] = useReducer(draftReducer, initial, toDraft);
  const [errors, setErrors] = useState<FieldErrors>({});
  const dirty = useMemo(() => isDirty(draft, initial), [draft, initial]);
  const missingAmount = requirePositiveAmount && !hasPositiveAmount(draft.rows);
  const nameId = useId();
  const nameHintId = useId();
  const amountHintId = useId();
  const submitHintId = useId();
  const discardId = useId();
  const [confirmingDiscard, setConfirmingDiscard] = useState(false);
  const keepEditingButton = useRef<HTMLButtonElement>(null);
  const focusBeforeConfirm = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (confirmingDiscard) keepEditingButton.current?.focus();
  }, [confirmingDiscard]);

  // Cancel, Esc, the close button and backdrop clicks all land here, so unsaved edits are never dropped silently.
  const requestClose = () => {
    if (isPending) return;
    if (!dirty) {
      onClose();
      return;
    }
    if (!confirmingDiscard) focusBeforeConfirm.current = document.activeElement as HTMLElement | null;
    setConfirmingDiscard(true);
  };

  const keepEditing = () => {
    setConfirmingDiscard(false);
    // Back to where the user was (e.g. the amount they were typing), once the normal footer is back.
    requestAnimationFrame(() => {
      const previous = focusBeforeConfirm.current;
      if (previous?.isConnected) previous.focus();
    });
  };

  // Stable (dispatch and setErrors never change), so memoized rows don't re-render when another row changes.
  const edit = useCallback((action: DraftAction) => {
    dispatch(action);
    const fieldKey =
      action.type === 'editRow' ? `${action.key}.${action.field}` : action.type === 'rename' ? 'name' : undefined;
    if (fieldKey) setErrors((current) => (fieldKey in current ? withoutKey(current, fieldKey) : current));
  }, []);

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (missingAmount) return;
    // Error paths index into the submitted rows, so map them back with the same list.
    const submitted = requirePositiveAmount ? withoutZeroAmounts(draft) : draft;
    const request = toRequest(submitted);
    // Same paths either way ('holdings.1.amount'), so errors land on the same fields.
    const checked =
      optionalName && request.name.trim() === ''
        ? HoldingsOnlyInputSchema.safeParse({ holdings: request.holdings })
        : PortfolioInputSchema.safeParse(request);
    if (!checked.success) {
      const details = checked.error.issues.map((issue) => ({ path: issue.path.map(String).join('.'), message: issue.message }));
      setErrors(toFieldErrors(details, submitted.rows));
      return;
    }
    setErrors({});
    submit(request, (error) => setErrors(serverErrors(error, submitted.rows)));
  };

  return (
    <Modal title={title} onRequestClose={requestClose}>
      <form onSubmit={onSubmit} className="modal-form" aria-label={title}>
        <div className="modal-body">
          <div className="field">
            <label className="field-label" htmlFor={nameId}>
              Name
            </label>
            <input
              id={nameId}
              data-autofocus
              value={draft.name}
              onChange={(event) => edit({ type: 'rename', name: event.target.value })}
              aria-invalid={errors.name ? true : undefined}
              aria-describedby={optionalName ? nameHintId : undefined}
              placeholder={optionalName ? 'Portfolio N' : undefined}
              disabled={isPending}
            />
            {optionalName && (
              <span className="field-hint" id={nameHintId}>
                Optional. Left blank, it's named automatically.
              </span>
            )}
            {errors.name && <FieldError message={errors.name} />}
          </div>

          <table className="editor-table">
            <thead>
              <tr>
                <th scope="col">Asset</th>
                <th scope="col">Amount</th>
                <th scope="col" className="num">
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
                  amountHintId={amountHintId}
                  onEdit={edit}
                  disabled={isPending}
                />
              ))}
            </tbody>
          </table>
          {draft.rows.length === 0 && (
            <p className="empty">
              {requirePositiveAmount ? 'No holdings. Add one to create the portfolio.' : 'No holdings. Add one, or save an empty portfolio.'}
            </p>
          )}
          <p className="field-hint amount-hint" id={amountHintId}>
            Amounts are in each asset's own units, not CAD: 0.5 BTC is half a bitcoin, 2500 USD is 2,500 US dollars.
            They're converted to CAD when the portfolio is valued.
          </p>
          {missingAmount && (
            <p className="field-hint" id={submitHintId}>
              Enter an amount above 0 for at least one holding to create the portfolio.
            </p>
          )}

          <button
            type="button"
            className="btn-outline btn-add"
            onClick={() => edit({ type: 'addRow' })}
            disabled={isPending || draft.rows.length >= ASSETS.length}
          >
            Add holding
          </button>
          {errors.form && (
            <p role="alert" className="banner banner-error editor-error">
              {errors.form}
            </p>
          )}
        </div>

        {confirmingDiscard ? (
          // Distinct keys: if React reused the button nodes, a focused "Keep editing" would become the
          // focused Save (type=submit) button mid-keypress, and Enter would save the draft.
          <div key="confirm" className="modal-footer modal-footer-confirm" role="group" aria-labelledby={discardId}>
            <p className="modal-footer-message" id={discardId}>
              Discard your unsaved changes?
            </p>
            <button type="button" ref={keepEditingButton} onClick={keepEditing}>
              Keep editing
            </button>
            <button type="button" className="btn-danger" onClick={onClose}>
              Discard
            </button>
          </div>
        ) : (
          <div key="actions" className="modal-footer">
            <button type="button" onClick={requestClose} disabled={isPending}>
              Cancel
            </button>
            <button
              type="submit"
              className="btn-primary"
              disabled={(requireChanges && !dirty) || missingAmount || isPending}
              aria-describedby={missingAmount ? submitHintId : undefined}
            >
              {isPending ? pendingLabel : submitLabel}
            </button>
          </div>
        )}
      </form>
    </Modal>
  );
}

type RowProps = {
  row: DraftRow;
  assetError: string | undefined;
  amountError: string | undefined;
  amountHintId: string;
  onEdit: (action: DraftAction) => void;
  disabled: boolean;
};

// Props are the row object, strings and stable callbacks, so editing one row re-renders only that row.
const EditableRow = memo(function EditableRow({
  row,
  assetError,
  amountError,
  amountHintId,
  onEdit,
  disabled,
}: RowProps) {
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
        <div className="amount-input">
          <input
            aria-label={`${row.asset} amount`}
            aria-describedby={amountHintId}
            inputMode="decimal"
            value={row.amount}
            onChange={(event) => onEdit({ type: 'editRow', key: row.key, field: 'amount', value: event.target.value })}
            aria-invalid={amountError ? true : undefined}
            disabled={disabled}
          />
          {/* The unit, so "0.5" visibly means 0.5 BTC and not $0.50; the label already says it to screen readers. */}
          <span className="amount-unit" aria-hidden="true">
            {row.asset}
          </span>
        </div>
        {amountError && <FieldError message={amountError} />}
      </td>
      <td className="num">
        <button
          type="button"
          className="btn-link btn-destructive"
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
