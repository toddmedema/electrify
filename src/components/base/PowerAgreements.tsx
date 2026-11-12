import * as React from "react";
import { Box, Button, Typography } from "@mui/material";
import type { GameType, TransmissionLineOperatingType } from "../../Types";
import {
  agreementDate,
  agreementYearMinute,
  connectionAgreements,
  inheritedUtilityForCorridor,
  POWER_AGREEMENT_BLOCKS,
  powerAgreementQuote,
} from "../../helpers/PowerAgreements";
import {
  formatMoneyConcise,
  formatPercent,
  formatWatts,
} from "../../helpers/Format";
import { currentTick } from "../../helpers/GameSelectors";
import {
  adjacentMarketPricePerMWh,
  intertieContextForGame,
} from "../../helpers/Transmission";
import { useAppDispatch } from "../../Store";
import {
  acceptPowerAgreement,
  closePolicyDecision,
  openPolicyDecision,
  snackbarOpen,
} from "../../reducers/GameActions";
import AgreementForecastDetails from "./AgreementForecastDetails";
import { useAgreementForecast } from "./useAgreementForecast";
import DecisionDialog from "./DecisionDialog";
import BuildDetails, { BuildDetailRow } from "./BuildDetails";

export function agreementSummary(game: GameType, corridorId: string) {
  const utility = inheritedUtilityForCorridor(corridorId);
  if (!utility) return undefined;
  const coverage = connectionAgreements(game, utility).reduce(
    (sum, source) =>
      sum + (source.active ? source.nominalW * source.deliverability : 0),
    0,
  );
  const replacement = POWER_AGREEMENT_BLOCKS.some(
    (block) =>
      block.utilityId === utility && powerAgreementQuote(game, block.id),
  );
  return `${formatWatts(coverage)} under agreement${replacement ? " · Replacement available" : ""}`;
}
function rateComparison(price: number, marketPrice: number) {
  const difference = price / marketPrice - 1;
  return Math.abs(difference) < 0.0005
    ? "About the same"
    : `${formatPercent(Math.abs(difference), 1)} ${difference < 0 ? "below" : "above"}`;
}

