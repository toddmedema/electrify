import * as React from "react";
import {
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
import ArrowDropDownIcon from "@mui/icons-material/ArrowDropDown";
import ArrowDropUpIcon from "@mui/icons-material/ArrowDropUp";
import { TICKS_PER_MONTH } from "../../Constants";
import { TickThrottle } from "../../helpers/RenderThrottle";
import {
  deriveExpandedSummary,
  EMPTY_HISTORY,
  getTimeFromTimeline,
  reduceHistories,
  summarizeHistory,
  summarizeTimeline,
  summarizeTimelineByMonth,
} from "../../helpers/DateTime";
import { customersFromMarketingSpend } from "../../helpers/Financials";
import {
  formatMoneyConcise,
  formatMoneyStable,
  formatWatts,
} from "../../helpers/Format";
import {
  getStorageBoolean,
  getStorageChoice,
  setStorageKeyValue,
} from "../../LocalStorage";
import { isDesktopScreen } from "../../Globals";
import { generateNewTimeline } from "../../reducers/Game";
import { MANUAL_ENTRY } from "../../data/Manual";
import ManualLink from "../base/ManualLink";
import {
  DerivedHistoryKeysType,
  GameType,
  MonthlyHistoryType,
} from "../../Types";
import ChartFinances from "../base/ChartFinances";
import GameCard from "../base/GameCard";
import { getScenario, SCENARIOS } from "../../data/Scenarios";

import numbro from "numbro";

interface ChartKeyMetadataType {
  label: string;
  format: (n: number) => number | string;
  formatTable?: (n: number) => number | string; // if different than chart formatting
  suffix?: string;
  nesting?: number; // default 0 / unnested
}

const CHART_KEYS = {
  profit: {
    label: "Profit",
    format: formatMoneyConcise,
    formatTable: formatMoneyStable,
  },
  profitPerkWh: {
    label: "Unit profit",
    format: formatMoneyConcise,
    formatTable: formatMoneyStable,
    suffix: "/kWh",
    nesting: 1,
  },
  revenue: {
    label: "Revenue",
    format: formatMoneyConcise,
    formatTable: formatMoneyStable,
  },
  revenuePerkWh: {
    label: "Unit revenue",
    format: formatMoneyConcise,
    formatTable: formatMoneyStable,
    suffix: "/kWh",
    nesting: 1,
  },
  supplyWh: {
    label: "Power sold",
    format: (n: number) => `${formatWatts(n, 0)}h`,
    nesting: 1,
  },
  demandWh: {
    label: "Demand",
    format: (n: number) => `${formatWatts(n, 0)}h`,
  },
  customers: {
    label: "Customers",
    format: (n: number) => numbro(n).format({ average: true }),
    nesting: 1,
  },
  expenses: {
    label: "Expenses",
    format: formatMoneyConcise,
    formatTable: formatMoneyStable,
  },
  expensesFuel: {
    label: "Fuel",
    format: formatMoneyConcise,
    formatTable: formatMoneyStable,
    nesting: 1,
  },
  expensesOM: {
    label: "Operations",
    format: formatMoneyConcise,
    formatTable: formatMoneyStable,
    nesting: 1,
  },
  expensesMarketing: {
    label: "Marketing",
    format: formatMoneyConcise,
    formatTable: formatMoneyStable,
    nesting: 1,
  },
  expensesInterest: {
    label: "Loan interest",
    format: formatMoneyConcise,
    formatTable: formatMoneyStable,
    nesting: 1,
  },
  expensesCarbonFee: {
    label: "Carbon fees",
    format: formatMoneyConcise,
    formatTable: formatMoneyStable,
    nesting: 1,
  },
  kgco2e: {
    label: "CO2e emitted",
    format: (n: number) =>
      `${numbro(n / 1000).format({ thousandSeparated: true, mantissa: 0 })}`,
    suffix: "tons",
    nesting: 2,
  },
  kgco2ePerMWh: {
    label: "Emissions factor",
    format: (n: number) =>
      `${numbro(n).format({ thousandSeparated: true, mantissa: 0 })}`,
    suffix: "kg/MWh",
    nesting: 2,
  },
  netWorth: {
    label: "Net Worth",
    format: formatMoneyConcise,
    formatTable: formatMoneyStable,
  },
  cash: {
    label: "Cash",
    format: formatMoneyConcise,
    formatTable: formatMoneyStable,
    nesting: 1,
  },
} as { [index: string]: ChartKeyMetadataType };

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

// -1:0 -> 0:$100k, each tick increments the front number - when it overflows, instead add a 0 (i.e. 1->2M, 9->10M, 10->20M)
function getValueFromTick(tick: number) {
  if (tick === -1) {
    return 0;
  }
  const exponent = Math.floor(tick / 9) + 5;
  const frontNumber = (tick % 9) + 1;
  return Math.round(frontNumber * Math.pow(10, exponent));
}

function getTickFromValue(v: number) {
  if (v === 0) {
    return -1;
  }
  const exponent = Math.floor(Math.log10(v)) - 5;
  const frontNumber = +v.toString().charAt(0);
  return Math.floor(frontNumber + exponent * 9 - 1);
}

export default class Finances extends React.Component<Props, State> {
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
        Object.keys(CHART_KEYS),
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
  private seriesCache:
    | {
        chartKey: DerivedHistoryKeysType;
        range: string;
        historyLength: number;
        projected: MonthlyHistoryType[];
        series: ChartPointType[];
      }
    | undefined;

  // Rebuilding a twenty-year projection costs ~120ms, and the marketing and rate sliders change
  // one of its inputs on every pointer move. Drawing from the previous projection while the
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
    if (nextState !== this.state || nextProps.game.speed !== "FAST") {
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
      date.monthsEllapsed,
      game.monthlyHistory.length,
      game.monthlyMarketingSpend,
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

  public render() {
    const { game, onDelta } = this.props;
    const { startingYear, timeline, date } = game;
    const { expanded, chartKey } = this.state;
    const range = parseRange(this.state.range, date.year);
    const now = getTimeFromTimeline(date.minute, timeline);

    if (!now) {
      return <span />;
    }

    const scenario =
      getScenario(game.scenarioId, game.customScenario) || SCENARIOS[0];
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

    return (
      <GameCard
        className="finances"
        chromeless={isDesktopScreen()}
        title="Finances"
        id="financesPane"
      >
        <div className="scrollable">
          <br />
          <Toolbar>
            {scenario.ownership === "Investor" && (
              <Typography
                className="flex-newline"
                variant="body2"
                color="textSecondary"
              >
                Marketing:&nbsp;
                <Typography color="primary" component="strong">
                  {formatMoneyConcise(game.monthlyMarketingSpend)}
                </Typography>
                /mo&nbsp; (+
                {numbro(
                  customersFromMarketingSpend(game.monthlyMarketingSpend),
                ).format({ average: true })}{" "}
                customers)
              </Typography>
            )}
            {scenario.ownership === "Investor" && (
              <Slider
                id="marketingSlider"
                disabled={!!game.replayPlayback}
                value={getTickFromValue(game.monthlyMarketingSpend)}
                aria-labelledby="marketing monthly budget"
                valueLabelDisplay="off"
                min={-1}
                step={1}
                max={getTickFromValue(
                  Math.max(now.cash / 12, game.monthlyMarketingSpend),
                )}
                onChange={(_e: Event, newTick: number | number[]) =>
                  onDelta({
                    monthlyMarketingSpend: getValueFromTick(
                      Array.isArray(newTick) ? newTick[0] : newTick,
                    ),
                  })
                }
              />
            )}
            {scenario.ownership === "Public" && (
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
              </Typography>
            )}
            {scenario.ownership === "Public" && (
              <Slider
                id="rateSlider"
                disabled={!!game.replayPlayback}
                value={game.dollarsPerkWh}
                aria-labelledby="The rate you charge for electricity generation"
                valueLabelDisplay="off"
                min={0}
                step={0.01}
                max={0.3}
                onChange={(_e: Event, newTick: number | number[]) =>
                  onDelta({
                    dollarsPerkWh: Array.isArray(newTick)
                      ? newTick[0]
                      : newTick,
                  })
                }
              />
            )}
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
              {Object.keys(CHART_KEYS).map((key: string) => {
                const k = CHART_KEYS[key];
                let label = k.label;
                if (chartKey !== key && CHART_KEYS[key].nesting) {
                  // https://stackoverflow.com/questions/14343844/create-a-string-of-variable-length-filled-with-a-repeated-character
                  label =
                    new Array((CHART_KEYS[key].nesting || 0) + 1).join(" -") +
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
          </Toolbar>
          {monthly.length > 0 ? (
            <ChartFinances
              height={140}
              timeline={monthly}
              title={
                CHART_KEYS[chartKey].label +
                (CHART_KEYS[chartKey].suffix
                  ? ` (${CHART_KEYS[chartKey].suffix})`
                  : "")
              }
              format={CHART_KEYS[chartKey].format}
            />
          ) : (
            <span />
          )}
          <div
            className={`expandable ${!expanded && "notExpanded"}`}
            onClick={() => this.setExpand(!expanded)}
          >
            <Table size="small">
              <TableBody>
                {Object.keys(CHART_KEYS).map((key: string) => {
                  const k = CHART_KEYS[key];
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
