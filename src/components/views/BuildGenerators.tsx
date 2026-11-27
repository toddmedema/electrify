import { TransitionGroup } from "react-transition-group";
import {
  getInterfaceScale,
  subscribeInterfaceScale,
} from "../../InterfaceScale";
import RemovalCollapse from "../base/RemovalCollapse";
import { getTerritoryDefinition } from "../../data/Territories";
import TerritoryBuildDestination, {
  useTerritoryBuildDestination,
  useTerritoryBuildTile,
  territoryBuildTileName,
  territoryName,
} from "../base/TerritoryBuildDestination";
import {
  hasTerritoryNetwork,
  territoryBuildAvailability,
} from "../../helpers/Territories";
import type { TerritoryId, TerritoryTileId } from "../../Types";
import {
  getTerritoryTile,
  tileSupportsFacilityTechnology,
} from "../../helpers/TerritoryTiles";
import { useMoney } from "../base/CurrencyContext";
import {
  GameBuildCompleteContext,
  useGameWorkspaceLayout,
} from "../base/GameWorkspaceContext";
import * as React from "react";
import { useToolState, useToolScroll } from "../base/GameToolMemory";
import {
  Box,
  Button,
  Checkbox,
  Chip,
  FormControlLabel,
  List,
  Stack,
  Typography,
  IconButton,
  useMediaQuery,
} from "@mui/material";
import CheckIcon from "@mui/icons-material/Check";
import CloseIcon from "@mui/icons-material/Close";
import { getTimeFromTimeline } from "../../helpers/DateTime";
import {
  estimatedAnnualOperatingCost,
  facilityLoanMonths,
  purchaseTerms,
} from "../../helpers/Financials";
import {
  floorToTwoSignificantDigits,
  formatBuildMonths,
  formatForecastPercent,
  formatWatts,
} from "../../helpers/Format";
import { getFuelPricesPerMBTU } from "../../data/FuelPrices";
import {
  FUELS,
  MONTH_NAMES,
  MONTHS,
  WEATHER_DEPENDENT_FUELS,
} from "../../Constants";
import { getHydroAvailability } from "../../data/HydroSites";
import { withTerritoryCatalogueLimits } from "../../helpers/ProjectBuild";
import {
  multiplayerBuildAvailability,
  multiplayerHydroAvailability,
  multiplayerTerritoryTile,
} from "../../helpers/MultiplayerTerritory";
import { GENERATORS } from "../../data/Facilities";
import {
  DateType,
  GameType,
  GeneratorShoppingType,
  FuelNameType,
  LocationType,
} from "../../Types";
import { useBuildForecast } from "../base/BuildForecast";
import type { BuildForecast } from "../base/OutlookForecast";
import {
  sameBuildQuote,
  useBuildAffordability,
  useBuildAffordabilityKey,
  useBuildCashReader,
} from "../base/useBuildCash";
import {
  resilienceBuildOptions,
  ResilienceBuildOptionType,
  ResilienceSelectionType,
  withResilienceOptions,
} from "../../helpers/Hazards";
import {
  STANDARD_GAS_DESIGN_MIN_TEMP_C,
  TRACKER_ANNUAL_ENERGY_MULTIPLIER,
} from "../../data/Hazards";
import {
  coldPackageEffect,
  formatDesignTemperature,
} from "../base/WeatherResilienceText";
import {
  expectedMonthlyOutputShape,
  ExpectedOutputShape,
} from "../../helpers/ExpectedOutput";
import { MANUAL_ENTRY } from "../base/ManualEntries";
import {
  formatLargeMassValueConcise,
  formatMass,
  largeMassUnit,
} from "../../helpers/Units";
import BuildDetails, { BuildDetailRow } from "../base/BuildDetails";
import {
  directEmissionsPerMWh,
  generatorOutputPending,
  typicalCapacityFactor,
  type BuildPreviewComparison,
} from "../base/BuildPreviewComparison";
import { useUnits } from "../base/UnitsContext";
import BuildOptionCard from "../base/BuildOptionCard";
import {
  averageBuildSize,
  buildSizeOptions,
  largestAffordableBuildSize,
  sliderTickToW,
  wToSliderTick,
} from "../../helpers/BuildSizing";
import { BuildCashWarning } from "../base/PurchaseReviewDialog";
import {
  getBuildAvailability,
  getSiteInventory,
  siteCountLabel,
} from "../base/BuildAvailability";
import HydroPrimer, { useHydroPrimer } from "../base/HydroPrimer";
import RemainingSites from "../base/RemainingSites";
import { getScenario, getTutorialStep } from "../../data/Scenarios";
import BuildMetric from "../base/BuildMetric";
import ConstructionBuildHeader from "../base/ConstructionBuildHeader";
import useBuildRowReveal from "../base/useBuildRowReveal";
import { getLegacyBuildBounds } from "../../data/LegacyEra";
import BuildPurchaseReviewDialog, {
  finishBuildReview,
  type FacilityPurchaseSubmission,
} from "../base/BuildPurchaseReviewDialog";
import Sparkline from "../base/Sparkline";
import InteractiveSparkline from "../base/InteractiveSparkline";

function percent(fraction: number): string {
  return formatForecastPercent(fraction);
}

/**
 * Every card's line is drawn against the same ceiling, so a flat solar curve looks flat next to a
 * wind curve rather than being stretched to fill its own box. Rounded up to a tenth so the scale
 * doesn't wobble between forecasts. Hydro's inflow is left out: a wet month routinely tops its
 * nameplate, and letting that set the scale would flatten every other line on the list, so hydro
 * clips at the top edge instead and its caption carries the dry month.
 */
export function sharedOutputCeiling(
  shapes: (ExpectedOutputShape | undefined)[],
): number {
  const highest = Math.max(
    0,
    ...shapes.flatMap((shape) =>
      shape && shape.kind === "weather" ? shape.monthly : [],
    ),
  );
  return Math.min(1, Math.max(0.1, Math.ceil(highest * 10 - 1e-9) / 10));
}

const EMPTY_FORECAST: BuildForecast = {
  timeline: [],
  windSpeeds: [],
  offshoreWindSpeeds: [],
  airborneWindSpeeds: [],
  solarIrradiances: [],
};

