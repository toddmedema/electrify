import * as React from "react";
import { getStorageJson, setStorageKeyValue } from "../../LocalStorage";
import {
  getInterfaceScale,
  subscribeInterfaceScale,
} from "../../InterfaceScale";

/**
 * The desktop column layout: the panes side by side, with a splitter the player can drag
 * between each neighbouring pair.
 *
 * Facilities is a list of short rows while Insights is a chart workbench, so equal columns waste
 * room on one and cramp the other. Whatever the player drags them to is remembered.
 */

const WEIGHTS_KEY = "desktopPaneWeightsInsights";

// A layout is only meaningful for the number of panes it was dragged with, and the same window
// can be showing two of them (a laptop), three (a desktop) or four (an ultrawide) over an
// afternoon of resizing. Three keeps the original key, so an existing saved layout still loads
function weightsKey(count: number): string {
  return count === 3 ? WEIGHTS_KEY : `${WEIGHTS_KEY}${count}`;
}

// Facilities needs the least width, Insights the most, and the optional event log gets the rest.
const DEFAULT_WEIGHTS_BY_COUNT: Record<number, number[]> = {
  2: [1, 2],
  3: [1, 2, 0.8],
};

// A pane narrower than this stops being readable, so a drag can't push one past it
const MIN_PANE_PX = 240;

// How far one press of an arrow key moves a splitter
const KEYBOARD_STEP_PX = 24;

// Width of a splitter's own grid track. Set here rather than in CSS because it goes into the
// grid template alongside the pane weights, which are state
const SPLITTER_PX = 5;

function isUsableWeights(value: unknown, count: number): value is number[] {
  return (
    Array.isArray(value) &&
    value.length === count &&
    value.every((w) => typeof w === "number" && isFinite(w) && w > 0)
  );
}

function defaultWeights(count: number): number[] {
  return DEFAULT_WEIGHTS_BY_COUNT[count] || new Array(count).fill(1);
}

function loadWeights(count: number): number[] {
  const stored = getStorageJson<number[]>(weightsKey(count), []);
  // A layout saved when there were a different number of panes says nothing about this one
  return isUsableWeights(stored, count) ? stored : defaultWeights(count);
}

/**
 * Pixel widths back to weights. Only their ratios matter -- they go straight into a grid
 * template as `fr` -- so a layout saved at one window width means the same thing at another.
 */
function toWeights(widths: number[]): number[] {
  const total = widths.reduce((sum, w) => sum + w, 0);
  if (!(total > 0)) {
    return defaultWeights(widths.length);
  }
  return widths.map((w) => (w / total) * widths.length);
}

// Allocate by weight between readable minima and role-specific side-panel limits.
export function constrainedPaneWidths(
  weights: number[],
  total: number,
  scale = 1,
): number[] {
  const minimum = Math.min(MIN_PANE_PX * scale, total / weights.length);
  const maximum = weights.map((_, index) =>
    weights.length === 1
      ? Infinity
      : index === 0
        ? Math.max(minimum, 480 * scale)
        : weights.length === 3 && index === 2
          ? Math.max(minimum, 360 * scale)
          : Infinity,
  );
  // A shared multiplier preserves the requested ratios wherever no limit intervenes.
  // Solve the monotone sum rather than freezing small tracks prematurely: a capped fleet
  // can release space that an initially tiny Insights track then needs to absorb.
  const at = (multiplier: number) =>
    weights.map((weight, index) =>
      Math.max(minimum, Math.min(maximum[index], weight * multiplier)),
    );
  let low = 0;
  let high = total / Math.min(...weights);
  for (let iteration = 0; iteration < 64; iteration++) {
    const middle = (low + high) / 2;
    if (at(middle).reduce((sum, width) => sum + width, 0) < total) low = middle;
    else high = middle;
  }
  return at((low + high) / 2);
}

export interface Props {
  children: React.ReactNode;
}

