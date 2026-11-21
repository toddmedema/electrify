import * as React from "react";
import { Typography } from "@mui/material";
import ManualLink from "./ManualLink";
import { BuildDetailRow } from "./BuildDetails";
import type { ManualEntryTitleType } from "./ManualEntries";
export default function BuildMetric(props: {
  label: string;
  value: string;
  entry: ManualEntryTitleType;
  // A qualifier on the value, such as what a quoted price includes
  note?: string;
  asDetailRow?: boolean;
}): React.JSX.Element {
  const note = props.note && (
    <Typography variant="caption" color="textSecondary" component="div">
      {props.note}
    </Typography>
  );
  if (props.asDetailRow)
    return (
      <BuildDetailRow
        label={props.label}
        entry={props.entry}
        value={
          <>
            {props.value}
            {note}
          </>
        }
      />
    );
  return (
    <div className="buildOptionMetric manual-help-region">
      <Typography variant="caption" color="textSecondary" component="div">
        <ManualLink
          entry={props.entry}
          label={props.label.toLowerCase()}
          region
        >
          {props.label}
        </ManualLink>
      </Typography>
      <Typography variant="body2" component="div" sx={{ fontWeight: 600 }}>
        {props.value}
      </Typography>
      {note}
    </div>
  );
}
