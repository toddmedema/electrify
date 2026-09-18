import * as React from "react";
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
  DialogTitle,
  IconButton,
  List,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableRow,
  Typography,
  useMediaQuery,
} from "@mui/material";
import ArrowDropDownIcon from "@mui/icons-material/ArrowDropDown";
import ArrowDropUpIcon from "@mui/icons-material/ArrowDropUp";
import CloseIcon from "@mui/icons-material/Close";
import { getTimeFromTimeline } from "../../helpers/DateTime";
import {
  estimatedAnnualOperatingCost,
  estimatedAnnualVariableOperatingCost,
  getMonthlyPayment,
} from "../../helpers/Financials";
import { formatMoneyConcise, formatWatts } from "../../helpers/Format";
import { getFuelPricesPerMBTU } from "../../data/FuelPrices";
import {
  DOWNPAYMENT_PERCENT,
  FUELS,
  LOAN_MONTHS,
  MONTHS,
  TICKS_PER_YEAR,
} from "../../Constants";
import { GENERATORS } from "../../data/Facilities";
import {
  DateType,
  GameType,
  GeneratorShoppingType,
  FuelNameType,
  LocationType,
} from "../../Types";
import { generateNewTimeline } from "../../reducers/Game";
import {
  expectedMonthlyOutputShape,
  ExpectedOutputShape,
} from "../../helpers/ExpectedOutput";
import { MANUAL_ENTRY, ManualEntryTitleType } from "../../data/Manual";
import { formatMass } from "../../helpers/Units";
import ManualLink from "../base/ManualLink";
import { useUnits } from "../base/UnitsContext";
import ConceptIcon from "../base/ConceptIcon";
import DecisionImpactPreview from "../base/DecisionImpactPreview";
import {
  getBuildAvailability,
  getSiteInventory,
  shortPlaceName,
  siteCountLabel,
} from "../base/BuildAvailability";
import HydroPrimer, { useHydroPrimer } from "../base/HydroPrimer";
import { getScenario } from "../../data/Scenarios";
import BuildMetric from "../base/BuildMetric";
import ConstructionBuildHeader from "../base/ConstructionBuildHeader";
import Sparkline from "../base/Sparkline";

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

