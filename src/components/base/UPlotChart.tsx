import * as React from "react";
import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";
import { chartScale, eventMarkersPlugin } from "./UPlotHelpers";
import { getThemeVersion, subscribeThemeMode } from "../../Theme";
import { ChartAnnotationsContext } from "./ChartAnnotationsContext";
import {
  ChartViewportContext,
  ChartViewportRange,
  panChartViewport,
  rangesEqual,
  zoomChartViewport,
} from "./ChartViewportContext";

/**
 * The React shell every chart in the game sits in.
 *
 * A uPlot instance is built once and then fed with `setData`, which is the whole reason for the
 * move off Victory: redrawing a canvas costs about a fortieth of what re-reconciling an SVG
 * element per point, per series and per decoration did on every tick.
 *
 * Options are built once too, so anything inside them that needs to see fresh props reads them
 * through the `getState` accessor rather than closing over a stale render.
 */

export interface BuildContext<S> {
  /** The newest render's values, whenever an option callback or plugin asks */
  getState: () => S;
  /**
   * Pane width over the 350-wide space the charts are described in. Victory scaled its whole
   * viewBox by this, so lengths and font sizes are multiplied by it to match.
   */
  scale: number;
}

export interface UPlotChartProps<S> {
  /** What the chart shows, read by screen readers instead of the pixels */
  ariaLabel: string;
  id?: string;
  /** Height in design units; see DESIGN_WIDTH */
  height?: number;
  /** Everything the option callbacks and plugins need, recomputed every render */
  state: S;
  data: uPlot.AlignedData;
  /** Optional unstacked values for the accessible label when the canvas needs cumulative data. */
  summaryData?: uPlot.AlignedData;
  /** Called once per plot. Width and height are filled in by this component. */
  buildOptions: (ctx: BuildContext<S>) => uPlot.Options;
  /** Change to force a rebuild, eg when the number of series changes */
  structureKey?: string | number;
  /** One tooltip covering every series at the hovered x */
  tooltip?: (idx: number, state: S) => string;
  /** Format a two-column breakdown, also available through the keyboard. */
  interactiveTooltip?: boolean;
  /**
   * Charts sharing this key share a cursor: hovering one puts a crosshair at the same x on all
   * of them. Only for charts drawn against the same x scale, one above another. Numbers stay
   * with the pointer -- five tooltips at once would cover the data they are about.
   */
  syncKey?: string;
  /** Human names for each y-series, used by the screen-reader label. */
  seriesLabels?: readonly string[];
  /** Formats label values with the same compact units the visible chart uses. */
  formatSummaryValue?: (value: number, seriesIndex: number) => string;
}

const TOOLTIP_OFFSET = 8;
// During a live pane or window resize, changing this state rebuilds the complete plot so axes,
// fonts and decorations can be rescaled. Do that once after the gesture instead of once per
// pointer move; uPlot can resize its existing canvas cheaply in the meantime.
const RESIZE_SETTLE_MS = 120;

