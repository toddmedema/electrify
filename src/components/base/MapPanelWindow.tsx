import * as React from "react";
import { IconButton, Typography } from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import ChevronLeftIcon from "@mui/icons-material/ChevronLeft";
import { getStorageJson, setStorageKeyValue } from "../../LocalStorage";
import { useToolScroll, useToolState } from "./GameToolMemory";
import { MapWindowFrontContext } from "./GameWorkspaceContext";

type Size = { width: number; height: number };
type Point = { x: number; y: number };
export type MapWindowLayout = {
  area: Size;
  defaultWidth: number;
  scale: number;
  slot: number;
  avoid?: Point;
};
type TileHeading = {
  subtitle?: string;
  focusKey: React.Key;
  initialFocusSelector?: string;
  map: React.RefObject<HTMLElement>;
};
type Rect = Size & { x: number; y: number };
type Operation = "move" | "resize";
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

function avoidTile(rect: Rect, area: Size, point: Point | undefined): Rect {
  if (
    !point ||
    point.x < rect.x ||
    point.x > rect.x + rect.width ||
    point.y < rect.y ||
    point.y > rect.y + rect.height
  )
    return rect;

  const gap = 16;
  const right = point.x + gap;
  if (right + rect.width <= area.width) return { ...rect, x: right };
  const left = point.x - rect.width - gap;
  if (left >= 0) return { ...rect, x: left };
  const below = point.y + gap;
  if (below + rect.height <= area.height) return { ...rect, y: below };
  const above = point.y - rect.height - gap;
  return above >= 0 ? { ...rect, y: above } : rect;
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

  return {
    ...start,
    width: clamp(start.width + dx, minimum.width, area.width - start.x),
    height: clamp(start.height + dy, minimum.height, area.height - start.y),
  };
}

const ARROW_KEYS = "ArrowLeft ArrowRight ArrowUp ArrowDown";

export default function MapPanelWindow({
  tool,
  label,
  icon,
  stackingIndex,
  front,
  floating,
  onRaise,
  onClose,
  onBack,
  tile,
  children,
}: {
  tool: string;
  label: string;
  icon: React.ReactNode;
  stackingIndex: number;
  front: boolean;
  floating?: MapWindowLayout;
  onRaise: () => void;
  onClose: () => void;
  onBack?: () => void;
  tile?: TileHeading;
  children: React.ReactNode;
}) {
  const storageKey = `electrify.mapWindow.${tool}`;
  const [preferred, setPreferred] = useToolState(storageKey, () =>
    readRect(storageKey),
  );
  const [draft, setDraft] = React.useState<Rect>();
  const gesture = React.useRef<Gesture>();
  const title = React.useRef<HTMLHeadingElement>(null);
  const body = useToolScroll<HTMLDivElement>(`workspace.${tool}.scroll`);
  const area = floating?.area;
  const scale = floating?.scale ?? 1;
  const minimum = {
    width: Math.min(320 * scale, area?.width ?? 0),
    height: Math.min(240 * scale, area?.height ?? 0),
  };
  const placed = draft ?? preferred;
  const rect =
    floating && area && area.width > 0 && area.height > 0
      ? placed
        ? fit(placed, area, minimum)
        : avoidTile(
            fit(
              {
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
            ),
            area,
            floating.avoid,
          )
      : undefined;
  const { focusKey, map, initialFocusSelector } = tile ?? {};
  const lastFocusKey = React.useRef<React.Key>();
  React.useLayoutEffect(() => {
    if (focusKey === undefined || lastFocusKey.current === focusKey) return;
    lastFocusKey.current = focusKey;
    if (front) {
      const initialFocus = initialFocusSelector
        ? map?.current?.querySelector<HTMLElement>(initialFocusSelector)
        : undefined;
      (initialFocus ?? title.current)?.focus({ preventScroll: true });
    }
  }, [focusKey, front, initialFocusSelector, map]);

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
    (operation === "move" ? title.current : event.currentTarget)?.focus({
      preventScroll: true,
    });
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
  const keyAdjust = (
    event: React.KeyboardEvent<HTMLElement>,
    operation: Operation,
  ) => {
    if (
      !rect ||
      !area ||
      gesture.current ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey ||
      !ARROW_KEYS.split(" ").includes(event.key)
    )
      return;
    event.preventDefault();
    const step = 16 * scale;
    const dx =
      event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0;
    const dy =
      event.key === "ArrowUp" ? -step : event.key === "ArrowDown" ? step : 0;
    remember(adjust(rect, dx, dy, operation, area, minimum), rect);
  };

  const Title = tile ? "h3" : "h2";
  return (
    <section
      id={`tool-${tool}`}
      className={tile ? "gameToolPanel tileWorkspaceSurface" : "gameToolPanel"}
      role={tile ? "dialog" : undefined}
      aria-label={label}
      data-game-tool={tool}
      data-tool-side={floating ? undefined : "right"}
      data-map-window-front={front}
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
        if (
          event.button === 0 &&
          event.currentTarget.contains(event.target as Node)
        )
          onRaise();
      }}
      onFocusCapture={(event) => {
        if (event.currentTarget.contains(event.target)) onRaise();
      }}
      onPointerMove={(event) => {
        const next = update(event);
        if (next) setDraft(next);
      }}
      onPointerUp={end}
      onPointerCancel={end}
      onLostPointerCapture={end}
    >
      <header
        className={
          tile ? "gameToolHeader tileWorkspaceHeading" : "gameToolHeader"
        }
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
        <div className="mapWindowHeadingText">
          {tile?.subtitle && (
            <Typography variant="overline" color="textSecondary">
              {tile.subtitle}
            </Typography>
          )}
          <Title
            className="gameToolTitle"
            tabIndex={floating ? 0 : -1}
            aria-keyshortcuts={floating ? ARROW_KEYS : undefined}
            title={
              floating
                ? "Move window with the arrow keys or drag the title bar"
                : undefined
            }
            onKeyDown={(event) => keyAdjust(event, "move")}
            ref={title}
          >
            {icon && <span className="gameToolTitleIcon">{icon}</span>}
            {label}
          </Title>
        </div>
        <IconButton
          aria-label={tile ? "Close tile" : `Close ${label}`}
          onClick={onClose}
        >
          <CloseIcon />
        </IconButton>
      </header>
      <div
        className={tile ? "gameToolBody tileWorkspaceBody" : "gameToolBody"}
        data-chart-viewport
        ref={body}
      >
        <MapWindowFrontContext.Provider value={front}>
          {children}
        </MapWindowFrontContext.Provider>
      </div>
      {floating && (
        <div className="mapWindowFooter">
          <button
            className="mapWindowResize"
            type="button"
            aria-label={tile ? "Resize tile inspector" : `Resize ${label}`}
            aria-keyshortcuts={ARROW_KEYS}
            title="Resize with the arrow keys or drag this corner"
            onPointerDown={(event) => begin(event, "resize")}
            onKeyDown={(event) => keyAdjust(event, "resize")}
          />
        </div>
      )}
    </section>
  );
}
