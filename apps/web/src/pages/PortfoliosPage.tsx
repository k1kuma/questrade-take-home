import { Link, useNavigate } from 'react-router';
import { useCreatePortfolio, usePortfolios, type NewHolding } from '../api/hooks';
import { formatDateTime } from '../format';

const EXAMPLE_HOLDINGS: NewHolding[] = [
  { asset: 'BTC', amount: 0.5 },
  { asset: 'ETH', amount: 10 },
  { asset: 'USD', amount: 2500 },
  { asset: 'EUR', amount: 1000 },
];

// The API's default page size; past this the list would need pagination.
const PAGE_SIZE = 50;

export function PortfoliosPage() {
  const portfolios = usePortfolios();
  const create = useCreatePortfolio();
  const navigate = useNavigate();
  const list = portfolios.data?.portfolios ?? [];

  return (
    <>
      <h1>Portfolios</h1>
      <p>
        <button
          onClick={() =>
            create.mutate(EXAMPLE_HOLDINGS, { onSuccess: (portfolio) => navigate(`/portfolios/${portfolio.id}`) })
          }
          disabled={create.isPending}
        >
          {create.isPending ? 'Creating…' : 'New example portfolio'}
        </button>
      </p>
      {create.error && <p role="alert">Could not create a portfolio: {create.error.message}</p>}

      {portfolios.isPending && <p role="status">Loading portfolios…</p>}
      {portfolios.error && (
        <p role="alert" className="banner banner-error">
          Could not load portfolios: {portfolios.error.message}{' '}
          <button onClick={() => void portfolios.refetch()}>Retry</button>
        </p>
      )}
      {portfolios.isSuccess && list.length === 0 && <p>No portfolios yet. Create one to get started.</p>}
      {list.length > 0 && (
        <table>
          <thead>
            <tr>
              <th scope="col">Name</th>
              <th scope="col">No. of holdings</th>
              <th scope="col">Last updated</th>
            </tr>
          </thead>
          <tbody>
            {list.map((portfolio) => (
              <tr key={portfolio.id}>
                <td>
                  <Link to={`/portfolios/${portfolio.id}`}>{portfolio.name}</Link>
                </td>
                <td>{portfolio.assets.length}</td>
                <td>{formatDateTime(portfolio.updatedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {list.length === PAGE_SIZE && <p className="meta">Showing the {PAGE_SIZE} most recently updated portfolios.</p>}
    </>
  );
}
