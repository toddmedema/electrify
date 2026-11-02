import uPlot from "uplot";
import { chartPalette } from "../../Theme";
import { chartFont } from "./UPlotHelpers";

interface SurplusPoint {
  x: number;
  supplyY: number;
  loadY: number;
  boundariesY?: number[];
}
interface SurplusLabel {
  x: number;
  y: number;
}

const LABEL = "Unused surplus";

/** Fit the entire text rectangle inside each continuous, piecewise-linear surplus gap. */
export function surplusLabels(
  points: SurplusPoint[],
  width: number,
  height: number,
  padding: number,
): SurplusLabel[] {
  const regions: SurplusPoint[][] = [];
  let region: SurplusPoint[] = [];
  for (let i = 0; i < points.length; i++) {
    const point = points[i];
    const previous = points[i - 1];
    const gap = point.loadY - point.supplyY;
    if (previous) {
      const previousGap = previous.loadY - previous.supplyY;
      const positive = gap > 0;
      const previousPositive = previousGap > 0;
      if (positive !== previousPositive) {
        const fraction = previousGap / (previousGap - gap);
        const crossing = {
          x: previous.x + (point.x - previous.x) * fraction,
          supplyY:
            previous.supplyY + (point.supplyY - previous.supplyY) * fraction,
          loadY: previous.loadY + (point.loadY - previous.loadY) * fraction,
          boundariesY: previous.boundariesY?.map(
            (value, j) => value + (point.boundariesY![j] - value) * fraction,
          ),
        };
        region.push(crossing);
        if (gap <= 0) {
          regions.push(region);
          region = [];
        }
      }
    }
    if (gap > 0) region.push(point);
  }
  if (region.length) regions.push(region);

  const half = width / 2 + padding;
  return regions.flatMap((vertices) => {
    const start = vertices[0].x + half;
    const end = vertices[vertices.length - 1].x - half;
    if (start > end) return [];
    const center = (start + end) / 2;
    const candidates = [center, ...vertices.map((point) => point.x)].map((x) =>
      Math.max(start, Math.min(end, x)),
    );
    let best: SurplusLabel | undefined;
    let clearance = height + padding * 2;
    for (const x of candidates) {
      const left = x - half;
      const right = x + half;
      let top = -Infinity;
      let bottom = Infinity;
      const boundaries = (vertices[0].boundariesY || []).map(() => [
        Infinity,
        -Infinity,
      ]);
      for (let i = 1; i < vertices.length; i++) {
        const a = vertices[i - 1];
        const b = vertices[i];
        if (b.x < left || a.x > right || b.x === a.x) continue;
        for (const edge of [Math.max(left, a.x), Math.min(right, b.x)]) {
          const fraction = (edge - a.x) / (b.x - a.x);
          top = Math.max(top, a.supplyY + (b.supplyY - a.supplyY) * fraction);
          bottom = Math.min(bottom, a.loadY + (b.loadY - a.loadY) * fraction);
          a.boundariesY?.forEach((value, j) => {
            const y = value + (b.boundariesY![j] - value) * fraction;
            boundaries[j][0] = Math.min(boundaries[j][0], y);
            boundaries[j][1] = Math.max(boundaries[j][1], y);
          });
        }
      }
      // Thin source boundaries can pass through the unfilled gap. Keep the whole label
      // clear of their vertical extent across its width, as well as supply and load.
      boundaries.sort((a, b) => a[0] - b[0]);
      for (const [from, to] of [...boundaries, [bottom, bottom]]) {
        const edge = Math.min(bottom, from);
        const gap = edge - top;
        if (
          gap >= clearance &&
          (gap > clearance ||
            !best ||
            Math.abs(x - center) < Math.abs(best.x - center))
        ) {
          best = { x, y: (top + edge) / 2 };
          clearance = gap;
        }
        top = Math.max(top, to);
      }
    }
    return best ? [best] : [];
  });
}

/** Clip source fills only; the separately drawn supply outlines keep their actual heights. */
export function productionChartSurplus(sourceCount: number, loadIndex: number) {
  let previousData: uPlot.AlignedData | undefined;
  let previousGeometry = "";
  let clip: Path2D;
  let labels: SurplusLabel[] = [];
  const prepare = (u: uPlot) => {
    const { left, top, width, height } = u.bbox;
    const geometry = `${left},${top},${width},${height}:${u.scales.x.min},${u.scales.x.max},${u.scales.y.min},${u.scales.y.max}:${uPlot.pxRatio}`;
    if (u.data === previousData && geometry === previousGeometry) return;
    previousData = u.data;
    previousGeometry = geometry;
    const points = Array.from(u.data[0], (minute, i) => ({
      x: Math.round(u.valToPos(minute, "x", true)),
      supplyY: Math.round(
        u.valToPos(sourceCount ? u.data[sourceCount][i]! : 0, "y", true),
      ),
      loadY: Math.round(u.valToPos(u.data[loadIndex][i]!, "y", true)),
      boundariesY: Array.from(
        { length: Math.max(0, sourceCount - 1) },
        (_, j) => Math.round(u.valToPos(u.data[j + 1][i]!, "y", true)),
      ),
    }));
    clip = new Path2D();
    if (points.length) {
      clip.moveTo(points[0].x, top + height);
      points.forEach(({ x, loadY }) => clip.lineTo(x, loadY));
      clip.lineTo(points[points.length - 1].x, top + height);
      clip.closePath();
    }
    const ratio = uPlot.pxRatio;
    u.ctx.save();
    u.ctx.font = chartFont(ratio);
    const metrics = u.ctx.measureText(LABEL);
    const textHeight =
      metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent ||
      14 * ratio;
    // Fit against the visible plot as well as both curves, including after a resize.
    const visible = points.map((point) => ({
      ...point,
      supplyY: Math.max(top, point.supplyY),
      loadY: Math.min(top + height, point.loadY),
    }));
    labels = surplusLabels(
      visible,
      metrics.width,
      textHeight,
      4 * ratio,
    ).filter(
      ({ x }) =>
        x - metrics.width / 2 >= left + 4 * ratio &&
        x + metrics.width / 2 <= left + width - 4 * ratio,
    );
    u.ctx.restore();
  };
  return {
    paths:
      (base: uPlot.Series.PathBuilder): uPlot.Series.PathBuilder =>
      (u, ...args) => {
        prepare(u);
        const paths = base(u, ...args);
        return paths ? { ...paths, clip } : paths;
      },
    plugin: {
      hooks: {
        draw: (u: uPlot) => {
          prepare(u);
          u.ctx.save();
          u.ctx.font = chartFont(uPlot.pxRatio);
          u.ctx.fillStyle = chartPalette().legendText;
          u.ctx.textAlign = "center";
          u.ctx.textBaseline = "middle";
          labels.forEach(({ x, y }) => u.ctx.fillText(LABEL, x, y));
          u.ctx.restore();
        },
      },
    } satisfies uPlot.Plugin,
  };
}
