import * as React from "react";
import { IconButton, Typography } from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import { hasVisibleEscapeOverlay } from "./VisibleEscapeOverlay";
import "./TileWorkspaceSurface.scss";

/** A nonmodal inspector: the map remains interactive behind the same desktop panel/phone sheet. */
export default function TileWorkspaceSurface({
  title,
  focusKey,
  subtitle,
  building,
  projectCandidate,
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
    heading.current?.focus({ preventScroll: true });
  }, [focusKey]);
  return (
    <section
      role="dialog"
      aria-labelledby={titleId}
      className={`tileWorkspaceSurface${building ? " tileWorkspaceBuilding" : ""}${projectCandidate ? " tileWorkspaceProject" : ""}`}
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
          {subtitle && (
            <Typography variant="overline" color="textSecondary">
              {subtitle}
            </Typography>
          )}
          <Typography
            id={titleId}
            component="h3"
            variant="h6"
            tabIndex={-1}
            ref={heading}
          >
            {title}
          </Typography>
        </div>
        <IconButton aria-label="Close tile" onClick={onClose}>
          <CloseIcon />
        </IconButton>
      </header>
      <div className="tileWorkspaceBody">{children}</div>
    </section>
  );
}
