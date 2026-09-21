import * as React from "react";
import CustomerPrograms from "./CustomerPrograms";
import {
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  FormControlLabel,
  IconButton,
  ListSubheader,
  Menu,
  MenuItem,
  Select,
  SelectChangeEvent,
  Slider,
  Table,
  TableBody,
  TableCell,
  TableRow,
  TextField,
  Toolbar,
  Tooltip,
  Typography,
} from "@mui/material";
import ArrowDownwardIcon from "@mui/icons-material/ArrowDownward";
import ArrowUpwardIcon from "@mui/icons-material/ArrowUpward";
import ChevronLeftIcon from "@mui/icons-material/ChevronLeft";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import CloseIcon from "@mui/icons-material/Close";
import AddIcon from "@mui/icons-material/Add";
import MoreVertIcon from "@mui/icons-material/MoreVert";
import FitScreenIcon from "@mui/icons-material/FitScreen";
import SaveIcon from "@mui/icons-material/Save";
import TuneIcon from "@mui/icons-material/Tune";
import WarningAmberIcon from "@mui/icons-material/WarningAmber";
import ZoomInIcon from "@mui/icons-material/ZoomIn";
import ZoomOutIcon from "@mui/icons-material/ZoomOut";
import { TICK_MINUTES } from "../../Constants";
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
  summarizeHistory,
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
  getStorageJson,
  getStorageString,
  setStorageKeyValue,
} from "../../LocalStorage";
import {
  facilitySignature,
  forecastViewportBounds,
  policySignature,
  ProjectionView,
  selectProjection,
} from "../../helpers/Projection";
import { getScenario, SCENARIOS } from "../../data/Scenarios";
import {
  chartPalette,
  demandTypeColors,
  fuelColors,
  fuelDashArrays,
  waterDashArrays,
} from "../../Theme";
import ChartForecastDemandByType, {
  demandTypesBySizeAtStart,
} from "../base/ChartForecastDemandByType";
import ChartFinances from "../base/ChartFinances";
import ChartForecastFuelPrices, {
  PRICED_FUELS,
} from "../base/ChartForecastFuelPrices";
import ChartForecastRenewableCapacityFactor from "../base/ChartForecastRenewableCapacityFactor";
import ChartForecastStorage from "../base/ChartForecastStorage";
import ChartForecastSupplyByFuel, {
  forecastFuels,
} from "../base/ChartForecastSupplyByFuel";
import ChartForecastSupplyDemand from "../base/ChartForecastSupplyDemand";
import ChartForecastWater from "../base/ChartForecastWater";
import ChartForecastWeather from "../base/ChartForecastWeather";
import ChartLegend from "../base/ChartLegend";
import GameCard from "../base/GameCard";
import EconomicFutureComparison from "../base/EconomicFutureComparison";
import { forecastShortfalls } from "../../helpers/ForecastShortfalls";
import { UnitsContext } from "../base/UnitsContext";
import { buildChartKeys, formatCustomerChange } from "./Finances";
import { sampleForecastTimeline } from "../../helpers/ForecastSampling";
import {
  PUBLIC_RATE_POINTS_PER_CENT,
  publicRateYearContribution,
} from "../../helpers/Scoring";
import { ChartAnnotationsContext } from "../base/ChartAnnotationsContext";
import InsightEventRail from "../base/InsightEventRail";
import { UpcomingStoryEventType } from "./StoryEventSelectors";
import {
  ChartViewportContext,
  ChartViewportRange,
  clampChartViewport,
  eventChartViewport,
  panChartViewport,
  rangesEqual,
  zoomChartViewport,
} from "../base/ChartViewportContext";
import PowerExchangeSummary from "../base/PowerExchangeSummary";
import { transmissionAvailable } from "../../data/AdjacentMarkets";

export type InsightLayerId =
  | "supplyDemand"
  | "powerExchange"
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
  | "financeDetails"
  | "inflationInterest";

type LayerGroup = "Grid" | "Customers" | "Economics" | "Environment";

export interface InsightLayerDefinition {
  id: InsightLayerId;
  label: string;
  group: LayerGroup;
  availability?: "storage" | "hydro" | "transmission";
}

export const INSIGHT_LAYERS: readonly InsightLayerDefinition[] = [
  { id: "supplyDemand", label: "Supply & Demand", group: "Grid" },
  {
    id: "powerExchange",
    label: "Power exchange",
    group: "Grid",
    availability: "transmission",
  },
  {
    id: "demandByType",
    label: "Demand by use",
    group: "Customers",
  },
  { id: "supplyByFuel", label: "Supply by Fuel", group: "Grid" },
  {
    id: "storage",
    label: "Stored Energy",
    group: "Grid",
    availability: "storage",
  },
  { id: "customers", label: "Customers", group: "Customers" },
  { id: "profit", label: "Profit", group: "Economics" },
  { id: "revenue", label: "Revenue", group: "Economics" },
  { id: "expenses", label: "Expenses", group: "Economics" },
  { id: "cash", label: "Cash", group: "Economics" },
  { id: "financeDetails", label: "Finance details", group: "Economics" },
  { id: "fuelPrices", label: "Fuel Prices", group: "Economics" },
  {
    id: "inflationInterest",
    label: "Inflation & interest rate",
    group: "Economics",
  },
  {
    id: "emissions",
    label: "Emissions (CO2e)",
    group: "Environment",
  },
  {
    id: "solarCapacityFactor",
    label: "Renewable output",
    group: "Environment",
  },
  { id: "weather", label: "Temperature", group: "Environment" },
  { id: "water", label: "Water", group: "Environment", availability: "hydro" },
] as const;

export type DefaultInsightPresetId =
  "overview" | "reliability" | "profitability" | "growth" | "decarbonization";

export type InsightPresetId =
  DefaultInsightPresetId | "custom" | `saved:${string}`;

export interface CustomInsightPreset {
  id: string;
  name: string;
  layers: InsightLayerId[];
}

interface InsightPresetLibrary {
  defaults: Partial<Record<DefaultInsightPresetId, InsightLayerId[]>>;
  custom: CustomInsightPreset[];
}

export const INSIGHT_PRESETS: Record<
  DefaultInsightPresetId,
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
    layers: [
      "supplyDemand",
      "powerExchange",
      "supplyByFuel",
      "storage",
      "weather",
      "water",
    ],
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
    label: "Cutting emissions",
    layers: [
      "emissions",
      "supplyByFuel",
      "supplyDemand",
      "fuelPrices",
      "profit",
    ],
  },
};

const LAYERS_KEY = "insightsLayers";
const ACTIVE_PRESET_KEY = "insightsActivePreset";
const PRESET_LIBRARY_KEY = "insightsPresetLibrary";
export const MAX_CUSTOM_INSIGHT_PRESETS = 10;
const MAX_PRESET_NAME_LENGTH = 40;
const SYNC_KEY = "insights";
const GROUPS: LayerGroup[] = ["Grid", "Customers", "Economics", "Environment"];
const ALL_LAYER_IDS = new Set(INSIGHT_LAYERS.map((layer) => layer.id));

function formatRateCompact(rate: number): string {
  return `${Number((rate * 100).toFixed(1))}¢`;
}

function rateMarkLabel(
  rate: number,
  desktopLabel = formatMoneyConcise(rate),
  mobileLabel = "",
) {
  return (
    <>
      <span className="insightsRateMarkDesktop">{desktopLabel}</span>
      <span className="insightsRateMarkMobile">{mobileLabel}</span>
    </>
  );
}

function formatRateScore(points: number): string {
  return `${points > 0 ? "+" : points < 0 ? "−" : "±"}${Math.abs(points).toLocaleString("en-US")} pts`;
}

export interface StateProps {
  savedViewport?: SavedViewport;
  evidenceRequest?: import("../../Types").EvidenceRequestType;
  evidenceRunId?: number;
  activeCard?: import("../../Types").CardNameType;
  game: GameType;
  selectedFacilityId: number | null;
  facilityDragActive: boolean;
  focusLayer?: InsightLayerId;
  upcomingEvents?: UpcomingStoryEventType[];
}

