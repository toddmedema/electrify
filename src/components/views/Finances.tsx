import * as React from "react";
import {
  MenuItem,
  Select,
  SelectChangeEvent,
  Slider,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Toolbar,
  Typography,
} from "@mui/material";
import ArrowDropDownIcon from "@mui/icons-material/ArrowDropDown";
import ArrowDropUpIcon from "@mui/icons-material/ArrowDropUp";
import { MONTHS, TICK_MINUTES, TICKS_PER_MONTH } from "../../Constants";
import { TickThrottle } from "../../helpers/RenderThrottle";
import {
  deriveExpandedSummary,
  EMPTY_HISTORY,
  getDateFromMinute,
  getTimeFromTimeline,
  reduceHistories,
  summarizeHistory,
  summarizeTimeline,
  summarizeTimelineByMonth,
} from "../../helpers/DateTime";
import { facilityLifetime } from "../../helpers/Financials";
import {
  customerMarketSizeAt,
  getMarketRate,
  projectCustomerChange,
} from "../../helpers/Customers";
import {
  formatMoneyConcise,
  formatMoneyStable,
  formatWattHours,
  formatWatts,
} from "../../helpers/Format";
import {
  getStorageBoolean,
  getStorageChoice,
  setStorageKeyValue,
} from "../../LocalStorage";
import { generateNewTimeline } from "../../reducers/Game";
import { MANUAL_ENTRY } from "../../data/Manual";
import ManualLink from "../base/ManualLink";
import {
  DerivedHistoryKeysType,
  DerivedHistoryType,
  FacilityOperatingType,
  GameType,
  MonthlyHistoryType,
  UnitSystemType,
} from "../../Types";
import {
  formatLargeMassValue,
  formatLargeMassValueConcise,
  largeMassUnit,
  massUnit,
  toDisplayMass,
} from "../../helpers/Units";
import { UnitsContext } from "../base/UnitsContext";
import ChartFinances from "../base/ChartFinances";
import GameCard from "../base/GameCard";
import MetricTiles, { MetricTileType } from "../base/MetricTiles";
import { isDesktopScreen } from "../../Globals";
import { getScenario, SCENARIOS } from "../../data/Scenarios";

import numbro from "numbro";

interface ChartKeyMetadataType {
  label: string;
  format: (n: number) => number | string;
  formatTable?: (n: number) => number | string; // if different than chart formatting
  suffix?: string;
  nesting?: number; // default 0 / unnested
  /**
   * Which direction of the change column is good news, so the arrow can be coloured. Left
   * unset for metrics such as inflation that are neither good nor bad. Those get an arrow with no
   * colour on it.
   */
  higherIsBetter?: boolean;
}

// Two tables rather than one built per render: the labels are the same either way, and only
// the two emissions rows care which system they are read in
function buildChartKeys(units: UnitSystemType): {
  [index: string]: ChartKeyMetadataType;
} {
  return {
    profit: {
      label: "Profit",
      higherIsBetter: true,
      format: formatMoneyConcise,
      formatTable: formatMoneyStable,
    },
    profitPerkWh: {
      label: "Unit profit",
      higherIsBetter: true,
      format: formatMoneyConcise,
      formatTable: formatMoneyStable,
      suffix: "/kWh",
      nesting: 1,
    },
    revenue: {
      label: "Revenue",
      higherIsBetter: true,
      format: formatMoneyConcise,
      formatTable: formatMoneyStable,
    },
    revenuePerkWh: {
      label: "Unit revenue",
      higherIsBetter: true,
      format: formatMoneyConcise,
      formatTable: formatMoneyStable,
      suffix: "/kWh",
      nesting: 1,
    },
    supplyWh: {
      label: "Power sold",
      higherIsBetter: true,
      format: (n: number) => `${formatWatts(n, 0)}h`,
      nesting: 1,
    },
    demandWh: {
      label: "Demand",
      higherIsBetter: true,
      format: (n: number) => `${formatWatts(n, 0)}h`,
    },
    customers: {
      label: "Customers",
      higherIsBetter: true,
      format: (n: number) => numbro(n).format({ average: true }),
      nesting: 1,
    },
    expenses: {
      label: "Expenses",
      higherIsBetter: false,
      format: formatMoneyConcise,
      formatTable: formatMoneyStable,
    },
    expensesFuel: {
      label: "Fuel",
      higherIsBetter: false,
      format: formatMoneyConcise,
      formatTable: formatMoneyStable,
      nesting: 1,
    },
    expensesOM: {
      label: "Operations",
      higherIsBetter: false,
      format: formatMoneyConcise,
      formatTable: formatMoneyStable,
      nesting: 1,
    },
    expensesInterest: {
      label: "Loan interest",
      higherIsBetter: false,
      format: formatMoneyConcise,
      formatTable: formatMoneyStable,
      nesting: 1,
    },
    interestRate: {
      label: "Interest rate",
      higherIsBetter: false,
      format: (n: number) => `${(n * 100).toFixed(2)}%`,
      nesting: 2,
    },
    expensesCarbonFee: {
      label: "Carbon fees",
      higherIsBetter: false,
      format: formatMoneyConcise,
      formatTable: formatMoneyStable,
      nesting: 1,
    },
    kgco2e: {
      label: "CO2e emitted",
      higherIsBetter: false,
      format: (n: number) => formatLargeMassValueConcise(n, units),
      formatTable: (n: number) => formatLargeMassValue(n, units),
      suffix: largeMassUnit(units),
      nesting: 2,
    },
    kgco2ePerMWh: {
      label: "Emissions factor",
      higherIsBetter: false,
      format: (n: number) =>
        numbro(toDisplayMass(n, units)).format({
          thousandSeparated: true,
          mantissa: 0,
        }),
      suffix: `${massUnit(units)}/MWh`,
      nesting: 2,
    },
    netWorth: {
      label: "Net Worth",
      higherIsBetter: true,
      format: formatMoneyConcise,
      formatTable: formatMoneyStable,
    },
    cash: {
      label: "Cash",
      higherIsBetter: true,
      format: formatMoneyConcise,
      formatTable: formatMoneyStable,
      nesting: 1,
    },
    inflationRate: {
      label: "Inflation",
      format: (n: number) => `${(n * 100).toFixed(1)}%`,
    },
  };
}

