import { useMoney } from "./CurrencyContext";
import * as React from "react";
import { Button, Typography } from "@mui/material";

export default function FacilityUpgradeAction(props: {
  label: string;
  cost: number;
  shortfall: number;
  onClick: () => void;
  className?: string;
}) {
  const shortfallId = React.useId();
  const { formatMoneyConcise, formatPurchasePrice } = useMoney();
  return (
    <div
      className={["facilityRetrofit", props.className]
        .filter(Boolean)
        .join(" ")}
    >
      <Button
        variant="outlined"
        disabled={props.shortfall > 0}
        aria-describedby={props.shortfall > 0 ? shortfallId : undefined}
        onClick={props.onClick}
      >
        {props.label} ({formatPurchasePrice(props.cost)})
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
