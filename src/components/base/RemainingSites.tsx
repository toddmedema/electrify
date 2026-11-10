import * as React from "react";
import { Box, Tooltip, Typography } from "@mui/material";
import type { HydroSite } from "../../data/HydroSites";
import { formatWatts } from "../../helpers/Format";

/** Rows the list shows before it scrolls, so a full inventory never outgrows the window. */
const LIST_MAX_HEIGHT = "min(50vh, 320px)";

/** Unclaimed sites, largest first; the inventory arrives smallest first. */
export function sitesLargestFirst(
  sites: readonly HydroSite[],
): readonly HydroSite[] {
  return [...sites].reverse();
}

/**
 * Wraps a "sites left" figure so hovering, focusing or tapping it lists every unclaimed site with
 * its name and maximum size. The list can be entered and scrolled with the pointer. From the
 * keyboard, Enter, Space or the down arrow moves focus into the list so it can be scrolled; the
 * tooltip stays open while focus is inside it, and Escape or Tab returns focus to the figure.
 */
export default function RemainingSites({
  sites,
  children,
}: {
  sites: readonly HydroSite[];
  children: React.ReactNode;
}): React.JSX.Element {
  const [open, setOpen] = React.useState(false);
  // Held open while keyboard focus is in the list; a pointer or tap never pins the tooltip
  const [pinned, setPinned] = React.useState(false);
  const triggerRef = React.useRef<HTMLSpanElement>(null);
  const listRef = React.useRef<HTMLUListElement | null>(null);
  const keyboardEntry = React.useRef(false);
  // The tooltip may not be mounted yet when the key arrives; focus moves once the list appears
  const focusWhenMounted = React.useRef(false);
  const focusList = React.useCallback((node: HTMLUListElement) => {
    keyboardEntry.current = true;
    node.focus({ preventScroll: true });
    keyboardEntry.current = false;
  }, []);
  const attachList = React.useCallback(
    (node: HTMLUListElement | null) => {
      listRef.current = node;
      if (node && focusWhenMounted.current) {
        focusWhenMounted.current = false;
        focusList(node);
      }
    },
    [focusList],
  );
  if (!sites.length) return <>{children}</>;
  const listed = sitesLargestFirst(sites);
  const enterList = (event: React.KeyboardEvent) => {
    if (!["Enter", " ", "ArrowDown"].includes(event.key)) return;
    event.preventDefault();
    if (listRef.current) {
      focusList(listRef.current);
    } else {
      focusWhenMounted.current = true;
      setOpen(true);
    }
  };
  const leaveList = (event: React.KeyboardEvent) => {
    if (event.key !== "Escape" && event.key !== "Tab") return;
    // Tab carries on from the figure, so the page order continues past the tooltip
    if (event.key === "Escape" || event.shiftKey) event.preventDefault();
    triggerRef.current?.focus();
    if (event.key === "Escape") setOpen(false);
  };
  return (
    <Tooltip
      open={open || pinned}
      onOpen={() => setOpen(true)}
      onClose={() => setOpen(false)}
      placement="top"
      disableInteractive={false}
      enterTouchDelay={0}
      leaveTouchDelay={8000}
      slotProps={{
        tooltip: {
          sx: {
            maxWidth: 360,
            p: 0,
            textAlign: "left",
            fontSize: "var(--font-size-body2)",
            color: "var(--font-color-primary)",
            border: "1px solid var(--tooltip-border)",
            backgroundColor: "var(--tooltip-bg)",
            boxShadow: "0 8px 24px var(--tooltip-shadow)",
          },
        },
      }}
      title={
        <Box sx={{ py: 1 }}>
          <Typography
            variant="caption"
            component="p"
            sx={{ px: 1.5, pb: 0.5, fontWeight: 600 }}
          >
            {listed.length === 1
              ? "1 site left, by size"
              : `${listed.length} sites left, largest first`}
          </Typography>
          <Box
            component="ul"
            ref={attachList}
            aria-label="Remaining hydro sites"
            tabIndex={0}
            onFocus={() => {
              if (keyboardEntry.current) setPinned(true);
            }}
            onBlur={() => setPinned(false)}
            onKeyDown={leaveList}
            sx={{
              m: 0,
              px: 1.5,
              listStyle: "none",
              maxHeight: LIST_MAX_HEIGHT,
              overflowY: "auto",
            }}
          >
            {listed.map((site) => (
              <Box
                component="li"
                key={site.id}
                sx={{
                  display: "flex",
                  justifyContent: "space-between",
                  gap: 2,
                  py: 0.25,
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                <span>{site.name}</span>
                <span style={{ whiteSpace: "nowrap" }}>
                  {formatWatts(site.maxPeakW, 6)}
                </span>
              </Box>
            ))}
          </Box>
        </Box>
      }
    >
      <span
        ref={triggerRef}
        className="nowrap"
        tabIndex={0}
        onKeyDown={enterList}
        style={{
          textDecoration: "underline dotted",
          textUnderlineOffset: 3,
          cursor: "help",
        }}
      >
        {children}
      </span>
    </Tooltip>
  );
}
