import ManualLink from "../base/ManualLink";
import { MANUAL_ENTRY } from "../../data/Manual";
import { INTERTIE_ARCHETYPES } from "../../data/IntertieArchetypes";
import * as React from "react";
import KeyboardArrowDownIcon from "@mui/icons-material/KeyboardArrowDown";
import ArrowDropDownIcon from "@mui/icons-material/ArrowDropDown";
import ArrowDropUpIcon from "@mui/icons-material/ArrowDropUp";
import ClosableDialogTitle from "../base/ClosableDialogTitle";
import {
  Avatar,
  Box,
  Button,
  Card,
  CardHeader,
  Chip,
  Collapse,
  Dialog,
  DialogActions,
  DialogContent,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  Typography,
} from "@mui/material";
import {
  DOWNPAYMENT_PERCENT,
  LOAN_MONTHS,
  MAX_INTERTIE_UPGRADES,
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
import {
  formatMoneyConcise,
  formatSignedWattsOfPeak,
  formatWatts,
} from "../../helpers/Format";
import {
  adjacentMarketPricePerMWh,
  corridorConstructionKgco2e,
  intertieCapacityCeilingW,
  intertieContextForGame,
  intertieTechnologyCeilingW,
  intertieUpgradeCount,
  intertieUpgradeQuote,
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
  TransmissionCorridorDefinitionType,
  TransmissionLineOperatingType,
  UnitSystemType,
} from "../../Types";
import {
  formatLargeMassValueConcise,
  formatMass,
  largeMassUnit,
} from "../../helpers/Units";
import { useUnits } from "../base/UnitsContext";
import ConceptIcon from "../base/ConceptIcon";
import DecisionImpactPreview from "../base/DecisionImpactPreview";
import Sparkline from "../base/Sparkline";
import BuildMetric, { ConstructionEmissionsMetric } from "../base/BuildMetric";
import FlowBar from "../base/FlowBar";
import { chartPalette } from "../../Theme";

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

/**
 * One buildable corridor, laid out like the generator and storage purchase cards: heading and
 * Review button, the reason it can't be bought when it can't, a metric grid, then everything
 * that helps you compare neighbours behind the same disclosure. The archetype's character and
 * its typical year are the "why this one" material, which is what the details are for.
 */
function IntertieBuildItem(props: {
  corridor: TransmissionCorridorDefinitionType;
  cash: number | undefined;
  interestRate: number;
  outlook?: IntertieOutlook;
  readOnly: boolean;
  units: UnitSystemType;
  onReview: () => void;
}): React.JSX.Element {
  const { cash, corridor, outlook, readOnly, units } = props;
  const [expanded, setExpanded] = React.useState(false);
  const market = adjacentMarketForCorridor(corridor.id);
  const name = market?.name || corridor.name;
  const downpayment = corridor.buildCost * DOWNPAYMENT_PERCENT;
  const financed = corridor.buildCost - downpayment;
  // The loan is the cheaper of the two ways in, so it sets the bar for whether this is a
  // decision at all. Cash purchase is still offered in the review dialog when it's affordable.
  const buildable = cash !== undefined && cash >= downpayment;
  return (
    <Card
      className="build-list-item buildOption transmissionProject"
      data-corridor-id={corridor.id}
      data-testid={`transmission-project-${corridor.id}`}
    >
      <CardHeader
        avatar={<Avatar alt="" src="/images/transmission.svg" />}
        action={
          readOnly ? undefined : (
            <Button
              id={`review-intertie-${corridor.id}`}
              aria-label={`Review purchase of ${name} intertie`}
              size="small"
              variant="outlined"
              color="primary"
              startIcon={<ConceptIcon concept="buy" fontSize="small" />}
              disabled={!buildable}
              onClick={props.onReview}
            >
              Review
            </Button>
          )
        }
        // These corridor names were headings before the card layout, and a list of purchase
        // options is exactly what heading navigation is for. MUI's default span would take
        // that away for no visual difference. h6 is what the old `variant="subtitle1"` emitted
        // and what the dialog's own "Build..." title is, so the list stays navigable without
        // jumping back up a level underneath it.
        slotProps={{ title: { component: "h6" } }}
        title={name}
      />
      <Typography className="buildOptionContext" variant="body2">
        {corridor.name}
        {" · "}
        <span className="nowrap">
          {corridor.routeType === "EXISTING"
            ? "Existing corridor"
            : "New corridor"}
        </span>
        {market && (
          <>
            {" · "}
            <span className="nowrap">
              {INTERTIE_ARCHETYPES[market.archetype].label}
            </span>
          </>
        )}
      </Typography>
      {!readOnly && !buildable && (
        <Typography
          component="div"
          className="buildOptionWarning"
          color="textSecondary"
        >
          Need {formatMoneyConcise(downpayment)} down payment · you have{" "}
          {formatMoneyConcise(cash || 0)}
        </Typography>
      )}
      <Box className="buildOptionMetrics">
        <BuildMetric label="Capacity" value={formatWatts(corridor.capacityW)} />
        <BuildMetric
          label="Build time"
          value={`${corridor.yearsToBuild} year${corridor.yearsToBuild === 1 ? "" : "s"}`}
        />
        <BuildMetric
          label="Total cost"
          value={formatMoneyConcise(corridor.buildCost)}
        />
        <BuildMetric
          label="Loan payment"
          value={`${formatMoneyConcise(
            getMonthlyPayment(financed, props.interestRate, LOAN_MONTHS),
          )}/mo`}
        />
        {market && (
          <BuildMetric
            label="Emissions"
            value={`${formatMass(market.emissionsKgco2ePerMWh, units)}/MWh`}
          />
        )}
        <ConstructionEmissionsMetric
          kgco2eTotal={corridorConstructionKgco2e(corridor)}
          yearsToBuild={corridor.yearsToBuild}
          units={units}
        />
      </Box>
      {!readOnly && buildable && (
        <Typography
          component="div"
          className="buildOptionContext"
          variant="caption"
          color="textSecondary"
        >
          Pay {formatMoneyConcise(downpayment)} now · finance{" "}
          {formatMoneyConcise(financed)}
        </Typography>
      )}
      <Box className="buildOptionFooter">
        <Button
          color="primary"
          className="expand-details"
          size="small"
          aria-label={`${expanded ? "Hide" : "Show"} ${name} details`}
          aria-expanded={expanded}
          endIcon={expanded ? <ArrowDropUpIcon /> : <ArrowDropDownIcon />}
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? "Hide details" : "Show details"}
        </Button>
      </Box>
      <Collapse in={expanded} timeout="auto" unmountOnExit>
        {market && (
          <Typography
            className="buildOptionDescription"
            variant="body2"
            color="textSecondary"
          >
            {INTERTIE_ARCHETYPES[market.archetype].summary}
          </Typography>
        )}
        {outlook && (
          <Box className="buildOptionDetailBody">
            <dl className="transmissionMetrics">
              <div>
                <dt>At your peak</dt>
                <dd>~{percent(outlook.atPeak)} of line</dd>
              </div>
              <PriceMetric outlook={outlook} />
            </dl>
            <IntertieYear outlook={outlook} />
          </Box>
        )}
      </Collapse>
    </Card>
  );
}

