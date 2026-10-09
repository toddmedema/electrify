import { getCostTableIndex } from "../../data/Economy";
import { activeScenario, currentTick } from "../../helpers/GameSelectors";
import {
  accessContextForGame,
  corridorsForGame,
  IntertieAccessContext,
} from "../../data/IntertieAccess";
import ManualLink from "../base/ManualLink";
import { MANUAL_ENTRY } from "../base/ManualEntries";
import { INTERTIE_ARCHETYPES } from "../../data/IntertieArchetypes";
import * as React from "react";
import {
  DragDropContext,
  Draggable,
  Droppable,
  DropResult,
} from "@hello-pangea/dnd";
import DragIndicatorIcon from "@mui/icons-material/DragIndicator";
import { ChevronDownGlyph } from "../base/Glyphs";
import {
  Box,
  Button,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  Typography,
  useTheme,
} from "@mui/material";
import {
  MAX_INTERTIE_UPGRADES,
  MONTH_NAMES,
  MONTHS,
  TICK_MINUTES,
  TICKS_PER_YEAR,
  YEARS_PER_TICK,
} from "../../Constants";
import {
  adjacentMarketForCorridor,
  corridorsForLocation,
} from "../../data/AdjacentMarkets";
import { importEmissionsKgco2ePerMWh } from "../../data/ImportEmissions";
import {
  corridorAvailableFromYear,
  corridorOpenInYear,
} from "../../data/IntertieTrends";
import {
  formatMoneyConcise,
  formatSignedWattsOfPeak,
  formatWatts,
} from "../../helpers/Format";
import {
  adjacentMarketPricePerMWh,
  intertieBuildQuote,
  intertieCapacityCeilingW,
  intertieContextForGame,
  intertieDirectionalCapacities,
  intertieTechnologyCeilingW,
  intertieUpgradeCount,
  intertieUpgradeQuote,
  intertieImportLimitW,
  transmissionRatingW,
  neighborImportSupplyW,
} from "../../helpers/Transmission";
import {
  intertieOutlook,
  intertieForecastKey,
  IntertieOutlook,
  pricePeriodCaption,
} from "../../helpers/IntertieOutlook";
import { generateNewTimeline } from "../../reducers/Game";
import { purchaseTerms } from "../../helpers/Financials";
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
import BuildOptionCard from "../base/BuildOptionCard";
import PurchaseReviewDialog, {
  financingShortfallText,
} from "../base/PurchaseReviewDialog";
import Sparkline from "../base/Sparkline";
import { useAfterPaintValue } from "../base/AfterPaint";
import BuildMetric, { ConstructionEmissionsMetric } from "../base/BuildMetric";
import FlowBar from "../base/FlowBar";
import CancelIcon from "@mui/icons-material/Cancel";
import ConfirmDialog from "../base/ConfirmDialog";
import ConstructionBuildHeader from "../base/ConstructionBuildHeader";

type IntertieSortKey = "yearsToBuild" | "buildCost" | "emissions";
const sortOptions: ReadonlyArray<readonly [IntertieSortKey, string]> = [
  ["yearsToBuild", "Fastest"],
  ["buildCost", "Cheapest"],
  ["emissions", "Lowest emissions"],
];

const POLICY_LABELS: Record<TradingPolicyType, string> = {
  BALANCED: "Buy for shortages, sell extra",
  RELIABILITY_FIRST: "Buy for shortages only",
  SURPLUS_ONLY: "Sell extra only",
  CLOSED: "No trading",
};

function priceRange(outlook: IntertieOutlook): string {
  // Whole dollars: a typical range is an estimate, and cents would suggest otherwise
  const low = formatMoneyConcise(Math.round(outlook.priceLow));
  const high = formatMoneyConcise(Math.round(outlook.priceHigh));
  return low === high ? `${low}/MWh` : `${low}–${high.replace("$", "")}/MWh`;
}

function limitChangeText(before: number, after: number): string {
  return `${formatWatts(before, 3)} → ${formatWatts(after, 3)}${before === after ? " · Unchanged" : ""}`;
}

/** Hourly steps keep every hour of the day while costing a quarter of a full-resolution forecast */
const OUTLOOK_STEP_MINUTES = 60;
const OUTLOOK_YEARS = 2;