function ExpectedOutputMetric(props: {
  shape?: ExpectedOutputShape;
  ceiling: number;
}): React.JSX.Element {
  const { shape, ceiling } = props;
  let caption = shape ? "" : "Calculating output…";
  let chart: React.ReactNode = null;
  if (shape && shape.kind === "on-demand") {
    caption = "On demand";
    chart = (
      <Sparkline
        values={new Array(12).fill(ceiling)}
        domain={[0, ceiling]}
        width={96}
        height={24}
        stretch
        baseline
        dash
        ariaLabel="Available on demand."
      />
    );
  } else if (shape) {
    const highMonth = shape.monthly.reduce(
      (high, value, month) => (value > shape.monthly[high] ? month : high),
      0,
    );
    const low = shape.monthly[shape.lowMonth];
    const water = shape.kind === "water-inflow";
    return (
      <InteractiveSparkline
        className="buildOptionMetric buildOptionOutput"
        chartClassName="buildOptionSparkline"
        captionClassName="buildOptionOutputCaption"
        captionFirst
        label={`Typical monthly ${water ? "water inflow" : "output"}`}
        defaultIndex={shape.lowMonth}
        caption={(month) =>
          `${MONTHS[month]}: ${percent(shape.monthly[month])} ${water ? "of typical water" : "capacity"}`
        }
        values={shape.monthly}
        domain={[0, ceiling]}
        width={96}
        height={24}
        stretch
        baseline
        fill
        lowMarker
        ariaLabel={`Typical year${water ? " of water inflow" : ""}: highest in ${MONTH_NAMES[highMonth]} at ${percent(shape.monthly[highMonth])}, lowest in ${MONTH_NAMES[shape.lowMonth]} at ${percent(low)}.`}
      />
    );
  }
  return (
    <div className="buildOptionMetric buildOptionOutput">
      <Typography
        className="buildOptionOutputCaption"
        variant="caption"
        color="textSecondary"
        component="div"
      >
        {caption}
      </Typography>
      <div className="buildOptionSparkline">{chart}</div>
    </div>
  );
}

interface GeneratorBuildItemProps {
  /** Expanded canonical card without purchasing controls or dialogs. */
  preview?: boolean;
  previewSiteIssue?: string;
  previewComparison?: BuildPreviewComparison;
  game?: GameType;
  hydroAvailability?: ReturnType<typeof getHydroAvailability>;
  onDismissHydroPrimer?: () => void;
  onUseSiteMaximum?: (peakW: number) => void;
  onUseMaxSize?: (peakW: number) => void;
  cash: number;
  date: DateType;
  interestRate: number;
  generator: GeneratorShoppingType;
  minimumBuildCost?: number;
  location: LocationType;
  seed: number;
  secondaryMetric?: string;
  advantages?: string[];
  /** Typical-year output; computed from the generator alone when omitted (on-demand plants only) */
  outputShape?: ExpectedOutputShape;
  outputCeiling?: number;
  forecastPending?: boolean;
  territoryAvailability?: ReturnType<typeof territoryBuildAvailability>;
  territoryId?: TerritoryId;
  tileId?: TerritoryTileId;
  lockedTile?: boolean;
  compared?: boolean;
  compareDisabled?: boolean;
  onCompare?: () => void;
  // Optional build upgrades, and the quote with a selection of them. Both come from the hazard
  // model so the dialog's price is exactly the one the purchase will charge.
  resilienceOptions?: ResilienceBuildOptionType[];
  withResilience?: (
    selection: ResilienceSelectionType,
  ) => GeneratorShoppingType;
  onBuild: (
    financed: boolean,
    selection?: ResilienceSelectionType,
  ) => FacilityPurchaseSubmission;
  onBuilt?: () => void;
  onPickSite?: () => void;
}

