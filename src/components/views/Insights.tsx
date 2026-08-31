import * as React from "react";
import {
  Button,
  Checkbox,
  FormControlLabel,
  IconButton,
  MenuItem,
  Select,
  SelectChangeEvent,
  Slider,
  Table,
  TableBody,
  TableCell,
  TableRow,
  Toolbar,
  Typography,
} from "@mui/material";
import ArrowDownwardIcon from "@mui/icons-material/ArrowDownward";
import ArrowUpwardIcon from "@mui/icons-material/ArrowUpward";
import CloseIcon from "@mui/icons-material/Close";
import LayersIcon from "@mui/icons-material/Layers";
import TuneIcon from "@mui/icons-material/Tune";
import {
  GAME_TO_REAL_YEARS,
  ORGANIC_GROWTH_MAX_ANNUAL,
  TICK_MINUTES,
  TICKS_PER_YEAR,
} from "../../Constants";
import {
  DerivedHistoryKeysType,
  FacilityOperatingType,
  FuelNameType,
  GameType,
  GeneratorOperatingType,
  MonthlyHistoryType,
  TickPresentFutureType,
  UnitSystemType,
} from "../../Types";
import {
  deriveExpandedSummary,
  EMPTY_HISTORY,
  getDateFromMinute,
  getTimeFromTimeline,
  MINUTES_PER_MONTH,
  reduceHistories,
  summarizeTimeline,
  summarizeTimelineByMonth,
} from "../../helpers/DateTime";
import {
  customerMarketSizeAt,
  getMarketRate,
  projectCustomerChange,
} from "../../helpers/Customers";
import { getDispatchOrderedFuels } from "../../helpers/Energy";
import { facilityLifetime } from "../../helpers/Financials";
import {
  formatMoneyConcise,
  formatWattHours,
  formatWatts,
} from "../../helpers/Format";
import {
  formatLargeMassValueConcise,
  largeMassUnit,
} from "../../helpers/Units";
import {
  getStorageChoice,
  getStorageJson,
  setStorageKeyValue,
} from "../../LocalStorage";
import { generateNewTimeline } from "../../reducers/Game";
import { getScenario, SCENARIOS } from "../../data/Scenarios";
import {
  chartPalette,
  demandTypeColors,
  fuelColors,
  fuelDashArrays,
} from "../../Theme";
import ChartForecastDemandByType, {
  demandTypesBySizeAtStart,
} from "../base/ChartForecastDemandByType";
import ChartFinances from "../base/ChartFinances";
import ChartForecastFuelPrices, {
  PRICED_FUELS,
} from "../base/ChartForecastFuelPrices";
import ChartForecastSolarCapacityFactor from "../base/ChartForecastSolarCapacityFactor";
import ChartForecastStorage from "../base/ChartForecastStorage";
import ChartForecastSupplyByFuel, {
  forecastFuels,
} from "../base/ChartForecastSupplyByFuel";
import ChartForecastSupplyDemand from "../base/ChartForecastSupplyDemand";
import ChartForecastWater from "../base/ChartForecastWater";
import ChartForecastWeather from "../base/ChartForecastWeather";
import ChartLegend from "../base/ChartLegend";
import GameCard from "../base/GameCard";
import { UnitsContext } from "../base/UnitsContext";
import { formatCustomerChange } from "./Finances";

export type InsightRange =
  "all" | "next1" | "next5" | "next10" | "next20" | `year:${number}`;

export type InsightLayerId =
  | "supplyDemand"
  | "demandByType"
  | "supplyByFuel"
  | "storage"
  | "fuelPrices"
  | "solarCapacityFactor"
  | "water"
  | "weather"
  | "profit"
  | "revenue"
  | "expenses"
  | "cash"
  | "customers"
  | "emissions"
  | "financeDetails";

type LayerGroup = "Grid" | "Customers" | "Economics" | "Environment";

export interface InsightLayerDefinition {
  id: InsightLayerId;
  label: string;
  group: LayerGroup;
  availability?: "storage" | "hydro";
}

export const INSIGHT_LAYERS: readonly InsightLayerDefinition[] = [
  { id: "supplyDemand", label: "Supply & Demand", group: "Grid" },
  { id: "demandByType", label: "Demand by Load Type", group: "Grid" },
  { id: "supplyByFuel", label: "Supply by Fuel", group: "Grid" },
  {
    id: "storage",
    label: "Stored Power",
    group: "Grid",
    availability: "storage",
  },
  { id: "customers", label: "Customers", group: "Customers" },
  { id: "profit", label: "Profit", group: "Economics" },
  { id: "revenue", label: "Revenue", group: "Economics" },
  { id: "expenses", label: "Expenses", group: "Economics" },
  { id: "cash", label: "Cash", group: "Economics" },
  { id: "financeDetails", label: "Financial Details", group: "Economics" },
  { id: "fuelPrices", label: "Fuel Prices", group: "Economics" },
  { id: "emissions", label: "CO2e Emitted", group: "Environment" },
  {
    id: "solarCapacityFactor",
    label: "Solar Capacity Factor",
    group: "Environment",
  },
  { id: "weather", label: "Weather", group: "Environment" },
  { id: "water", label: "Water", group: "Environment", availability: "hydro" },
] as const;

