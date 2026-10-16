import { useNavigate } from 'react-router';
import { useCreatePortfolio } from '../../api/hooks';
import type { DraftSource } from './draft';
import { PortfolioForm } from './HoldingsEditor';

/** One crypto and one currency at 0, as a starting point; Create unlocks once an amount is above 0. */
const DEFAULTS: DraftSource = {
  name: '',
  holdings: [
    { asset: 'BTC', amount: '0' },
    { asset: 'USD', amount: '0' },
  ],
};

/** Creates a portfolio from the form, then opens its page. */
export function NewPortfolioDialog({ onClose }: { onClose: () => void }) {
  const create = useCreatePortfolio();
  const navigate = useNavigate();
  return (
    <PortfolioForm
      title="New portfolio"
      initial={DEFAULTS}
      submitLabel="Create portfolio"
      pendingLabel="Creating…"
      requirePositiveAmount
      optionalName
      isPending={create.isPending}
      onSubmit={(request, onError) =>
        create.mutate(request, { onSuccess: (portfolio) => navigate(`/portfolios/${portfolio.id}`), onError })
      }
      onClose={onClose}
    />
  );
}
