import { RefObject, useLayoutEffect, useState } from "react";
import { normalizeInterfaceScale } from "./InterfaceScale";
import { SIDE_TOOL_MIN_WIDTH } from "./Globals";
export { SIDE_TOOL_MIN_WIDTH } from "./Globals";
import type { SettingsType, WorkspaceType } from "./Types";

export const WORKSPACE_CHOICES = ["automatic", "single"] as const;
export const normalizeWorkspace = (value: unknown): WorkspaceType =>
  value === "single" ? "single" : "automatic";

/** A readable fleet and one readable tool must both fit before columns are useful. */
export const MIN_FLEET_WIDTH = 430;
const MIN_TOOL_WIDTH = 360;
const MAX_TOOL_WIDTH = 480;

/** Unscaled CSS measure; callers convert it once with the explicit interface scale. */
export function toolWidth(width: number): number {
  return Math.round(
    Math.min(MAX_TOOL_WIDTH, Math.max(MIN_TOOL_WIDTH, width * 0.28)),
  );
}

export function maxOpenTools(width: number): number {
  if (width < SIDE_TOOL_MIN_WIDTH) return 1;
  return Math.max(
    1,
    Math.min(5, Math.floor((width - MIN_FLEET_WIDTH) / toolWidth(width))),
  );
}

/** The available width is the measured frame content, after screen-edge padding. */
export function workspaceLayout(
  availableWidth: number,
  interfaceScale: unknown,
  preference: unknown,
) {
  const scale = normalizeInterfaceScale(interfaceScale);
  const effectiveWidth = availableWidth / scale;
  const layout =
    normalizeWorkspace(preference) === "single" ||
    effectiveWidth < SIDE_TOOL_MIN_WIDTH
      ? "single"
      : "side";
  return {
    layout,
    width: availableWidth,
    scale,
    effectiveWidth,
    capacity: layout === "single" ? 1 : maxOpenTools(effectiveWidth),
    toolWidth: toolWidth(effectiveWidth) * scale,
    minFleetWidth: MIN_FLEET_WIDTH * scale,
    constrained: layout === "single",
  } as const;
}

export type WorkspaceLayout = ReturnType<typeof workspaceLayout>;

/** Observe the workspace itself, so inset, native seat zoom and parent sizing are counted once. */
export function useWorkspaceLayout(
  ref: RefObject<HTMLElement>,
  settings?: SettingsType,
): WorkspaceLayout {
  const [width, setWidth] = useState(window.innerWidth);
  useLayoutEffect(() => {
    const element = ref.current;
    const measure = () =>
      setWidth(element?.getBoundingClientRect().width || window.innerWidth);
    measure();
    const observer =
      element && typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(measure)
        : undefined;
    if (element) observer?.observe(element);
    window.addEventListener("resize", measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [ref]);
  return workspaceLayout(width, settings?.interfaceScale, settings?.workspace);
}
