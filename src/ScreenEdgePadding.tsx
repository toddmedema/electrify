import { createContext, useContext } from "react";
import type { ScreenEdgePaddingType } from "./Types";

export const SCREEN_EDGE_PADDINGS = [0, 2, 4] as const;

export function normalizeScreenEdgePadding(
  value: unknown,
): ScreenEdgePaddingType {
  return SCREEN_EDGE_PADDINGS.find((padding) => padding === value) ?? 0;
}

/** Percentage of the shorter screen edge, independent of interface scale and workspace. */
export function screenEdgePaddingPixels(
  value: unknown,
  viewport: { width: number; height: number },
): number {
  return Math.ceil(
    (Math.min(viewport.width, viewport.height) *
      normalizeScreenEdgePadding(value)) /
      100,
  );
}

const ScreenEdgePaddingContext = createContext(0);
export const ScreenEdgePaddingProvider = ScreenEdgePaddingContext.Provider;

/** Portaled overlays use the same physical margin as the app frame. */
export function useScreenEdgeMargin(minimum = 8): number {
  return Math.max(minimum, useContext(ScreenEdgePaddingContext));
}
