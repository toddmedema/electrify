import * as React from "react";
import { createPortal } from "react-dom";
import { IconButton, Typography } from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import MapPanelWindow from "./MapPanelWindow";
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

/** Put inspection in the desktop window stack while leaving the sheet and project surfaces local. */
export function TileInspectionSurface({
  map,
  tileKey,
  ...props
}: React.ComponentProps<typeof TileWorkspaceSurface> & {
  map: React.RefObject<HTMLElement>;
  tileKey: string;
}) {
  const tileWindow = React.useContext(MapWorkspacePanelContext)?.tileWindow;
  if (!tileWindow) return <TileWorkspaceSurface {...props} />;
  const tray = tileWindow.tray.current;
  if (!tray || tileWindow.stackingIndex < 0) return null;
  return createPortal(
    <FloatingInspection
      {...props}
      map={map}
      tileKey={tileKey}
      tileWindow={tileWindow}
    />,
    tray,
  );
}

function FloatingInspection({
  map,
  tileKey,
  tileWindow,
  title,
  subtitle,
  focusKey,
  initialFocusSelector,
  onClose,
  children,
}: React.ComponentProps<typeof TileInspectionSurface> & {
  tileWindow: MapTileWindow;
}) {
  const [avoid] = React.useState(() => {
    const tile = findTileControl(map.current, tileKey)?.getBoundingClientRect();
    const tray = tileWindow.tray.current?.getBoundingClientRect();
    if (tile && tray)
      return {
        x: tile.left + tile.width / 2 - tray.left,
        y: tile.top + tile.height / 2 - tray.top,
      };
  });
  return (
    <MapPanelWindow
      tool="TILE"
      label={title}
      icon={null}
      stackingIndex={tileWindow.stackingIndex}
      front={tileWindow.front}
      floating={{ ...tileWindow.layout, avoid }}
      onRaise={tileWindow.raise}
      onClose={onClose}
      tile={{ map, subtitle, focusKey, initialFocusSelector }}
    >
      {children}
    </MapPanelWindow>
  );
}

/** A nonmodal inspector: the map remains interactive behind the same desktop panel/phone sheet. */
export default function TileWorkspaceSurface({
  title,
  focusKey,
  subtitle,
  building,
  projectCandidate,
  initialFocusSelector,
  returnFocusSelector = ".territoryMapBuyToggle",
  onClose,
  children,
}: {
  title: string;
  /** Changes only for explicit activation or a new kind of tile content. */
  focusKey: React.Key;
  subtitle?: string;
  building?: boolean;
  projectCandidate?: boolean;
  initialFocusSelector?: string;
  returnFocusSelector?: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const titleId = React.useId();
  const heading = React.useRef<HTMLHeadingElement>(null);
  React.useLayoutEffect(() => {
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
  }, [returnFocusSelector]);
  React.useLayoutEffect(() => {
    const target = initialFocusSelector
      ? heading.current
          ?.closest(".territoryNetwork")
          ?.querySelector<HTMLElement>(initialFocusSelector)
      : undefined;
    (target ?? heading.current)?.focus({ preventScroll: true });
  }, [focusKey, initialFocusSelector]);
  return (
    <section
      role="dialog"
      aria-labelledby={titleId}
      className={`tileWorkspaceSurface${subtitle ? " tileWorkspaceInspector" : ""}${building ? " tileWorkspaceBuilding" : ""}${projectCandidate ? " tileWorkspaceProject" : ""}`}
      onKeyDown={(event) => {
        if (
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
        <IconButton aria-label="Close tile" onClick={onClose}>
          <CloseIcon />
        </IconButton>
      </header>
      <div className="tileWorkspaceBody">{children}</div>
    </section>
  );
}
