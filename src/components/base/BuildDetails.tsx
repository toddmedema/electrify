import * as React from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableRow,
} from "@mui/material";
import ManualLink from "./ManualLink";
import type { ManualEntryTitleType } from "./ManualEntries";

export default function BuildDetails(props: {
  label: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <TableContainer>
      <Table size="small" aria-label={props.label} className="buildDetails">
        <TableBody>{props.children}</TableBody>
      </Table>
    </TableContainer>
  );
}

export function BuildDetailRow(props: {
  label: string;
  value: React.ReactNode;
  entry?: ManualEntryTitleType;
}): React.JSX.Element {
  return (
    <TableRow className={props.entry ? "manual-help-region" : undefined}>
      <TableCell
        component="th"
        scope="row"
        aria-label={props.label}
        className="buildDetailLabel"
      >
        {props.entry ? (
          <ManualLink
            entry={props.entry}
            label={props.label.toLowerCase()}
            region
          >
            {props.label}
          </ManualLink>
        ) : (
          props.label
        )}
      </TableCell>
      <TableCell align="right" className="buildDetailValue">
        {props.value}
      </TableCell>
    </TableRow>
  );
}
