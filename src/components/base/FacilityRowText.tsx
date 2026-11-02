import * as React from "react";
import { ListItemText } from "@mui/material";
import ConstructionProgressBar from "./ConstructionProgress";

/**
 * The text of one row in the facilities list, shared by plants and interties: the name line, a
 * status line that leads with the reading and lets its trailing detail truncate first, and the
 * construction meter while the row is still being built. Keeping the markup here is what keeps
 * the two kinds of row looking the same as they move through the same states.
 */
export default function FacilityRowText(props: {
  /** The name, with any badge beside it. */
  name: React.ReactNode;
  /** Leads the status line, ahead of the reading (a weather outage). */
  lead?: React.ReactNode;
  /** The reading and state: output, flow, or how far along a build is. */
  status: React.ReactNode;
  /** Trailing detail, after the reading; the first thing to give way on a narrow row. */
  detail?: React.ReactNode;
  /** Present while the row is being built or upgraded. */
  progress?: { builtFraction: number; paused: boolean };
  /** An extra line under the status. */
  children?: React.ReactNode;
}): React.JSX.Element {
  const { name, lead, status, detail, progress, children } = props;
  return (
    <span className="facilityText">
      <ListItemText
        slotProps={{
          primary: { component: "span" },
          secondary: { component: "span" },
        }}
        primary={name}
        secondary={
          <>
            {lead}
            <span className="facilityStatus">{status}</span>
            {detail && (
              <span className="facilityStatusDetail">
                <span className="facilityStatusSeparator" aria-hidden="true">
                  {" · "}
                </span>
                {detail}
              </span>
            )}
          </>
        }
      />
      {progress && <ConstructionProgressBar {...progress} />}
      {children}
    </span>
  );
}