export function GeneratorBuildItem(
  props: GeneratorBuildItemProps,
): React.JSX.Element {
  const { formatMoneyConcise, formatForecastMoney, formatPurchasePrice } =
    useMoney();
  const { generator, cash } = props;
  const units = useUnits();
  const fuelPrices = getFuelPricesPerMBTU(
    props.date,
    props.seed,
    props.location,
  );
  const [open, setOpen] = React.useState(false);
  const siteSummary = React.useRef<HTMLDivElement>(null);
  const resilienceOptions = props.resilienceOptions ?? [];
  const hasOptions = resilienceOptions.length > 0 && !!props.withResilience;
  const defaultSelection = (): ResilienceSelectionType =>
    Object.fromEntries(
      resilienceOptions.map((option) => [option.upgrade, option.selected]),
    );
  const [resilienceSelection, setResilienceSelection] =
    React.useState<ResilienceSelectionType>(defaultSelection);
  // A default hardening option is only a default: the card stays buyable whenever the plant
  // without it is affordable, and the dialog lets the player clear it
  const cheapestQuote =
    hasOptions && props.withResilience ? props.withResilience({}) : generator;
  const { downpayment } = purchaseTerms(
    cheapestQuote.buildCost,
    true,
    props.interestRate,
  );
  const affordable = useBuildAffordability(cash, downpayment);
  const minimumAffordable = useBuildAffordability(
    cash,
    purchaseTerms(props.minimumBuildCost ?? Infinity, true, props.interestRate)
      .downpayment,
  );
  const includedOptions = resilienceOptions.filter((option) => option.selected);
  const sizeBuildable = props.generator.peakW <= props.generator.maxPeakW;
  const maxSizeW = floorToTwoSignificantDigits(
    Math.min(
      generator.maxPeakW,
      props.territoryAvailability?.maxPeakW ?? Infinity,
    ),
  );
  const territorialSites = props.territoryAvailability
    ? {
        total: props.territoryAvailability.total,
        remaining: props.territoryAvailability.remaining,
      }
    : undefined;
  const pickingSite = !!props.onPickSite;
  const generalAvailability = getBuildAvailability({
    hydroAvailability: props.hydroAvailability,
    name: generator.name,
    description: generator.description,
    available: generator.available,
    sizeBuildable,
    maxSizeLabel: formatWatts(maxSizeW),
    location: props.location,
    viableLocationsRemaining: generator.viableLocationsRemaining,
    siteInventory: territorialSites,
  });
  const buildable = pickingSite
    ? sizeBuildable && maxSizeW > 0
    : generalAvailability.buildable &&
      (props.territoryAvailability?.buildable ?? true);
  const secondaryText = pickingSite
    ? maxSizeW <= 0
      ? "No suitable sites currently available."
      : `Maximum size per site: ${formatWatts(maxSizeW)}`
    : props.territoryAvailability && !props.territoryAvailability.buildable
      ? props.territoryAvailability.reason
      : generalAvailability.secondaryText;
  const tile = props.game?.multiplayer?.territorial
    ? multiplayerTerritoryTile(props.game, props.tileId)
    : getTerritoryTile(props.tileId, props.game);
  const offerMaxSize =
    (!tile || tileSupportsFacilityTechnology(tile, generator)) &&
    ((pickingSite && !sizeBuildable && maxSizeW > 0) ||
      generalAvailability.offerMaxSize ||
      (props.territoryAvailability &&
        generator.peakW > maxSizeW &&
        maxSizeW > 0));
  const sites =
    pickingSite || props.hydroAvailability
      ? undefined
      : (territorialSites ??
        getSiteInventory(
          generator.name,
          props.location,
          generator.viableLocationsRemaining,
        ));
  const shortfall =
    !pickingSite && !affordable ? (
      <BuildCashWarning cash={cash} downpayment={downpayment} />
    ) : undefined;
  const outputPending = generatorOutputPending(
    generator,
    !!props.forecastPending,
  );
  const canBuild = buildable && !shortfall && (pickingSite || !outputPending);
  const buildSubtitle = (buildable && shortfall) || secondaryText;
  const offerAffordableSize =
    !!shortfall &&
    (buildable ||
      offerMaxSize ||
      props.hydroAvailability?.status === "too-large") &&
    props.minimumBuildCost !== undefined &&
    minimumAffordable;
  const hasVariableOM = generator.variableOperatingCostPerMWh !== undefined;
  // kg of CO2 equivalent released per MWh generated - 0 for carbon-free sources,
  // whose fuel either isn't in FUELS at all (sun, wind) or is emission-free (uranium)
  const kgCO2ePerMWh = directEmissionsPerMWh(generator);
  const constructionKgco2eTotal =
    (generator.constructionKgco2ePerW || 0) * generator.peakW;
  const buildTileId = props.tileId ?? props.territoryAvailability?.tileId;
  const outputShape =
    props.outputShape ||
    expectedMonthlyOutputShape(
      generator,
      [],
      props.game ? { game: props.game, tileId: buildTileId } : undefined,
    );
  const waterShape =
    outputShape?.kind === "water-inflow" ? outputShape : undefined;
  const capacityFactor = typicalCapacityFactor(generator, outputShape);
  const typicalOutputW = generator.peakW * capacityFactor;
  // A short role tag stays on the card; how to use it waits for the details
  const [role, roleHint] =
    generator.fuel === "Hydro"
      ? [
          "Flexible water supply",
          "Rain and snow refill the reservoir; generation drains it.",
        ]
      : WEATHER_DEPENDENT_FUELS.includes(generator.fuel)
        ? ["Weather-dependent supply", "Pair with backup or storage."]
        : generator.gasCycle === "simple"
          ? ["Fast-start, costly per MWh", "Covers peaks and backup."]
          : generator.gasCycle === "combined"
            ? ["Efficient, slow to start", "Best run steadily for hours."]
            : generator.spinMinutes > 60
              ? ["Steady supply", "Best for demand that lasts for hours."]
              : ["Fast response", ""];
  const openReview = (e: React.SyntheticEvent) => {
    e.stopPropagation();
    if (props.onPickSite) {
      props.onPickSite();
      return;
    }
    setResilienceSelection(defaultSelection());
    setOpen(true);
  };

  // The dialog prices the quote with the player's hardening choice; the card keeps the default
  const quote =
    hasOptions && props.withResilience
      ? props.withResilience(resilienceSelection)
      : generator;
  const quoteAffordable = useBuildAffordability(
    cash,
    purchaseTerms(quote.buildCost, true, props.interestRate).downpayment,
  );
  const quoteCanBuild = buildable && quoteAffordable;
  const resilienceOptionId = React.useId();
  // Each line under an option says what it buys; a warning line says what it costs the player
  const optionDetails = (
    option: ResilienceBuildOptionType,
  ): { text: string; warning?: boolean }[] => {
    switch (option.upgrade) {
      case "solarTrackers":
        return [
          {
            text: "Follows the sun for about 20% more energy a year, mostly in the morning and evening.",
          },
          { text: "Stows in hail. Can't be added later." },
        ];
      default: {
        if (!props.withResilience) return [];
        const standardMinTempC =
          props.withResilience({}).resilience?.designMinTempC ??
          STANDARD_GAS_DESIGN_MIN_TEMP_C;
        const lines: { text: string; warning?: boolean }[] = [
          {
            text:
              generator.fuel !== "Natural Gas"
                ? "Permanently halves this plant’s output losses in the deep freeze."
                : coldPackageEffect(
                    props.withResilience({ [option.upgrade]: true }).resilience
                      ?.designMinTempC ?? standardMinTempC,
                    standardMinTempC,
                    units,
                  ),
          },
        ];
        if (option.defaultSelected) {
          lines.push({
            text: `Recommended here: winters often drop below ${formatDesignTemperature(standardMinTempC, units)}.`,
          });
        }
        return lines;
      }
    }
  };
  const anySelected = resilienceOptions.some(
    (option) => resilienceSelection[option.upgrade],
  );
  const affordabilityWarning =
    anySelected && !quoteCanBuild && canBuild
      ? resilienceOptions.length > 1
        ? "Uncheck options to afford the downpayment."
        : "Uncheck to afford the downpayment."
      : undefined;

  const compareAction = props.onCompare && canBuild && (
    // A toggle keeps its name and quiet weight; the check and pressed state carry the selection,
    // so Review stays the card's one emphasised action.
    <Button
      size="small"
      variant="text"
      startIcon={props.compared ? <CheckIcon fontSize="small" /> : undefined}
      aria-pressed={props.compared}
      aria-label={`Compare ${generator.name}`}
      disabled={props.compareDisabled && !props.compared}
      onClick={(event) => {
        event.stopPropagation();
        props.onCompare?.();
      }}
    >
      Compare
    </Button>
  );

  const siteMaximum =
    props.hydroAvailability?.selected || props.hydroAvailability?.largest;
  const useSiteMaximumAction = siteMaximum &&
    generator.peakW !== siteMaximum.maxPeakW &&
    props.onUseSiteMaximum && (
      <Button
        size="small"
        onClick={() => props.onUseSiteMaximum?.(siteMaximum.maxPeakW)}
      >
        Use site maximum
      </Button>
    );
  const useMaxSizeAction = (offerMaxSize || offerAffordableSize) &&
    (offerAffordableSize || generator.peakW !== maxSizeW) &&
    props.onUseMaxSize && (
      <Button
        size="small"
        aria-label={
          pickingSite ? `Use max size for ${generator.name}` : undefined
        }
        onClick={() => props.onUseMaxSize?.(maxSizeW)}
      >
        Use max size
      </Button>
    );
  // A resize shortcut sits under Review, so the context line moves up beside it
  const sizeAction = offerAffordableSize
    ? useMaxSizeAction
    : useSiteMaximumAction || useMaxSizeAction;
  const context = props.territoryAvailability ? (
    props.tileId ? (
      props.lockedTile ? (
        `${formatWatts(maxSizeW)} max`
      ) : (
        `One building slot · ${formatWatts(maxSizeW)} max per project`
      )
    ) : (
      `${props.territoryAvailability.remaining} local sites left · ${formatWatts(maxSizeW)} max per project`
    )
  ) : sites && sites.remaining > 0 ? (
    <>
      {!props.preview && `${role} · `}
      <span className="nowrap">{siteCountLabel(sites)}</span>
    </>
  ) : props.preview ? undefined : (
    role
  );
  const description = [roleHint, generator.description]
    .filter(Boolean)
    .join(" ");

  const iconSrc = `/images/${generator.name.toLowerCase()}.svg`;
  if (
    !props.preview &&
    tile &&
    !tileSupportsFacilityTechnology(tile, generator)
  ) {
    return (
      <BuildOptionCard
        name={generator.name}
        iconSrc={iconSrc}
        context="Not buildable on this tile"
      />
    );
  }
  // Nothing left to build: keep the card as a quiet one-line entry rather than a full pitch
  if (
    !props.preview &&
    (props.hydroAvailability?.remaining.length === 0 || sites?.remaining === 0)
  ) {
    return (
      <BuildOptionCard
        name={generator.name}
        iconSrc={iconSrc}
        review={{
          ariaLabel: `Review purchase of ${generator.name}`,
          disabled: true,
          onClick: () => undefined,
        }}
        context={
          props.hydroAvailability
            ? "No remaining buildable locations"
            : secondaryText
        }
      />
    );
  }

  const comparison = props.previewComparison?.markers;
  const metrics = (
    <>
      <BuildMetric
        asDetailRow={props.preview}
        label="Build cost"
        entry={MANUAL_ENTRY.TOTAL_COST_OF_ENERGY}
        value={formatPurchasePrice(generator.buildCost)}
        comparison={comparison?.buildCost}
        note={
          [
            pickingSite && "Before site costs",
            includedOptions.length
              ? `Incl. ${includedOptions.map((option) => option.label.toLowerCase()).join(", ")}`
              : undefined,
          ]
            .filter(Boolean)
            .join(" · ") || undefined
        }
      />
      <BuildMetric
        asDetailRow={props.preview}
        label="Build time"
        entry={MANUAL_ENTRY.HOW_TO_PLAY}
        value={formatBuildMonths(generator.yearsToBuild)}
        comparison={comparison?.buildTime}
      />
      {!props.preview && (
        <ExpectedOutputMetric
          shape={outputShape}
          ceiling={props.outputCeiling || 1}
        />
      )}
      {props.secondaryMetric === "lcWh" && (
        <BuildMetric
          asDetailRow={props.preview}
          label="Cost per MWh"
          entry={MANUAL_ENTRY.TOTAL_COST_OF_ENERGY}
          value={`${fuelPrices[generator.fuel] ? "~" : ""}${outputPending ? "Calculating…" : formatForecastMoney(generator.lcWh * 1000000)}`}
        />
      )}
    </>
  );

  const lifetimeCost = props.secondaryMetric !== "lcWh" && (
    <BuildDetailRow
      label="Lifetime cost"
      value={
        outputPending
          ? "Calculating…"
          : formatForecastMoney(generator.lcWh * 1000000) + "/MWh"
      }
      entry={MANUAL_ENTRY.TOTAL_COST_OF_ENERGY}
      comparison={comparison?.lifetimeCost}
    />
  );
  const expectedCapacity = (
    <BuildDetailRow
      label={
        waterShape
          ? "Capacity factor, this forecast"
          : "Expected capacity factor"
      }
      value={
        props.forecastPending && !outputShape
          ? "Calculating…"
          : percent(capacityFactor)
      }
      entry={MANUAL_ENTRY.CAPACITY_FACTOR}
      comparison={comparison?.capacityFactor}
    />
  );
  const directEmissions = (
    <BuildDetailRow
      label="Direct emissions"
      value={formatMass(kgCO2ePerMWh, units) + "/MWh"}
      entry={MANUAL_ENTRY.EMISSIONS}
      comparison={comparison?.directEmissions}
    />
  );

  return (
    <BuildOptionCard
      name={generator.name}
      iconSrc={iconSrc}
      compared={props.compared}
      preview={props.preview}
      comparisonCaption={props.previewComparison?.caption}
      previewSummary={
        props.preview && (
          <BuildDetails label="generator properties">
            {metrics}
            {lifetimeCost}
            {expectedCapacity}
            {directEmissions}
          </BuildDetails>
        )
      }
      review={
        props.preview
          ? undefined
          : {
              pickSite: pickingSite,
              ariaLabel: pickingSite
                ? `Pick site for ${generator.name}`
                : `Review purchase of ${generator.name}`,
              disabled: !canBuild,
              onClick: openReview,
            }
      }
      sizeAction={sizeAction}
      description={props.preview ? description : undefined}
      context={context}
      summary={
        <>
          {props.hydroAvailability && (
            <Box ref={siteSummary} tabIndex={-1} sx={{ px: 2, pb: 1 }}>
              <Typography variant="body2">
                <RemainingSites sites={props.hydroAvailability.remaining}>
                  {props.hydroAvailability.remaining.length === 1
                    ? "1 site left"
                    : `${props.hydroAvailability.remaining.length} sites left`}
                </RemainingSites>{" "}
                · {props.hydroAvailability.eligible.length}{" "}
                {props.hydroAvailability.eligible.length === 1 ? "fits" : "fit"}
                {props.hydroAvailability.largest &&
                  ` · largest: ${formatWatts(props.hydroAvailability.largest.maxPeakW, 6)}`}
              </Typography>
              {props.hydroAvailability.selected && (
                <Typography variant="body2">
                  Site: {props.hydroAvailability.selected.name} ·{" "}
                  {formatWatts(props.hydroAvailability.selected.maxPeakW, 6)}{" "}
                  max
                </Typography>
              )}
            </Box>
          )}
          {props.onDismissHydroPrimer && (
            <HydroPrimer
              onDismiss={() => {
                siteSummary.current?.focus();
                props.onDismissHydroPrimer?.();
              }}
            />
          )}
        </>
      }
      warning={
        props.previewSiteIssue ??
        (canBuild || (props.preview && buildSubtitle === generator.description)
          ? undefined
          : buildSubtitle)
      }
      metrics={props.preview ? undefined : metrics}
      footerActions={compareAction}
      details={
        <>
          {!props.preview && (
            <Typography
              className="buildOptionDescription"
              variant="body2"
              color="textSecondary"
            >
              {description}
            </Typography>
          )}
          {(props.advantages || []).length > 0 && (
            <Box sx={{ px: 2, pb: 1 }}>
              <Stack
                direction="row"
                spacing={0.75}
                useFlexGap
                sx={{ flexWrap: "wrap" }}
                role="group"
                aria-label="Generator advantages"
              >
                {(props.advantages || []).map((advantage) => (
                  <Chip key={advantage} size="small" label={advantage} />
                ))}
              </Stack>
            </Box>
          )}
          <BuildDetails
            label={
              props.preview
                ? "advanced generator properties"
                : "generator properties"
            }
          >
            {!props.preview && lifetimeCost}
            {!props.preview && expectedCapacity}
            {props.preview && (
              <BuildDetailRow
                label={
                  waterShape
                    ? "Typical monthly water inflow"
                    : "Typical monthly output"
                }
                value={
                  <ExpectedOutputMetric
                    shape={outputShape}
                    ceiling={props.outputCeiling || 1}
                  />
                }
              />
            )}
            {generator.minimumStableOutput !== undefined && (
              <BuildDetailRow
                label="Minimum output"
                value={
                  percent(generator.minimumStableOutput) +
                  " · " +
                  formatWatts(generator.peakW * generator.minimumStableOutput)
                }
                entry={MANUAL_ENTRY.RAMP_RATE}
              />
            )}
            <BuildDetailRow
              label={props.preview ? "Fixed operating cost" : "Fixed"}
              value={formatMoneyConcise(generator.annualOperatingCost) + "/yr"}
              entry={MANUAL_ENTRY.OPERATING_COSTS}
            />
            {hasVariableOM && (
              <BuildDetailRow
                label="Variable"
                value={
                  formatMoneyConcise(
                    generator.variableOperatingCostPerMWh || 0,
                  ) + "/MWh"
                }
                entry={MANUAL_ENTRY.OPERATING_COSTS}
              />
            )}
            {generator.costPerStart !== undefined && (
              <BuildDetailRow
                label="Non-fuel start cost"
                value={formatMoneyConcise(generator.costPerStart) + "/start"}
                entry={MANUAL_ENTRY.OPERATING_COSTS}
              />
            )}
            {(hasVariableOM || generator.costPerStart !== undefined) && (
              <BuildDetailRow
                label="Estimated annual upkeep"
                value={
                  formatForecastMoney(estimatedAnnualOperatingCost(generator)) +
                  "/yr"
                }
                entry={MANUAL_ENTRY.OPERATING_COSTS}
              />
            )}
            {fuelPrices[generator.fuel] && (
              <BuildDetailRow
                label="Fuel costs"
                value={
                  formatMoneyConcise(
                    generator.btuPerWh * (fuelPrices[generator.fuel] ?? 0),
                  ) + "/MWh"
                }
                entry={MANUAL_ENTRY.FUEL_COSTS}
              />
            )}
            {generator.spinMinutes > 1 && (
              <BuildDetailRow
                label="Ramp up/down time"
                value={generator.spinMinutes + " min"}
                entry={MANUAL_ENTRY.RAMP_RATE}
              />
            )}
            <BuildDetailRow
              label="Accounting lifetime"
              value={generator.lifespanYears + " years"}
              entry={MANUAL_ENTRY.ACCOUNTING_LIFETIME}
            />
            {sites && (
              <BuildDetailRow
                label="Sites left"
                value={`${sites.remaining} of ${sites.total}`}
                entry={MANUAL_ENTRY.PROJECT_SITES}
              />
            )}
            {!props.preview && directEmissions}
            <BuildDetailRow
              label="Construction emissions"
              value={`${formatLargeMassValueConcise(
                constructionKgco2eTotal,
                units,
              )} ${largeMassUnit(units)}`}
              entry={MANUAL_ENTRY.EMISSIONS}
            />
          </BuildDetails>
        </>
      }
    >
      <BuildPurchaseReviewDialog
        game={props.game}
        facility={quote}
        territoryId={props.territoryId}
        tileId={buildTileId}
        open={open}
        onClose={() => setOpen(false)}
        title={
          <>
            Build{" "}
            {formatWatts(generator.peakW, props.hydroAvailability ? 6 : 1)}{" "}
            {generator.name}?
          </>
        }
        cash={cash}
        buildCost={quote.buildCost}
        interestRate={props.interestRate}
        loanMonths={facilityLoanMonths(quote.lifespanYears)}
        cashDisabled={!buildable}
        loanDisabled={!buildable}
        cashLabel="Cash option"
        upkeepLabel="Maintenance"
        upkeepPerMonth={estimatedAnnualOperatingCost(quote) / 12}
        onlineInMonths={Math.round(generator.yearsToBuild * 12)}
        onPurchase={(financed) =>
          finishBuildReview(
            props.onBuild(
              financed,
              hasOptions ? resilienceSelection : undefined,
            ),
            () => {
              setOpen(false);
              props.onBuilt?.();
            },
          )
        }
        preface={
          <>
            {props.territoryId && !props.lockedTile && (
              <Typography variant="body2" sx={{ px: 2, mb: 2 }}>
                Build in {territoryName(props.territoryId)}
                {buildTileId
                  ? ` · ${territoryBuildTileName(buildTileId, props.game, generator)}`
                  : ""}
                . Output serves your company power pool.
              </Typography>
            )}
            {props.hydroAvailability?.selected && (
              <Typography variant="body2" sx={{ px: 2, mb: 2 }}>
                {props.hydroAvailability.selected.name} ·{" "}
                {formatWatts(props.hydroAvailability.selected.maxPeakW, 6)} max.
                Uses the whole site. Only canceling before completion frees it.
              </Typography>
            )}
            {hasOptions &&
              resilienceOptions.map((option, index) => {
                const describedBy = `${resilienceOptionId}-${option.upgrade}`;
                const lines = optionDetails(option);
                if (
                  affordabilityWarning &&
                  index === resilienceOptions.length - 1
                )
                  lines.push({ text: affordabilityWarning, warning: true });
                return (
                  <Box className="resilienceBuildOption" key={option.upgrade}>
                    <FormControlLabel
                      control={
                        <Checkbox
                          checked={!!resilienceSelection[option.upgrade]}
                          onChange={(event) =>
                            setResilienceSelection((selection) => ({
                              ...selection,
                              [option.upgrade]: event.target.checked,
                            }))
                          }
                          slotProps={{
                            input: { "aria-describedby": describedBy },
                          }}
                        />
                      }
                      label={`${option.label} +${formatPurchasePrice(option.extraBuildCost)}`}
                    />
                    <Box id={describedBy}>
                      {lines.map((line) => (
                        <Typography
                          key={line.text}
                          variant="body2"
                          color={line.warning ? undefined : "textSecondary"}
                          className={
                            line.warning
                              ? "resilienceBuildOptionDetail resilienceBuildOptionWarning"
                              : "resilienceBuildOptionDetail"
                          }
                        >
                          {line.text}
                        </Typography>
                      ))}
                    </Box>
                  </Box>
                );
              })}
          </>
        }
        extraFacts={[
          {
            concept: "supply",
            label: "Average output over a year",
            // The selected quote's trackers add their morning and evening energy
            value: `+${formatWatts(
              typicalOutputW *
                (quote.resilience?.solarTrackers
                  ? TRACKER_ANNUAL_ENERGY_MULTIPLIER
                  : 1),
            )}`,
            ...(waterShape && {
              detail: `${formatWatts(generator.peakW)} max; water limits it, lowest in ${MONTH_NAMES[waterShape.lowMonth]}.`,
            }),
          },
          ...(sites && !props.lockedTile
            ? [
                {
                  concept: "build" as const,
                  label: "Project site",
                  value:
                    sites.remaining === 1
                      ? "Uses your last site"
                      : `Leaves ${sites.remaining - 1} of ${sites.total}`,
                  detail: "Each project takes one site, whatever its size.",
                },
              ]
            : []),
          {
            concept: kgCO2ePerMWh > 0 ? "danger" : "goal",
            label: "Direct emissions",
            value:
              kgCO2ePerMWh > 0
                ? `${formatMass(kgCO2ePerMWh, units)}/MWh`
                : "None",
          },
        ]}
      />
    </BuildOptionCard>
  );
}

