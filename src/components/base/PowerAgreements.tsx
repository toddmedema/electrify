import * as React from "react";
import { Box, Button, Slider, Typography } from "@mui/material";
import type { GameType, TransmissionLineOperatingType } from "../../Types";
import {
  agreementDate,
  agreementYearMinute,
  connectionAgreements,
  inheritedUtilityForCorridor,
  POWER_AGREEMENT_BLOCKS,
  powerAgreementQuote,
} from "../../helpers/PowerAgreements";
import { formatNumber, formatPercent, formatWatts } from "../../helpers/Format";
import { MINUTES_PER_MONTH } from "../../helpers/DateTime";
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
import AgreementForecastDetails, {
  RecordedAgreementHistory,
} from "./AgreementForecastDetails";
import { useAgreementForecast } from "./useAgreementForecast";
import DecisionDialog from "./DecisionDialog";
import BuildDetails, { BuildDetailRow } from "./BuildDetails";
import { multiplayerRuntime } from "../../multiplayer/Registry";

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
const rate = (value: number) =>
  Number.isFinite(value)
    ? `$${formatNumber(value, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}/MWh`
    : "Unavailable";
const monthlyEnergy = (value: number) =>
  `${formatNumber(value, { maximumFractionDigits: 0 })} MWh/month`;
