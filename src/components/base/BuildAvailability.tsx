import * as React from "react";
import { TableCell, TableRow } from "@mui/material";

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
      secondaryText: "Not available here yet.",
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
      <TableCell>Sites left</TableCell>
      <TableCell align="right">{props.remaining}</TableCell>
    </TableRow>
  );
}
