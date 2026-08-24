import uPlot from "uplot";
import { chartTheme, withAlpha } from "../../Theme";

/**
 * Shared pieces for the game's uPlot charts: axis styling that matches what the charts looked
 * like on Victory, and the handful of decorations Victory drew as extra series (blackout bands,
 * the current-time marker, in-plot legends and titles) which on a canvas are cheaper to paint
 * directly than to model as data.
 *
 * Victory drew into a 350-wide viewBox and let the browser scale it to the pane, so every
 * length in these charts -- heights, padding, fonts, legend positions -- is still quoted in
 * that space and multiplied by `scale` here. A pane therefore gets exactly the chart it used
 * to, at whatever width it happens to be.
 */

export const DESIGN_WIDTH = 350;

export const CHART_FONT_FAMILY = `Roboto, "Helvetica Neue", Helvetica, sans-serif`;
export const TICK_LABEL_FILL = chartTheme.tickLabels.fill;

// VictoryTheme.material's colours for the parts of an axis that aren't the baseline
const GRID_STROKE = "#ECEFF1";
const TICK_STROKE = "#90A4AE";
// Victory drew legend text in its material theme's near-black rather than the axes' grey
const LEGEND_TEXT = "#252525";

/** A font string at the chart's current scale. */
export function chartFont(scale: number, sizePx = 12): string {
  return `${(sizePx * scale).toFixed(1)}px ${CHART_FONT_FAMILY}`;
}

export interface LegendItem {
  name: string;
  fill: string;
}

interface AxisOptions {
  /** Which tick values to draw; omitted lets uPlot choose */
  splits?: uPlot.Axis.Splits;
  values: uPlot.Axis.Values;
  /** Space reserved for the axis, in design units */
  size?: number;
  label?: string;
  /** Only the charts that showed Victory's default grid ask for one */
  grid?: boolean;
}

/**
 * Round tick values across a domain, aiming for about `target` intervals -- d3's algorithm,
 * which is what Victory's axes used.
 *
 * uPlot's own tick picker asks a different question ("what is the densest round step that still
 * leaves N pixels between labels?"), and its ladder includes 2.5, so it would answer a
 * 400-950MW axis with 200MW steps where Victory answered 100MW, and label a 250MW step "0.3GW".
 */
export function niceSplits(min: number, max: number, target = 5): number[] {
  const raw = (max - min) / target;
  if (!(raw > 0)) {
    return [min];
  }
  const magnitude = Math.pow(10, Math.floor(Math.log10(raw)));
  const normalized = raw / magnitude;
  const step =
    (normalized < 1.5 ? 1 : normalized < 3 ? 2 : normalized < 7 ? 5 : 10) *
    magnitude;
  const splits = [];
  for (let v = Math.ceil(min / step) * step; v <= max; v += step) {
    splits.push(v);
  }
  return splits;
}

function axisCommon(scale: number, o: AxisOptions) {
  return {
    stroke: TICK_LABEL_FILL,
    font: chartFont(scale),
    grid: o.grid
      ? {
          show: true,
          stroke: GRID_STROKE,
          width: 1,
          dash: [10 * scale, 5 * scale],
        }
      : { show: false },
    ticks: { show: true, stroke: TICK_STROKE, width: 1, size: 5 * scale },
    border: { show: true, stroke: chartTheme.axis.stroke, width: 1 },
    label: o.label,
    labelFont: chartFont(scale),
    labelSize: o.label ? 16 * scale : undefined,
    splits: o.splits,
    values: o.values,
  };
}

/** The x axis every chart shares: black baseline, faded labels, no grid. */
export function xAxis(scale: number, o: AxisOptions): uPlot.Axis {
  return {
    ...axisCommon(scale, o),
    scale: "x",
    size: (o.size ?? 25) * scale,
    gap: 2 * scale,
  };
}

/** The y axis every chart shares. Wider than x because the labels sit beside it. */
export function yAxis(scale: number, o: AxisOptions): uPlot.Axis {
  return {
    ...axisCommon(scale, o),
    scale: "y",
    side: 3,
    size: (o.size ?? 55) * scale,
    gap: 4 * scale,
    splits: o.splits ?? ((_u, _i, min, max) => niceSplits(min, max)),
  };
}

/**
 * Both supply/demand charts describe blackouts as an edge list -- pairs of points at 0 and at
 * the top of the domain -- because that is what Victory needed to draw them as an area. As a
 * band on a canvas they are just spans.
 */
export function spansFromEdges(
  edges: Array<{ minute: number; value: number }>,
): Array<[number, number]> {
  const spans: Array<[number, number]> = [];
  let start: number | null = null;
  for (const edge of edges) {
    if (edge.value > 0 && start === null) {
      start = edge.minute;
    } else if (edge.value === 0 && start !== null) {
      spans.push([start, edge.minute]);
      start = null;
    }
  }
  if (start !== null && edges.length > 0) {
    spans.push([start, edges[edges.length - 1].minute]);
  }
  return spans;
}

function clipToPlot(u: uPlot) {
  u.ctx.beginPath();
  u.ctx.rect(u.bbox.left, u.bbox.top, u.bbox.width, u.bbox.height);
  u.ctx.clip();
}

