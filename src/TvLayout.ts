import { isDesktopApp } from "./Desktop";
import type { SettingsType } from "./Types";
import { useSyncExternalStore } from "react";
import { subscribeInterfaceScale } from "./InterfaceScale";

export const TV_SCALES = [1.5, 1.75, 2] as const;
export const TV_INSETS = [0, 2, 4] as const;
export const normalizeTvScale = (value: unknown): number =>
  TV_SCALES.find((scale) => scale === value) ?? 1.5;
export const normalizeTvInset = (value: unknown): number =>
  TV_INSETS.find((inset) => inset === value) ?? 2;

export function tvLayoutEnabled(settings?: SettingsType): boolean {
  return (
    process.env.REACT_APP_DESKTOP === "true" &&
    isDesktopApp() &&
    settings?.tvMode === true
  );
}

/** Read the applied presentation, including in components rendered without Redux wiring. */
export const isTvLayout = () =>
  document.documentElement.dataset.tvLayout === "true";
export function useTvLayout(): boolean {
  return useSyncExternalStore(subscribeInterfaceScale, isTvLayout, () => false);
}