export type InsightPresetId =
  | "overview"
  | "reliability"
  | "profitability"
  | "growth"
  | "decarbonization"
  | "custom";

export const INSIGHT_PRESETS: Record<
  Exclude<InsightPresetId, "custom">,
  { label: string; layers: InsightLayerId[] }
> = {
  // Each preset reads from the outcome a player is trying to protect into the causes they can
  // act on. Overview is deliberately the five universal health signals: optional technologies
  // belong in the diagnostic presets, not in the first view a new player sees.
  overview: {
    label: "Overview",
    layers: ["supplyDemand", "cash", "profit", "customers", "emissions"],
  },
  reliability: {
    label: "Reliability",
    layers: ["supplyDemand", "supplyByFuel", "storage", "weather", "water"],
  },
  profitability: {
    label: "Profitability",
    layers: ["profit", "cash", "revenue", "expenses", "fuelPrices"],
  },
  growth: {
    label: "Growth & pricing",
    layers: ["customers", "demandByType", "supplyDemand", "revenue", "profit"],
  },
  decarbonization: {
    label: "Decarbonization",
    layers: [
      "emissions",
      "supplyByFuel",
      "supplyDemand",
      "fuelPrices",
      "profit",
    ],
  },
};

const RANGE_KEY = "insightsRange";
const LAYERS_KEY = "insightsLayers";
const FORECAST_RANGE_OPTIONS: readonly InsightRange[] = [
  "next1",
  "next5",
  "next10",
  "next20",
];
const SYNC_KEY = "insights";
const GROUPS: LayerGroup[] = ["Grid", "Customers", "Economics", "Environment"];
const ALL_LAYER_IDS = new Set(INSIGHT_LAYERS.map((layer) => layer.id));
const HISTORICAL_LAYER_IDS = new Set<InsightLayerId>([
  "supplyDemand",
  "profit",
  "revenue",
  "expenses",
  "cash",
  "customers",
  "emissions",
  "financeDetails",
]);
const HOURS_PER_RECORDED_MONTH = 24 * GAME_TO_REAL_YEARS;

const RATE_MARKS = [0, 0.05, 0.1, 0.15, 0.2, 0.25, 0.3].map((rate) => ({
  value: rate,
  label: formatMoneyConcise(rate),
}));

interface BlackoutEdges {
  minute: number;
  value: number;
}

interface ProjectionView {
  historical: boolean;
  timeline: TickPresentFutureType[];
  sampled: TickPresentFutureType[];
  domain: { x: [number, number]; y: [number, number] };
  blackouts: BlackoutEdges[];
  blackoutTotalWh: number;
  largestBlackout: { wh: number; peakW: number; start: number; end: number };
  hasStorage: boolean;
  hasHydro: boolean;
  financePast: MonthlyHistoryType[];
  financeProjected: MonthlyHistoryType[];
}

export interface StateProps {
  game: GameType;
  selectedFacilityId: number | null;
  facilityDragActive: boolean;
  focusLayer?: InsightLayerId;
}

export interface DispatchProps {
  onDelta: (delta: Partial<GameType>) => void;
}

export interface Props extends StateProps, DispatchProps {}

interface State {
  range: InsightRange;
  layers: InsightLayerId[];
  preset: InsightPresetId;
  layersOpen: boolean;
  leversOpen: boolean;
}

function storedLayers(): InsightLayerId[] {
  const value = getStorageJson<string[]>(LAYERS_KEY, []);
  const valid = value.filter(
    (id, index): id is InsightLayerId =>
      ALL_LAYER_IDS.has(id as InsightLayerId) && value.indexOf(id) === index,
  );
  return valid.length ? valid : [...INSIGHT_PRESETS.overview.layers];
}

export function presetForLayers(layers: InsightLayerId[]): InsightPresetId {
  const match = Object.entries(INSIGHT_PRESETS).find(
    ([, preset]) =>
      preset.layers.length === layers.length &&
      preset.layers.every((layer, index) => layer === layers[index]),
  );
  return (match?.[0] as InsightPresetId | undefined) || "custom";
}

function requiredTutorialLayers(scenarioId: number): InsightLayerId[] {
  switch (scenarioId) {
    case 4:
      return ["profit", "financeDetails"];
    case 3:
      return ["customers"];
    case 5:
      return ["supplyDemand", "fuelPrices", "weather"];
    default:
      return [];
  }
}

export function withRequiredLayers(
  layers: InsightLayerId[],
  scenarioId: number,
): InsightLayerId[] {
  const next = [...layers];
  for (const id of requiredTutorialLayers(scenarioId)) {
    if (!next.includes(id)) {
      next.push(id);
    }
  }
  return next;
}

