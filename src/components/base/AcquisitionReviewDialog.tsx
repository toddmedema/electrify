import * as React from "react";
import { Button, Typography } from "@mui/material";
import DecisionDialog from "./DecisionDialog";
import { AcquireUtilityAction, GameType } from "../../Types";
import { useAppDispatch } from "../../Store";
import {
  openPolicyDecision,
  closePolicyDecision,
} from "../../reducers/GameActions";
import { previewUtilityAcquisition } from "../../reducers/Game";
import { acquisitionQuote } from "../../helpers/Expansion";
import { formatMoneyConcise, formatWatts } from "../../helpers/Format";
import { currentTick } from "../../helpers/GameSelectors";
import PurchaseReviewDialog from "./PurchaseReviewDialog";
import { useBuildCash } from "./useBuildCash";
import { LOAN_MONTHS } from "../../Constants";
import UtilityContractSchedule from "./UtilityContractSchedule";
import { facilityDisplayName } from "./FacilityLabels";

interface Props {
  game: GameType;
  targetId: string;
  onClose: () => void;
  onAcquire: (payload: AcquireUtilityAction) => boolean | Promise<boolean>;
}

function marginText(marginW: number): string {
  return marginW < 0
    ? `${formatWatts(-marginW)} shortfall`
    : `${formatWatts(marginW)} spare`;
}

/** Reviews the same dated seller snapshot that the owning purchase API validates. */
export default function AcquisitionReviewDialog({
  game,
  targetId,
  onClose,
  onAcquire,
}: Props): React.JSX.Element | null {
  const dispatch = useAppDispatch();
  const [error, setError] = React.useState<string>();
  React.useEffect(() => {
    const token = `acquisition:${targetId}`;
    dispatch(openPolicyDecision(token));
    return () => {
      dispatch(closePolicyDecision(token));
    };
  }, [dispatch, targetId]);
  const quote = acquisitionQuote(game, targetId);
  const cash = useBuildCash(currentTick(game)?.cash ?? 0);
  const preview = React.useMemo(
    () => previewUtilityAcquisition(game, targetId, true),
    [game, targetId],
  );
  if (!quote)
    return (
      <DecisionDialog
        open
        title="Acquisition unavailable"
        onClose={onClose}
        actions={<Button onClick={onClose}>Cancel</Button>}
      >
        <Typography role="alert">
          This utility is no longer available to acquire. Review your
          connections and current ownership.
        </Typography>
      </DecisionDialog>
    );
  const valley = quote.targetId === "valley-electric";
  const nuclear = quote.contracts.find(
    (contract) => contract.name === "Regional nuclear",
  );
  const sharedCosts = `${formatMoneyConcise(quote.assumedDebt)} assumed debt at 5% for 20 years and current network costs included; network costs grow with customers. Plant operations and purchased power vary.`;
  const contractChange = valley
    ? !nuclear
      ? "Valley’s inherited nuclear purchase has expired."
      : game.date.year >= 2017
        ? `Valley’s nuclear contract is now ${formatWatts(nuclear.nominalW)} (${formatWatts(nuclear.deliverableW)} deliverable), reduced in January 2017.`
        : "Valley’s nuclear contract falls from 160MW to 80MW in January 2017 (152MW to 76MW deliverable)."
    : "";

  return (
    <PurchaseReviewDialog
      open
      title={`Acquire ${quote.name}?`}
      titleId="utility-acquisition-title"
      cash={cash}
      buildCost={quote.equityPrice}
      cashOnlyFee={quote.fee}
      interestRate={game.interestRate}
      cancelLabel="Cancel"
      upkeepPerMonth={quote.networkOMPerMonth}
      paymentSummary={{
        cash: {
          value: `${formatMoneyConcise(quote.cashDue)} upfront + ${formatMoneyConcise(quote.cashMonthlyDebtService + quote.networkOMPerMonth)}/mo`,
          detail: `${formatMoneyConcise(quote.fee)} fee included. ${sharedCosts}`,
        },
        loan: {
          value: `${formatMoneyConcise(quote.financedCashDue)} upfront + ${formatMoneyConcise(quote.monthlyDebtService + quote.networkOMPerMonth)}/mo`,
          detail: `${formatMoneyConcise(quote.fee)} fee included. New loan: ${(game.interestRate * 100).toFixed(2)}% for ${LOAN_MONTHS / 12} years. ${sharedCosts}`,
        },
      }}
      preface={
        error || cash < quote.financedCashDue ? (
          <div className="acquisitionReviewIntro">
            {error && (
              <Typography role="alert" color="error">
                {error}
              </Typography>
            )}
            {cash < quote.financedCashDue && (
              <Typography variant="body2" color="warning.main">
                Need {formatMoneyConcise(quote.financedCashDue)} cash for the
                down payment and fee. You have {formatMoneyConcise(cash)}.
              </Typography>
            )}
          </div>
        ) : undefined
      }
      afterFacts={
        <UtilityContractSchedule game={game} targetId={quote.targetId} />
      }
      extraFacts={[
        {
          concept: "customers",
          label: "Customers joining",
          value: Math.round(quote.customers).toLocaleString(),
        },
        {
          concept: "goal",
          label: "Acquisition obligations",
          value: "Acquire either utility by December 2014.",
          detail: `Retire acquired original oil plants by December 2023 and retain 90% of your expanded customer base at the end of 2024. Acquisitions after 2023 exclude the original oil plant.${contractChange ? `\n\n${contractChange}` : ""}`,
        },
        {
          concept: "supply",
          label: "Company supply margin",
          value: preview
            ? `${marginText(preview.beforeMarginW)} → ${marginText(preview.afterMarginW)}`
            : "Forecast unavailable",
        },
        {
          concept: "money",
          label: "Projected month-end cash with financing",
          value: preview
            ? `${formatMoneyConcise(preview.beforeMonthlyCash)} → ${formatMoneyConcise(preview.afterMonthlyCash)}`
            : "Forecast unavailable",
        },
        {
          concept: "supply",
          label: "Operating plants",
          value: quote.facilities
            .map(
              (facility) =>
                `${facilityDisplayName(facility)} ${formatWatts(facility.peakW)}`,
            )
            .join(" · "),
          detail: quote.facilities
            .map(
              (facility) =>
                `${facilityDisplayName(facility)}: ${facility.ageYears.toFixed(1)} years old`,
            )
            .join(" · "),
        },
        {
          concept: "supply",
          label: "Purchased power",
          value:
            quote.contracts
              .map(
                (contract) =>
                  `${contract.name}: ${contract.balancing ? "up to " : ""}${formatWatts(contract.deliverableW)}${contract.balancing ? " · variable availability" : ""}`,
              )
              .join(" · ") || "No inherited purchased-power rights remain.",
          detail: quote.contracts
            .map(
              (contract) =>
                `${contract.name}: ${formatMoneyConcise(contract.pricePerMWh)}/MWh ${contract.balancing ? "reference; price and availability vary. Not firm reserve." : "delivered"}`,
            )
            .join(" · "),
        },
      ]}
      onClose={onClose}
      onPurchase={async (financed) => {
        setError(undefined);
        try {
          const accepted = await onAcquire({
            targetId: quote.targetId,
            financed,
            quoteKey: quote.quoteKey,
          });
          if (accepted) {
            onClose();
            return true;
          }
          setError(
            "The deal changed or cash is insufficient. Review the current terms and try again.",
          );
        } catch (reason) {
          setError(
            reason instanceof Error
              ? reason.message
              : "The purchase could not be completed. Please try again.",
          );
        }
        return false;
      }}
    />
  );
}
