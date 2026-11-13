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
import {
  formatCount,
  formatMoneyConcise,
  formatNumber,
  formatPercent,
  formatWatts,
  formatForecastWatts,
} from "../../helpers/Format";
import { currentTick } from "../../helpers/GameSelectors";
import PurchaseReviewDialog from "./PurchaseReviewDialog";
import DecisionImpactPreview from "./DecisionImpactPreview";
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
    ? `${formatForecastWatts(-marginW)} shortfall`
    : `${formatForecastWatts(marginW)} spare`;
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
  const now = currentTick(game);
  const cash = useBuildCash(now?.cash ?? 0);
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
  const customersBefore = now?.customers ?? 0;
  const customersAfter = customersBefore + quote.customers;
  const customerGrowth =
    customersBefore > 0
      ? ` (+${formatPercent(quote.customers / customersBefore)})`
      : "";
  const nuclear = quote.contracts.find(
    (contract) => contract.name === "Regional nuclear",
  );
  const contractChange = valley
    ? !nuclear
      ? "Valley’s inherited nuclear purchase has expired."
      : game.date.year >= 2017
        ? `Valley’s nuclear purchase is now ${formatWatts(nuclear.deliverableW)}, reduced in January 2017.`
        : "Valley’s nuclear purchase falls from 152 to 76 MW in January 2017."
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
      upkeepPerMonth={quote.networkOMPerMonth}
      cashLabel="Cash option"
      paymentSummary={{
        cash: {
          value: `${formatMoneyConcise(quote.cashDue)} now + ${formatMoneyConcise(quote.cashMonthlyDebtService + quote.networkOMPerMonth)}/mo`,
        },
        loan: {
          value: `${formatMoneyConcise(quote.financedCashDue)} now + ${formatMoneyConcise(quote.monthlyDebtService + quote.networkOMPerMonth)}/mo`,
        },
      }}
      extraFacts={[
        {
          concept: "customers",
          label: "Customers",
          value: `${formatCount(customersBefore)} → ${formatCount(customersAfter)}${customerGrowth}`,
        },
        {
          concept: "supply",
          label: "Supply margin",
          value: preview
            ? `${formatForecastWatts(preview.beforeMarginW)} → ${marginText(preview.afterMarginW)}`
            : "Forecast unavailable",
        },
      ]}
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
        <div className="acquisitionReviewDetails">
          <Typography variant="caption" color="textSecondary" component="p">
            Monthly figures include debt and network upkeep.
          </Typography>
          <section
            className="acquisitionObligations"
            aria-label="Acquisition obligations"
          >
            <Typography component="h3" variant="subtitle2">
              Your commitments
            </Typography>
            <ul>
              {game.date.year <= 2023 && (
                <li>Retire the acquired oil plants by December 2023.</li>
              )}
              <li>
                Retain 90% of your expanded customer base at the end of 2024.
              </li>
            </ul>
          </section>
          <details className="acquisitionDisclosure">
            <summary>Plants &amp; purchased power</summary>
            <div>
              <Typography component="h3" variant="subtitle2">
                Operating plants
              </Typography>
              <DecisionImpactPreview
                label="Operating plants"
                facts={[...quote.facilities]
                  .sort((a, b) => b.peakW - a.peakW)
                  .map((facility) => ({
                    concept: "supply",
                    label: facilityDisplayName(facility),
                    value: formatWatts(facility.peakW),
                    detail: `${formatNumber(facility.ageYears)} years old`,
                  }))}
              />
              <Typography component="h3" variant="subtitle2">
                Purchased power
              </Typography>
              {!!quote.contracts.length && (
                <DecisionImpactPreview
                  label="Purchased power"
                  facts={quote.contracts.map((contract) => ({
                    concept: "supply",
                    label: contract.name,
                    value: `${contract.balancing ? "Up to " : ""}${formatWatts(contract.deliverableW)} delivered`,
                    detail: `${formatMoneyConcise(contract.pricePerMWh)}/MWh${contract.balancing ? " reference · variable price and availability, not firm reserve" : ""}`,
                  }))}
                />
              )}
              {!quote.contracts.length && (
                <Typography variant="body2">
                  No inherited purchased-power rights remain.
                </Typography>
              )}
              {contractChange && (
                <Typography variant="body2" color="textSecondary">
                  {contractChange}
                </Typography>
              )}
            </div>
          </details>
          <details className="acquisitionDisclosure">
            <summary>Financing breakdown</summary>
            <div>
              <DecisionImpactPreview
                label="Financing breakdown"
                facts={[
                  {
                    concept: "money",
                    label: "Purchase price",
                    value: formatMoneyConcise(quote.equityPrice),
                  },
                  {
                    concept: "money",
                    label: "Transaction fee",
                    value: formatMoneyConcise(quote.fee),
                    detail: "Paid in cash with either option",
                  },
                  {
                    concept: "finances",
                    label: "Inherited debt",
                    value: formatMoneyConcise(quote.assumedDebt),
                    detail: `5% over 20 years · ${formatMoneyConcise(quote.cashMonthlyDebtService)}/mo`,
                  },
                  {
                    concept: "finances",
                    label: "New loan",
                    value: formatMoneyConcise(quote.newLoan),
                    detail: `${formatNumber(game.interestRate * 100)}% over ${LOAN_MONTHS / 12} years · ${formatMoneyConcise(quote.monthlyDebtService - quote.cashMonthlyDebtService)}/mo`,
                  },
                  {
                    concept: "money",
                    label: "Added network upkeep",
                    value: `${formatMoneyConcise(quote.networkOMPerMonth)}/mo`,
                    detail: "At today’s costs",
                  },
                ]}
              />
            </div>
          </details>
          <details className="acquisitionDisclosure">
            <summary>Supply &amp; network changes</summary>
            <div>
              <UtilityContractSchedule game={game} targetId={quote.targetId} />
            </div>
          </details>
        </div>
      }
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