const CHART_KEYS_BY_SYSTEM: {
  [system in UnitSystemType]: { [index: string]: ChartKeyMetadataType };
} = {
  metric: buildChartKeys("metric"),
  imperial: buildChartKeys("imperial"),
};

// The metrics on offer, which no system changes - the stored choice is checked against these
const CHART_KEY_NAMES = Object.keys(CHART_KEYS_BY_SYSTEM.metric);

/**
 * The metrics the small multiples draw, in the order they are laid out.
 *
 * Six rather than all eighteen: these are the ones a player steers on, and the rest are the
 * breakdowns underneath them, which the table below already carries. Whatever is being plotted
 * is added to the end if it is not already here, so a metric chosen from the dropdown on a
 * narrow screen still has a tile to be un-selected from on a wide one.
 */
const SMALL_MULTIPLE_KEYS: DerivedHistoryKeysType[] = [
  "profit",
  "revenue",
  "expenses",
  "kgco2e",
  "customers",
  "cash",
];

const CHART_KEY_STORAGE_KEY = "financesChartKey";
// Still says year, because a stored year is still one of the options and reading it back is
// worth more than a tidy name. The two sentinels it used to hold aren't options any more, and
// getStorageChoice drops them for us
const CHART_RANGE_STORAGE_KEY = "financesChartYear";

/**
 * What the "for" dropdown is set to. A backwards range is a year the game has actually been to,
 * so it is its own value; the rest are named, because "the current year" follows the clock and a
 * forward range isn't a year at all. These were numbers with 0 and -1 as sentinels, which had no
 * room left for "the next ten years".
 */
const ALL_TIME = "all";
const CURRENT_YEAR = "current";
const FUTURE_PREFIX = "next";
// Matching the horizons the Forecasts pane offers, so the two panes look ahead the same distance
const FUTURE_YEARS = [1, 5, 10, 20];

const futureRange = (years: number) => `${FUTURE_PREFIX}${years}`;

// Newest first, so that the year being played is at the top of the dropdown
function getPlayedYears(game: GameType): number[] {
  const years = [];
  for (let i = game.date.year; i >= game.startingYear; i--) {
    years.push(i);
  }
  return years;
}

function getPlotRangeOptions(game: GameType): string[] {
  return [
    ALL_TIME,
    CURRENT_YEAR,
    ...FUTURE_YEARS.map(futureRange),
    ...getPlayedYears(game).map(String),
  ];
}

// One shared array, so that a range with nothing ahead of it keeps handing back the same empty
// projection and the series cache can go on comparing by identity
const EMPTY_PROJECTION: MonthlyHistoryType[] = [];

type ParsedRangeType =
  | { mode: "all" }
  | { mode: "year"; year: number }
  | { mode: "future"; years: number };