function GeneratorComparison(props: {
  forecastPending?: boolean;
  generators: GeneratorShoppingType[];
  comparedNames: string[];
  outputShapes: Map<string, ExpectedOutputShape | undefined>;
  onClear: () => void;
  onRemove: (name: string) => void;
}): React.JSX.Element | null {
  const { formatForecastMoney, formatPurchasePrice } = useMoney();
  const scale = React.useSyncExternalStore(
    subscribeInterfaceScale,
    getInterfaceScale,
  );
  const wideEnoughToWrap = useMediaQuery("(min-width: 600px)");
  const orientation = scale > 1 && wideEnoughToWrap ? "vertical" : "horizontal";
  if (props.generators.length === 0) {
    return null;
  }
  return (
    <section className="generatorComparison" aria-label="Generator comparison">
      <div className="generatorComparisonHeader">
        <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>
          Comparing {props.generators.length}/3
        </Typography>
        <Button size="small" onClick={props.onClear}>
          Clear
        </Button>
      </div>
      <TransitionGroup
        component="div"
        className="generatorComparisonChoices"
        childFactory={(
          child: React.ReactElement<
            React.ComponentProps<typeof RemovalCollapse>
          >,
        ) =>
          React.cloneElement(child, {
            animate: !props.comparedNames.some(
              (name) =>
                `comparison-${encodeURIComponent(name)}` === child.props.id,
            ),
          })
        }
      >
        {props.generators.map((generator) => (
          <RemovalCollapse
            key={generator.name}
            id={`comparison-${encodeURIComponent(generator.name)}`}
            orientation={orientation}
          >
            <div className="generatorComparisonChoice">
              <img
                src={`/images/${generator.name.toLowerCase()}.svg`}
                alt=""
                aria-hidden
              />
              <Typography variant="body2" sx={{ fontWeight: 800 }}>
                {generator.name}
              </Typography>
              <IconButton
                className="generatorComparisonRemove"
                size="small"
                aria-label={`Remove ${generator.name} from comparison`}
                onClick={() => props.onRemove(generator.name)}
              >
                <CloseIcon fontSize="small" />
              </IconButton>
              {/* A separator stays with the figure before it, so a narrow chip never starts a
              line with "·" */}
              <Typography variant="caption">
                <span className="nowrap">
                  {formatPurchasePrice(generator.buildCost)} ·
                </span>{" "}
                <span className="nowrap">
                  {formatBuildMonths(generator.yearsToBuild)}
                </span>
              </Typography>
              <Typography variant="caption" color="textSecondary">
                {props.forecastPending &&
                !props.outputShapes.get(generator.name) ? (
                  "Calculating output and energy costs…"
                ) : (
                  <>
                    {formatWatts(
                      generator.peakW *
                        typicalCapacityFactor(
                          generator,
                          props.outputShapes.get(generator.name),
                        ),
                    )}{" "}
                    typical{"\u00a0·"}{" "}
                    <span className="nowrap">
                      {formatForecastMoney(generator.lcWh * 1000000)}/MWh
                    </span>
                  </>
                )}
              </Typography>
            </div>
          </RemovalCollapse>
        ))}
      </TransitionGroup>
    </section>
  );
}

