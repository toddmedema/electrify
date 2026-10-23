import type { TextSizeType } from "./Types";

export const TEXT_SIZES: readonly TextSizeType[] = [
  "standard",
  "large",
  "larger",
];
export const TEXT_SIZE_LABELS: Record<TextSizeType, string> = {
  standard: "Standard",
  large: "Large",
  larger: "Larger",
};
const scales: Record<TextSizeType, number> = {
  standard: 1,
  large: 1.125,
  larger: 1.25,
};

export function normalizeTextSize(value: unknown): TextSizeType {
  return TEXT_SIZES.find((size) => size === value) ?? "standard";
}

let scale = 1;
const listeners = new Set<() => void>();
export const getTextScale = () => scale;
export const subscribeTextSize = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

/** Scale type and its chart space without changing the viewport or device resolution. */
export function applyTextSize(value: unknown): void {
  const size = normalizeTextSize(value);
  document.documentElement.dataset.textSize = size;
  document.documentElement.style.fontSize = `${scales[size] * 100}%`;
  if (scale === scales[size]) return;
  scale = scales[size];
  listeners.forEach((listener) => listener());
}
