import {
  agreementDate,
  connectionAgreements,
  INHERITED_CONNECTIONS,
} from "../../helpers/PowerAgreements";
import type { UtilityId } from "../../Types";
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
      {(Object.keys(INHERITED_CONNECTIONS) as UtilityId[])
        .filter(
          (id) =>
            id === "champlain" ||
            game.utilityExpansion?.acquisitions.some(
              (receipt) => receipt.targetId === id,
            ),
        )
        .flatMap((id) =>
          connectionAgreements(game, id)
            .filter(
              (source) =>
                !source.inherited && source.endMinute > game.date.minute,
            )
            .map((source) => (
              <Typography key={source.id} variant="body2" sx={{ mb: 1 }}>
                {source.name}: signed replacement covers{" "}
                {formatWatts(source.nominalW * source.deliverability)},{" "}
                {agreementDate(source.startMinute)}–
                {agreementDate(source.endMinute, true)}. Delivery shares the
                inherited regional connection.
              </Typography>
            )),
        )}
      <Typography variant="body2" color="textSecondary" sx={{ mb: 1 }}>
        Inherited regional connections remain available for market purchases
        after agreement coverage changes.
      </Typography>
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
