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
    <TableRow>
      <TableCell component="th" scope="row" className="buildDetailLabel">
        {props.label}
      </TableCell>
      <TableCell align="right" className="buildDetailValue">
        {props.value}
      </TableCell>
      <TableCell className="buildDetailHelp">
        {props.entry && (
          <ManualLink entry={props.entry} label={props.label.toLowerCase()} />
        )}
      </TableCell>
    </TableRow>
  );
}