function rangeYears(range: InsightRange): number {
  return range.startsWith("next") ? Number(range.slice(4)) : 0;
}

function historicalYear(range: InsightRange): number | null {
  return range.startsWith("year:") ? Number(range.slice(5)) : null;
}

function isHistoricalRange(range: InsightRange): boolean {
  return range === "all" || historicalYear(range) !== null;
}

function historyRange(year: number): InsightRange {
  return `year:${year}`;
}

function playedHistoryYears(game: GameType): number[] {
  return [...new Set(game.monthlyHistory.map((month) => month.year))].sort(
    (a, b) => b - a,
  );
}

function rangeOptions(game: GameType): InsightRange[] {
  if (!game.monthlyHistory.length) {
    return [...FORECAST_RANGE_OPTIONS];
  }
  return [
    ...FORECAST_RANGE_OPTIONS,
    "all",
    ...playedHistoryYears(game).map(historyRange),
  ];
}

function monthMinute(month: MonthlyHistoryType, startingYear: number): number {
  return (
    ((month.year - startingYear) * 12 + month.month - 1) * MINUTES_PER_MONTH
  );
}

function financeMetadata(
  id: InsightLayerId,
  units: UnitSystemType,
): {
  key: DerivedHistoryKeysType;
  label: string;
  format: (value: number) => string;
} | null {
  switch (id) {
    case "profit":
      return { key: "profit", label: "Profit", format: formatMoneyConcise };
    case "revenue":
      return { key: "revenue", label: "Revenue", format: formatMoneyConcise };
    case "expenses":
      return { key: "expenses", label: "Expenses", format: formatMoneyConcise };
    case "cash":
      return { key: "cash", label: "Cash", format: formatMoneyConcise };
    case "customers":
      return {
        key: "customers",
        label: "Customers",
        format: (value) =>
          new Intl.NumberFormat(undefined, { notation: "compact" }).format(
            value,
          ),
      };
    case "emissions":
      return {
        key: "kgco2e",
        label: `CO2e Emitted (${largeMassUnit(units)})`,
        format: (value) => formatLargeMassValueConcise(value, units),
      };
    default:
      return null;
  }
}

function financeSeries(
  key: DerivedHistoryKeysType,
  past: MonthlyHistoryType[],
  projected: MonthlyHistoryType[],
) {
  const point = (month: MonthlyHistoryType, isProjected: boolean) => {
    const summary = deriveExpandedSummary(month);
    return {
      month: summary.year * 12 + summary.month,
      year: summary.year,
      value: summary[key],
      projected: isProjected,
    };
  };
  return [
    ...[...past].reverse().map((month) => point(month, false)),
    ...projected.map((month) => point(month, true)),
  ];
}

function facilitySignature(game: GameType): string {
  return game.facilities
    .map((facility) =>
      [
        facility.id,
        facility.paused,
        facility.yearsToBuildLeft,
        facility.peakW,
      ].join(":"),
    )
    .join("|");
}

export default class Insights extends React.Component<Props, State> {
  static contextType = UnitsContext;

  private projectionCache:
    { key: string; projection: ProjectionView } | undefined;

  constructor(props: Props) {
    super(props);
    const layers = withRequiredLayers(storedLayers(), props.game.scenarioId);
    if (props.focusLayer && !layers.includes(props.focusLayer)) {
      layers.push(props.focusLayer);
    }
    this.state = {
      range: getStorageChoice(RANGE_KEY, rangeOptions(props.game), "next1"),
      layers,
      preset: presetForLayers(layers),
      layersOpen: false,
      leversOpen: true,
    };
  }

  public shouldComponentUpdate(nextProps: Props, nextState: State) {
    // Projection generation simulates as much as twenty years and then redraws every visible
    // chart. Doing that in the middle of a pointer-driven fleet reorder is the periodic desktop
    // hitch users feel most. Keep the last projection for the few hundred milliseconds of the
    // drag, then catch up once on release.
    if (nextProps.facilityDragActive) {
      return false;
    }
    if (this.props.facilityDragActive) {
      return true;
    }
    return (
      nextState !== this.state ||
      nextProps.game.date.monthsElapsed !==
        this.props.game.date.monthsElapsed ||
      nextProps.game.dollarsPerkWh !== this.props.game.dollarsPerkWh ||
      nextProps.game.feePerKgCO2e !== this.props.game.feePerKgCO2e ||
      nextProps.selectedFacilityId !== this.props.selectedFacilityId ||
      nextProps.focusLayer !== this.props.focusLayer ||
      facilitySignature(nextProps.game) !== facilitySignature(this.props.game)
    );
  }

  public componentDidUpdate(previousProps: Props) {
    if (
      this.props.focusLayer &&
      this.props.focusLayer !== previousProps.focusLayer &&
      !this.state.layers.includes(this.props.focusLayer)
    ) {
      this.setLayers([...this.state.layers, this.props.focusLayer]);
    }
  }

