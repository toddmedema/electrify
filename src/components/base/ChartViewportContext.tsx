import * as React from "react";

export type ChartViewportRange = [number, number];

export interface ChartViewportValue {
  bounds: ChartViewportRange;
  range: ChartViewportRange;
  minSpan: number;
  onRangeChange: (range: ChartViewportRange, announce?: boolean) => void;
  onReset: (announce?: boolean) => void;
}

export const ChartViewportContext =
  React.createContext<ChartViewportValue | null>(null);

const EPSILON = 1e-7;

export function rangesEqual(
  left: ChartViewportRange,
  right: ChartViewportRange,
): boolean {
  return (
    Math.abs(left[0] - right[0]) <= EPSILON &&
    Math.abs(left[1] - right[1]) <= EPSILON
  );
}

/** Keep a finite viewport inside its data horizon without changing its requested span. */
export function clampChartViewport(
  bounds: ChartViewportRange,
  candidate: ChartViewportRange,
  minSpan: number,
): ChartViewportRange {
  const [boundMin, boundMax] = bounds;
  const fullSpan = boundMax - boundMin;
  if (
    !Number.isFinite(boundMin) ||
    !Number.isFinite(boundMax) ||
    fullSpan <= 0
  ) {
    return bounds;
  }
  if (!Number.isFinite(candidate[0]) || !Number.isFinite(candidate[1])) {
    return bounds;
  }
  const span = Math.min(
    fullSpan,
    Math.max(Math.min(minSpan, fullSpan), candidate[1] - candidate[0]),
  );
  if (span >= fullSpan - EPSILON) {
    return bounds;
  }
  let min = candidate[0];
  let max = min + span;
  if (min < boundMin) {
    min = boundMin;
    max = min + span;
  }
  if (max > boundMax) {
    max = boundMax;
    min = max - span;
  }
  return [min, max];
}

/** factor below one zooms in; factor above one zooms out around the supplied anchor. */
export function zoomChartViewport(
  bounds: ChartViewportRange,
  range: ChartViewportRange,
  minSpan: number,
  factor: number,
  anchor = 0.5,
): ChartViewportRange {
  if (!Number.isFinite(factor) || factor <= 0) {
    return clampChartViewport(bounds, range, minSpan);
  }
  const current = clampChartViewport(bounds, range, minSpan);
  const clampedAnchor = Math.min(1, Math.max(0, anchor));
  const span = Math.max(
    Math.min(minSpan, bounds[1] - bounds[0]),
    (current[1] - current[0]) * factor,
  );
  const anchorValue = current[0] + (current[1] - current[0]) * clampedAnchor;
  return clampChartViewport(
    bounds,
    [
      anchorValue - span * clampedAnchor,
      anchorValue + span * (1 - clampedAnchor),
    ],
    minSpan,
  );
}

export function panChartViewport(
  bounds: ChartViewportRange,
  range: ChartViewportRange,
  minSpan: number,
  delta: number,
): ChartViewportRange {
  if (!Number.isFinite(delta)) {
    return clampChartViewport(bounds, range, minSpan);
  }
  return clampChartViewport(
    bounds,
    [range[0] + delta, range[1] + delta],
    minSpan,
  );
}

export function eventChartViewport(
  bounds: ChartViewportRange,
  start: number,
  end: number | undefined,
  minSpan: number,
): ChartViewportRange {
  const eventEnd = Number.isFinite(end) ? (end as number) : start;
  const duration = Math.max(0, eventEnd - start);
  const naturalSpan = duration
    ? Math.max(minSpan, duration * 1.2)
    : Math.max(minSpan, minSpan * 2);
  const span = Math.min(naturalSpan, minSpan * 6);
  if (naturalSpan > span) {
    return clampChartViewport(
      bounds,
      [start - span * 0.1, start + span * 0.9],
      minSpan,
    );
  }
  const center = start + duration / 2;
  return clampChartViewport(
    bounds,
    [center - span / 2, center + span / 2],
    minSpan,
  );
}
