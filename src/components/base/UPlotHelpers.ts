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
// How far a tick pokes out of the axis, and how far the label then sits from it, in design units
const TICK_SIZE = 5;
const LABEL_GAP = 4;
// A gutter outside the widest label. uPlot leaves no padding on a side that carries an axis, so
// an axis sized to the exact width of its labels draws them flush against the canvas edge, and
// anything that measures a hair narrower than it paints - a font that finished loading after the
// axis was sized, a glyph with a negative left bearing, plain antialiasing - clips the first
// character off every label.
const LABEL_EDGE_PAD = 4;
// Victory drew legend text in its material theme's near-black rather than the axes' grey
const LEGEND_TEXT = "#252525";

/**
 * A font string at the chart's current scale.
 *
 * Whole pixels on purpose: uPlot rescales axis fonts for the device by rewriting the `<n>px` in
 * this string, and its pattern only matches digits, so a fractional size would leave it
 * rewriting the ".9" of "43.9px" and handing the canvas a font it can't parse.
 */
export function chartFont(scale: number, sizePx = 12): string {
  return `${Math.max(1, Math.round(sizePx * scale))}px ${CHART_FONT_FAMILY}`;
}

/**
 * Design units to canvas pixels, for the plugins below that paint on the canvas themselves.
 *
 * uPlot works in CSS pixels but never scales the context, multiplying every coordinate it draws
 * by the device ratio instead -- so `u.bbox` and anything else reaching the canvas is in device
 * pixels, and a plugin that positions itself in CSS pixels lands short of where it means to on
 * any display that isn't at 100%.
 */
function canvasScale(u: uPlot): number {
  return (u.width / DESIGN_WIDTH) * uPlot.pxRatio;
}

// A context of our own to ask how wide a label will be, since axis sizes have to be settled
// before there is a plot to measure with
let measureCtx: CanvasRenderingContext2D | null | undefined;

/** Width of `text` in CSS pixels at `font`, whose size is `sizePx`. */
function textWidth(text: string, font: string, sizePx: number): number {
  if (measureCtx === undefined) {
    measureCtx = document.createElement("canvas").getContext("2d");
  }
  if (!measureCtx) {
    // No canvas to measure with (jsdom); a half-em per character is close enough for digits
    return text.length * sizePx * 0.55;
  }
  measureCtx.font = font;
  return measureCtx.measureText(text).width;
}

export interface LegendItem {
  name: string;
  fill: string;
}

interface AxisOptions {
  /** Which tick values to draw; omitted lets uPlot choose */
  splits?: uPlot.Axis.Splits;
  values: uPlot.Axis.Values;
  /** Space reserved for the axis, in design units; omitted fits it to the labels */
  size?: number;
  label?: string;
  /** Only the charts that showed Victory's default grid ask for one */
  grid?: boolean;
  /** Which y scale the axis reads, for the charts that carry two */
  scale?: string;
  /** uPlot's sides: 1 is right, 3 is left */
  side?: 1 | 3;
  /** Ticks, labels and axis label in one colour, to tie an axis to its series */
  stroke?: string;
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
    stroke: o.stroke ?? TICK_LABEL_FILL,
    font: chartFont(scale),
    grid: o.grid
      ? {
          show: true,
          stroke: GRID_STROKE,
          width: 1,
          dash: [10 * scale, 5 * scale],
        }
      : { show: false },
    ticks: {
      show: true,
      stroke: TICK_STROKE,
      width: 1,
      size: TICK_SIZE * scale,
    },
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

/**
 * The y axis every chart shares.
 *
 * Its width follows the labels rather than a fixed reserve: uPlot draws them right up against
 * the plot, so anything left over opens as a gap on the far side -- between "Per MMBTU" and
 * "$12" on the fuel chart, which is what gave the reserve away.
 */
export function yAxis(scale: number, o: AxisOptions): uPlot.Axis {
  const font = chartFont(scale);
  const fontSize = 12 * scale;
  const fixed = (TICK_SIZE + LABEL_GAP + LABEL_EDGE_PAD) * scale;
  return {
    ...axisCommon(scale, o),
    scale: o.scale ?? "y",
    side: o.side ?? 3,
    size:
      o.size != null
        ? o.size * scale
        : (_u, values) => {
            let widest = 0;
            for (const value of values || []) {
              if (value != null) {
                widest = Math.max(
                  widest,
                  textWidth(String(value), font, fontSize),
                );
              }
            }
            return Math.ceil(fixed + widest);
          },
    gap: LABEL_GAP * scale,
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
 * A legend inside the plot, where Victory's was.
 *
 * `inset` is how far in from the plot's own edge the block sits, in design units, and `align`
 * says which edge that is: "left" pins the dots to the left edge, "right" pins the end of the
 * longest label to the right one, so a legend sits flush whatever its labels happen to be.
 *
 * Measured off `u.bbox` rather than the canvas, for the same reason titlePlugin is: the y axis
 * is only as wide as its labels, so the plot no longer starts or ends where a fixed offset from
 * the canvas edge would put it. `designY` stays a canvas offset, which is what the title uses
 * too -- it is the top padding these charts share, not anything the axes move.
 */
export function legendPlugin(
  getItems: () => LegendItem[],
  inset: number,
  designY: number,
  align: "left" | "right" = "left",
): uPlot.Plugin {
  return {
    hooks: {
      draw: (u: uPlot) => {
        const items = getItems();
        if (items.length === 0) {
          return;
        }
        const scale = canvasScale(u);
        const radius = 3.5 * scale;
        const gap = 5 * scale;
        const lineHeight = 16 * scale;
        u.ctx.save();
        u.ctx.font = chartFont(scale);
        // The axes leave their own alignment on the context, so say what this wants
        u.ctx.textAlign = "left";
        u.ctx.textBaseline = "middle";
        // The dots share a column, so the block is only as wide as its longest label
        let x;
        if (align === "right") {
          const widest = Math.max(
            ...items.map((item) => u.ctx.measureText(item.name).width),
          );
          x =
            u.bbox.left +
            u.bbox.width -
            inset * scale -
            (radius + gap + widest);
        } else {
          x = u.bbox.left + inset * scale;
        }
        let y = designY * scale;
        for (const item of items) {
          u.ctx.fillStyle = item.fill;
          u.ctx.beginPath();
          u.ctx.arc(x, y, radius, 0, Math.PI * 2);
          u.ctx.fill();
          u.ctx.fillStyle = LEGEND_TEXT;
          u.ctx.fillText(item.name, x + radius + gap, y);
          y += lineHeight;
        }
        u.ctx.restore();
      },
    },
  };
}

/**
 * A caption over the plot, which the finance charts carry instead of a legend. Centred on the
 * plot rather than on a fixed offset, since the y axis is only as wide as its labels and so a
 * chart of percentages and a chart of dollars no longer start in the same place.
 */
export function titlePlugin(
  getTitle: () => string,
  designY: number,
): uPlot.Plugin {
  return {
    hooks: {
      draw: (u: uPlot) => {
        const title = getTitle();
        if (!title) {
          return;
        }
        const scale = canvasScale(u);
        u.ctx.save();
        u.ctx.font = chartFont(scale, 14);
        u.ctx.fillStyle = chartTheme.axis.stroke;
        u.ctx.textAlign = "center";
        u.ctx.textBaseline = "middle";
        u.ctx.fillText(title, u.bbox.left + u.bbox.width / 2, designY * scale);
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