/**
 * A two-year hourly forecast, refreshed each month and whenever a portfolio, policy or story
 * decision changes its inputs. Excludes unfinished assets. Undefined while disabled or before
 * the first tick exists. A refresh is
 * computed after paint, so the month rollover's frame keeps drawing last month's outlook.
 */
function useIntertieForecast(
  game: GameType,
  enabled: boolean,
): TickPresentFutureType[] | undefined {
  return useAfterPaintValue(
    enabled ? intertieForecastKey(game) : undefined,
    () => {
      const now = currentTick(game);
      return now
        ? generateNewTimeline(
            {
              ...game,
              facilities: game.facilities.filter(
                (f) => f.yearsToBuildLeft <= 0,
              ),
              transmission: {
                tradingPolicy: game.transmission?.tradingPolicy || "BALANCED",
                lines: (game.transmission?.lines || [])
                  .filter((l) => l.yearsToBuildLeft <= 0)
                  .map((l) => ({ ...l, upgrade: undefined })),
              },
            },
            now.cash,
            now.customers,
            (TICKS_PER_YEAR * OUTLOOK_YEARS * TICK_MINUTES) /
              OUTLOOK_STEP_MINUTES,
            OUTLOOK_STEP_MINUTES,
          )
        : undefined;
    },
  );
}

/** Typical-year import room, drawn like the generator build cards' output lines */
function IntertieYear({
  outlook,
  prominent = false,
}: {
  outlook: IntertieOutlook;
  prominent?: boolean;
}) {
  const { monthly, lowMonth, importCapacityW } = outlook;
  const highMonth = monthly.reduce(
    (high, value, month) => (value > monthly[high] ? month : high),
    0,
  );
  return (
    <figure
      className={`intertieYear${prominent ? " intertieAvailability" : ""}`}
    >
      {prominent && (
        <Typography
          variant="caption"
          color="textSecondary"
          component="figcaption"
        >
          Typical import availability · % of import capacity
        </Typography>
      )}
      {prominent && <span className="intertieAvailabilityLimit">100%</span>}
      <Sparkline
        values={monthly}
        domain={[0, 1]}
        width={prominent ? 480 : 96}
        height={prominent ? 80 : 24}
        stretch
        baseline
        fill
        lowMarker={!prominent}
        ariaLabel={`Typical year of import room: most in ${MONTH_NAMES[highMonth]} at ${formatWatts(monthly[highMonth] * importCapacityW)}, least in ${MONTH_NAMES[lowMonth]} at ${formatWatts(monthly[lowMonth] * importCapacityW)}.`}
      />
      {prominent && <span className="intertieAvailabilityLimit">0%</span>}
      {prominent ? (
        <div className="intertieAvailabilityLabels">
          <span>Jan</span>
          <span>
            Low {MONTHS[lowMonth]}{" "}
            {formatWatts(monthly[lowMonth] * importCapacityW)}
          </span>
          <span>Dec</span>
        </div>
      ) : (
        <Typography
          variant="caption"
          color="textSecondary"
          component="figcaption"
        >
          Typical year · Low {MONTHS[lowMonth]}{" "}
          {formatWatts(monthly[lowMonth] * importCapacityW)}
        </Typography>
      )}
    </figure>
  );
}

function PriceMetric({ outlook }: { outlook: IntertieOutlook }) {
  const periods = pricePeriodCaption(outlook);
  return (
    <div className="facilityStat">
      <dt>Typical price</dt>
      <dd className="facilityStatValue">
        {priceRange(outlook)}
        {periods && <span className="facilityStatNote">{periods}</span>}
      </dd>
    </div>
  );
}

/**
 * One buildable corridor, laid out like the generator and storage purchase cards: heading and
 * Review button, the reason it can't be bought when it can't, a metric grid, then everything
 * that helps you compare neighbours behind the same disclosure. Supply availability leads the
 * details, followed by import conditions and construction emissions.
 */
