import { useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { MouseEventHandler, ReactNode } from "react";
import { IconButton, Menu, MenuItem } from "@mui/material";
import MoreVertIcon from "@mui/icons-material/MoreVert";

/** The same menu trigger, offline notice and popup serve solo and the shared couch shell. */
export default function GameMenu({
  anchorEl,
  open = !!anchorEl,
  online,
  onOpen,
  onClose,
  children,
  footer,
}: {
  anchorEl?: HTMLElement | null;
  open?: boolean;
  online: boolean;
  onOpen: MouseEventHandler<HTMLElement>;
  onClose: () => void;
  children: ReactNode;
  /** Non-menu content belongs inside the active modal so MUI keeps it visible to AT. */
  footer?: ReactNode;
}) {
  const descriptionId = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const [overlayRoot, setOverlayRoot] = useState<HTMLElement | null>(null);
  return (
    <>
      <IconButton
        ref={trigger}
        data-settings-trigger
        data-saves-trigger
        data-achievements-trigger
        data-manual-trigger
        className="gameMenuButton"
        onClick={onOpen}
        aria-label="menu"
        aria-describedby={online ? undefined : descriptionId}
        aria-haspopup="menu"
        aria-expanded={open || undefined}
        edge="start"
        color="primary"
        size="large"
      >
        <MoreVertIcon />
        {!online && (
          <>
            <span className="offlineDot" aria-hidden="true" />
            <span id={descriptionId} className="srOnly">
              Offline: saving to this device only
            </span>
          </>
        )}
      </IconButton>
      <Menu
        ref={footer ? setOverlayRoot : undefined}
        id="gameCardMenu"
        anchorEl={anchorEl ?? trigger.current}
        keepMounted
        open={open}
        onClose={onClose}
        slotProps={{ list: { "aria-label": "Game menu" } }}
      >
        {!online && (
          <MenuItem disabled className="gameMenuOffline">
            <span className="offlineDot" aria-hidden="true" />
            Offline: saving to this device only
          </MenuItem>
        )}
        {children}
      </Menu>
      {open && footer && overlayRoot ? createPortal(footer, overlayRoot) : null}
    </>
  );
}
