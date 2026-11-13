import * as React from "react";
import { revealControl } from "./RevealControl";

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

interface FocusMemory {
  element: HTMLElement;
  id: string;
  label: string | null;
  text: string;
  tag: string;
}

/** Track intent for the memory owner's lifetime, including while Settings replaces the workspace. */
export function rememberToolInput(memory: () => Map<string, unknown>) {
  const keyboard = () => memory().set("focus.keyboard", true);
  const pointer = () => memory().set("focus.keyboard", false);
  document.addEventListener("keydown", keyboard, true);
  document.addEventListener("pointerdown", pointer, true);
  return () => {
    document.removeEventListener("keydown", keyboard, true);
    document.removeEventListener("pointerdown", pointer, true);
  };
}

/** Focus shares the workspace lifetime and scroll memory; no DOM nodes enter a game save. */
export function useToolFocusMemory(
  ref: React.RefObject<HTMLElement | null>,
  memory: Map<string, unknown>,
  active: string,
  layout?: string,
) {
  React.useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const remember = (event: FocusEvent) => {
      const element = event.target;
      if (
        !(element instanceof HTMLElement) ||
        element.matches("h1,h2,h3,h4,h5,h6")
      )
        return;
      const pane = element.closest<HTMLElement>("[data-game-tool],.gameFleet");
      if (!pane) return;
      const key = pane.dataset.gameTool ?? "fleet";
      memory.set(`focus.${key}`, {
        element,
        id: element.id,
        label: element.getAttribute("aria-label"),
        text: element.textContent ?? "",
        tag: element.tagName,
      } satisfies FocusMemory);
    };
    root.addEventListener("focusin", remember);
    return () => {
      root.removeEventListener("focusin", remember);
    };
  }, [memory, ref]);
  React.useEffect(() => {
    if (
      document.documentElement.dataset.controllerInput !== "true" &&
      !memory.get("focus.keyboard")
    )
      return;
    const saved = memory.get(`focus.${active}`) as FocusMemory | undefined;
    if (!saved && active !== "fleet") return;
    let frame: number | undefined;
    let cancelled = false;
    const cancel = () => {
      cancelled = true;
      if (frame !== undefined) cancelAnimationFrame(frame);
    };
    const restore = (attempt: number) => {
      if (cancelled) return;
      const focused = document.activeElement;
      // Closing a tool, chart shortcuts and native focus restoration choose explicit destinations.
      // Only replace an unfocused document or the workspace's initial tool heading.
      if (
        focused instanceof HTMLElement &&
        focused !== document.body &&
        !focused.matches("h1,h2,h3,h4,h5,h6") &&
        !focused.closest("[hidden],[inert],[aria-hidden=true]")
      )
        return;
      const root = ref.current?.querySelector<HTMLElement>(
        active === "fleet" ? ".gameFleet" : `[data-game-tool="${active}"]`,
      );
      const target =
        root && !root.hidden
          ? !saved
            ? root.querySelector<HTMLElement>(
                "button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),summary,a[href],[tabindex='0']",
              )
            : root.contains(saved.element)
              ? saved.element
              : Array.from(
                  root.querySelectorAll<HTMLElement>(
                    "button,input,select,textarea,summary,a[href],[tabindex]",
                  ),
                ).find((element) =>
                  saved.id
                    ? element.id === saved.id
                    : saved.label
                      ? element.getAttribute("aria-label") === saved.label
                      : element.tagName === saved.tag &&
                        element.textContent === saved.text,
                )
          : undefined;
      if (
        target &&
        !target.matches(":disabled,[aria-disabled=true]") &&
        !target.closest("[hidden],[inert],[aria-hidden=true]") &&
        getComputedStyle(target).visibility !== "hidden"
      ) {
        target.focus({ preventScroll: true });
        revealControl(target);
      } else if (attempt < RESTORE_FRAMES)
        frame = requestAnimationFrame(() => restore(attempt + 1));
    };
    frame = requestAnimationFrame(() => restore(0));
    document.addEventListener("keydown", cancel, true);
    document.addEventListener("pointerdown", cancel, true);
    return () => {
      cancel();
      document.removeEventListener("keydown", cancel, true);
      document.removeEventListener("pointerdown", cancel, true);
    };
  }, [active, layout, memory, ref]);
}
