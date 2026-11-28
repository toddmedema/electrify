import * as React from "react";
import { IconButton } from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import ChevronLeftIcon from "@mui/icons-material/ChevronLeft";
import { getStorageJson, setStorageKeyValue } from "../../LocalStorage";
import { useToolScroll, useToolState } from "./GameToolMemory";
import { MapWindowFrontContext } from "./GameWorkspaceContext";
import ConceptIcon from "./ConceptIcon";
import { hasVisibleEscapeOverlay } from "./VisibleEscapeOverlay";

type Size = { width: number; height: number };
type MapWindowLayout = {
  area: Size;
  defaultWidth: number;
  scale: number;
  slot: number;
};
type Rect = Size & { x: number; y: number };
const RESIZE_EDGES = ["n", "ne", "e", "se", "s", "sw", "w", "nw"] as const;
type Operation = "move" | (typeof RESIZE_EDGES)[number];
type Gesture = {
  operation: Operation;
  pointerId: number;
  x: number;
  y: number;
  start: Rect;
  latest?: Rect;
};

export function useMapWindowArea(ref: React.RefObject<HTMLElement>) {
  const [size, setSize] = React.useState<Size>({ width: 0, height: 0 });
  React.useLayoutEffect(() => {
    const area = ref.current;
    if (!area) return;
    const measure = () => {
      const { clientWidth: width, clientHeight: height } = area;
      setSize((previous) =>
        previous.width === width && previous.height === height
          ? previous
          : { width, height },
      );
    };
    measure();
    const observer =
      typeof ResizeObserver === "undefined"
        ? undefined
        : new ResizeObserver(measure);
    observer?.observe(area);
    window.addEventListener("resize", measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [ref]);
  return size;
}

function readRect(key: string): Rect | undefined {
  const value = getStorageJson<Rect>(key, { x: 0, y: 0, width: 0, height: 0 });
  if (
    [value.x, value.y, value.width, value.height].every(Number.isFinite) &&
    value.width > 0 &&
    value.height > 0
  )
    return value;
}

const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(value, max));

function fit(rect: Rect, area: Size, minimum: Size): Rect {
  const width = clamp(rect.width, minimum.width, area.width);
  const height = clamp(rect.height, minimum.height, area.height);
  return {
    width,
    height,
    x: clamp(rect.x, 0, area.width - width),
    y: clamp(rect.y, 0, area.height - height),
  };
}

function adjust(
  start: Rect,
  dx: number,
  dy: number,
  operation: Operation,
  area: Size,
  minimum: Size,
): Rect {
  if (operation === "move")
    return fit({ ...start, x: start.x + dx, y: start.y + dy }, area, minimum);

  const right = start.x + start.width;
  const bottom = start.y + start.height;
  const x = operation.includes("w")
    ? clamp(start.x + dx, 0, right - minimum.width)
    : start.x;
  const y = operation.includes("n")
    ? clamp(start.y + dy, 0, bottom - minimum.height)
    : start.y;
  const endX = operation.includes("e")
    ? clamp(right + dx, start.x + minimum.width, area.width)
    : right;
  const endY = operation.includes("s")
    ? clamp(bottom + dy, start.y + minimum.height, area.height)
    : bottom;

  return { x, y, width: endX - x, height: endY - y };
}

const ARROW_KEYS = ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"];
const WINDOW_SHORTCUTS = [
  ...ARROW_KEYS,
  ...ARROW_KEYS.map((key) => `Shift+${key}`),
].join(" ");

export default function MapPanelWindow({
  tool,
  label,
  icon,
  stackingIndex = 0,
  front = true,
  floating,
  onRaise,
  onClose,
  onBack,
  project,
  children,
}: {
  tool: string;
  label: string;
  icon: React.ReactNode;
  stackingIndex?: number;
  front?: boolean;
  floating?: MapWindowLayout;
  onRaise?: (toClose: boolean) => void;
  onClose: () => void;
  onBack?: () => void;
  project?: { catalogue: boolean; focusKey: React.Key };
  children: React.ReactNode;
}) {
  const storageKey = `electrify.mapWindow.${tool}`;
  const [preferred, setPreferred] = useToolState(storageKey, () =>
    readRect(storageKey),
  );
  const [draft, setDraft] = React.useState<Rect>();
  const gesture = React.useRef<Gesture>();
  const title = React.useRef<HTMLHeadingElement>(null);
  const closeButton = React.useRef<HTMLButtonElement>(null);
  const titleId = React.useId();
  const projectFocus = project?.focusKey;
  React.useLayoutEffect(() => {
    if (projectFocus !== undefined)
      title.current?.focus({ preventScroll: true });
  }, [projectFocus]);
  const body = useToolScroll<HTMLDivElement>(`workspace.${tool}.scroll`);
  const area = floating?.area;
  const scale = floating?.scale ?? 1;
  const minimum = {
    width: Math.min(320 * scale, area?.width ?? 0),
    height: Math.min(240 * scale, area?.height ?? 0),
  };
  const rect =
    floating && area && area.width > 0 && area.height > 0
      ? fit(
          draft ??
            preferred ?? {
              x:
                area.width -
                floating.defaultWidth -
                (36 + floating.slot * 20) * scale,
              y: floating.slot * 24 * scale,
              width: floating.defaultWidth,
              height: Math.round(area.height * 0.78),
            },
          area,
          minimum,
        )
      : undefined;

  const remember = (next: Rect, start: Rect) => {
    if (
      !area ||
      (next.x === start.x &&
        next.y === start.y &&
        next.width === start.width &&
        next.height === start.height)
    )
      return;
    // A smaller viewport can temporarily clamp the saved rectangle. Keep any
    // fields the player did not adjust so the larger layout can restore them.
    const previous = preferred ?? start;
    const saved = {
      x: next.x === start.x ? previous.x : next.x,
      y: next.y === start.y ? previous.y : next.y,
      width: next.width === start.width ? previous.width : next.width,
      height: next.height === start.height ? previous.height : next.height,
    };
    const fitted = fit(saved, area, minimum);
    // Resizing can create space for a previously clamped position. Keep the
    // visible corner anchored if that saved position would make the window jump.
    if (fitted.x !== next.x) saved.x = next.x;
    if (fitted.y !== next.y) saved.y = next.y;
    setPreferred(saved);
    setStorageKeyValue(storageKey, saved);
  };
  const begin = (
    event: React.PointerEvent<HTMLElement>,
    operation: Operation,
  ) => {
    if (!rect || !event.isPrimary || event.button !== 0 || gesture.current)
      return;
    if (operation === "move" && (event.target as Element).closest("button"))
      return;
    event.preventDefault();
    title.current?.focus({ preventScroll: true });
    event.currentTarget.setPointerCapture(event.pointerId);
    gesture.current = {
      operation,
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      start: rect,
    };
  };
  const update = (event: React.PointerEvent<HTMLElement>) => {
    const active = gesture.current;
    if (!area || active?.pointerId !== event.pointerId) return;
    const dx = event.clientX - active.x;
    const dy = event.clientY - active.y;
    if (!active.latest && !dx && !dy) return;
    active.latest = adjust(
      fit(active.start, area, minimum),
      dx,
      dy,
      active.operation,
      area,
      minimum,
    );
    return active.latest;
  };
  const end = (event: React.PointerEvent<HTMLElement>) => {
    const active = gesture.current;
    if (active?.pointerId !== event.pointerId) return;
    const final = event.type === "pointerup" ? update(event) : active.latest;
    gesture.current = undefined;
    if (final && area && event.type !== "pointercancel")
      remember(fit(final, area, minimum), fit(active.start, area, minimum));
    setDraft(undefined);
  };
  const movable = !!floating;
  React.useLayoutEffect(() => {
    if (movable) return;
    gesture.current = undefined;
    setDraft(undefined);
  }, [movable]);
  const keyAdjust = (event: React.KeyboardEvent<HTMLElement>) => {
    if (
      !rect ||
      !area ||
      gesture.current ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey ||
      !ARROW_KEYS.includes(event.key)
    )
      return;
    event.preventDefault();
    const step = 16 * scale;
    const dx =
      event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0;
    const dy =
      event.key === "ArrowUp" ? -step : event.key === "ArrowDown" ? step : 0;
    remember(
      adjust(rect, dx, dy, event.shiftKey ? "se" : "move", area, minimum),
      rect,
    );
  };

  const raiseFrom = (event: React.SyntheticEvent<HTMLElement>) => {
    const target = event.target;
    if (target instanceof Node && event.currentTarget.contains(target))
      onRaise?.(closeButton.current?.contains(target) ?? false);
  };

  return (
    <section
      id={`tool-${tool}`}
      className={
        project
          ? `gameToolPanel tileWorkspaceSurface ${project.catalogue ? "tileWorkspaceBuilding" : "tileWorkspaceProject"}`
          : "gameToolPanel"
      }
      role={project ? "dialog" : undefined}
      data-resizable={floating ? "true" : undefined}
      aria-label={project ? undefined : label}
      aria-labelledby={project ? titleId : undefined}
      data-game-tool={tool}
      data-map-window-front={project ? undefined : front}
      style={
        rect && {
          left: rect.x,
          top: rect.y,
          width: rect.width,
          height: rect.height,
          zIndex: stackingIndex,
        }
      }
      onPointerDownCapture={(event) => {
        if (event.button === 0) raiseFrom(event);
      }}
      onFocusCapture={raiseFrom}
      onPointerMove={(event) => {
        const next = update(event);
        if (next) setDraft(next);
      }}
      onPointerUp={end}
      onPointerCancel={end}
      onLostPointerCapture={end}
      onKeyDown={
        project &&
        ((event) => {
          if (
            event.key !== "Escape" ||
            event.defaultPrevented ||
            hasVisibleEscapeOverlay()
          )
            return;
          event.preventDefault();
          event.stopPropagation();
          onClose();
        })
      }
    >
      <header
        className="gameToolHeader"
        onPointerDown={(event) => begin(event, "move")}
      >
        {onBack && (
          <IconButton
            color="primary"
            aria-label="Back to programs"
            onClick={onBack}
          >
            <ChevronLeftIcon />
          </IconButton>
        )}
        <h2
          id={titleId}
          className="gameToolTitle"
          tabIndex={floating ? 0 : -1}
          aria-keyshortcuts={floating ? WINDOW_SHORTCUTS : undefined}
          title={
            floating
              ? "Move with the arrow keys. Resize with Shift and the arrow keys."
              : undefined
          }
          onKeyDown={keyAdjust}
          ref={title}
        >
          {icon && <span className="gameToolTitleIcon">{icon}</span>}
          {label}
        </h2>
        <IconButton
          aria-label={project ? "Close project" : `Close ${label}`}
          onClick={onClose}
          ref={closeButton}
        >
          <CloseIcon />
        </IconButton>
      </header>
      <div
        className={project ? "gameToolBody tileWorkspaceBody" : "gameToolBody"}
        data-chart-viewport
        ref={body}
      >
        <MapWindowFrontContext.Provider value={front}>
          {children}
        </MapWindowFrontContext.Provider>
      </div>
      {floating &&
        RESIZE_EDGES.map((edge) => (
          <div
            key={edge}
            className="mapWindowResizeEdge"
            data-edge={edge}
            aria-hidden="true"
            onPointerDown={(event) => begin(event, edge)}
          />
        ))}
    </section>
  );
}

export function MapProjectPanel({
  title,
  catalogue,
  focusKey,
  onClose,
  children,
}: {
  title: string;
  catalogue: boolean;
  focusKey: React.Key;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <MapPanelWindow
      tool="BUILD_GENERATORS"
      label={title}
      icon={catalogue && <ConceptIcon concept="build" decorative />}
      project={{ catalogue, focusKey }}
      onClose={onClose}
    >
      {children}
    </MapPanelWindow>
  );
}