export interface DispatchProps {
  onViewportChange?: (saved: SavedViewport) => void;
  onEvidenceReady?: (
    request: import("../../Types").EvidenceRequestType,
    element: HTMLElement | null,
  ) => void;
  onDelta: (delta: Partial<GameType>) => void;
}

export interface Props extends StateProps, DispatchProps {}

type SavedViewport = { viewport: [number, number]; month: number };

interface State {
  compact: boolean;
  temporaryLayer?: InsightLayerId;
  layers: InsightLayerId[];
  preset: InsightPresetId;
  presetDirty: boolean;
  presetLibrary: InsightPresetLibrary;
  presetMenuAnchor: HTMLElement | null;
  presetDialog: "saveAs" | "rename" | "delete" | "restore" | null;
  presetName: string;
  presetNameError: string;
  layersOpen: boolean;
  leversOpen: boolean;
  activeEventKey?: string;
  viewport: ChartViewportRange;
  viewportAnnouncement: string;
}

const VIEWPORT_ZOOM_FACTOR = 0.5;
const VIEWPORT_PAN_FRACTION = 0.25;

function scenarioEndMinute(game: GameType): number | undefined {
  const months = getScenario(
    game.scenarioId,
    game.customScenario,
  )?.durationMonths;
  return months ? months * MINUTES_PER_MONTH : undefined;
}

// The whole run is the question the player is answering, so open on scenario start to end.
function initialViewport(game: GameType): ChartViewportRange {
  const bounds = forecastViewportBounds(game);
  return clampChartViewport(
    bounds,
    [bounds[0], scenarioEndMinute(game) ?? bounds[1]],
    MINUTES_PER_MONTH,
  );
}

// A range pinned to scenario start or end keeps that edge as months pass; any other edge slides
// with the calendar so a zoomed "next few months" window stays ahead of the player.
function advanceViewport(
  game: GameType,
  viewport: ChartViewportRange,
  elapsedMonths: number,
): ChartViewportRange {
  const bounds = forecastViewportBounds(game);
  const delta = elapsedMonths * MINUTES_PER_MONTH;
  const end = scenarioEndMinute(game);
  return clampChartViewport(
    bounds,
    [
      viewport[0] === bounds[0] ? bounds[0] : viewport[0] + delta,
      viewport[1] === end ? end : viewport[1] + delta,
    ],
    MINUTES_PER_MONTH,
  );
}

function viewportLabel(
  range: ChartViewportRange,
  startingYear: number,
): string {
  const start = getDateFromMinute(range[0], startingYear);
  // The end is exclusive: a range to 1 Jan 2032 covers the scenario years 2020–31.
  const end = getDateFromMinute(Math.max(range[0], range[1] - 1), startingYear);
  if (start.year !== end.year) {
    const sameCentury =
      Math.floor(start.year / 100) === Math.floor(end.year / 100);
    const endYear = sameCentury ? String(end.year).slice(-2) : end.year;
    return `${start.year}–${endYear}`;
  }
  if (start.month === end.month) return `${start.month} ${start.year}`;
  return `${start.month}–${end.month} ${start.year}`;
}

function viewportAnnouncement(
  range: ChartViewportRange,
  startingYear: number,
): string {
  return `Showing ${viewportLabel(range, startingYear)}`;
}

function timelineWithin(
  timeline: TickPresentFutureType[],
  range: ChartViewportRange,
): TickPresentFutureType[] {
  if (timeline.length <= 2) return timeline;
  let first = 0;
  let last = timeline.length;
  while (first < last) {
    const middle = Math.floor((first + last) / 2);
    if (timeline[middle].minute < range[0]) first = middle + 1;
    else last = middle;
  }
  const from = Math.max(0, first - 1);
  first = from;
  last = timeline.length;
  while (first < last) {
    const middle = Math.floor((first + last) / 2);
    if (timeline[middle].minute <= range[1]) first = middle + 1;
    else last = middle;
  }
  return timeline.slice(from, Math.min(timeline.length, first + 1));
}

function sameLayers(left: InsightLayerId[], right: InsightLayerId[]): boolean {
  return (
    left.length === right.length &&
    left.every((layer, index) => layer === right[index])
  );
}

function validLayers(value: unknown): InsightLayerId[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter(
    (id, index): id is InsightLayerId =>
      typeof id === "string" &&
      ALL_LAYER_IDS.has(id as InsightLayerId) &&
      value.indexOf(id) === index,
  );
}

function storedPresetLibrary(): InsightPresetLibrary {
  const stored = getStorageJson<{
    defaults?: Partial<Record<DefaultInsightPresetId, unknown>>;
    custom?: unknown[];
  }>(PRESET_LIBRARY_KEY, {});
  const defaults: InsightPresetLibrary["defaults"] = {};
  for (const id of Object.keys(INSIGHT_PRESETS) as DefaultInsightPresetId[]) {
    const layers = validLayers(stored.defaults?.[id]);
    if (layers.length) {
      defaults[id] = layers;
    }
  }

  const names = new Set<string>();
  const ids = new Set<string>();
  const custom: CustomInsightPreset[] = [];
  for (const value of stored.custom || []) {
    if (!value || typeof value !== "object") {
      continue;
    }
    const candidate = value as Partial<CustomInsightPreset>;
    const id = typeof candidate.id === "string" ? candidate.id : "";
    const name =
      typeof candidate.name === "string" ? candidate.name.trim() : "";
    const layers = validLayers(candidate.layers);
    const normalizedName = name.toLocaleLowerCase();
    if (
      !id ||
      !name ||
      name.length > MAX_PRESET_NAME_LENGTH ||
      !layers.length ||
      ids.has(id) ||
      names.has(normalizedName)
    ) {
      continue;
    }
    ids.add(id);
    names.add(normalizedName);
    custom.push({ id, name, layers });
    if (custom.length === MAX_CUSTOM_INSIGHT_PRESETS) {
      break;
    }
  }
  return { defaults, custom };
}

function presetDefinition(
  id: InsightPresetId,
  library: InsightPresetLibrary,
): { label: string; layers: InsightLayerId[] } | undefined {
  if (id === "custom") {
    return undefined;
  }
  if (id.startsWith("saved:")) {
    const saved = library.custom.find(
      (preset) => preset.id === id.slice("saved:".length),
    );
    return saved ? { label: saved.name, layers: saved.layers } : undefined;
  }
  const defaultPreset = INSIGHT_PRESETS[id as DefaultInsightPresetId];
  return defaultPreset
    ? {
        label: defaultPreset.label,
        layers:
          library.defaults[id as DefaultInsightPresetId] ||
          defaultPreset.layers,
      }
    : undefined;
}

function matchingPreset(
  layers: InsightLayerId[],
  library: InsightPresetLibrary,
): InsightPresetId {
  for (const id of Object.keys(INSIGHT_PRESETS) as DefaultInsightPresetId[]) {
    if (sameLayers(layers, presetDefinition(id, library)!.layers)) {
      return id;
    }
  }
  const custom = library.custom.find((preset) =>
    sameLayers(layers, preset.layers),
  );
  return custom ? `saved:${custom.id}` : "custom";
}

function isStoredPreset(
  id: string,
  library: InsightPresetLibrary,
): id is InsightPresetId {
  return !!presetDefinition(id as InsightPresetId, library);
}

function nextCustomPresetId(custom: CustomInsightPreset[]): string {
  return String(
    custom.reduce((highest, preset) => {
      const numericId = Number(preset.id);
      return Number.isInteger(numericId)
        ? Math.max(highest, numericId)
        : highest;
    }, 0) + 1,
  );
}

function storedLayers(): InsightLayerId[] {
  const valid = validLayers(getStorageJson<string[]>(LAYERS_KEY, []));
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
    case 112:
      return ["powerExchange"];
    default:
      return [];
  }
}