/**
 * Widening a line that already runs. Shown in place rather than as a build card, because it is a
 * decision about an asset the player owns: the question is whether this corridor should carry
 * more, not which corridor to open.
 */
function IntertieUpgradeControl(props: {
  line: TransmissionLineOperatingType;
  cash?: number;
  year: number;
  interestRate: number;
  units: UnitSystemType;
  readOnly?: boolean;
  onUpgrade: (corridorId: string, financed: boolean) => void;
}): React.JSX.Element | null {
  const { line, cash, year, interestRate, units, readOnly, onUpgrade } = props;
  const [reviewing, setReviewing] = React.useState(false);
  const titleId = React.useId();
  if (line.upgrade) {
    const years = line.upgrade.yearsToBuildLeft;
    return (
      <Typography variant="body2" color="textSecondary">
        Upgrading to {formatWatts(line.upgrade.targetCapacityW, 3)} ·{" "}
        {years < 1
          ? `${Math.max(1, Math.round(years * 12))} months`
          : `${years.toFixed(1)} years`}{" "}
        remaining. The line keeps carrying {formatWatts(line.capacityW, 3)}{" "}
        until it is done.
      </Typography>
    );
  }
  const quote = intertieUpgradeQuote(line, year);
  if (!quote) {
    // Say which ceiling was reached. "No further upgrades" on its own reads as a bug.
    const atStepLimit = intertieUpgradeCount(line) >= MAX_INTERTIE_UPGRADES;
    return (
      <Typography variant="body2" color="textSecondary">
        {atStepLimit
          ? "Corridor full. More capacity needs a new route; these towers and substations cannot carry another circuit."
          : `${formatWatts(line.capacityW, 3)} is as much as this connection can carry, limited by ${
              intertieTechnologyCeilingW(year) <=
              intertieCapacityCeilingW(line.corridorId, year)
                ? "what can be built today"
                : "what the neighbor has to spare"
            }.`}
      </Typography>
    );
  }
  if (readOnly) return null;
  const downpayment = quote.buildCost * DOWNPAYMENT_PERCENT;
  const affordable = (cash ?? 0) >= downpayment;
  const months = Math.max(1, Math.round(quote.yearsToBuild * 12));
  return (
    <div className="transmissionUpgrade">
      <Typography variant="body2">
        Upgrade to {formatWatts(quote.targetCapacityW, 3)} ·{" "}
        {formatMoneyConcise(quote.buildCost)} · {months} mo ·{" "}
        {formatLargeMassValueConcise(quote.constructionKgco2eTotal, units)}{" "}
        {largeMassUnit(units)} CO2e to build
      </Typography>
      {!affordable && (
        <Typography variant="caption" color="textSecondary" component="div">
          Need {formatMoneyConcise(downpayment)} down · you have{" "}
          {formatMoneyConcise(cash ?? 0)}
        </Typography>
      )}
      <Button
        size="small"
        variant="outlined"
        color="primary"
        disabled={!affordable}
        aria-label={`Upgrade ${line.name} to ${formatWatts(quote.targetCapacityW, 3)}`}
        startIcon={<ConceptIcon concept="build" fontSize="small" />}
        onClick={() => setReviewing(true)}
      >
        Review upgrade
      </Button>
      {reviewing && (
        <Dialog
          open
          onClose={() => setReviewing(false)}
          fullWidth
          maxWidth="sm"
          aria-labelledby={titleId}
        >
          <ClosableDialogTitle id={titleId} onClose={() => setReviewing(false)}>
            Upgrade {line.name}?
          </ClosableDialogTitle>
          <DialogContent className="noPadding">
            <DecisionImpactPreview
              facts={[
                {
                  concept: "supply",
                  label: "Connection capacity",
                  value: `${formatWatts(line.capacityW, 3)} → ${formatWatts(quote.targetCapacityW, 3)}`,
                  detail:
                    "The line keeps its current capacity during construction. Imports still need spare neighboring supply.",
                },
                {
                  concept: "money",
                  label: "Cash purchase",
                  value: `${formatMoneyConcise(cash ?? 0)} → ${formatMoneyConcise((cash ?? 0) - quote.buildCost)}`,
                },
                {
                  concept: "finances",
                  label: "Loan option",
                  value: `${formatMoneyConcise(downpayment)} now + ${formatMoneyConcise(getMonthlyPayment(line.loanAmountLeft + quote.buildCost - downpayment, interestRate, LOAN_MONTHS))}/mo`,
                  detail: `Payments start during construction. Loan term: ${LOAN_MONTHS / 12} years. Interest rate: ${(interestRate * 100).toFixed(2)}%.${line.loanAmountLeft > 0 ? ` Includes refinancing the existing ${formatMoneyConcise(line.loanAmountLeft)} balance at this rate and term.` : ""}`,
                },
                {
                  concept: "money",
                  label: "Upkeep after upgrade",
                  value: `${formatMoneyConcise(line.annualOperatingCost / 12)} → ${formatMoneyConcise(quote.annualOperatingCost / 12)}/mo`,
                  detail: "Electricity purchases and loan payments are extra.",
                },
                {
                  concept: "time",
                  label: "Upgrade complete in",
                  value: `${months} months`,
                },
                {
                  concept: "construction",
                  label: "Construction emits",
                  value: `${formatLargeMassValueConcise(quote.constructionKgco2eTotal, units)} ${largeMassUnit(units)} CO2e`,
                },
              ]}
            />
          </DialogContent>
          <DialogActions>
            <Button
              variant="contained"
              disabled={(cash ?? 0) < quote.buildCost}
              onClick={() => {
                setReviewing(false);
                onUpgrade(line.corridorId, false);
              }}
            >
              Pay cash
            </Button>
            <Button
              variant="outlined"
              disabled={!affordable}
              onClick={() => {
                setReviewing(false);
                onUpgrade(line.corridorId, true);
              }}
            >
              Take loan
            </Button>
          </DialogActions>
        </Dialog>
      )}
    </div>
  );
}

