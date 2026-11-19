/** Common choices; a stored preference may retain any value in this range. */
export const INTERFACE_SCALES = [1, 1.25, 1.5, 1.75, 2] as const;

export function normalizeInterfaceScale(value: unknown): number {
  return typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 1 &&
    value <= 2
    ? value
    : 1;
}

export const interfaceScaleLabel = (value: number) => `${value * 100}%`;

let scale = 1;
const listeners = new Set<() => void>();
export const getInterfaceScale = () => scale;
export const subscribeInterfaceScale = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

/** Rem-based UI and canvas charts share this explicit device multiplier. Native seat zoom is separate. */
export function applyInterfaceScale(value: unknown): void {
  const next = normalizeInterfaceScale(value);
  document.documentElement.dataset.interfaceScale = String(next);
  document.documentElement.style.fontSize = `${next * 100}%`;
  if (scale === next) return;
  scale = next;
  listeners.forEach((listener) => listener());
}
