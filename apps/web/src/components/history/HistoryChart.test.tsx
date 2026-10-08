import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { maxPointsForWidth } from '../../api/hooks';
import { pointAtOrBefore, toChartPoints, valueExtent } from './chartData';
import { HistoryChart } from './HistoryChart';

const points = toChartPoints([
  { at: '2026-10-05T10:00:00.000Z', totalCad: '100.00', status: 'complete' },
  { at: '2026-10-05T11:00:00.000Z', totalCad: '120.00', status: 'degraded' },
  { at: '2026-10-05T12:00:00.000Z', totalCad: '110.00', status: 'complete' },
  { at: '2026-10-05T13:00:00.000Z', totalCad: '90.00', status: 'degraded' },
]);
const from = new Date('2026-10-05T09:00:00.000Z');
const to = new Date('2026-10-05T14:00:00.000Z');

afterEach(cleanup);

describe('pointAtOrBefore', () => {
  it('returns the snapshot in effect at a time on a step chart, not the nearest one', () => {
    const justBeforeNoon = Date.parse('2026-10-05T11:59:00.000Z');

    expect(pointAtOrBefore(points, justBeforeNoon)?.total).toBe(120);
    expect(pointAtOrBefore(points, Date.parse('2026-10-05T12:00:00.000Z'))?.total).toBe(110);
    expect(pointAtOrBefore(points, from.getTime())).toBeUndefined();
    expect(pointAtOrBefore(points, to.getTime())?.total).toBe(90);
  });
});

describe('chart helpers', () => {
  it('pads the value range, including for a flat line', () => {
    expect(valueExtent(points)).toEqual([88.5, 121.5]);
    expect(valueExtent(points.slice(0, 1))).toEqual([99, 101]);
  });

  it('requests about one point per pixel, in steps of 250, between 250 and 2000', () => {
    expect([0, 300, 640, 1000, 5000].map(maxPointsForWidth)).toEqual([250, 500, 750, 1000, 2000]);
  });
});

describe('HistoryChart', () => {
  it('draws one step-line path and marks only the degraded snapshots', () => {
    const { container } = render(<HistoryChart points={points} from={from} to={to} width={600} height={260} />);

    const line = container.querySelector('path.visx-linepath');
    expect(line?.getAttribute('d')).toBeTruthy();
    expect(container.querySelectorAll('[data-testid="degraded-marker"]')).toHaveLength(2);
  });

  it('draws a single snapshot as a dot', () => {
    const single = points.slice(0, 1);
    const { container } = render(
      <HistoryChart points={single} from={single[0]!.at} to={single[0]!.at} width={600} height={260} />,
    );

    expect(container.querySelectorAll('circle')).toHaveLength(1);
  });
});