export function parseRange(
  range: string,
  currentYear: number,
): ParsedRangeType {
  if (range === ALL_TIME) {
    return { mode: "all" };
  }
  if (range.startsWith(FUTURE_PREFIX)) {
    const years = Number(range.slice(FUTURE_PREFIX.length));
    if (FUTURE_YEARS.includes(years)) {
      return { mode: "future", years };
    }
    return { mode: "year", year: currentYear };
  }
  const year = Number(range);
  // getStorageChoice already drops a stored range that isn't on offer, so this is the last line
  // rather than the first. The emptiness check is because Number("") is 0, which is finite, and
  // would chart the year nothing happened in
  if (range !== "" && Number.isFinite(year)) {
    return { mode: "year", year };
  }
  return { mode: "year", year: currentYear };
}

/**
 * The current month, followed by `monthsAhead` complete simulated months.
 *
 * The current month comes from the live timeline, which already covers it from its start; the
 * forecast only picks up from the current minute. Starting part way through a month is also why
 * a whole extra month of ticks is simulated: it is what guarantees `monthsAhead` complete months
 * after this one, since the forecast's own first bucket is only the rest of the current month
 * and whatever trails off its end is the matching part of a later one. Both are dropped rather
 * than drawn as months that only half happened.
 */
export function projectMonths(
  game: GameType,
  cash: number,
  customers: number,
  monthsAhead: number,
): MonthlyHistoryType[] {
  const months = [summarizeTimeline(game.timeline, game.startingYear)];
  if (monthsAhead > 0) {
    const forecast = generateNewTimeline(
      game,
      cash,
      customers,
      TICKS_PER_MONTH * (1 + monthsAhead),
    );
    months.push(
      ...summarizeTimelineByMonth(forecast, game.startingYear).slice(
        1,
        1 + monthsAhead,
      ),
    );
  }
  return months;
}

export interface StateProps {
  game: GameType;
  // Set from the fleet list. When it names a facility, this pane reports what that one has
  // contributed rather than only what the company as a whole has
  selectedFacilityId: number | null;
}

export interface DispatchProps {
  onDelta: (delta: Partial<GameType>) => void;
}

export interface Props extends StateProps, DispatchProps {}

interface State {
  range: string;
  expanded: boolean;
  chartKey: DerivedHistoryKeysType;
}

interface ChartPointType {
  month: number; // unique across years
  year: number;
  value: number;
  projected: boolean;
}

/**
 * The change column: the month just closed, against the one before it.
 *
 * A month rather than the period the rest of the table is totalled over, because a period
 * total has no honest predecessor while it is still being played -- ten months of this year
 * against twelve of last year is a fall in everything every time. Two whole months are always
 * the same length as each other, so the arrow only ever means what it says, and the header
 * names them both rather than leaving the column to be read as "vs the number on its left".
 */
interface ComparisonType {
  label: string;
  current: DerivedHistoryType;
  previous: DerivedHistoryType;
}

export function getComparison(game: GameType): ComparisonType | undefined {
  // monthlyHistory is newest first, and only holds months that have finished
  const [latest, previous] = game.monthlyHistory;
  if (!latest || !previous) {
    return undefined;
  }
  return {
    label: `${MONTHS[latest.month - 1]} vs ${MONTHS[previous.month - 1]}`,
    current: deriveExpandedSummary(latest),
    previous: deriveExpandedSummary(previous),
  };
}

// How small a change counts as no change. Relative, because these run from fractions of a
// percent to hundreds of millions of dollars, and an arrow on a rounding error is noise
const FLAT_FRACTION = 0.005;

interface DeltaCellProps {
  metadata: ChartKeyMetadataType;
  value: number;
  previous: number;
}

function DeltaCell(props: DeltaCellProps): React.JSX.Element {
  const { metadata, value, previous } = props;
  const delta = value - previous;
  const format = metadata.formatTable || metadata.format;
  const reference = Math.max(Math.abs(value), Math.abs(previous));
  if (!Number.isFinite(delta) || Math.abs(delta) <= reference * FLAT_FRACTION) {
    return (
      <TableCell align="right" className="deltaCell flat">
        —
      </TableCell>
    );
  }
  const up = delta > 0;
  // Colour is the second reading of the arrow, not the only one: an expense going up and
  // revenue going up both point up, and only one of them is good news
  const good =
    metadata.higherIsBetter === undefined
      ? undefined
      : up === metadata.higherIsBetter;
  const tone = good === undefined ? "" : good ? " good" : " bad";
  return (
    <TableCell align="right" className={"deltaCell" + tone}>
      {up ? (
        <ArrowDropUpIcon className="deltaArrow" />
      ) : (
        <ArrowDropDownIcon className="deltaArrow" />
      )}
      {format(Math.abs(delta))}
    </TableCell>
  );
}

// The rate slider runs $0 to $0.30/kWh, so its ticks are a fixed nickel apart
const RATE_MARKS = [0, 0.05, 0.1, 0.15, 0.2, 0.25, 0.3].map((rate: number) => ({
  value: rate,
  label: formatMoneyConcise(rate),
}));

