import * as React from "react";

/**
 * A trend line small enough to sit inside a list row.
 *
 * Deliberately not a uPlot chart: the fleet list draws one of these per expanded facility, and
 * uPlot's per-instance canvas, resize observer and cursor plugins are all overhead for a shape
 * with no axes, no ticks and nothing to hover. An inline SVG polyline costs a string.
 */

export interface Props {
  values: number[];
  color: string;
  width?: number;
  height?: number;
  ariaLabel: string;
}

const STROKE_WIDTH = 1.5;

export default function Sparkline(props: Props): React.JSX.Element | null {
  const { values, color, ariaLabel } = props;
  const width = props.width || 72;
  const height = props.height || 20;

  // One point is a dot rather than a trend, and nothing to say about it
  if (values.length < 2) {
    return null;
  }

  let min = values[0];
  let max = values[0];
  values.forEach((v) => {
    min = Math.min(min, v);
    max = Math.max(max, v);
  });
  // A flat series has no range to scale against; draw it down the middle rather than dividing by
  // zero, which is what a price that hasn't moved actually looks like
  const span = max - min || 1;
  // Inset by the stroke so the first and last points aren't clipped in half by the viewBox
  const top = STROKE_WIDTH / 2;
  const usable = height - STROKE_WIDTH;
  const points = values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * width;
      const y = top + (1 - (v - min) / span) * usable;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  return (
    <svg
      className="sparkline"
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={ariaLabel}
    >
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth={STROKE_WIDTH}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}
