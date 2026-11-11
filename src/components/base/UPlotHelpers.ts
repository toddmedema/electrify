import uPlot from "uplot";
import { chartPalette, INTERFACE_FONT_FAMILY, withAlpha } from "../../Theme";
import { getTextScale } from "../../TextSize";
import { ChartEventMarker } from "./ChartAnnotationsContext";
import {
  axisTicksAreYearly,
  formatMinuteAsMonthAxis,
  MINUTES_PER_MONTH,
} from "../../helpers/DateTime";

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

/**
 * How far past its design width a chart is allowed to be blown up.
 *
 * The 350-wide design space was drawn for a phone, and scaling it straight to the pane means a
 * chart in a 700px column gets 24px axis labels: "440MW" and "12 AM" set larger than any text
 * around them, for no more information than they carried at 12px. Past this the pane gets the
 * extra width as plot rather than as type -- which is also where the room for a fifth chart on
 * screen comes from, since heights are quoted in the same space.
 */
export const MAX_CHART_SCALE = 1.4;

/** Design units to CSS pixels for a chart of `width`. */
export function chartScale(width: number): number {
  return Math.min(width / DESIGN_WIDTH, MAX_CHART_SCALE) * getTextScale();
}

export const CHART_FONT_FAMILY = INTERFACE_FONT_FAMILY;

/**
 * The colour an axis labels itself in, read at the moment it is built.
 *
 * A function rather than a constant because the palette can change under a running game, and a
 * module-level constant would hold whichever one happened to be in force when the bundle loaded
 * -- see Theme.tsx, and the rebuild UPlotChart does when it hears the palette change.
 */
export function tickLabelFill(): string {
  return chartPalette().tickLabel;
}

// How far a tick pokes out of the axis, and how far the label then sits from it, in design units
const TICK_SIZE = 5;
const LABEL_GAP = 4;
// A gutter outside the widest label. uPlot leaves no padding on a side that carries an axis, so
// an axis sized to the exact width of its labels draws them flush against the canvas edge, and
// anything that measures a hair narrower than it paints - a font that finished loading after the
// axis was sized, a glyph with a negative left bearing, plain antialiasing - clips the first
// character off every label.
const LABEL_EDGE_PAD = 4;
/** What an axis carrying a `label` adds to its own size, in design units. */
export const AXIS_LABEL_SIZE = 16;

/**
 * The width of the one right axis a forecast chart carries -- water's reservoir scale, whose
 * labels are watt-hours. It includes the AXIS_LABEL_SIZE its "Reservoir" label spends, so the
 * axis itself gets the rest.
 */
export const FORECAST_AXIS_RIGHT = 48;

/**
 * The trailing room past the plot in CSS pixels, matching the chart title's 16px inset.
 * Keep this independent of chart scale so wide panes gain plot area rather than blank space.
 */
export const FORECAST_RIGHT_PAD = 16;

/** Tick labels: the app's small caption, whatever the chart's width. */
export const CHART_TICK_PX = 12;
/** Legends and annotations share caption-sized type. */
export const CHART_LABEL_PX = 12;

/**
 * A font string. Chart geometry scales with the pane, but chart text does not: a 700px pane
 * would otherwise set "440MW" larger than the body copy around it. `pxRatio` is 1 for the
 * axes (uPlot applies the device ratio itself) and uPlot.pxRatio for plugins that paint on the
 * canvas directly.
 *
 * Whole pixels on purpose: uPlot rescales axis fonts for the device by rewriting the `<n>px` in
 * this string, and its pattern only matches digits, so a fractional size would leave it
 * rewriting the ".9" of "43.9px" and handing the canvas a font it can't parse.
 */
