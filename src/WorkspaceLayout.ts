import { RefObject, useLayoutEffect, useState } from "react";
import { normalizeInterfaceScale } from "./InterfaceScale";
import { SIDE_TOOL_MIN_WIDTH } from "./Globals";
export { SIDE_TOOL_MIN_WIDTH } from "./Globals";

const MIN_TOOL_WIDTH = 360;
const MAX_TOOL_WIDTH = 480;

/** The available width is measured after screen-edge padding. */
export function workspaceLayout(
  availableWidth: number,
  interfaceScale: unknown,
) {
  const scale = normalizeInterfaceScale(interfaceScale);
  const effectiveWidth = availableWidth / scale;
  const toolWidth = Math.round(
    Math.min(MAX_TOOL_WIDTH, Math.max(MIN_TOOL_WIDTH, effectiveWidth * 0.28)),
  );
  return {
    scale,
    effectiveWidth,
    toolWidth: toolWidth * scale,
    constrained: effectiveWidth < SIDE_TOOL_MIN_WIDTH,
  };
}

export type WorkspaceLayout = ReturnType<typeof workspaceLayout>;

/** Observe the workspace itself, so inset, native seat zoom and parent sizing are counted once. */
export function useWorkspaceLayout(
  ref: RefObject<HTMLElement>,
  interfaceScale?: number,
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
  return workspaceLayout(width, interfaceScale);
}
