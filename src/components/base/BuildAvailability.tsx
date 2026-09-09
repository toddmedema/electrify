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
      secondaryText:
        "Not available in this game at this location or point in time.",
    };
  }
  const siteBuildable = viableLocationsRemaining !== 0;
  if (!siteBuildable) {
    return {
      buildable: false,
      secondaryText: "No project sites remain in this game at this location.",
    };
  }
  if (!sizeBuildable) {
    return {
      buildable: false,
      secondaryText: (
        <div>
          This project size is not available with technology in this year.
          <br />
          Maximum available size: <strong>{maxSizeLabel}</strong>
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
        Project sites available in this game
        <Typography variant="body2" color="textSecondary">
          Each project uses one site. These game limits are not a site survey;
          zero does not prove the resource is impossible here.
        </Typography>
      </TableCell>
      <TableCell align="right">{props.remaining}</TableCell>
    </TableRow>
  );
}