/**
 * The useful part of the customer forecast is its change, not its resulting total. At large
 * customer counts, formatting both totals compactly can turn `1m -> 1m` and hide the effect.
 */
export function formatCustomerChange(
  change: number,
  customers: number,
): string {
  const formattedChange = numbro(Math.abs(change)).format({
    average: true,
    mantissa: 1,
    trimMantissa: true,
  });
  const percent =
    customers > 0
      ? ` (${change >= 0 ? "+" : "-"}${((Math.abs(change) / customers) * 100).toFixed(1)}%)`
      : "";
  return `${change >= 0 ? "+" : "-"}${formattedChange}${percent}`;
}

export default class Finances extends React.Component<Props, State> {
  // Context rather than a prop: shouldComponentUpdate below throttles renders against the game
  // clock, which a prop change would have to be excepted from - a context change is delivered
  // whatever it says
  static contextType = UnitsContext;

  constructor(props: Props) {
    super(props);
    // Building a facility unmounts this pane, so both dropdowns have to be remembered outside
    // the component or the player lands back on this year's profit every time they return
    this.state = {
      range: getStorageChoice(
        CHART_RANGE_STORAGE_KEY,
        getPlotRangeOptions(props.game),
        CURRENT_YEAR,
      ),
      expanded: getStorageBoolean("financesTableOpened", false),
      chartKey: getStorageChoice(
        CHART_KEY_STORAGE_KEY,
        CHART_KEY_NAMES,
        "profit",
      ) as DerivedHistoryKeysType,
    };
  }

  // Two caches rather than one, because the two halves of the work are invalidated by
  // different things. The projection is the expensive half and doesn't care which metric is on
  // screen, so switching metric no longer re-simulates; the series is cheap but has to stay
  // referentially stable, because that is what lets ChartFinances memoise its canvas.
  private projectionCache:
    { key: string; range: string; months: MonthlyHistoryType[] } | undefined;
  // The tiles read the same months the chart does, one value per metric rather than one metric
  // per month, and are rebuilt on the same terms: a month rolling over, or the range moving
  private tileCache:
    | {
        chartKey: DerivedHistoryKeysType;
        range: string;
        historyLength: number;
        projected: MonthlyHistoryType[];
        tiles: MetricTileType[];
      }
    | undefined;
  private seriesCache:
    | {
        chartKey: DerivedHistoryKeysType;
        range: string;
        historyLength: number;
        projected: MonthlyHistoryType[];
        series: ChartPointType[];
      }
    | undefined;

  // Rebuilding a twenty-year projection costs ~120ms, and the rate slider changes one of its
  // inputs on every pointer move. Drawing from the previous projection while the
  // player is still dragging keeps the slider smooth, and the trailing timer below makes sure
  // the chart catches up with wherever they let go.
  private static readonly PROJECTION_THROTTLE_MS = 250;
  private lastProjectionMs = 0;
  private projectionCatchup: ReturnType<typeof setTimeout> | undefined;

  private throttle = new TickThrottle();

  // In fast mode, skip rendering alternating frames so that CPU can focus on simulation.
  // Left at 1 in 2 when the charts moved to uPlot: measured either way this pane costs about
  // 3ms a render, because its chart is memoised and only redraws on a month rollover. What the
  // cheaper chart bought here is a calmer worst frame, not a cheaper typical one.
  //
  // Only the clock is throttled. The metric and the year live in state, and skipping a state
  // change means dropping something the player just asked for: the dropdown redraws itself with
  // the new label -- it keeps its own state, and nothing here can stop it -- while the chart goes
  // on plotting the old metric until the clock happens to come round. That reads as a selector
  // that does nothing, and if the clock has stopped (a scenario that has ended, a backgrounded
  // tab) it never comes round at all.
  public shouldComponentUpdate(nextProps: Props, nextState: State) {
    if (
      nextState !== this.state ||
      nextProps.game.speed !== "FAST" ||
      // Selecting a facility in the fleet list is the same kind of direct request the
      // dropdowns below are, and gets the same exemption
      nextProps.selectedFacilityId !== this.props.selectedFacilityId
    ) {
      return true;
    }
    return this.throttle.due(nextProps.game.date.minute, 2);
  }

  public componentDidUpdate() {
    this.throttle.rendered(this.props.game.date.minute);
  }

  public componentWillUnmount() {
    if (this.projectionCatchup) {
      clearTimeout(this.projectionCatchup);
    }
  }

  public setExpand(expanded: boolean) {
    setStorageKeyValue("financesTableOpened", expanded);
    this.setState({ expanded });
  }

