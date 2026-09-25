import * as React from "react";

/**
 * Runs `callback` just after the browser paints the frame being committed now, and returns a
 * function that cancels it if it hasn't run yet.
 *
 * A requestAnimationFrame callback runs just before the next paint, so a zero timeout queued
 * from it runs just after. That keeps expensive work out of the frame that is on its way to the
 * screen, typically the month rollover's. requestIdleCallback is not used: Safari lacks it, and
 * at FAST the tick loop leaves little idle time, so it would mostly fire on its timeout anyway.
 * Where requestAnimationFrame is missing, a plain timeout stands in for it. A hidden tab doesn't
 * run animation frames, so the work waits until the page is visible again. The game pauses while
 * the page is hidden anyway.
 */
export function afterPaint(callback: () => void): () => void {
  let frame: number | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let cancelled = false;
  const queue = () => {
    timer = setTimeout(() => {
      timer = undefined;
      if (!cancelled) callback();
    }, 0);
  };
  if (typeof requestAnimationFrame === "function") {
    frame = requestAnimationFrame(() => {
      frame = undefined;
      if (!cancelled) queue();
    });
  } else {
    queue();
  }
  return () => {
    cancelled = true;
    if (frame !== undefined) cancelAnimationFrame(frame);
    if (timer !== undefined) clearTimeout(timer);
  };
}

/**
 * An expensive value that only changes when `key` does, such as a forecast keyed on the month
 * and the fleet. When the key changes, the value from the previous key stays on screen and the
 * new one is computed after paint (see afterPaint), so the frame that changed the key, usually
 * the month rollover, doesn't also pay for the simulation. The new value then lands in a commit
 * of its own. Ordinary ticks that leave the key alone cost a string comparison and no extra
 * commit.
 *
 * The deferred computation uses the `compute` from the first render that saw the new key. That
 * is the same inputs the synchronous version would have used, so the result is identical once it
 * lands. A newer key cancels work that hasn't started yet, and so does unmounting.
 *
 * With no previous value to show, which happens on mount or when an undefined `key` (disabled)
 * becomes defined, the value is computed synchronously in render. An empty section that fills in
 * a frame later would read as a glitch. Mounting is a player action such as opening a panel or
 * selecting a facility, not the rollover frame, and it paid this cost in render before.
 */
export function useAfterPaintValue<T>(
  key: string | undefined,
  compute: () => T,
): T | undefined {
  const cache = React.useRef<{ key: string; value: T }>();
  // Whether the last committed render showed a value. When it didn't, there's nothing stale to
  // keep on screen, so a changed key computes now rather than after paint.
  const showing = React.useRef(false);
  const [, landed] = React.useReducer((count: number) => count + 1, 0);

  if (
    key !== undefined &&
    (!cache.current || (!showing.current && cache.current.key !== key))
  ) {
    cache.current = { key, value: compute() };
  }
  const stale = key !== undefined && cache.current?.key !== key;

  React.useEffect(() => {
    showing.current = key !== undefined;
  });
  React.useEffect(() => {
    if (!stale || key === undefined) return undefined;
    return afterPaint(() => {
      cache.current = { key, value: compute() };
      landed();
    });
    // Deliberately keyed on the key alone: the closure from the first render that saw this key
    // holds exactly the inputs the synchronous computation would have used
  }, [key, stale]); // eslint-disable-line react-hooks/exhaustive-deps

  return key === undefined ? undefined : cache.current?.value;
}