function percent(fraction: number): string {
  return `${Math.round(fraction * 100)}%`;
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

function ExpectedOutputMetric(props: {
  shape?: ExpectedOutputShape;
  ceiling: number;
}): React.JSX.Element {
  const { shape, ceiling } = props;
  let caption = "";
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
    caption = `Low ${MONTHS[shape.lowMonth]} ${percent(low)}${water ? " water in" : ""}`;
    chart = (
      <Sparkline
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
      <Typography variant="caption" color="textSecondary" component="div">
        {caption}
      </Typography>
      <div className="buildOptionSparkline">{chart}</div>
    </div>
  );
}

function GeneratorDetailRow(props: {
  label: string;
  value: React.ReactNode;
  entry: ManualEntryTitleType;
}): React.JSX.Element {
  return (
    <TableRow>
      <TableCell component="th" scope="row" className="generatorDetailLabel">
        {props.label}
      </TableCell>
      <TableCell align="right" className="generatorDetailValue">
        {props.value}
      </TableCell>
      <TableCell className="generatorDetailHelp">
        <ManualLink entry={props.entry} label={props.label.toLowerCase()} />
      </TableCell>
    </TableRow>
  );
}

interface GeneratorBuildItemProps {
  cash: number;
  date: DateType;
  interestRate: number;
  generator: GeneratorShoppingType;
  location: LocationType;
  seed: number;
  secondaryMetric?: string;
  forecastGapW?: number;
  advantages?: string[];
  /** Typical-year output; computed from the generator alone when omitted (on-demand plants only) */
  outputShape?: ExpectedOutputShape;
  outputCeiling?: number;
  compared?: boolean;
  compareDisabled?: boolean;
  onCompare?: () => void;
  onBuild: (financed: boolean) => void;
}

export function GeneratorBuildItem(
  props: GeneratorBuildItemProps,
): React.JSX.Element {
  const { generator, cash } = props;
  const units = useUnits();
  const wideLayout = useMediaQuery("(min-width:600px)");
  const fuel = FUELS[generator.fuel] || {};
  const fuelPrices = getFuelPricesPerMBTU(
    props.date,
    props.seed,
    props.location,
  );
  const [expanded, setExpanded] = React.useState(false);
  const [open, setOpen] = React.useState(false);
  const [financingExpanded, setFinancingExpanded] = React.useState(false);
  const financingTermsId = React.useId();
  const purchaseSubmitted = React.useRef(false);
  const downpayment = DOWNPAYMENT_PERCENT * props.generator.buildCost;
  const loanAmount = props.generator.buildCost - downpayment;
  const monthlyPayment = getMonthlyPayment(
    loanAmount,
    props.interestRate,
    LOAN_MONTHS,
  );
  const sizeBuildable = props.generator.peakW <= props.generator.maxPeakW;
  const { buildable, secondaryText } = getBuildAvailability({
    name: generator.name,
    description: generator.description,
    available: generator.available,
    sizeBuildable,
    maxSizeLabel: formatWatts(generator.maxPeakW),
    location: props.location,
    viableLocationsRemaining: generator.viableLocationsRemaining,
  });
  const sites = getSiteInventory(
    generator.name,
    props.location,
    generator.viableLocationsRemaining,
  );
  const financingGap = Math.max(0, downpayment - cash);
  const canBuild = buildable && financingGap === 0;
  const buildSubtitle =
    buildable && financingGap > 0
      ? `Can't afford the loan down payment. Need ${formatMoneyConcise(financingGap)} more cash.`
      : secondaryText;
  const hasVariableOM = generator.variableOperatingCostPerMWh !== undefined;
  const estimatedVariableOM = estimatedAnnualVariableOperatingCost(generator);
  // kg of CO2 equivalent released per MWh generated - 0 for carbon-free sources,
  // whose fuel either isn't in FUELS at all (sun, wind) or is emission-free (uranium)
  const kgCO2ePerMWh = Math.round(
    1000000 * generator.btuPerWh * (fuel.kgCO2ePerBtu || 0),
  );
  const typicalOutputW = generator.peakW * generator.capacityFactor;
  const outputShape =
    props.outputShape || expectedMonthlyOutputShape(generator, []);
  const waterShape =
    outputShape?.kind === "water-inflow" ? outputShape : undefined;
  // A short role tag stays on the card; how to use it waits for the details
  const [role, roleHint] =
    generator.fuel === "Hydro"
      ? [
          "Flexible water supply",
          "Rain and snow refill the reservoir; generation drains it.",
        ]
      : ["Sun", "Wind", "Offshore Wind", "Airborne Wind"].includes(
            generator.fuel,
          )
        ? ["Weather-dependent supply", "Pair with backup or storage."]
        : generator.spinMinutes > 60
          ? ["Steady supply", "Best for demand that lasts for hours."]
          : ["Fast response", "Can follow changing demand."];
  const toggleExpand = () => {
    setExpanded(!expanded);
  };

  const toggleOpen = (e: React.SyntheticEvent) => {
    if (!open) {
      purchaseSubmitted.current = false;
      setFinancingExpanded(false);
    }
    setOpen(!open);
    e.stopPropagation();
  };

  const submitPurchase = (
    financed: boolean,
    e: React.MouseEvent<HTMLElement>,
  ) => {
    // A double-click dispatches two click events before the closing dialog has necessarily
    // unmounted. The ref closes that tiny window synchronously.
    if (purchaseSubmitted.current) {
      return;
    }
    purchaseSubmitted.current = true;
    props.onBuild(financed);
    toggleOpen(e);
  };

  const compareAction = props.onCompare && canBuild && (
    <Button
      size="small"
      variant={props.compared ? "contained" : "text"}
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

  return (
    <Card
      className={`build-list-item buildOption${props.compared ? " compared" : ""}`}
    >
      <CardHeader
        avatar={
          <Avatar
            alt={generator.name}
            src={`/images/${generator.name.toLowerCase()}.svg`}
          />
        }
        action={
          <Stack direction="row" spacing={0.5}>
            {wideLayout && compareAction}
            <Button
              className="buy-button"
              size="small"
              variant="outlined"
              color="primary"
              onClick={toggleOpen}
              disabled={!canBuild}
              startIcon={<ConceptIcon concept="buy" fontSize="small" />}
              aria-label={`Review purchase of ${generator.name}`}
            >
              Review
            </Button>
          </Stack>
        }
        title={generator.name}
      />
      <Typography className="buildOptionContext" variant="body2">
        {role}
        {sites && sites.remaining > 0 && ` · ${siteCountLabel(sites)}`}
      </Typography>
      {!canBuild && (
        <Typography
          component="div"
          className="buildOptionWarning"
          color="textSecondary"
        >
          {buildSubtitle}
        </Typography>
      )}
      <Box className="buildOptionMetrics">
        <BuildMetric
          label="Build cost"
          value={formatMoneyConcise(generator.buildCost)}
        />
        <BuildMetric
          label="Build time"
          value={`${Math.round(generator.yearsToBuild * 12)} mo`}
        />
        <ExpectedOutputMetric
          shape={outputShape}
          ceiling={props.outputCeiling || 1}
        />
        {props.secondaryMetric === "lcWh" && (
          <BuildMetric
            label="Cost per MWh"
            value={`${fuelPrices[generator.fuel] ? "~" : ""}${formatMoneyConcise(generator.lcWh * 1000000)}`}
          />
        )}
      </Box>
      <Box className="buildOptionFooter">
        <Button
          color="primary"
          className="expand-details"
          size="small"
          aria-label={`${expanded ? "Hide" : "Show"} ${generator.name} details`}
          aria-expanded={expanded}
          endIcon={expanded ? <ArrowDropUpIcon /> : <ArrowDropDownIcon />}
          onClick={(event) => {
            event.stopPropagation();
            toggleExpand();
          }}
        >
          {expanded ? "Hide details" : "Show details"}
        </Button>

        {!wideLayout && compareAction}
      </Box>
      <Collapse in={expanded} timeout="auto" unmountOnExit>
        <Typography
          className="buildOptionDescription"
          variant="body2"
          color="textSecondary"
        >
          {roleHint} {generator.description}
        </Typography>
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
        <TableContainer>
          <Table
            size="small"
            aria-label="generator properties"
            className="generatorDetails"
          >
            <TableBody>
              {props.secondaryMetric !== "lcWh" && (
                <GeneratorDetailRow
                  label="Lifetime cost"
                  value={formatMoneyConcise(generator.lcWh * 1000000) + "/MWh"}
                  entry={MANUAL_ENTRY.TOTAL_COST_OF_ENERGY}
                />
              )}
              <GeneratorDetailRow
                label="Expected capacity factor"
                value={percent(generator.capacityFactor)}
                entry={MANUAL_ENTRY.CAPACITY_FACTOR}
              />
              {generator.minimumStableOutput !== undefined && (
                <GeneratorDetailRow
                  label="Minimum stable output"
                  value={
                    percent(generator.minimumStableOutput) +
                    " · " +
                    formatWatts(generator.peakW * generator.minimumStableOutput)
                  }
                  entry={MANUAL_ENTRY.RAMP_RATE}
                />
              )}
              <GeneratorDetailRow
                label={hasVariableOM ? "Fixed O&M" : "Base O&M"}
                value={
                  formatMoneyConcise(generator.annualOperatingCost) + "/yr"
                }
                entry={MANUAL_ENTRY.OPERATING_COSTS}
              />
              {hasVariableOM && (
                <>
                  <GeneratorDetailRow
                    label="Variable O&M"
                    value={
                      "$" +
                      (generator.variableOperatingCostPerMWh || 0).toFixed(2) +
                      "/MWh"
                    }
                    entry={MANUAL_ENTRY.OPERATING_COSTS}
                  />
                  <GeneratorDetailRow
                    label="Expected variable O&M"
                    value={formatMoneyConcise(estimatedVariableOM) + "/yr"}
                    entry={MANUAL_ENTRY.OPERATING_COSTS}
                  />
                </>
              )}
              {generator.costPerStart !== undefined && (
                <GeneratorDetailRow
                  label="Non-fuel start cost"
                  value={formatMoneyConcise(generator.costPerStart) + "/start"}
                  entry={MANUAL_ENTRY.OPERATING_COSTS}
                />
              )}
              {(hasVariableOM || generator.costPerStart !== undefined) && (
                <GeneratorDetailRow
                  label="Estimated annual O&M"
                  value={
                    formatMoneyConcise(
                      estimatedAnnualOperatingCost(generator),
                    ) + "/yr"
                  }
                  entry={MANUAL_ENTRY.OPERATING_COSTS}
                />
              )}
              {fuelPrices[generator.fuel] && (
                <GeneratorDetailRow
                  label="Fuel costs"
                  value={
                    formatMoneyConcise(
                      generator.btuPerWh * fuelPrices[generator.fuel] || 0,
                    ) + "/MWh"
                  }
                  entry={MANUAL_ENTRY.FUEL_COSTS}
                />
              )}
              {generator.spinMinutes > 1 && (
                <GeneratorDetailRow
                  label="Ramp up/down time"
                  value={generator.spinMinutes + " min"}
                  entry={MANUAL_ENTRY.RAMP_RATE}
                />
              )}
              <GeneratorDetailRow
                label="Accounting lifetime"
                value={generator.lifespanYears + " years"}
                entry={MANUAL_ENTRY.ACCOUNTING_LIFETIME}
              />
              {sites && (
                <GeneratorDetailRow
                  label="Sites left"
                  value={`${sites.remaining} of ${sites.total}`}
                  entry={MANUAL_ENTRY.PROJECT_SITES}
                />
              )}
              <GeneratorDetailRow
                label="Direct emissions"
                value={formatMass(kgCO2ePerMWh, units) + "/MWh"}
                entry={MANUAL_ENTRY.EMISSIONS}
              />
            </TableBody>
          </Table>
        </TableContainer>
      </Collapse>

      <Dialog open={open} onClose={toggleOpen}>
        <DialogTitle>
          Build {formatWatts(generator.peakW)} {generator.name}?
          <IconButton
            aria-label="close"
            onClick={toggleOpen}
            className="top-right"
            size="large"
          >
            <CloseIcon />
          </IconButton>
        </DialogTitle>
        <DialogContent className="noPadding">
          <DecisionImpactPreview
            facts={[
              {
                concept: "money",
                label: "Cash purchase",
                value: `${formatMoneyConcise(cash)} → ${formatMoneyConcise(cash - generator.buildCost)}`,
              },
              {
                concept: "finances",
                label: "Loan option",
                value: `${formatMoneyConcise(downpayment)} now + ${formatMoneyConcise(monthlyPayment)}/mo`,
                detail: "Payments start now.",
              },
              {
                concept: "money",
                label: "Estimated upkeep",
                value: `${formatMoneyConcise(estimatedAnnualOperatingCost(generator) / 12)}/mo`,
                detail: "Plus fuel and loan payments.",
              },
              {
                concept: "time",
                label: "Online in",
                value: `${Math.round(generator.yearsToBuild * 12)} months`,
                detail: "No output until built.",
              },
              {
                concept: "supply",
                label: "Typical output",
                value: `+${formatWatts(typicalOutputW)}`,
                detail: `${formatWatts(generator.peakW)} max; ${waterShape ? "water" : "weather"} may limit it.`,
              },
              ...(waterShape
                ? [
                    {
                      concept: "weather" as const,
                      label: "Water supply",
                      value: `${percent(waterShape.monthly[waterShape.lowMonth])}–${percent(Math.max(...waterShape.monthly))} of full power`,
                      detail: `Rain and snowmelt, lowest in ${MONTH_NAMES[waterShape.lowMonth]}. The reservoir stores water between.`,
                    },
                  ]
                : []),
              ...(sites
                ? [
                    {
                      concept: "build" as const,
                      label: "Project site",
                      value: `Uses 1 of ${sites.remaining} left`,
                      detail:
                        "Each project takes a whole site, whatever its size.",
                    },
                  ]
                : []),
              {
                concept: kgCO2ePerMWh > 0 ? "danger" : "goal",
                label: "Direct emissions",
                value:
                  kgCO2ePerMWh > 0
                    ? `${formatMass(kgCO2ePerMWh, units)}/MWh`
                    : "No direct emissions modeled",
              },
            ]}
          />
          <Button
            color="primary"
            size="small"
            fullWidth
            aria-expanded={financingExpanded}
            aria-controls={financingTermsId}
            endIcon={
              financingExpanded ? <ArrowDropUpIcon /> : <ArrowDropDownIcon />
            }
            onClick={() => setFinancingExpanded((value) => !value)}
          >
            {financingExpanded
              ? "Hide financing terms"
              : "Show financing terms"}
          </Button>
          <Collapse in={financingExpanded} timeout="auto" unmountOnExit>
            <TableContainer id={financingTermsId}>
              <Table size="small" aria-label="Financing terms">
                <TableBody>
                  <TableRow>
                    <TableCell>Downpayment</TableCell>
                    <TableCell align="right">
                      {formatMoneyConcise(downpayment)}
                    </TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell>
                      Interest rate
                      <ManualLink
                        entry={MANUAL_ENTRY.INTEREST_RATES}
                        label="interest rate"
                      />
                    </TableCell>
                    <TableCell align="right">
                      {(props.interestRate * 100).toFixed(2)}%
                    </TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell>Monthly payments</TableCell>
                    <TableCell align="right">
                      {formatMoneyConcise(monthlyPayment)}/mo
                    </TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell>Loan duration</TableCell>
                    <TableCell align="right">
                      Construction + {LOAN_MONTHS / 12} years
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </TableContainer>
          </Collapse>
        </DialogContent>
        <DialogActions>
          <Button
            color="primary"
            disabled={cash < generator.buildCost}
            variant="contained"
            onClick={(e: React.MouseEvent<HTMLElement>) =>
              submitPurchase(false, e)
            }
            startIcon={<ConceptIcon concept="money" fontSize="small" />}
          >
            Pay cash
          </Button>
          <Button
            color="primary"
            variant="outlined"
            onClick={(e: React.MouseEvent<HTMLElement>) =>
              submitPurchase(true, e)
            }
            startIcon={<ConceptIcon concept="finances" fontSize="small" />}
          >
            Take loan
          </Button>
        </DialogActions>
      </Dialog>
    </Card>
  );
}

function GeneratorComparison(props: {
  generators: GeneratorShoppingType[];
  onClear: () => void;
}): React.JSX.Element | null {
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
      <div className="generatorComparisonChoices">
        {props.generators.map((generator) => (
          <div className="generatorComparisonChoice" key={generator.name}>
            <img
              src={`/images/${generator.name.toLowerCase()}.svg`}
              alt=""
              aria-hidden
            />
            <Typography variant="body2" sx={{ fontWeight: 800 }}>
              {generator.name}
            </Typography>
            <Typography variant="caption">
              {formatMoneyConcise(generator.buildCost)} ·{" "}
              {Math.round(generator.yearsToBuild * 12)} mo
            </Typography>
            <Typography variant="caption" color="textSecondary">
              {formatWatts(generator.peakW * generator.capacityFactor)} typical
              · {formatMoneyConcise(generator.lcWh * 1000000)}/MWh
            </Typography>
          </div>
        ))}
      </div>
    </section>
  );
}

type GeneratorSortKey = "buildCost" | "yearsToBuild" | "lcWh";

const sortOptions: ReadonlyArray<readonly [GeneratorSortKey, string]> = [
  ["buildCost", "Build Cost"],
  ["yearsToBuild", "Build Time"],
  ["lcWh", "Cost per MWh"],
];

// Starting at 1MW, each tick increments the front number - when it overflows, instead add a 0 (i.e. 1->2MW, 9->10 MW, 10->20MW)
function getW(tick: number) {
  const exponent = Math.floor(tick / 9) + 6;
  const frontNumber = (tick % 9) + 1;
  return frontNumber * Math.pow(10, exponent);
}

function getTickFromW(w: number) {
  const exponent = Math.floor(Math.log10(w)) - 6;
  const frontNumber = +w.toString().charAt(0);
  return frontNumber + exponent * 9 - 1;
}

function valueLabelFormat(x: number) {
  return formatWatts(getW(x));
}

export interface StateProps {
  hasEvidenceReturn?: boolean;
  evidenceRequest?: import("../../Types").EvidenceRequestType;
  facilityDragActive?: boolean;
  game: GameType;
  focusFuel?: FuelNameType;
}

export interface DispatchProps {
  onEvidenceReturn?: () => void;
  onEvidenceReady?: (
    request: import("../../Types").EvidenceRequestType,
    element: HTMLElement | null,
  ) => void;
  onBuildGenerator: (
    generator: GeneratorShoppingType,
    financed: boolean,
  ) => void;
  onBack: () => void;
}

export interface Props extends StateProps, DispatchProps {
  embedded?: boolean;
}

export default function BuildGenerators(props: Props): React.JSX.Element {
  const { evidenceRequest, facilityDragActive, onEvidenceReady } = props;
  const evidenceAnchor = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    const request = evidenceRequest;
    if (
      request &&
      typeof request.target === "object" &&
      request.target.card === "FACILITIES" &&
      request.target.view === "BUILD_GENERATORS" &&
      !facilityDragActive
    ) {
      onEvidenceReady?.(request, evidenceAnchor.current);
    }
  }, [evidenceRequest, facilityDragActive, onEvidenceReady]);
  const { game, onBack } = props;
  const now = getTimeFromTimeline(game.date.minute, game.timeline);
  const filtered = game.facilities.filter((f) => !f.peakWh);
  const mostRecentId = filtered.reduce((id, f) => (id < f.id ? f.id : id), -1);
  const mostRecentBuiltValue =
    (filtered.find((f) => f.id === mostRecentId) || {}).peakW || 500000000;
  const [sliderTick, setSliderTick] = React.useState<number>(
    getTickFromW(mostRecentBuiltValue),
  );
  const [sort, setSort] = React.useState<GeneratorSortKey>("buildCost");
  const [comparedNames, setComparedNames] = React.useState<string[]>([]);
  const [primerVisible, dismissPrimer] = useHydroPrimer();

  if (!now) {
    return <span />;
  }

  const cash = now.cash;
  const forecastedTimeline = generateNewTimeline(
    game,
    cash,
    now.customers,
    TICKS_PER_YEAR * 3, // 3 years - TODO turn this into a memoized selector of month/year -> long term forecasted wind speeds and irradiances
  );
  const windSpeeds = forecastedTimeline.map((w) => w.windKph);
  const offshoreWindSpeeds = forecastedTimeline.flatMap((w) =>
    w.windOffshoreKph === undefined ? [] : [w.windOffshoreKph],
  );
  const airborneWindSpeeds = forecastedTimeline.map((w) => w.windAirborneKph);
  const solarIrradiances = forecastedTimeline.map((w) => w.solarIrradianceWM2);
  const generators = GENERATORS(
    game,
    getW(sliderTick),
    windSpeeds,
    solarIrradiances,
    offshoreWindSpeeds,
    airborneWindSpeeds,
  )
    .filter(
      (generator) =>
        game.scenarioId !== 1 ||
        game.tutorialStep !== 1 ||
        ["Natural Gas", "Sun", "Wind"].includes(generator.fuel),
    )
    .sort((a, b) => {
      if (props.focusFuel && a.fuel !== b.fuel) {
        if (a.fuel === props.focusFuel) {
          return -1;
        }
        if (b.fuel === props.focusFuel) {
          return 1;
        }
      }
      return a[sort] - b[sort];
    });
  const forecastGapW = Math.max(
    0,
    ...forecastedTimeline.map((tick) => tick.demandW - tick.supplyW),
  );
  const outputShapes = new Map(
    generators.map((generator) => [
      generator.name,
      expectedMonthlyOutputShape(generator, forecastedTimeline),
    ]),
  );
  const outputCeiling = sharedOutputCeiling(Array.from(outputShapes.values()));
  const buildableGenerators = generators.filter(
    (generator) => generator.available && generator.peakW <= generator.maxPeakW,
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
  const comparedGenerators = generators.filter((generator) =>
    comparedNames.includes(generator.name),
  );

  // Tutorials script their own path through this list, so the primer waits for a real game
  const hydro = generators.find((generator) => generator.name === "Hydro");
  const hydroSites =
    hydro &&
    getSiteInventory(hydro.name, game.location, hydro.viableLocationsRemaining);
  const showPrimer =
    primerVisible &&
    !!hydro?.available &&
    !!hydroSites &&
    hydroSites.remaining > 0 &&
    !getScenario(game.scenarioId, game.customScenario)?.tutorialSteps;

  const toggleCompare = (name: string) => {
    setComparedNames((current) =>
      current.includes(name)
        ? current.filter((candidate) => candidate !== name)
        : current.length < 3
          ? [...current, name]
          : current,
    );
  };

  return (
    <div
      id={props.embedded ? undefined : "topbar"}
      className="flexContainer screenCatalog"
      ref={evidenceAnchor}
      tabIndex={-1}
      aria-label="Generator build options"
    >
      {props.hasEvidenceReturn && (
        <Button
          onClick={props.onEvidenceReturn}
          sx={{ minHeight: 44, alignSelf: "flex-start" }}
        >
          Return to evidence
        </Button>
      )}
      {props.focusFuel &&
        !buildableGenerators.some(
          (generator) => generator.fuel === props.focusFuel,
        ) && (
          <Typography role="status" sx={{ px: 2, py: 1 }}>
            The requested fuel has no available generator at this size. Showing
            generator options.
          </Typography>
        )}
      <ConstructionBuildHeader
        hideTitle={props.embedded}
        concept="generator"
        title="Build Generator"
        cash={cash}
        capacity={valueLabelFormat(sliderTick)}
        sliderValue={sliderTick}
        sliderMin={0}
        sliderMax={34}
        sort={sort}
        sortOptions={sortOptions}
        onClose={onBack}
        onSliderChange={setSliderTick}
        onSortChange={(value) => setSort(value as GeneratorSortKey)}
      />
      <GeneratorComparison
        generators={comparedGenerators}
        onClear={() => setComparedNames([])}
      />
      <List dense className="scrollable cardList">
        {generators.map((g: GeneratorShoppingType) => {
          const advantages = [
            g.buildCost === lowestBuildCost ? "Lowest upfront cost" : undefined,
            g.yearsToBuild === fastestBuild ? "Fastest online" : undefined,
            g.lcWh === lowestEnergyCost ? "Lowest lifetime cost" : undefined,
            g.btuPerWh === 0 ? "No direct emissions" : undefined,
          ].filter((value): value is string => Boolean(value));
          const compared = comparedNames.includes(g.name);
          return (
            <React.Fragment key={g.name}>
              {showPrimer && g.name === "Hydro" && hydroSites && (
                <HydroPrimer
                  place={shortPlaceName(game.location)}
                  totalSites={hydroSites.total}
                  onDismiss={dismissPrimer}
                />
              )}
              <GeneratorBuildItem
                date={game.date}
                seed={game.seed}
                location={game.location}
                interestRate={game.interestRate}
                generator={g}
                cash={cash}
                secondaryMetric={sort === "buildCost" ? "yearsToBuild" : sort}
                forecastGapW={forecastGapW}
                advantages={advantages.slice(0, 2)}
                outputShape={outputShapes.get(g.name)}
                outputCeiling={outputCeiling}
                compared={compared}
                compareDisabled={comparedNames.length >= 3}
                onCompare={() => toggleCompare(g.name)}
                onBuild={(financed: boolean) => {
                  props.onBuildGenerator(g, financed);
                  if (props.hasEvidenceReturn && props.onEvidenceReturn)
                    props.onEvidenceReturn();
                  else onBack();
                }}
              />
            </React.Fragment>
          );
        })}
      </List>
    </div>
  );
}