export function withRequiredLayers(
  layers: InsightLayerId[],
  scenarioId: number,
): InsightLayerId[] {
  if (scenarioId === 112) {
    return ["powerExchange", ...layers.filter((id) => id !== "powerExchange")];
  }
  const next = [...layers];
  for (const id of requiredTutorialLayers(scenarioId)) {
    if (!next.includes(id)) {
      next.push(id);
    }
  }
  return next;
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
  domain?: ChartViewportRange,
  startingYear?: number,
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
  const points = [
    ...[...past].reverse().map((month) => point(month, false)),
    ...projected.map((month) => point(month, true)),
  ];
  if (!domain || startingYear === undefined || points.length <= 2)
    return points;
  const minutes = points.map(
    (value) => (value.month - startingYear * 12 - 1) * MINUTES_PER_MONTH,
  );
  const firstInside = minutes.findIndex((minute) => minute >= domain[0]);
  const first =
    firstInside < 0 ? points.length - 1 : Math.max(0, firstInside - 1);
  const firstAfter = minutes.findIndex((minute) => minute > domain[1]);
  const end = firstAfter < 0 ? points.length : firstAfter + 1;
  return points.slice(first, Math.max(first + 1, Math.min(points.length, end)));
}

export default class Insights extends React.Component<Props, State> {
  static contextType = UnitsContext;

  private paneRef = React.createRef<HTMLDivElement>();
  private paneObserver?: ResizeObserver;

  private shortfallCache:
    | {
        projection: ProjectionView;
        range: ChartViewportRange;
        shortfall: ProjectionView["shortfall"];
      }
    | undefined;

  constructor(props: Props) {
    super(props);
    const presetLibrary = storedPresetLibrary();
    const layers = storedLayers();
    const storedPreset = getStorageString(ACTIVE_PRESET_KEY, "");
    const preset = isStoredPreset(storedPreset, presetLibrary)
      ? storedPreset
      : matchingPreset(layers, presetLibrary);
    const savedLayers = presetDefinition(preset, presetLibrary)?.layers;
    this.state = {
      compact: false,
      temporaryLayer: props.focusLayer,
      layers,
      preset,
      presetDirty: !savedLayers || !sameLayers(layers, savedLayers),
      presetLibrary,
      presetMenuAnchor: null,
      presetDialog: null,
      presetName: "",
      presetNameError: "",
      layersOpen: false,
      leversOpen: true,
      activeEventKey: undefined,
      viewport: props.savedViewport
        ? this.restoredViewport(props.savedViewport)
        : initialViewport(props.game),
      viewportAnnouncement: "",
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
      nextProps.evidenceRequest !== this.props.evidenceRequest ||
      nextProps.evidenceRunId !== this.props.evidenceRunId ||
      nextProps.activeCard !== this.props.activeCard ||
      nextProps.game.tutorialStep !== this.props.game.tutorialStep ||
      nextProps.game.date.monthsElapsed !==
        this.props.game.date.monthsElapsed ||
      (this.state.layers.includes("powerExchange") &&
        (nextProps.game.date.minute !== this.props.game.date.minute ||
          nextProps.game.speed !== this.props.game.speed)) ||
      nextProps.game.dollarsPerkWh !== this.props.game.dollarsPerkWh ||
      nextProps.game.feePerKgCO2e !== this.props.game.feePerKgCO2e ||
      nextProps.selectedFacilityId !== this.props.selectedFacilityId ||
      nextProps.focusLayer !== this.props.focusLayer ||
      nextProps.upcomingEvents !== this.props.upcomingEvents ||
      policySignature(nextProps.game) !== policySignature(this.props.game) ||
      facilitySignature(nextProps.game) !== facilitySignature(this.props.game)
    );
  }

  public componentWillUnmount() {
    this.paneObserver?.disconnect();
  }

  public componentDidMount() {
    const pane = this.paneRef.current;
    if (pane && typeof ResizeObserver !== "undefined") {
      const measure = () => {
        const compact = pane.getBoundingClientRect().width <= 700;
        if (compact !== this.state.compact) this.setState({ compact });
      };
      measure();
      this.paneObserver = new ResizeObserver(measure);
      this.paneObserver.observe(pane);
    }
    this.scrollTutorialPowerExchangeIntoView();
    this.resolveEvidence();
  }

  public componentDidUpdate(previousProps: Props, previousState: State) {
    if (this.state.viewport !== previousState.viewport) {
      this.props.onViewportChange?.({
        viewport: [...this.state.viewport],
        month: this.props.game.date.monthsElapsed,
      });
    }
    if (
      this.props.evidenceRunId !== previousProps.evidenceRunId ||
      (this.props.activeCard !== previousProps.activeCard &&
        !this.props.evidenceRequest)
    ) {
      if (this.state.temporaryLayer)
        this.setState({ temporaryLayer: undefined });
    }
    this.resolveEvidence();
    if (this.props.game.tutorialStep !== previousProps.game.tutorialStep) {
      this.scrollTutorialPowerExchangeIntoView();
    }
    if (
      this.props.game.date.monthsElapsed !==
      previousProps.game.date.monthsElapsed
    ) {
      const elapsedMonths =
        this.props.game.date.monthsElapsed -
        previousProps.game.date.monthsElapsed;
      this.setState((state) => {
        const viewport = advanceViewport(
          this.props.game,
          state.viewport,
          elapsedMonths,
        );
        return {
          viewport,
          viewportAnnouncement: viewportAnnouncement(
            viewport,
            this.props.game.startingYear,
          ),
        };
      });
    }
    if (
      this.props.focusLayer &&
      this.props.focusLayer !== previousProps.focusLayer &&
      !this.state.layers.includes(this.props.focusLayer)
    ) {
      this.setState({ temporaryLayer: this.props.focusLayer });
    }
  }

  private restoredViewport(origin: SavedViewport): ChartViewportRange {
    return advanceViewport(
      this.props.game,
      origin.viewport,
      this.props.game.date.monthsElapsed - origin.month,
    );
  }

  private resolveEvidence() {
    const request = this.props.evidenceRequest;
    if (!request || this.props.facilityDragActive) return;
    const target = request.target;
    let layer: InsightLayerId | undefined;
    if (target === "finances") layer = "financeDetails";
    else if (typeof target === "object" && target.card === "INSIGHTS") {
      layer =
        target.layer === "FINANCES"
          ? "financeDetails"
          : target.layer === "FUEL_PRICES"
            ? "fuelPrices"
            : "supplyDemand";
    }
    if (!layer) return;
    if (
      !this.state.layers.includes(layer) &&
      this.state.temporaryLayer !== layer
    ) {
      this.setState({ temporaryLayer: layer });
      return;
    }
    this.props.onEvidenceReady?.(
      request,
      document.querySelector<HTMLElement>(`[data-layer="${layer}"]`),
    );
  }

  private scrollTutorialPowerExchangeIntoView() {
    if (
      this.props.game.scenarioId !== 112 ||
      this.props.game.tutorialStep !== 7 ||
      window.innerWidth > 768
    ) {
      return;
    }
    window.setTimeout(() => {
      document
        .querySelector<HTMLElement>('[data-layer="powerExchange"]')
        ?.scrollIntoView?.({ block: "nearest" });
    }, 0);
  }

  private setLayers(
    layers: InsightLayerId[],
    preset: InsightPresetId = this.state.preset,
  ) {
    const required = layers;
    const savedLayers = presetDefinition(
      preset,
      this.state.presetLibrary,
    )?.layers;
    // Mission 7 temporarily puts its teaching track first. Keep that guided ordering out of the
    // player's saved preset so finishing the mission does not rearrange their normal Insights.
    if (this.props.game.scenarioId !== 112) {
      setStorageKeyValue(LAYERS_KEY, required);
      setStorageKeyValue(ACTIVE_PRESET_KEY, preset);
    }
    this.setState({
      temporaryLayer: undefined,
      layers: required,
      preset,
      presetDirty: !savedLayers || !sameLayers(required, savedLayers),
    });
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
    const preset = presetDefinition(id, this.state.presetLibrary);
    if (!preset) {
      return;
    }
    const layers = [...preset.layers];
    if (this.props.game.scenarioId !== 112) {
      setStorageKeyValue(LAYERS_KEY, layers);
      setStorageKeyValue(ACTIVE_PRESET_KEY, id);
    }
    this.setState({
      layers,
      preset: id,
      presetDirty: false,
      temporaryLayer: undefined,
    });
  }

