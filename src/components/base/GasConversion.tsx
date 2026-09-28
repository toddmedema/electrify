import * as React from "react";
import { Button, DialogContentText, Typography } from "@mui/material";
import {
  FacilityOperatingType,
  GameType,
  RetrofitFacilityAction,
} from "../../Types";
import { gasConversionQuote } from "../../helpers/GasConversion";
import { currentCash } from "../../helpers/GameSelectors";
import { formatMoneyConcise } from "../../helpers/Format";
import ConfirmDialog from "./ConfirmDialog";

export default function GasConversion(props: {
  facility: FacilityOperatingType;
  game: GameType;
  onRetrofit?: (payload: RetrofitFacilityAction) => void;
}) {
  const [confirming, setConfirming] = React.useState(false);
  const quote = gasConversionQuote(props.facility, props.game);
  if (!quote || !props.onRetrofit) return null;
  const shortfall = Math.max(0, quote.cost - currentCash(props.game));
  return (
    <section
      className="facilityDetailSection"
      aria-label="Combined-cycle conversion"
    >
      <Typography component="h3" className="facilityDetailHeading">
        Combined-cycle conversion
      </Typography>
      <Typography variant="body2">
        Use less gas for the same power. Six months offline; slower starts and a
        45% minimum output afterward. Capacity and remaining life stay the same.
      </Typography>
      <Button
        variant="outlined"
        disabled={shortfall > 0}
        onClick={() => setConfirming(true)}
      >
        Convert to combined cycle · {formatMoneyConcise(quote.cost)}
      </Button>
      {shortfall > 0 && (
        <Typography variant="caption">
          {formatMoneyConcise(shortfall)} more cash needed
        </Typography>
      )}
      {confirming && (
        <ConfirmDialog
          open
          isolateClicks
          title={`Convert ${props.facility.name} to combined cycle?`}
          confirmLabel={`Pay ${formatMoneyConcise(quote.cost)}`}
          confirmDisabled={shortfall > 0}
          onCancel={() => setConfirming(false)}
          onConfirm={() => {
            props.onRetrofit?.({
              facilityId: props.facility.id,
              upgrade: "combinedCycle",
            });
            setConfirming(false);
          }}
        >
          <DialogContentText>
            The plant will be offline for six months. Fuel use becomes 6,266
            Btu/kWh, start time becomes 90 minutes, and minimum output becomes
            45%. Fixed upkeep, variable upkeep and start costs change to
            combined-cycle costs.
          </DialogContentText>
          <DialogContentText>
            At today's prices:{" "}
            {formatMoneyConcise(quote.target.annualOperatingCost)}
            /year fixed upkeep,{" "}
            {formatMoneyConcise(quote.target.variableOperatingCostPerMWh ?? 0)}
            /MWh variable upkeep, and{" "}
            {formatMoneyConcise(quote.target.costPerStart ?? 0)}
            /start. Operating costs follow inflation.
          </DialogContentText>
          <DialogContentText>
            Paid in cash. Existing loans remain payable. Cancel before
            completion for a full refund.
          </DialogContentText>
        </ConfirmDialog>
      )}
    </section>
  );
}
