import { useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ParentSize } from '@visx/responsive';
import { maxPointsForWidth, queryKeys, useHistory, useValuation, type HistoryRange } from '../../api/hooks';
import { formatCad, formatDateTime } from '../../format';
import { toChartPoints } from './chartData';
import { HistoryChart } from './HistoryChart';

const RANGES: { value: HistoryRange; label: string }[] = [
  { value: '24h', label: '24h' },
  { value: '7d', label: '7d' },
  { value: '30d', label: '30d' },
  { value: 'all', label: 'All' },
];
const CHART_HEIGHT = 260;

export function HistorySection({ portfolioId }: { portfolioId: string }) {
  const [range, setRange] = useState<HistoryRange>('7d');
  useRefreshHistoryOnNewValuation(portfolioId);

  return (
    <section aria-label="Valuation history">
      <h2>History</h2>
      <p>
        {RANGES.map(({ value, label }) => (
          <button key={value} onClick={() => setRange(value)} aria-pressed={range === value}>
            {label}
          </button>
        ))}
      </p>
      {/* ParentSize debounces resizes; width feeds maxPoints, so the request matches what can be drawn. */}
      <ParentSize debounceTime={200}>
        {({ width }) => <HistoryChartLoader portfolioId={portfolioId} range={range} width={width} />}
      </ParentSize>
    </section>
  );
}

/** Each valuation may record a snapshot, so a newer valuation means the history is out of date. */
function useRefreshHistoryOnNewValuation(portfolioId: string) {
  const queryClient = useQueryClient();
  const { dataUpdatedAt } = useValuation(portfolioId);
  useEffect(() => {
    if (dataUpdatedAt) void queryClient.invalidateQueries({ queryKey: queryKeys.historyAll(portfolioId) });
  }, [dataUpdatedAt, portfolioId, queryClient]);
}

type LoaderProps = { portfolioId: string; range: HistoryRange; width: number };

function HistoryChartLoader({ portfolioId, range, width }: LoaderProps) {
  const history = useHistory(portfolioId, range, maxPointsForWidth(width), width > 0);
  const points = useMemo(() => toChartPoints(history.data?.points ?? []), [history.data]);
  const bounds = useMemo(
    () => history.data && { from: new Date(history.data.from), to: new Date(history.data.to) },
    [history.data],
  );

  if (history.isPending) return <p role="status">Loading history…</p>;
  if (history.error) {
    return (
      <p role="alert" className="banner banner-error">
        Could not load history: {history.error.message}{' '}
        <button onClick={() => void history.refetch()}>Retry</button>
      </p>
    );
  }
  if (points.length === 0 || !bounds) return <p>No history in this range yet. Each valuation adds a point.</p>;

  const latest = points.at(-1)!;
  const totals = points.map((point) => point.total);
  return (
    <>
      <HistoryChart points={points} from={bounds.from} to={bounds.to} width={width} height={CHART_HEIGHT} />
      <p className="meta">
        {points.length} point{points.length === 1 ? '' : 's'}
        {history.data.downsampled && ' (downsampled: each is the latest snapshot in its time slot)'}. Latest{' '}
        {formatCad(String(latest.total))} at {formatDateTime(latest.at.toISOString())}; low{' '}
        {formatCad(String(Math.min(...totals)))}, high {formatCad(String(Math.max(...totals)))}.
        {points.some((point) => point.degraded) && ' Orange markers are valuations made with stale prices.'}
        {history.isPlaceholderData && ' Updating…'}
      </p>
    </>
  );
}
