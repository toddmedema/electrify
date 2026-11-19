import { currencyForLocation } from "../../helpers/Currency";
import { useMoney } from "./CurrencyContext";
import * as React from "react";
import { Box, Button, Slider, Typography } from "@mui/material";
import type { GameType, TransmissionLineOperatingType } from "../../Types";
import {
  agreementCorridorId,
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
const monthlyEnergy = (value: number) =>
  `${formatNumber(value, { maximumFractionDigits: 0 })} MWh/month`;
const years = (value: number) => {
  const amount = formatNumber(value, {
    maximumFractionDigits: value < 0.01 ? 5 : value < 0.1 ? 3 : 1,
  });
  return `${amount} ${Number(amount) === 1 ? "year" : "years"}`;
};
function discountRate(price: number, marketPrice?: number) {
  if (
    !(price > 0) ||
    !Number.isFinite(price) ||
    marketPrice === undefined ||
    !(marketPrice > 0) ||
    !Number.isFinite(marketPrice)
  )
    return "Unavailable";
  return `${formatNumber((1 - price / marketPrice) * 100, { maximumFractionDigits: 1 })}%`;
}
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
  const { currency, formatMoneyFull } = useMoney(
    currencyForLocation(game.location, game.startingYear),
  );
  const rate = (value: number) =>
    Number.isFinite(value) ? `${formatMoneyFull(value)}/MWh` : "Unavailable";
  const dispatch = useAppDispatch();
  const [review, setReview] =
    React.useState<ReturnType<typeof powerAgreementQuote>>();
  const [assessmentId, setAssessmentId] = React.useState<string>();
  const [forecastCommitted, setForecastCommitted] = React.useState(true);
  const [accepting, setAccepting] = React.useState(false);
  const [acceptanceError, setAcceptanceError] = React.useState<string>();
  const utility = inheritedUtilityForCorridor(line.corridorId);
  const sources = utility ? connectionAgreements(game, utility) : [];
  const replacement =
    review &&
    sources.some(
      (source) =>
        source.id === review.id || source.id.startsWith(`${review.id}:`),
    );
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
  const portfolio = React.useRef<HTMLElement | null>(null);
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
  const marketContext = intertieContextForGame(game);
  const marketPriceFor = (sourceId: string) =>
    now
      ? adjacentMarketPricePerMWh(
          agreementCorridorId(sourceId, utility),
          marketContext,
          now.minute,
          now,
        )
      : undefined;
  const referencePrice = review
    ? (review.receipt.signingMarketPricePerMWh ?? marketPriceFor(review.id))
    : assessment && marketPriceFor(assessment.id);
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
      ref={portfolio}
      tabIndex={-1}
      aria-label="Power purchase agreements"
      className="powerAgreements"
    >
      {sources.map((source) => {
        const marketPrice = marketPriceFor(source.id);
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
          <Box
            component="article"
            aria-label={source.name}
            key={source.id}
            className="powerAgreement"
          >
            <Typography component="h4" className="powerAgreementHeading">
              {source.name} ·{" "}
              <span className="powerAgreementStatus">
                {expired
                  ? `Expired ${agreementDate(source.endMinute)}`
                  : source.inherited
                    ? "Inherited"
                    : source.startMinute > game.date.minute
                      ? `Scheduled · starts ${agreementDate(source.startMinute)}`
                      : "Active"}
              </span>
            </Typography>
            {!expired && (
              <>
                <Typography variant="body2" className="powerAgreementMetrics">
                  Up to{" "}
                  <strong>
                    {formatWatts(source.nominalW * source.deliverability)}
                  </strong>{" "}
                  · <strong>{rate(source.priceToday)}</strong>
                </Typography>
                <Typography variant="body2" color="textSecondary">
                  Through {agreementDate(source.endMinute, true)}
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
                <Typography
                  variant="body2"
                  color="textSecondary"
                  className="powerAgreementMinimum"
                >
                  {source.termsVersion === 1
                    ? "No minimum purchase"
                    : source.termsVersion === 3
                      ? `Minimum payment: ${monthlyEnergy(source.minimumMWhPerMonth)}, even if unused`
                      : `Minimum payment: ${formatWatts(source.nominalW * source.deliverability)} whenever available, even if unused`}
                </Typography>
              </>
            )}
            <div className="powerAgreementActions">
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
              {!expired && (
                <details
                  className="powerAgreementDetails"
                  aria-label={`${source.name} details`}
                >
                  <summary>Details</summary>
                  <div className="powerAgreementDetailBody">
                    <Typography variant="body2" color="textSecondary">
                      {agreementDate(source.startMinute)}–
                      {agreementDate(source.endMinute, true)}
                    </Typography>
                    <Typography variant="body2" color="textSecondary">
                      Maximum: {monthlyEnergy(source.maximumMWhPerMonth)}
                    </Typography>
                    {marketPrice !== undefined && marketPrice > 0 && (
                      <Typography variant="body2" color="textSecondary">
                        Market now {rate(marketPrice)} ·{" "}
                        {marketComparison(source.priceToday, marketPrice)}
                      </Typography>
                    )}
                    {account &&
                      (() => {
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
                            Recorded since{" "}
                            {agreementDate(account.accountingStartMinute)} ·{" "}
                            {available > 0
                              ? `${formatPercent(useful / available, 1)} used`
                              : "No available minimum"}
                          </Typography>
                        );
                      })()}
                    <Button
                      size="small"
                      onClick={(event) => {
                        restore.current = event.currentTarget;
                        setAssessmentId(source.id);
                      }}
                      aria-label={`Forecast ${source.name} remaining term`}
                    >
                      Forecast remaining term
                    </Button>
                  </div>
                </details>
              )}
              {expired && account && (
                <Button
                  size="small"
                  onClick={(event) => {
                    restore.current = event.currentTarget;
                    setAssessmentId(source.id);
                  }}
                  aria-label={`${source.name} recorded history`}
                >
                  View recorded history
                </Button>
              )}
            </div>
          </Box>
        );
      })}
      {POWER_AGREEMENT_BLOCKS.filter(
        (block) =>
          "sellerUtilityId" in block &&
          block.utilityId === utility &&
          !sources.some((source) => source.id.startsWith(`${block.id}:`)),
      ).map((block) => {
        const quote = powerAgreementQuote(game, block.id);
        return (
          quote && (
            <Box
              component="article"
              aria-label={quote.name}
              key={block.id}
              className="powerAgreement"
            >
              <Typography component="h4" className="powerAgreementHeading">
                {quote.name}
              </Typography>
              <Typography variant="body2" className="powerAgreementMetrics">
                Up to <strong>{formatWatts(quote.deliverableW)}</strong> ·{" "}
                <strong>{rate(quote.priceToday)}</strong>
              </Typography>
              <Button
                variant="outlined"
                aria-label={`Review ${quote.name} agreement`}
                onClick={(event) => {
                  restore.current = event.currentTarget;
                  setForecastCommitted(true);
                  setAcceptanceError(undefined);
                  setReview(quote);
                }}
              >
                Review terms
              </Button>
            </Box>
          )
        );
      })}
      <DecisionDialog
        open={!!review || !!assessment}
        fullWidth
        maxWidth="sm"
        closable
        closeDisabled={accepting}
        title={
          review
            ? `Review ${review.name} ${replacement ? "replacement" : "agreement"}`
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
                      "Agreement terms changed; review the updated terms.",
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
                        "Agreement terms changed; review the updated terms.",
                      );
                    restore.current =
                      document.getElementById(
                        `intertie-disclosure-${line.id}`,
                      ) ?? portfolio.current;
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
            currency={currency}
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
                  <Typography variant="body2">
                    <strong>{years(review.durationYears)}</strong>
                  </Typography>
                  <Slider
                    disabled={accepting}
                    className="constructionCapacitySlider"
                    aria-label="Duration"
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
              <Typography variant="body2" color="textSecondary" sx={{ mb: 2 }}>
                Delivery and emissions follow the supplier’s power mix and
                availability.
              </Typography>
              <Box className="powerAgreementTerms">
                <BuildDetails
                  label={
                    review
                      ? replacement
                        ? "Replacement agreement terms"
                        : "Agreement terms"
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
                    label="Reference price"
                    value={
                      referencePrice === undefined
                        ? "Unavailable"
                        : rate(referencePrice)
                    }
                  />
                  <BuildDetailRow
                    label="Discount"
                    value={discountRate(terms.priceToday, referencePrice)}
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
                    label="Forecasted cash impact"
                    value={
                      <AgreementForecastDetails
                        currency={currency}
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
            </>
          )
        )}
      </DecisionDialog>
    </Box>
  );
}
