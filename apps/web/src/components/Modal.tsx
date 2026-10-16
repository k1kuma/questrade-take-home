import { useEffect, useId, useLayoutEffect, useRef, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react';

type Props = {
  title: string;
  /** Esc, a backdrop click or the close button; the owner decides whether to actually close. */
  onRequestClose: () => void;
  children: ReactNode;
};

/**
 * A modal on the native <dialog>: showModal() gives the focus trap, inert background and top layer,
 * so no dialog library is needed. Open while mounted; the owner unmounts it to close.
 */
export function Modal({ title, onRequestClose, children }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const pressStartedOnBackdrop = useRef(false);
  const titleId = useId();
  const requestClose = useRef(onRequestClose);
  useEffect(() => {
    requestClose.current = onRequestClose;
  });

  // Layout effect: close() must run before React detaches the dialog, so the browser restores focus and the top layer.
  useLayoutEffect(() => {
    const dialog = dialogRef.current!;
    dialog.showModal();
    dialog.querySelector<HTMLElement>('[data-autofocus]')?.focus();
    return () => dialog.close();
  }, []);

  useEffect(() => {
    const dialog = dialogRef.current!;
    // Other platform close requests (e.g. Android back) arrive as "cancel"; the owner decides instead.
    const onCancel = (event: Event) => {
      event.preventDefault();
      requestClose.current();
    };
    dialog.addEventListener('cancel', onCancel);
    return () => dialog.removeEventListener('cancel', onCancel);
  }, []);

  // Esc is handled here rather than via "cancel": browsers may skip "cancel" (Chrome does on a repeated Esc
  // without user activation) and close outright, which would drop unsaved edits.
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    requestClose.current();
  };

  // A click whose press and release both land on the dialog box itself (not its content) is a backdrop click.
  // Checking the press too means selecting text inside and releasing outside doesn't close it.
  const onMouseDown = (event: MouseEvent) => {
    pressStartedOnBackdrop.current = event.target === event.currentTarget;
  };
  const onClick = (event: MouseEvent) => {
    if (pressStartedOnBackdrop.current && event.target === event.currentTarget) requestClose.current();
    pressStartedOnBackdrop.current = false;
  };

  return (
    <dialog
      ref={dialogRef}
      className="modal"
      aria-labelledby={titleId}
      onKeyDown={onKeyDown}
      onMouseDown={onMouseDown}
      onClick={onClick}
    >
      <div className="modal-header">
        <h2 id={titleId}>{title}</h2>
        <button type="button" className="modal-close" aria-label="Close" onClick={() => requestClose.current()}>
          <span aria-hidden="true">×</span>
        </button>
      </div>
      {children}
    </dialog>
  );
}
