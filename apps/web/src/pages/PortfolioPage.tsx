import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router';
import { usePortfolio } from '../api/hooks';
import { HoldingsEditor } from '../components/editor/HoldingsEditor';
import { HistorySection } from '../components/history/HistorySection';
import { ValuationPanel } from '../components/ValuationPanel';

export function PortfolioPage() {
  const { id } = useParams<{ id: string }>();
  if (!id) return null;

  return (
    <>
      {/* key: another portfolio starts with fresh component state, e.g. no leftover countdown or open editor. */}
      <PortfolioHeader key={`header-${id}`} portfolioId={id} />
      <ValuationPanel key={id} portfolioId={id} />
      <HistorySection key={`history-${id}`} portfolioId={id} />
    </>
  );
}

// Owns the editor's open/closed flag, so toggling the editor doesn't re-render the value panel.
function PortfolioHeader({ portfolioId }: { portfolioId: string }) {
  const { data: portfolio } = usePortfolio(portfolioId);
  const [editing, setEditing] = useState(false);
  const editButton = useRef<HTMLButtonElement>(null);
  const wasEditing = useRef(false);

  // Return focus to the button that opened the editor once the modal is gone (the page is inert while it's open).
  useEffect(() => {
    if (wasEditing.current && !editing) editButton.current?.focus();
    wasEditing.current = editing;
  }, [editing]);

  return (
    <>
      <div className="page-header">
        <div>
          <Link to="/" className="breadcrumb">
            ← All portfolios
          </Link>
          <h1>{portfolio?.name ?? 'Portfolio'}</h1>
        </div>
        {portfolio && (
          <button ref={editButton} className="btn-outline" onClick={() => setEditing(true)}>
            Edit portfolio
          </button>
        )}
      </div>
      {portfolio && editing && <HoldingsEditor portfolio={portfolio} onDone={() => setEditing(false)} />}
    </>
  );
}
