import * as React from "react";
import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";
import { chartScale } from "./UPlotHelpers";
import { getThemeVersion, subscribeThemeMode } from "../../Theme";

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
  /** Called once per plot. Width and height are filled in by this component. */
  buildOptions: (ctx: BuildContext<S>) => uPlot.Options;
  /** Change to force a rebuild, eg when the number of series changes */
  structureKey?: string | number;
  /** One tooltip covering every series at the hovered x */
  tooltip?: (idx: number, state: S) => string;
  /**
   * Charts sharing this key share a cursor: hovering one puts a crosshair at the same x on all
   * of them. Only for charts drawn against the same x scale, one above another. Numbers stay
   * with the pointer -- five tooltips at once would cover the data they are about.
   */
  syncKey?: string;
}

const TOOLTIP_OFFSET = 8;

function tooltipPlugin<S>(
  getState: () => S,
  getLabel: () => ((idx: number, state: S) => string) | undefined,
  hoverOnly: boolean,
): uPlot.Plugin {
  let el: HTMLDivElement | null = null;
  // A synced chart moves its cursor when a neighbour is hovered, which is the point -- but it
  // should not also open a tooltip over data the pointer isn't anywhere near
  let hovering = !hoverOnly;
  return {
    hooks: {
      init: (u: uPlot) => {
        el = document.createElement("div");
        el.className = "chartTooltip";
        u.over.appendChild(el);
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
        el.textContent = label(idx, getState());
        el.style.display = "block";
        // Kept inside the plot, the way Victory's constrainToVisibleArea tooltip was
        const left = u.cursor.left!;
        const top = u.cursor.top!;
        const flipX =
          left + TOOLTIP_OFFSET + el.offsetWidth > u.over.clientWidth;
        const flipY =
          top + TOOLTIP_OFFSET + el.offsetHeight > u.over.clientHeight;
        el.style.left = `${flipX ? left - TOOLTIP_OFFSET - el.offsetWidth : left + TOOLTIP_OFFSET}px`;
        el.style.top = `${flipY ? top - TOOLTIP_OFFSET - el.offsetHeight : top + TOOLTIP_OFFSET}px`;
      },
    },
  };
}

export default function UPlotChart<S>(
  props: UPlotChartProps<S>,
): React.JSX.Element {
  const { ariaLabel, id, height, state, data, structureKey, syncKey } = props;
  const rootRef = React.useRef<HTMLDivElement>(null);
  const plotRef = React.useRef<uPlot | null>(null);
  const drawnRef = React.useRef<uPlot.AlignedData | null>(null);
  const [width, setWidth] = React.useState(0);

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

  // A plot's options are built once and then only fed data, so the colours in them are the
  // ones that were in force when it was built. Switching palette therefore has to rebuild --
  // which is what this version does, by changing below alongside width and structure
  const themeVersion = React.useSyncExternalStore(
    subscribeThemeMode,
    getThemeVersion,
    getThemeVersion,
  );

  React.useLayoutEffect(() => {
    const root = rootRef.current!;
    const measure = () => {
      // Floor fractional flex widths so uPlot's explicit canvas width can never
      // round a pixel wider than the pane that owns it.
      const nextWidth = Math.floor(root.getBoundingClientRect().width);
      setWidth((currentWidth) =>
        currentWidth === nextWidth ? currentWidth : nextWidth,
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(root);
    return () => observer.disconnect();
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
          tooltipPlugin(getState, () => tooltipRef.current, !!syncKey),
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
  }, [width, height, structureKey, themeVersion]);

  React.useLayoutEffect(() => {
    if (plotRef.current && drawnRef.current !== data) {
      plotRef.current.setData(data);
      drawnRef.current = data;
    }
  });

  return (
    <div
      id={id}
      ref={rootRef}
      role="img"
      aria-label={ariaLabel}
      style={{
        width: "100%",
        minWidth: 0,
        maxWidth: "100%",
        overflow: "hidden",
      }}
    />
  );
}