export default function PowerAgreements({
  game,
  line,
}: {
  game: GameType;
  line: TransmissionLineOperatingType;
}) {
  const dispatch = useAppDispatch();
  const [review, setReview] =
    React.useState<ReturnType<typeof powerAgreementQuote>>();
  const [assessmentId, setAssessmentId] = React.useState<string>();
  const utility = inheritedUtilityForCorridor(line.corridorId);
  const sources = utility ? connectionAgreements(game, utility) : [];
  const assessment = sources.find((source) => source.id === assessmentId);
  const expiredAssessment =
    !!assessment && game.date.minute >= assessment.endMinute;
  const forecast = useAgreementForecast(
    game,
    review
      ? `${review.id}:${review.receipt.cycle}`
      : expiredAssessment
        ? undefined
        : assessmentId,
    review?.receipt,
  );
  const restore = React.useRef<HTMLElement | null>(null);
  const token = `power-agreement:${line.id}`;
  React.useEffect(() => {
    if (!review && !assessmentId) return;
    dispatch(openPolicyDecision(token));
    return () => {
      dispatch(closePolicyDecision(token));
    };
  }, [dispatch, token, review, assessmentId]);
  if (!utility) return null;
  const now = currentTick(game);
  const marketPrice = now
    ? adjacentMarketPricePerMWh(
        line.corridorId,
        intertieContextForGame(game),
        now.minute,
        now,
      )
    : undefined;
  const close = () => {
    setReview(undefined);
    setAssessmentId(undefined);
  };
  return (
    <Box
      component="section"
      aria-label="Power purchase agreements"
      className="powerAgreements"
    >
      <Typography component="h3" variant="subtitle2">
        Power purchase agreements
      </Typography>
      {sources.map((source) => {
        const expired = game.date.minute >= source.endMinute;
        const account = game.transmission?.agreementAccounts?.find(
          (entry) => entry.agreementId === source.id,
        );
        // A block's next cycle belongs beneath its latest agreement, never duplicated beneath
        // the original inherited reduction after that replacement was accepted.
        const block = POWER_AGREEMENT_BLOCKS.find((entry) =>
          source.inherited
            ? entry.id === source.id
            : source.id.startsWith(`${entry.id}:`),
        );
        const latest =
          block &&
          sources.filter((other) => other.id.startsWith(`${block.id}:`)).at(-1);
        const hasLater = !!latest && latest.id !== source.id;
        const quote =
          block && !hasLater ? powerAgreementQuote(game, block.id) : undefined;
        return (
          <Box key={source.id} className="powerAgreement">
            <Typography variant="body2" sx={{ fontWeight: 600 }}>
              {source.name} ·{" "}
              {expired
                ? `Expired ${agreementDate(source.endMinute)}`
                : source.inherited
                  ? "Inherited"
                  : source.startMinute > game.date.minute
                    ? `Scheduled · starts ${agreementDate(source.startMinute)}`
                    : "Active"}
            </Typography>
            {!expired && (
              <>
                <Typography variant="body2">
                  {formatWatts(source.nominalW * source.deliverability)} covered
                  · {formatMoneyConcise(source.priceToday)}/MWh, follows
                  inflation
                </Typography>
                {marketPrice !== undefined && marketPrice > 0 && (
                  <Typography variant="body2" color="textSecondary">
                    Market now {formatMoneyConcise(marketPrice)}/MWh · agreement{" "}
                    {rateComparison(
                      source.priceToday,
                      marketPrice,
                    ).toLowerCase()}
                  </Typography>
                )}
                <Typography variant="body2" color="textSecondary">
                  {source.termsVersion === 1
                    ? "No minimum purchase"
                    : `Minimum: pay for ${formatWatts(source.nominalW * source.deliverability)} whenever supplier-available`}
                </Typography>
                <Typography variant="body2">
                  {source.inherited
                    ? `Through ${agreementDate(source.endMinute, true)}`
                    : `${agreementDate(source.startMinute)}–${agreementDate(source.endMinute, true)}`}
                </Typography>
                {source.reductionYear !== undefined &&
                  game.date.minute <
                    agreementYearMinute(source.reductionYear) &&
                  (source.reducedNominalW ?? 0) > 0 && (
                    <Typography variant="body2" color="warning.main">
                      {formatWatts(source.nominalW * source.deliverability)} →{" "}
                      {formatWatts(
                        source.reducedNominalW! * source.deliverability,
                      )}{" "}
                      on 1 Jan {source.reductionYear}
                    </Typography>
                  )}
              </>
            )}
            {(() => {
              if (!account) return null;
              const available = account.months.reduce(
                (sum, row) => sum + row.availableMWh,
                0,
              );
              const useful = account.months.reduce(
                (sum, row) => sum + row.usefulMWh,
                0,
              );
              return (
                <Typography variant="body2" color="textSecondary">
                  Recorded since {agreementDate(account.accountingStartMinute)}{" "}
                  ·{" "}
                  {available > 0
                    ? `${formatPercent(useful / available, 1)} used`
                    : "No available minimum"}
                </Typography>
              );
            })()}
            {(!expired || account) && (
              <Button
                size="small"
                onClick={(event) => {
                  restore.current = event.currentTarget;
                  setAssessmentId(source.id);
                }}
                aria-label={
                  expired
                    ? `${source.name} recorded history`
                    : `Forecast ${source.name} remaining term`
                }
              >
                {expired ? "View recorded history" : "Forecast remaining term"}
              </Button>
            )}
            {quote && (
              <Button
                variant="outlined"
                size="small"
                aria-label={`Review ${quote.name} replacement`}
                onClick={(event) => {
                  restore.current = event.currentTarget;
                  setReview(quote);
                }}
              >
                Review replacement
              </Button>
            )}
          </Box>
        );
      })}
      <Typography variant="body2" color="textSecondary">
        Agreements and market purchases share this connection. Uncovered
        purchases use regional market prices and availability.
      </Typography>
      <DecisionDialog
        open={!!review || !!assessment}
        fullWidth
        maxWidth="sm"
        closable
        title={
          review
            ? `Review ${review.name} replacement`
            : `${assessment?.name ?? "Agreement"} ${expiredAssessment ? "recorded history" : "remaining term"}`
        }
        onClose={close}
        disableRestoreFocus
        onExited={() => restore.current?.focus()}
        actions={
          <>
            <Button onClick={close}>Back</Button>
            {review && (
              <Button
                variant="contained"
                onClick={() => {
                  if (!review) return;
                  const fresh = powerAgreementQuote(game, review.id);
                  if (fresh?.quoteKey !== review.quoteKey) {
                    close();
                    dispatch(
                      snackbarOpen(
                        "Agreement terms changed; review the replacement again.",
                      ),
                    );
                    return;
                  }
                  dispatch(
                    acceptPowerAgreement({
                      blockId: review.id,
                      quoteKey: review.quoteKey,
                    }),
                  );
                  restore.current = document.getElementById(
                    `intertie-disclosure-${line.id}`,
                  );
                  close();
                  dispatch(
                    snackbarOpen(
                      `Agreement accepted; delivery starts ${agreementDate(review.receipt.startMinute)}`,
                    ),
                  );
                }}
              >
                Accept agreement
              </Button>
            )}
          </>
        }
      >
        <AgreementForecastDetails
          forecast={forecast}
          offer={!!review}
          expired={expiredAssessment}
          legacy={assessment?.termsVersion === 1}
          account={game.transmission?.agreementAccounts?.find(
            (entry) => entry.agreementId === assessmentId,
          )}
        />
        {assessment && (
          <Box className="powerAgreementTerms">
            <BuildDetails label="Active agreement terms">
              <BuildDetailRow
                label="Minimum"
                value={
                  assessment.termsVersion === 1
                    ? "No minimum purchase"
                    : `Pay for ${formatWatts(assessment.nominalW * assessment.deliverability)} whenever supplier-available`
                }
              />
              <BuildDetailRow
                label="Delivery ends"
                value={agreementDate(assessment.endMinute, true)}
              />
              <BuildDetailRow
                label="Price today"
                value={`${formatMoneyConcise(assessment.priceToday)}/MWh · Follows inflation`}
              />
            </BuildDetails>
          </Box>
        )}
        {review && (
          <>
            <Box className="powerAgreementTerms">
              <BuildDetails label="Replacement agreement terms">
                <BuildDetailRow
                  label="Minimum"
                  value={
                    <>
                      Pay for {formatWatts(review.deliverableW)} whenever
                      supplier-available
                      <Typography
                        component="div"
                        variant="caption"
                        color="textSecondary"
                      >
                        $0 upfront
                      </Typography>
                    </>
                  }
                />
                <BuildDetailRow
                  label="Coverage"
                  value={formatWatts(review.deliverableW)}
                />
                <BuildDetailRow
                  label="Delivery"
                  value={`${agreementDate(review.receipt.startMinute)}–${agreementDate(review.receipt.endMinute, true)}`}
                />
                <BuildDetailRow
                  label="Price today"
                  value={
                    <>
                      {formatMoneyConcise(review.priceToday)}/MWh
                      <Typography
                        component="div"
                        variant="caption"
                        color="textSecondary"
                      >
                        Follows inflation
                      </Typography>
                    </>
                  }
                />
                {marketPrice !== undefined && marketPrice > 0 && (
                  <BuildDetailRow
                    label="Vs market now"
                    value={
                      <>
                        {rateComparison(review.priceToday, marketPrice)}
                        <Typography
                          component="div"
                          variant="caption"
                          color="textSecondary"
                        >
                          Market {formatMoneyConcise(marketPrice)}/MWh
                        </Typography>
                      </>
                    }
                  />
                )}
              </BuildDetails>
            </Box>
            <Typography variant="body2" sx={{ mt: 2 }}>
              Pay for the available minimum even when unused or the connection
              is paused. Supplier outages reduce the minimum. Unused energy
              cannot be stored or resold. Uncovered purchases use market prices.
            </Typography>
          </>
        )}
      </DecisionDialog>
    </Box>
  );
}
