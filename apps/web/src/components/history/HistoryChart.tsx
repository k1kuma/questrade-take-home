import { useMemo, type MouseEvent, type TouchEvent } from 'react';
import { AxisBottom, AxisLeft } from '@visx/axis';
import { curveStepAfter } from '@visx/curve';
import { localPoint } from '@visx/event';
import { Group } from '@visx/group';
import { scaleLinear, scaleTime } from '@visx/scale';
import { Bar, Line, LinePath } from '@visx/shape';
import { TooltipWithBounds, useTooltip } from '@visx/tooltip';
import { formatCad, formatDateTime } from '../../format';
import { pointAtOrBefore, valueExtent, type ChartPoint } from './chartData';

const MARGIN = { top: 12, right: 16, bottom: 32, left: 64 };
const compactCad = new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD', notation: 'compact' });

type Props = { points: ChartPoint[]; from: Date; to: Date; width: number; height: number };

/**
 * Presentational and sized by props (jsdom can't measure layout, so tests pass a width).
 * Everything that depends only on data and size is memoized; a mouse move re-renders the tooltip only.
 */
export function HistoryChart({ points, from, to, width, height }: Props) {
  const innerWidth = Math.max(0, width - MARGIN.left - MARGIN.right);
  const innerHeight = Math.max(0, height - MARGIN.top - MARGIN.bottom);
  const { tooltipData, tooltipLeft, tooltipTop, tooltipOpen, showTooltip, hideTooltip } = useTooltip<ChartPoint>();

  const xScale = useMemo(() => {
    // One snapshot under "All" makes from === to; widen so the point lands mid-chart.
    const pad = to.getTime() - from.getTime() < 60_000 ? 30 * 60_000 : 0;
    return scaleTime({
      domain: [new Date(from.getTime() - pad), new Date(to.getTime() + pad)],
      range: [0, innerWidth],
    });
  }, [from, to, innerWidth]);
  const yScale = useMemo(
    () => scaleLinear({ domain: valueExtent(points), range: [innerHeight, 0], nice: true }),
    [points, innerHeight],
  );

  // Same element reference across tooltip updates, so React skips re-rendering the path and axes.
  const staticLayer = useMemo(
    () => (
      <>
        <AxisLeft scale={yScale} numTicks={5} tickFormat={(value) => compactCad.format(Number(value))} />
        <AxisBottom top={innerHeight} scale={xScale} numTicks={Math.max(2, Math.floor(innerWidth / 120))} />
        {/* Step, not smooth: a snapshot is recorded only when the value changes, so it was flat in between. */}
        <LinePath
          data={points}
          x={(point) => xScale(point.at)}
          y={(point) => yScale(point.total)}
          curve={curveStepAfter}
          stroke="#1f6feb"
          strokeWidth={2}
        />
        {points.length === 1 && <circle cx={xScale(points[0]!.at)} cy={yScale(points[0]!.total)} r={4} fill="#1f6feb" />}
        {points
          .filter((point) => point.degraded)
          .map((point) => (
            <circle
              key={point.time}
              data-testid="degraded-marker"
              cx={xScale(point.at)}
              cy={yScale(point.total)}
              r={4}
              fill="#e0a800"
              stroke="#b26a00"
            >
              <title>Valued with stale prices</title>
            </circle>
          ))}
      </>
    ),
    [points, xScale, yScale, innerWidth, innerHeight],
  );

  const onPointerMove = (event: MouseEvent<SVGRectElement> | TouchEvent<SVGRectElement>) => {
    const coords = localPoint(event);
    if (!coords) return;
    const point = pointAtOrBefore(points, xScale.invert(coords.x - MARGIN.left).getTime());
    if (!point) {
      hideTooltip();
      return;
    }
    showTooltip({
      tooltipData: point,
      tooltipLeft: xScale(point.at) + MARGIN.left,
      tooltipTop: yScale(point.total) + MARGIN.top,
    });
  };

  return (
    <div style={{ position: 'relative' }}>
      <svg width={width} height={height} aria-hidden="true">
        <Group left={MARGIN.left} top={MARGIN.top}>
          {staticLayer}
          {tooltipOpen && tooltipData && (
            <Line
              from={{ x: xScale(tooltipData.at), y: 0 }}
              to={{ x: xScale(tooltipData.at), y: innerHeight }}
              stroke="#999"
              strokeDasharray="3,3"
              pointerEvents="none"
            />
          )}
          <Bar
            width={innerWidth}
            height={innerHeight}
            fill="transparent"
            onMouseMove={onPointerMove}
            onTouchMove={onPointerMove}
            onMouseLeave={hideTooltip}
          />
        </Group>
      </svg>
      {tooltipOpen && tooltipData && (
        <TooltipWithBounds top={tooltipTop} left={tooltipLeft}>
          <div>{formatDateTime(tooltipData.at.toISOString())}</div>
          <strong>{formatCad(String(tooltipData.total))}</strong>
          {tooltipData.degraded && <div>Valued with stale prices</div>}
        </TooltipWithBounds>
      )}
    </div>
  );
}
