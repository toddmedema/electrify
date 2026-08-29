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
  Menu,
  MenuItem,
  Slider,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableRow,
  Toolbar,
  Typography,
} from "@mui/material";
import ArrowDropDownIcon from "@mui/icons-material/ArrowDropDown";
import ArrowDropUpIcon from "@mui/icons-material/ArrowDropUp";
import CloseIcon from "@mui/icons-material/Close";
import PauseIcon from "@mui/icons-material/Pause";
import SortIcon from "@mui/icons-material/Sort";
import { getTimeFromTimeline } from "../../helpers/DateTime";
import {
  estimatedAnnualOperatingCost,
  estimatedAnnualVariableOperatingCost,
  getMonthlyPayment,
} from "../../helpers/Financials";
import {
  formatMoneyConcise,
  formatMoneyStable,
  formatWatts,
} from "../../helpers/Format";
import { getFuelPricesPerMBTU } from "../../data/FuelPrices";
import {
  DOWNPAYMENT_PERCENT,
  FUELS,
  GAME_TO_REAL_YEARS,
  LOAN_MONTHS,
  TICKS_PER_YEAR,
} from "../../Constants";
import { GENERATORS } from "../../data/Facilities";
import {
  DateType,
  GameType,
  GeneratorShoppingType,
  LocationType,
  SpeedType,
} from "../../Types";
import { generateNewTimeline } from "../../reducers/Game";
import { MANUAL_ENTRY } from "../../data/Manual";
import { formatMass } from "../../helpers/Units";
import ManualLink from "../base/ManualLink";
import { useUnits } from "../base/UnitsContext";
import ConceptIcon from "../base/ConceptIcon";
import DecisionImpactPreview from "../base/DecisionImpactPreview";
import {
  getBuildAvailability,
  ViableLocationsRow,
} from "../base/BuildAvailability";

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
  compared?: boolean;
  compareDisabled?: boolean;
  onCompare?: () => void;
  onBuild: (financed: boolean) => void;
}

export interface GeneratorRoleType {
  label: string;
  detail: string;
}

export function generatorRole(
  generator: GeneratorShoppingType,
): GeneratorRoleType {
  if (generator.fuel === "Hydro") {
    return {
      label: "Clean & dispatchable",
      detail: "Weather-fed power that can respond when the grid needs it.",
    };
  }
  if (generator.btuPerWh === 0) {
    return {
      label: "Clean, weather-led",
      detail: "No direct emissions; output follows local conditions.",
    };
  }
  if (generator.spinMinutes <= 30) {
    return {
      label: "Flexible power",
      detail: "Can respond quickly, with fuel and emissions tradeoffs.",
    };
  }
  return {
    label: "Steady output",
    detail: "Firm supply with a slower response and long-lived commitment.",
  };
}

