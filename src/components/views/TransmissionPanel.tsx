import ManualLink from "../base/ManualLink";
import { MANUAL_ENTRY } from "../../data/Manual";
import { INTERTIE_ARCHETYPES } from "../../data/IntertieArchetypes";
import * as React from "react";
import KeyboardArrowDownIcon from "@mui/icons-material/KeyboardArrowDown";
import ClosableDialogTitle from "../base/ClosableDialogTitle";
import {
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  FormControl,
  FormHelperText,
  InputLabel,
  MenuItem,
  Select,
  Typography,
} from "@mui/material";
import {
  DOWNPAYMENT_PERCENT,
  LOAN_MONTHS,
  MONTH_NAMES,
  MONTHS,
  TICK_MINUTES,
  TICKS_PER_YEAR,
} from "../../Constants";
import {
  adjacentMarketForCorridor,
  corridorsForLocation,
} from "../../data/AdjacentMarkets";
import { getTimeFromTimeline } from "../../helpers/DateTime";
import { formatMoneyConcise, formatWatts } from "../../helpers/Format";
import {
  adjacentMarketPricePerMWh,
  allowsImports,
  intertieContextForGame,
  intertieImportLimitW,
  transmissionRatingW,
} from "../../helpers/Transmission";
import {
  intertieOutlook,
  IntertieOutlook,
  pricePeriodCaption,
} from "../../helpers/IntertieOutlook";
import { generateNewTimeline } from "../../reducers/Game";
import { getMonthlyPayment } from "../../helpers/Financials";
import {
  GameType,
  TickPresentFutureType,
  TradingPolicyType,
} from "../../Types";
import { formatMass } from "../../helpers/Units";
import { useUnits } from "../base/UnitsContext";
import ConceptIcon from "../base/ConceptIcon";
import DecisionImpactPreview from "../base/DecisionImpactPreview";
import Sparkline from "../base/Sparkline";

const POLICY_LABELS: Record<TradingPolicyType, string> = {
  BALANCED: "Buy for shortages, sell extra",
  RELIABILITY_FIRST: "Buy for shortages only",
  SURPLUS_ONLY: "Sell extra only",
  CLOSED: "No trading",
};

function percent(fraction: number): string {
  return `${Math.round(fraction * 100)}%`;
}

function priceRange(outlook: IntertieOutlook): string {
  // Whole dollars: a typical range is an estimate, and cents would suggest otherwise
  const low = formatMoneyConcise(Math.round(outlook.priceLow));
  const high = formatMoneyConcise(Math.round(outlook.priceHigh));
  return low === high ? `${low}/MWh` : `${low}–${high.replace("$", "")}/MWh`;
}

/** Hourly steps keep every hour of the day while costing a quarter of a full-resolution forecast */
const OUTLOOK_STEP_MINUTES = 60;
const OUTLOOK_YEARS = 2;

/**
 * A two-year hourly forecast for the intertie outlooks, rebuilt once per game year rather than on
 * every tick: the typical year it feeds barely moves month to month, and the fleet list stays
 * mounted while the game runs. Undefined while disabled or before the first tick exists.
 */
function useIntertieForecast(
  game: GameType,
  enabled: boolean,
): TickPresentFutureType[] | undefined {
  const cache = React.useRef<{
    key: string;
    timeline?: TickPresentFutureType[];
  }>();
  if (!enabled) return undefined;
  const key = [game.date.year, game.location.id, game.seed].join("|");
  if (cache.current?.key !== key) {
    const now = getTimeFromTimeline(game.date.minute, game.timeline);
    cache.current = {
      key,
      timeline: now
        ? generateNewTimeline(
            game,
            now.cash,
            now.customers,
            (TICKS_PER_YEAR * OUTLOOK_YEARS * TICK_MINUTES) /
              OUTLOOK_STEP_MINUTES,
            OUTLOOK_STEP_MINUTES,
          )
        : undefined,
    };
  }
  return cache.current.timeline;
}

