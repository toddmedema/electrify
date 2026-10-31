import * as React from "react";
import { Box, Typography } from "@mui/material";
import type { GameType, UtilityTargetId } from "../../Types";
import { utilityPlanning } from "../../helpers/UtilityPlanning";
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
  const month = (index: number) =>
    `${MONTHS[((index % 12) + 12) % 12]} ${game.startingYear + Math.floor(index / 12)}`;
  return (
    <Box sx={{ my: 1 }}>
      {!!plan.supplyChanges.length && (
        <Typography component="h3" variant="subtitle2">
          Supply changes to prepare for
        </Typography>
      )}
      <Box component="ul" sx={{ pl: 2.5, my: 1, "& li": { mb: 1 } }}>
        {plan.supplyChanges.map((change) => (
          <li key={`${change.utility}-${change.year}`}>
            <Typography variant="body2">
              {change.utility}, January {change.year}:{" "}
              {change.contracts
                .map((source) =>
                  source.nominalW === 0
                    ? `${source.name} ends`
                    : `${source.name} falls to ${formatWatts(source.nominalW * source.deliverability)} deliverable`,
                )
                .join("; ")}
              .
              {change.startMonth !== undefined &&
                ` For the reference project, start by ${month(change.startMonth)}.`}
            </Typography>
          </li>
        ))}
      </Box>
      <Typography variant="body2" sx={{ mb: 1 }}>
        Fictional service-network renewal plan:{" "}
        {UTILITY_NETWORK_RENEWAL_STAGES.map(
          (stage) =>
            `${stage.multiplier}× opening upkeep from January ${stage.year}`,
        ).join("; ")}
        , before separate customer-growth and inflation adjustments. Reserve
        working capital for these recurring costs.
      </Typography>
      {showReference &&
        !!plan.supplyChanges.length &&
        plan.buildMonths !== undefined && (
          <Typography variant="caption" color="textSecondary">
            A 150 MW combined-cycle gas plant takes {plan.buildMonths} months at
            today’s quote. Compare capacity, technology and lead time with your
            demand forecast.
          </Typography>
        )}
    </Box>
  );
}