export function chartFont(pxRatio = 1, sizePx = CHART_TICK_PX): string {
  return `${Math.max(1, Math.round(sizePx * getTextScale() * pxRatio))}px ${CHART_FONT_FAMILY}`;
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
  return chartScale(u.width) * uPlot.pxRatio;
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

/** Enlarge rendered options and measure the final font, without changing compact charts. */
export function expandedChartOptions(
  options: uPlot.Options,
  fontScale: number,
): uPlot.Options {
  const enlargeFont = (font: string | undefined) =>
    (font || chartFont()).replace(
      /(\d+)px/,
      (_match, size) => `${Math.round(Number(size) * fontScale)}px`,
    );
  const padding: uPlot.Padding = options.padding
    ? [...options.padding]
    : [null, null, null, null];
  const xAxisIndex =
    options.axes?.findIndex((axis) => axis.scale === "x") ?? -1;
  if (xAxisIndex >= 0 && !options.axes?.some((axis) => axis.side === 1)) {
    const axis = options.axes![xAxisIndex];
    const originalRight = padding[1];
    padding[1] = (plot, side, sides, cycle) => {
      const reserve =
        typeof originalRight === "function"
          ? originalRight(plot, side, sides, cycle)
          : (originalRight ?? 0);
      const range = plot.scales.x;
      const splits =
        typeof axis.splits === "function"
          ? axis.splits(plot, xAxisIndex, range.min ?? 0, range.max ?? 0, 0, 0)
          : (axis.splits ?? []);
      const labels =
        typeof axis.values === "function"
          ? axis.values(plot, splits, xAxisIndex, 0, 0)
          : [];
      const finalLabel = labels[labels.length - 1];
      if (finalLabel == null) return reserve;
      const font = enlargeFont(axis.font);
      // Endpoint dates are centered on the plot edge; enlarged labels need room beyond it.
      return Math.ceil(
        Math.max(
          reserve,
          textWidth(String(finalLabel), font, Number.parseFloat(font)) / 2 +
            4 * getTextScale(),
        ),
      );
    };
  }
  return {
    ...options,
    padding,
    axes: options.axes?.map((axis) => {
      const font = enlargeFont(axis.font);
      const originalSize = axis.size;
      const vertical = axis.side === 1 || axis.side === 3 || axis.scale === "y";
      return {
        ...axis,
        font,
        labelFont: enlargeFont(axis.labelFont),
        splits:
          vertical || !axis.splits
            ? axis.splits
            : (plot, axisIndex, min, max, increment, space) => {
                const splits =
                  typeof axis.splits === "function"
                    ? axis.splits(plot, axisIndex, min, max, increment, space)
                    : axis.splits!;
                if (splits.length < 3 || typeof axis.values !== "function")
                  return splits;
                const labels = axis.values(
                  plot,
                  splits,
                  axisIndex,
                  space,
                  increment,
                );
                const widths = labels.map((label) =>
                  label == null
                    ? 0
                    : textWidth(String(label), font, Number.parseFloat(font)),
                );
                const ratio = uPlot.pxRatio || 1;
                const plotWidth =
                  (plot.bbox?.width ?? plot.width * ratio) / ratio;
                const position = (index: number) =>
                  ((splits[index] - min) / Math.max(1, max - min)) * plotWidth;
                const fits = (left: number, right: number) =>
                  position(right) - position(left) >=
                  (widths[left] + widths[right]) / 2 + 12 * getTextScale();
                const last = splits.length - 1;
                const kept = [0];
                // Reserve the last date before accepting an interior label. Index rounding alone
                // can leave neighboring ticks too close at intermediate pane widths.
                for (let index = 1; index < last; index++) {
                  if (fits(kept[kept.length - 1], index) && fits(index, last))
                    kept.push(index);
                }
                if (fits(kept[kept.length - 1], last)) kept.push(last);
                return kept.map((index) => splits[index]);
              },
        labelSize: axis.label
          ? (axis.labelSize ?? 16) * fontScale
          : axis.labelSize,
        size: (plot, values, axisIndex, cycle) => {
          const natural =
            typeof originalSize === "function"
              ? originalSize(plot, values, axisIndex, cycle)
              : (originalSize ?? (vertical ? 50 : 25));
          if (!vertical) return natural * fontScale;
          // Includes fixed right axes: their old reserve may be narrower than the final label.
          const sizePx = Number.parseFloat(font);
          const widest = Math.max(
            0,
            ...(values || []).map((value) =>
              value == null ? 0 : textWidth(String(value), font, sizePx),
            ),
          );
          return Math.ceil(Math.max(natural, widest + 20 * getTextScale()));
        },
      };
    }),
    series: options.series.map((series, index) =>
      index === 0
        ? series
        : {
            ...series,
            // Filled areas and invisible boundaries should not acquire artificial outlines.
            width:
              series.width === 0 ? 0 : Math.max(2.5, (series.width ?? 1) * 1.5),
          },
    ),
  };
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
  /** x only: false keeps the baseline and ticks but drops the labels, for a shared axis */
  showLabels?: boolean;
}

/**
 * Round tick values across a domain, aiming for about `target` intervals -- d3's algorithm,
 * which is what Victory's axes used.
 *
 * uPlot's own tick picker asks a different question ("what is the densest round step that still
 * leaves N pixels between labels?"), and its ladder includes 2.5, so it would answer a
 * 400-950MW axis with 200MW steps where Victory answered 100MW, and label a 250MW step "0.3GW".
 */
export function niceSplits(min: number, max: number, target = 4): number[] {
  const raw = (max - min) / target;
  if (!(raw > 0)) {
    return [min === 0 ? 0 : min];
  }
  const magnitude = Math.pow(10, Math.floor(Math.log10(raw)));
  const normalized = raw / magnitude;
  const step =
    (normalized < 1.5 ? 1 : normalized < 3 ? 2 : normalized < 7 ? 5 : 10) *
    magnitude;
  const splits = [];
  for (let v = Math.ceil(min / step) * step; v <= max; v += step) {
    splits.push(v === 0 ? 0 : v);
  }
  return splits;
}

function axisCommon(scale: number, o: AxisOptions) {
  const palette = chartPalette();
  return {
    stroke: o.stroke ?? palette.tickLabel,
    font: chartFont(),
    grid: o.grid
      ? {
          show: true,
          stroke: palette.grid,
          width: 1,
          // The long Victory-era dash reads busy on a stack of charts. A quiet solid rule is
          // easier to scan and lets the series remain the only high-contrast strokes.
          dash: [],
        }
      : { show: false },
    ticks: {
      show: true,
      stroke: palette.tick,
      width: 1,
      size: TICK_SIZE * scale,
    },
    border: { show: true, stroke: palette.axis, width: 1 },
    label: o.label,
    labelFont: chartFont(1, CHART_LABEL_PX),
    labelSize: o.label ? AXIS_LABEL_SIZE * scale : undefined,
    splits: o.splits,
    values: o.values,
  };
}

/**
 * The x axis every chart shares: black baseline, faded labels, no grid.
 *
 * `showLabels: false` keeps the baseline and the tick marks but not the month names underneath,
 * which is what a chart stacked above another chart that carries them wants -- the ticks still
 * say where the months are, and the height the labels would have taken goes to the plot.
 */
export function xAxis(scale: number, o: AxisOptions): uPlot.Axis {
  const showLabels = o.showLabels !== false;
  return {
    ...axisCommon(scale, o),
    scale: "x",
    size: (o.size ?? (showLabels ? 25 : 8)) * scale,
    gap: 2 * scale,
    values: showLabels ? o.values : (_u, splits) => splits.map(() => ""),
  };
}

/** Shared month spacing and year-aware labels for forecast charts. Read live state on redraw. */
export function forecastMonthAxis(
  scale: number,
  getState: () => {
    domain: { x: [number, number] };
    startingYear: number;
    multiyear: boolean;
  },
  showLabels?: boolean,
): uPlot.Axis {
  return xAxis(scale, {
    showLabels,
    splits: () => {
      const [min, max] = getState().domain.x;
      return stepTicks(min, max, MINUTES_PER_MONTH);
    },
    values: (_u, splits) => {
      const state = getState();
      const yearOnly = axisTicksAreYearly(splits, MINUTES_PER_MONTH);
      return splits.map((minute) =>
        formatMinuteAsMonthAxis(
          minute,
          state.startingYear,
          state.multiyear,
          yearOnly,
        ),
      );
    },
  });
}

/**
 * The y axis every chart shares.
 *
 * Its width follows the labels rather than a fixed reserve: uPlot draws them right up against
 * the plot, so anything left over opens as a gap on the far side -- between "Per MMBTU" and
 * "$12" on the fuel chart, which is what gave the reserve away.
 */
export function yAxis(scale: number, o: AxisOptions): uPlot.Axis {
  const font = chartFont();
  const fontSize = CHART_TICK_PX * getTextScale();
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
 * One series into a recorded half and a forecast half, on the shared rule every chart uses:
 * recorded points draw solid, forecast points dashed, and the halves meet at the boundary.
 *
 * The forecast row also carries the last recorded point, so its dashed line starts exactly
 * where the solid one ends instead of a step adrift; `bridgeEnd` mirrors that on the recorded
 * row for charts whose recorded and forecast points are a step apart in x (a day-scale chart)
 * rather than adjacent points on the same grid (a month-scale chart, where reaching into the
 * forecast would draw one projected month solid).
 */
export function splitPastProjected(
  values: Array<number | null>,
  isProjected: boolean[],
  options: { bridgeEnd?: boolean } = {},
): {
  past: Array<number | null>;
  projected: Array<number | null>;
} {
  const past = new Array<number | null>(values.length).fill(null);
  const projected = new Array<number | null>(values.length).fill(null);
  let lastPast = -1;
  let firstProjected = -1;
  for (let i = 0; i < values.length; i++) {
    const value = values[i];
    if (value == null) continue;
    if (isProjected[i]) {
      projected[i] = value;
      if (firstProjected === -1) firstProjected = i;
    } else {
      past[i] = value;
      lastPast = i;
    }
  }
  if (lastPast > -1 && lastPast + 1 < values.length) {
    projected[lastPast] = values[lastPast];
  }
  if (options.bridgeEnd && firstProjected > 0) {
    past[firstProjected] = values[firstProjected];
  }
  return { past, projected };
}

/**
 * Start the dash pattern at the first chart point, then clip away the recorded portion.
 * Starting the path at the moving forecast boundary resets its dash phase on every tick.
 * The paired rows retain their nulls for tooltips, summaries and scale calculations.
 */
export function anchoredForecastPaths(
  pastSeriesIdx: number,
): uPlot.Series.PathBuilder {
  return (u, seriesIdx) => {
    const minutes = u.data[0];
    const past = u.data[pastSeriesIdx];
    const projected = u.data[seriesIdx];
    const firstProjected = projected.findIndex((value) => value != null);
    if (firstProjected < 0) return null;

    const stroke = new Path2D();
    const yScale = u.series[seriesIdx].scale || "y";
    let connected = false;
    for (let i = 0; i < minutes.length; i++) {
      const value = projected[i] ?? past[i];
      if (value == null) {
        connected = false;
        continue;
      }
      const x = Math.round(u.valToPos(minutes[i], "x", true));
      const y = Math.round(u.valToPos(value, yScale, true));
      if (connected) stroke.lineTo(x, y);
      else stroke.moveTo(x, y);
      connected = true;
    }

    const clip = new Path2D();
    const { left, top, width, height } = u.bbox;
    const start = Math.max(
      left,
      Math.round(u.valToPos(minutes[firstProjected], "x", true)),
    );
    clip.rect(start, top, Math.max(0, left + width - start), height);
    return { stroke, clip };
  };
}

/**
 * Spans where a series sits below a threshold, for the red bands a negative cash or loss gets.
 *
 * A below-threshold stretch runs from the crossing into it to the crossing out of it, so a band
 * ends where the line re-emerges above the axis rather than a full interval past; a stretch that
 * is still running at the last point runs to the last x. Null values end any open stretch, since
 * the split halves of a series only null out where the other half takes over.
 */
export function spansBelow(
  x: Array<number>,
  values: Array<number | null>,
  threshold = 0,
): Array<[number, number]> {
  const spans: Array<[number, number]> = [];
  let start: number | null = null;
  let prevX: number | null = null;
  let prevV: number | null = null;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (v == null || !isFinite(v)) {
      if (start !== null && prevX !== null) spans.push([start, prevX]);
      start = null;
      prevX = null;
      prevV = null;
      continue;
    }
    if (v < threshold) {
      if (start === null) {
        start =
          prevV !== null && prevV >= threshold && prevX !== null && v !== prevV
            ? prevX + ((threshold - prevV) / (v - prevV)) * (x[i] - prevX)
            : x[i];
      }
    } else if (start !== null) {
      const end =
        prevV !== null && prevV < threshold && prevX !== null && v !== prevV
          ? prevX + ((threshold - prevV) / (v - prevV)) * (x[i] - prevX)
          : x[i];
      spans.push([start, end]);
      start = null;
    }
    prevX = x[i];
    prevV = v;
  }
  if (start !== null && prevX !== null) spans.push([start, prevX]);
  return spans;
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

const BAND_MERGE_GAP_PX = 2;
const BAND_STRIP_PX = 6;

/** Sorted pixel spans with touching or nearly touching neighbours joined. */
export function mergeBandPixels(
  spans: Array<[number, number] | number[]>,
  gap: number,
): Array<[number, number]> {
  const merged: Array<[number, number]> = [];
  [...spans]
    .sort((a, b) => a[0] - b[0])
    .forEach(([from, to]) => {
      const last = merged[merged.length - 1];
      if (last && from - last[1] <= gap) last[1] = Math.max(last[1], to);
      else merged.push([from, to]);
    });
  return merged;
}

/** Shaded vertical bands, used for the stretches of the day that browned out. */
export function bandsPlugin(
  getSpans: () => Array<[number, number]>,
  color: string,
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
        // Touching months merge into one band, so a long shortfall has no stripes; the faint
        // wash keeps the series readable and the solid strip on top carries the meaning.
        const merged = mergeBandPixels(
          spans.map(([from, to]) => [
            u.valToPos(from, "x", true),
            u.valToPos(to, "x", true),
          ]),
          BAND_MERGE_GAP_PX * uPlot.pxRatio,
        );
        const strip = BAND_STRIP_PX * uPlot.pxRatio;
        for (const [x0, x1] of merged) {
          const width = Math.max(1, x1 - x0);
          u.ctx.fillStyle = withAlpha(color, chartPalette().bandAlpha);
          u.ctx.fillRect(x0, u.bbox.top, width, u.bbox.height);
          u.ctx.fillStyle = color;
          u.ctx.fillRect(x0, u.bbox.top, width, strip);
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
  width = 1,
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
        u.ctx.lineWidth = width;
        // Solid whatever the last dashed series left on the context
        u.ctx.setLineDash([]);
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
 * Redraws the x axis line over the series. uPlot paints axes before series, so a filled series
 * (the history wash) covers the half of the line that sits inside the plot.
 */
export function baselinePlugin(stroke: string): uPlot.Plugin {
  return {
    hooks: {
      draw: (u: uPlot) => {
        const width = Math.max(1, Math.round(uPlot.pxRatio));
        const y = u.bbox.top + u.bbox.height + width / 2;
        u.ctx.save();
        u.ctx.strokeStyle = stroke;
        u.ctx.lineWidth = width;
        u.ctx.setLineDash([]);
        u.ctx.beginPath();
        u.ctx.moveTo(u.bbox.left, y);
        u.ctx.lineTo(u.bbox.left + u.bbox.width, y);
        u.ctx.stroke();
        u.ctx.restore();
      },
    },
  };
}

/**
 * A rule across the plot at zero, for a chart whose series run to either side of it. Drawn after
 * the series so a filled area cannot cover it.
 */
export function zeroLinePlugin(stroke: string): uPlot.Plugin {
  return {
    hooks: {
      draw: (u: uPlot) => {
        const y = u.valToPos(0, "y", true);
        u.ctx.save();
        clipToPlot(u);
        u.ctx.strokeStyle = stroke;
        u.ctx.lineWidth = uPlot.pxRatio;
        u.ctx.setLineDash([]);
        u.ctx.beginPath();
        u.ctx.moveTo(u.bbox.left, y);
        u.ctx.lineTo(u.bbox.left + u.bbox.width, y);
        u.ctx.stroke();
        u.ctx.restore();
      },
    },
  };
}

/**
 * The line texture a flow of power is filled with: vertical rules for power arriving over an
 * intertie, diagonal ones for storage. The texture lets a series be told apart without its
 * colour, and the tile is built on first use because it needs the canvas the plot draws on.
 *
 * `opaque` lays a solid chart-surface wash under the texture, for a load that allocates the
 * production beneath it and must not let that tint bleed through.
 */
export function patternFill(
  kind: "hatch" | "vertical",
  opaque = false,
): uPlot.Series["fill"] {
  const palette = chartPalette();
  let pattern: CanvasPattern | null = null;
  return (u) => {
    if (!pattern) {
      const tile = document.createElement("canvas");
      const ratio = uPlot.pxRatio;
      tile.width = tile.height = 16 * ratio;
      const ctx = tile.getContext("2d")!;
      ctx.scale(ratio, ratio);
      if (opaque) {
        ctx.fillStyle = palette.background;
        ctx.fillRect(0, 0, 16, 16);
      }
      ctx.fillStyle = palette.powerFlowFill;
      ctx.fillRect(0, 0, 16, 16);
      ctx.strokeStyle = palette.powerFlowPattern;
      ctx.lineWidth = 1;
      ctx.beginPath();
      if (kind === "hatch") {
        ctx.moveTo(-8, 16);
        ctx.lineTo(16, -8);
        ctx.moveTo(8, 16);
        ctx.lineTo(16, 8);
      } else {
        ctx.moveTo(8.5, 0);
        ctx.lineTo(8.5, 16);
      }
      ctx.stroke();
      pattern = u.ctx.createPattern(tile, "repeat");
    }
    return pattern || palette.powerFlowFill;
  };
}

const HOVER_POINT_SIZE = 10;
const HOVER_POINT_RING = 2;

/**
 * A dot on each plotted line where the hover crosshair crosses it, in the line's own colour and
 * ringed in the chart surface so it reads over a neighbouring line. Filled areas have no line to
 * mark. A stroke the colour of the surface is a separator between stacked areas, not a line.
 * Where a line has no value at the hovered x, uPlot parks its dot off the plot.
 */
export function hoverPoints(): uPlot.Cursor.Points {
  const lineColor = (plot: uPlot, seriesIndex: number): string | undefined => {
    const series = plot.series[seriesIndex] as uPlot.Series & {
      _stroke?: unknown;
    };
    const stroke = series.stroke;
    const color =
      series._stroke ??
      (typeof stroke === "function" ? stroke(plot, seriesIndex) : stroke);
    return typeof color === "string" && color !== chartPalette().background
      ? color
      : undefined;
  };
  return {
    show: (plot, seriesIndex) => {
      const dot = document.createElement("div");
      dot.style.borderWidth = `${HOVER_POINT_RING}px`;
      // Nothing to mark on a series with no line of its own
      dot.hidden = !lineColor(plot, seriesIndex);
      return dot;
    },
    size: HOVER_POINT_SIZE,
    fill: (plot, seriesIndex) => lineColor(plot, seriesIndex) ?? "transparent",
    stroke: () => chartPalette().background,
  };
}

const EVENT_TOOLTIP_GAP = 6;
// Pointer slop around a badge, in CSS pixels, so a small target is not a precision exercise
const EVENT_BADGE_SLOP = 3;

interface EventBadgeHit {
  left: number;
  top: number;
  right: number;
  bottom: number;
  text: string;
}

/**
 * What hovering a badge says: the one event's name, or for a merged badge each event on its own
 * line behind its number, matching the rail below the toolbar.
 */
export function eventBadgeText(events: ChartEventMarker[]): string {
  const name = (event: ChartEventMarker) => event.title || "Scenario event";
  return events.length === 1
    ? name(events[0])
    : events.map((event) => `${event.number}. ${name(event)}`).join("\n");
}

/** Scenario-event onset markers shared by the stacked Insight charts. */
export function eventMarkersPlugin(
  getMarkers: () => ChartEventMarker[],
  getActiveKey: () => string | undefined,
  fontScale = 1,
): uPlot.Plugin {
  // Where each badge sits on the canvas, in CSS pixels from the plot's top left, as last drawn.
  let hits: EventBadgeHit[] = [];
  let teardown: (() => void) | undefined;
  return {
    opts: (_plot, options) => {
      const padding: uPlot.Padding = options.padding
        ? [...options.padding]
        : [null, null, null, null];
      const originalTop = padding[0];
      // Give event numbers a row above the data instead of painting over chart captions
      // or the series. Every stacked chart reserves the same band, even when panned.
      padding[0] = (plot, side, sides, cycle) => {
        const top =
          typeof originalTop === "function"
            ? originalTop(plot, side, sides, cycle)
            : (originalTop ?? 0);
        return (
          top + (getMarkers().length ? 24 * getTextScale() * fontScale : 0)
        );
      };
      options.padding = padding;
    },
    hooks: {
      init: (u: uPlot) => {
        // The badges are canvas pixels above the plot, outside uPlot's own pointer surface, so
        // their tooltip listens on the plot's wrapper, which is the plot's coordinate space.
        const wrap = u.over.parentElement!;
        const tooltip = document.createElement("div");
        tooltip.className = "chartEventTooltip";
        tooltip.setAttribute("aria-hidden", "true");
        wrap.appendChild(tooltip);
        const hide = () => {
          tooltip.style.display = "none";
        };
        const inspect = (event: MouseEvent) => {
          const bounds = wrap.getBoundingClientRect();
          const x = event.clientX - bounds.left;
          const y = event.clientY - bounds.top;
          const hit = hits.find(
            (badge) =>
              x >= badge.left - EVENT_BADGE_SLOP &&
              x <= badge.right + EVENT_BADGE_SLOP &&
              y >= badge.top - EVENT_BADGE_SLOP &&
              y <= badge.bottom + EVENT_BADGE_SLOP,
          );
          if (!hit) {
            hide();
            return;
          }
          tooltip.textContent = hit.text;
          tooltip.style.display = "block";
          tooltip.style.maxWidth = `${wrap.clientWidth}px`;
          const center = (hit.left + hit.right) / 2;
          tooltip.style.left = `${Math.max(0, Math.min(wrap.clientWidth - tooltip.offsetWidth, center - tooltip.offsetWidth / 2))}px`;
          tooltip.style.top = `${hit.bottom + EVENT_TOOLTIP_GAP}px`;
        };
        wrap.addEventListener("mousemove", inspect);
        wrap.addEventListener("mouseleave", hide);
        teardown = () => {
          wrap.removeEventListener("mousemove", inspect);
          wrap.removeEventListener("mouseleave", hide);
          tooltip.remove();
        };
      },
      destroy: () => {
        teardown?.();
        teardown = undefined;
      },
      draw: (u: uPlot) => {
        hits = [];
        const domainMin = u.scales.x.min;
        const domainMax = u.scales.x.max;
        const markers = getMarkers().filter(
          (marker) =>
            domainMin != null &&
            domainMax != null &&
            marker.x >= domainMin &&
            marker.x <= domainMax,
        );
        if (!markers.length) {
          return;
        }
        const scale = canvasScale(u);
        const markerScale = uPlot.pxRatio * getTextScale() * fontScale;
        const palette = chartPalette();
        const activeKey = getActiveKey();
        u.ctx.save();
        u.ctx.save();
        clipToPlot(u);
        u.ctx.setLineDash([4 * scale, 3 * scale]);
        u.ctx.strokeStyle = palette.interactive;
        for (const marker of markers) {
          const active = marker.key === activeKey;
          const x = Math.round(u.valToPos(marker.x, "x", true)) + 0.5;
          u.ctx.globalAlpha = active ? 0.95 : 0.5;
          u.ctx.lineWidth = (active ? 2 : 1) * uPlot.pxRatio;
          u.ctx.beginPath();
          u.ctx.moveTo(x, u.bbox.top);
          u.ctx.lineTo(x, u.bbox.top + u.bbox.height);
          u.ctx.stroke();
        }
        u.ctx.restore();
        const radius = 8 * markerScale;
        const badgeY = u.bbox.top - 12 * markerScale;
        // Match the rail's numbers without letting close event dates paint over one another.
        // A compact range shares one badge; the onset guides below retain every real date.
        u.ctx.font = chartFont(1, (12 * markerScale) / getTextScale());
        const groupBadge = (events: ChartEventMarker[]) => {
          const numbers = events.map((event) => event.number);
          const consecutive = numbers.every(
            (number, index) => number === numbers[0] + index,
          );
          const label =
            numbers.length > 1 && consecutive
              ? `${numbers[0]}–${numbers.at(-1)}`
              : numbers.join(", ");
          const width = Math.max(
            radius * 2,
            u.ctx.measureText(label).width + 8 * markerScale,
          );
          const center =
            (u.valToPos(events[0].x, "x", true) +
              u.valToPos(events.at(-1)!.x, "x", true)) /
            2;
          const x = Math.max(
            u.bbox.left + width / 2,
            Math.min(
              u.bbox.left + u.bbox.width - width / 2,
              Math.round(center) + 0.5,
            ),
          );
          return { events, label, width, x };
        };
        const groups: ReturnType<typeof groupBadge>[] = [];
        for (const marker of [...markers].sort((a, b) => a.x - b.x)) {
          let group = groupBadge([marker]);
          while (groups.length) {
            const previous = groups.at(-1)!;
            if (
              previous.x + previous.width / 2 + 4 * markerScale <
              group.x - group.width / 2
            )
              break;
            groups.pop();
            group = groupBadge([...previous.events, ...group.events]);
          }
          groups.push(group);
        }
        for (const group of groups) {
          const active = group.events.some(
            (marker) => marker.key === activeKey,
          );
          u.ctx.globalAlpha = 1;
          u.ctx.setLineDash([]);
          u.ctx.fillStyle = palette.background;
          u.ctx.strokeStyle = palette.interactive;
          u.ctx.lineWidth = (active ? 2 : 1) * uPlot.pxRatio;
          for (const marker of group.events) {
            u.ctx.beginPath();
            u.ctx.moveTo(group.x, badgeY + radius);
            u.ctx.lineTo(u.valToPos(marker.x, "x", true), u.bbox.top);
            u.ctx.stroke();
          }
          u.ctx.beginPath();
          if (group.width <= radius * 2)
            u.ctx.arc(group.x, badgeY, radius, 0, Math.PI * 2);
          else
            u.ctx.roundRect(
              group.x - group.width / 2,
              badgeY - radius,
              group.width,
              radius * 2,
              radius,
            );
          u.ctx.fill();
          u.ctx.stroke();
          u.ctx.fillStyle = palette.interactive;
          u.ctx.textAlign = "center";
          u.ctx.textBaseline = "middle";
          u.ctx.fillText(group.label, group.x, badgeY);
          hits.push({
            left: (group.x - group.width / 2) / uPlot.pxRatio,
            top: (badgeY - radius) / uPlot.pxRatio,
            right: (group.x + group.width / 2) / uPlot.pxRatio,
            bottom: (badgeY + radius) / uPlot.pxRatio,
            text: eventBadgeText(group.events),
          });
        }
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
 * `maxTicks` land in the span. Minute-based month axes use it with a month's worth of minutes;
 * charts whose x is already a month index use it with 1.
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
