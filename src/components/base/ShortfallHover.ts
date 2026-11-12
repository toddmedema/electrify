import uPlot from "uplot";
import { chartPalette, withAlpha } from "../../Theme";
import { formatWatts } from "../../helpers/Format";
import {
  ShortfallBar,
  shortfallHeight,
  SHORTFALL_CAP_PX,
} from "./UPlotHelpers";

interface PowerSample {
  minute: number;
  supplyW: number;
  demandW: number;
}

export type ShortfallInterval = ShortfallBar & {
  /** A still-short terminal sample belongs to its interval; recovery endpoints do not. */
  includeEnd?: boolean;
};

/** Read the same intervals that are shaded, retaining coincident rather than independent extrema. */
export function shortfallIntervals(
  timeline: readonly PowerSample[],
  spans: Array<[number, number]>,
): ShortfallInterval[] {
  let index = 0;
  const finalSample = timeline[timeline.length - 1];
  return spans.map(([from, to]) => {
    while (index < timeline.length && timeline[index].minute < from) index++;
    let peakW = 0;
    for (let i = index; i < timeline.length && timeline[i].minute <= to; i++) {
      peakW = Math.max(peakW, timeline[i].demandW - timeline[i].supplyW);
    }
    return {
      from,
      to,
      peakShortfall: peakW,
      ...(finalSample?.minute === to &&
      finalSample.demandW > finalSample.supplyW
        ? { includeEnd: true }
        : {}),
    };
  });
}

export function shortfallAt(
  intervals: readonly ShortfallInterval[],
  minute: number,
): ShortfallInterval | undefined {
  return intervals.find(
    ({ from, to, includeEnd }) =>
      minute >= from && (minute < to || (includeEnd && minute === to)),
  );
}

/** Interpolate the plotted lines so even the sliver before the first short sample is inspectable. */
export function unmetAt(
  timeline: readonly PowerSample[],
  minute: number,
): number {
  if (!timeline.length) return 0;
  const right = timeline.findIndex((tick) => tick.minute >= minute);
  const next = timeline[right < 0 ? timeline.length - 1 : right];
  const previous = timeline[Math.max(0, right - 1)];
  if (right <= 0) return Math.max(0, next.demandW - next.supplyW);
  const fraction = (minute - previous.minute) / (next.minute - previous.minute);
  const gap = (tick: PowerSample) => tick.demandW - tick.supplyW;
  return Math.max(0, gap(previous) + (gap(next) - gap(previous)) * fraction);
}

export function shortfallTooltip(
  timeline: readonly PowerSample[],
  intervals: readonly ShortfallInterval[],
  minute: number,
): string {
  const interval = shortfallAt(intervals, minute);
  return interval ? ` · ${formatWatts(unmetAt(timeline, minute))} unmet` : "";
}

/** A full-height hit region follows x, independently of the nearest sample or pointer height. */
export function shortfallHoverPlugin(
  getIntervals: () => readonly ShortfallInterval[],
  { scaleHeight = false }: { scaleHeight?: boolean } = {},
): uPlot.Plugin {
  let highlight: HTMLDivElement;
  const update = (u: uPlot) => {
    if (!highlight) return;
    const { left, top } = u.cursor;
    const interval =
      left != null &&
      top != null &&
      left >= 0 &&
      top >= 0 &&
      left <= u.over.clientWidth &&
      top <= u.over.clientHeight
        ? shortfallAt(getIntervals(), u.posToVal(left, "x"))
        : undefined;
    highlight.hidden = !interval;
    if (!interval) return;
    const from = Math.max(0, u.valToPos(interval.from, "x"));
    const to = Math.min(u.over.clientWidth, u.valToPos(interval.to, "x"));
    if (scaleHeight) {
      const ratio = uPlot.pxRatio || 1;
      const ySpan = (u.scales.y.max ?? 0) - (u.scales.y.min ?? 0);
      highlight.style.height = `${
        shortfallHeight(
          interval.peakShortfall / ySpan,
          u.bbox.height,
          Math.round(SHORTFALL_CAP_PX * ratio),
        ) / ratio
      }px`;
    }
    highlight.style.left = `${from}px`;
    highlight.style.width = `${Math.max(1, to - from)}px`;
  };
  return {
    hooks: {
      init: (u) => {
        highlight = document.createElement("div");
        highlight.className = "chartShortfallHighlight";
        highlight.hidden = true;
        highlight.setAttribute("aria-hidden", "true");
        Object.assign(highlight.style, {
          position: "absolute",
          top: "0",
          height: "100%",
          pointerEvents: "none",
          boxSizing: "border-box",
          border: `2px solid ${chartPalette().blackout}`,
          background: withAlpha(chartPalette().blackout, 0.14),
        });
        u.over.appendChild(highlight);
      },
      setCursor: update,
      draw: update,
      destroy: () => highlight?.remove(),
    },
  };
}