  public setChartKey(chartKey: DerivedHistoryKeysType) {
    setStorageKeyValue(CHART_KEY_STORAGE_KEY, chartKey);
    this.setState({ chartKey });
  }

  public setRange(range: string) {
    setStorageKeyValue(CHART_RANGE_STORAGE_KEY, range);
    this.setState({ range });
  }

  /**
   * The months the chart draws as a dashed projection: the current one, plus however far ahead
   * the selected range looks.
   *
   * Simulating them is by far the most expensive thing this pane does -- at FAST it once ran a
   * year of simulation up to fifty times a second to redraw a line whose points cannot move
   * until the month does. So it is rebuilt only when something that can actually change it
   * changes: the month rolling over, or the player touching the range, a slider or the fleet.
   */
  private getProjectedMonths(
    range: ParsedRangeType,
    cash: number,
    customers: number,
  ): MonthlyHistoryType[] {
    const { game } = this.props;
    const { date } = game;

    // A year that is already in the books has nothing ahead of it to project
    if (range.mode === "year" && range.year !== date.year) {
      return EMPTY_PROJECTION;
    }

    const key = [
      this.state.range,
      date.monthsElapsed,
      game.monthlyHistory.length,
      game.dollarsPerkWh,
      game.facilities.map((f) => `${f.id}${f.paused ? "p" : ""}`).join(","),
    ].join("|");
    const cached = this.projectionCache;
    if (cached && cached.key === key) {
      return cached.months;
    }
    const sinceLast = Date.now() - this.lastProjectionMs;
    if (
      cached &&
      // Only what the game did under a range the player already had. Asking for a different
      // range is a direct request, and answering it with the last range's months would put the
      // wrong line on screen for a quarter of a second before correcting itself
      cached.range === this.state.range &&
      range.mode === "future" &&
      range.years > 1 &&
      sinceLast < Finances.PROJECTION_THROTTLE_MS
    ) {
      // Mid-drag: draw the projection from before the drag started, and come back for the real
      // one once the player has stopped moving. forceUpdate rather than setState because this
      // is catching up on the game's own inputs, not on a change the player just made here
      if (!this.projectionCatchup) {
        this.projectionCatchup = setTimeout(() => {
          this.projectionCatchup = undefined;
          this.forceUpdate();
        }, Finances.PROJECTION_THROTTLE_MS - sinceLast);
      }
      return cached.months;
    }

    // A backwards range still projects the rest of the year it is looking at, which is what the
    // chart has always drawn behind its dashed half
    const monthsAhead =
      range.mode === "future" ? 12 * range.years : 12 - date.monthNumber;
    const months = projectMonths(game, cash, customers, monthsAhead);

    this.lastProjectionMs = Date.now();
    this.projectionCache = { key, range: this.state.range, months };
    return months;
  }

  /**
   * The chart's points for the metric on screen. Cheap next to the projection, but it has to
   * hand back the same array when nothing has moved, because that referential stability is what
   * lets ChartFinances memoise its canvas across the frames in between.
   */
  private getChartSeries(
    monthlyHistory: MonthlyHistoryType[],
    projected: MonthlyHistoryType[],
  ): ChartPointType[] {
    const { chartKey, range } = this.state;
    const historyLength = this.props.game.monthlyHistory.length;
    const cached = this.seriesCache;
    if (
      cached &&
      cached.chartKey === chartKey &&
      cached.range === range &&
      cached.historyLength === historyLength &&
      cached.projected === projected
    ) {
      return cached.series;
    }

    const point = (m: MonthlyHistoryType, isProjected: boolean) => {
      const summary = deriveExpandedSummary(m);
      return {
        month: summary.year * 12 + summary.month,
        year: summary.year,
        value: summary[chartKey],
        projected: isProjected,
      };
    };

    const series = [] as ChartPointType[];
    // game.monthlyHistory is newest first, so unshifting puts the chart back in time order
    for (const m of monthlyHistory) {
      series.unshift(point(m, false));
    }
    for (const m of projected) {
      series.push(point(m, true));
    }

    this.seriesCache = {
      chartKey,
      range,
      historyLength,
      projected,
      series,
    };
    return series;
  }

