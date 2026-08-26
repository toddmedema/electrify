import * as React from "react";
import { getStorageJson, setStorageKeyValue } from "../../LocalStorage";

/**
 * The desktop column layout: the panes side by side, with a splitter the player can drag
 * between each neighbouring pair.
 *
 * The three panes want different amounts of room -- Facilities is a list of short rows, Finances
 * is a two-column table of text, Forecasts is a stack of charts -- so equal thirds waste the
 * screen on one and cramp the others. Below are the starting weights; whatever the player drags
 * them to is remembered, since a column layout is the sort of thing people set once.
 */

const WEIGHTS_KEY = "desktopPaneWeights";

// Facilities needs the least width, Finances and Forecasts the most
const DEFAULT_WEIGHTS = [1, 1.15, 1.15];

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
  return DEFAULT_WEIGHTS.slice(0, count);
}

function loadWeights(count: number): number[] {
  const stored = getStorageJson<number[]>(WEIGHTS_KEY, []);
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

export interface Props {
  children: React.ReactNode;
}

export default function DesktopPanes(props: Props): React.JSX.Element {
  const panes = React.Children.toArray(props.children);
  const containerRef = React.useRef<HTMLDivElement>(null);
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
    return weighted > 0 ? current.map((w) => (w / weighted) * total) : [];
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
    const first = Math.max(
      MIN_PANE_PX,
      Math.min(pair - MIN_PANE_PX, widths[index] + delta),
    );
    const next = [...widths];
    next[index] = first;
    next[index + 1] = pair - first;
    const resized = toWeights(next);
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
    setStorageKeyValue(WEIGHTS_KEY, weightsRef.current);
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
        setStorageKeyValue(WEIGHTS_KEY, resized);
      }
    };

  // Double-clicking a divider is the usual way back to the layout you started with
  const onDoubleClick = () => {
    const reset = defaultWeights(panes.length);
    weightsRef.current = reset;
    setWeights(reset);
    setStorageKeyValue(WEIGHTS_KEY, reset);
  };

  // Splitters are grid tracks of their own rather than borders on the panes, so dragging one
  // never changes the total width the panes have to share
  const template = weights.map((w) => `${w}fr`).join(` ${SPLITTER_PX}px `);

  return (
    <div
      className="desktop-panes"
      ref={containerRef}
      style={{ gridTemplateColumns: template }}
    >
      {panes.map((pane, i) => (
        <React.Fragment key={i}>
          {i > 0 && (
            <div
              className="pane-splitter"
              role="separator"
              aria-orientation="vertical"
              aria-label={`Resize pane ${i} and pane ${i + 1}`}
              tabIndex={0}
              onPointerDown={onPointerDown(i - 1)}
              onPointerMove={onPointerMove}
              onPointerUp={endDrag}
              onPointerCancel={endDrag}
              onKeyDown={onKeyDown(i - 1)}
              onDoubleClick={onDoubleClick}
            />
          )}
          <div className="desktop-pane">{pane}</div>
        </React.Fragment>
      ))}
    </div>
  );
}