  private setRange(range: InsightRange) {
    setStorageKeyValue(RANGE_KEY, range);
    this.setState({ range });
  }

  private setLayers(
    layers: InsightLayerId[],
    preset: InsightPresetId = "custom",
  ) {
    const required = withRequiredLayers(layers, this.props.game.scenarioId);
    setStorageKeyValue(LAYERS_KEY, required);
    this.setState({ layers: required, preset });
  }

  private toggleLayer(id: InsightLayerId) {
    const required = requiredTutorialLayers(this.props.game.scenarioId);
    if (this.state.layers.includes(id)) {
      if (!required.includes(id)) {
        this.setLayers(this.state.layers.filter((layer) => layer !== id));
      }
    } else {
      this.setLayers([...this.state.layers, id]);
    }
  }

  private applyPreset(id: Exclude<InsightPresetId, "custom">) {
    this.setLayers([...INSIGHT_PRESETS[id].layers], id);
  }

  private moveLayer(id: InsightLayerId, neighbour: InsightLayerId) {
    const layers = [...this.state.layers];
    const from = layers.indexOf(id);
    const to = layers.indexOf(neighbour);
    if (from < 0 || to < 0) {
      return;
    }
    [layers[from], layers[to]] = [layers[to], layers[from]];
    this.setLayers(layers);
  }

  private getHistoricalProjection(now: TickPresentFutureType): ProjectionView {
    const { game } = this.props;
    const year = historicalYear(this.state.range);
    const financePast = game.monthlyHistory.filter(
      (month) => year === null || month.year === year,
    );
    const months = [...financePast].reverse();
    const timeline = months.map((month) => {
      // The historical supply chart reads these three fields only. Cloning a real tick keeps the
      // shared chart contract intact without pretending monthlyHistory retained the other layers.
      const tick = { ...now } as TickPresentFutureType;
      tick.minute = monthMinute(month, game.startingYear);
      tick.supplyW = month.supplyWh / HOURS_PER_RECORDED_MONTH;
      tick.demandW = month.demandWh / HOURS_PER_RECORDED_MONTH;
      return tick;
    });
    const rangeMin = timeline[0].minute;
    const rangeMax = timeline[timeline.length - 1].minute + MINUTES_PER_MONTH;
    let domainMin = Number.POSITIVE_INFINITY;
    let domainMax = 0;
    let blackoutTotalWh = 0;
    for (let i = 0; i < timeline.length; i++) {
      const tick = timeline[i];
      const month = months[i];
      domainMin = Math.min(domainMin, tick.supplyW, tick.demandW);
      domainMax = Math.max(domainMax, tick.supplyW, tick.demandW);
      blackoutTotalWh += Math.max(0, month.demandWh - month.supplyWh);
    }

    return {
      historical: true,
      timeline,
      sampled: timeline,
      domain: { x: [rangeMin, rangeMax], y: [domainMin, domainMax] },
      // The monthly record knows how much energy went unserved, but not when. Drawing a blackout
      // band across the whole month would imply precision the saved data does not have.
      blackouts: [
        { minute: rangeMin, value: 0 },
        { minute: rangeMax, value: 0 },
      ],
      blackoutTotalWh,
      largestBlackout: {
        wh: 0,
        peakW: 0,
        start: rangeMin,
        end: rangeMin,
      },
      hasStorage: false,
      hasHydro: false,
      financePast,
      financeProjected: [],
    };
  }