export function GeneratorBuildItem(
  props: GeneratorBuildItemProps,
): React.JSX.Element {
  const { generator, cash } = props;
  const units = useUnits();
  const fuel = FUELS[generator.fuel] || {};
  const fuelPrices = getFuelPricesPerMBTU(
    props.date,
    props.seed,
    props.location,
  );
  const [expanded, setExpanded] = React.useState(false);
  const [open, setOpen] = React.useState(false);
  const purchaseSubmitted = React.useRef(false);
  const downpayment = DOWNPAYMENT_PERCENT * props.generator.buildCost;
  const loanAmount = props.generator.buildCost - downpayment;
  const monthlyPayment = getMonthlyPayment(
    loanAmount,
    props.interestRate,
    LOAN_MONTHS,
  );
  const sizeBuildable = props.generator.peakW <= props.generator.maxPeakW;
  const { buildable, secondaryText } = getBuildAvailability(
    generator.description,
    sizeBuildable,
    formatWatts(generator.maxPeakW),
    generator.viableLocationsRemaining,
  );
  const financingGap = Math.max(0, downpayment - cash);
  const hasVariableOM = generator.variableOperatingCostPerMWh !== undefined;
  const estimatedVariableOM = estimatedAnnualVariableOperatingCost(generator);
  // kg of CO2 equivalent released per MWh generated - 0 for carbon-free sources,
  // whose fuel either isn't in FUELS at all (sun, wind) or is emission-free (uranium)
  const kgCO2ePerMWh = Math.round(
    1000000 * generator.btuPerWh * (fuel.kgCO2ePerBtu || 0),
  );
  const typicalOutputW = generator.peakW * generator.capacityFactor;
  const gapCoverage =
    props.forecastGapW && props.forecastGapW > 0
      ? Math.round((typicalOutputW / props.forecastGapW) * 100)
      : undefined;
  const role = generatorRole(generator);
  const toggleExpand = () => {
    setExpanded(!expanded);
  };

  const toggleOpen = (e: React.SyntheticEvent) => {
    setOpen((wasOpen: boolean) => {
      if (!wasOpen) {
        purchaseSubmitted.current = false;
      }
      return !wasOpen;
    });
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

  return (
    <Card className="build-list-item">
      <CardHeader
        avatar={
          <Avatar
            alt={generator.name}
            src={`/images/${generator.name.toLowerCase()}.svg`}
          />
        }
        action={
          <Stack direction="row" spacing={0.5}>
            {props.onCompare && (
              <Button
                size="small"
                variant={props.compared ? "contained" : "outlined"}
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
            )}
            <Button
              className="buy-button"
              size="small"
              variant="contained"
              color="primary"
              onClick={toggleOpen}
              disabled={financingGap > 0 || !buildable}
              startIcon={<ConceptIcon concept="buy" fontSize="small" />}
              aria-label={`Review purchase of ${generator.name}`}
            >
              Review
            </Button>
          </Stack>
        }
        title={generator.name}
        subheader={secondaryText}
      />
      <Box className="generatorDecisionLead">
        <Typography variant="body2" sx={{ fontWeight: 700 }}>
          {role.label}
        </Typography>
        <Typography variant="caption" color="textSecondary">
          {role.detail}
        </Typography>
        <Stack
          direction="row"
          spacing={0.75}
          useFlexGap
          sx={{ flexWrap: "wrap" }}
        >
          <Chip
            size="small"
            variant="outlined"
            label={`${formatWatts(typicalOutputW)} typical output`}
          />
          {gapCoverage !== undefined && (
            <Chip
              size="small"
              color={gapCoverage >= 100 ? "success" : "default"}
              label={`~${gapCoverage}% of peak forecast gap`}
            />
          )}
          {(props.advantages || []).map((advantage) => (
            <Chip key={advantage} size="small" label={advantage} />
          ))}
        </Stack>
      </Box>
      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(104px, 1fr))",
          gap: 1,
          px: 2,
          pb: 1.5,
        }}
      >
        <GeneratorMetric
          label="Build cost"
          value={formatMoneyConcise(generator.buildCost)}
        />
        <GeneratorMetric
          label="Build time"
          value={`${Math.round(generator.yearsToBuild * 12)} mo`}
        />
        <GeneratorMetric
          label={
            hasVariableOM
              ? `Estimated O&M (${Math.round(generator.capacityFactor * 100)}% expected output)`
              : generator.costPerStart !== undefined
                ? "Est. O&M (1 start/day)"
                : "Operating cost"
          }
          value={`${formatMoneyConcise(estimatedAnnualOperatingCost(generator))}/yr`}
        />
        <GeneratorMetric
          label="Energy cost"
          value={`${fuelPrices[generator.fuel] ? "~" : ""}${formatMoneyConcise(generator.lcWh * 1000000)}/MWh`}
        />
        <GeneratorMetric
          label="Emissions"
          value={
            kgCO2ePerMWh > 0 ? `${formatMass(kgCO2ePerMWh, units)}/MWh` : "None"
          }
        />
      </Box>
      {buildable && financingGap > 0 && (
        <Typography
          variant="body2"
          color="textSecondary"
          sx={{ px: 2, pb: 1.5 }}
        >
          Need {formatMoneyConcise(financingGap)} more cash for the{" "}
          {formatMoneyConcise(downpayment)} loan down payment.
        </Typography>
      )}
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

      <Collapse in={expanded} timeout="auto" unmountOnExit>
        <TableContainer>
          <Table size="small" aria-label="generator properties">
            <TableBody>
              {props.secondaryMetric !== "lcWh" && (
                <TableRow>
                  <TableCell>
                    Total energy cost
                    <ManualLink entry={MANUAL_ENTRY.TOTAL_COST_OF_ENERGY} />
                    <Typography variant="body2" color="textSecondary">
                      Across life, based on{" "}
                      {Math.round(generator.capacityFactor * 100)}% uptime
                      {generator.costPerStart !== undefined
                        ? " and one start/day"
                        : ""}
                    </Typography>
                  </TableCell>
                  <TableCell align="right">
                    {formatMoneyConcise(generator.lcWh * 1000000)}/MWh
                  </TableCell>
                </TableRow>
              )}
              <TableRow>
                <TableCell>
                  Average output
                  <ManualLink
                    entry={MANUAL_ENTRY.CAPACITY_FACTOR}
                    label="capacity factor"
                  />
                  <Typography variant="body2" color="textSecondary">
                    Across a year
                  </Typography>
                </TableCell>
                <TableCell align="right">
                  {formatWatts(generator.peakW * generator.capacityFactor)}
                </TableCell>
              </TableRow>
              {generator.minimumStableOutput !== undefined && (
                <TableRow>
                  <TableCell>
                    Minimum stable output
                    <ManualLink entry={MANUAL_ENTRY.RAMP_RATE} />
                    <Typography variant="body2" color="textSecondary">
                      While the plant remains online
                    </Typography>
                  </TableCell>
                  <TableCell align="right">
                    {Math.round(generator.minimumStableOutput * 100)}% ·{" "}
                    {formatWatts(
                      generator.peakW * generator.minimumStableOutput,
                    )}
                  </TableCell>
                </TableRow>
              )}
              <TableRow>
                <TableCell>
                  {hasVariableOM ? "Fixed O&M" : "Base O&M"}
                  <Typography variant="body2" color="textSecondary">
                    {hasVariableOM
                      ? "Standing annual expense"
                      : `At ${Math.round(generator.capacityFactor * 100)}% expected output`}
                  </Typography>
                </TableCell>
                <TableCell align="right">
                  {formatMoneyConcise(generator.annualOperatingCost)}/yr
                </TableCell>
              </TableRow>
              {hasVariableOM && (
                <TableRow>
                  <TableCell>
                    Variable O&M
                    <Typography variant="body2" color="textSecondary">
                      Per generated MWh
                    </Typography>
                  </TableCell>
                  <TableCell align="right">
                    ${(generator.variableOperatingCostPerMWh || 0).toFixed(2)}
                    /MWh generated
                  </TableCell>
                </TableRow>
              )}
              {generator.costPerStart !== undefined && (
                <TableRow>
                  <TableCell>
                    Non-fuel start cost
                    <Typography variant="body2" color="textSecondary">
                      Per equivalent start
                    </Typography>
                  </TableCell>
                  <TableCell align="right">
                    {formatMoneyConcise(generator.costPerStart)}/start
                  </TableCell>
                </TableRow>
              )}
              {generator.costPerStart !== undefined && (
                <TableRow>
                  <TableCell>
                    Representative-day charge
                    <Typography variant="body2" color="textSecondary">
                      365 / 12 equivalent starts
                    </Typography>
                  </TableCell>
                  <TableCell align="right">
                    {formatMoneyConcise(
                      generator.costPerStart * GAME_TO_REAL_YEARS,
                    )}
                    /displayed start
                  </TableCell>
                </TableRow>
              )}
              {(hasVariableOM || generator.costPerStart !== undefined) && (
                <TableRow>
                  <TableCell>
                    Estimated O&M
                    <Typography variant="body2" color="textSecondary">
                      {hasVariableOM
                        ? `Fixed plus ${formatMoneyConcise(estimatedVariableOM)}/yr variable at ${Math.round(generator.capacityFactor * 100)}% expected output`
                        : "Base O&M plus one start/day"}
                    </Typography>
                  </TableCell>
                  <TableCell align="right">
                    {formatMoneyConcise(
                      estimatedAnnualOperatingCost(generator),
                    )}
                    /yr
                  </TableCell>
                </TableRow>
              )}
              {fuelPrices[generator.fuel] && (
                <TableRow>
                  <TableCell>
                    Fuel costs
                    <Typography variant="body2" color="textSecondary">
                      Varies with fuel prices
                    </Typography>
                  </TableCell>
                  <TableCell align="right">
                    {/* btuPerWh * 1M = BTU per MWh, and prices are per million BTU,
                        so the two factors of a million cancel out */}
                    {formatMoneyConcise(
                      generator.btuPerWh * fuelPrices[generator.fuel] || 0,
                    )}
                    /MWh
                  </TableCell>
                </TableRow>
              )}
              {generator.spinMinutes > 1 && (
                <TableRow>
                  <TableCell>
                    Ramp up/down time
                    <ManualLink
                      entry={MANUAL_ENTRY.RAMP_RATE}
                      label="ramp rate"
                    />
                    <Typography variant="body2" color="textSecondary">
                      To go from zero to full output
                    </Typography>
                  </TableCell>
                  <TableCell align="right">
                    {generator.spinMinutes} min
                  </TableCell>
                </TableRow>
              )}
              <TableRow>
                <TableCell>Expected lifespan</TableCell>
                <TableCell align="right">
                  {generator.lifespanYears} years
                </TableCell>
              </TableRow>
              <ViableLocationsRow
                remaining={generator.viableLocationsRemaining}
              />
              {props.secondaryMetric !== "yearsToBuild" && (
                <TableRow>
                  <TableCell>Time to build</TableCell>
                  <TableCell align="right">
                    {Math.round(generator.yearsToBuild * 12)} mo
                  </TableCell>
                </TableRow>
              )}
              <TableRow>
                <TableCell>
                  Air pollution
                  <ManualLink
                    entry={MANUAL_ENTRY.EMISSIONS}
                    label="CO2e emissions"
                  />
                  <Typography variant="body2" color="textSecondary">
                    Greenhouse gas released per unit generated
                  </Typography>
                </TableCell>
                <TableCell align="right">
                  {kgCO2ePerMWh > 0
                    ? `${formatMass(kgCO2ePerMWh, units)}/MWh`
                    : "None"}
                </TableCell>
              </TableRow>
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
                detail: `Loan: ${formatMoneyConcise(cash)} → ${formatMoneyConcise(cash - downpayment)}, then ${formatMoneyConcise(monthlyPayment)}/mo`,
              },
              {
                concept: "time",
                label: "Online in",
                value: `${Math.round(generator.yearsToBuild * 12)} months`,
                detail: "Reserve does not change until construction finishes.",
              },
              {
                concept: "supply",
                label: "Typical supply",
                value: `+${formatWatts(typicalOutputW)}`,
                detail:
                  gapCoverage === undefined
                    ? `${formatWatts(generator.peakW)} nameplate capacity`
                    : `About ${gapCoverage}% of the peak forecast gap`,
              },
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
          <TableContainer>
            <Table size="small">
              <TableBody>
                <TableRow>
                  <TableCell>Time to build</TableCell>
                  <TableCell align="right">
                    {Math.round(generator.yearsToBuild * 12)} mo
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell>Cash cost</TableCell>
                  <TableCell align="right">
                    {formatMoneyConcise(generator.buildCost)}
                  </TableCell>
                </TableRow>
                <TableRow className="bold">
                  <TableCell colSpan={2}>Loan info</TableCell>
                </TableRow>
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
            variant="contained"
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

