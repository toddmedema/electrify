import * as React from "react";
import { TableCell, TableRow, Typography } from "@mui/material";

interface BuildAvailability {
  buildable: boolean;
  secondaryText: React.ReactNode;
}

/** Shared availability copy and state for generator and storage purchase cards. */
export function getBuildAvailability(
  description: string,
  available: boolean,
  sizeBuildable: boolean,
  maxSizeLabel: React.ReactNode,
  viableLocationsRemaining?: number,
): BuildAvailability {
  if (!available && viableLocationsRemaining !== 0) {
    return {
      buildable: false,
      secondaryText: "Not available at this location or point in time.",
    };
  }
  const siteBuildable = viableLocationsRemaining !== 0;
  if (!siteBuildable) {
    return {
      buildable: false,
      secondaryText: "No viable locations remaining.",
    };
  }
  if (!sizeBuildable) {
    return {
      buildable: false,
      secondaryText: (
        <div>
          Too large for current tech.
          <br />
          Max size: <strong>{maxSizeLabel}</strong>
        </div>
      ),
    };
  }
  return { buildable: true, secondaryText: description };
}

/** A detail row shared by every technology with a finite site inventory. */
export function ViableLocationsRow(props: {
  remaining?: number;
}): React.JSX.Element | null {
  if (props.remaining === undefined) {
    return null;
  }
  return (
    <TableRow>
      <TableCell>
        Number of viable locations remaining
        <Typography variant="body2" color="textSecondary">
          Each project uses one suitable site
        </Typography>
      </TableCell>
      <TableCell align="right">{props.remaining}</TableCell>
    </TableRow>
  );
}
