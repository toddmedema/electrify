import * as React from "react";
import { Box, Typography } from "@mui/material";
import type { GameType, UtilityTargetId } from "../../Types";
import {
  utilityPlanning,
  UTILITY_PLANNING_REFERENCE_W,
} from "../../helpers/UtilityPlanning";
import { MONTHS } from "../../Constants";
import { formatWatts } from "../../helpers/Format";
import { UTILITY_NETWORK_RENEWAL_STAGES } from "../../data/UtilityExpansion";

/** Both company reviews include inherited base-company changes, not only the seller's risks. */
export default function UtilityContractSchedule({
  game,
  targetId,
  showReference = true,
}: {
  game: GameType;
  targetId?: UtilityTargetId;
  showReference?: boolean;
}) {
  const plan = utilityPlanning(game, undefined, targetId);
  if (!plan) return null;
  const month = (value: number) =>
    `${MONTHS[((value % 12) + 12) % 12]} ${game.startingYear + Math.floor(value / 12)}`;
  return (
    <Box sx={{ mt: 2 }}>
      {!!plan.supplyChanges.length && (
        <>
          <Typography component="h4" variant="subtitle2">
            Purchased power
          </Typography>
          <Box component="ul" sx={{ pl: 2.5, my: 1, "& li + li": { mt: 1 } }}>
            {plan.supplyChanges.map((change) => (
              <li key={`${change.utility}-${change.year}`}>
                <Typography variant="body2">
                  <strong>
                    Jan {change.year} · {change.utility}:
                  </strong>{" "}
                  {change.contracts
                    .map((source) =>
                      source.nominalW === 0
                        ? `${source.name} ends`
                        : `${source.name} falls to ${formatWatts(source.nominalW * source.deliverability)} deliverable`,
                    )
                    .join("; ")}
                  .
                  {change.startMonth !== undefined && (
                    <Typography
                      component="span"
                      variant="body2"
                      color="textSecondary"
                      sx={{ display: "block" }}
                    >
                      {change.startMonth < game.date.monthsElapsed
                        ? "Gas example: would need to be underway."
                        : `Gas example: order by ${month(change.startMonth)}.`}
                    </Typography>
                  )}
                </Typography>
              </li>
            ))}
          </Box>
        </>
      )}
      <Typography component="h4" variant="subtitle2" sx={{ mt: 2 }}>
        Network upkeep
      </Typography>
      <Box component="ul" sx={{ pl: 2.5, my: 1, "& li + li": { mt: 1 } }}>
        {UTILITY_NETWORK_RENEWAL_STAGES.map((stage) => (
          <li key={stage.year}>
            <Typography variant="body2">
              <strong>Jan {stage.year}:</strong> {stage.multiplier}× opening
              upkeep.
            </Typography>
          </li>
        ))}
      </Box>
      <Typography variant="body2" color="textSecondary">
        Budget for these recurring costs, plus customer growth and inflation.
      </Typography>
      {showReference &&
        !!plan.supplyChanges.length &&
        plan.buildMonths !== undefined && (
          <Typography variant="body2" color="textSecondary" sx={{ mt: 1 }}>
            <strong>Build-time example:</strong> a{" "}
            {formatWatts(UTILITY_PLANNING_REFERENCE_W)} combined-cycle gas plant
            takes {plan.buildMonths} months. Check capacity and lead times for
            your chosen projects.
          </Typography>
        )}
    </Box>
  );
}
