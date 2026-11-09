import uPlot from "uplot";
import { SpeedType } from "../../Types";
import { TICK_MINUTES, TICK_MS } from "../../Constants";
import { chartPalette } from "../../Theme";
import { chartFont, tickLabelFill } from "./UPlotHelpers";

interface MotionState {
  minute: number;
  range: [number, number];
  speed: SpeedType;
}

/** Lead the native history reveal by up to one tick without redrawing chart data. */
export function productionChartMotion(getState: () => MotionState) {
  const active = () => getState().speed === "SLOW";
  let host: HTMLElement;
  let marker: HTMLDivElement;
  let label: HTMLSpanElement;
  let halfWidth = 0;
  let reduced: MediaQueryList;
  let timers: number[] = [];
  let pointerInside = false;
  let drawnX = 0;
  let targetX = 0;
  let lastMinute: number | undefined;
  let lastGeometry = "";
  let lastData: uPlot.AlignedData | undefined;
  const cancel = () => {
    timers.forEach((timer) => window.clearTimeout(timer));
    timers = [];
  };
  const setPosition = (x: number) => {
    if (drawnX !== x) marker.style.transform = `translateX(${x}px)`;
    drawnX = x;
  };
  const snap = () => {
    cancel();
    setPosition(targetX);
  };
  const canAnimate = () =>
    !reduced.matches &&
    !document.hidden &&
    !pointerInside &&
    !host.contains(document.activeElement);
  const pointerEnter = (event: PointerEvent) => {
    pointerInside = event.pointerType !== "touch";
    snap();
  };
  const pointerLeave = () => {
    pointerInside = false;
  };

  const refresh = (u: uPlot) => {
    const state = getState();
    const { left, top, width, height } = u.bbox;
    const ratio = uPlot.pxRatio;
    if (
      !active() ||
      state.minute <= state.range[0] ||
      state.minute >= state.range[1]
    ) {
      snap();
      marker.style.display = "none";
      lastMinute = undefined;
      return;
    }
    const geometry = `${state.range}:${left},${top},${width},${height},${ratio}:${u.scales.x.min},${u.scales.x.max}`;
    // Annotation redraws retain the current transition. Forecast edits at the same time snap.
    if (
      lastMinute === state.minute &&
      geometry === lastGeometry &&
      lastData === u.data
    ) {
      if (!canAnimate()) snap();
      return;
    }
    const advance =
      lastMinute !== undefined &&
      state.minute - lastMinute === TICK_MINUTES &&
      geometry === lastGeometry &&
      canAnimate();
    cancel();
    targetX = u.valToPos(state.minute, "x", true) / ratio;
    let nextX = advance
      ? u.valToPos(state.minute + TICK_MINUTES, "x", true) / ratio
      : targetX;
    if (geometry !== lastGeometry)
      Object.assign(marker.style, {
        top: `${top / ratio}px`,
        height: `${height / ratio}px`,
        width: `${1 / ratio}px`,
      });
    if (marker.style.display !== "block") marker.style.display = "block";
    const labelX = Math.max(
      left / ratio + halfWidth,
      Math.min((left + width) / ratio - halfWidth, targetX),
    );
    const labelOffset = `${labelX - targetX}px`;
    if (label.style.left !== labelOffset) label.style.left = labelOffset;
    // Keep the clamped label still at either edge; resume motion once it fits around Now.
    if (
      targetX < left / ratio + halfWidth ||
      nextX > (left + width) / ratio - halfWidth
    )
      nextX = targetX;
    setPosition(targetX);
    if (advance && nextX !== targetX) {
      const midpoint = (targetX + nextX) / 2;
      const endpoint = nextX;
      timers = [
        window.setTimeout(() => setPosition(midpoint), TICK_MS.SLOW / 2),
        // The next native tick catches the history reveal up to the guide. If it is
        // delayed, finish this step and wait rather than predicting beyond one tick.
        window.setTimeout(() => setPosition(endpoint), TICK_MS.SLOW * 1.1),
      ];
    }
    lastMinute = state.minute;
    lastGeometry = geometry;
    lastData = u.data;
  };

  const plugin: uPlot.Plugin = {
    hooks: {
      init: (u) => {
        // uPlot detaches its root before the destroy hook runs.
        host = u.root.parentElement!;
        // UPlotChart rebuilds for font readiness, text size and palette changes.
        u.ctx.save();
        u.ctx.font = chartFont();
        halfWidth = u.ctx.measureText("Now").width / 2;
        u.ctx.restore();
        marker = document.createElement("div");
        marker.dataset.productionNow = "";
        marker.setAttribute("aria-hidden", "true");
        Object.assign(marker.style, {
          position: "absolute",
          left: "0",
          willChange: "transform",
          display: "none",
          pointerEvents: "none",
          background: chartPalette().axis,
        });
        label = document.createElement("span");
        label.textContent = "Now";
        Object.assign(label.style, {
          position: "absolute",
          bottom: "calc(100% + 4px)",
          marginLeft: `${-halfWidth}px`,
          font: chartFont(),
          lineHeight: "1",
          color: tickLabelFill(),
        });
        marker.appendChild(label);
        u.ctx.canvas.parentElement!.insertBefore(marker, u.over);
        reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
        reduced.addEventListener("change", snap);
        document.addEventListener("visibilitychange", snap);
        u.over.addEventListener("pointerenter", pointerEnter);
        u.over.addEventListener("pointerleave", pointerLeave);
        host.addEventListener("pointerdown", snap, true);
        host.addEventListener("focusin", snap);
        host.addEventListener("keydown", snap, true);
      },
      draw: refresh,
      destroy: (u) => {
        cancel();
        reduced.removeEventListener("change", snap);
        document.removeEventListener("visibilitychange", snap);
        u.over.removeEventListener("pointerenter", pointerEnter);
        u.over.removeEventListener("pointerleave", pointerLeave);
        host.removeEventListener("pointerdown", snap, true);
        host.removeEventListener("focusin", snap);
        host.removeEventListener("keydown", snap, true);
        marker.remove();
      },
    },
  };
  return { active, plugin, refresh };
}
