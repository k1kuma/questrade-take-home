import { useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useParentSize } from '@visx/responsive';
import { maxPointsForWidth, queryKeys, useHistory, useValuation, type HistoryRange } from '../../api/hooks';
import { formatCad, formatDateTime } from '../../format';
import { toChartPoints } from './chartData';
import { HistoryChart, type ChartType } from './HistoryChart';

const RANGES: { value: HistoryRange; label: string }[] = [
  { value: '24h', label: '24h' },
  { value: '7d', label: '7d' },
  { value: '30d', label: '30d' },
  { value: 'all', label: 'All' },
];
const CHART_TYPES: { value: ChartType; label: string }[] = [
  { value: 'line', label: 'Line' },
  { value: 'step', label: 'Step' },
];
const CHART_HEIGHT = 260;

export function HistorySection({ portfolioId }: { portfolioId: string }) {
  const [range, setRange] = useState<HistoryRange>('7d');
  const [chartType, setChartType] = useState<ChartType>('line');
  // Width only: it feeds maxPoints, so the request matches what can be drawn. The hook measures an in-flow
  // div, so the card grows with the chart (ParentSize's absolutely positioned child would collapse it).
  const { parentRef, width } = useParentSize({ debounceTime: 200, ignoreDimensions: ['height', 'top', 'left'] });
  useRefreshHistoryOnNewValuation(portfolioId);

  return (
    <section aria-label="Valuation history" className="card">
      <div className="card-header">
        <h2>History</h2>
        <div className="chart-controls">
          <div className="segmented" role="group" aria-label="Chart type">
            {CHART_TYPES.map(({ value, label }) => (
              <button key={value} onClick={() => setChartType(value)} aria-pressed={chartType === value}>
                {label}
              </button>
            ))}
          </div>
          <div className="segmented" role="group" aria-label="Time range">
            {RANGES.map(({ value, label }) => (
              <button key={value} onClick={() => setRange(value)} aria-pressed={range === value}>
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>
      <div ref={parentRef}>
        <HistoryChartLoader portfolioId={portfolioId} range={range} width={width} chartType={chartType} />
      </div>
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

type LoaderProps = { portfolioId: string; range: HistoryRange; width: number; chartType: ChartType };

function HistoryChartLoader({ portfolioId, range, width, chartType }: LoaderProps) {
  const history = useHistory(portfolioId, range, maxPointsForWidth(width), width > 0);
  const points = useMemo(() => toChartPoints(history.data?.points ?? []), [history.data]);
  // The x-axis starts at the first snapshot when the data starts after the range does, so a portfolio with a few
  // hours of history isn't squeezed into a sliver of a 7-day axis. The caption says where the data starts.
  const bounds = useMemo(() => {
    if (!history.data) return undefined;
    const rangeFrom = new Date(history.data.from);
    const first = points[0]?.at;
    const startsLate = first !== undefined && first > rangeFrom;
    return { from: startsLate ? first : rangeFrom, to: new Date(history.data.to), startsLate };
  }, [history.data, points]);

  if (history.isPending) {
    return (
      <p role="status" className="loading chart-loading" style={{ height: CHART_HEIGHT }}>
        Loading history…
      </p>
    );
  }
  if (history.error) {
    return (
      <p role="alert" className="banner banner-error">
        Could not load history: {history.error.message}{' '}
        <button className="btn-link" onClick={() => void history.refetch()}>
          Retry
        </button>
      </p>
    );
  }
  if (points.length === 0 || !bounds) {
    return <p className="empty">No history in this range yet. Each valuation adds a point.</p>;
  }

  const latest = points.at(-1)!;
  const totals = points.map((point) => point.total);
  return (
    <>
      <HistoryChart
        points={points}
        from={bounds.from}
        to={bounds.to}
        width={width}
        height={CHART_HEIGHT}
        type={chartType}
      />
      <p className="meta">
        {points.length} point{points.length === 1 ? '' : 's'}
        {history.data.downsampled && ' (downsampled: each is the latest snapshot in its time slot)'}. Latest{' '}
        {formatCad(String(latest.total))} at {formatDateTime(latest.at.toISOString())}; low{' '}
        {formatCad(String(Math.min(...totals)))}, high {formatCad(String(Math.max(...totals)))}.
        {bounds.startsLate &&
          range !== 'all' &&
          ` The chart starts at the first snapshot (${formatDateTime(points[0]!.at.toISOString())}).`}
        {' '}A point is recorded when the value is computed (while a portfolio is open) and has changed.
        {points.some((point) => point.degraded) && ' Yellow markers are valuations made with stale prices.'}
        {history.isPlaceholderData && ' Updating…'}
      </p>
    </>
  );
}