/** Typical-year import room, drawn like the generator build cards' output lines */
function IntertieYear({ outlook }: { outlook: IntertieOutlook }) {
  const { monthly, lowMonth } = outlook;
  const highMonth = monthly.reduce(
    (high, value, month) => (value > monthly[high] ? month : high),
    0,
  );
  return (
    <figure className="intertieYear">
      <Sparkline
        values={monthly}
        domain={[0, 1]}
        width={96}
        height={24}
        stretch
        baseline
        fill
        lowMarker
        ariaLabel={`Typical year of import room: most in ${MONTH_NAMES[highMonth]} at ${percent(monthly[highMonth])} of the line, least in ${MONTH_NAMES[lowMonth]} at ${percent(monthly[lowMonth])}.`}
      />
      <Typography
        variant="caption"
        color="textSecondary"
        component="figcaption"
      >
        Typical year · Low {MONTHS[lowMonth]} {percent(monthly[lowMonth])}
      </Typography>
    </figure>
  );
}

function PriceMetric({ outlook }: { outlook: IntertieOutlook }) {
  const periods = pricePeriodCaption(outlook);
  return (
    <div>
      <dt>Typical price</dt>
      <dd>{priceRange(outlook)}</dd>
      {periods && <dd className="transmissionMetricNote">{periods}</dd>}
    </div>
  );
}

export interface TransmissionPanelProps {
  game: GameType;
  projectsOnly?: boolean;
  onBuild: (corridorId: string, financed: boolean) => void;
  onPolicy: (policy: TradingPolicyType) => void;
}

const POLICY_DETAILS: Record<TradingPolicyType, string> = {
  BALANCED: "Imports cover shortages; spare power is sold to neighbors.",
  RELIABILITY_FIRST: "Imports cover shortages; spare power is not sold.",
  SURPLUS_ONLY: "Spare power is sold; shortages are not covered by imports.",
  CLOSED: "No power moves over your interties.",
};

// Live state for the section header, beside the rule it results from
function tradingFlowText(game: GameType): string | null {
  const lines = game.transmission?.lines ?? [];
  if (!lines.length) return null;
  if (lines.every((line) => line.yearsToBuildLeft > 0)) {
    return "Not connected yet";
  }
  const now = getTimeFromTimeline(game.date.minute, game.timeline);
  const importedW = now?.importedW || 0;
  const exportedW = now?.exportedW || 0;
  if (importedW > 0) return "Importing " + formatWatts(importedW);
  if (exportedW > 0) return "Exporting " + formatWatts(exportedW);
  return "No power flowing";
}

// The rule is the only trading decision, so it stays editable in place rather than behind a
// disclosure that repeats the current choice as a label.
function TradingControls({
  game,
  onPolicy,
}: Pick<TransmissionPanelProps, "game" | "onPolicy">) {
  const state = game.transmission;
  if (!state?.lines.length) return null;
  if (game.replayPlayback) {
    return (
      <div className="tradingControls">
        <Typography variant="body2">
          Trading rule: {POLICY_LABELS[state.tradingPolicy]}
        </Typography>
      </div>
    );
  }
  return (
    <div className="tradingControls">
      <FormControl fullWidth size="small" className="tradingPolicy">
        <InputLabel id="trading-policy-label">Trading rule</InputLabel>
        <Select
          labelId="trading-policy-label"
          label="Trading rule"
          value={state.tradingPolicy}
          aria-describedby="trading-policy-detail"
          onChange={(event) =>
            onPolicy(event.target.value as TradingPolicyType)
          }
        >
          {Object.entries(POLICY_LABELS).map(([value, label]) => (
            <MenuItem key={value} value={value}>
              {label}
            </MenuItem>
          ))}
        </Select>
        <FormHelperText id="trading-policy-detail">
          {POLICY_DETAILS[state.tradingPolicy]}
        </FormHelperText>
      </FormControl>
    </div>
  );
}