function GeneratorMetric(props: {
  label: string;
  value: string;
}): React.JSX.Element {
  return (
    <Box
      sx={{
        minWidth: 0,
        p: 1,
        border: 1,
        borderColor: "divider",
        borderRadius: 1,
        bgcolor: "action.hover",
      }}
    >
      <Typography variant="caption" color="textSecondary" component="div">
        {props.label}
      </Typography>
      <Typography variant="body2" component="div" sx={{ fontWeight: 600 }}>
        {props.value}
      </Typography>
    </Box>
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
  game: GameType;
}

export interface DispatchProps {
  onBuildGenerator: (
    generator: GeneratorShoppingType,
    financed: boolean,
  ) => void;
  onBack: () => void;
  onSpeedChange: (speed: SpeedType) => void;
}

export interface Props extends StateProps, DispatchProps {}

export default function BuildGenerators(props: Props): React.JSX.Element {
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
  const [anchorEl, setAnchorEl] = React.useState<HTMLElement | null>(null);
  const [comparedNames, setComparedNames] = React.useState<string[]>([]);

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
  ).sort((a, b) => a[sort] - b[sort]);
  const forecastGapW = Math.max(
    0,
    ...forecastedTimeline.map((tick) => tick.demandW - tick.supplyW),
  );
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

  const toggleCompare = (name: string) => {
    setComparedNames((current) =>
      current.includes(name)
        ? current.filter((candidate) => candidate !== name)
        : current.length < 3
          ? [...current, name]
          : current,
    );
  };

  const onSlider = (_event: Event, newValue: number | number[]) => {
    if (Array.isArray(newValue)) {
      newValue = newValue[0];
    }
    setSliderTick(newValue);
  };

  const onSort = (newValue: GeneratorSortKey) => {
    setSort(newValue);
    onSortClose();
  };

  const onSortOpen = (event: React.MouseEvent<HTMLElement>) => {
    setAnchorEl(event.currentTarget);
  };

  const onSortClose = () => {
    setAnchorEl(null);
  };

  return (
    <div id="topbar" className="flexContainer">
      <Toolbar className="bottomBorder">
        <Typography variant="h6">
          {formatMoneyStable(cash)}{" "}
          <span className="weak gameStatusValue">
            <ConceptIcon concept="generator" fontSize="small" />
            Build Generator
          </span>
        </Typography>
        {game.speed !== "PAUSED" && (
          <IconButton
            onClick={() => props.onSpeedChange("PAUSED")}
            aria-label="pause"
            color="primary"
            size="large"
          >
            <PauseIcon />
          </IconButton>
        )}
        <IconButton
          id="close-button"
          color="primary"
          onClick={onBack}
          aria-label="close"
          size="large"
        >
          <CloseIcon />
        </IconButton>
        <div className="flex-newline"></div>
        <div
          id="yearProgressBar"
          style={{
            width: `${game.date.percentOfYear * 100}%`,
          }}
        />
        <Typography
          id="peak-output"
          className="flex-newline"
          variant="body2"
          color="textSecondary"
        >
          Capacity:{" "}
          <Typography color="primary" component="strong">
            {valueLabelFormat(sliderTick)}
          </Typography>{" "}
          {filtered.length <= 1 && "(slide to change)"}
        </Typography>
        <Slider
          value={sliderTick}
          aria-labelledby="peak-output"
          valueLabelDisplay="off"
          min={0}
          step={1}
          max={34}
          onChange={onSlider}
        />
        <IconButton
          id="sort"
          color="primary"
          onClick={onSortOpen}
          aria-label="sort"
          size="large"
        >
          <SortIcon />
        </IconButton>
        <Menu
          id="sort-menu"
          anchorEl={anchorEl}
          keepMounted
          open={Boolean(anchorEl)}
          onClose={onSortClose}
        >
          {sortOptions.map((option) => {
            return (
              <MenuItem onClick={() => onSort(option[0])} key={option[0]}>
                {sort === option[0] ? (
                  <strong>{option[1]}</strong>
                ) : (
                  <span className="weak">{option[1]}</span>
                )}
              </MenuItem>
            );
          })}
        </Menu>
      </Toolbar>
      <GeneratorComparison
        generators={comparedGenerators}
        onClear={() => setComparedNames([])}
      />
      <List dense className="scrollable cardList">
        {generators.map((g: GeneratorShoppingType, i: number) => {
          const advantages = [
            g.buildCost === lowestBuildCost ? "Lowest upfront cost" : undefined,
            g.yearsToBuild === fastestBuild ? "Fastest online" : undefined,
            g.lcWh === lowestEnergyCost ? "Lowest lifetime cost" : undefined,
            g.btuPerWh === 0 ? "No direct emissions" : undefined,
          ].filter((value): value is string => Boolean(value));
          const compared = comparedNames.includes(g.name);
          return (
            <GeneratorBuildItem
              date={game.date}
              seed={game.seed}
              location={game.location}
              interestRate={game.interestRate}
              generator={g}
              key={i}
              cash={cash}
              secondaryMetric={sort === "buildCost" ? "yearsToBuild" : sort}
              forecastGapW={forecastGapW}
              advantages={advantages.slice(0, 2)}
              compared={compared}
              compareDisabled={comparedNames.length >= 3}
              onCompare={() => toggleCompare(g.name)}
              onBuild={(financed: boolean) => {
                props.onBuildGenerator(g, financed);
                onBack();
              }}
            />
          );
        })}
      </List>
    </div>
  );
}
