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
import ConceptIcon from "./ConceptIcon";
import UtilityLogoIcon from "./UtilityLogoIcon";
import { gameUtilityBranding } from "../../helpers/UtilityBranding";
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
  return `${formatWatts(coverage)} committed${replacement ? " · Replacement available" : ""}`;
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
function AgreementMetrics({
  capacityW,
  price,
  endMinute,
  minimum,
  children,
}: {
  capacityW: number;
  price: string;
  endMinute: number;
  minimum: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <BuildDetails label="Trade summary">
      <BuildDetailRow label="Max supply" value={formatWatts(capacityW)} />
      <BuildDetailRow label="Price" value={price} />
      <BuildDetailRow label="Final month" value={finalMonth(endMinute)} />
      <BuildDetailRow label="Min payment" value={minimum} />
      {children}
    </BuildDetails>
  );
}

function finalMonth(endMinute: number) {
  return agreementDate(endMinute, true).replace(/^\d+ /, "");
}

function minimumPayment(
  version: number,
  minimumMWh: number,
  deliverableW: number,
) {
  return version === 1 ? (
    "No minimum purchase"
  ) : (
    <DetailValue
      value={
        version === 2
          ? `${formatWatts(deliverableW)} whenever available`
          : monthlyEnergy(minimumMWh)
      }
      caption="Paid even if unused"
    />
  );
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
  const [historyId, setHistoryId] = React.useState<string>();
  const [forecastCommitted, setForecastCommitted] = React.useState(true);
  const [accepting, setAccepting] = React.useState(false);
  const [acceptanceError, setAcceptanceError] = React.useState<string>();
  const utility = inheritedUtilityForCorridor(line.corridorId);
  const sources = utility ? connectionAgreements(game, utility) : [];
  const branding = gameUtilityBranding(game);
  const replacement =
    review &&
    sources.some(
      (source) =>
        source.id === review.id || source.id.startsWith(`${review.id}:`),
    );
  const recordedAgreement = sources.find((source) => source.id === historyId);
  const forecast = useAgreementForecast(
    game,
    review?.receipt,
    forecastCommitted,
  );
  const restore = React.useRef<HTMLElement | null>(null);
  const portfolio = React.useRef<HTMLElement | null>(null);
  const token = `power-agreement:${line.id}`;
  const reviewing = !!review;
  React.useEffect(() => {
    if (!reviewing && !historyId) return;
    dispatch(openPolicyDecision(token));
    return () => {
      dispatch(closePolicyDecision(token));
    };
  }, [dispatch, token, reviewing, historyId]);
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
  const referencePrice =
    review &&
    (review.receipt.signingMarketPricePerMWh ?? marketPriceFor(review.id));
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
    setHistoryId(undefined);
    setAcceptanceError(undefined);
  };
  return (
    <Box
      component="section"
      ref={portfolio}
      tabIndex={-1}
      aria-label="Supply trades"
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
            <header className="powerAgreementHeader">
              <h4 className="tradeUtilityName">
                <UtilityLogoIcon logo={branding.forTrade(source.id)} />
                {source.name}
              </h4>
              <span className="powerAgreementStatus">
                {expired
                  ? `Expired ${agreementDate(source.endMinute)}`
                  : source.inherited
                    ? "Inherited"
                    : source.startMinute > game.date.minute
                      ? `Scheduled · starts ${agreementDate(source.startMinute)}`
                      : "Active"}
              </span>
            </header>
            {!expired && (
              <AgreementMetrics
                capacityW={source.nominalW * source.deliverability}
                price={rate(source.priceToday)}
                endMinute={source.endMinute}
                minimum={minimumPayment(
                  source.termsVersion,
                  source.minimumMWhPerMonth,
                  source.nominalW * source.deliverability,
                )}
              >
                {source.reductionYear !== undefined &&
                  game.date.minute <
                    agreementYearMinute(source.reductionYear) &&
                  (source.reducedNominalW ?? 0) > 0 && (
                    <BuildDetailRow
                      label="Scheduled reduction"
                      value={
                        <Typography
                          component="span"
                          variant="body2"
                          color="warning.main"
                        >
                          {formatWatts(source.nominalW * source.deliverability)}{" "}
                          →{" "}
                          {formatWatts(
                            source.reducedNominalW! * source.deliverability,
                          )}{" "}
                          on 1 Jan {source.reductionYear}
                        </Typography>
                      }
                    />
                  )}
              </AgreementMetrics>
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
                  <BuildDetails label="Trade details">
                    <BuildDetailRow
                      label="First month"
                      value={agreementDate(source.startMinute).replace(
                        /^\d+ /,
                        "",
                      )}
                    />
                    <BuildDetailRow
                      label="Max monthly supply"
                      value={monthlyEnergy(source.maximumMWhPerMonth)}
                    />
                    {marketPrice !== undefined && marketPrice > 0 && (
                      <BuildDetailRow
                        label="Market now"
                        value={
                          <DetailValue
                            value={rate(marketPrice)}
                            caption={marketComparison(
                              source.priceToday,
                              marketPrice,
                            )}
                          />
                        }
                      />
                    )}
                    {account &&
                      (() => {
                        const { available, useful } = account.months.reduce(
                          (sum, row) => ({
                            available: sum.available + row.availableMWh,
                            useful: sum.useful + row.usefulMWh,
                          }),
                          { available: 0, useful: 0 },
                        );
                        return (
                          <BuildDetailRow
                            label="Energy used"
                            value={
                              <div className="powerAgreementUsage">
                                <DetailValue
                                  value={
                                    available > 0
                                      ? `${formatPercent(useful / available, 1)} used`
                                      : "No available minimum"
                                  }
                                  caption={`Recorded since ${agreementDate(account.accountingStartMinute)}`}
                                />
                                {available > 0 && (
                                  <meter
                                    aria-label="Share of available energy used"
                                    value={useful}
                                    max={available}
                                  />
                                )}
                              </div>
                            }
                          />
                        );
                      })()}
                  </BuildDetails>
                </details>
              )}
              {expired && account && (
                <Button
                  size="small"
                  onClick={(event) => {
                    restore.current = event.currentTarget;
                    setHistoryId(source.id);
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
              className="powerAgreement powerAgreementOffer"
            >
              <header className="powerAgreementHeader">
                <h4 className="tradeUtilityName">
                  <UtilityLogoIcon logo={branding.forTrade(quote.id)} />
                  {quote.name}
                </h4>
                <span className="powerAgreementStatus">Offer</span>
              </header>
              <AgreementMetrics
                capacityW={quote.deliverableW}
                price={rate(quote.priceToday)}
                endMinute={quote.receipt.endMinute}
                minimum={minimumPayment(
                  quote.receipt.termsVersion,
                  quote.minimumMWhPerMonth,
                  quote.deliverableW,
                )}
              />
              <Button
                variant="outlined"
                startIcon={<ConceptIcon concept="buy" decorative />}
                aria-label={`Review ${quote.name} trade`}
                onClick={(event) => {
                  restore.current = event.currentTarget;
                  setForecastCommitted(true);
                  setAcceptanceError(undefined);
                  setReview(quote);
                }}
              >
                Review
              </Button>
            </Box>
          )
        );
      })}
      <DecisionDialog
        open={!!review || !!recordedAgreement}
        fullWidth
        maxWidth="sm"
        closable
        closeDisabled={accepting}
        title={
          review
            ? `Review ${review.name} ${replacement ? "replacement" : "trade"}`
            : `${recordedAgreement?.name ?? "Trade"} recorded history`
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
                      "Trade terms changed. Review the updated offer.",
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
                        "Trade terms changed. Review the updated offer.",
                      );
                    restore.current =
                      document.getElementById(
                        `intertie-disclosure-${line.id}`,
                      ) ?? portfolio.current;
                    close();
                    dispatch(
                      snackbarOpen(
                        `Trade accepted. Delivery starts ${agreementDate(receipt.startMinute)}`,
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
                        : "Could not accept the trade. Try again.",
                    );
                  } finally {
                    setAccepting(false);
                  }
                }}
              >
                Accept trade
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
        {recordedAgreement ? (
          <RecordedAgreementHistory
            currency={currency}
            startMinute={recordedAgreement.startMinute}
            account={game.transmission?.agreementAccounts?.find(
              (entry) => entry.agreementId === historyId,
            )}
          />
        ) : (
          review && (
            <>
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
              <Box className="powerAgreementTerms">
                <BuildDetails
                  label={
                    replacement ? "Replacement trade terms" : "Trade terms"
                  }
                >
                  <BuildDetailRow
                    label="Trade price"
                    value={
                      <DetailValue
                        value={rate(review.priceToday)}
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
                    value={discountRate(review.priceToday, referencePrice)}
                  />
                  <BuildDetailRow
                    label="Min payment"
                    value={minimumPayment(
                      review.receipt.termsVersion,
                      review.minimumMWhPerMonth,
                      review.deliverableW,
                    )}
                  />
                  <BuildDetailRow
                    label="Maximum supply"
                    value={
                      <DetailValue
                        value={`${formatNumber(review.deliverableW / 1e6, { maximumFractionDigits: 1 })} MW`}
                        caption={monthlyEnergy(review.maximumMWhPerMonth)}
                      />
                    }
                  />
                  <BuildDetailRow
                    label="Duration"
                    value={years(review.durationYears)}
                  />
                  <BuildDetailRow
                    label="Final month"
                    value={finalMonth(review.receipt.endMinute)}
                  />
                  <AgreementForecastDetails
                    currency={currency}
                    forecast={forecast}
                    horizon={`over ${years(review.durationYears)}`}
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