  private moveLayer(id: InsightLayerId, neighbour: InsightLayerId) {
    const layers = [...this.state.layers];
    const from = layers.indexOf(id);
    const to = layers.indexOf(neighbour);
    if (from < 0 || to < 0) {
      // An explicit edit ends temporary evidence, but never adds an unconfigured chart.
      this.setLayers(layers);
      return;
    }
    [layers[from], layers[to]] = [layers[to], layers[from]];
    this.setLayers(layers);
  }

  private savePresetLibrary(library: InsightPresetLibrary) {
    setStorageKeyValue(PRESET_LIBRARY_KEY, library);
  }

  private selectedCustomPreset(): CustomInsightPreset | undefined {
    if (!this.state.preset.startsWith("saved:")) {
      return undefined;
    }
    return this.state.presetLibrary.custom.find(
      (preset) => preset.id === this.state.preset.slice("saved:".length),
    );
  }

  private savePresetChanges() {
    const { layers, preset, presetLibrary } = this.state;
    if (!layers.length || preset === "custom") {
      this.openPresetDialog("saveAs");
      return;
    }

    let library: InsightPresetLibrary;
    if (preset.startsWith("saved:")) {
      const id = preset.slice("saved:".length);
      library = {
        ...presetLibrary,
        custom: presetLibrary.custom.map((saved) =>
          saved.id === id ? { ...saved, layers: [...layers] } : saved,
        ),
      };
    } else {
      const defaultId = preset as DefaultInsightPresetId;
      const defaults = { ...presetLibrary.defaults };
      if (sameLayers(layers, INSIGHT_PRESETS[defaultId].layers)) {
        delete defaults[defaultId];
      } else {
        defaults[defaultId] = [...layers];
      }
      library = { ...presetLibrary, defaults };
    }
    this.savePresetLibrary(library);
    setStorageKeyValue(ACTIVE_PRESET_KEY, preset);
    this.setState({ presetLibrary: library, presetDirty: false });
  }

  private openPresetDialog(dialog: Exclude<State["presetDialog"], null>) {
    const selected = this.selectedCustomPreset();
    this.setState({
      presetMenuAnchor: null,
      presetDialog: dialog,
      presetName: dialog === "rename" ? selected?.name || "" : "",
      presetNameError: "",
    });
  }

  private closePresetDialog() {
    this.setState({
      presetDialog: null,
      presetName: "",
      presetNameError: "",
    });
  }

  private validatedPresetName(excludeId?: string): string | null {
    const name = this.state.presetName.trim();
    if (!name) {
      this.setState({ presetNameError: "Enter a name." });
      return null;
    }
    const duplicateDefault = Object.values(INSIGHT_PRESETS).some(
      (preset) => preset.label.toLocaleLowerCase() === name.toLocaleLowerCase(),
    );
    const duplicateCustom = this.state.presetLibrary.custom.some(
      (preset) =>
        preset.id !== excludeId &&
        preset.name.toLocaleLowerCase() === name.toLocaleLowerCase(),
    );
    if (duplicateDefault || duplicateCustom) {
      this.setState({ presetNameError: "That name is already in use." });
      return null;
    }
    return name;
  }

  private createCustomPreset() {
    if (
      !this.state.layers.length ||
      this.state.presetLibrary.custom.length >= MAX_CUSTOM_INSIGHT_PRESETS
    ) {
      return;
    }
    const name = this.validatedPresetName();
    if (!name) {
      return;
    }
    const id = nextCustomPresetId(this.state.presetLibrary.custom);
    const preset: CustomInsightPreset = {
      id,
      name,
      layers: [...this.state.layers],
    };
    const library = {
      ...this.state.presetLibrary,
      custom: [...this.state.presetLibrary.custom, preset],
    };
    const presetId = `saved:${id}` as const;
    this.savePresetLibrary(library);
    setStorageKeyValue(ACTIVE_PRESET_KEY, presetId);
    this.setState({
      presetLibrary: library,
      preset: presetId,
      presetDirty: false,
      presetDialog: null,
      presetName: "",
      presetNameError: "",
    });
  }

  private renameCustomPreset() {
    const selected = this.selectedCustomPreset();
    if (!selected) {
      return;
    }
    const name = this.validatedPresetName(selected.id);
    if (!name) {
      return;
    }
    const library = {
      ...this.state.presetLibrary,
      custom: this.state.presetLibrary.custom.map((preset) =>
        preset.id === selected.id ? { ...preset, name } : preset,
      ),
    };
    this.savePresetLibrary(library);
    this.setState({
      presetLibrary: library,
      presetDialog: null,
      presetName: "",
      presetNameError: "",
    });
  }

  private deleteCustomPreset() {
    const selected = this.selectedCustomPreset();
    if (!selected) {
      return;
    }
    const library = {
      ...this.state.presetLibrary,
      custom: this.state.presetLibrary.custom.filter(
        (preset) => preset.id !== selected.id,
      ),
    };
    this.savePresetLibrary(library);
    setStorageKeyValue(ACTIVE_PRESET_KEY, "custom");
    this.setState({
      presetLibrary: library,
      preset: "custom",
      presetDirty: true,
      presetDialog: null,
    });
  }

  private restoreDefaultPreset() {
    const { preset, presetLibrary } = this.state;
    if (preset === "custom" || preset.startsWith("saved:")) {
      return;
    }
    const defaultId = preset as DefaultInsightPresetId;
    const defaults = { ...presetLibrary.defaults };
    delete defaults[defaultId];
    const library = { ...presetLibrary, defaults };
    const layers = [...INSIGHT_PRESETS[defaultId].layers];
    this.savePresetLibrary(library);
    setStorageKeyValue(LAYERS_KEY, layers);
    setStorageKeyValue(ACTIVE_PRESET_KEY, preset);
    this.setState({
      presetLibrary: library,
      temporaryLayer: undefined,
      layers,
      presetDirty: false,
      presetDialog: null,
    });
  }

  /**
   * The game's long-range forecast, shared with the top bar's runway warning through the
   * memoized helper: one simulation per set of inputs, read by both callers.
   */
  private getProjection(now: TickPresentFutureType): ProjectionView {
    return selectProjection(this.props.game, now);
  }

