import { currencyForLocation } from "../../helpers/Currency";
import { useMoney } from "./CurrencyContext";
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
import { acquisitionQuote, utilityOffer } from "../../helpers/Expansion";
import {
  formatCount,
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
import { TERRITORY_TILES } from "../../data/TerritoryTiles";

interface Props {
  game: GameType;
  targetId: string;
  onClose: () => void;
  onAcquire?: (payload: AcquireUtilityAction) => boolean | Promise<boolean>;
}

function marginText(marginW: number): string {
  return marginW < 0
    ? `${formatForecastWatts(-marginW)} shortfall`
    : `${formatForecastWatts(marginW)} spare`;
}

/** Reviews the same dated seller snapshot that the owning purchase API validates. */
export default function AcquisitionReviewDialog({
  game: liveGame,
  targetId,
  onClose,
  onAcquire,
}: Props): React.JSX.Element | null {
  const dispatch = useAppDispatch();
  // A successful update can remove the quote before the request resolves.
  // Keep the same modal and focus trap mounted until the purchase closes it.
  const [submission, setSubmission] = React.useState<{
    game: GameType;
    cash: number;
  }>();
  const game = submission?.game ?? liveGame;
  const { formatMoneyConcise } = useMoney(
    currencyForLocation(game.location, game.startingYear),
  );
  const [error, setError] = React.useState<string>();
  React.useEffect(() => {
    const token = `acquisition:${targetId}`;
    dispatch(openPolicyDecision(token));
    return () => {
      dispatch(closePolicyDecision(token));
    };
  }, [dispatch, targetId]);
  const { quote, offer } = React.useMemo(() => {
    const quote = acquisitionQuote(game, targetId);
    return { quote, offer: quote ?? utilityOffer(game, targetId) };
  }, [game, targetId]);
  const now = currentTick(game);
  const cash = useBuildCash(submission?.cash ?? now?.cash ?? 0, !submission);
  const preview = React.useMemo(
    () =>
      quote &&
      previewUtilityAcquisition(game, targetId, quote.kind === "regional"),
    [game, targetId, quote],
  );
  if (!offer)
    return (
      <DecisionDialog
        open
        title="Acquisition unavailable"
        onClose={onClose}
        actions={<Button onClick={onClose}>Cancel</Button>}
      >
        <Typography role="alert">
          This utility is no longer available to acquire. Review your
          territories and current ownership.
        </Typography>
      </DecisionDialog>
    );
  const municipal = offer.kind === "municipal" ? offer.territory : undefined;
  const sites =
    municipal?.purchases.length ??
    TERRITORY_TILES.filter((tile) => tile.territoryId === offer.targetId)
      .length;
  const customersBefore = now?.customers ?? 0;
  const customersAfter = customersBefore + offer.customers;
  const customerGrowth =
    customersBefore > 0 && offer.customers > 0
      ? ` (+${formatPercent(offer.customers / customersBefore)})`
      : "";
  const unavailable = !quote || !onAcquire;
  const removedPlant = municipal?.removedPlant;
  const valleyNuclear =
    offer.targetId === "valley-electric" &&
    offer.contracts.find(({ name }) => name === "Regional nuclear");

  return (
    <PurchaseReviewDialog
      open
      cancelLabel="Cancel"
      title={`Acquire ${offer.name}?`}
      titleId="utility-acquisition-title"
      cash={cash}
      buildCost={offer.equityPrice}
      cashOnlyFee={offer.fee}
      interestRate={game.interestRate}
      upkeepPerMonth={offer.networkOMPerMonth}
      cashLabel={municipal ? "Cash price" : "Cash option"}
      cashButtonLabel={municipal ? "Confirm" : undefined}
      cashOnly={!!municipal}
      cashDisabled={unavailable}
      loanDisabled={unavailable}
      paymentSummary={{
        cash: {
          value: municipal
            ? `${formatMoneyConcise(offer.cashDue)} now`
            : `${formatMoneyConcise(offer.cashDue)} now + ${formatMoneyConcise(offer.cashMonthlyDebtService + offer.networkOMPerMonth)}/mo`,
        },
        ...(municipal
          ? {}
          : {
              loan: {
                value: `${formatMoneyConcise(offer.financedCashDue)} now + ${formatMoneyConcise(offer.monthlyDebtService + offer.networkOMPerMonth)}/mo`,
              },
            }),
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
        {
          concept: "build",
          label: "Sites transferred",
          value: String(sites),
          detail:
            municipal && removedPlant
              ? "The seller removes its plant. Its site becomes available to build on."
              : undefined,
        },
      ]}
      preface={
        error || !quote || (!municipal && cash < offer.financedCashDue) ? (
          <div className="acquisitionReviewIntro">
            {error && (
              <Typography role="alert" color="error">
                {error}
              </Typography>
            )}
            {!quote ? (
              <Typography variant="body2">
                Connect land along this utility’s border to acquire it.
              </Typography>
            ) : !municipal && cash < offer.financedCashDue ? (
              <Typography variant="body2" color="warning.main">
                Need {formatMoneyConcise(offer.financedCashDue)} cash for the
                down payment and fee. You have {formatMoneyConcise(cash)}.
              </Typography>
            ) : null}
          </div>
        ) : undefined
      }
      afterFacts={
        <div className="acquisitionReviewDetails">
          <details className="acquisitionDisclosure">
            <summary>Plants &amp; purchased power</summary>
            <div>
              {removedPlant ? (
                <DecisionImpactPreview
                  label="Seller’s plant"
                  facts={[
                    {
                      concept: "supply",
                      label: removedPlant.name,
                      value: formatWatts(removedPlant.peakW),
                      detail: "Removed by the seller on transfer.",
                    },
                  ]}
                />
              ) : (
                !!offer.facilities.length && (
                  <>
                    <Typography component="h3" variant="subtitle2">
                      Operating plants
                    </Typography>
                    <DecisionImpactPreview
                      label="Operating plants"
                      facts={[...offer.facilities]
                        .sort((a, b) => b.peakW - a.peakW)
                        .map((facility) => ({
                          concept: "supply",
                          label: facility.name,
                          value: formatWatts(facility.peakW),
                          detail: `${formatNumber(facility.ageYears)} years old`,
                        }))}
                    />
                  </>
                )
              )}
              {offer.kind === "regional" && (
                <Typography component="h3" variant="subtitle2">
                  Purchased power
                </Typography>
              )}
              {!!offer.contracts.length ? (
                <DecisionImpactPreview
                  label="Purchased power"
                  facts={offer.contracts.map((contract) => ({
                    concept: "supply",
                    label: contract.name,
                    value: `${contract.balancing ? "Up to " : ""}${formatWatts(contract.deliverableW)} delivered`,
                    detail: `${formatMoneyConcise(contract.pricePerMWh)}/MWh${contract.balancing ? " reference · variable price and availability, not firm reserve" : ""}`,
                  }))}
                />
              ) : (
                <Typography variant="body2">
                  No purchased-power contracts transfer.
                </Typography>
              )}
              {offer.targetId === "valley-electric" && (
                <Typography variant="body2" color="textSecondary">
                  {!valleyNuclear
                    ? "Valley’s inherited nuclear purchase has expired."
                    : game.date.year >= 2017
                      ? `Valley’s nuclear purchase is now ${formatWatts(valleyNuclear.deliverableW)}, reduced in January 2017.`
                      : "Valley’s nuclear purchase falls from 152 to 76 MW in January 2017."}
                </Typography>
              )}
            </div>
          </details>
          <details className="acquisitionDisclosure">
            <summary>
              {municipal ? "Price breakdown" : "Financing breakdown"}
            </summary>
            <div>
              <DecisionImpactPreview
                label={municipal ? "Price breakdown" : "Financing breakdown"}
                facts={
                  municipal
                    ? municipal.purchases.map(({ tileId, price }) => ({
                        concept: "money",
                        label:
                          tileId === municipal.utility.city.id
                            ? `${municipal.utility.city.city?.name ?? "City"} service area`
                            : "Plant site",
                        value: formatMoneyConcise(price),
                      }))
                    : [
                        {
                          concept: "money",
                          label: "Purchase price",
                          value: formatMoneyConcise(offer.equityPrice),
                        },
                        {
                          concept: "money",
                          label: "Transaction fee",
                          value: formatMoneyConcise(offer.fee),
                          detail: "Paid in cash with either option",
                        },
                        {
                          concept: "finances",
                          label: "Inherited debt",
                          value: formatMoneyConcise(offer.assumedDebt),
                          detail: `5% over 20 years · ${formatMoneyConcise(offer.cashMonthlyDebtService)}/mo`,
                        },
                        {
                          concept: "finances",
                          label: "New loan",
                          value: formatMoneyConcise(offer.newLoan),
                          detail: `${formatNumber(game.interestRate * 100)}% over ${LOAN_MONTHS / 12} years · ${formatMoneyConcise(offer.monthlyDebtService - offer.cashMonthlyDebtService)}/mo`,
                        },
                        {
                          concept: "money",
                          label: "Added utility operations",
                          value: `${formatMoneyConcise(offer.networkOMPerMonth)}/mo`,
                          detail: "At today’s costs",
                        },
                      ]
                }
              />
            </div>
          </details>
          {offer.kind === "regional" && (
            <details className="acquisitionDisclosure">
              <summary>Supply &amp; operating changes</summary>
              <div>
                <UtilityContractSchedule
                  game={game}
                  targetId={offer.targetId}
                />
              </div>
            </details>
          )}
        </div>
      }
      onClose={onClose}
      onPurchase={async (financed) => {
        if (!quote || !onAcquire) return false;
        setError(undefined);
        setSubmission({ game, cash });
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
        setSubmission(undefined);
        return false;
      }}
    />
  );
}
