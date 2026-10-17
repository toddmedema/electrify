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

export function useToolScroll<T extends HTMLElement>(key: string) {
  const shared = React.useContext(GameToolMemoryContext);
  const local = React.useRef(new Map<string, unknown>());
  const memory = shared ?? local.current;
  const ref = React.useRef<T>(null);
  React.useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    element.scrollTop = (memory.get(key) as number | undefined) ?? 0;
    const remember = () => memory.set(key, element.scrollTop);
    element.addEventListener("scroll", remember);
    return () => {
      element.removeEventListener("scroll", remember);
    };
  }, [key, memory]);
  return ref;
}
