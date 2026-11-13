import * as React from "react";
import { Typography } from "@mui/material";
import ConceptIcon, { ConceptNameType } from "./ConceptIcon";
import ManualLink from "./ManualLink";
import type { ManualEntryTitleType } from "./ManualEntries";

export default React.memo(function FacilityStat(props: {
  label: string;
  entry: ManualEntryTitleType;
  concept?: ConceptNameType;
  value: React.ReactNode;
  tone?: "good" | "bad";
}): React.JSX.Element {
  return (
    <div className="facilityStat manual-help-region">
      <Typography variant="caption" color="textSecondary" component="dt">
        <ManualLink
          entry={props.entry}
          label={props.label.toLowerCase()}
          region
        >
          {props.concept && (
            <ConceptIcon
              concept={props.concept}
              className="facilityStatIcon"
              color="inherit"
              decorative
              monochrome
              style={{ width: 14, height: 14 }}
            />
          )}
          {props.label}
        </ManualLink>
      </Typography>
      <Typography
        variant="body2"
        component="dd"
        className={`facilityStatValue${props.tone ? ` ${props.tone}` : ""}`}
      >
        {props.value}
      </Typography>
    </div>
  );
});