export default function DesktopPanes(props: Props): React.JSX.Element {
  const scale = React.useSyncExternalStore(
    subscribeInterfaceScale,
    getInterfaceScale,
    getInterfaceScale,
  );
  const panes = React.Children.toArray(props.children);
  const containerRef = React.useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = React.useState(0);
  React.useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const measure = () =>
      setContainerWidth(container.getBoundingClientRect().width);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(container);
    return () => observer.disconnect();
  }, []);
  const [weights, setWeights] = React.useState(() => loadWeights(panes.length));
  // Where the drag started, and how wide every pane was at that moment -- the move handler works
  // from those rather than from the live widths, so rounding doesn't accumulate over a drag
  const dragRef = React.useRef<{
    index: number;
    startX: number;
    widths: number[];
  } | null>(null);
  // The layout as of the last resize, rather than as of the last render. Two arrow key repeats
  // can land before React has painted the first, and reading the DOM back then would have the
  // second start from where the first did -- so this is written to as soon as a resize is worked
  // out, and is what the next one measures from
  const weightsRef = React.useRef(weights);
  weightsRef.current = weights;

  // A window crossing the ultrawide breakpoint gains or loses a column under a mounted
  // component, and a grid template with the wrong number of tracks in it lays out nothing at
  // all. Reloading rather than reslicing, since each pane count has a layout of its own
  const paneCount = panes.length;
  React.useEffect(() => {
    setWeights((current: number[]) =>
      current.length === paneCount ? current : loadWeights(paneCount),
    );
  }, [paneCount]);

  // The room the panes have to share, split the way the weights currently say to
  const paneWidths = (): number[] => {
    const container = containerRef.current;
    if (!container) {
      return [];
    }
    const total = Array.from(
      container.querySelectorAll<HTMLElement>(":scope > .desktop-pane"),
    ).reduce((sum, el) => sum + el.getBoundingClientRect().width, 0);
    const current = weightsRef.current;
    const weighted = current.reduce((sum, w) => sum + w, 0);
    return weighted > 0 ? constrainedPaneWidths(current, total, scale) : [];
  };

  /**
   * Moves `delta` pixels of pane `index` onto the pane after it -- or the other way, for a
   * negative delta -- without letting either end up too narrow to read. Returns the new weights,
   * or undefined if it was handed widths it couldn't use.
   */
  const resize = (
    index: number,
    widths: number[],
    delta: number,
  ): number[] | undefined => {
    if (widths.length !== panes.length) {
      return undefined;
    }
    const pair = widths[index] + widths[index + 1];
    const minimum = Math.min(MIN_PANE_PX * scale, pair / 2);
    const first = Math.max(
      minimum,
      Math.min(pair - minimum, widths[index] + delta),
    );
    const next = [...widths];
    next[index] = first;
    next[index + 1] = pair - first;
    const resized = toWeights(
      constrainedPaneWidths(
        next,
        next.reduce((sum, width) => sum + width, 0),
        scale,
      ),
    );
    weightsRef.current = resized;
    setWeights(resized);
    return resized;
  };

  const onPointerDown =
    (index: number) => (e: React.PointerEvent<HTMLDivElement>) => {
      dragRef.current = { index, startX: e.clientX, widths: paneWidths() };
      e.currentTarget.setPointerCapture(e.pointerId);
      // Otherwise the drag selects the pane text it passes over
      e.preventDefault();
    };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag) {
      return;
    }
    resize(drag.index, drag.widths, e.clientX - drag.startX);
  };

  const endDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) {
      return;
    }
    dragRef.current = null;
    e.currentTarget.releasePointerCapture(e.pointerId);
    setStorageKeyValue(weightsKey(panes.length), weightsRef.current);
  };

  const onKeyDown =
    (index: number) => (e: React.KeyboardEvent<HTMLDivElement>) => {
      const step =
        e.key === "ArrowLeft"
          ? -KEYBOARD_STEP_PX
          : e.key === "ArrowRight"
            ? KEYBOARD_STEP_PX
            : 0;
      if (!step) {
        return;
      }
      e.preventDefault();
      const resized = resize(index, paneWidths(), step);
      if (resized) {
        setStorageKeyValue(weightsKey(panes.length), resized);
      }
    };

  // Double-clicking a divider is the usual way back to the layout you started with
  const onDoubleClick = () => {
    const reset = defaultWeights(panes.length);
    weightsRef.current = reset;
    setWeights(reset);
    setStorageKeyValue(weightsKey(panes.length), reset);
  };

  // Splitters are grid tracks of their own rather than borders on the panes, so dragging one
  // never changes the total width the panes have to share
  const requested =
    weights.length === panes.length ? weights : loadWeights(panes.length);
  const sized =
    containerWidth > 0
      ? constrainedPaneWidths(
          requested,
          Math.max(0, containerWidth - SPLITTER_PX * (panes.length - 1)),
          scale,
        )
      : requested;
  const totalWeight = sized.reduce((sum, weight) => sum + weight, 0);
  const template = sized
    .map((w) => `minmax(0, ${w}fr)`)
    .join(` ${SPLITTER_PX}px `);

  // The status header is a sibling of this grid. Share the first track's exact weighted
  // width, including splitter space, so it follows dragging, saved layouts and resizing.
  const firstFraction = sized[0] / totalWeight;
  const firstTrackWidth = `calc(${firstFraction * 100}% - ${SPLITTER_PX * (sized.length - 1) * firstFraction}px)`;
  React.useLayoutEffect(() => {
    const layout = containerRef.current?.parentElement;
    if (!layout) return;
    layout.style.setProperty("--facilities-pane-width", firstTrackWidth);
    return () => {
      layout.style.removeProperty("--facilities-pane-width");
    };
  }, [firstTrackWidth]);

  return (
    <div
      className="desktop-panes"
      ref={containerRef}
      style={{ gridTemplateColumns: template }}
    >
      {panes.map((pane, i) => (
        <React.Fragment key={i}>
          {i > 0 && (
            <div className="pane-splitter">
              <div
                className="pane-splitter-handle"
                role="separator"
                aria-orientation="vertical"
                aria-label={`Resize pane ${i} and pane ${i + 1}`}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(
                  (sized.slice(0, i).reduce((sum, weight) => sum + weight, 0) /
                    totalWeight) *
                    100,
                )}
                tabIndex={0}
                onPointerDown={onPointerDown(i - 1)}
                onPointerMove={onPointerMove}
                onPointerUp={endDrag}
                onPointerCancel={endDrag}
                onKeyDown={onKeyDown(i - 1)}
                onDoubleClick={onDoubleClick}
              />
            </div>
          )}
          <div className="desktop-pane">{pane}</div>
        </React.Fragment>
      ))}
    </div>
  );
}
