import * as React from "react";
import { Typography } from "@mui/material";
export default function BuildMetric(props: {
  label: string;
  value: string;
}): React.JSX.Element {
  return (
    <div className="buildOptionMetric">
      <Typography variant="caption" color="textSecondary" component="div">
        {props.label}
      </Typography>
      <Typography variant="body2" component="div" sx={{ fontWeight: 600 }}>
        {props.value}
      </Typography>
    </div>
  );
}
