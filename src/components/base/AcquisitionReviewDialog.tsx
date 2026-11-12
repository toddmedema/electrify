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
  const contractChange = valley
    ? !nuclear
      ? "Valley’s inherited nuclear purchase has expired."
      : game.date.year >= 2017
        ? `Valley’s nuclear purchase is now ${formatWatts(nuclear.nominalW)} (${formatWatts(nuclear.deliverableW)} deliverable), reduced in January 2017.`
        : ""
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
          value: `${formatMoneyConcise(quote.cashDue)} upfront`,
          detail: `${formatMoneyConcise(quote.cashMonthlyDebtService + quote.networkOMPerMonth)}/mo · debt + network upkeep.`,
        },
        loan: {
          value: `${formatMoneyConcise(quote.financedCashDue)} upfront`,
          detail: `${formatMoneyConcise(quote.monthlyDebtService + quote.networkOMPerMonth)}/mo · debt + network upkeep.`,
        },
      }}
      preface={
        <div className="acquisitionReviewIntro">
          <Typography className="acquisitionCustomerGain" component="p">
            <strong>{Math.round(quote.customers).toLocaleString()}</strong>{" "}
            customers joining
          </Typography>
          <Typography variant="body2" color="textSecondary">
            Company supply margin{" "}
            <span className="acquisitionMargin">
              {preview
                ? `${marginText(preview.beforeMarginW)} → ${marginText(preview.afterMarginW)}`
                : "Forecast unavailable"}
            </span>
          </Typography>
          {error && (
            <Typography role="alert" color="error">
              {error}
            </Typography>
          )}
          {cash < quote.financedCashDue && (
            <Typography variant="body2" color="warning.main">
              Need {formatMoneyConcise(quote.financedCashDue)} cash for the down
              payment and fee. You have {formatMoneyConcise(cash)}.
            </Typography>
          )}
        </div>
      }
      afterFacts={
        <div className="acquisitionReviewDetails">
          <Typography variant="caption" color="textSecondary" component="p">
            Both options include inherited debt and current network upkeep.
            Plant operations and purchased power are extra.
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
                <li>
                  Retire the acquired original oil plants by December 2023.
                </li>
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
              <dl className="acquisitionInventory">
                {[...quote.facilities]
                  .sort((a, b) => b.peakW - a.peakW)
                  .map((facility) => (
                    <div key={facility.startingAssetId}>
                      <dt>{facilityDisplayName(facility)}</dt>
                      <dd>
                        {formatWatts(facility.peakW)} ·{" "}
                        {facility.ageYears.toFixed(1)} years old
                      </dd>
                    </div>
                  ))}
              </dl>
              <Typography component="h3" variant="subtitle2">
                Purchased power
              </Typography>
              <dl className="acquisitionInventory">
                {quote.contracts.map((contract) => (
                  <div key={contract.name}>
                    <dt>{contract.name}</dt>
                    <dd>
                      {contract.balancing ? "Up to " : ""}
                      {formatWatts(contract.deliverableW)} delivered
                      <span>
                        {formatMoneyConcise(contract.pricePerMWh)}/MWh
                        {contract.balancing
                          ? " reference · variable availability, not firm reserve"
                          : ""}
                      </span>
                    </dd>
                  </div>
                ))}
              </dl>
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
              <dl className="acquisitionInventory">
                <div>
                  <dt>Purchase price</dt>
                  <dd>{formatMoneyConcise(quote.equityPrice)}</dd>
                </div>
                <div>
                  <dt>Transaction fee</dt>
                  <dd>
                    {formatMoneyConcise(quote.fee)}
                    <span>Paid in cash with either option</span>
                  </dd>
                </div>
                <div>
                  <dt>Inherited debt</dt>
                  <dd>
                    {formatMoneyConcise(quote.assumedDebt)}
                    <span>
                      5% over 20 years ·{" "}
                      {formatMoneyConcise(quote.cashMonthlyDebtService)}/mo
                    </span>
                  </dd>
                </div>
                <div>
                  <dt>New loan</dt>
                  <dd>
                    {formatMoneyConcise(quote.newLoan)}
                    <span>
                      {(game.interestRate * 100).toFixed(2)}% over{" "}
                      {LOAN_MONTHS / 12} years ·{" "}
                      {formatMoneyConcise(
                        quote.monthlyDebtService - quote.cashMonthlyDebtService,
                      )}
                      /mo
                    </span>
                  </dd>
                </div>
                <div>
                  <dt>Added network upkeep</dt>
                  <dd>
                    {formatMoneyConcise(quote.networkOMPerMonth)}/mo
                    <span>At today’s costs</span>
                  </dd>
                </div>
              </dl>
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