/** Shaded vertical bands, used for the stretches of the day that browned out. */
export function bandsPlugin(
  getSpans: () => Array<[number, number]>,
  color: string,
  opacity: number,
): uPlot.Plugin {
  return {
    hooks: {
      draw: (u: uPlot) => {
        const spans = getSpans();
        if (spans.length === 0) {
          return;
        }
        u.ctx.save();
        clipToPlot(u);
        u.ctx.fillStyle = withAlpha(color, opacity);
        for (const [from, to] of spans) {
          const x0 = u.valToPos(from, "x", true);
          const x1 = u.valToPos(to, "x", true);
          u.ctx.fillRect(x0, u.bbox.top, Math.max(1, x1 - x0), u.bbox.height);
        }
        u.ctx.restore();
      },
    },
  };
}

/** The "you are here" line dividing recorded history from the forecast. */
export function verticalLinePlugin(
  getX: () => number | null,
  stroke: string,
  opacity = 1,
): uPlot.Plugin {
  return {
    hooks: {
      draw: (u: uPlot) => {
        const at = getX();
        if (at == null) {
          return;
        }
        u.ctx.save();
        clipToPlot(u);
        u.ctx.globalAlpha = opacity;
        u.ctx.strokeStyle = stroke;
        u.ctx.lineWidth = 1;
        u.ctx.beginPath();
        const x = Math.round(u.valToPos(at, "x", true)) + 0.5;
        u.ctx.moveTo(x, u.bbox.top);
        u.ctx.lineTo(x, u.bbox.top + u.bbox.height);
        u.ctx.stroke();
        u.ctx.restore();
      },
    },
  };
}

/**
 * A legend inside the plot, where Victory's was. Position is in design units, so it lands in
 * the same place it used to at any pane width.
 */
export function legendPlugin(
  getItems: () => LegendItem[],
  designX: number,
  designY: number,
): uPlot.Plugin {
  return {
    hooks: {
      draw: (u: uPlot) => {
        const items = getItems();
        if (items.length === 0) {
          return;
        }
        const scale = u.width / DESIGN_WIDTH;
        const x = designX * scale;
        let y = designY * scale;
        const radius = 3.5 * scale;
        const lineHeight = 16 * scale;
        u.ctx.save();
        u.ctx.font = chartFont(scale);
        // The axes leave their own alignment on the context, so say what this wants
        u.ctx.textAlign = "left";
        u.ctx.textBaseline = "middle";
        for (const item of items) {
          u.ctx.fillStyle = item.fill;
          u.ctx.beginPath();
          u.ctx.arc(x, y, radius, 0, Math.PI * 2);
          u.ctx.fill();
          u.ctx.fillStyle = LEGEND_TEXT;
          u.ctx.fillText(item.name, x + radius + 5 * scale, y);
          y += lineHeight;
        }
        u.ctx.restore();
      },
    },
  };
}

/** A caption over the plot, which the finance charts carry instead of a legend. */
export function titlePlugin(
  getTitle: () => string,
  designX: number,
  designY: number,
): uPlot.Plugin {
  return {
    hooks: {
      draw: (u: uPlot) => {
        const title = getTitle();
        if (!title) {
          return;
        }
        const scale = u.width / DESIGN_WIDTH;
        u.ctx.save();
        u.ctx.font = chartFont(scale, 14);
        u.ctx.fillStyle = chartTheme.axis.stroke;
        u.ctx.textAlign = "center";
        u.ctx.textBaseline = "middle";
        u.ctx.fillText(title, designX * scale, designY * scale);
        u.ctx.restore();
      },
    },
  };
}

/**
 * Victory reserved a few pixels of headroom above and below the data (`domainPadding`), which
 * keeps a series that touches its own maximum from being drawn along the frame. As a fraction
 * of the plot heights these charts use, that is about 4%.
 */
export function padRange(
  min: number,
  max: number,
  pad = 0.04,
): [number, number] {
  if (max === min) {
    // A flat series still needs a domain with width, or every point lands on one row
    const nudge = Math.abs(max) * pad || 1;
    return [min - nudge, max + nudge];
  }
  const margin = (max - min) * pad;
  return [min - margin, max + margin];
}

/**
 * Evenly spaced ticks across a domain, snapped to whole steps of `unit`, spaced so at most
 * `maxTicks` land in the span. The month axes use it with a month's worth of minutes; the
 * finance charts use it with 1, because their x is already a month index.
 */
export function stepTicks(
  min: number,
  max: number,
  unit: number,
  maxTicks = 6,
): number[] {
  const spanned = (max - min) / unit;
  const step =
    ([1, 2, 3, 4, 6, 12, 24, 60, 120] as number[]).find(
      (s) => spanned / s <= maxTicks,
    ) || Math.ceil(spanned / maxTicks);
  const stepUnits = step * unit;
  const ticks = [];
  for (
    let v = Math.ceil(min / stepUnits) * stepUnits;
    v <= max;
    v += stepUnits
  ) {
    ticks.push(v);
  }
  return ticks;
}

/** SVG's comma-separated dash patterns, in the number array a canvas wants. */
export function dashArray(pattern?: string): number[] | undefined {
  return pattern ? pattern.split(",").map(Number) : undefined;
}

/** Smoothed line, standing in for Victory's "natural" and "bundle" interpolations. */
export const SPLINE = uPlot.paths.spline!();