const years = (value: number) => {
  const amount = formatNumber(value, {
    maximumFractionDigits: value < 0.01 ? 5 : value < 0.1 ? 3 : 1,
  });
  return `${amount} ${Number(amount) === 1 ? "year" : "years"}`;
};
function marketComparison(price: number, marketPrice?: number) {
  if (
    !(price > 0) ||
    marketPrice === undefined ||
    !Number.isFinite(marketPrice)
  )
    return "Comparison unavailable";
  const difference = (marketPrice / price - 1) * 100;
  return Math.abs(difference) < 0.05
    ? "About the same"
    : `${formatNumber(Math.abs(difference), { maximumFractionDigits: 1 })}% ${difference > 0 ? "higher" : "lower"}`;
}
function DetailValue({
  value,
  caption,
}: {
  value: React.ReactNode;
  caption?: React.ReactNode;
}) {
  return (
    <>
      <span>{value}</span>
      {caption && (
        <Typography component="div" variant="caption" color="textSecondary">
          {caption}
        </Typography>
      )}
    </>
  );
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
  const [forecastCommitted, setForecastCommitted] = React.useState(true);
  const [accepting, setAccepting] = React.useState(false);
  const [acceptanceError, setAcceptanceError] = React.useState<string>();
  const durationLabelId = React.useId();
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
    !review || forecastCommitted,
  );
  const restore = React.useRef<HTMLElement | null>(null);
  const token = `power-agreement:${line.id}`;
  const reviewing = !!review;
  React.useEffect(() => {
    if (!reviewing && !assessmentId) return;
    dispatch(openPolicyDecision(token));
    return () => {
      dispatch(closePolicyDecision(token));
    };
  }, [dispatch, token, reviewing, assessmentId]);
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
  const terms = review
    ? { ...review, termsVersion: review.receipt.termsVersion }
    : assessment;
  const deliverableW =
    review?.deliverableW ??
    (assessment ? assessment.nominalW * assessment.deliverability : 0);
  const startMinute =
    review?.receipt.startMinute ?? assessment?.startMinute ?? 0;
  const endMinute = review?.receipt.endMinute ?? assessment?.endMinute ?? 0;
  const remainingYears =
    Math.max(0, endMinute - Math.max(game.date.minute, startMinute)) /
    (12 * MINUTES_PER_MONTH);
  const changeDuration = (value: number | number[]) => {
    if (!review) return;
    const quote = powerAgreementQuote(
      game,
      review.id,
      3,
      Array.isArray(value) ? value[0] : value,
    );
    if (quote) {
      setReview(quote);
      setForecastCommitted(false);
    }
  };
  const close = () => {
    setReview(undefined);
    setAssessmentId(undefined);
    setAcceptanceError(undefined);
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
                  · {rate(source.priceToday)}, follows inflation
                </Typography>
                {marketPrice !== undefined && marketPrice > 0 && (
                  <Typography variant="body2" color="textSecondary">
                    Market now {rate(marketPrice)} ·{" "}
                    {marketComparison(source.priceToday, marketPrice)}
                  </Typography>
                )}
                <Typography variant="body2" color="textSecondary">
                  {source.termsVersion === 1
                    ? "No minimum purchase"
                    : source.termsVersion === 3
                      ? `Minimum: ${monthlyEnergy(source.minimumMWhPerMonth)}`
                      : `Minimum: pay for ${formatWatts(source.nominalW * source.deliverability)} whenever available`}
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
                  setForecastCommitted(true);
                  setAcceptanceError(undefined);
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
        closeDisabled={accepting}
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
            <Button onClick={close} disabled={accepting}>
              Back
            </Button>
            {review && (
              <Button
                variant="contained"
                disabled={accepting}
                onClick={async () => {
                  if (!review || accepting) return;
                  const fresh = powerAgreementQuote(
                    game,
                    review.id,
                    3,
                    review.durationYears,
                  );
                  if (fresh?.quoteKey !== review.quoteKey) {
                    if (fresh) setReview(fresh);
                    setAcceptanceError(
                      "Agreement terms changed; review the replacement again.",
                    );
                    return;
                  }
                  setAccepting(true);
                  setAcceptanceError(undefined);
                  const payload = {
                    blockId: review.id,
                    quoteKey: review.quoteKey,
                    durationYears: review.durationYears,
                  };
                  try {
                    if (game.multiplayer) {
                      const multiplayer = multiplayerRuntime();
                      if (!multiplayer)
                        throw new Error(
                          "The shared game is unavailable. Try again.",
                        );
                      await multiplayer.submit({
                        kind: "action",
                        name: "acceptPowerAgreement",
                        payload,
                      });
                    } else dispatch(acceptPowerAgreement(payload));
                    const receipt = dispatch((_dispatch, getState) =>
                      getState().game.transmission?.acceptedAgreements?.find(
                        (entry) =>
                          entry.blockId === review.id &&
                          entry.cycle === review.receipt.cycle,
                      ),
                    );
                    if (!receipt)
                      throw new Error(
                        "Agreement terms changed; review the replacement again.",
                      );
                    restore.current = document.getElementById(
                      `intertie-disclosure-${line.id}`,
                    );
                    close();
                    dispatch(
                      snackbarOpen(
                        `Agreement accepted; delivery starts ${agreementDate(receipt.startMinute)}`,
                      ),
                    );
                  } catch (error) {
                    const updated = dispatch((_dispatch, getState) =>
                      powerAgreementQuote(
                        getState().game,
                        review.id,
                        3,
                        review.durationYears,
                      ),
                    );
                    if (updated) setReview(updated);
                    setAcceptanceError(
                      error instanceof Error
                        ? error.message
                        : "Agreement could not be accepted. Try again.",
                    );
                  } finally {
                    setAccepting(false);
                  }
                }}
              >
                Accept agreement
              </Button>
            )}
          </>
        }
      >
        {acceptanceError && (
          <Typography role="alert" color="error">
            {acceptanceError}
          </Typography>
        )}
        {expiredAssessment ? (
          <RecordedAgreementHistory
            startMinute={assessment?.startMinute}
            account={game.transmission?.agreementAccounts?.find(
              (entry) => entry.agreementId === assessmentId,
            )}
          />
        ) : (
          terms && (
            <>
              {review && (
                <Box className="powerAgreementDuration">
                  <Typography id={durationLabelId} variant="body2">
                    Duration <strong>{years(review.durationYears)}</strong>
                  </Typography>
                  <Slider
                    disabled={accepting}
                    className="constructionCapacitySlider"
                    aria-labelledby={durationLabelId}
                    value={review.durationYears}
                    min={1}
                    max={10}
                    step={1}
                    valueLabelDisplay="off"
                    getAriaValueText={years}
                    onChange={(_event, value) => changeDuration(value)}
                    onChangeCommitted={() => setForecastCommitted(true)}
                  />
                </Box>
              )}
              <Box className="powerAgreementTerms">
                <BuildDetails
                  label={
                    review
                      ? "Replacement agreement terms"
                      : "Active agreement terms"
                  }
                >
                  <BuildDetailRow
                    label="Agreement price"
                    value={
                      <DetailValue
                        value={rate(terms.priceToday)}
                        caption="Follows inflation"
                      />
                    }
                  />
                  <BuildDetailRow
                    label="Market price"
                    value={
                      <DetailValue
                        value={
                          marketPrice === undefined
                            ? "Unavailable"
                            : rate(marketPrice)
                        }
                        caption={marketComparison(
                          terms.priceToday,
                          marketPrice,
                        )}
                      />
                    }
                  />
                  <BuildDetailRow
                    label="Minimum supply"
                    value={
                      <DetailValue
                        value={
                          terms.termsVersion === 1
                            ? "No minimum purchase"
                            : terms.termsVersion === 2
                              ? `${formatWatts(deliverableW)} whenever available`
                              : monthlyEnergy(terms.minimumMWhPerMonth)
                        }
                        caption={
                          terms.termsVersion === 1
                            ? "Pay for energy used"
                            : "Paid for even if you don't use it"
                        }
                      />
                    }
                  />
                  <BuildDetailRow
                    label="Maximum supply"
                    value={
                      <DetailValue
                        value={`${formatNumber(deliverableW / 1e6, { maximumFractionDigits: 1 })} MW`}
                        caption={monthlyEnergy(terms.maximumMWhPerMonth)}
                      />
                    }
                  />
                  <BuildDetailRow
                    label="Duration"
                    value={
                      <DetailValue
                        value={years(terms.durationYears)}
                        caption={`Ends ${agreementDate(endMinute, true).replace(/^\d+ /, "")}`}
                      />
                    }
                  />
                  <BuildDetailRow
                    label="Forecasted savings"
                    value={
                      <AgreementForecastDetails
                        forecast={forecast}
                        horizon={
                          review
                            ? `over ${years(review.durationYears)}`
                            : `over ${years(remainingYears)} remaining`
                        }
                      />
                    }
                  />
                </BuildDetails>
              </Box>
              {terms.termsVersion === 3 && (
                <Typography
                  variant="body2"
                  color="textSecondary"
                  sx={{ mt: 2 }}
                >
                  The price follows inflation, capped below the current market
                  price. Monthly amounts assume full supplier availability;
                  supplier outages reduce the minimum.
                </Typography>
              )}
            </>
          )
        )}
      </DecisionDialog>
    </Box>
  );
}
