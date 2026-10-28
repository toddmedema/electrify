import * as React from "react";

// View preferences belong to this workspace, not to saves or simulation state.
// Unmounted tools release workers and decision pauses without losing their place.
export const GameToolMemoryContext = React.createContext<
  Map<string, unknown> | undefined
>(undefined);

export function useToolState<T>(
  key: string | undefined,
  initial: T | (() => T),
) {
  const memory = React.useContext(GameToolMemoryContext);
  const state = React.useState<T>(() =>
    key && memory?.has(key)
      ? (memory.get(key) as T)
      : typeof initial === "function"
        ? (initial as () => T)()
        : initial,
  );
  const [value] = state;
  React.useLayoutEffect(() => {
    if (key) memory?.set(key, value);
  }, [key, memory, value]);
  return state;
}

// About two seconds at 60fps: long enough for a sheet to lay out and a forecast to arrive.
const RESTORE_FRAMES = 120;

/**
 * Keeps an element's scroll position in the workspace memory, so a tool closed and reopened (or
 * moved between a sheet and a side column) comes back where the player left it. A pane that
 * mounts before its sheet is laid out, or first renders a placeholder, restores once it is tall
 * enough to hold the position, unless the player starts scrolling first.
 */
export function useRememberedScroll(
  ref: React.RefObject<HTMLElement | null>,
  key: string,
) {
  const shared = React.useContext(GameToolMemoryContext);
  const local = React.useRef(new Map<string, unknown>());
  const memory = shared ?? local.current;
  const tracked = React.useRef<{ element: HTMLElement; key: string }>();
  const pending = React.useRef<number>();
  const frame = React.useRef<number>();
  React.useEffect(
    () => () => {
      if (frame.current !== undefined) cancelAnimationFrame(frame.current);
      frame.current = undefined;
    },
    [],
  );
  // Runs after every render: the scroll element can be swapped out, and content can grow.
  React.useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    if (tracked.current?.element !== element || tracked.current.key !== key) {
      tracked.current = { element, key };
      pending.current = (memory.get(key) as number | undefined) ?? 0;
    }
    const restore = (attempt: number) => {
      frame.current = undefined;
      const target = pending.current;
      if (target === undefined || tracked.current?.element !== element) return;
      // A browser clamps the position to what the content can hold so far; keep trying.
      element.scrollTop = target;
      if (Math.abs(element.scrollTop - target) < 1) {
        pending.current = undefined;
      } else if (attempt < RESTORE_FRAMES) {
        frame.current = requestAnimationFrame(() => restore(attempt + 1));
      }
    };
    if (frame.current === undefined) restore(0);
  });
  React.useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    // The player taking over cancels a restore that is still waiting for content.
    const takeOver = () => (pending.current = undefined);
    // While a restore is pending, clamped positions are ours, not the player's.
    const remember = () => {
      if (pending.current === undefined) memory.set(key, element.scrollTop);
    };
    const intents = ["wheel", "touchstart", "pointerdown", "keydown"] as const;
    intents.forEach((type) =>
      element.addEventListener(type, takeOver, { passive: true }),
    );
    element.addEventListener("scroll", remember);
    // Clicking can scroll a target into view before its asynchronous scroll event arrives.
    // Capture the position before the target's handler changes this element's contents/key.
    element.addEventListener("click", remember, true);
    return () => {
      intents.forEach((type) => element.removeEventListener(type, takeOver));
      element.removeEventListener("scroll", remember);
      element.removeEventListener("click", remember, true);
    };
  });
}

export function useToolScroll<T extends HTMLElement>(key: string) {
  const ref = React.useRef<T>(null);
  useRememberedScroll(ref, key);
  return ref;
}

/**
 * The same memory for a class component or an element that already has a ref. Render it after
 * the scroll element (not inside it), so the element's ref is attached when this restores.
 */
export function ToolScrollMemory(props: {
  scrollRef: React.RefObject<HTMLElement | null>;
  id: string;
}): null {
  useRememberedScroll(props.scrollRef, props.id);
  return null;
}