function IntertieBuildItem(props: {
  corridor: TransmissionCorridorDefinitionType;
  cash: number | undefined;
  interestRate: number;
  outlook?: IntertieOutlook;
  readOnly: boolean;
  units: UnitSystemType;
  onReview: () => void;
  importCapacityW: number;
  exportCapacityW: number;
  constructionKgco2eTotal: number;
  year: number;
}): React.JSX.Element {
  const { cash, corridor, outlook, readOnly, units } = props;
  const market = adjacentMarketForCorridor(corridor.id);
  const name = market?.name || corridor.name;
  const loan = purchaseTerms(corridor.buildCost, true, props.interestRate);
  // The loan is the cheaper of the two ways in, so it sets the bar for whether this is a
  // decision at all. Cash purchase is still offered in the review dialog when it's affordable.
  const buildable = cash !== undefined && cash >= loan.downpayment;
  return (
    <BuildOptionCard
      name={name}
      iconSrc="/images/transmission.svg"
      iconAlt=""
      className="transmissionProject"
      cardProps={{
        "data-corridor-id": corridor.id,
        "data-testid": `transmission-project-${corridor.id}`,
      }}
      // These corridor names were headings before the card layout, and a list of purchase
      // options is exactly what heading navigation is for. MUI's default span would take that
      // away for no visual difference. h6 is what the old `variant="subtitle1"` emitted and
      // what the dialog's own "Build..." title is, so the list stays navigable without jumping
      // back up a level underneath it.
      titleComponent="h6"
      review={
        readOnly
          ? undefined
          : {
              id: `review-intertie-${corridor.id}`,
              ariaLabel: `Review purchase of ${name} intertie`,
              disabled: !buildable,
              onClick: props.onReview,
            }
      }
      context={
        <>
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
        </>
      }
      warning={
        !readOnly && !buildable
          ? financingShortfallText(cash || 0, loan.downpayment)
          : undefined
      }
      metrics={
        <>
          <BuildMetric
            label="Import capacity"
            value={formatWatts(props.importCapacityW)}
          />
          <BuildMetric
            label="Export capacity"
            value={formatWatts(props.exportCapacityW)}
          />
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
            value={`${formatMoneyConcise(loan.monthlyPayment)}/mo`}
          />
          {market && (
            <BuildMetric
              label="Emissions"
              value={`${formatMass(importEmissionsKgco2ePerMWh(market.id, props.year), units)}/MWh`}
            />
          )}
        </>
      }
      details={
        <>
          {outlook && (
            <Box className="buildOptionDetailBody">
              <IntertieYear outlook={outlook} prominent />
            </Box>
          )}
          {market && (
            <Typography
              className="buildOptionDescription"
              variant="body2"
              color="textSecondary"
            >
              {INTERTIE_ARCHETYPES[market.archetype].summary}
            </Typography>
          )}
          <Box className="intertieDetailMetrics">
            {outlook && (
              <>
                <BuildMetric
                  label="At your peak"
                  value={`~${formatWatts(outlook.atPeak * outlook.importCapacityW)}`}
                />
                <BuildMetric
                  label="Typical import price"
                  value={priceRange(outlook)}
                  note={pricePeriodCaption(outlook) || undefined}
                />
              </>
            )}
            <ConstructionEmissionsMetric
              kgco2eTotal={props.constructionKgco2eTotal}
              yearsToBuild={corridor.yearsToBuild}
              units={units}
            />
          </Box>
        </>
      }
    />
  );
}

/**
 * Widening a line that already runs. Shown in place rather than as a build card, because it is a
 * decision about an asset the player owns: the question is whether this corridor should carry
 * more, not which corridor to open.
 */
