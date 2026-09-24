import * as React from "react";
import {
  Avatar,
  Box,
  Button,
  Card,
  CardHeader,
  Checkbox,
  Chip,
  Collapse,
  Dialog,
  DialogActions,
  DialogContent,
  FormControlLabel,
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
import ClosableDialogTitle from "../base/ClosableDialogTitle";
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
  MONTH_NAMES,
  MONTHS,
  TICKS_PER_YEAR,
} from "../../Constants";
import { getHydroAvailability } from "../../data/HydroSites";
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
  resilienceBuildOption,
  ResilienceBuildOptionType,
  withResilienceOption,
} from "../../helpers/Hazards";
import { STANDARD_GAS_DESIGN_MIN_TEMP_C } from "../../data/Hazards";
import { formatTemperature } from "../../helpers/Units";
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
  siteCountLabel,
} from "../base/BuildAvailability";
import HydroPrimer, { useHydroPrimer } from "../base/HydroPrimer";
import { getScenario } from "../../data/Scenarios";
import BuildMetric, { ConstructionEmissionsMetric } from "../base/BuildMetric";
import ConstructionBuildHeader from "../base/ConstructionBuildHeader";
import Sparkline from "../base/Sparkline";

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

/**
 * Hydro can only deliver the water that arrives, so its typical output follows the forecast
 * inflow rather than the design capacity factor, which a drought year can fall well short of.
 */
function typicalCapacityFactor(
  generator: GeneratorShoppingType,
  shape?: ExpectedOutputShape,
): number {
  return shape?.kind === "water-inflow" ? shape.mean : generator.capacityFactor;
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
  hydroAvailability?: ReturnType<typeof getHydroAvailability>;
  onUseSiteMaximum?: (peakW: number) => void;
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
  // Optional weather hardening, and the quote with it set or cleared. Both come from the
  // hazard model so the dialog's price is exactly the one the purchase will charge.
  resilienceOption?: ResilienceBuildOptionType;
  withResilience?: (selected: boolean) => GeneratorShoppingType;
  onBuild: (financed: boolean, resilienceSelected?: boolean) => void;
}