  private getProjection(now: TickPresentFutureType): ProjectionView {
    const { game } = this.props;
    const years = rangeYears(this.state.range);
    const nextYearMinute =
      (game.date.year - game.startingYear + 1) * 12 * MINUTES_PER_MONTH;
    const projectionStepMinutes =
      this.state.range === "next10" || this.state.range === "next20"
        ? 60
        : TICK_MINUTES;
    const tickScale = projectionStepMinutes / TICK_MINUTES;
    const ticks =
      years > 0
        ? (TICKS_PER_YEAR * years) / tickScale
        : Math.max(
            1,
            Math.ceil((nextYearMinute - game.date.minute) / TICK_MINUTES),
          );
    const monthsAhead =
      years > 0 ? years * 12 : Math.max(0, 12 - game.date.monthNumber);
    const key = [
      this.state.range,
      game.date.monthsElapsed,
      game.monthlyHistory.length,
      game.dollarsPerkWh,
      game.feePerKgCO2e,
      facilitySignature(game),
    ].join("|");
    if (this.projectionCache?.key === key) {
      return this.projectionCache.projection;
    }
    if (isHistoricalRange(this.state.range)) {
      const projection = this.getHistoricalProjection(now);
      this.projectionCache = { key, projection };
      return projection;
    }

    const timeline = generateNewTimeline(
      game,
      now.cash,
      now.customers,
      ticks,
      projectionStepMinutes,
    );
    let domainMin = Number.POSITIVE_INFINITY;
    let domainMax = 0;
    for (const tick of timeline) {
      domainMin = Math.min(domainMin, tick.supplyW, tick.demandW);
      domainMax = Math.max(domainMax, tick.supplyW, tick.demandW);
    }
    const rangeMin = timeline[0].minute;
    const rangeMax = timeline[timeline.length - 1].minute;

    let blackoutTotalWh = 0;
    let current = { wh: 0, peakW: 0, start: rangeMin, end: rangeMin };
    let largestBlackout = current;
    let isBlackout = timeline[0].demandW > timeline[0].supplyW;
    const blackouts: BlackoutEdges[] = [{ minute: rangeMin, value: 0 }];
    if (isBlackout) {
      blackouts.push({ minute: rangeMin, value: domainMax });
    }
    for (const tick of timeline) {
      if (tick.demandW > tick.supplyW) {
        if (!isBlackout) {
          blackouts.push({ minute: tick.minute, value: 0 });
          blackouts.push({ minute: tick.minute, value: domainMax });
          isBlackout = true;
          current = { wh: 0, peakW: 0, start: tick.minute, end: tick.minute };
        }
        const amount = tick.demandW - tick.supplyW;
        const amountWh =
          amount * (projectionStepMinutes / 60) * GAME_TO_REAL_YEARS;
        blackoutTotalWh += amountWh;
        current.wh += amountWh;
        current.peakW = Math.max(current.peakW, amount);
      } else if (isBlackout) {
        blackouts.push({ minute: tick.minute, value: domainMax });
        blackouts.push({ minute: tick.minute, value: 0 });
        isBlackout = false;
        current.end = tick.minute;
        if (current.wh > largestBlackout.wh) {
          largestBlackout = current;
        }
      }
    }
    blackouts.push({ minute: rangeMax, value: isBlackout ? domainMax : 0 });
    if (current.wh > largestBlackout.wh) {
      largestBlackout = { ...current, end: current.end || rangeMax };
    }

    const sampleYears = Math.max(1, years);
    const sampled = timeline.filter(
      (tick) => tick.minute % (240 * sampleYears) < projectionStepMinutes,
    );
    if (sampled[0] !== timeline[0]) {
      sampled.unshift(timeline[0]);
    }
    if (sampled[sampled.length - 1] !== timeline[timeline.length - 1]) {
      sampled.push(timeline[timeline.length - 1]);
    }

    const currentMonth = summarizeTimeline(game.timeline, game.startingYear);
    const projectedMonths = summarizeTimelineByMonth(
      timeline,
      game.startingYear,
    ).slice(1, 1 + monthsAhead);
    const projection: ProjectionView = {
      historical: false,
      timeline,
      sampled,
      domain: { x: [rangeMin, rangeMax], y: [domainMin, domainMax] },
      blackouts,
      blackoutTotalWh,
      largestBlackout,
      hasStorage: timeline.some((tick) => tick.storedWh > 0),
      hasHydro: game.facilities.some((facility) => facility.fuel === "Hydro"),
      financePast: [],
      financeProjected: [currentMonth, ...projectedMonths],
    };
    this.projectionCache = { key, projection };
    return projection;
  }

  private available(layer: InsightLayerDefinition, projection: ProjectionView) {
    if (projection.historical) {
      return HISTORICAL_LAYER_IDS.has(layer.id);
    }
    return (
      !layer.availability ||
      (layer.availability === "storage" && projection.hasStorage) ||
      (layer.availability === "hydro" && projection.hasHydro)
    );
  }

