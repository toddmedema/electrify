import * as React from "react";
import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";
import { DESIGN_WIDTH } from "./UPlotHelpers";

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
}

const TOOLTIP_OFFSET = 8;

function tooltipPlugin<S>(
  getState: () => S,
  getLabel: () => ((idx: number, state: S) => string) | undefined,
): uPlot.Plugin {
  let el: HTMLDivElement | null = null;
  return {
    hooks: {
      init: (u: uPlot) => {
        el = document.createElement("div");
        el.className = "chartTooltip";
        u.over.appendChild(el);
      },
      setCursor: (u: uPlot) => {
        const label = getLabel();
        const idx = u.cursor.idx;
        if (!el || !label || idx == null) {
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
  const { ariaLabel, id, height, state, data, structureKey } = props;
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

  React.useLayoutEffect(() => {
    const root = rootRef.current!;
    const measure = () => setWidth(root.clientWidth);
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
    const scale = width / DESIGN_WIDTH;
    const built = buildRef.current({ getState, scale });
    const plot = new uPlot(
      {
        ...built,
        width,
        height: Math.max(1, Math.round((height || 300) * scale)),
        plugins: [
          ...(built.plugins || []),
          tooltipPlugin(getState, () => tooltipRef.current),
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
    // Data changes go through setData below; only size and shape rebuild
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [width, height, structureKey]);

  React.useLayoutEffect(() => {
    if (plotRef.current && drawnRef.current !== data) {
      plotRef.current.setData(data);
      drawnRef.current = data;
    }
  });

  return <div id={id} ref={rootRef} role="img" aria-label={ariaLabel} />;
}