function resilienceOptionDetail(
  option: ResilienceBuildOptionType,
  designMinTempC: number | undefined,
  units: ReturnType<typeof useUnits>,
): string {
  if (option.upgrade === "hailResistant") {
    return "Cuts hail damage and weather insurance.";
  }
  const temperature = (celsius: number) =>
    formatTemperature(celsius, units).replace(/^-/, "\u2212");
  return `Runs down to ${temperature(designMinTempC ?? STANDARD_GAS_DESIGN_MIN_TEMP_C)} instead of ${temperature(STANDARD_GAS_DESIGN_MIN_TEMP_C)}.`;
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
  const [resilienceSelected, setResilienceSelected] = React.useState(
    !!props.resilienceOption?.selected,
  );
  const financingTermsId = React.useId();
  const purchaseSubmitted = React.useRef(false);
  const downpayment = DOWNPAYMENT_PERCENT * props.generator.buildCost;
  const sizeBuildable = props.generator.peakW <= props.generator.maxPeakW;
  const { buildable, secondaryText } = getBuildAvailability({
    hydroAvailability: props.hydroAvailability,
    name: generator.name,
    description: generator.description,
    available: generator.available,
    sizeBuildable,
    maxSizeLabel: formatWatts(generator.maxPeakW),
    location: props.location,
    viableLocationsRemaining: generator.viableLocationsRemaining,
  });
  const sites = props.hydroAvailability
    ? undefined
    : getSiteInventory(
        generator.name,
        props.location,
        generator.viableLocationsRemaining,
      );
  const financingGap = Math.max(0, downpayment - cash);
  const canBuild = buildable && financingGap === 0;
  const buildSubtitle =
    buildable && financingGap > 0
      ? `${formatMoneyConcise(financingGap)} cash needed to afford loan downpayment`
      : secondaryText;
  const hasVariableOM = generator.variableOperatingCostPerMWh !== undefined;
  const estimatedVariableOM = estimatedAnnualVariableOperatingCost(generator);
  // kg of CO2 equivalent released per MWh generated - 0 for carbon-free sources,
  // whose fuel either isn't in FUELS at all (sun, wind) or is emission-free (uranium)
  const kgCO2ePerMWh = Math.round(
    1000000 * generator.btuPerWh * (fuel.kgCO2ePerBtu || 0),
  );
  const outputShape =
    props.outputShape || expectedMonthlyOutputShape(generator, []);
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
      setResilienceSelected(!!props.resilienceOption?.selected);
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
    props.onBuild(
      financed,
      props.resilienceOption ? resilienceSelected : undefined,
    );
    toggleOpen(e);
  };

  // The dialog prices the quote with the player's hardening choice; the card keeps the default
  const quote =
    props.resilienceOption && props.withResilience
      ? props.withResilience(resilienceSelected)
      : generator;
  const quoteDownpayment = DOWNPAYMENT_PERCENT * quote.buildCost;
  const quoteMonthlyPayment = getMonthlyPayment(
    quote.buildCost - quoteDownpayment,
    props.interestRate,
    LOAN_MONTHS,
  );
  const quoteCanBuild = buildable && quoteDownpayment <= cash;
  const resilienceOptionId = React.useId();

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

  const siteMaximum =
    props.hydroAvailability?.selected || props.hydroAvailability?.largest;
  const useSiteMaximumAction = siteMaximum && props.onUseSiteMaximum && (
    <Button
      size="small"
      onClick={() => props.onUseSiteMaximum?.(siteMaximum.maxPeakW)}
    >
      Use site maximum
    </Button>
  );

  return (
    <Card
      className={`build-list-item buildOption${props.compared ? " compared" : ""}`}
    >
      <CardHeader
        className={useSiteMaximumAction ? "hydroBuildHeader" : undefined}
        avatar={
          <Avatar
            alt={generator.name}
            src={`/images/${generator.name.toLowerCase()}.svg`}
          />
        }
        action={
          <Box className="generatorPurchaseActions">
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
            {useSiteMaximumAction}
          </Box>
        }
        title={generator.name}
        subheader={useSiteMaximumAction ? role : undefined}
      />
      {!useSiteMaximumAction && (
        <Typography className="buildOptionContext" variant="body2">
          {role}
          {sites && sites.remaining > 0 && (
            <>
              {" · "}
              <span className="nowrap">{siteCountLabel(sites)}</span>
            </>
          )}
        </Typography>
      )}
      {props.hydroAvailability && (
        <Box sx={{ px: 2, pb: 1 }}>
          <Typography variant="body2">
            {props.hydroAvailability.remaining.length} sites left ·{" "}
            {props.hydroAvailability.eligible.length}{" "}
            {props.hydroAvailability.eligible.length === 1 ? "fits" : "fit"}
            {props.hydroAvailability.largest &&
              ` · largest: ${formatWatts(props.hydroAvailability.largest.maxPeakW, 6)}`}
          </Typography>
          {props.hydroAvailability.selected && (
            <Typography variant="body2">
              Site: {props.hydroAvailability.selected.name} ·{" "}
              {formatWatts(props.hydroAvailability.selected.maxPeakW, 6)} max
            </Typography>
          )}
        </Box>
      )}
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
        <Box className="buildOptionMetrics">
          <ConstructionEmissionsMetric
            kgco2eTotal={
              (generator.constructionKgco2ePerW || 0) * generator.peakW
            }
            yearsToBuild={generator.yearsToBuild}
            units={units}
          />
        </Box>
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
                // Lifetime cost still assumes average water years; this is the year ahead
                label={
                  waterShape
                    ? "Capacity factor, this forecast"
                    : "Expected capacity factor"
                }
                value={percent(capacityFactor)}
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
        <ClosableDialogTitle onClose={toggleOpen}>
          Build {formatWatts(generator.peakW, props.hydroAvailability ? 6 : 1)}{" "}
          {generator.name}?
        </ClosableDialogTitle>
        <DialogContent className="noPadding">
          {props.hydroAvailability?.selected && (
            <Typography variant="body2" sx={{ px: 2, mb: 2 }}>
              {props.hydroAvailability.selected.name} ·{" "}
              {formatWatts(props.hydroAvailability.selected.maxPeakW, 6)} max.
              Uses the whole site. Only cancelling before completion frees it.
            </Typography>
          )}
          {props.resilienceOption && (
            <Box className="resilienceBuildOption">
              <FormControlLabel
                control={
                  <Checkbox
                    checked={resilienceSelected}
                    onChange={(event) =>
                      setResilienceSelected(event.target.checked)
                    }
                    slotProps={{
                      input: { "aria-describedby": resilienceOptionId },
                    }}
                  />
                }
                label={`${props.resilienceOption.label} +${formatMoneyConcise(props.resilienceOption.extraBuildCost)}`}
              />
              <Typography
                id={resilienceOptionId}
                variant="body2"
                color="textSecondary"
                className="resilienceBuildOptionDetail"
              >
                {resilienceOptionDetail(
                  props.resilienceOption,
                  props.withResilience?.(true).resilience?.designMinTempC,
                  units,
                )}
              </Typography>
            </Box>
          )}
          <DecisionImpactPreview
            facts={[
              {
                concept: "money",
                label: "Cash purchase",
                value: `${formatMoneyConcise(cash)} → ${formatMoneyConcise(cash - quote.buildCost)}`,
              },
              {
                concept: "finances",
                label: "Loan option",
                value: `${formatMoneyConcise(quoteDownpayment)} now + ${formatMoneyConcise(quoteMonthlyPayment)}/mo`,
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
                detail: waterShape
                  ? `${formatWatts(generator.peakW)} max; water limits it, lowest in ${MONTH_NAMES[waterShape.lowMonth]}.`
                  : `${formatWatts(generator.peakW)} max; weather may limit it.`,
              },
              ...(sites
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
                      {formatMoneyConcise(quoteDownpayment)}
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
                      {formatMoneyConcise(quoteMonthlyPayment)}/mo
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
            disabled={!quoteCanBuild || cash < quote.buildCost}
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
            disabled={!quoteCanBuild}
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
  outputShapes: Map<string, ExpectedOutputShape | undefined>;
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
              {formatWatts(
                generator.peakW *
                  typicalCapacityFactor(
                    generator,
                    props.outputShapes.get(generator.name),
                  ),
              )}{" "}
              typical · {formatMoneyConcise(generator.lcWh * 1000000)}/MWh
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
  const [exactHydroW, setExactHydroW] = React.useState<number>();
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
  const hydroAvailability = getHydroAvailability(
    game,
    exactHydroW ?? getW(sliderTick),
  );
  const generators = GENERATORS(
    game,
    getW(sliderTick),
    windSpeeds,
    solarIrradiances,
    offshoreWindSpeeds,
    airborneWindSpeeds,
  )
    .map((generator) =>
      generator.name === "Hydro" && exactHydroW !== undefined
        ? GENERATORS(
            game,
            exactHydroW,
            windSpeeds,
            solarIrradiances,
            offshoreWindSpeeds,
            airborneWindSpeeds,
          ).find((candidate) => candidate.name === "Hydro") || generator
        : generator,
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
  const hydroSites = {
    total: hydroAvailability.remaining.length,
    remaining: hydroAvailability.remaining.length,
  };
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
        onSliderChange={(value) => {
          setSliderTick(value);
          setExactHydroW(undefined);
        }}
        onSortChange={(value) => setSort(value as GeneratorSortKey)}
      />
      <GeneratorComparison
        generators={comparedGenerators}
        outputShapes={outputShapes}
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
                <HydroPrimer onDismiss={dismissPrimer} />
              )}
              <GeneratorBuildItem
                hydroAvailability={
                  g.name === "Hydro" ? hydroAvailability : undefined
                }
                onUseSiteMaximum={(peakW) => {
                  setSliderTick(getTickFromW(peakW));
                  setExactHydroW(peakW);
                }}
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
                resilienceOption={resilienceBuildOption(g, game)}
                withResilience={(selected) =>
                  withResilienceOption(g, game, selected)
                }
                onBuild={(financed, resilienceSelected) => {
                  props.onBuildGenerator(
                    resilienceSelected === undefined
                      ? g
                      : withResilienceOption(g, game, resilienceSelected),
                    financed,
                  );
                  onBack();
                }}
              />
            </React.Fragment>
          );
        })}
      </List>
    </div>
  );
}