export interface TransmissionPanelProps {
  game: GameType;
  projectsOnly?: boolean;
  onBuild: (corridorId: string, financed: boolean) => void;
  onUpgrade: (corridorId: string, financed: boolean) => void;
  onPolicy: (policy: TradingPolicyType) => void;
}

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
      </FormControl>
    </div>
  );
}

export default function TransmissionPanel({
  game,
  onBuild,
  onUpgrade,
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
  const outlookFor = (corridorId: string, capacityW?: number) =>
    forecast &&
    intertieOutlook(
      corridorId,
      intertieContext,
      forecast,
      game.date.minute,
      capacityW,
    );
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
                ? outlookFor(line.corridorId, line.capacityW)
                : undefined;
            // Signed against the line's current rating, so the row reads the same way a
            // facility row does: positive is power arriving, negative is power being sold.
            const flowW = building ? 0 : line.currentFlowW || 0;
            const flowFraction =
              rating > 0 ? Math.max(-1, Math.min(1, flowW / rating)) : 0;
            const flowLabel = formatSignedWattsOfPeak(flowW, rating);
            // aria-label replaces a button's descendant content for its accessible name, so a
            // visually hidden span inside the row would never be announced. The reading and the
            // direction the bar and the sign carry visually have to be in the label itself.
            const flowDescription = building
              ? `building, ${line.yearsToBuildLeft.toFixed(1)}${
                  line.yearsToBuildLeft <= 1 ? " year" : " years"
                } remaining`
              : flowW > 0
                ? `importing ${formatWatts(flowW)} of ${formatWatts(rating)}`
                : flowW < 0
                  ? `selling ${formatWatts(-flowW)} of ${formatWatts(rating)}`
                  : "no power flowing";
            return (
              <div key={line.id} className="transmissionLine">
                <button
                  type="button"
                  className="facilityDisclosure"
                  aria-label={`Inspect ${line.name}, ${flowDescription}`}
                  aria-expanded={selectedLine === line.id}
                  onClick={() =>
                    setSelectedLine(selectedLine === line.id ? null : line.id)
                  }
                >
                  {!building && (
                    <FlowBar
                      fraction={flowFraction}
                      color={chartPalette().intertie}
                    />
                  )}
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
                      {building ? (
                        <>
                          {line.yearsToBuildLeft.toFixed(1) +
                            (line.yearsToBuildLeft <= 1 ? " year" : " years") +
                            " remaining"}
                          {" · "}
                          <span className="transmissionLineStatus">
                            Building
                          </span>
                        </>
                      ) : (
                        <span className="transmissionLineFlow">
                          {flowLabel}
                        </span>
                      )}
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
                      {market?.name} · {formatWatts(line.capacityW, 3)} rated
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
                    {!building && (
                      <IntertieUpgradeControl
                        line={line}
                        cash={now?.cash}
                        year={game.date.year}
                        interestRate={game.interestRate}
                        units={units}
                        readOnly={readOnly}
                        onUpgrade={onUpgrade}
                      />
                    )}
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
            {unbuiltCorridors.map((corridor) => (
              <IntertieBuildItem
                key={corridor.id}
                corridor={corridor}
                cash={now?.cash}
                interestRate={game.interestRate}
                outlook={outlookFor(corridor.id)}
                readOnly={readOnly}
                units={units}
                onReview={() => setReviewId(corridor.id)}
              />
            ))}
          </div>
        </section>
      )}
      {projectsOnly && (
        <ManualLink entry={MANUAL_ENTRY.INTERTIES} text="How interties work" />
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
