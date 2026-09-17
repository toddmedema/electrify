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
  /** Omit to take the stroke from CSS, e.g. the --spark-stroke token */
  color?: string;
  width?: number;
  height?: number;
  ariaLabel: string;
  /**
   * A fixed [min, max] to scale against. Without one each series stretches between its own
   * extremes, which is right for a lone trend but makes every line in a list look equally dramatic.
   */
  domain?: [number, number];
  /** Shade the area between the line and the bottom of the domain */
  fill?: boolean;
  /** A faint rule along the bottom of the domain */
  baseline?: boolean;
  /** Dashed, for a line that is a ceiling rather than a measurement */
  dash?: boolean;
  /** A hollow dot on the lowest value */
  lowMarker?: boolean;
  /** Let CSS resize the line; strokes keep their width as the shape stretches */
  stretch?: boolean;
}

const STROKE_WIDTH = 1.5;
const MARKER_RADIUS = 2.5;

export default function Sparkline(props: Props): React.JSX.Element | null {
  const {
    values,
    color,
    ariaLabel,
    domain,
    fill,
    baseline,
    dash,
    lowMarker,
    stretch,
  } = props;
  const strokeEffect = stretch ? "non-scaling-stroke" : undefined;
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
  if (domain) {
    [min, max] = domain;
  }
  // A flat series has no range to scale against; draw it down the middle rather than dividing by
  // zero, which is what a price that hasn't moved actually looks like
  const span = max - min || 1;
  // Inset by the stroke (or the marker, which is wider) so the first and last points aren't
  // clipped in half by the viewBox
  const inset = lowMarker ? MARKER_RADIUS + STROKE_WIDTH / 2 : STROKE_WIDTH / 2;
  const usable = height - inset * 2;
  const coordinates = values.map((v, i) => {
    const clamped = domain ? Math.min(max, Math.max(min, v)) : v;
    return [
      (i / (values.length - 1)) * width,
      inset + (1 - (clamped - min) / span) * usable,
    ];
  });
  const points = coordinates
    .map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`)
    .join(" ");
  const bottom = (height - inset).toFixed(1);
  const lowIndex = values.reduce(
    (low, value, i) => (value < values[low] ? i : low),
    0,
  );

  return (
    <svg
      className="sparkline"
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio={stretch ? "none" : undefined}
      role="img"
      aria-label={ariaLabel}
    >
      {baseline && (
        <line
          className="sparklineBaseline"
          x1={0}
          x2={width}
          y1={bottom}
          y2={bottom}
          strokeWidth={1}
          vectorEffect={strokeEffect}
        />
      )}
      {fill && !dash && (
        <polygon
          className="sparklineFill"
          points={`0,${bottom} ${points} ${width},${bottom}`}
          stroke="none"
        />
      )}
      <polyline
        className="sparklineLine"
        points={points}
        fill="none"
        stroke={color}
        strokeWidth={STROKE_WIDTH}
        strokeDasharray={dash ? "4 3" : undefined}
        vectorEffect={strokeEffect}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      {lowMarker && !dash && (
        <circle
          className="sparklineMarker"
          cx={coordinates[lowIndex][0].toFixed(1)}
          cy={coordinates[lowIndex][1].toFixed(1)}
          r={MARKER_RADIUS}
          stroke={color}
          strokeWidth={STROKE_WIDTH}
          vectorEffect={strokeEffect}
        />
      )}
    </svg>
  );
}
