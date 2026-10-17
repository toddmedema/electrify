import * as React from "react";

/** How far a toast has to travel before letting go of it dismisses it. */
export const SWIPE_DISMISS_DISTANCE = 56;
export const SWIPE_DISMISS_EXIT_MS = 180;

type Point = { x: number; y: number };

/** A toast follows the dominant axis of a drag: sideways either way, or down only. */
export function swipeOffset(
  start: Point,
  end: Point,
): { axis: "x" | "y"; distance: number } {
  const x = end.x - start.x;
  const y = Math.max(0, end.y - start.y);
  return Math.abs(x) > y
    ? { axis: "x", distance: x }
    : { axis: "y", distance: y };
}

export function shouldDismissSwipe(start: Point, end: Point): boolean {
  return (
    Math.abs(end.x - start.x) >= SWIPE_DISMISS_DISTANCE ||
    end.y - start.y >= SWIPE_DISMISS_DISTANCE
  );
}

/** Follow the finger directly; the release animates the snap back or the fly-out. */
export function followSwipe(element: HTMLElement, start: Point, end: Point) {
  const { axis, distance } = swipeOffset(start, end);
  element.style.transition = "none";
  element.style.transform =
    axis === "x" ? `translateX(${distance}px)` : `translateY(${distance}px)`;
  element.style.opacity = String(
    1 - Math.min(0.6, Math.abs(distance) / (SWIPE_DISMISS_DISTANCE * 4)),
  );
}

/**
 * Carry on in the swipe's direction and fade. A toast's own exit transition (a shrink toward its
 * anchor) only starts once it is already invisible, so the player sees one continuous slide
 * rather than a slide that turns into a shrink.
 */
export function flingSwipe(element: HTMLElement, start: Point, end: Point) {
  const { axis, distance } = swipeOffset(start, end);
  element.style.transition = `transform ${SWIPE_DISMISS_EXIT_MS}ms ease-out, opacity ${SWIPE_DISMISS_EXIT_MS}ms ease-out`;
  element.style.transform =
    axis === "x"
      ? `translateX(${Math.sign(distance) * window.innerWidth}px)`
      : `translateY(${element.offsetHeight + 96}px)`;
  element.style.opacity = "0";
}

export function resetSwipe(element: HTMLElement | null) {
  if (!element) return;
  element.style.transition = "";
  element.style.transform = "";
  element.style.opacity = "";
}

/**
 * Swipe-to-dismiss for a toast in a function component; Compositor's class keeps the same
 * behaviour with these helpers. Presses that start on a button stay clicks: capturing the
 * pointer would retarget the button's pointerup to the toast, so its click would never fire.
 */
export function useSwipeToDismiss<T extends HTMLElement>(
  ref: React.RefObject<T | null>,
  onDismiss: () => void,
) {
  const drag = React.useRef<Point & { pointerId: number }>();
  const exit = React.useRef<ReturnType<typeof setTimeout>>();
  const dismiss = React.useRef(onDismiss);
  dismiss.current = onDismiss;
  React.useEffect(() => () => clearTimeout(exit.current), []);
  const reset = React.useCallback(() => {
    clearTimeout(exit.current);
    exit.current = undefined;
    drag.current = undefined;
    resetSwipe(ref.current);
  }, [ref]);
  const handlers = React.useMemo(
    () => ({
      onPointerDown: (event: React.PointerEvent<T>) => {
        if (
          event.button !== 0 ||
          exit.current !== undefined ||
          (event.target as HTMLElement).closest("button, a")
        )
          return;
        drag.current = {
          x: event.clientX,
          y: event.clientY,
          pointerId: event.pointerId,
        };
        event.currentTarget.setPointerCapture?.(event.pointerId);
      },
      onPointerMove: (event: React.PointerEvent<T>) => {
        const start = drag.current;
        if (!start || start.pointerId !== event.pointerId) return;
        followSwipe(event.currentTarget, start, {
          x: event.clientX,
          y: event.clientY,
        });
      },
      onPointerUp: (event: React.PointerEvent<T>) => {
        const start = drag.current;
        const end = { x: event.clientX, y: event.clientY };
        if (
          start &&
          start.pointerId === event.pointerId &&
          shouldDismissSwipe(start, end)
        ) {
          drag.current = undefined;
          flingSwipe(event.currentTarget, start, end);
          exit.current = setTimeout(() => {
            exit.current = undefined;
            dismiss.current();
          }, SWIPE_DISMISS_EXIT_MS);
          return;
        }
        drag.current = undefined;
        resetSwipe(event.currentTarget);
      },
      onPointerCancel: (event: React.PointerEvent<T>) => {
        drag.current = undefined;
        resetSwipe(event.currentTarget);
      },
    }),
    [],
  );
  return { handlers, reset };
}