type GeneratorSortKey = "buildCost" | "yearsToBuild" | "lcWh" | "emissions";

const sortOptions: ReadonlyArray<readonly [GeneratorSortKey, string]> = [
  ["buildCost", "Build cost"],
  ["yearsToBuild", "Build time"],
  ["lcWh", "Cost per MWh"],
  ["emissions", "Emissions"],
];

function valueLabelFormat(x: number) {
  return formatWatts(sliderTickToW(x));
}

export interface StateProps {
  evidenceRequest?: import("../../Types").EvidenceRequestType;
  facilityDragActive?: boolean;
  game: GameType;
  focusFuel?: FuelNameType;
}

export interface DispatchProps {
  onEvidenceReady?: (
    request: import("../../Types").EvidenceRequestType,
    element: HTMLElement | null,
  ) => void;
  onBuildGenerator: (
    generator: GeneratorShoppingType,
    financed: boolean,
    territoryId?: TerritoryId,
    tileId?: TerritoryTileId,
  ) => FacilityPurchaseSubmission;
  onBack: () => void;
  onSizeChange?: () => void;
}

export type Props = StateProps &
  DispatchProps & {
    lockedTileId?: TerritoryTileId;
    railSelection?: GeneratorShoppingType;
    onPickSite?: (facility: GeneratorShoppingType) => void;
  };

