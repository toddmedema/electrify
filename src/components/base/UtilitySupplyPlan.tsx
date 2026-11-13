import * as React from "react";
import { Box, Typography } from "@mui/material";
import type { GameType } from "../../Types";
import type { ProjectionView } from "../../helpers/Projection";
import { utilityPlanning } from "../../helpers/UtilityPlanning";
import { MONTHS } from "../../Constants";
import {
  formatForecastWatts as formatWatts,
  formatForecastNumber,
} from "../../helpers/Format";
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
  return (
    <Box component="section" aria-label="Supply plan">
      <Typography component="h3" variant="subtitle1" sx={{ fontWeight: 600 }}>
        Supply plan
      </Typography>
      <Typography variant="body2" sx={{ mt: 1 }}>
        {plan.nextCustomers === undefined || plan.nextPeakW === undefined
          ? "Updating demand forecast…"
          : `Next year at current rates and policies: ${formatForecastNumber(plan.nextCustomers)} customers · ${formatWatts(plan.nextPeakW)} peak demand.`}
      </Typography>
      <Box component="ul" sx={{ pl: 2.5, my: 1, "& li + li": { mt: 1 } }}>
        {plan.gap && (
          <li>
            <Typography variant="body2" color="warning.main">
              <strong>
                Service risk · {plan.gap.date.month} {plan.gap.date.year}:
              </strong>{" "}
              Monthly demand served is projected below{" "}
              {formatRequiredShare(plan.serviceThreshold)}.
            </Typography>
          </li>
        )}
        {plan.retirements.map((retirement) => (
          <li key={retirement.id}>
            <Typography variant="body2">
              <strong>{facilityDisplayName(retirement)}:</strong> retirement due{" "}
              {month(retirement.deadlineMonth)}.
            </Typography>
          </li>
        ))}
      </Box>
      <UtilityContractSchedule game={game} />
    </Box>
  );
}
