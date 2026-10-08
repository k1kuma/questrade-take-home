import { useState } from 'react';
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
      <p>
        <Link to="/">← All portfolios</Link>
      </p>
      <PortfolioHeading portfolioId={id} />
      {/* key: another portfolio starts with fresh component state, e.g. no leftover countdown or open editor. */}
      <EditorSection key={`editor-${id}`} portfolioId={id} />
      <ValuationPanel key={id} portfolioId={id} />
      <HistorySection key={`history-${id}`} portfolioId={id} />
    </>
  );
}

function PortfolioHeading({ portfolioId }: { portfolioId: string }) {
  const { data } = usePortfolio(portfolioId);
  return <h1>{data?.name ?? 'Portfolio'}</h1>;
}

// Owns the open/closed flag, so toggling the editor doesn't re-render the value panel.
function EditorSection({ portfolioId }: { portfolioId: string }) {
  const { data: portfolio } = usePortfolio(portfolioId);
  const [editing, setEditing] = useState(false);
  if (!portfolio) return null;
  if (!editing) {
    return (
      <p>
        <button onClick={() => setEditing(true)}>Edit portfolio</button>
      </p>
    );
  }
  return <HoldingsEditor portfolio={portfolio} onDone={() => setEditing(false)} />;
}