  private renderLevers(now: TickPresentFutureType) {
    const { game, onDelta } = this.props;
    const scenario =
      getScenario(game.scenarioId, game.customScenario) || SCENARIOS[0];
    const marketRate = getMarketRate(
      scenario.dollarsPerkWh,
      game.date,
      game.startingYear,
      game.seed,
    );
    const customerChange = projectCustomerChange({
      customers: now.customers,
      customerRate: now.customerRate || game.customerRate || game.dollarsPerkWh,
      currentRate: game.dollarsPerkWh,
      marketRateAt: (tick) =>
        getMarketRate(
          scenario.dollarsPerkWh,
          getDateFromMinute(
            game.date.minute + tick * TICK_MINUTES,
            game.startingYear,
          ),
          game.startingYear,
          game.seed,
        ),
      marketSizeAt: (tick) =>
        customerMarketSizeAt(
          game.customerMarketSize || now.customers * 2,
          game.date.minute + tick * TICK_MINUTES,
        ),
      ownership: scenario.ownership,
    });
    const max =
      scenario.ownership === "Investor"
        ? Math.max(0.05, Math.ceil(marketRate * 200) / 100, game.dollarsPerkWh)
        : 0.3;
    const marks =
      scenario.ownership === "Investor"
        ? [
            { value: 0, label: "$0" },
            {
              value: marketRate,
              label: `${formatMoneyConcise(marketRate)} market`,
            },
            { value: max, label: formatMoneyConcise(max) },
          ]
        : RATE_MARKS;
    return (
      <section className="insightsLevers" aria-label="Planning levers">
        <Button
          startIcon={<TuneIcon />}
          onClick={() => this.setState({ leversOpen: !this.state.leversOpen })}
          aria-expanded={this.state.leversOpen}
        >
          Levers
        </Button>
        <Typography variant="body2" color="textSecondary">
          Rate <strong>{formatMoneyConcise(game.dollarsPerkWh)}/kWh</strong>
          {scenario.ownership === "Investor" && (
            <>
              {" "}
              · market {formatMoneyConcise(marketRate)} · projected customers{" "}
              <strong>
                {formatCustomerChange(customerChange, now.customers)}
              </strong>{" "}
              next month
            </>
          )}
          {scenario.ownership === "Public" && (
            <>
              {" "}
              · customer growth{" "}
              <strong>
                +{(ORGANIC_GROWTH_MAX_ANNUAL * 100).toFixed(1)}%/yr
              </strong>
            </>
          )}
        </Typography>
        {this.state.leversOpen && (
          <div className="budgetSlider flex-newline">
            <Slider
              id="rateSlider"
              disabled={!!game.replayPlayback}
              value={game.dollarsPerkWh}
              aria-label="The rate you charge for electricity generation"
              valueLabelDisplay="auto"
              valueLabelFormat={(rate) => `${formatMoneyConcise(rate)}/kWh`}
              marks={marks}
              min={0}
              step={scenario.ownership === "Investor" ? 0.001 : 0.01}
              max={max}
              onChange={(_event, value) =>
                onDelta({
                  dollarsPerkWh: Array.isArray(value) ? value[0] : value,
                })
              }
            />
          </div>
        )}
      </section>
    );
  }

  private renderLayerPanel(projection: ProjectionView) {
    if (!this.state.layersOpen) {
      return null;
    }
    const required = requiredTutorialLayers(this.props.game.scenarioId);
    return (
      <section className="insightsLayerPanel" aria-label="Data layers">
        {GROUPS.map((group) => {
          const layers = INSIGHT_LAYERS.filter(
            (layer) =>
              layer.group === group &&
              (projection.historical || this.available(layer, projection)),
          );
          return (
            <div className="insightsLayerGroup" key={group}>
              <Typography variant="subtitle2">{group}</Typography>
              {layers.map((layer) => (
                <FormControlLabel
                  key={layer.id}
                  control={
                    <Checkbox
                      id={`insightsLayer${layer.id[0].toUpperCase()}${layer.id.slice(1)}`}
                      checked={this.state.layers.includes(layer.id)}
                      disabled={
                        required.includes(layer.id) ||
                        (projection.historical &&
                          !HISTORICAL_LAYER_IDS.has(layer.id))
                      }
                      onChange={() => this.toggleLayer(layer.id)}
                    />
                  }
                  label={layer.label}
                />
              ))}
            </div>
          );
        })}
      </section>
    );
  }