  /**
   * One tile per headline metric: its label, its latest value and the same span of months the
   * chart is drawing. Built from the derived months once rather than per metric, since deriving
   * a month is the expensive half and every tile wants the same twelve.
   */
  private getTiles(
    monthlyHistory: MonthlyHistoryType[],
    projected: MonthlyHistoryType[],
    chartKeys: { [index: string]: ChartKeyMetadataType },
  ): MetricTileType[] {
    const { chartKey, range } = this.state;
    const historyLength = this.props.game.monthlyHistory.length;
    const cached = this.tileCache;
    if (
      cached &&
      cached.chartKey === chartKey &&
      cached.range === range &&
      cached.historyLength === historyLength &&
      cached.projected === projected
    ) {
      return cached.tiles;
    }

    // game.monthlyHistory is newest first; the tiles read left to right through time
    const months = [...monthlyHistory]
      .reverse()
      .concat(projected)
      .map(deriveExpandedSummary);
    // Whatever is plotted always has a tile, even the breakdowns that aren't headline metrics
    const keys = SMALL_MULTIPLE_KEYS.includes(chartKey)
      ? SMALL_MULTIPLE_KEYS
      : [...SMALL_MULTIPLE_KEYS, chartKey];
    const tiles = keys.map((key: DerivedHistoryKeysType) => {
      const values = months.map((m: DerivedHistoryType) => m[key]);
      const metadata = chartKeys[key];
      const latest = metadata.format(values[values.length - 1] || 0);
      return {
        metricKey: key,
        label: metadata.label,
        // A number with no unit on it is a different number: "380K" of CO2e could be anything
        value: metadata.suffix
          ? `${latest}${metadata.suffix.startsWith("/") ? "" : " "}${metadata.suffix}`
          : String(latest),
        values,
      };
    });

    this.tileCache = { chartKey, range, historyLength, projected, tiles };
    return tiles;
  }

