import uPlot from "uplot";
import { SpeedType } from "../../Types";
import { TICK_MINUTES } from "../../Constants";

interface CacheState {
  minute: number;
  range: [number, number];
  domain: [number, number];
  speed: SpeedType;
  blackoutSpans: Array<[number, number]>;
}
export interface ProductionStroke {
  pastIndex: number;
  color: string;
  width: number;
  dash: number[];
}

/** Retain identical curve pixels and repaint the history reveal only at native ticks. */
export function productionChartStrokes(
  getState: () => CacheState,
  strokes: ProductionStroke[],
  refreshGuide: (plot: uPlot) => void,
) {
  const active = () => getState().speed === "SLOW";
  let plot: uPlot;
  let solid: HTMLCanvasElement;
  let dashed: HTMLCanvasElement;
  let backdrop: HTMLCanvasElement;
  let revision = 0;
  let destroyed = false;
  let hasBackdrop = false;
  let drawnX = 0;
  let lastMinute: number | undefined;
  let lastGeometry = "";
  let lastBackground = "";
  let paintedMinutes: number[] = [];
  let paintedValues: Array<Array<number | null>> = [];
  const backgroundKey = (state: CacheState) =>
    `${state.range}:${state.domain}:${state.blackoutSpans}`;
  // Both uPlot's filled paths (pxAlign: 1) and our strokes round their canvas coordinates.
  // Compare with the last painted values so small changes accumulate until a pixel changes;
  // tooltips and accessible values continue to read the exact current numbers from React.
  const samePixel = (
    value: number | null | undefined,
    previous: number | null | undefined,
  ) =>
    value === previous ||
    (typeof value === "number" &&
      typeof previous === "number" &&
      Math.round(plot.valToPos(value, "y", true)) ===
        Math.round(plot.valToPos(previous, "y", true)));

  const valuesUnchanged = (data: uPlot.AlignedData) => {
    const previousData = plot.data;
    if (!strokes.length || data.length !== previousData.length) return false;
    // Filled bands include charging/export allocations even where their divider is absent.
    for (let series = 0; series < strokes[0].pastIndex; series++) {
      if (
        data[series].length !== previousData[series].length ||
        data[series].some((value, i) =>
          series === 0
            ? value !== previousData[series][i]
            : !samePixel(value, previousData[series][i]),
        )
      )
        return false;
    }
    return strokes.every((stroke, j) =>
      data[0].every((_minute, i) =>
        samePixel(
          data[stroke.pastIndex][i] ?? data[stroke.pastIndex + 1][i] ?? null,
          paintedValues[j]?.[i],
        ),
      ),
    );
  };

  function boundary(minute: number) {
    return Math.max(
      plot.bbox.left,
      Math.min(
        plot.bbox.left + plot.bbox.width,
        plot.valToPos(minute, "x", true),
      ),
    );
  }
  function paint(x: number, full: boolean) {
    const {
      ctx,
      bbox: { left, top, width, height },
    } = plot;
    const start = full
      ? left
      : Math.max(left, Math.floor(Math.min(drawnX, x)) - 1);
    const end = full
      ? left + width
      : Math.min(left + width, Math.ceil(Math.max(drawnX, x)) + 2);
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    if (!full && end > start) {
      ctx.clearRect(start, top, end - start, height);
      ctx.drawImage(
        backdrop,
        start,
        top,
        end - start,
        height,
        start,
        top,
        end - start,
        height,
      );
    }
    const draw = (canvas: HTMLCanvasElement, a: number, b: number) => {
      if (b > a)
        ctx.drawImage(
          canvas,
          a - left,
          0,
          b - a,
          height,
          a,
          top,
          b - a,
          height,
        );
    };
    draw(solid, start, Math.min(end, x));
    draw(dashed, Math.max(start, x), end);
    ctx.restore();
    drawnX = x;
  }
  const plugin: uPlot.Plugin = {
    hooks: {
      init: (u) => {
        plot = u;
        [solid, dashed, backdrop] = Array.from({ length: 3 }, () => {
          const canvas = document.createElement("canvas");
          canvas.width = canvas.height = 0;
          return canvas;
        });
      },
      draw: (u) => {
        hasBackdrop = false;
        const currentRevision = ++revision;
        if (!active()) {
          lastMinute = undefined;
          return;
        }
        const state = getState();
        const { left, top, width, height } = u.bbox;
        const ratio = uPlot.pxRatio;
        const geometry = `${state.range}:${left},${top},${width},${height},${ratio}:${u.scales.x.min},${u.scales.x.max},${u.scales.y.min},${u.scales.y.max}`;
        const repaint =
          geometry !== lastGeometry ||
          paintedMinutes.length !== u.data[0].length ||
          u.data[0].some((minute, i) => minute !== paintedMinutes[i]) ||
          strokes.some((stroke, j) =>
            u.data[0].some(
              (_minute, i) =>
                (u.data[stroke.pastIndex][i] ??
                  u.data[stroke.pastIndex + 1][i] ??
                  null) !== paintedValues[j]?.[i],
            ),
          );
        if (repaint) {
          const contexts = [solid, dashed].map((canvas) => {
            if (canvas.width !== Math.ceil(width))
              canvas.width = Math.ceil(width);
            if (canvas.height !== Math.ceil(height))
              canvas.height = Math.ceil(height);
            const ctx = canvas.getContext("2d")!;
            ctx.setTransform(1, 0, 0, 1, -left, -top);
            ctx.clearRect(left, top, width, height);
            return ctx;
          });
          paintedValues = [];
          paintedMinutes = Array.from(u.data[0]);
          for (const stroke of strokes) {
            const path = new Path2D();
            const values: Array<number | null> = [];
            let connected = false;
            u.data[0].forEach((minute, i) => {
              const value =
                u.data[stroke.pastIndex][i] ??
                u.data[stroke.pastIndex + 1][i] ??
                null;
              values.push(value);
              if (value == null) {
                connected = false;
                return;
              }
              const x = Math.round(u.valToPos(minute, "x", true));
              const y = Math.round(u.valToPos(value, "y", true));
              if (connected) path.lineTo(x, y);
              else path.moveTo(x, y);
              connected = true;
            });
            contexts.forEach((ctx, i) => {
              ctx.strokeStyle = stroke.color;
              ctx.lineWidth = stroke.width * ratio;
              ctx.lineJoin = "round";
              ctx.setLineDash(
                i ? stroke.dash.map((value) => value * ratio) : [],
              );
              ctx.stroke(path);
            });
            paintedValues.push(values);
          }
        }

        lastMinute = state.minute;
        lastGeometry = geometry;
        lastBackground = backgroundKey(state);
        // Include generic event annotations in the clean background, after all native hooks.
        queueMicrotask(() => {
          if (destroyed || revision !== currentRevision || !active()) return;
          const canvas = u.ctx.canvas;
          if (backdrop.width !== canvas.width) backdrop.width = canvas.width;
          if (backdrop.height !== canvas.height)
            backdrop.height = canvas.height;
          const ctx = backdrop.getContext("2d")!;
          ctx.clearRect(0, 0, backdrop.width, backdrop.height);
          ctx.drawImage(canvas, 0, 0);
          hasBackdrop = true;
          paint(boundary(state.minute), true);
        });
      },
      destroy: () => {
        destroyed = true;
        revision++;
      },
    },
  };
  return {
    plugin,
    paths:
      (fallback: uPlot.Series.PathBuilder): uPlot.Series.PathBuilder =>
      (...args) =>
        active() ? null : fallback(...args),
    updateData: (u: uPlot, data: uPlot.AlignedData) => {
      const state = getState();
      // Compute the needed boundary before comparing pixels. This also lets the browser
      // benchmark's public valToPos probe account for the complete cache-update work.
      const nextX = boundary(state.minute);
      if (
        !active() ||
        !hasBackdrop ||
        lastMinute === undefined ||
        state.minute - lastMinute !== TICK_MINUTES ||
        backgroundKey(state) !== lastBackground ||
        !valuesUnchanged(data)
      ) {
        u.setData(data);
        return;
      }
      paint(nextX, false);
      lastMinute = state.minute;
      refreshGuide(u);
      // Exact tooltip/aria values read the fresh React state/data refs, even for subpixel edits.
      const { idx, left, top } = u.cursor;
      if (idx != null && left != null && left >= 0)
        u.setCursor({ left, top: top ?? 0 });
    },
  };
}
