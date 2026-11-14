import * as React from "react";
import { Box, Button, Typography } from "@mui/material";
import type { GameType } from "../../Types";
import { utilityOffer } from "../../helpers/Expansion";
import { activeScenario } from "../../helpers/GameSelectors";
import { scenarioObjectiveDefinitions } from "../../helpers/ObjectiveRules";
import { objectiveGoalGroups } from "../../helpers/ObjectivePresentation";
import {
  formatMoneyConcise,
  formatCount,
  formatWatts,
  formatWattHours,
} from "../../helpers/Format";
import { UTILITY_AREAS } from "../../data/UtilityExpansion";
import DecisionDialog from "./DecisionDialog";
import BuildDetails, { BuildDetailRow } from "./BuildDetails";
import { useAppDispatch } from "../../Store";
import {
  openPolicyDecision,
  closePolicyDecision,
} from "../../reducers/GameActions";
import UtilityContractSchedule from "./UtilityContractSchedule";
import { facilityDisplayName } from "./FacilityLabels";

/** Information only: the purchase API still requires a finished connection and fresh quote. */
export default function UtilityOfferDialog({
  game,
  targetId,
  onClose,
}: {
  game: GameType;
  targetId: string;
  onClose: () => void;
}) {
  const dispatch = useAppDispatch();
  React.useEffect(() => {
    const token = `company-terms:${targetId}`;
    dispatch(openPolicyDecision(token));
    return () => {
      dispatch(closePolicyDecision(token));
    };
  }, [dispatch, targetId]);
  const offer = utilityOffer(game, targetId);
  if (!offer)
    return (
      <DecisionDialog
        open
        closable
        title="Acquisition terms unavailable"
        onClose={onClose}
        actions={<Button onClick={onClose}>Back to connections</Button>}
      >
        <Typography role="alert">
          This company is no longer available to acquire. Return to your
          connections and review current ownership.
        </Typography>
      </DecisionDialog>
    );
  const money = formatMoneyConcise;
  const scenario = activeScenario(game);
  const seller = UTILITY_AREAS[offer.targetId];
  const nuclear = offer.contracts.find(
    (contract) => contract.name === "Regional nuclear",
  );
  return (
    <DecisionDialog
      open
      fullWidth
      maxWidth="sm"
      closable
      title="Acquisition terms"
      contentClassName="acquisitionTermsContent"
      onClose={onClose}
      actions={<Button onClick={onClose}>Back to connections</Button>}
    >
      <Typography variant="body2" sx={{ mb: 2 }}>
        Connect to {offer.name} first, then acquire it separately. Terms may
        change before purchase.
      </Typography>
      <BuildDetails label={`${offer.name} acquisition terms`}>
        <BuildDetailRow label="Price" value={money(offer.cashDue)} />
        <BuildDetailRow label="Assumed debt" value={money(offer.assumedDebt)} />
        <BuildDetailRow
          label="Customers"
          value={formatCount(offer.customers)}
        />
        <BuildDetailRow
          label="Loan down payment"
          value={money(offer.financedCashDue)}
        />
        <BuildDetailRow
          label="Debt & upkeep · cash"
          value={`${money(offer.cashMonthlyDebtService + offer.networkOMPerMonth)}/mo`}
        />
        <BuildDetailRow
          label="Debt & upkeep · loan"
          value={`${money(offer.monthlyDebtService + offer.networkOMPerMonth)}/mo`}
        />
      </BuildDetails>
      <Typography variant="body2" color="textSecondary" sx={{ mb: 1 }}>
        Price and down payment include fees. Assumed debt transfers with either
        option.
      </Typography>
      <Typography variant="body2" color="textSecondary" sx={{ mb: 2 }}>
        Includes {money(offer.networkOMPerMonth)}/mo in network upkeep, which
        rises with customer growth and inflation. Plant operations and power
        purchases cost extra.
      </Typography>
      <details className="acquisitionDisclosure">
        <summary>Plants &amp; purchased power</summary>
        <div>
          <Typography component="h3" variant="subtitle2">
            Operating plants
          </Typography>
          <Box component="ul" sx={{ pl: 2.5, my: 1, "& li + li": { mt: 1 } }}>
            {offer.facilities.map((facility) => (
              <Typography
                component="li"
                variant="body2"
                key={facility.startingAssetId}
              >
                {facilityDisplayName(facility)} · {formatWatts(facility.peakW)}{" "}
                · {facility.ageYears.toFixed(0)} years old
              </Typography>
            ))}
          </Box>
          <Typography component="h3" variant="subtitle2">
            Purchased power
          </Typography>
          {offer.contracts.length ? (
            <Box component="ul" sx={{ pl: 2.5, my: 1, "& li + li": { mt: 1 } }}>
              {offer.contracts.map((contract) => (
                <Typography component="li" variant="body2" key={contract.name}>
                  {contract.name}: {contract.balancing ? "up to " : ""}
                  {formatWatts(contract.deliverableW)} at{" "}
                  {money(contract.pricePerMWh)}/MWh
                  {contract.balancing ? " (variable, not firm reserve)" : ""}
                </Typography>
              ))}
            </Box>
          ) : (
            <Typography variant="body2">
              No inherited purchased-power rights remain.
            </Typography>
          )}
          {targetId === "valley-electric" &&
            (!nuclear || game.date.year >= 2017) && (
              <Typography variant="body2" color="textSecondary" sx={{ mt: 1 }}>
                {!nuclear
                  ? "Valley’s inherited nuclear purchase has expired."
                  : `Valley’s nuclear purchase is now ${formatWatts(nuclear.deliverableW)} deliverable, reduced in January 2017.`}
              </Typography>
            )}
        </div>
      </details>
      <details className="acquisitionDisclosure">
        <summary>Demand reference · January 2005</summary>
        <div>
          <Typography variant="body2">
            {formatCount(seller.customers)} accounts ·{" "}
            {formatWattHours(seller.annualEnergyMWh * 1e6)} annual delivered
            energy · {formatWatts(seller.peakDemandW)} peak demand.
          </Typography>
          <Typography variant="body2" color="textSecondary" sx={{ mt: 1 }}>
            Historical baseline; today’s customers are shown above. Tariffs and
            growth change demand. Utility peaks do not add to a combined peak.
          </Typography>
          {targetId === "ridge-electric" && (
            <Typography variant="body2" color="textSecondary" sx={{ mt: 1 }}>
              Ridge has steadier industrial demand, with greater exposure to gas
              prices and wind.
            </Typography>
          )}
        </div>
      </details>
      <details className="acquisitionDisclosure">
        <summary>Supply &amp; network changes</summary>
        <div>
          <UtilityContractSchedule game={game} targetId={offer.targetId} />
        </div>
      </details>
      <details className="acquisitionDisclosure">
        <summary>Scenario goals</summary>
        <div>
          {objectiveGoalGroups(
            scenarioObjectiveDefinitions(scenario, game),
            game.startingYear,
            scenario?.durationMonths ?? 240,
          ).map((objective) => (
            <Box key={objective.id} sx={{ mt: 1 }}>
              {objective.goals.length > 1 && (
                <Typography variant="body2" sx={{ fontWeight: 600 }}>
                  {objective.label}
                </Typography>
              )}
              {objective.goals.map((goal) => (
                <Typography key={goal} variant="body2">
                  {goal}
                  {objective.required ? "" : " (optional)"}
                </Typography>
              ))}
            </Box>
          ))}
        </div>
      </details>
    </DecisionDialog>
  );
}
