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
 * its name and maximum size. The list can be entered and scrolled with the pointer.
 */
export default function RemainingSites({
  sites,
  children,
}: {
  sites: readonly HydroSite[];
  children: React.ReactNode;
}): React.JSX.Element {
  if (!sites.length) return <>{children}</>;
  const listed = sitesLargestFirst(sites);
  return (
    <Tooltip
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
            aria-label="Remaining hydro sites"
            tabIndex={0}
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
        className="nowrap"
        tabIndex={0}
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