function IntertieUpgradeControl(props: {
  costIndex: number;
  line: TransmissionLineOperatingType;
  cash?: number;
  year: number;
  interestRate: number;
  units: UnitSystemType;
  readOnly?: boolean;
  onUpgrade: (corridorId: string, financed: boolean) => void;
  context: IntertieAccessContext;
}): React.JSX.Element | null {
  const {
    line,
    cash,
    year,
    interestRate,
    units,
    readOnly,
    onUpgrade,
    context,
  } = props;
  const [reviewing, setReviewing] = React.useState(false);
  if (line.upgrade) {
    const years = line.upgrade.yearsToBuildLeft;
    return (
      <Typography variant="body2" color="textSecondary">
        Upgrading ·{" "}
        {years < 1
          ? `${Math.max(1, Math.round(years * 12))} months`
          : `${years.toFixed(1)} years`}{" "}
        remaining. Current capacities stay in use until completion.
      </Typography>
    );
  }
  const quote = intertieUpgradeQuote(line, year, 1, 1, context);
  if (!quote) {
    // Say which ceiling was reached. "No further upgrades" on its own reads as a bug.
    const atStepLimit =
      intertieUpgradeCount(line, context) >= MAX_INTERTIE_UPGRADES;
    return (
      <Typography variant="body2" color="textSecondary">
        {atStepLimit
          ? "Corridor full. More capacity needs a new route."
          : intertieTechnologyCeilingW(year) <=
              intertieCapacityCeilingW(line.corridorId, year)
            ? "No larger connection can be built today."
            : "No more trading capacity is available from this neighbor."}
      </Typography>
    );
  }
  if (readOnly) return null;
  const { downpayment } = purchaseTerms(quote.buildCost, true, interestRate);
  const shortfall = financingShortfallText(cash ?? 0, downpayment);
  const months = Math.max(1, Math.round(quote.yearsToBuild * 12));
  const capacityBefore = intertieDirectionalCapacities(
    line.corridorId,
    context,
    line.capacityW,
  );
  const capacityAfter = intertieDirectionalCapacities(
    line.corridorId,
    context,
    quote.targetCapacityW,
  );
  return (
    <div className="transmissionUpgrade">
      {shortfall && (
        <Typography variant="caption" color="textSecondary" component="div">
          {shortfall}
        </Typography>
      )}
      <Button
        size="small"
        variant="outlined"
        color="primary"
        disabled={!!shortfall}
        aria-label={`Review upgrade of ${line.name}`}
        startIcon={<ConceptIcon concept="build" fontSize="small" />}
        onClick={() => setReviewing(true)}
      >
        Review upgrade
      </Button>
      {reviewing && (
        <PurchaseReviewDialog
          open
          onClose={() => setReviewing(false)}
          title={`Upgrade ${line.name}?`}
          cash={cash ?? 0}
          buildCost={quote.buildCost}
          interestRate={interestRate}
          refinancedBalance={line.loanAmountLeft}
          leadingFacts={[
            {
              concept: "supply",
              label: "Import capacity",
              value: limitChangeText(
                capacityBefore.importCapacityW,
                capacityAfter.importCapacityW,
              ),
              detail: "New capacities apply when construction finishes.",
            },
            {
              concept: "supply",
              label: "Export capacity",
              value: limitChangeText(
                capacityBefore.exportCapacityW,
                capacityAfter.exportCapacityW,
              ),
            },
          ]}
          upkeepLabel="Upkeep after upgrade"
          upkeepBeforePerMonth={
            (line.annualOperatingCost * props.costIndex) / 12
          }
          upkeepPerMonth={(quote.annualOperatingCost * props.costIndex) / 12}
          upkeepDetail="Plus electricity purchases and loan payments."
          onlineInLabel="Upgrade complete in"
          onlineInMonths={months}
          extraFacts={[
            {
              concept: "construction",
              label: "Construction emits",
              value: `${formatLargeMassValueConcise(quote.constructionKgco2eTotal, units)} ${largeMassUnit(units)} CO2e`,
            },
          ]}
          onPurchase={(financed) => {
            setReviewing(false);
            onUpgrade(line.corridorId, financed);
          }}
        />
      )}
    </div>
  );
}

export interface TransmissionPanelProps {
  onBeforeDragStart?: () => void;
  onDragEnd?: (result: DropResult) => void;
  onCancel?: (id: number) => void;
  onPause?: (id: number, name: string, paused: boolean) => void;
  game: GameType;
  projectsOnly?: boolean;
  onBuild: (corridorId: string, financed: boolean, tier?: number) => void;
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
  const now = currentTick(game);
  const importedW = now?.importedW || 0;
  const exportedW = now?.exportedW || 0;
  if (importedW > 0) return "Importing " + formatWatts(importedW);
  if (exportedW > 0) return "Exporting " + formatWatts(exportedW);
  return "No power flowing";
}

