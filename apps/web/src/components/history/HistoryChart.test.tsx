import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { maxPointsForWidth } from '../../api/hooks';
import { toChartPoints } from './chartData';
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

describe('chart sizing', () => {
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
});
