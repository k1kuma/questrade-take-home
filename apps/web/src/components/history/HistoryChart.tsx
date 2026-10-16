import { useMemo, type MouseEvent, type TouchEvent } from 'react';
import { AxisBottom, AxisLeft } from '@visx/axis';
import { curveLinear, curveStepAfter } from '@visx/curve';
import { localPoint } from '@visx/event';
import { Group } from '@visx/group';
import { scaleLinear, scaleTime } from '@visx/scale';
import { AreaClosed, Bar, Line, LinePath } from '@visx/shape';
import { TooltipWithBounds, useTooltip } from '@visx/tooltip';
import { formatCad, formatDateTime } from '../../format';
import { nearestPoint, pointAtOrBefore, valueExtent, type ChartPoint } from './chartData';

const MARGIN = { top: 12, right: 16, bottom: 32, left: 64 };
const Y_TICKS = 5;

/**
 * Compact labels ($97K) with just enough significant digits that neighbouring ticks differ: a portfolio
 * moving between $96,250 and $97,000 needs $96.25K, not five labels all reading $97K.
 */
function compactTickFormatter(ticks: number[]) {
  const step = ticks.length > 1 ? Math.abs(ticks[1]! - ticks[0]!) : 0;
  const largest = Math.max(...ticks.map(Math.abs), 1);
  const digits = step > 0 ? Math.floor(Math.log10(largest)) - Math.floor(Math.log10(step)) + 2 : 2;
  const format = new Intl.NumberFormat('en-CA', {
    style: 'currency',
    currency: 'CAD',
    notation: 'compact',
    maximumSignificantDigits: Math.min(21, Math.max(2, digits)),
  });
  return (value: number) => format.format(value);
}
// Mirrors the tokens in index.css; SVG presentation attributes can't reliably resolve CSS variables.
const COLORS = {
  line: '#0079e3',
  grid: '#e6e6e6',
  crosshair: '#999',
  degradedFill: '#f8cf12',
  degradedStroke: '#b58f00',
};
const AREA_GRADIENT_ID = 'history-area-gradient';
// Dots mark the real snapshots only while they're at least this many pixels apart on average.
const MIN_PX_PER_DOT = 6;

/**
 * Snapshots exist only when someone opened the portfolio and the value had changed, so the value between two of
 * them is unknown. 'line' joins them directly, the usual reading of a price chart. 'step' holds each value until the
 * next snapshot, which suits close points but overstates a long gap.
 */
export type ChartType = 'line' | 'step';

type Props = { points: ChartPoint[]; from: Date; to: Date; width: number; height: number; type?: ChartType };

/**
 * Presentational and sized by props (jsdom can't measure layout, so tests pass a width).
 * Everything that depends only on data and size is memoized; a mouse move re-renders the tooltip only.
 */
export function HistoryChart({ points, from, to, width, height, type = 'line' }: Props) {
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

  const formatTick = useMemo(() => compactTickFormatter(yScale.ticks(Y_TICKS)), [yScale]);
  const curve = type === 'step' ? curveStepAfter : curveLinear;
  const showDots = points.length === 1 || points.length <= innerWidth / MIN_PX_PER_DOT;

  // Same element reference across tooltip updates, so React skips re-rendering the path and axes.
  const staticLayer = useMemo(
    () => (
      <>
        {yScale.ticks(Y_TICKS).map((tick) => (
          <line key={tick} x1={0} x2={innerWidth} y1={yScale(tick)} y2={yScale(tick)} stroke={COLORS.grid} />
        ))}
        <AxisLeft
          scale={yScale}
          numTicks={Y_TICKS}
          hideAxisLine
          hideTicks
          tickFormat={(value) => formatTick(Number(value))}
        />
        <AxisBottom top={innerHeight} scale={xScale} numTicks={Math.max(2, Math.floor(innerWidth / 120))} />
        <AreaClosed
          data={points}
          x={(point) => xScale(point.at)}
          y={(point) => yScale(point.total)}
          yScale={yScale}
          curve={curve}
          fill={`url(#${AREA_GRADIENT_ID})`}
        />
        <LinePath
          data={points}
          x={(point) => xScale(point.at)}
          y={(point) => yScale(point.total)}
          curve={curve}
          stroke={COLORS.line}
          strokeWidth={2}
        />
        {/* Degraded snapshots get their own marker below, so they're skipped here. */}
        {showDots &&
          points
            .filter((point) => !point.degraded)
            .map((point) => (
              <circle
                key={point.time}
                cx={xScale(point.at)}
                cy={yScale(point.total)}
                r={points.length === 1 ? 4 : 3}
                fill={points.length === 1 ? COLORS.line : '#fff'}
                stroke={COLORS.line}
                strokeWidth={1.5}
              />
            ))}
        {points
          .filter((point) => point.degraded)
          .map((point) => (
            <circle
              key={point.time}
              data-testid="degraded-marker"
              cx={xScale(point.at)}
              cy={yScale(point.total)}
              r={4}
              fill={COLORS.degradedFill}
              stroke={COLORS.degradedStroke}
            >
              <title>Valued with stale prices</title>
            </circle>
          ))}
      </>
    ),
    [points, xScale, yScale, formatTick, innerWidth, innerHeight, curve, showDots],
  );

  const onPointerMove = (event: MouseEvent<SVGRectElement> | TouchEvent<SVGRectElement>) => {
    const coords = localPoint(event);
    if (!coords) return;
    const time = xScale.invert(coords.x - MARGIN.left).getTime();
    const point = type === 'step' ? pointAtOrBefore(points, time) : nearestPoint(points, time);
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
    <div className="chart">
      <svg width={width} height={height} aria-hidden="true">
        <defs>
          <linearGradient id={AREA_GRADIENT_ID} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor={COLORS.line} stopOpacity={0.18} />
            <stop offset="100%" stopColor={COLORS.line} stopOpacity={0} />
          </linearGradient>
        </defs>
        <Group left={MARGIN.left} top={MARGIN.top}>
          {staticLayer}
          {tooltipOpen && tooltipData && (
            <Line
              from={{ x: xScale(tooltipData.at), y: 0 }}
              to={{ x: xScale(tooltipData.at), y: innerHeight }}
              stroke={COLORS.crosshair}
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
        <TooltipWithBounds top={tooltipTop} left={tooltipLeft} className="chart-tooltip">
          <div>{formatDateTime(tooltipData.at.toISOString())}</div>
          <strong>{formatCad(String(tooltipData.total))}</strong>
          {tooltipData.degraded && <div>Valued with stale prices</div>}
        </TooltipWithBounds>
      )}
    </div>
  );
}
