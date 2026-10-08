import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  Portfolio,
  PortfolioList,
  PortfolioRequest,
  PortfolioValuation,
  ValuationHistory,
} from '@portfolio/contracts';
import { ApiRequestError, apiFetch } from './client';

export type HistoryRange = '24h' | '7d' | '30d' | 'all';

export const queryKeys = {
  portfolios: ['portfolios'] as const,
  portfolio: (id: string) => ['portfolios', id] as const,
  valuation: (id: string) => ['portfolios', id, 'value'] as const,
  historyAll: (id: string) => ['portfolios', id, 'history'] as const,
  history: (id: string, range: HistoryRange, maxPoints: number) =>
    ['portfolios', id, 'history', { range, maxPoints }] as const,
};

// 503 has its own Retry-After countdown and 4xx won't change on retry; only blips are retried here.
function isTransient(error: Error): boolean {
  if (!(error instanceof ApiRequestError)) return true;
  return error.status >= 500 && error.status !== 503;
}

export function usePortfolios() {
  return useQuery({
    queryKey: queryKeys.portfolios,
    queryFn: ({ signal }) => apiFetch<PortfolioList>('/portfolios', { signal }),
  });
}

export function usePortfolio(portfolioId: string) {
  return useQuery({
    queryKey: queryKeys.portfolio(portfolioId),
    queryFn: ({ signal }) => apiFetch<Portfolio>(`/portfolios/${encodeURIComponent(portfolioId)}`, { signal }),
    retry: (failureCount, error) => isTransient(error) && failureCount < 2,
  });
}

export function useValuation(portfolioId: string) {
  return useQuery({
    queryKey: queryKeys.valuation(portfolioId),
    queryFn: ({ signal }) =>
      apiFetch<PortfolioValuation>(`/portfolios/${encodeURIComponent(portfolioId)}/value`, { signal }),
    staleTime: 30_000,
    // Matches the server's 60s crypto window; polling faster would only re-read its cache.
    // Paused while errored: the error notice owns retrying then.
    refetchInterval: (query) => (query.state.status === 'error' ? false : 60_000),
    retry: (failureCount, error) => isTransient(error) && failureCount < 2,
  });
}

const HOUR = 3_600_000;
const RANGE_MS: Record<Exclude<HistoryRange, 'all'>, number> = { '24h': 24 * HOUR, '7d': 7 * 24 * HOUR, '30d': 30 * 24 * HOUR };

/** About one point per pixel, in steps of 250 so small resizes reuse the cached response. */
export function maxPointsForWidth(width: number): number {
  return Math.min(2000, Math.max(250, Math.ceil(width / 250) * 250));
}

export function useHistory(portfolioId: string, range: HistoryRange, maxPoints: number, enabled: boolean) {
  return useQuery({
    // `from` is computed at fetch time; putting a timestamp in the key would make a new key every render.
    queryKey: queryKeys.history(portfolioId, range, maxPoints),
    queryFn: ({ signal }) => {
      const params = new URLSearchParams({ maxPoints: String(maxPoints) });
      if (range !== 'all') params.set('from', new Date(Date.now() - RANGE_MS[range]).toISOString());
      return apiFetch<ValuationHistory>(`/portfolios/${encodeURIComponent(portfolioId)}/history?${params}`, { signal });
    },
    enabled,
    // Keep the current chart on screen while another range or width loads, instead of flashing a spinner.
    placeholderData: keepPreviousData,
    retry: (failureCount, error) => isTransient(error) && failureCount < 2,
  });
}

export type NewHolding = { asset: string; amount: string | number };

export function useCreatePortfolio() {
  const queryClient = useQueryClient();
  return useMutation({
    // A bare holdings array: the API names it "Portfolio N".
    mutationFn: (holdings: NewHolding[]) =>
      apiFetch<Portfolio>('/portfolios', { method: 'POST', body: JSON.stringify(holdings) }),
    // Returning nothing: TanStack would otherwise wait for the list refetch before the caller's onSuccess.
    onSuccess: (portfolio) => {
      queryClient.setQueryData(queryKeys.portfolio(portfolio.id), portfolio);
      void queryClient.invalidateQueries({ queryKey: queryKeys.portfolios, exact: true });
    },
  });
}

export function useUpdatePortfolio(portfolioId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (request: PortfolioRequest) =>
      apiFetch<Portfolio>(`/portfolios/${encodeURIComponent(portfolioId)}`, {
        method: 'PUT',
        body: JSON.stringify(request),
      }),
    onSuccess: (portfolio) => {
      queryClient.setQueryData(queryKeys.portfolio(portfolioId), portfolio);
      // The cached value was computed for the old holdings: drop it rather than show it while refetching.
      void queryClient.resetQueries({ queryKey: queryKeys.valuation(portfolioId), exact: true });
      void queryClient.invalidateQueries({ queryKey: queryKeys.portfolios, exact: true });
    },
  });
}
