import * as React from "react";
import { Button, Typography } from "@mui/material";
import { formatMoneyConcise } from "../../helpers/Format";

export default function FacilityUpgradeAction(props: {
  label: string;
  cost: number;
  shortfall: number;
  onClick: () => void;
}) {
  const shortfallId = React.useId();
  return (
    <div className="facilityRetrofit">
      <Button
        variant="outlined"
        disabled={props.shortfall > 0}
        aria-describedby={props.shortfall > 0 ? shortfallId : undefined}
        onClick={props.onClick}
      >
        {props.label} · {formatMoneyConcise(props.cost)}
      </Button>
      {props.shortfall > 0 && (
        <Typography
          id={shortfallId}
          variant="caption"
          color="textSecondary"
          component="p"
        >
          {formatMoneyConcise(props.shortfall)} more cash needed
        </Typography>
      )}
    </div>
  );
}
