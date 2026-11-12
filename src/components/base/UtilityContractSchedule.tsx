import * as React from "react";
import { Box, Typography } from "@mui/material";
import type { GameType, UtilityTargetId } from "../../Types";
import { utilityPlanning } from "../../helpers/UtilityPlanning";
import { formatWatts } from "../../helpers/Format";
import { UTILITY_NETWORK_RENEWAL_STAGES } from "../../data/UtilityExpansion";

/** Both company reviews include inherited base-company changes, not only the seller's risks. */
export default function UtilityContractSchedule({
  game,
  targetId,
}: {
  game: GameType;
  targetId?: UtilityTargetId;
}) {
  const plan = utilityPlanning(game, undefined, targetId);
  if (!plan) return null;
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
        Excludes customer growth and inflation.
      </Typography>
    </Box>
  );
}
