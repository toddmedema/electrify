import * as React from "react";
import {
  MenuItem,
  Select,
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
import { TICK_MINUTES, TICKS_PER_MONTH } from "../../Constants";
import {
  deriveExpandedSummary,
  EMPTY_HISTORY,
  getDateFromMinute,
  getTimeFromTimeline,
  reduceHistories,
  summarizeHistory,
  summarizeTimeline,
} from "../../helpers/DateTime";
import { customersFromMarketingSpend } from "../../helpers/Financials";
import {
  formatMoneyConcise,
  formatMoneyStable,
  formatWatts,
} from "../../helpers/Format";
import {
  getStorageBoolean,
  getStorageString,
  setStorageKeyValue,
} from "../../LocalStorage";
import { generateNewTimeline } from "../../reducers/Game";
import {
  DerivedHistoryKeysType,
  GameType,
  MonthlyHistoryType,
} from "../../Types";
import ChartFinances from "../base/ChartFinances";
import GameCard from "../base/GameCard";
import { SCENARIOS } from "../../data/Scenarios";

const numbro = require("numbro");

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

export interface StateProps {
  game: GameType;
}

export interface DispatchProps {
  onDelta: (delta: Partial<GameType>) => void;
}

export interface Props extends StateProps, DispatchProps {}

interface State {
  year: number;
  expanded: boolean;
  chartKey: DerivedHistoryKeysType;
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
    this.state = {
      year: -1, // current year
      expanded: getStorageBoolean("financesTableOpened", false),
      chartKey: getStorageString(
        "financesChartKey",
        "profit"
      ) as DerivedHistoryKeysType,
    };
  }

  public shouldComponentUpdate(nextProps: Props, nextState: State) {
    // In fast modes, skip rendering alternating frames so that CPU can focus on simulation
    switch (nextProps.game.speed) {
      case "FAST":
        return (nextProps.game.date.minute / TICK_MINUTES) % 2 === 0;
      default:
        return true;
    }
  }

  public setExpand(expanded: boolean) {
    setStorageKeyValue("financesTableOpened", expanded);
    this.setState({ expanded });
  }

  public setChartKey(chartKey: DerivedHistoryKeysType) {
    setStorageKeyValue("financesChartKey", chartKey);
    this.setState({ chartKey });
  }

  public render() {
    const { game, onDelta } = this.props;
    const { startingYear, timeline, date } = game;
    const { year, expanded, chartKey } = this.state;
    const now = getTimeFromTimeline(date.minute, timeline);

    if (!now) {
      return <span />;
    }

    const scenario =
      SCENARIOS.find((s) => s.id === game.scenarioId) || SCENARIOS[0];
    const years = []; // Go in reverse so that newest value (current year) is on top
    for (let i = date.year; i >= startingYear; i--) {
      years.push(i);
    }

    const monthlyHistory = game.monthlyHistory.filter(
      (t: MonthlyHistoryType) =>
        !year || t.year === year || (year === -1 && t.year === date.year)
    );
    const previousMonths = summarizeHistory(monthlyHistory);

    // For the summary table
    const summaryMonths = [previousMonths];
    if (year === -1 || year === date.year) {
      summaryMonths.push(
        summarizeTimeline(
          timeline,
          startingYear,
          (t) => t.minute <= date.minute
        )
      );
    }
    const summary = deriveExpandedSummary(
      summaryMonths.reduce(reduceHistories, { ...EMPTY_HISTORY })
    );

    // For the monthly chart
    const monthly = [];
    for (const m of monthlyHistory) {
      const s = deriveExpandedSummary(m);
      monthly.unshift({
        month: s.year * 12 + s.month,
        year: s.year,
        value: s[chartKey],
        projected: false,
      });
    }
    if (!year || year === -1 || date.year === year) {
      // Add projected months if current year is included in chart
      const presentFutureMonths = [summarizeTimeline(timeline, startingYear)];
      if (date.month !== "Dec") {
        // Project out for the rest of the year
        const forecastedTimeline = generateNewTimeline(
          game,
          now.cash,
          now.customers,
          TICKS_PER_MONTH * (1 + 12 - date.monthNumber)
        ); // Current month, plus the rest of the months
        for (let month = date.monthNumber + 1; month <= 12; month++) {
          const m = summarizeTimeline(
            forecastedTimeline,
            game.startingYear,
            (t) =>
              getDateFromMinute(t.minute, game.startingYear).monthNumber ===
              month
          );
          presentFutureMonths.push(m);
        }
      }
      presentFutureMonths.forEach((m) => {
        const s = deriveExpandedSummary(m);
        monthly.push({
          month: s.year * 12 + s.month,
          year: s.year,
          value: s[chartKey],
          projected: true,
        });
      });
    }

    return (
      <GameCard className="finances">
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
                  customersFromMarketingSpend(game.monthlyMarketingSpend)
                ).format({ average: true })}{" "}
                customers)
              </Typography>
            )}
            {scenario.ownership === "Investor" && (
              <Slider
                id="marketingSlider"
                value={getTickFromValue(game.monthlyMarketingSpend)}
                aria-labelledby="marketing monthly budget"
                valueLabelDisplay="off"
                min={-1}
                step={1}
                max={getTickFromValue(
                  Math.max(now.cash / 12, game.monthlyMarketingSpend)
                )}
                onChange={(e: any, newTick: number | number[]) =>
                  onDelta({
                    monthlyMarketingSpend: getValueFromTick(
                      Array.isArray(newTick) ? newTick[0] : newTick
                    ),
                  })
                }
              />
            )}
            {scenario.ownership === "Investor" && (
              <div className="flex-newline"></div>
            )}
            <Typography variant="h6" style={{ flexGrow: 0 }}>
              Plotting{" "}
            </Typography>
            <Select
              id="plotMetric"
              defaultValue={chartKey}
              onChange={(e: any) => this.setChartKey(e.target.value)}
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
              id="plotYear"
              defaultValue={-1}
              onChange={(e: any) => this.setState({ year: e.target.value })}
            >
              <MenuItem value={0}>All time</MenuItem>
              <MenuItem value={-1}>Current year</MenuItem>
              props.game.date.year
              {years.map((y: number) => {
                return (
                  <MenuItem value={y} key={y}>
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