export default function TransmissionPanel({
  game,
  onBuild,
  onPolicy,
  projectsOnly = false,
}: TransmissionPanelProps) {
  const units = useUnits();
  const [selectedLine, setSelectedLine] = React.useState<number | null>(null);
  const [reviewId, setReviewId] = React.useState<string | null>(null);
  const state = game.transmission ?? { tradingPolicy: "BALANCED", lines: [] };
  const availableCorridors = corridorsForLocation(game.location);
  const now = getTimeFromTimeline(game.date.minute, game.timeline);
  const readOnly = !!game.replayPlayback;
  const intertieContext = intertieContextForGame(game);
  const forecast = useIntertieForecast(
    game,
    projectsOnly || selectedLine !== null,
  );
  const outlookFor = (corridorId: string) =>
    forecast &&
    intertieOutlook(corridorId, intertieContext, forecast, game.date.minute);
  const flowText = tradingFlowText(game);
  // The guided mission names the northern project. Showing only that choice until it is approved
  // makes an exploratory tap recoverable instead of letting a much dearer three-year project
  // consume the cash and time needed by the lesson.
  const corridors =
    game.scenarioId === 112 &&
    !state.lines.some(({ corridorId }) => corridorId === "california-north")
      ? availableCorridors.filter(({ id }) => id === "california-north")
      : availableCorridors;
  const unbuiltCorridors = corridors.filter(
    (corridor) =>
      !state.lines.some(({ corridorId }) => corridorId === corridor.id),
  );
  const review = unbuiltCorridors.find(({ id }) => id === reviewId);
  const reviewMarket = review && adjacentMarketForCorridor(review.id);
  const reviewDownpayment = (review?.buildCost || 0) * DOWNPAYMENT_PERCENT;
  const reviewOutlook = review && outlookFor(review.id);
  const reviewPeriods = reviewOutlook && pricePeriodCaption(reviewOutlook);
  const approve = (financed: boolean) => {
    if (!review) return;
    onBuild(review.id, financed);
    setReviewId(null);
  };

  if (!corridors.length) {
    return null;
  }

  return (
    <div className={projectsOnly ? "transmissionPanel" : "transmissionFleet"}>
      {!projectsOnly && (
        <section aria-labelledby="your-interties-title">
          <Typography
            id="your-interties-title"
            className="facilitySectionLabel"
            variant="subtitle2"
          >
            Interties
            <span className="facilitySectionMeta">
              {flowText && (
                <span className="networkTradingFlow">{flowText}</span>
              )}
              <ManualLink entry={MANUAL_ENTRY.INTERTIES} label="an intertie" />
            </span>
          </Typography>
          <TradingControls game={game} onPolicy={onPolicy} />
          {!state.lines.length && (
            <Typography
              variant="body2"
              color="textSecondary"
              sx={{ px: 2, pb: 2 }}
            >
              No connections yet. Choose Build to connect a nearby grid.
            </Typography>
          )}
          {state.lines.map((line) => {
            const market = adjacentMarketForCorridor(line.corridorId);
            const rating = now
              ? transmissionRatingW(line, now)
              : line.capacityW;
            const building = line.yearsToBuildLeft > 0;
            const importableW = now
              ? intertieImportLimitW(line, intertieContext, now.minute, now)
              : rating;
            const outlook =
              selectedLine === line.id
                ? outlookFor(line.corridorId)
                : undefined;
            return (
              <div key={line.id} className="transmissionLine">
                <button
                  type="button"
                  className="facilityDisclosure"
                  aria-label={"Inspect " + line.name}
                  aria-expanded={selectedLine === line.id}
                  onClick={() =>
                    setSelectedLine(selectedLine === line.id ? null : line.id)
                  }
                >
                  <img
                    className="transmissionListIcon"
                    src="/images/transmission.svg"
                    alt=""
                  />
                  <span className="transmissionLineText">
                    <span>{line.name}</span>
                    <Typography
                      component="span"
                      variant="body2"
                      color="textSecondary"
                    >
                      {building
                        ? line.yearsToBuildLeft.toFixed(1) +
                          (line.yearsToBuildLeft <= 1 ? " year" : " years") +
                          " remaining"
                        : formatWatts(importableW) +
                          (allowsImports(state.tradingPolicy)
                            ? " can import"
                            : " available")}
                      {" · "}
                      <span className="transmissionLineStatus">
                        {building ? "Building" : "Connected"}
                      </span>
                    </Typography>
                  </span>
                  <KeyboardArrowDownIcon
                    className="facilityChevron"
                    aria-hidden
                  />
                </button>
                {selectedLine === line.id && (
                  <div className="transmissionLineDetails">
                    <Typography variant="body2">
                      {market?.name} · {formatWatts(line.capacityW)} rated
                      capacity
                    </Typography>
                    {outlook && (
                      <div className="transmissionArchetype">
                        <Chip
                          size="small"
                          variant="outlined"
                          label={outlook.archetype.label}
                        />
                        <Typography variant="body2" color="textSecondary">
                          {outlook.archetype.summary}
                        </Typography>
                      </div>
                    )}
                    {building && (
                      <Typography variant="body2" color="textSecondary">
                        Power can flow when construction finishes.
                      </Typography>
                    )}
                    {(outlook || (!building && now)) && (
                      <dl className="transmissionMetrics">
                        {!building && now && (
                          <>
                            <div>
                              <dt>Price now</dt>
                              <dd>
                                {formatMoneyConcise(
                                  adjacentMarketPricePerMWh(
                                    line.corridorId,
                                    intertieContext,
                                    now.minute,
                                    now,
                                  ),
                                )}
                                /MWh
                              </dd>
                            </div>
                            <div>
                              <dt>Can import now</dt>
                              <dd>
                                {formatWatts(importableW)} of{" "}
                                {formatWatts(rating)}
                              </dd>
                            </div>
                          </>
                        )}
                        {outlook && (
                          <>
                            <div>
                              <dt>At your peak</dt>
                              <dd>~{percent(outlook.atPeak)} of line</dd>
                            </div>
                            <PriceMetric outlook={outlook} />
                          </>
                        )}
                      </dl>
                    )}
                    {outlook && <IntertieYear outlook={outlook} />}
                    {line.loanAmountLeft > 0 && (
                      <Typography variant="body2">
                        Loan balance {formatMoneyConcise(line.loanAmountLeft)}
                      </Typography>
                    )}
                    {market && (
                      <Typography variant="caption" color="textSecondary">
                        Purchased emissions:{" "}
                        {formatMass(market.emissionsKgco2ePerMWh, units)}/MWh
                        CO2e
                      </Typography>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </section>
      )}

      {projectsOnly && !unbuiltCorridors.length && (
        <Typography>All available connections have been approved.</Typography>
      )}
      {projectsOnly && !!unbuiltCorridors.length && (
        <section aria-label="Connection projects">
          <div className="transmissionProjects">
            {unbuiltCorridors.map((corridor) => {
              const market = adjacentMarketForCorridor(corridor.id);
              const downpayment = corridor.buildCost * DOWNPAYMENT_PERCENT;
              const financed = corridor.buildCost - downpayment;
              const outlook = outlookFor(corridor.id);
              return (
                <article
                  className="transmissionProject"
                  data-corridor-id={corridor.id}
                  data-testid={`transmission-project-${corridor.id}`}
                  key={corridor.id}
                >
                  <div className="transmissionProjectHeading">
                    <Typography variant="subtitle1">{market?.name}</Typography>
                    {!readOnly && (
                      <Button
                        id={`review-intertie-${corridor.id}`}
                        aria-label={`Review purchase of ${market?.name} intertie`}
                        size="small"
                        startIcon={
                          <ConceptIcon concept="buy" fontSize="small" />
                        }
                        variant="outlined"
                        disabled={!now || now.cash < downpayment}
                        onClick={() => setReviewId(corridor.id)}
                      >
                        Review
                      </Button>
                    )}
                  </div>
                  <div className="transmissionProjectMetadata">
                    <Typography variant="caption" color="textSecondary">
                      {corridor.name}
                    </Typography>
                    <Chip
                      size="small"
                      variant="outlined"
                      label={
                        corridor.routeType === "EXISTING"
                          ? "Existing corridor"
                          : "New corridor"
                      }
                    />
                    {market && (
                      <Chip
                        size="small"
                        variant="outlined"
                        className="transmissionArchetypeChip"
                        label={INTERTIE_ARCHETYPES[market.archetype].label}
                      />
                    )}
                  </div>
                  <Typography variant="body2">
                    {market
                      ? INTERTIE_ARCHETYPES[market.archetype].summary
                      : ""}
                  </Typography>
                  {outlook && <IntertieYear outlook={outlook} />}
                  <dl className="transmissionMetrics">
                    {outlook && (
                      <>
                        <div>
                          <dt>At your peak</dt>
                          <dd>~{percent(outlook.atPeak)} of line</dd>
                        </div>
                        <PriceMetric outlook={outlook} />
                      </>
                    )}
                    <div>
                      <dt>Capacity</dt>
                      <dd>{formatWatts(corridor.capacityW)}</dd>
                    </div>
                    <div>
                      <dt>Build time</dt>
                      <dd>
                        {corridor.yearsToBuild} year
                        {corridor.yearsToBuild === 1 ? "" : "s"}
                      </dd>
                    </div>
                    <div>
                      <dt>Total cost</dt>
                      <dd>{formatMoneyConcise(corridor.buildCost)}</dd>
                    </div>
                    <div>
                      <dt>Loan payment</dt>
                      <dd>
                        {formatMoneyConcise(
                          getMonthlyPayment(
                            financed,
                            game.interestRate,
                            LOAN_MONTHS,
                          ),
                        )}
                        /mo
                      </dd>
                    </div>
                  </dl>
                  {!readOnly && (
                    <Typography variant="caption" color="textSecondary">
                      Pay {formatMoneyConcise(downpayment)} now · finance{" "}
                      {formatMoneyConcise(financed)}
                    </Typography>
                  )}
                </article>
              );
            })}
          </div>
        </section>
      )}
      {projectsOnly && (
        <>
          <ManualLink
            entry={MANUAL_ENTRY.INTERTIES}
            text="How interties work"
          />
          <details>
            <summary style={{ minHeight: 44, cursor: "pointer" }}>
              Neighbor emissions
            </summary>
            {Array.from(new Set(corridors.map((corridor) => corridor.id))).map(
              (id) => {
                const market = adjacentMarketForCorridor(id);
                return market ? (
                  <Typography key={id} variant="body2" sx={{ my: 1 }}>
                    {market.name}:{" "}
                    {formatMass(market.emissionsKgco2ePerMWh, units)}
                    /MWh CO2e · {market.emissionsBasis}.{" "}
                    <a
                      aria-label={`Source for ${market.name} emissions`}
                      href={market.emissionsSource}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Source
                    </a>
                  </Typography>
                ) : null;
              },
            )}
          </details>
        </>
      )}
      {review && (
        <Dialog
          open
          onClose={() => setReviewId(null)}
          fullWidth
          maxWidth="sm"
          aria-labelledby="intertie-review-title"
        >
          <ClosableDialogTitle
            id="intertie-review-title"
            onClose={() => setReviewId(null)}
          >
            Build {reviewMarket?.name} intertie?
          </ClosableDialogTitle>
          <DialogContent className="noPadding">
            <DecisionImpactPreview
              facts={[
                {
                  concept: "money",
                  label: "Cash purchase",
                  value: `${formatMoneyConcise(now?.cash || 0)} → ${formatMoneyConcise((now?.cash || 0) - review.buildCost)}`,
                },
                {
                  concept: "finances",
                  label: "Loan option",
                  value: `${formatMoneyConcise(reviewDownpayment)} now + ${formatMoneyConcise(getMonthlyPayment(review.buildCost - reviewDownpayment, game.interestRate, LOAN_MONTHS))}/mo`,
                  detail: `Payments start during construction. Loan term: ${LOAN_MONTHS / 12} years. Interest rate: ${(game.interestRate * 100).toFixed(2)}%.`,
                },
                {
                  concept: "money",
                  label: "Estimated upkeep",
                  value: `${formatMoneyConcise(review.annualOperatingCost / 12)}/mo`,
                  detail: "Electricity purchases and loan payments are extra.",
                },
                {
                  concept: "time",
                  label: "Online in",
                  value: `${Math.round(review.yearsToBuild * 12)} months`,
                },
                {
                  concept: "supply",
                  label: "Connection capacity",
                  value: formatWatts(review.capacityW),
                  detail: reviewOutlook
                    ? undefined
                    : "Imports depend on neighboring supply and line conditions; backup is not guaranteed.",
                },
                ...(reviewOutlook
                  ? [
                      {
                        concept: "supply" as const,
                        label: "Import room",
                        value: `~${percent(reviewOutlook.atPeak)} at your peak`,
                        detail: `Typically ${percent(reviewOutlook.mean)} of the line; least in ${MONTH_NAMES[reviewOutlook.lowMonth]} (${percent(reviewOutlook.monthly[reviewOutlook.lowMonth])}). ${reviewMarket?.description ?? ""}`,
                      },
                      {
                        concept: "money" as const,
                        label: "Neighbor price",
                        value: priceRange(reviewOutlook),
                        detail: `${reviewPeriods ? reviewPeriods + ". " : ""}Imports come from your cheapest connected neighbor first.`,
                      },
                    ]
                  : []),
              ]}
            />
          </DialogContent>
          <DialogActions>
            <Button
              variant="contained"
              disabled={readOnly || !now || now.cash < review.buildCost}
              onClick={() => approve(false)}
            >
              Pay cash
            </Button>
            <Button
              id={`approve-intertie-${review.id}`}
              variant="outlined"
              disabled={readOnly || !now || now.cash < reviewDownpayment}
              onClick={() => approve(true)}
            >
              Take loan
            </Button>
          </DialogActions>
        </Dialog>
      )}
    </div>
  );
}