function tooltipPlugin<S>(
  getState: () => S,
  getLabel: () => ((idx: number, state: S) => string) | undefined,
  hoverOnly: boolean,
  interactiveTooltip: boolean,
): uPlot.Plugin {
  let el: HTMLDivElement | null = null;
  let header: HTMLDivElement;
  let columns: Array<{ total: HTMLElement; rows: HTMLDivElement }>;
  let dismiss: (event: KeyboardEvent) => void;
  // A synced chart moves its cursor when a neighbour is hovered, which is the point -- but it
  // should not also open a tooltip over data the pointer isn't anywhere near
  let hovering = !hoverOnly;
  return {
    hooks: {
      init: (u: uPlot) => {
        el = document.createElement("div");
        el.className = "chartTooltip";
        u.over.appendChild(el);
        if (interactiveTooltip) {
          el.classList.add("chartTooltip-breakdown");
          header = document.createElement("div");
          const values = document.createElement("div");
          values.className = "chartTooltipValues";
          columns = [0, 1].map(() => {
            const column = document.createElement("div");
            const total = document.createElement("strong");
            const rows = document.createElement("div");
            column.append(total, rows);
            values.appendChild(column);
            return { total, rows };
          });
          el.append(header, values);
          dismiss = (event) => {
            if (event.key === "Escape") u.setCursor({ left: -10, top: -10 });
          };
          document.addEventListener("keydown", dismiss);
        }
        if (hoverOnly) {
          u.over.addEventListener("mouseenter", () => {
            hovering = true;
          });
          u.over.addEventListener("mouseleave", () => {
            hovering = false;
            if (el) {
              el.style.display = "none";
            }
          });
        }
      },
      setCursor: (u: uPlot) => {
        const label = getLabel();
        const idx = u.cursor.idx;
        if (!el || !label || idx == null || !hovering) {
          if (el) {
            el.style.display = "none";
          }
          return;
        }
        const text = label(idx, getState());
        if (interactiveTooltip) {
          const groups = text.split("\n\n");
          const [time, ...supply] = groups[0].split("\n");
          header.textContent = time;
          [supply, (groups[1] || "").split("\n")].forEach((rows, i) => {
            columns[i].total.textContent = rows[0];
            columns[i].rows.textContent = rows.slice(1).join("\n");
          });
          el.style.maxWidth = `${u.over.clientWidth}px`;
        } else {
          el.textContent = text;
        }
        el.style.display = "block";
        el.style.maxHeight = `${u.over.clientHeight}px`;
        el.style.overflowY = "auto";
        // Kept inside the plot, the way Victory's constrainToVisibleArea tooltip was
        const left = u.cursor.left!;
        const top = u.cursor.top!;
        const flipX =
          left + TOOLTIP_OFFSET + el.offsetWidth > u.over.clientWidth;
        const flipY =
          top + TOOLTIP_OFFSET + el.offsetHeight > u.over.clientHeight;
        el.style.left = `${Math.max(0, Math.min(u.over.clientWidth - el.offsetWidth, flipX ? left - TOOLTIP_OFFSET - el.offsetWidth : left + TOOLTIP_OFFSET))}px`;
        el.style.top = `${Math.max(0, Math.min(u.over.clientHeight - el.offsetHeight, flipY ? top - TOOLTIP_OFFSET - el.offsetHeight : top + TOOLTIP_OFFSET))}px`;
      },
      destroy: () => {
        if (dismiss) document.removeEventListener("keydown", dismiss);
      },
    },
  };
}

