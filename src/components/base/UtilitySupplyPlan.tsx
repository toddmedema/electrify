import * as React from "react";
import { Box, Typography } from "@mui/material";
import type { GameType } from "../../Types";
import type { ProjectionView } from "../../helpers/Projection";
import { utilityPlanning } from "../../helpers/UtilityPlanning";
import { MONTHS } from "../../Constants";
import { formatWatts } from "../../helpers/Format";
import UtilityContractSchedule from "./UtilityContractSchedule";
import { facilityDisplayName } from "./FacilityLabels";
import { formatRequiredShare } from "../../helpers/ObjectiveRules";

/** Shares the scenario forecast; no second demand model or simulation runs in this panel. */
export default function UtilitySupplyPlan({
  game,
  forecast,
}: {
  game: GameType;
  forecast?: ProjectionView;
}) {
  const plan = utilityPlanning(game, forecast);
  if (!plan) return null;
  const month = (value: number) =>
    `${MONTHS[((value % 12) + 12) % 12]} ${game.startingYear + Math.floor(value / 12)}`;
  const startBy = (value: number | undefined) =>
    value === undefined
      ? "Check project lead times."
      : value < game.date.monthsElapsed
        ? "The reference project would already need to be underway."
        : `Start that reference project by ${month(value)}.`;
  return (
    <Box component="section" aria-label="Supply plan" sx={{ my: 2 }}>
      <Typography component="h3" variant="subtitle1" sx={{ fontWeight: 600 }}>
        Supply plan
      </Typography>
      <Typography variant="body2" sx={{ mt: 1 }}>
        {plan.nextCustomers === undefined || plan.nextPeakW === undefined
          ? "Updating customer and peak-demand forecast…"
          : `At current rates and policies, the next-year forecast reaches ${Math.round(plan.nextCustomers).toLocaleString()} customers and a ${formatWatts(plan.nextPeakW)} peak.`}{" "}
        Lower rates can attract customers faster than new supply can be built.
      </Typography>
      {plan.gap && (
        <Typography variant="body2" color="warning.main" sx={{ mt: 1 }}>
          Monthly service is projected below{" "}
          {formatRequiredShare(plan.serviceThreshold)} from{" "}
          {plan.gap.date.month} {plan.gap.date.year} at current rates and
          policies. {startBy(plan.gap.startMonth)}
        </Typography>
      )}
      {plan.buildMonths !== undefined && (
        <Typography variant="body2" color="textSecondary" sx={{ mt: 1 }}>
          For comparison, a 150 MW combined-cycle gas plant ordered now takes{" "}
          {plan.buildMonths} months. Other sizes, technologies and customer
          programs have different lead times. Compare their capacity and
          completion dates with the forecast.
        </Typography>
      )}
      <Box component="ul" sx={{ pl: 2.5, my: 1, "& li": { mb: 1 } }}>
        {plan.retirements.map((retirement) => (
          <li key={retirement.id}>
            <Typography variant="body2">
              Retire original {facilityDisplayName(retirement)} by{" "}
              {month(retirement.deadlineMonth)}. Check replacement supply before
              selling. {startBy(retirement.startMonth)}
            </Typography>
          </li>
        ))}
      </Box>
      <UtilityContractSchedule game={game} showReference={false} />
    </Box>
  );
}