// Keep the trading rule editable beside the ordered connections it governs.
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
  onCancel,
  onPause,
  onBeforeDragStart,
  onDragEnd,
  projectsOnly = false,
}: TransmissionPanelProps) {
  const units = useUnits();
  const [cancelLine, setCancelLine] =
    React.useState<TransmissionLineOperatingType | null>(null);
  const [selectedLine, setSelectedLine] = React.useState<number | null>(null);
  const [tier, setTier] = React.useState(1);
  const theme = useTheme();
  const [sort, setSort] = React.useState<IntertieSortKey>("yearsToBuild");
  const [reviewId, setReviewId] = React.useState<string | null>(null);
  const state = game.transmission ?? { tradingPolicy: "BALANCED", lines: [] };
  const availableCorridors = corridorsForGame(game);
  const now = currentTick(game);
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
  const buildQuote = (corridorId: string, selectedTier = tier) =>
    intertieBuildQuote(
      corridorId,
      game.date.year,
      selectedTier,
      intertieContext,
    );
  const projects = (projectsOnly ? unbuiltCorridors : [])
    .map(({ id }) => buildQuote(id))
    .filter((quote) => quote !== undefined)
    .map((quote) => ({
      quote,
      emissions: importEmissionsKgco2ePerMWh(
        quote.adjacentMarketId,
        game.date.year,
      ),
    }))
    .sort((a, b) =>
      sort === "emissions"
        ? a.emissions - b.emissions
        : a.quote[sort] - b.quote[sort],
    );
  const maxTier = Math.max(
    1,
    ...unbuiltCorridors.map(
      ({ id }) =>
        Array.from(
          { length: MAX_INTERTIE_UPGRADES + 1 },
          (_, index) => index + 1,
        ).filter((candidate) => buildQuote(id, candidate)).length,
    ),
  );
  const review =
    reviewId && unbuiltCorridors.some(({ id }) => id === reviewId)
      ? buildQuote(reviewId)
      : undefined;
  const reviewMarket = review && adjacentMarketForCorridor(review.id);
  const reviewCapacity =
    review &&
    intertieDirectionalCapacities(review.id, intertieContext, review.capacityW);
  const approve = (financed: boolean) => {
    if (!review) return;
    onBuild(review.id, financed, tier);
    setReviewId(null);
  };

  // Paths whose real counterpart had not been built yet in this year, soonest first.
  const upcomingCorridors = corridorsForLocation(game.location)
    .filter(
      ({ id }) =>
        !corridorOpenInYear(id, game.date.year) &&
        corridorAvailableFromYear(id) > game.date.year,
    )
    .sort(
      (a, b) =>
        corridorAvailableFromYear(a.id) - corridorAvailableFromYear(b.id),
    );

  if (!corridors.length && !upcomingCorridors.length && !state.lines.length) {
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
              <span>Trading order</span>
              {flowText && (
                <>
                  <span aria-hidden>·</span>
                  <span className="networkTradingFlow">{flowText}</span>
                </>
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
          <DragDropContext
            onBeforeDragStart={onBeforeDragStart}
            onDragEnd={onDragEnd ?? (() => undefined)}
          >
            <Droppable droppableId="interties">
              {(droppable) => (
                <div ref={droppable.innerRef} {...droppable.droppableProps}>
                  {state.lines.map((line, index) => {
                    const market = adjacentMarketForCorridor(line.corridorId);
                    const capacities = intertieDirectionalCapacities(
                      line.corridorId,
                      intertieContext,
                      line.capacityW,
                    );
                    const rating = now
                      ? transmissionRatingW(line, now)
                      : line.capacityW;
                    const building = line.yearsToBuildLeft > 0;
                    // Remaining time plus elapsed simulation time preserves the original build duration.
                    const elapsedYears =
                      (Math.max(0, game.date.minute - line.minuteCreated) /
                        TICK_MINUTES) *
                      YEARS_PER_TICK;
                    const builtFraction = building
                      ? elapsedYears / (elapsedYears + line.yearsToBuildLeft)
                      : 1;
                    const monthsLeft = Math.ceil(line.yearsToBuildLeft * 12);
                    const constructionLabel = `Building ${Math.round(builtFraction * 100)}% · ${monthsLeft} ${monthsLeft === 1 ? "month" : "months"} left`;
                    const constructionStyle = building
                      ? { opacity: theme.palette.action.disabledOpacity }
                      : undefined;
                    const importableW = now
                      ? intertieImportLimitW(
                          line,
                          intertieContext,
                          now.minute,
                          now,
                        )
                      : rating;
                    const outlook =
                      selectedLine === line.id
                        ? outlookFor(line.corridorId, line.capacityW)
                        : undefined;
                    // Signed against capacity in the direction of flow, so the row reads the same way a
                    // facility row does: positive is power arriving, negative is power being sold.
                    const flowW = building ? 0 : line.currentFlowW || 0;
                    const flowCapacityW =
                      flowW < 0
                        ? capacities.exportCapacityW
                        : capacities.importCapacityW;
                    const flowFraction =
                      flowCapacityW > 0
                        ? Math.max(-1, Math.min(1, flowW / flowCapacityW))
                        : 0;
                    const flowLabel = formatSignedWattsOfPeak(
                      flowW,
                      flowCapacityW,
                    );
                    // aria-label replaces a button's descendant content for its accessible name, so a
                    // visually hidden span inside the row would never be announced. The reading and the
                    // direction the bar and the sign carry visually have to be in the label itself.
                    const flowDescription = building
                      ? constructionLabel
                      : flowW > 0
                        ? `importing ${formatWatts(flowW)} of ${formatWatts(flowCapacityW)}`
                        : flowW < 0
                          ? `selling ${formatWatts(-flowW)} of ${formatWatts(flowCapacityW)}`
                          : line.paused
                            ? "paused"
                            : "no power flowing";
                    return (
                      <Draggable
                        key={line.id}
                        draggableId={`t${line.id}`}
                        index={index}
                        isDragDisabled={readOnly}
                        disableInteractiveElementBlocking
                      >
                        {(provided, snapshot) => (
                          <div
                            ref={provided.innerRef}
                            {...provided.draggableProps}
                            style={{
                              userSelect: "none",
                              ...provided.draggableProps.style,
                            }}
                            className={`transmissionLine${selectedLine === line.id ? " selected" : ""}${snapshot.isDragging ? " dragging" : ""}`}
                          >
                            <div className="facilityRowHeader">
                              {!building && <FlowBar fraction={flowFraction} />}
                              {!readOnly && (
                                <button
                                  type="button"
                                  {...provided.dragHandleProps}
                                  className="facilityDragHandle"
                                  aria-label={`Reorder ${line.name}`}
                                >
                                  <DragIndicatorIcon aria-hidden />
                                </button>
                              )}
                              <button
                                type="button"
                                className="facilityDisclosure"
                                aria-label={`Inspect ${line.name}, ${flowDescription}`}
                                aria-expanded={selectedLine === line.id}
                                onClick={() =>
                                  setSelectedLine(
                                    selectedLine === line.id ? null : line.id,
                                  )
                                }
                              >
                                <img
                                  className="transmissionListIcon"
                                  style={constructionStyle}
                                  src="/images/transmission.svg"
                                  alt=""
                                />
                                <span className="transmissionLineText">
                                  <span style={constructionStyle}>
                                    {line.name}
                                  </span>
                                  <Typography
                                    component="span"
                                    variant="body2"
                                    color="textSecondary"
                                    style={constructionStyle}
                                  >
                                    {building ? (
                                      constructionLabel
                                    ) : (
                                      <span className="transmissionLineFlow">
                                        {line.paused ? "Paused" : flowLabel}
                                      </span>
                                    )}
                                  </Typography>
                                  {building && (
                                    <span
                                      className="constructionProgress"
                                      data-paused={game.speed === "PAUSED"}
                                      aria-hidden
                                    >
                                      <span
                                        className="constructionProgressFill"
                                        style={{
                                          width: `${builtFraction * 100}%`,
                                          background: "var(--interactive-blue)",
                                        }}
                                      />
                                    </span>
                                  )}
                                </span>
                                <ChevronDownGlyph
                                  className="facilityChevron"
                                  aria-hidden
                                />
                              </button>
                            </div>
                            {selectedLine === line.id && (
                              <div className="transmissionLineDetails">
                                {!readOnly && (
                                  <div className="facilityActions intertieActions">
                                    {building && onCancel && (
                                      <Button
                                        className="facilityCancelConstruction"
                                        startIcon={<CancelIcon />}
                                        aria-label={`Cancel construction of ${line.name}`}
                                        onClick={() => setCancelLine(line)}
                                      >
                                        <span className="facilityActionLabel">
                                          Cancel construction
                                        </span>
                                      </Button>
                                    )}
                                    {!building && onPause && (
                                      <Button
                                        startIcon={
                                          <ConceptIcon
                                            concept={
                                              line.paused ? "play" : "pause"
                                            }
                                          />
                                        }
                                        aria-label={`${line.paused ? "Resume" : "Pause"} ${line.name}`}
                                        onClick={() =>
                                          onPause(
                                            line.id,
                                            line.name,
                                            !!line.paused,
                                          )
                                        }
                                      >
                                        <span className="facilityActionLabel">
                                          {line.paused ? "Resume" : "Pause"}
                                        </span>
                                      </Button>
                                    )}
                                  </div>
                                )}
                                {cancelLine?.id === line.id && (
                                  <ConfirmDialog
                                    open
                                    title={`Cancel construction of ${line.name}?`}
                                    cancelLabel="Nevermind"
                                    confirmLabel="Cancel construction"
                                    onCancel={() => setCancelLine(null)}
                                    onConfirm={() => {
                                      onCancel?.(line.id);
                                      setCancelLine(null);
                                    }}
                                  >
                                    <Typography>
                                      Receive{" "}
                                      {formatMoneyConcise(
                                        line.buildCost - line.loanAmountLeft,
                                      )}{" "}
                                      back
                                      {line.loanAmountLeft > 0
                                        ? " after settling the outstanding loan"
                                        : ""}
                                      .
                                    </Typography>
                                  </ConfirmDialog>
                                )}
                                {outlook && (
                                  <div className="transmissionArchetype">
                                    <Typography
                                      variant="body2"
                                      color="textSecondary"
                                    >
                                      {outlook.archetype.summary}
                                    </Typography>
                                  </div>
                                )}
                                <dl className="transmissionMetrics facilityStats">
                                  <div className="facilityStat">
                                    <dt>Import capacity</dt>
                                    <dd className="facilityStatValue">
                                      {formatWatts(
                                        capacities.importCapacityW,
                                        3,
                                      )}
                                    </dd>
                                  </div>
                                  <div className="facilityStat">
                                    <dt>Export capacity</dt>
                                    <dd className="facilityStatValue">
                                      {formatWatts(
                                        capacities.exportCapacityW,
                                        3,
                                      )}
                                    </dd>
                                  </div>
                                  {!building && now && (
                                    <>
                                      <div className="facilityStat">
                                        <dt>Price now</dt>
                                        <dd className="facilityStatValue">
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
                                      <div className="facilityStat">
                                        <dt>Import available now</dt>
                                        <dd className="facilityStatValue">
                                          {formatWatts(importableW)}
                                        </dd>
                                      </div>
                                    </>
                                  )}
                                  {market && (
                                    <div className="facilityStat">
                                      <dt>Emissions (CO2e)</dt>
                                      <dd className="facilityStatValue">
                                        {formatMass(
                                          importEmissionsKgco2ePerMWh(
                                            market.id,
                                            game.date.year,
                                          ),
                                          units,
                                        )}
                                        /MWh
                                      </dd>
                                    </div>
                                  )}
                                  {outlook && <PriceMetric outlook={outlook} />}
                                  {line.loanAmountLeft > 0 && (
                                    <div className="facilityStat">
                                      <dt>Loan balance</dt>
                                      <dd className="facilityStatValue">
                                        {formatMoneyConcise(
                                          line.loanAmountLeft,
                                        )}
                                      </dd>
                                    </div>
                                  )}
                                </dl>
                                {!building && now && (
                                  <Typography
                                    variant="body2"
                                    color="textSecondary"
                                  >
                                    Flow limited by:{" "}
                                    {line.paused
                                      ? "Paused"
                                      : state.tradingPolicy === "CLOSED" ||
                                          (state.tradingPolicy ===
                                            "SURPLUS_ONLY" &&
                                            flowW >= 0)
                                        ? "Trading rule"
                                        : flowW < 0
                                          ? Math.abs(flowW) >=
                                            capacities.exportCapacityW - 1
                                            ? "Export capacity"
                                            : Math.abs(flowW) >= rating - 1
                                              ? "Weather"
                                              : "Local surplus"
                                          : Math.abs(flowW) < importableW - 1
                                            ? "Local demand or trading rule"
                                            : neighborImportSupplyW(
                                                  line.corridorId,
                                                  intertieContext,
                                                  now.minute,
                                                  now,
                                                  line.capacityW,
                                                ) < rating
                                              ? "Neighbor supply"
                                              : rating <
                                                  capacities.importCapacityW
                                                ? "Weather"
                                                : "Import capacity"}
                                    .
                                  </Typography>
                                )}
                                {outlook && <IntertieYear outlook={outlook} />}
                                {!building && (
                                  <IntertieUpgradeControl
                                    costIndex={getCostTableIndex(
                                      game.date,
                                      game.startingYear,
                                      game.seed,
                                    )}
                                    line={line}
                                    context={accessContextForGame(game)}
                                    cash={now?.cash}
                                    year={game.date.year}
                                    interestRate={game.interestRate}
                                    units={units}
                                    readOnly={readOnly}
                                    onUpgrade={onUpgrade}
                                  />
                                )}
                              </div>
                            )}
                          </div>
                        )}
                      </Draggable>
                    );
                  })}
                  {droppable.placeholder}
                </div>
              )}
            </Droppable>
          </DragDropContext>
        </section>
      )}

      {projectsOnly && !unbuiltCorridors.length && (
        <Typography sx={{ px: 1.5, pt: 1 }}>
          {corridors.length
            ? "All available connections have been approved."
            : "No connections can be built yet."}
        </Typography>
      )}
      {projectsOnly && !!unbuiltCorridors.length && (
        <section aria-label="Connection projects">
          <ConstructionBuildHeader
            capacityLabel="Tier"
            capacity={String(tier)}
            sliderValue={tier}
            sliderMin={1}
            sliderMax={maxTier}
            sliderDisabled={readOnly || maxTier === 1}
            sliderValueText={(value) => `Tier ${value}`}
            onSliderChange={setTier}
            sort={sort}
            sortOptions={sortOptions}
            sortLabel="Sort interties"
            onSortChange={(value) => setSort(value as IntertieSortKey)}
          />
          <div className="transmissionProjects">
            {projects.map(({ quote: corridor }) => {
              const capacities = intertieDirectionalCapacities(
                corridor.id,
                intertieContext,
                corridor.capacityW,
              );
              return (
                <IntertieBuildItem
                  key={corridor.id}
                  corridor={corridor}
                  importCapacityW={capacities.importCapacityW}
                  exportCapacityW={capacities.exportCapacityW}
                  constructionKgco2eTotal={corridor.constructionKgco2eTotal}
                  year={game.date.year}
                  cash={now?.cash}
                  interestRate={game.interestRate}
                  outlook={outlookFor(corridor.id, corridor.capacityW)}
                  readOnly={readOnly}
                  units={units}
                  onReview={() => setReviewId(corridor.id)}
                />
              );
            })}
          </div>
        </section>
      )}
      {projectsOnly && !!upcomingCorridors.length && (
        <Typography
          className="transmissionUpcoming"
          variant="body2"
          color="textSecondary"
          sx={{ px: 1.5, py: 1 }}
        >
          Opens later:{" "}
          {upcomingCorridors
            .map(
              ({ id, name }) =>
                `${adjacentMarketForCorridor(id)?.name || name} in ${corridorAvailableFromYear(id)}`,
            )
            .join(", ")}
        </Typography>
      )}
      {projectsOnly && (
        <ManualLink entry={MANUAL_ENTRY.INTERTIES} text="How interties work" />
      )}
      {review && (
        <PurchaseReviewDialog
          open
          onClose={() => setReviewId(null)}
          titleId="intertie-review-title"
          loanButtonId={`approve-intertie-${review.id}`}
          title={`Build ${reviewMarket?.name} · Tier ${tier}?`}
          cash={now?.cash ?? 0}
          buildCost={review.buildCost}
          interestRate={game.interestRate}
          cashDisabled={readOnly || !now}
          loanDisabled={readOnly || !now}
          leadingFacts={[
            {
              concept: "supply",
              label: "Import capacity",
              value: formatWatts(reviewCapacity?.importCapacityW || 0),
              detail: "Maximum power you can buy.",
            },
            {
              concept: "supply",
              label: "Export capacity",
              value: formatWatts(reviewCapacity?.exportCapacityW || 0),
              detail: "Maximum surplus power you can sell.",
            },
          ]}
          preface={
            <Box sx={{ px: 2, pb: 1 }}>
              <Typography variant="body2">
                Ready in {Math.round(review.yearsToBuild * 12)} months.
              </Typography>
              {game.date.monthsElapsed + review.yearsToBuild * 12 >=
                (activeScenario(game)?.durationMonths ?? Infinity) && (
                <Typography variant="body2" color="warning.main">
                  Won’t open before this mission ends.
                </Typography>
              )}
            </Box>
          }
          upkeepPerMonth={
            (review.annualOperatingCost *
              getCostTableIndex(game.date, game.startingYear, game.seed)) /
            12
          }
          upkeepDetail="Plus electricity purchases and loan payments."
          onPurchase={approve}
        />
      )}
    </div>
  );
}
