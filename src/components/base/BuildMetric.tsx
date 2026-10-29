import * as React from "react";
import { Typography } from "@mui/material";
export default function BuildMetric(props: {
  label: string;
  value: string;
  // A qualifier on the value, such as what a quoted price includes
  note?: string;
}): React.JSX.Element {
  return (
    <div className="buildOptionMetric">
      <Typography variant="caption" color="textSecondary" component="div">
        {props.label}
      </Typography>
      <Typography variant="body2" component="div" sx={{ fontWeight: 600 }}>
        {props.value}
      </Typography>
      {props.note && (
        <Typography variant="caption" color="textSecondary" component="div">
          {props.note}
        </Typography>
      )}
    </div>
  );
}