  public render() {
    const { game, onDelta, selectedFacilityId } = this.props;
    const chartKeys = CHART_KEYS_BY_SYSTEM[this.context as UnitSystemType];
    const { startingYear, timeline, date } = game;
    const { expanded, chartKey } = this.state;
    const range = parseRange(this.state.range, date.year);
    const now = getTimeFromTimeline(date.minute, timeline);

    if (!now) {
      return <span />;
    }

    const scenario =
      getScenario(game.scenarioId, game.customScenario) || SCENARIOS[0];
    const marketRate = getMarketRate(
      scenario.dollarsPerkWh,
      date,
      startingYear,
      game.seed,
    );
    const customerChange = projectCustomerChange({
      customers: now.customers,
      customerRate: now.customerRate || game.customerRate || game.dollarsPerkWh,
      currentRate: game.dollarsPerkWh,
      marketRateAt: (tick: number) =>
        getMarketRate(
          scenario.dollarsPerkWh,
          getDateFromMinute(date.minute + tick * TICK_MINUTES, startingYear),
          startingYear,
          game.seed,
        ),
      marketSizeAt: (tick: number) =>
        customerMarketSizeAt(
          game.customerMarketSize || now.customers * 2,
          date.minute + tick * TICK_MINUTES,
        ),
      ownership: scenario.ownership,
    });
    const investorRateMax = Math.max(
      0.05,
      Math.ceil(marketRate * 200) / 100,
      game.dollarsPerkWh,
    );
    const investorRateMarks = [
      { value: 0, label: "$0" },
      {
        value: marketRate,
        label: `${formatMoneyConcise(marketRate)} market`,
      },
      { value: investorRateMax, label: formatMoneyConcise(investorRateMax) },
    ];
    // Six sparklines need width the phone layout does not have, and the dropdown they replace is
    // the right control at that size -- see MetricTiles
    const smallMultiples = isDesktopScreen();
    const years = getPlayedYears(game);

    // A forward range still draws every month on the record behind its projection, so that the
    // trajectory the forecast comes out of is on screen next to it
    const monthlyHistory = game.monthlyHistory.filter(
      (t: MonthlyHistoryType) =>
        range.mode === "year" ? t.year === range.year : true,
    );

    const projectedMonths = this.getProjectedMonths(
      range,
      now.cash,
      now.customers,
    );
    const monthly = this.getChartSeries(monthlyHistory, projectedMonths);

    // For the summary table. A backwards range totals what has happened, a forward one totals
    // what is projected to -- which for cash and net worth means where the horizon leaves them,
    // since reduceHistories carries those through rather than adding them up
    const summaryMonths =
      range.mode === "future"
        ? [...projectedMonths]
        : [summarizeHistory(monthlyHistory)];
    if (range.mode === "year" && range.year === date.year) {
      summaryMonths.push(
        summarizeTimeline(
          timeline,
          startingYear,
          (t) => t.minute <= date.minute,
        ),
      );
    }
    const summary = deriveExpandedSummary(
      summaryMonths.reduce(reduceHistories, { ...EMPTY_HISTORY }),
    );
    const comparison = getComparison(game);

    // What the one facility the player has open has contributed. Its share is measured
    // against the fleet's own delivered total rather than against the company's recorded
    // sales, so the two numbers are the same kind of thing and the shares add to 100%
    const selectedFacility = game.facilities.find(
      (f: FacilityOperatingType) => f.id === selectedFacilityId,
    );
    const selectedLifetime =
      selectedFacility && facilityLifetime(selectedFacility);
    const fleetWh = game.facilities.reduce(
      (sum: number, f: FacilityOperatingType) => sum + f.lifetimeWh,
      0,
    );

    return (
      <GameCard
        className="finances"
        title={smallMultiples ? undefined : "Finances"}
        id="financesPane"
      >
        <div className="scrollable">
          {/* On a wide screen the tiles below already say what's plotted and pick a different
              one, so the range is the only thing left to choose -- it moves up here with the
              title instead of sharing a row with the sliders (see Facilities, whose build
              buttons live in the same spot) */}
          {smallMultiples && (
            <Toolbar className="paneHeader">
              <Typography variant="h6">Finances</Typography>
              <Select
                id="plotRange"
                value={this.state.range}
                onChange={(e: SelectChangeEvent<string>) =>
                  this.setRange(e.target.value)
                }
                className="headerControl"
              >
                <MenuItem value={ALL_TIME}>All time</MenuItem>
                <MenuItem value={CURRENT_YEAR}>Current year</MenuItem>
                {FUTURE_YEARS.map((y: number) => {
                  return (
                    <MenuItem value={futureRange(y)} key={futureRange(y)}>
                      Next {y} {y === 1 ? "year" : "years"}
                    </MenuItem>
                  );
                })}
                {years.map((y: number) => {
                  return (
                    <MenuItem value={String(y)} key={y}>
                      {y}
                    </MenuItem>
                  );
                })}
              </Select>
            </Toolbar>
          )}
          {selectedFacility && selectedLifetime && (
            // The other half of clicking a row in the fleet list: the stack in Forecasts
            // says which power is this facility's, and this says which money is
            <div className="selectedFacilitySummary">
              <Typography variant="body2" component="div">
                <strong>{selectedFacility.name}</strong> has delivered{" "}
                {formatWattHours(selectedLifetime.wh)}
                {fleetWh > 0 &&
                  ` (${Math.round((selectedLifetime.wh / fleetWh) * 100)}% of your fleet)`}
              </Typography>
              <Typography variant="body2" color="textSecondary" component="div">
                {formatMoneyConcise(selectedLifetime.revenue)} earned,{" "}
                {formatMoneyConcise(selectedLifetime.expenses)} spent,{" "}
                <span
                  className={
                    selectedLifetime.profit < 0
                      ? "deltaCell bad"
                      : "deltaCell good"
                  }
                >
                  {formatMoneyConcise(selectedLifetime.profit)} profit
                </span>
              </Typography>
            </div>
          )}
          <br />
          <Toolbar>
            <Typography
              className="flex-newline"
              variant="body2"
              color="textSecondary"
            >
              Electricity Rate
              <ManualLink
                entry={MANUAL_ENTRY.RATES}
                label="electricity rates"
              />
              :&nbsp;
              <Typography color="primary" component="strong">
                {formatMoneyConcise(game.dollarsPerkWh)}
              </Typography>
              /kWh
              {scenario.ownership === "Investor" && (
                <>
                  &nbsp;&mdash;&nbsp;market {formatMoneyConcise(marketRate)}/kWh
                  &nbsp;&mdash;&nbsp;
                  {numbro(now.customers).format({ average: true })} customers,
                  projected&nbsp;
                  <Typography color="primary" component="strong">
                    {formatCustomerChange(customerChange, now.customers)}
                  </Typography>
                  &nbsp;next month
                </>
              )}
            </Typography>
            <div className="budgetSlider flex-newline">
              <Slider
                id="rateSlider"
                disabled={!!game.replayPlayback}
                value={game.dollarsPerkWh}
                aria-label="The rate you charge for electricity generation"
                valueLabelDisplay="auto"
                valueLabelFormat={(rate: number) =>
                  `${formatMoneyConcise(rate)}/kWh`
                }
                getAriaValueText={(rate: number) =>
                  `${formatMoneyConcise(rate)} per kilowatt hour`
                }
                marks={
                  scenario.ownership === "Investor"
                    ? investorRateMarks
                    : RATE_MARKS
                }
                min={0}
                step={scenario.ownership === "Investor" ? 0.001 : 0.01}
                max={scenario.ownership === "Investor" ? investorRateMax : 0.3}
                onChange={(_e: Event, newTick: number | number[]) =>
                  onDelta({
                    dollarsPerkWh: Array.isArray(newTick)
                      ? newTick[0]
                      : newTick,
                  })
                }
              />
            </div>
            {/* On a wide screen this whole row goes away: the range moved up into the pane
                header above, and the tiles below are the metric picker, so there is nothing
                left here that isn't said somewhere else */}
            {!smallMultiples && (
              <>
                <div className="flex-newline"></div>
                <Typography variant="h6" style={{ flexGrow: 0 }}>
                  Plotting{" "}
                </Typography>
                {/* Controlled, so the label and the chart cannot disagree about what is plotted */}
                <Select
                  id="plotMetric"
                  value={chartKey}
                  onChange={(e: SelectChangeEvent<string>) =>
                    this.setChartKey(e.target.value as DerivedHistoryKeysType)
                  }
                >
                  {CHART_KEY_NAMES.map((key: string) => {
                    const k = chartKeys[key];
                    let label = k.label;
                    if (chartKey !== key && chartKeys[key].nesting) {
                      // https://stackoverflow.com/questions/14343844/create-a-string-of-variable-length-filled-with-a-repeated-character
                      label =
                        new Array((chartKeys[key].nesting || 0) + 1).join(
                          " -",
                        ) +
                        " " +
                        label;
                    }
                    return (
                      <MenuItem
                        className={!k.nesting ? "bold" : `tabs-${k.nesting}`}
                        value={key}
                        key={key}
                      >
                        {label}
                      </MenuItem>
                    );
                  })}
                </Select>
                <Typography variant="h6" style={{ flexGrow: 0 }}>
                  {" "}
                  for{" "}
                </Typography>
                <Select
                  id="plotRange"
                  value={this.state.range}
                  onChange={(e: SelectChangeEvent<string>) =>
                    this.setRange(e.target.value)
                  }
                >
                  <MenuItem value={ALL_TIME}>All time</MenuItem>
                  <MenuItem value={CURRENT_YEAR}>Current year</MenuItem>
                  {FUTURE_YEARS.map((y: number) => {
                    return (
                      <MenuItem value={futureRange(y)} key={futureRange(y)}>
                        Next {y} {y === 1 ? "year" : "years"}
                      </MenuItem>
                    );
                  })}
                  {years.map((y: number) => {
                    return (
                      <MenuItem value={String(y)} key={y}>
                        {y}
                      </MenuItem>
                    );
                  })}
                </Select>
              </>
            )}
          </Toolbar>
          {monthly.length > 0 ? (
            <ChartFinances
              height={140}
              timeline={monthly}
              title={
                chartKeys[chartKey].label +
                (chartKeys[chartKey].suffix
                  ? ` (${chartKeys[chartKey].suffix})`
                  : "")
              }
              format={chartKeys[chartKey].format}
            />
          ) : (
            <span />
          )}
          {smallMultiples && monthly.length > 0 && (
            <MetricTiles
              id="plotMetric"
              tiles={this.getTiles(monthlyHistory, projectedMonths, chartKeys)}
              selectedKey={chartKey}
              onSelect={(key: string) =>
                this.setChartKey(key as DerivedHistoryKeysType)
              }
            />
          )}
          <div
            className={`expandable ${!expanded && "notExpanded"}`}
            onClick={() => this.setExpand(!expanded)}
          >
            <Table size="small" className="summaryTable">
              {/* Two numbers a row rather than one: a total on its own says nothing about
                  whether it is heading the right way, which is the question the table is
                  actually being read for */}
              {comparison && (
                <TableHead>
                  <TableRow>
                    <TableCell />
                    <TableCell />
                    <TableCell align="right">{comparison.label}</TableCell>
                  </TableRow>
                </TableHead>
              )}
              <TableBody>
                {CHART_KEY_NAMES.map((key: string) => {
                  const k = chartKeys[key];
                  const format = k.formatTable || k.format;
                  return (
                    <TableRow
                      className={!k.nesting ? "bold" : `tabs-${k.nesting}`}
                      key={key}
                    >
                      <TableCell>{k.label}</TableCell>
                      <TableCell align="right">
                        {format(summary[key as DerivedHistoryKeysType])}
                        {k.suffix && (
                          <span className="unitSuffix">
                            {k.suffix.startsWith("/") ? "" : " "}
                            {k.suffix}
                          </span>
                        )}
                      </TableCell>
                      {comparison && (
                        <DeltaCell
                          metadata={k}
                          value={
                            comparison.current[key as DerivedHistoryKeysType]
                          }
                          previous={
                            comparison.previous[key as DerivedHistoryKeysType]
                          }
                        />
                      )}
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
            {!expanded && (
              <ArrowDropDownIcon color="primary" className="expand-icon" />
            )}
            {expanded && (
              <ArrowDropUpIcon color="primary" className="expand-icon" />
            )}
            {!expanded && (
              <Typography
                color="textSecondary"
                variant="body2"
                style={{ textAlign: "center" }}
              >
                (click table to expand)
              </Typography>
            )}
          </div>
        </div>
      </GameCard>
    );
  }
}
