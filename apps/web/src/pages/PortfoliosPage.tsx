import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { usePortfolios } from '../api/hooks';
import { NewPortfolioDialog } from '../components/editor/NewPortfolioDialog';
import { formatDateTime } from '../format';

// The API's default page size; past this the list would need pagination.
const PAGE_SIZE = 50;

export function PortfoliosPage() {
  const portfolios = usePortfolios();
  const [creating, setCreating] = useState(false);
  const newButton = useRef<HTMLButtonElement>(null);
  const wasCreating = useRef(false);
  const list = portfolios.data?.portfolios ?? [];

  // Cancelling returns focus to the button that opened the dialog; creating navigates away instead.
  useEffect(() => {
    if (wasCreating.current && !creating) newButton.current?.focus();
    wasCreating.current = creating;
  }, [creating]);

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Portfolios</h1>
          <p className="meta">Crypto and fiat holdings, valued live in Canadian dollars.</p>
        </div>
        <button ref={newButton} className="btn-primary" onClick={() => setCreating(true)}>
          New portfolio
        </button>
      </div>
      {creating && <NewPortfolioDialog onClose={() => setCreating(false)} />}

      <section className="card" aria-label="All portfolios">
        {portfolios.isPending && (
          <p role="status" className="loading">
            Loading portfolios…
          </p>
        )}
        {portfolios.error && (
          <p role="alert" className="banner banner-error">
            Could not load portfolios: {portfolios.error.message}{' '}
            <button className="btn-link" onClick={() => void portfolios.refetch()}>
              Retry
            </button>
          </p>
        )}
        {portfolios.isSuccess && list.length === 0 && (
          <p className="empty">No portfolios yet. Create one to get started.</p>
        )}
        {list.length > 0 && (
          <div className="table-scroll">
            <table className="portfolio-list">
              <thead>
                <tr>
                  <th scope="col">Name</th>
                  <th scope="col" className="num">
                    No. of holdings
                  </th>
                  <th scope="col" className="num">
                    Last updated
                  </th>
                </tr>
              </thead>
              <tbody>
                {list.map((portfolio) => (
                  <tr key={portfolio.id}>
                    <td className="cell-name">
                      <Link to={`/portfolios/${portfolio.id}`}>{portfolio.name}</Link>
                    </td>
                    <td className="num cell-count" data-label="Holdings">
                      {portfolio.assets.length}
                    </td>
                    <td className="num meta cell-updated" data-label="Updated">
                      {formatDateTime(portfolio.updatedAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {list.length === PAGE_SIZE && (
          <p className="meta">Showing the {PAGE_SIZE} most recently updated portfolios.</p>
        )}
      </section>
    </>
  );
}
