import * as React from "react";
import { Button, Typography } from "@mui/material";
import {
  FacilityOperatingType,
  GameType,
  RetrofitFacilityAction,
} from "../../Types";
import { gasConversionQuote } from "../../helpers/GasConversion";
import { currentCash } from "../../helpers/GameSelectors";
import { formatMoneyConcise, formatPercent } from "../../helpers/Format";
import ConfirmDialog from "./ConfirmDialog";
import DecisionImpactPreview from "./DecisionImpactPreview";
import { getInflationIndex } from "../../data/Economy";

export default function GasConversion(props: {
  facility: FacilityOperatingType;
  game: GameType;
  onRetrofit?: (payload: RetrofitFacilityAction) => void;
}) {
  const [confirming, setConfirming] = React.useState(false);
  const quote = gasConversionQuote(props.facility, props.game);
  if (!quote || !props.onRetrofit) return null;
  const { facility, game } = props;
  const cash = currentCash(game);
  const shortfall = Math.max(0, quote.cost - cash);
  const escalation =
    getInflationIndex(game.date, game.startingYear, game.seed) /
    (facility.costIndexAtBuild || 1);
  const costChange = (before: number, after: number, unit: string) =>
    `${formatMoneyConcise(before * escalation)} → ${formatMoneyConcise(after)}/${unit}`;
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
          contentClassName="noPadding"
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
          <DecisionImpactPreview
            facts={[
              {
                concept: "money",
                label: "Cash purchase",
                value: `${formatMoneyConcise(cash)} → ${formatMoneyConcise(cash - quote.cost)}`,
                detail:
                  "Existing loans stay payable. Cancel before completion for a full refund.",
              },
              {
                concept: "time",
                label: "Offline for",
                value: "6 months",
                detail: "Capacity and remaining life stay the same.",
              },
              {
                concept: "fuel",
                label: "Fuel use",
                value: `${((facility.btuPerWh ?? 0) * 1000).toLocaleString("en-US")} → ${((quote.target.btuPerWh ?? 0) * 1000).toLocaleString("en-US")} Btu/kWh`,
              },
              {
                concept: "time",
                label: "Start time",
                value: `${facility.spinMinutes} → ${quote.target.spinMinutes} minutes`,
              },
              {
                concept: "supply",
                label: "Minimum output",
                value: `${formatPercent(facility.minimumStableOutput ?? 0)} → ${formatPercent(quote.target.minimumStableOutput ?? 0)}`,
              },
              {
                concept: "money",
                label: "Fixed upkeep",
                value: costChange(
                  facility.annualOperatingCost,
                  quote.target.annualOperatingCost,
                  "year",
                ),
                detail:
                  "Operating costs are at today's prices and follow inflation.",
              },
              {
                concept: "money",
                label: "Variable upkeep",
                value: costChange(
                  facility.variableOperatingCostPerMWh ?? 0,
                  quote.target.variableOperatingCostPerMWh ?? 0,
                  "MWh",
                ),
              },
              {
                concept: "money",
                label: "Start cost",
                value: costChange(
                  facility.costPerStart ?? 0,
                  quote.target.costPerStart ?? 0,
                  "start",
                ),
              },
            ]}
          />
        </ConfirmDialog>
      )}
    </section>
  );
}