export default function UPlotChart<S>(
  props: UPlotChartProps<S>,
): React.JSX.Element {
  const { ariaLabel, id, height, state, data, structureKey, syncKey } = props;
  const annotations = React.useContext(ChartAnnotationsContext);
  const viewport = React.useContext(ChartViewportContext);
  const rootRef = React.useRef<HTMLDivElement>(null);
  const plotRef = React.useRef<uPlot | null>(null);
  const drawnRef = React.useRef<uPlot.AlignedData | null>(null);
  const [width, setWidth] = React.useState(0);
  const [selectedPoint, setSelectedPoint] = React.useState<number | null>(null);
  const instructionsId = React.useId();
  const measuredWidthRef = React.useRef(0);
  const heightRef = React.useRef(height);
  heightRef.current = height;
  const number = React.useMemo(
    () => new Intl.NumberFormat(undefined, { maximumSignificantDigits: 4 }),
    [],
  );
  const formatSummaryValue =
    props.formatSummaryValue || ((value: number) => number.format(value));
  const seriesSummary = (props.summaryData || data)
    .slice(1)
    .map((series, index) => {
      // Charts can carry thousands of points and desktop renders several together. Derive the
      // accessible summary in one pass instead of allocating a filtered copy and spreading it
      // into Math.min/Math.max for every series.
      let first = 0;
      let latest = 0;
      let minimum = Number.POSITIVE_INFINITY;
      let maximum = Number.NEGATIVE_INFINITY;
      let found = false;
      for (let i = 0; i < series.length; i++) {
        const value = series[i];
        if (typeof value !== "number" || !isFinite(value)) {
          continue;
        }
        if (!found) {
          first = value;
          found = true;
        }
        latest = value;
        minimum = Math.min(minimum, value);
        maximum = Math.max(maximum, value);
      }
      if (!found) {
        minimum = 0;
        maximum = 0;
      }
      return {
        label: props.seriesLabels?.[index] || `Series ${index + 1}`,
        latest: formatSummaryValue(latest, index),
        minimum: formatSummaryValue(minimum, index),
        maximum: formatSummaryValue(maximum, index),
        trend: latest > first ? "up" : latest < first ? "down" : "flat",
      };
    });
  const accessibleLabel = `${ariaLabel}. ${seriesSummary
    .map(
      (series) =>
        `${series.label}: latest ${series.latest}, range ${series.minimum} to ${series.maximum}, trend ${series.trend}`,
    )
    .join(". ")}`;

  // Refs rather than deps: the plot is built once, and everything it calls back into wants the
  // newest render's values, not the ones that happened to be current when it was built.
  const stateRef = React.useRef(state);
  stateRef.current = state;
  const dataRef = React.useRef(data);
  dataRef.current = data;
  const buildRef = React.useRef(props.buildOptions);
  buildRef.current = props.buildOptions;
  const tooltipRef = React.useRef(props.tooltip);
  tooltipRef.current = props.tooltip;
  const annotationsRef = React.useRef(annotations);
  annotationsRef.current = annotations;
  const viewportRef = React.useRef(viewport);
  viewportRef.current = viewport;
  const viewportEnabled = !!viewport;

  // A plot's options are built once and then only fed data, so the colours in them are the
  // ones that were in force when it was built. Switching palette therefore has to rebuild --
  // which is what this version does, by changing below alongside width and structure
  const themeVersion = React.useSyncExternalStore(
    subscribeThemeMode,
    getThemeVersion,
    getThemeVersion,
  );
  const [fontReady, setFontReady] = React.useState(
    () => !document.fonts || document.fonts.check("14px Inter"),
  );
  React.useEffect(() => {
    if (fontReady || !document.fonts) return;
    let active = true;
    // Re-measure canvas labels if the local font arrives after the first plot.
    document.fonts
      .load("14px Inter")
      .then(() => {
        if (active) setFontReady(true);
      })
      .catch(() => {
        // A missing font keeps the readable system fallback and its measured plot.
      });
    return () => {
      active = false;
    };
  }, [fontReady]);

  React.useLayoutEffect(() => {
    const root = rootRef.current!;
    let resizeFrame: number | undefined;
    let settleTimer: ReturnType<typeof setTimeout> | undefined;
    let nextWidth = 0;

    const resizeExistingPlot = () => {
      resizeFrame = undefined;
      const plot = plotRef.current;
      if (!plot || nextWidth <= 0) {
        return;
      }
      plot.setSize({
        width: nextWidth,
        height: Math.max(
          1,
          Math.round((heightRef.current || 300) * chartScale(nextWidth)),
        ),
      });
    };

    const measure = () => {
      // Floor fractional flex widths so uPlot's explicit canvas width can never
      // round a pixel wider than the pane that owns it.
      nextWidth = Math.floor(root.getBoundingClientRect().width);
      if (nextWidth <= 0 || nextWidth === measuredWidthRef.current) {
        return;
      }
      measuredWidthRef.current = nextWidth;

      // There is no canvas to resize on first layout, so build it immediately. Once it exists,
      // coalesce ResizeObserver bursts into one cheap setSize per animation frame and reserve
      // the full options rebuild for the end of the resize gesture.
      if (!plotRef.current) {
        setWidth(nextWidth);
        return;
      }
      if (resizeFrame === undefined) {
        resizeFrame = requestAnimationFrame(resizeExistingPlot);
      }
      if (settleTimer) {
        clearTimeout(settleTimer);
      }
      settleTimer = setTimeout(
        () => setWidth(measuredWidthRef.current),
        RESIZE_SETTLE_MS,
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(root);
    return () => {
      observer.disconnect();
      if (resizeFrame !== undefined) {
        cancelAnimationFrame(resizeFrame);
      }
      if (settleTimer) {
        clearTimeout(settleTimer);
      }
    };
  }, []);

  React.useLayoutEffect(() => {
    // A width of zero means the pane has not been laid out yet (and, incidentally, that we are
    // in jsdom); the ResizeObserver above builds the plot as soon as there is somewhere to put
    // it. Every length in the options is derived from the width, so a resize rebuilds rather
    // than stretching -- which is what the SVG viewBox used to do for free.
    if (width <= 0) {
      return;
    }
    const getState = () => stateRef.current;
    const scale = chartScale(width);
    const built = buildRef.current({ getState, scale });
    const plot = new uPlot(
      {
        ...built,
        width,
        height: Math.max(1, Math.round((height || 300) * scale)),
        // Only x is synced: these charts plot watts against watt-hours against dollars, so
        // matching their y scales would line up numbers that have nothing to do with each other
        cursor: syncKey
          ? {
              ...built.cursor,
              sync: { key: syncKey, setSeries: false, scales: ["x", null] },
            }
          : built.cursor,
        plugins: [
          ...(built.plugins || []),
          eventMarkersPlugin(
            () => annotationsRef.current.events,
            () => annotationsRef.current.activeEventKey,
          ),
          tooltipPlugin(
            getState,
            () => tooltipRef.current,
            !!syncKey,
            !!props.interactiveTooltip,
          ),
        ],
      },
      dataRef.current,
      rootRef.current!,
    );
    plotRef.current = plot;
    drawnRef.current = dataRef.current;
    return () => {
      plot.destroy();
      plotRef.current = null;
      drawnRef.current = null;
    };
    // Data changes go through setData below; only size, shape and palette rebuild
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [width, height, structureKey, themeVersion, fontReady]);

  React.useLayoutEffect(() => {
    if (plotRef.current && drawnRef.current !== data) {
      plotRef.current.setData(data);
      drawnRef.current = data;
    }
  });

  React.useLayoutEffect(() => {
    if (plotRef.current && viewport) {
      plotRef.current.setScale("x", {
        min: viewport.range[0],
        max: viewport.range[1],
      });
    }
  }, [viewport, width, height, structureKey, themeVersion, fontReady]);

  React.useLayoutEffect(() => {
    const plot = plotRef.current;
    const currentViewport = viewportRef.current;
    if (!plot || !currentViewport) {
      return;
    }
    const over = plot.over;
    over.style.touchAction = "pan-y";
    let liveRange = currentViewport.range;
    let frame: number | undefined;
    let pending: ChartViewportRange | undefined;
    let wheelTimer: ReturnType<typeof setTimeout> | undefined;
    const pointers = new Map<number, { x: number; y: number }>();
    let drag:
      | { id: number; x: number; y: number; active: boolean; touch: boolean }
      | undefined;
    let pinchDistance: number | undefined;

    const schedule = (range: ChartViewportRange) => {
      liveRange = range;
      pending = range;
      if (frame === undefined) {
        frame = requestAnimationFrame(() => {
          frame = undefined;
          if (pending) {
            viewportRef.current?.onRangeChange(pending);
            pending = undefined;
          }
        });
      }
    };
    const commit = () => {
      if (frame !== undefined) {
        cancelAnimationFrame(frame);
        frame = undefined;
      }
      if (pending) {
        liveRange = pending;
        pending = undefined;
      }
      viewportRef.current?.onRangeChange(liveRange, true);
    };
    const point = (clientX: number) => {
      const rect = over.getBoundingClientRect();
      return Math.min(
        1,
        Math.max(0, (clientX - rect.left) / Math.max(1, rect.width)),
      );
    };
    const onWheel = (event: WheelEvent) => {
      const value = viewportRef.current;
      if (!value) return;
      if (!wheelTimer) liveRange = value.range;
      const horizontal =
        Math.abs(event.deltaX) > Math.abs(event.deltaY) || event.shiftKey;
      if (event.ctrlKey || event.metaKey) {
        event.preventDefault();
        const factor = Math.exp(Math.max(-1, Math.min(1, event.deltaY / 240)));
        schedule(
          zoomChartViewport(
            value.bounds,
            liveRange,
            value.minSpan,
            factor,
            point(event.clientX),
          ),
        );
      } else if (horizontal && !rangesEqual(value.bounds, liveRange)) {
        event.preventDefault();
        const delta = event.shiftKey ? event.deltaY : event.deltaX;
        schedule(
          panChartViewport(
            value.bounds,
            liveRange,
            value.minSpan,
            (delta / Math.max(1, over.clientWidth)) *
              (liveRange[1] - liveRange[0]),
          ),
        );
      } else {
        return;
      }
      if (wheelTimer) clearTimeout(wheelTimer);
      wheelTimer = setTimeout(() => {
        wheelTimer = undefined;
        commit();
      }, 160);
    };
    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 0) return;
      if (viewportRef.current) liveRange = viewportRef.current.range;
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (pointers.size >= 2) {
        const [a, b] = [...pointers.values()];
        pinchDistance = Math.hypot(a.x - b.x, a.y - b.y);
        drag = undefined;
        pointers.forEach((_pointer, id) => over.setPointerCapture?.(id));
        event.preventDefault();
        return;
      }
      drag = {
        id: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        active: event.pointerType !== "touch",
        touch: event.pointerType === "touch",
      };
      if (!drag.touch) over.setPointerCapture?.(event.pointerId);
    };
    const onPointerMove = (event: PointerEvent) => {
      if (pointers.has(event.pointerId)) {
        pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      }
      const value = viewportRef.current;
      if (!value) return;
      if (pinchDistance !== undefined && pointers.size >= 2) {
        const [a, b] = [...pointers.values()];
        const distance = Math.hypot(a.x - b.x, a.y - b.y);
        if (distance > 0) {
          event.preventDefault();
          schedule(
            zoomChartViewport(
              value.bounds,
              liveRange,
              value.minSpan,
              pinchDistance / distance,
              point((a.x + b.x) / 2),
            ),
          );
          pinchDistance = distance;
        }
        return;
      }
      if (!drag || drag.id !== event.pointerId) return;
      const deltaX = event.clientX - drag.x;
      const deltaY = event.clientY - drag.y;
      if (!drag.active) {
        if (Math.abs(deltaY) >= Math.abs(deltaX) || Math.abs(deltaX) < 8) {
          return;
        }
        drag.active = true;
        over.setPointerCapture?.(event.pointerId);
      }
      if (rangesEqual(value.bounds, liveRange)) return;
      event.preventDefault();
      drag.x = event.clientX;
      drag.y = event.clientY;
      schedule(
        panChartViewport(
          value.bounds,
          liveRange,
          value.minSpan,
          (-deltaX / Math.max(1, over.clientWidth)) *
            (liveRange[1] - liveRange[0]),
        ),
      );
    };
    const onPointerEnd = (event: PointerEvent) => {
      const interacted = pinchDistance !== undefined || !!drag?.active;
      pointers.delete(event.pointerId);
      if (pointers.size < 2) pinchDistance = undefined;
      if (drag?.id === event.pointerId) drag = undefined;
      if (over.hasPointerCapture?.(event.pointerId)) {
        over.releasePointerCapture(event.pointerId);
      }
      if (interacted) commit();
    };
    const onDoubleClick = (event: MouseEvent) => {
      event.preventDefault();
      viewportRef.current?.onReset(true);
    };

    over.addEventListener("wheel", onWheel, { passive: false });
    over.addEventListener("pointerdown", onPointerDown);
    over.addEventListener("pointermove", onPointerMove);
    over.addEventListener("pointerup", onPointerEnd);
    over.addEventListener("pointercancel", onPointerEnd);
    over.addEventListener("dblclick", onDoubleClick);
    return () => {
      over.style.touchAction = "";
      over.removeEventListener("wheel", onWheel);
      over.removeEventListener("pointerdown", onPointerDown);
      over.removeEventListener("pointermove", onPointerMove);
      over.removeEventListener("pointerup", onPointerEnd);
      over.removeEventListener("pointercancel", onPointerEnd);
      over.removeEventListener("dblclick", onDoubleClick);
      if (frame !== undefined) cancelAnimationFrame(frame);
      if (wheelTimer) clearTimeout(wheelTimer);
    };
  }, [width, height, structureKey, themeVersion, viewportEnabled, fontReady]);

  React.useLayoutEffect(() => {
    plotRef.current?.redraw();
  }, [annotations]);

  const selectPoint = (index: number) => {
    const plot = plotRef.current;
    if (!plot || !data[0].length) return;
    const point = Math.max(0, Math.min(data[0].length - 1, index));
    setSelectedPoint(point);
    plot.setCursor({ left: plot.valToPos(data[0][point], "x"), top: 0 });
  };
  const closeDetails = () => {
    setSelectedPoint(null);
    plotRef.current?.setCursor({ left: -10, top: -10 });
  };
  const detail =
    selectedPoint === null
      ? undefined
      : props.tooltip?.(Math.min(selectedPoint, data[0].length - 1), state);

  return (
    <div
      className="accessibleChart"
      onKeyDown={(event) => {
        if (
          props.interactiveTooltip &&
          event.key === "Escape" &&
          selectedPoint !== null
        ) {
          event.preventDefault();
          event.stopPropagation();
          closeDetails();
        }
      }}
    >
      {props.interactiveTooltip && (
        <span id={instructionsId} className="srOnly">
          Hover or press Enter to inspect a time. Use Left and Right arrows,
          Home and End to read points. Escape closes the tooltip.
        </span>
      )}
      <div
        id={id}
        ref={rootRef}
        role="img"
        aria-label={accessibleLabel}
        tabIndex={props.interactiveTooltip ? 0 : undefined}
        aria-describedby={props.interactiveTooltip ? instructionsId : undefined}
        onBlur={props.interactiveTooltip ? closeDetails : undefined}
        onKeyDown={
          props.interactiveTooltip
            ? (event) => {
                const current =
                  selectedPoint ?? plotRef.current?.cursor.idx ?? 0;
                const points: Record<string, number> = {
                  ArrowLeft: current - 1,
                  ArrowRight: current + 1,
                  Home: 0,
                  End: data[0].length - 1,
                  Enter: current,
                };
                if (event.key in points) {
                  event.preventDefault();
                  selectPoint(points[event.key]);
                }
              }
            : undefined
        }
        data-viewport-min={viewport?.range[0]}
        data-viewport-max={viewport?.range[1]}
        style={{
          width: "100%",
          minWidth: 0,
          maxWidth: "100%",
          overflow: "hidden",
        }}
      />
      {props.interactiveTooltip && (
        <span
          className="srOnly"
          role="status"
          aria-live="polite"
          aria-atomic="true"
        >
          {detail}
        </span>
      )}
    </div>
  );
}
