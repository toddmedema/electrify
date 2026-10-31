import * as React from "react";
import { Button, Typography } from "@mui/material";
import type { GameType } from "../../Types";
import { utilityOffer } from "../../helpers/Expansion";
import { activeScenario, currentTick } from "../../helpers/GameSelectors";
import { scenarioObjectiveDefinitions } from "../../helpers/ObjectiveRules";
import { objectiveGoalText } from "../../helpers/ObjectivePresentation";
import {
  formatMoneyConcise,
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
        title="Company terms unavailable"
        onClose={onClose}
        actions={<Button onClick={onClose}>Back to connections</Button>}
      >
        <Typography role="alert">
          This company is no longer available to acquire. Return to your
          connections and review current ownership.
        </Typography>
      </DecisionDialog>
    );
  const cash = currentTick(game)?.cash ?? 0;
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
      title={`${offer.name} company terms`}
      onClose={onClose}
      actions={<Button onClick={onClose}>Back to connections</Button>}
    >
      <Typography variant="body2" sx={{ mb: 2 }}>
        Connect first, then review and acquire the company separately. These are
        today’s terms; prices and customer counts change before you buy.
      </Typography>
      <BuildDetails label={`${offer.name} company terms`}>
        <BuildDetailRow
          label="Equity price + fee"
          value={`${money(offer.equityPrice)} + ${money(offer.fee)}`}
        />
        <BuildDetailRow label="Assumed debt" value={money(offer.assumedDebt)} />
        <BuildDetailRow
          label="Customers joining today"
          value={Math.round(offer.customers).toLocaleString()}
        />
        <BuildDetailRow label="Cash purchase" value={money(offer.cashDue)} />
        <BuildDetailRow
          label="Financed cash due"
          value={money(offer.financedCashDue)}
        />
        <BuildDetailRow label="Your cash" value={money(cash)} />
        <BuildDetailRow
          label="Cash covers today’s offer"
          value={`Cash purchase: ${cash >= offer.cashDue ? "yes" : "no"} · Financed down payment: ${cash >= offer.financedCashDue ? "yes" : "no"}`}
        />
        <BuildDetailRow
          label="Debt payments with financing"
          value={`${money(offer.monthlyDebtService)}/mo`}
        />
        <BuildDetailRow
          label="Debt payments after cash purchase"
          value={`${money(offer.cashMonthlyDebtService)}/mo`}
        />
        <BuildDetailRow
          label="Added service-network costs"
          value={`${money(offer.networkOMPerMonth)}/mo today; rises with customer growth`}
        />
        <BuildDetailRow
          label="Operating plants"
          value={offer.facilities
            .map(
              (facility) =>
                `${facilityDisplayName(facility)} ${formatWatts(facility.peakW)} (${facility.ageYears.toFixed(0)} years old)`,
            )
            .join(" · ")}
        />
        <BuildDetailRow
          label="Purchased power"
          value={
            offer.contracts
              .map(
                (contract) =>
                  `${contract.name}: ${contract.balancing ? "up to " : ""}${formatWatts(contract.deliverableW)} at ${money(contract.pricePerMWh)}/MWh${contract.balancing ? " (variable, not firm reserve)" : ""}`,
              )
              .join(" · ") || "No inherited purchased-power rights remain."
          }
        />
      </BuildDetails>
      <Typography component="h3" variant="subtitle2" sx={{ mt: 2 }}>
        Seller load reference · January 2005
      </Typography>
      <Typography variant="body2" sx={{ mt: 1 }}>
        {Math.round(seller.customers).toLocaleString()} opening accounts ·{" "}
        {formatWattHours(seller.annualEnergyMWh * 1e6)} annual delivered energy
        · {formatWatts(seller.peakDemandW)} peak demand.
      </Typography>
      <Typography variant="body2" color="textSecondary" sx={{ mt: 1 }}>
        These are the seller’s fixed-account opening load figures. Today’s
        customers appear above; tariffs, growth and the combined demand profile
        change the load after acquisition. Individual utility peaks do not add
        to a combined-company peak.
      </Typography>
      <UtilityContractSchedule game={game} targetId={offer.targetId} />
      <Typography variant="body2" color="warning.main" sx={{ mt: 2 }}>
        {targetId === "valley-electric"
          ? !nuclear
            ? "Valley’s inherited nuclear purchase has expired."
            : game.date.year >= 2017
              ? `Valley’s nuclear purchase is now ${formatWatts(nuclear.deliverableW)} deliverable, reduced in January 2017.`
              : "Valley’s nuclear purchase falls from 152 to 76 MW deliverable in January 2017."
          : "Ridge has steadier industrial demand, with greater exposure to gas prices and wind."}
      </Typography>
      <Typography component="h3" variant="subtitle2" sx={{ mt: 2 }}>
        Scenario obligations
      </Typography>
      {scenarioObjectiveDefinitions(scenario, game).map((objective) => (
        <Typography key={objective.id} variant="body2" sx={{ mt: 1 }}>
          {objectiveGoalText(
            objective,
            game.startingYear,
            scenario?.durationMonths ?? 240,
          )}
          {objective.required ? "" : " (optional)"}
        </Typography>
      ))}
    </DecisionDialog>
  );
}
