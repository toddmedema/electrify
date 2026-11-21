import * as React from "react";
import { createPortal } from "react-dom";
import { IconButton, Typography } from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import {
  MapWorkspacePanelContext,
  type MapTileWindow,
} from "./GameWorkspaceContext";
import { hasVisibleEscapeOverlay } from "./VisibleEscapeOverlay";
import "./TileWorkspaceSurface.scss";

export function findTileControl(map: HTMLElement | null, tile: string) {
  return map?.querySelector<HTMLButtonElement>(
    `[data-map-target="${CSS.escape(tile)}"]`,
  );
}

type SurfaceProps = {
  id?: string;
  title: string;
  /** Changes only for explicit activation or a new kind of tile content. */
  focusKey: React.Key;
  subtitle?: string;
  building?: boolean;
  wide?: boolean;
  projectCandidate?: boolean;
  initialFocusSelector?: string;
  returnFocusSelector?: string;
  onClose: () => void;
  children: React.ReactNode;
};

export function TileInspectionSurface({
  map,
  ...props
}: SurfaceProps & { map: React.RefObject<HTMLElement> }) {
  const tileWindow = React.useContext(MapWorkspacePanelContext)?.tileWindow;
  const tray = tileWindow?.tray.current;
  if (tileWindow && (!tray || tileWindow.stackingIndex < 0)) return null;

  const surface = (
    <TileWorkspaceSurface
      {...props}
      inspector={props.building ? undefined : { map, window: tileWindow }}
    />
  );
  return tray ? createPortal(surface, tray) : surface;
}

/** A nonmodal surface for tile information and the map's build and project decisions. */
export default function TileWorkspaceSurface({
  id,
  title,
  focusKey,
  subtitle,
  building,
  wide,
  projectCandidate,
  initialFocusSelector,
  returnFocusSelector = ".territoryMapBuyToggle",
  onClose,
  children,
  inspector,
}: SurfaceProps & {
  inspector?: { map: React.RefObject<HTMLElement>; window?: MapTileWindow };
}) {
  const titleId = React.useId();
  const heading = React.useRef<HTMLHeadingElement>(null);
  const window = inspector?.window;
  const stacked = !!window;
  React.useLayoutEffect(() => {
    if (stacked) return;
    const origin = document.activeElement;
    const map = heading.current?.closest(".territoryNetwork");
    return () => {
      const returnControl =
        map?.querySelector<HTMLElement>(returnFocusSelector) ??
        map
          ?.closest(".gameWorkspace")
          ?.querySelector<HTMLElement>(returnFocusSelector);
      if (returnControl) returnControl.focus({ preventScroll: true });
      else if (origin instanceof HTMLElement && origin.isConnected)
        origin.focus({ preventScroll: true });
    };
  }, [returnFocusSelector, stacked]);
  const lastFocus = React.useRef<{ key: React.Key; selector?: string }>();
  const mapRef = inspector?.map;
  const front = window?.front;
  React.useLayoutEffect(() => {
    if (
      stacked &&
      lastFocus.current?.key === focusKey &&
      lastFocus.current.selector === initialFocusSelector
    )
      return;
    lastFocus.current = { key: focusKey, selector: initialFocusSelector };
    if (front === false) return;
    const map =
      mapRef?.current ?? heading.current?.closest(".territoryNetwork");
    const target = initialFocusSelector
      ? map?.querySelector<HTMLElement>(initialFocusSelector)
      : undefined;
    (target ?? heading.current)?.focus({ preventScroll: true });
  }, [focusKey, front, initialFocusSelector, mapRef, stacked]);
  return (
    <section
      role="dialog"
      aria-labelledby={titleId}
      id={stacked ? "tool-TILE" : id}
      className={`tileWorkspaceSurface${inspector ? " tileWorkspaceInspector" : ""}${wide ? " tileWorkspaceWide" : ""}${building ? " tileWorkspaceBuilding" : ""}${projectCandidate ? " tileWorkspaceProject" : ""}`}
      data-game-tool={stacked ? "TILE" : undefined}
      data-map-window-front={front}
      style={window && { zIndex: window.stackingIndex }}
      onPointerDownCapture={(event) => {
        if (
          event.button === 0 &&
          event.currentTarget.contains(event.target as Node)
        )
          window?.raise();
      }}
      onFocusCapture={(event) => {
        if (event.currentTarget.contains(event.target)) window?.raise();
      }}
      onKeyDown={(event) => {
        if (
          !stacked &&
          event.key === "Escape" &&
          !event.defaultPrevented &&
          !hasVisibleEscapeOverlay()
        ) {
          event.preventDefault();
          event.stopPropagation();
          onClose();
        }
      }}
    >
      <header className="tileWorkspaceHeading">
        <div>
          <Typography
            id={titleId}
            component="h3"
            variant="h6"
            tabIndex={-1}
            ref={heading}
          >
            {title}
          </Typography>
          {subtitle && (
            <Typography variant="body2" color="textSecondary">
              {subtitle}
            </Typography>
          )}
        </div>
        {!inspector && (
          <IconButton aria-label="Close tile" onClick={onClose}>
            <CloseIcon />
          </IconButton>
        )}
      </header>
      <div className="tileWorkspaceBody">{children}</div>
    </section>
  );
}