function BuildGenerators(props: Props): React.JSX.Element {
  const completeBuild = React.useContext(GameBuildCompleteContext);
  const workspace = useGameWorkspaceLayout();
  const comparisonInList =
    !!props.onPickSite ||
    workspace?.constrained ||
    workspace?.fleetVisible === false;
  const { evidenceRequest, facilityDragActive, onEvidenceReady } = props;
  const evidenceAnchor = React.useRef<HTMLDivElement>(null);
  const { game, onBack } = props;
  const [rememberedTerritoryId, setTerritoryId] =
    useTerritoryBuildDestination();
  const [rememberedTileId, setTileId] = useTerritoryBuildTile();
  const territorial = !!game.multiplayer?.territorial;
  const tileId =
    props.lockedTileId ?? (territorial ? undefined : rememberedTileId);
  const territoryId =
    (props.lockedTileId
      ? getTerritoryTile(props.lockedTileId, game)?.territoryId
      : undefined) ?? rememberedTerritoryId;
  const { onPickSite } = props;
  const territoryNetwork = hasTerritoryNetwork(game) && !onPickSite;
  const memoryKey = onPickSite ? "project.generators" : "generators";
  const specialSite = territoryNetwork
    ? getTerritoryDefinition(territoryId)?.benefit
    : undefined;
  const legacyBounds = getLegacyBuildBounds(game);
  const minTick = legacyBounds ? wToSliderTick(legacyBounds.minW) : 0;
  const maxTick = legacyBounds ? wToSliderTick(legacyBounds.maxW) : 34;
  const clampSizeTick = (tick: number) =>
    Math.max(minTick, Math.min(maxTick, tick));
  const now = getTimeFromTimeline(game.date.minute, game.timeline);
  const readCash = useBuildCashReader(now?.cash ?? 0);
  const listRef = useToolScroll<HTMLUListElement>(`${memoryKey}.scroll`);
  const revealResizedRow = useBuildRowReveal(listRef);
  const [sliderTick, setSliderTick] = useToolState<number>(
    `${memoryKey}.size`,
    () =>
      onPickSite
        ? 10
        : clampSizeTick(
            wToSliderTick(
              legacyBounds && game.date.year >= 1942
                ? legacyBounds.defaultW
                : game.facilities.length
                  ? averageBuildSize(game.facilities, false)
                  : (legacyBounds?.defaultW ??
                    averageBuildSize(game.facilities, false)),
            ),
          ),
  );
  // A generation change can keep this tool's saved choice outside the next era's range.
  const shownSliderTick = clampSizeTick(sliderTick);
  // Sizes between slider ticks, chosen per generator: hydro's site maximum or a technology's cap
  const [exactSizes, setExactSizes] = useToolState<Record<string, number>>(
    `${memoryKey}.exactSizes`,
    {},
  );
  const railSelection = props.railSelection;
  React.useLayoutEffect(() => {
    if (!railSelection) return;
    const { name, peakW } = railSelection;
    setSliderTick(wToSliderTick(peakW));
    setExactSizes((sizes) => ({ ...sizes, [name]: peakW }));
    revealResizedRow(name);
  }, [railSelection, revealResizedRow, setExactSizes, setSliderTick]);
  // A remembered site/technology shortcut can outlive the era's minimum project size.
  // Hydro may exceed the global slider maximum because its physical site owns that limit.
  const shownExactSizes = legacyBounds
    ? Object.fromEntries(
        Object.entries(exactSizes).filter(
          ([name, size]) =>
            Number.isFinite(size) &&
            size >= legacyBounds.minW &&
            (name === "Hydro" || size <= legacyBounds.maxW),
        ),
      )
    : exactSizes;
  const [sort, setSort] = useToolState<GeneratorSortKey>(
    `${memoryKey}.sort`,
    "buildCost",
  );
  const [comparedNames, setComparedNames] = useToolState<string[]>(
    `${memoryKey}.compared`,
    [],
  );
  const [primerVisible, dismissPrimer] = useHydroPrimer();
  // The workspace warms this before opening Build; an immediate listing never waits for it.
  const forecast = useBuildForecast(game);
  const hasNow = Boolean(now);
  React.useEffect(() => {
    const request = evidenceRequest;
    if (
      hasNow &&
      request &&
      typeof request.target === "object" &&
      request.target.card === "FACILITIES" &&
      request.target.view === "BUILD_GENERATORS" &&
      !facilityDragActive
    ) {
      onEvidenceReady?.(request, evidenceAnchor.current);
    }
  }, [hasNow, evidenceRequest, facilityDragActive, onEvidenceReady]);

  const cash = now?.cash ?? 0;
  const {
    timeline: forecastedTimeline,
    windSpeeds,
    offshoreWindSpeeds,
    airborneWindSpeeds,
    solarIrradiances,
  } = forecast ?? EMPTY_FORECAST;
  const hydroSize = shownExactSizes.Hydro ?? sliderTickToW(shownSliderTick);
  const hydroAvailability = territorial
    ? multiplayerHydroAvailability(game, hydroSize, tileId)
    : getHydroAvailability(
        game,
        hydroSize,
        territoryNetwork ? territoryId : undefined,
        territoryNetwork ? tileId : undefined,
      );
  const hydroSiteMaximum =
    hydroAvailability.selected ?? hydroAvailability.largest;
  const canUseSiteMaximum =
    !legacyBounds ||
    !hydroSiteMaximum ||
    hydroSiteMaximum.maxPeakW >= legacyBounds.minW;
  const quoteGenerators = (capacity: number) =>
    GENERATORS(
      game,
      capacity,
      windSpeeds,
      solarIrradiances,
      offshoreWindSpeeds,
      airborneWindSpeeds,
      territoryNetwork ? territoryId : undefined,
      territoryNetwork || territorial ? tileId : undefined,
    );
  const minimumGenerators = quoteGenerators(sliderTickToW(minTick));
  const sizedGenerators = quoteGenerators(sliderTickToW(shownSliderTick))
    .map((generator) =>
      shownExactSizes[generator.name] !== undefined
        ? quoteGenerators(shownExactSizes[generator.name]).find(
            (candidate) => candidate.name === generator.name,
          ) || generator
        : generator,
    )
    .filter((generator) =>
      !tileId && specialSite === "hydro"
        ? generator.name === "Hydro"
        : !tileId && specialSite === "geothermal"
          ? generator.fuel === "Geothermal"
          : true,
    )
    .filter(
      (generator) =>
        getTutorialStep(game)?.phase !== "GENERATOR_CHOICES" ||
        ["Natural Gas", "Sun", "Wind"].includes(generator.fuel),
    );
  const shownGenerators = onPickSite
    ? withTerritoryCatalogueLimits(game, sizedGenerators)
    : sizedGenerators;
  const territoryAvailabilityByName = new Map(
    shownGenerators.map((generator) => [
      generator.name,
      territorial
        ? multiplayerBuildAvailability(game, generator, tileId)
        : territoryNetwork
          ? territoryBuildAvailability(game, generator, territoryId, tileId)
          : undefined,
    ]),
  );
  const affordability = useBuildAffordabilityKey(
    cash,
    shownGenerators.map(
      (generator) =>
        purchaseTerms(
          withResilienceOptions(generator, game, {}).buildCost,
          true,
          game.interestRate,
        ).downpayment,
    ),
  );
  // Forecast readiness gates review buttons. Keep the affordable options in place
  // when the background forecast arrives while the player is scrolling.
  const affordableBuildByName = new Map(
    shownGenerators.map((generator, index) => {
      const territoryAvailability = territoryAvailabilityByName.get(
        generator.name,
      );
      const availability = getBuildAvailability({
        name: generator.name,
        description: generator.description,
        available: generator.available,
        sizeBuildable: generator.peakW <= generator.maxPeakW,
        maxSizeLabel: undefined,
        location: game.location,
        viableLocationsRemaining: generator.viableLocationsRemaining,
        siteInventory: territoryAvailability,
        hydroAvailability:
          generator.name === "Hydro" ? hydroAvailability : undefined,
      });
      return [
        generator.name,
        onPickSite
          ? generator.peakW <= generator.maxPeakW
          : availability.buildable &&
            (territoryAvailability?.buildable ?? true) &&
            affordability[index] === "1",
      ];
    }),
  );
  const sortValue = (generator: GeneratorShoppingType) =>
    sort === "emissions"
      ? generator.btuPerWh * (FUELS[generator.fuel]?.kgCO2ePerBtu ?? 0)
      : generator[sort];
  const generators = shownGenerators.sort((a, b) => {
    return (
      Number(affordableBuildByName.get(b.name)) -
        Number(affordableBuildByName.get(a.name)) || sortValue(a) - sortValue(b)
    );
  });
  const outputShapes = new Map(
    generators.map((generator) => [
      generator.name,
      expectedMonthlyOutputShape(
        generator,
        forecastedTimeline,
        territoryNetwork || territorial
          ? {
              game,
              tileId:
                tileId ??
                territoryAvailabilityByName.get(generator.name)?.tileId,
            }
          : undefined,
      ),
    ]),
  );
  const outputCeiling = sharedOutputCeiling(Array.from(outputShapes.values()));
  const buildableGenerators = generators.filter(
    (generator) =>
      (onPickSite || generator.available) &&
      generator.peakW <= generator.maxPeakW &&
      (territoryAvailabilityByName.get(generator.name)?.buildable ?? true),
  );
  const lowestBuildCost = Math.min(
    ...buildableGenerators.map((generator) => generator.buildCost),
  );
  const fastestBuild = Math.min(
    ...buildableGenerators.map((generator) => generator.yearsToBuild),
  );
  const lowestEnergyCost = Math.min(
    ...buildableGenerators.map((generator) => generator.lcWh),
  );
  const selectedTile = territorial
    ? multiplayerTerritoryTile(game, tileId)
    : territoryNetwork
      ? getTerritoryTile(tileId, game)
      : undefined;
  const comparableGenerators = selectedTile
    ? generators.filter((generator) =>
        tileSupportsFacilityTechnology(selectedTile, generator),
      )
    : generators;
  const comparedGenerators = comparableGenerators.filter((generator) =>
    comparedNames.includes(generator.name),
  );

  // Tutorials script their own path through this list, so the primer waits for a real game
  const hydro = generators.find((generator) => generator.name === "Hydro");
  const hydroSites = {
    total: hydroAvailability.remaining.length,
    remaining: hydroAvailability.remaining.length,
  };
  const showPrimer =
    !onPickSite &&
    primerVisible &&
    !!hydro?.available &&
    !!hydroSites &&
    hydroSites.remaining > 0 &&
    !getScenario(game.scenarioId, game.customScenario)?.tutorialSteps;

  const toggleCompare = (name: string) => {
    setComparedNames((current) => {
      if (current.includes(name))
        return current.filter((candidate) => candidate !== name);
      const visible = current.filter((candidate) =>
        comparableGenerators.some((generator) => generator.name === candidate),
      );
      return visible.length < 3 ? [...visible, name] : current;
    });
  };

  const focusComparisonOption = (name: string) => {
    Array.from(listRef.current?.querySelectorAll("button") ?? [])
      .find((button) => button.getAttribute("aria-label") === `Compare ${name}`)
      ?.focus({ preventScroll: true });
  };
  const animateComparison = (
    child: React.ReactElement<React.ComponentProps<typeof RemovalCollapse>>,
  ) => React.cloneElement(child, { animate: comparedNames.length === 0 });
  const comparison = comparedGenerators.length > 0 && (
    <RemovalCollapse
      key="comparison"
      component={comparisonInList ? "li" : "div"}
      className={
        comparisonInList ? "buildComparisonItem" : "generatorComparisonSlot"
      }
    >
      <GeneratorComparison
        generators={comparedGenerators}
        comparedNames={comparedNames}
        outputShapes={outputShapes}
        forecastPending={!forecast}
        onClear={() => {
          focusComparisonOption(comparedGenerators[0].name);
          setComparedNames([]);
        }}
        onRemove={(name) => {
          focusComparisonOption(name);
          toggleCompare(name);
        }}
      />
    </RemovalCollapse>
  );

  if (!now) return <span />;

  return (
    <div
      className="flexContainer screenCatalog"
      ref={evidenceAnchor}
      tabIndex={-1}
      aria-label="Generator build options"
    >
      {props.focusFuel &&
        !buildableGenerators.some(
          (generator) => generator.fuel === props.focusFuel,
        ) && (
          <Typography role="status" sx={{ px: 2, py: 1 }}>
            No generator matches this fuel and size. Showing other options.
          </Typography>
        )}
      {territoryNetwork && !props.lockedTileId && (
        <TerritoryBuildDestination
          game={game}
          value={territoryId}
          onChange={setTerritoryId}
          tileId={tileId}
          onTileChange={setTileId}
        />
      )}
      <ConstructionBuildHeader
        capacity={valueLabelFormat(shownSliderTick)}
        capacityLabel={onPickSite ? "Generator capacity" : undefined}
        sliderValue={shownSliderTick}
        sliderValueText={valueLabelFormat}
        sliderMin={minTick}
        sliderMax={maxTick}
        sort={sort}
        sortOptions={sortOptions}
        onSliderChange={(value) => {
          setSliderTick(value);
          setExactSizes({});
          if (value !== sliderTick) props.onSizeChange?.();
        }}
        onSortChange={(value) => setSort(value as GeneratorSortKey)}
      />
      {!forecast && (
        <Typography role="status" variant="caption" sx={{ px: 2, py: 1 }}>
          Calculating output and energy costs…
        </Typography>
      )}
      {!comparisonInList && (
        <TransitionGroup component={null} childFactory={animateComparison}>
          {comparison}
        </TransitionGroup>
      )}
      <List
        ref={listRef}
        dense
        className="scrollable cardList"
        aria-label="Generator options"
      >
        {comparisonInList && (
          <TransitionGroup component={null} childFactory={animateComparison}>
            {comparison}
          </TransitionGroup>
        )}
        {generators.map((g: GeneratorShoppingType) => {
          const advantages = [
            g.buildCost === lowestBuildCost ? "Lowest upfront cost" : undefined,
            g.yearsToBuild === fastestBuild ? "Fastest online" : undefined,
            forecast && g.lcWh === lowestEnergyCost
              ? "Lowest lifetime cost"
              : undefined,
            g.btuPerWh === 0 ? "No direct emissions" : undefined,
          ].filter((value): value is string => Boolean(value));
          const compared = comparedNames.includes(g.name);
          return (
            <React.Fragment key={g.name}>
              <GeneratorBuildItem
                lockedTile={!!props.lockedTileId}
                game={game}
                onDismissHydroPrimer={
                  showPrimer && g.name === "Hydro" ? dismissPrimer : undefined
                }
                hydroAvailability={
                  !onPickSite && g.name === "Hydro"
                    ? hydroAvailability
                    : undefined
                }
                onUseSiteMaximum={
                  canUseSiteMaximum
                    ? (peakW) => {
                        revealResizedRow(g.name);
                        setSliderTick(clampSizeTick(wToSliderTick(peakW)));
                        setExactSizes((sizes) => ({ ...sizes, Hydro: peakW }));
                      }
                    : undefined
                }
                onPickSite={onPickSite && (() => onPickSite(g))}
                onUseMaxSize={
                  legacyBounds && g.maxPeakW < legacyBounds.minW
                    ? undefined
                    : (peakW) => {
                        const limit =
                          g.name === "Hydro" && !onPickSite
                            ? Math.min(
                                peakW,
                                hydroAvailability.largest?.maxPeakW ?? peakW,
                              )
                            : peakW;
                        const size =
                          (onPickSite
                            ? undefined
                            : largestAffordableBuildSize(
                                buildSizeOptions(minTick, maxTick, limit),
                                readCash(),
                                (capacity) => {
                                  const candidate = quoteGenerators(
                                    capacity,
                                  ).find((item) => item.name === g.name)!;
                                  return withResilienceOptions(
                                    candidate,
                                    game,
                                    {},
                                  ).buildCost;
                                },
                              )) ?? limit;
                        revealResizedRow(g.name);
                        setSliderTick(clampSizeTick(wToSliderTick(size)));
                        setExactSizes((sizes) => ({
                          ...sizes,
                          [g.name]: size,
                        }));
                      }
                }
                date={game.date}
                seed={game.seed}
                location={game.location}
                interestRate={game.interestRate}
                generator={g}
                territoryId={territoryNetwork ? territoryId : undefined}
                tileId={territoryNetwork || territorial ? tileId : undefined}
                territoryAvailability={territoryAvailabilityByName.get(g.name)}
                minimumBuildCost={
                  withResilienceOptions(
                    minimumGenerators.find((item) => item.name === g.name)!,
                    game,
                    {},
                  ).buildCost
                }
                cash={cash}
                secondaryMetric={sort === "buildCost" ? "yearsToBuild" : sort}
                advantages={advantages.slice(0, 2)}
                outputShape={outputShapes.get(g.name)}
                outputCeiling={outputCeiling}
                forecastPending={!forecast}
                compared={compared}
                compareDisabled={comparedGenerators.length >= 3}
                onCompare={() => toggleCompare(g.name)}
                resilienceOptions={resilienceBuildOptions(g, game)}
                withResilience={(selection) =>
                  withResilienceOptions(g, game, selection)
                }
                onBuild={(financed, selection) => {
                  const selected =
                    selection === undefined
                      ? g
                      : withResilienceOptions(g, game, selection);
                  if (territoryNetwork)
                    return props.onBuildGenerator(
                      selected,
                      financed,
                      territoryId,
                      tileId ?? territoryAvailabilityByName.get(g.name)?.tileId,
                    );
                  if (territorial)
                    return props.onBuildGenerator(
                      selected,
                      financed,
                      undefined,
                      tileId ?? territoryAvailabilityByName.get(g.name)?.tileId,
                    );
                  return props.onBuildGenerator(selected, financed);
                }}
                onBuilt={completeBuild ?? onBack}
              />
            </React.Fragment>
          );
        })}
      </List>
    </div>
  );
}

export default React.memo(BuildGenerators, sameBuildQuote);