  private renderFinanceDetails(projection: ProjectionView) {
    const { game, selectedFacilityId } = this.props;
    const summaryMonths = [
      ...[...projection.financePast].reverse(),
      ...projection.financeProjected,
    ];
    const summary = deriveExpandedSummary(
      summaryMonths.reduce(reduceHistories, { ...EMPTY_HISTORY }),
    );
    const units = this.context as UnitSystemType;
    const selected = game.facilities.find(
      (facility) => facility.id === selectedFacilityId,
    );
    const lifetime =
      selected && facilityLifetime(selected as FacilityOperatingType);
    return (
      <>
        {!projection.historical && selected && lifetime && (
          <div className="selectedFacilitySummary">
            <strong>{selected.name}</strong>: {formatWattHours(lifetime.wh)}{" "}
            delivered · {formatMoneyConcise(lifetime.profit)} profit
          </div>
        )}
        <Table size="small" className="insightsSummaryTable">
          <TableBody>
            {[
              ["Profit", formatMoneyConcise(summary.profit)],
              ["Revenue", formatMoneyConcise(summary.revenue)],
              ["Expenses", formatMoneyConcise(summary.expenses)],
              ["Cash", formatMoneyConcise(summary.cash)],
              ["Customers", new Intl.NumberFormat().format(summary.customers)],
              [
                "CO2e emitted",
                `${formatLargeMassValueConcise(summary.kgco2e, units)} ${largeMassUnit(units)}`,
              ],
            ].map(([label, value]) => (
              <TableRow key={label}>
                <TableCell>{label}</TableCell>
                <TableCell align="right">{value}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </>
    );
  }

  private renderTrack(
    id: InsightLayerId,
    index: number,
    visible: InsightLayerId[],
    projection: ProjectionView,
  ) {
    const { game, selectedFacilityId } = this.props;
    const definition = INSIGHT_LAYERS.find((layer) => layer.id === id)!;
    const multiyear =
      projection.domain.x[1] - projection.domain.x[0] > 12 * MINUTES_PER_MONTH;
    const fuels = forecastFuels(
      getDispatchOrderedFuels(game.facilities) as FuelNameType[],
      projection.sampled,
    );
    const selected = game.facilities.find(
      (facility) => facility.id === selectedFacilityId,
    ) as Partial<GeneratorOperatingType> | undefined;
    const highlightFuel =
      selected?.fuel && fuels.includes(selected.fuel)
        ? selected.fuel
        : undefined;
    const finance = financeMetadata(id, this.context as UnitSystemType);
    const chartId = `chartInsights${id[0].toUpperCase()}${id.slice(1)}Plot`;

    let body: React.ReactNode;
    if (finance) {
      body = (
        <ChartFinances
          id={chartId}
          height={140}
          timeline={financeSeries(
            finance.key,
            projection.financePast,
            projection.financeProjected,
          )}
          title={finance.label}
          format={finance.format}
          startingYear={game.startingYear}
          domain={projection.domain.x}
          syncKey={SYNC_KEY}
        />
      );
    } else {
      switch (id) {
        case "supplyDemand":
          body = (
            <>
              <ChartForecastSupplyDemand
                height={140}
                timeline={projection.sampled}
                blackouts={projection.blackouts}
                domain={projection.domain}
                startingYear={game.startingYear}
                multiyear={multiyear}
                syncKey={SYNC_KEY}
              />
              {projection.blackoutTotalWh > 0 && (
                <Typography className="insightsWarning" variant="body2">
                  {projection.historical ? (
                    <>
                      Energy not served:{" "}
                      {formatWattHours(projection.blackoutTotalWh)}
                    </>
                  ) : (
                    <>
                      Blackouts forecasted: ~
                      {formatWattHours(projection.blackoutTotalWh)} · peak
                      shortage {formatWatts(projection.largestBlackout.peakW)}
                    </>
                  )}
                </Typography>
              )}
            </>
          );
          break;
        case "demandByType": {
          const demandTypes = demandTypesBySizeAtStart(
            projection.sampled,
            projection.domain.x[0],
          );
          const demandTypeLabels = Object.fromEntries(
            game.loadAdditions.map((addition) => [
              addition.demandType,
              addition.label,
            ]),
          );
          body = (
            <>
              <ChartLegend
                items={demandTypes.map((type) => ({
                  name: demandTypeLabels[type] || type,
                  color: demandTypeColors()[type],
                }))}
              />
              <ChartForecastDemandByType
                height={140}
                timeline={projection.sampled}
                domain={{ x: projection.domain.x }}
                displayTypes={demandTypes}
                typeLabels={demandTypeLabels}
                startingYear={game.startingYear}
                multiyear={multiyear}
                syncKey={SYNC_KEY}
              />
            </>
          );
          break;
        }
        case "supplyByFuel":
          body = (
            <>
              <ChartLegend
                items={[
                  ...[...fuels].reverse().map((fuel) => ({
                    name: fuel,
                    color: fuelColors()[fuel],
                    muted: !!highlightFuel && fuel !== highlightFuel,
                  })),
                  { name: "Demand", color: "", rule: true },
                ]}
              />
              <ChartForecastSupplyByFuel
                height={140}
                timeline={projection.sampled}
                domain={{ x: projection.domain.x }}
                startingYear={game.startingYear}
                multiyear={multiyear}
                fuels={fuels}
                syncKey={SYNC_KEY}
                highlightFuel={highlightFuel}
              />
            </>
          );
          break;
        case "storage":
          body = (
            <ChartForecastStorage
              height={140}
              timeline={projection.sampled}
              domain={{ x: projection.domain.x }}
              startingYear={game.startingYear}
              multiyear={multiyear}
              syncKey={SYNC_KEY}
            />
          );
          break;
        case "fuelPrices":
          body = (
            <>
              <ChartLegend
                items={PRICED_FUELS.map((fuel) => ({
                  name: fuel,
                  color: fuelColors()[fuel],
                  dash: fuelDashArrays[fuel],
                }))}
              />
              <ChartForecastFuelPrices
                height={140}
                timeline={projection.sampled}
                domain={{ x: projection.domain.x }}
                startingYear={game.startingYear}
                multiyear={multiyear}
                syncKey={SYNC_KEY}
              />
            </>
          );
          break;
        case "solarCapacityFactor":
          body = (
            <ChartForecastSolarCapacityFactor
              height={140}
              timeline={projection.timeline}
              domain={{ x: projection.domain.x }}
              startingYear={game.startingYear}
              multiyear={multiyear}
              syncKey={SYNC_KEY}
            />
          );
          break;
        case "water":
          body = (
            <>
              <ChartLegend
                items={[
                  {
                    name: "Precipitation",
                    color: chartPalette().precipitation,
                  },
                  { name: "Snowpack", color: chartPalette().snowpack },
                  { name: "Reservoir", color: chartPalette().reservoir },
                ]}
              />
              <ChartForecastWater
                height={140}
                timeline={projection.sampled}
                domain={{ x: projection.domain.x }}
                startingYear={game.startingYear}
                multiyear={multiyear}
                syncKey={SYNC_KEY}
              />
            </>
          );
          break;
        case "weather":
          body = (
            <ChartForecastWeather
              height={140}
              timeline={projection.timeline}
              domain={{ x: projection.domain.x }}
              startingYear={game.startingYear}
              multiyear={multiyear}
              syncKey={SYNC_KEY}
            />
          );
          break;
        case "financeDetails":
          body = this.renderFinanceDetails(projection);
          break;
        default:
          body = null;
      }
    }

    // Stable wrappers keep existing walkthrough/deep-link targets while the canvas itself gets
    // a unique id per financial layer.
    if (id === "profit") {
      body = <div id="chartFinances">{body}</div>;
    } else if (id === "customers") {
      body = <div id="chartInsightsCustomers">{body}</div>;
    }

    return (
      <section className="insightsTrack" key={id} data-layer={id}>
        <Toolbar className="insightsTrackHeader">
          <Typography variant="h6">{definition.label}</Typography>
          <span className="insightsTrackActions">
            <IconButton
              size="small"
              aria-label={`Move ${definition.label} up`}
              disabled={index === 0}
              onClick={() => this.moveLayer(id, visible[index - 1])}
            >
              <ArrowUpwardIcon fontSize="small" />
            </IconButton>
            <IconButton
              size="small"
              aria-label={`Move ${definition.label} down`}
              disabled={index === visible.length - 1}
              onClick={() => this.moveLayer(id, visible[index + 1])}
            >
              <ArrowDownwardIcon fontSize="small" />
            </IconButton>
            <IconButton
              size="small"
              aria-label={`Remove ${definition.label}`}
              disabled={requiredTutorialLayers(game.scenarioId).includes(id)}
              onClick={() => this.toggleLayer(id)}
            >
              <CloseIcon fontSize="small" />
            </IconButton>
          </span>
        </Toolbar>
        {body}
      </section>
    );
  }

  public render() {
    const { game } = this.props;
    const now = getTimeFromTimeline(game.date.minute, game.timeline);
    if (!now) {
      return <span />;
    }
    const projection = this.getProjection(now);
    const years = playedHistoryYears(game);
    const visible = this.state.layers.filter((id) => {
      const definition = INSIGHT_LAYERS.find((layer) => layer.id === id);
      return !!definition && this.available(definition, projection);
    });

    return (
      <GameCard className="insights" id="insightsPane">
        <div className="scrollable">
          <Toolbar className="paneHeader insightsHeader">
            <Typography variant="h6">Insights</Typography>
            <Select
              id="insightsRange"
              value={this.state.range}
              onChange={(event: SelectChangeEvent<InsightRange>) =>
                this.setRange(event.target.value as InsightRange)
              }
              className="headerControl"
              aria-label="Insight range"
            >
              <MenuItem value="next1">Next 12 months</MenuItem>
              <MenuItem value="next5">Next 5 years</MenuItem>
              <MenuItem value="next10">Next 10 years</MenuItem>
              <MenuItem value="next20">Next 20 years</MenuItem>
              {!!game.monthlyHistory.length && (
                <MenuItem value="all">All recorded</MenuItem>
              )}
              {years.map((year) => (
                <MenuItem value={historyRange(year)} key={year}>
                  {year}
                </MenuItem>
              ))}
            </Select>
            <Select
              id="insightsPreset"
              value={this.state.preset}
              onChange={(event: SelectChangeEvent<InsightPresetId>) => {
                const preset = event.target.value as InsightPresetId;
                if (preset !== "custom") {
                  this.applyPreset(preset);
                }
              }}
              className="insightsPreset"
              aria-label="Insight preset"
            >
              {Object.entries(INSIGHT_PRESETS).map(([id, preset]) => (
                <MenuItem key={id} value={id}>
                  {preset.label}
                </MenuItem>
              ))}
              <MenuItem value="custom" disabled>
                Custom
              </MenuItem>
            </Select>
            <Button
              id="insightsLayersButton"
              className="insightsLayerControls"
              startIcon={<LayersIcon />}
              onClick={() =>
                this.setState({ layersOpen: !this.state.layersOpen })
              }
              aria-expanded={this.state.layersOpen}
            >
              Layers ({visible.length})
            </Button>
          </Toolbar>
          {this.renderLayerPanel(projection)}
          {projection.historical ? (
            <Typography className="insightsHistoryNotice" color="textSecondary">
              Monthly records · forecast-only layers are unavailable
            </Typography>
          ) : (
            this.renderLevers(now)
          )}
          <div className="insightsTracks">
            {visible.map((id, index) =>
              this.renderTrack(id, index, visible, projection),
            )}
            {!visible.length && (
              <Typography className="insightsEmpty" color="textSecondary">
                Choose Layers to build this view.
              </Typography>
            )}
          </div>
        </div>
      </GameCard>
    );
  }
}
