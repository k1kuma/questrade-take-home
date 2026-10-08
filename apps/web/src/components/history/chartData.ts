import type { HistoryPoint } from '@portfolio/contracts';

export type ChartPoint = { at: Date; time: number; total: number; degraded: boolean };

// Number() is display-only; totals were computed server-side in decimals.
export function toChartPoints(points: HistoryPoint[]): ChartPoint[] {
  return points.map((point) => {
    const at = new Date(point.at);
    return { at, time: at.getTime(), total: Number(point.totalCad), degraded: point.status === 'degraded' };
  });
}

/**
 * The point in effect at `time` on a step chart: the last one at or before it (binary search, O(log n)).
 * Not the nearest point: a later snapshot hadn't happened yet at `time`.
 */
export function pointAtOrBefore(points: ChartPoint[], time: number): ChartPoint | undefined {
  let low = 0;
  let high = points.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (points[mid]!.time <= time) low = mid + 1;
    else high = mid;
  }
  return points[low - 1];
}

export function valueExtent(points: ChartPoint[]): [number, number] {
  let min = Infinity;
  let max = -Infinity;
  for (const point of points) {
    if (point.total < min) min = point.total;
    if (point.total > max) max = point.total;
  }
  // A flat line still needs a visible band.
  const pad = max === min ? Math.max(1, Math.abs(max) * 0.01) : (max - min) * 0.05;
  return [min - pad, max + pad];
}