  private available(layer: InsightLayerDefinition, projection: ProjectionView) {
    return (
      !layer.availability ||
      (layer.availability === "storage" && projection.hasStorage) ||
      (layer.availability === "hydro" && projection.hasHydro) ||
      (layer.availability === "transmission" &&
        transmissionAvailable(this.props.game.location) &&
        !!this.props.game.transmission?.lines.some(
          ({ yearsToBuildLeft }) => yearsToBuildLeft <= 0,
        ))
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
    const investor = scenario.ownership === "Investor";
    // A public utility's customers never switch and its growth is fixed, so the market rate
    // changes nothing it can act on. What the rate does move is the score, against the
    // scenario's own target.
    const targetRate = scenario.dollarsPerkWh;
    const max = investor
      ? Math.max(0.05, Math.ceil(marketRate * 200) / 100, game.dollarsPerkWh)
      : Math.max(0.3, Math.ceil(targetRate * 150) / 100, game.dollarsPerkWh);
    // The final score decomposes exactly into a supply-weighted sum over the years played, so
    // what a rate is worth is the coming year's own term of that sum: the distance from the
    // target, times how much of the lifetime energy the coming year makes up. Always a full
    // year, even near the end of a run, so the figure means the same thing every time. The
    // sign is the sign of target minus rate: a rate above target reads as a loss every year it
    // is in force, no matter what the lifetime average did last period.
    const upcoming = investor
      ? []
      : this.getProjection(now).financeProjected.slice(0, 12);
    const pastTotals = summarizeHistory(game.monthlyHistory);
    const nextSupplyWh = upcoming.reduce((sum, m) => sum + m.supplyWh, 0);
    const rateScore = (rate: number) =>
      publicRateYearContribution(
        targetRate,
        pastTotals,
        { supplyWh: nextSupplyWh },
        rate,
      );
    const formattedRateScore = formatRateScore(rateScore(game.dollarsPerkWh));
    const marks = investor
      ? [
          { value: 0, label: rateMarkLabel(0, "$0", "0¢") },
          {
            value: marketRate,
            label: rateMarkLabel(
              marketRate,
              `${formatMoneyConcise(marketRate)} market`,
              `market ${formatRateCompact(marketRate)}`,
            ),
          },
          {
            value: max,
            label: rateMarkLabel(
              max,
              formatMoneyConcise(max),
              formatRateCompact(max),
            ),
          },
        ]
      : [
          { value: 0, label: rateMarkLabel(0, "$0", "0¢") },
          {
            value: targetRate,
            label: rateMarkLabel(
              targetRate,
              `${formatMoneyConcise(targetRate)} target`,
              `target ${formatRateCompact(targetRate)}`,
            ),
          },
          {
            value: max,
            label: rateMarkLabel(
              max,
              formatMoneyConcise(max),
              formatRateCompact(max),
            ),
          },
        ];
    const formattedCustomerChange = formatCustomerChange(
      customerChange,
      now.customers,
    );
    const rateSummary = investor
      ? `Rate ${formatMoneyConcise(game.dollarsPerkWh)} per kilowatt hour; market rate ${formatMoneyConcise(marketRate)}; projected customers ${formattedCustomerChange} next month.`
      : `Rate ${formatMoneyConcise(game.dollarsPerkWh)} per kilowatt hour; target ${formatMoneyConcise(targetRate)}; rate score ${formattedRateScore} over the next year at this rate. You earn ${PUBLIC_RATE_POINTS_PER_CENT} points for each cent below the target and lose ${PUBLIC_RATE_POINTS_PER_CENT} for each cent above it, weighted by the coming year's share of lifetime sales.`;
    const rateScoreClass = `insightsRateScore ${
      rateScore(game.dollarsPerkWh) > 0
        ? "good"
        : rateScore(game.dollarsPerkWh) < 0
          ? "bad"
          : ""
    }`;
    return (
      <section className="insightsLevers" aria-label="Planning controls">
        <Button
          className="insightsRateToggle"
          startIcon={<TuneIcon />}
          onClick={() => this.setState({ leversOpen: !this.state.leversOpen })}
          aria-expanded={this.state.leversOpen}
          aria-controls="rateSliderControl"
          aria-label={`${this.state.leversOpen ? "Hide" : "Show"} rate slider`}
          aria-describedby="insightsRateSummary"
        >
          <span className="insightsRateToggleLabel">Rate controls</span>
        </Button>
        <Typography
          className="insightsRateSummaryDesktop"
          variant="body2"
          color="textSecondary"
          aria-hidden="true"
        >
          Your rate{" "}
          <strong>{formatMoneyConcise(game.dollarsPerkWh)}/kWh</strong>
          {investor ? (
            <>
              {" "}
              · market {formatMoneyConcise(marketRate)} · projected customers{" "}
              <strong>{formattedCustomerChange}</strong> next month
            </>
          ) : (
            <>
              {" "}
              · target {formatMoneyConcise(targetRate)} · rate score{" "}
              <strong className={rateScoreClass}>
                {formattedRateScore}/yr
              </strong>{" "}
              ({PUBLIC_RATE_POINTS_PER_CENT} pts per 1¢ below target, weighted
              by energy sold)
            </>
          )}
        </Typography>
        <div className="insightsRateMetrics" aria-hidden="true">
          <span className="insightsRateMetric">
            <span className="insightsRateMetricLabel">Your rate</span>
            <strong className="insightsRateMetricValue">
              {formatRateCompact(game.dollarsPerkWh)}/kWh
            </strong>
          </span>
          <span className="insightsRateMetric">
            <span className="insightsRateMetricLabel">
              {investor ? "Market" : "Target"}
            </span>
            <span className="insightsRateMetricValue">
              {formatRateCompact(investor ? marketRate : targetRate)}
            </span>
          </span>
          {investor ? (
            <span className="insightsRateMetric">
              <span className="insightsRateMetricLabel">Customers / mo</span>
              <strong className="insightsRateMetricValue">
                {formattedCustomerChange}
              </strong>
            </span>
          ) : (
            <span className="insightsRateMetric">
              <span className="insightsRateMetricLabel">Points / yr</span>
              <strong className={`insightsRateMetricValue ${rateScoreClass}`}>
                {formattedRateScore}
              </strong>
            </span>
          )}
        </div>
        <span id="insightsRateSummary" className="srOnly">
          {rateSummary}
        </span>
        {(game.policies?.programs.timeOfUse?.tier !== "Off" ||
          game.policies?.programs.curtailment?.tier !== "Off") &&
          game.policies && (
            <Typography variant="caption">
              Active programs adjust this rate.
            </Typography>
          )}
        <div
          className={`budgetSlider flex-newline ${
            this.state.leversOpen ? "" : "insightsRateSliderCollapsed"
          }`}
          id="rateSliderControl"
          data-testid="rate-slider-control"
        >
          <Slider
            // Keep the thumb local while it is moving. Dispatching every pointer step makes
            // the entire workbench reconcile and regenerate its long-range projection before
            // the browser can paint the next thumb position. The committed rate remounts this
            // uncontrolled slider through its key, so external changes still stay in sync.
            key={game.dollarsPerkWh}
            id="rateSlider"
            disabled={!!game.replayPlayback}
            defaultValue={game.dollarsPerkWh}
            aria-label="The rate you charge for electricity generation"
            valueLabelDisplay="auto"
            valueLabelFormat={(rate) =>
              investor
                ? `${formatMoneyConcise(rate)}/kWh`
                : `${formatMoneyConcise(rate)}/kWh · ${formatRateScore(rateScore(rate))}/yr`
            }
            getAriaValueText={(rate) =>
              investor
                ? `${formatMoneyConcise(rate)} per kilowatt hour`
                : `${formatMoneyConcise(rate)} per kilowatt hour, rate score ${formatRateScore(rateScore(rate))} over the next year`
            }
            marks={marks}
            min={0}
            step={investor ? 0.001 : 0.01}
            max={max}
            onChangeCommitted={(_event, value) =>
              onDelta({
                dollarsPerkWh: Array.isArray(value) ? value[0] : value,
              })
            }
          />
        </div>
        <CustomerPrograms
          game={game}
          onViewDemand={() => this.setLayers(["demandByType"])}
        />
      </section>
    );
  }

  private renderLayerPanel(projection: ProjectionView) {
    if (!this.state.layersOpen) {
      return null;
    }
    const required = requiredTutorialLayers(this.props.game.scenarioId);
    return (
      <section
        id="insightsLayerPanel"
        className="insightsLayerPanel"
        aria-label="Data layers"
      >
        {GROUPS.map((group) => {
          const layers = INSIGHT_LAYERS.filter(
            (layer) =>
              layer.group === group && this.available(layer, projection),
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
                      disabled={required.includes(layer.id)}
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
        {selected && lifetime && (
          <div className="selectedFacilitySummary">
            <strong>{selected.name}</strong>: {formatWattHours(lifetime.wh)}{" "}
            delivered · {formatMoneyConcise(lifetime.profit)} profit
          </div>
        )}
        <Table size="small" className="insightsSummaryTable">
          <TableBody>
            {Object.entries(buildChartKeys(units)).map(([key, metadata]) => {
              const value =
                key === "interestRate"
                  ? getTimeFromTimeline(game.date.minute, game.timeline)!
                      .interestRate
                  : summary[key as DerivedHistoryKeysType];
              return (
                <TableRow key={key}>
                  <TableCell sx={{ pl: 2 + (metadata.nesting || 0) * 2 }}>
                    {key === "interestRate"
                      ? "Current interest rate"
                      : metadata.label}
                  </TableCell>
                  <TableCell align="right">
                    {(metadata.formatTable || metadata.format)(value)}
                    {metadata.suffix ? " " + metadata.suffix : ""}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </>
    );
  }

  // Counts only simulated hours inside the displayed range: recorded months are averages, and a
  // range wholly in the past has no forecast to report.
  private rangeShortfall(
    projection: ProjectionView,
    range: ChartViewportRange,
  ): ProjectionView["shortfall"] {
    const cached = this.shortfallCache;
    if (cached?.projection === projection && rangesEqual(cached.range, range)) {
      return cached.shortfall;
    }
    const forecast = projection.forecast.filter(
      (tick) => tick.minute >= range[0] && tick.minute < range[1],
    );
    const { blackoutTotalWh, peakW } = forecastShortfalls(
      forecast,
      projection.projectionStepMinutes,
      0,
    );
    const shortfall =
      blackoutTotalWh > 0
        ? {
            wh: blackoutTotalWh,
            peakW,
            label: viewportLabel(range, this.props.game.startingYear),
          }
        : undefined;
    this.shortfallCache = { projection, range, shortfall };
    return shortfall;
  }

  private setViewport(
    bounds: ChartViewportRange,
    minSpan: number,
    next: ChartViewportRange,
    announce = true,
  ) {
    const clamped = clampChartViewport(bounds, next, minSpan);
    this.setState({
      viewport: clamped,
      viewportAnnouncement: announce
        ? viewportAnnouncement(clamped, this.props.game.startingYear)
        : this.state.viewportAnnouncement,
    });
  }

  private renderViewportControls(
    bounds: ChartViewportRange,
    range: ChartViewportRange,
    minSpan: number,
  ) {
    const full = rangesEqual(bounds, range);
    const span = range[1] - range[0];
    const rangeLabel = viewportLabel(range, this.props.game.startingYear);
    const setRange = (next: ChartViewportRange) =>
      this.setViewport(bounds, minSpan, next);
    const iconButton = (
      label: string,
      icon: React.ReactNode,
      disabled: boolean,
      onClick: () => void,
    ) => (
      <Tooltip title={label}>
        <span className="insightsViewportButton">
          <IconButton
            size="small"
            aria-label={label}
            disabled={disabled}
            onClick={onClick}
          >
            {icon}
          </IconButton>
        </span>
      </Tooltip>
    );
    return (
      <section
        className="insightsViewportToolbar"
        aria-label="Chart time navigation"
        aria-describedby="insightsViewportHint"
      >
        <Typography
          className="insightsViewportDate"
          variant="body2"
          aria-label={`Displayed date range: ${rangeLabel}`}
        >
          {rangeLabel}
        </Typography>
        <div className="insightsViewportButtons">
          {iconButton(
            "Pan earlier",
            <ChevronLeftIcon />,
            full || range[0] <= bounds[0],
            () =>
              setRange(
                panChartViewport(
                  bounds,
                  range,
                  minSpan,
                  -span * VIEWPORT_PAN_FRACTION,
                ),
              ),
          )}
          {iconButton("Zoom out", <ZoomOutIcon />, full, () =>
            setRange(
              zoomChartViewport(
                bounds,
                range,
                minSpan,
                1 / VIEWPORT_ZOOM_FACTOR,
              ),
            ),
          )}
          {iconButton("Fit full timeline", <FitScreenIcon />, full, () =>
            setRange(bounds),
          )}
          {iconButton("Zoom in", <ZoomInIcon />, span <= minSpan, () =>
            setRange(
              zoomChartViewport(bounds, range, minSpan, VIEWPORT_ZOOM_FACTOR),
            ),
          )}
          {iconButton(
            "Pan later",
            <ChevronRightIcon />,
            full || range[1] >= bounds[1],
            () =>
              setRange(
                panChartViewport(
                  bounds,
                  range,
                  minSpan,
                  span * VIEWPORT_PAN_FRACTION,
                ),
              ),
          )}
        </div>
        <span id="insightsViewportHint" className="srOnly">
          Pinch or use the zoom controls to zoom. Swipe, drag, or use the pan
          controls to move through time.
        </span>
        <span className="srOnly" aria-live="polite">
          {this.state.viewportAnnouncement}
        </span>
      </section>
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
    const configured = this.state.layers.includes(id);
    const previousConfigured = visible
      .slice(0, index)
      .reverse()
      .find((layer) => this.state.layers.includes(layer));
    const nextConfigured = visible
      .slice(index + 1)
      .find((layer) => this.state.layers.includes(layer));
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
        <>
          <ChartFinances
            hideTitle
            id={chartId}
            height={140}
            timeline={financeSeries(
              finance.key,
              projection.financePast,
              projection.financeProjected,
              projection.domain.x,
              game.startingYear,
            )}
            title={finance.label}
            format={finance.format}
            // Cash clips at zero and says so; profit keeps its axis and names its losses
            domainMin={finance.key === "cash" ? 0 : undefined}
            negativeNote={
              finance.key === "cash"
                ? "Cash negative"
                : finance.key === "profit"
                  ? "Loss"
                  : undefined
            }
            startingYear={game.startingYear}
            domain={projection.domain.x}
            syncKey={SYNC_KEY}
          />
          {id === "emissions" &&
            (game.monthlyHistory[0]?.importedKgco2e || 0) > 0 && (
              <Typography variant="caption" color="textSecondary" component="p">
                Last month:{" "}
                {finance.format(game.monthlyHistory[0]?.localKgco2e || 0)} local
                + {finance.format(game.monthlyHistory[0]?.importedKgco2e || 0)}{" "}
                imported ({largeMassUnit(this.context as UnitSystemType)} CO2e)
              </Typography>
            )}
        </>
      );
    } else {
      switch (id) {
        case "inflationInterest":
          body = (
            <>
              {(["inflationRate", "interestRate"] as const).map((key) => (
                <ChartFinances
                  key={key}
                  id={chartId + key}
                  height={140}
                  timeline={financeSeries(
                    key,
                    projection.financePast,
                    projection.financeProjected,
                    projection.domain.x,
                    game.startingYear,
                  )}
                  title={
                    key === "inflationRate" ? "Inflation" : "Interest rate"
                  }
                  format={(value) => (value * 100).toFixed(2) + "%"}
                  startingYear={game.startingYear}
                  domain={projection.domain.x}
                  syncKey={SYNC_KEY}
                />
              ))}
            </>
          );
          break;
        case "supplyDemand":
          body = (
            <>
              <ChartForecastSupplyDemand
                height={140}
                timeline={projection.supplyDemandTimeline}
                blackouts={projection.blackouts}
                domain={projection.domain}
                startingYear={game.startingYear}
                multiyear={multiyear}
                currentMinute={game.date.minute}
                syncKey={SYNC_KEY}
              />
              {projection.shortfall && (
                <Typography
                  className="insightsWarning"
                  variant="body2"
                  role="note"
                  aria-label={`Forecast shortfall for ${projection.shortfall.label}: about ${formatWattHours(projection.shortfall.wh)} of demand unmet, peak about ${formatWatts(projection.shortfall.peakW)}`}
                >
                  <WarningAmberIcon fontSize="small" aria-hidden="true" />
                  <span>
                    <strong>
                      Forecast shortfall, {projection.shortfall.label}:
                    </strong>{" "}
                    ~{formatWattHours(projection.shortfall.wh)} unmet · peak ~
                    {formatWatts(projection.shortfall.peakW)}
                  </span>
                </Typography>
              )}
            </>
          );
          break;
        case "powerExchange":
          body = (
            <PowerExchangeSummary
              game={game}
              now={getTimeFromTimeline(game.date.minute, game.timeline)!}
            />
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
              <EconomicFutureComparison game={game} />
            </>
          );
          break;
        case "solarCapacityFactor":
          body = (
            <ChartForecastRenewableCapacityFactor
              game={game}
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
                    dash: waterDashArrays.precipitation,
                  },
                  {
                    name: "Snowpack",
                    color: chartPalette().snowpack,
                    dash: waterDashArrays.snowpack,
                  },
                  {
                    name: "Reservoir",
                    color: chartPalette().reservoir,
                    dash: waterDashArrays.reservoir,
                  },
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
      <section
        className="insightsTrack"
        key={id}
        data-layer={id}
        tabIndex={-1}
        aria-label={`${definition.label} evidence`}
      >
        <Toolbar className="insightsTrackHeader">
          <Typography variant="h6">{definition.label}</Typography>
          <span className="insightsTrackActions">
            <IconButton
              size="small"
              aria-label={`Move ${definition.label} up`}
              disabled={!configured || !previousConfigured}
              onClick={() =>
                previousConfigured && this.moveLayer(id, previousConfigured)
              }
            >
              <ArrowUpwardIcon fontSize="small" />
            </IconButton>
            <IconButton
              size="small"
              aria-label={`Move ${definition.label} down`}
              disabled={!configured || !nextConfigured}
              onClick={() =>
                nextConfigured && this.moveLayer(id, nextConfigured)
              }
            >
              <ArrowDownwardIcon fontSize="small" />
            </IconButton>
            <IconButton
              size="small"
              aria-label={
                this.state.temporaryLayer === id &&
                !this.state.layers.includes(id)
                  ? `Keep ${definition.label}`
                  : `Remove ${definition.label}`
              }
              disabled={requiredTutorialLayers(game.scenarioId).includes(id)}
              onClick={() => this.toggleLayer(id)}
            >
              {this.state.temporaryLayer === id && !configured ? (
                <AddIcon fontSize="small" />
              ) : (
                <CloseIcon fontSize="small" />
              )}
            </IconButton>
          </span>
        </Toolbar>
        {this.state.temporaryLayer === id &&
          !this.state.layers.includes(id) && (
            <div className="temporaryEvidence">
              Temporary evidence · not saved with preset
            </div>
          )}
        {body}
      </section>
    );
  }

  private renderPresetDialogs() {
    const { presetDialog, presetName, presetNameError, presetLibrary } =
      this.state;
    if (!presetDialog) {
      return <></>;
    }
    const selected =
      presetDefinition(this.state.preset, presetLibrary)?.label || "preset";
    const naming = presetDialog === "saveAs" || presetDialog === "rename";
    const title =
      presetDialog === "saveAs"
        ? "Save as a new preset"
        : presetDialog === "rename"
          ? "Rename preset"
          : presetDialog === "delete"
            ? `Delete “${selected}”?`
            : `Restore “${selected}”?`;
    const description =
      presetDialog === "saveAs"
        ? `Save the current ${this.state.layers.length} charts and their order as a reusable preset.`
        : presetDialog === "rename"
          ? "Give this preset a short, recognizable name."
          : presetDialog === "delete"
            ? "The charts stay open as an unsaved view, but this named preset will be removed."
            : "This replaces your saved changes with the original charts and order. Your custom presets are not affected.";

    return (
      <Dialog
        className="insightsPresetDialog"
        open={presetDialog !== null}
        onClose={() => this.closePresetDialog()}
        fullWidth
        maxWidth="xs"
        aria-labelledby="insight-preset-dialog-title"
        aria-describedby="insight-preset-dialog-description"
      >
        <DialogTitle id="insight-preset-dialog-title">{title}</DialogTitle>
        <DialogContent>
          <DialogContentText id="insight-preset-dialog-description">
            {description}
          </DialogContentText>
          {naming ? (
            <TextField
              autoFocus
              fullWidth
              margin="dense"
              label="Preset name"
              value={presetName}
              error={!!presetNameError}
              helperText={
                presetNameError ||
                (presetDialog === "saveAs"
                  ? `${presetName.length}/${MAX_PRESET_NAME_LENGTH} characters · ${presetLibrary.custom.length}/${MAX_CUSTOM_INSIGHT_PRESETS} custom presets`
                  : `${presetName.length}/${MAX_PRESET_NAME_LENGTH} characters`)
              }
              slotProps={{ htmlInput: { maxLength: MAX_PRESET_NAME_LENGTH } }}
              onChange={(event) =>
                this.setState({
                  presetName: event.target.value,
                  presetNameError: "",
                })
              }
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  if (presetDialog === "saveAs") {
                    this.createCustomPreset();
                  } else {
                    this.renameCustomPreset();
                  }
                }
              }}
            />
          ) : null}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => this.closePresetDialog()}>Cancel</Button>
          <Button
            variant="contained"
            color={presetDialog === "delete" ? "error" : "primary"}
            onClick={() => {
              if (presetDialog === "saveAs") {
                this.createCustomPreset();
              } else if (presetDialog === "rename") {
                this.renameCustomPreset();
              } else if (presetDialog === "delete") {
                this.deleteCustomPreset();
              } else {
                this.restoreDefaultPreset();
              }
            }}
          >
            {presetDialog === "saveAs"
              ? "Save preset"
              : presetDialog === "rename"
                ? "Rename"
                : presetDialog === "delete"
                  ? "Delete"
                  : "Restore"}
          </Button>
        </DialogActions>
      </Dialog>
    );
  }

  public render() {
    const { game } = this.props;
    const now = getTimeFromTimeline(game.date.minute, game.timeline);
    if (!now) {
      return <span />;
    }
    const projection = this.getProjection(now);
    const viewportBounds = projection.domain.x;
    const minViewportSpan = Math.min(
      viewportBounds[1] - viewportBounds[0],
      MINUTES_PER_MONTH,
    );
    const viewportRange = clampChartViewport(
      viewportBounds,
      this.state.viewport,
      minViewportSpan,
    );
    const viewportTimeline = timelineWithin(projection.timeline, viewportRange);
    const viewportSupplyDemand = timelineWithin(
      projection.supplyDemandTimeline,
      viewportRange,
    );
    const viewportSampleInterval = Math.max(
      projection.projectionStepMinutes,
      Math.ceil(
        (viewportRange[1] - viewportRange[0]) /
          1600 /
          projection.projectionStepMinutes,
      ) * projection.projectionStepMinutes,
    );
    const sampled = sampleForecastTimeline(
      viewportTimeline,
      viewportSampleInterval,
      projection.projectionStepMinutes,
    );
    const supplyDemandTimeline = sampleForecastTimeline(
      viewportSupplyDemand,
      viewportSampleInterval,
      projection.projectionStepMinutes,
    );
    let viewportDomainMin = Number.POSITIVE_INFINITY;
    let viewportDomainMax = Number.NEGATIVE_INFINITY;
    for (const tick of supplyDemandTimeline) {
      viewportDomainMin = Math.min(
        viewportDomainMin,
        tick.supplyW,
        tick.demandW,
      );
      viewportDomainMax = Math.max(
        viewportDomainMax,
        tick.supplyW,
        tick.demandW,
      );
    }
    const viewportProjection: ProjectionView = {
      ...projection,
      domain: {
        x: viewportRange,
        y:
          Number.isFinite(viewportDomainMin) &&
          Number.isFinite(viewportDomainMax)
            ? [viewportDomainMin, viewportDomainMax]
            : projection.domain.y,
      },
      timeline: viewportTimeline,
      sampled,
      supplyDemandTimeline,
      shortfall: this.rangeShortfall(projection, viewportRange),
    };
    const viewportContext = {
      bounds: viewportBounds,
      range: viewportRange,
      minSpan: minViewportSpan,
      onRangeChange: (range: ChartViewportRange, announce = false) =>
        this.setViewport(viewportBounds, minViewportSpan, range, announce),
      onReset: (announce = false) =>
        this.setViewport(
          viewportBounds,
          minViewportSpan,
          viewportBounds,
          announce,
        ),
    };
    const visible = withRequiredLayers(
      this.state.temporaryLayer &&
        !this.state.layers.includes(this.state.temporaryLayer)
        ? [...this.state.layers, this.state.temporaryLayer]
        : this.state.layers,
      game.scenarioId,
    ).filter((id) => {
      const definition = INSIGHT_LAYERS.find((layer) => layer.id === id);
      return !!definition && this.available(definition, projection);
    });
    const selectedPreset = presetDefinition(
      this.state.preset,
      this.state.presetLibrary,
    );
    const selectedCustom = this.selectedCustomPreset();
    const selectedDefault =
      this.state.preset !== "custom" && !this.state.preset.startsWith("saved:")
        ? (this.state.preset as DefaultInsightPresetId)
        : null;
    const customLimitReached =
      this.state.presetLibrary.custom.length >= MAX_CUSTOM_INSIGHT_PRESETS;
    const selectedDefaultCustomized =
      !!selectedDefault &&
      !!this.state.presetLibrary.defaults[selectedDefault] &&
      !this.state.presetDirty;
    const upcomingEvents = (this.props.upcomingEvents || []).filter(
      (event) =>
        event.startsMinute !== undefined &&
        event.startsMinute >= viewportRange[0] &&
        event.startsMinute <= viewportRange[1],
    );
    const annotations = {
      events: upcomingEvents.map((event, index) => ({
        key: event.key,
        x: event.startsMinute!,
        number: index + 1,
      })),
      activeEventKey: this.state.activeEventKey,
    };

    return (
      <GameCard
        className={"insights" + (this.state.compact ? " insightsCompact" : "")}
        id="insightsPane"
      >
        <div className="scrollable" ref={this.paneRef}>
          <Toolbar className="paneHeader insightsTitle">
            <Typography variant="h6">Insights</Typography>
          </Toolbar>
          {this.renderLevers(now)}
          {/* The preset and layer controls sit directly above the charts they choose */}
          <Toolbar className="insightsHeader">
            <div className="insightsHeaderControls">
              <div
                className="insightsPresetControls"
                role="group"
                aria-label="Preset controls"
              >
                <Select
                  id="insightsPreset"
                  value={this.state.preset}
                  onChange={(event: SelectChangeEvent<InsightPresetId>) => {
                    const preset = event.target.value as InsightPresetId;
                    if (preset !== "custom") {
                      this.applyPreset(preset);
                    }
                  }}
                  className="headerControl insightsPreset"
                  aria-label="Insight preset"
                  renderValue={() => (
                    <span className="insightsPresetValue">
                      <span className="insightsPresetName">
                        {selectedPreset?.label || "Unsaved view"}
                      </span>
                      {this.state.presetDirty && selectedPreset && (
                        <span
                          className="insightsPresetEdited"
                          role="status"
                          aria-label="Unsaved changes"
                        >
                          Edited
                        </span>
                      )}
                      {selectedDefaultCustomized && (
                        <span className="insightsPresetCustomized">
                          Customized
                        </span>
                      )}
                    </span>
                  )}
                >
                  <ListSubheader>Default presets</ListSubheader>
                  {Object.entries(INSIGHT_PRESETS).map(([id, preset]) => {
                    const modified =
                      !!this.state.presetLibrary.defaults[
                        id as DefaultInsightPresetId
                      ];
                    return (
                      <MenuItem key={id} value={id} data-insight-preset={id}>
                        <span>{preset.label}</span>
                        {modified && (
                          <span className="insightsPresetMenuHint">
                            Modified
                          </span>
                        )}
                      </MenuItem>
                    );
                  })}
                  {!!this.state.presetLibrary.custom.length && (
                    <ListSubheader>
                      Your presets ({this.state.presetLibrary.custom.length}/
                      {MAX_CUSTOM_INSIGHT_PRESETS})
                    </ListSubheader>
                  )}
                  {this.state.presetLibrary.custom.map((preset) => (
                    <MenuItem
                      key={preset.id}
                      value={`saved:${preset.id}`}
                      data-insight-preset={preset.id}
                    >
                      <span className="insightsPresetMenuName">
                        {preset.name}
                      </span>
                    </MenuItem>
                  ))}
                  <MenuItem value="custom" disabled>
                    Unsaved view
                  </MenuItem>
                </Select>
                <IconButton
                  className="insightsPresetSave"
                  size="small"
                  aria-label={
                    this.state.preset === "custom" ? "Save as" : "Save"
                  }
                  disabled={
                    !this.state.layers.length ||
                    (this.state.preset !== "custom" &&
                      !this.state.presetDirty) ||
                    (this.state.preset === "custom" && customLimitReached)
                  }
                  title={
                    this.state.preset === "custom" && customLimitReached
                      ? `Limit of ${MAX_CUSTOM_INSIGHT_PRESETS} custom presets reached`
                      : undefined
                  }
                  onClick={() => this.savePresetChanges()}
                >
                  <SaveIcon fontSize="small" />
                </IconButton>
                <Tooltip title="Rename, save a copy, restore, or delete">
                  <IconButton
                    className="insightsPresetActions"
                    size="small"
                    aria-label="Preset actions"
                    aria-haspopup="menu"
                    aria-controls={
                      this.state.presetMenuAnchor
                        ? "insightsPresetActionsMenu"
                        : undefined
                    }
                    aria-expanded={!!this.state.presetMenuAnchor}
                    onClick={(event) =>
                      this.setState({ presetMenuAnchor: event.currentTarget })
                    }
                  >
                    <MoreVertIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              </div>
              <Tooltip title={`Choose layers (${visible.length} shown)`}>
                <Button
                  id="insightsLayersButton"
                  className="insightsLayerControls"
                  size="small"
                  onClick={() =>
                    this.setState({ layersOpen: !this.state.layersOpen })
                  }
                  aria-label={
                    this.state.layersOpen
                      ? "Done choosing layers"
                      : `Layers (${visible.length} shown)`
                  }
                  aria-expanded={this.state.layersOpen}
                  aria-controls="insightsLayerPanel"
                >
                  {this.state.layersOpen ? "Done" : "Layers"}
                </Button>
              </Tooltip>
            </div>
            <Menu
              id="insightsPresetActionsMenu"
              className={this.state.compact ? "insightsCompact" : undefined}
              anchorEl={this.state.presetMenuAnchor}
              open={!!this.state.presetMenuAnchor}
              onClose={() => this.setState({ presetMenuAnchor: null })}
            >
              {this.state.compact && (
                <MenuItem
                  className="insightsPresetSaveMenuItem"
                  disabled={
                    !this.state.layers.length ||
                    (this.state.preset !== "custom" &&
                      !this.state.presetDirty) ||
                    (this.state.preset === "custom" && customLimitReached)
                  }
                  onClick={() => {
                    this.setState({ presetMenuAnchor: null }, () =>
                      this.savePresetChanges(),
                    );
                  }}
                >
                  <SaveIcon fontSize="small" />
                  {this.state.preset === "custom"
                    ? "Save as new preset"
                    : "Save preset changes"}
                </MenuItem>
              )}
              {(!this.state.compact || this.state.preset !== "custom") && (
                <MenuItem
                  className="insightsPresetSaveAsMenuItem"
                  disabled={customLimitReached || !this.state.layers.length}
                  onClick={() => this.openPresetDialog("saveAs")}
                >
                  <AddIcon fontSize="small" />
                  Save as new preset
                </MenuItem>
              )}
              {selectedCustom && (
                <MenuItem onClick={() => this.openPresetDialog("rename")}>
                  Rename preset…
                </MenuItem>
              )}
              {selectedCustom && (
                <MenuItem onClick={() => this.openPresetDialog("delete")}>
                  Delete preset…
                </MenuItem>
              )}
              {selectedDefault &&
                this.state.presetLibrary.defaults[selectedDefault] && (
                  <MenuItem onClick={() => this.openPresetDialog("restore")}>
                    Restore original preset
                  </MenuItem>
                )}
            </Menu>
          </Toolbar>
          {this.renderLayerPanel(projection)}
          {this.renderViewportControls(
            viewportBounds,
            viewportRange,
            minViewportSpan,
          )}
          {!!upcomingEvents.length && (
            <InsightEventRail
              events={upcomingEvents}
              activeKey={this.state.activeEventKey}
              onActiveChange={(activeEventKey) =>
                this.setState({ activeEventKey })
              }
              onZoom={(event) =>
                this.setViewport(
                  viewportBounds,
                  minViewportSpan,
                  eventChartViewport(
                    viewportBounds,
                    event.startsMinute!,
                    event.endsMinute,
                    minViewportSpan,
                  ),
                )
              }
            />
          )}
          <ChartViewportContext.Provider value={viewportContext}>
            <ChartAnnotationsContext.Provider value={annotations}>
              <div className="insightsTracks">
                {visible.map((id, index) =>
                  this.renderTrack(id, index, visible, viewportProjection),
                )}
                {!visible.length && (
                  <Typography className="insightsEmpty" color="textSecondary">
                    Choose Layers to build this view.
                  </Typography>
                )}
              </div>
            </ChartAnnotationsContext.Provider>
          </ChartViewportContext.Provider>
        </div>
        {this.renderPresetDialogs()}
      </GameCard>
    );
  }
}
