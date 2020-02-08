import {MenuItem, Select, Slider, Table, TableBody, TableCell, TableRow, Toolbar, Typography} from '@material-ui/core';
import ArrowDropDownIcon from '@material-ui/icons/ArrowDropDown';
import ArrowDropUpIcon from '@material-ui/icons/ArrowDropUp';
import * as React from 'react';

import {TICK_MINUTES, TICKS_PER_MONTH} from 'app/Constants';
import {deriveExpandedSummary, EMPTY_HISTORY, getDateFromMinute, getTimeFromTimeline, reduceHistories, summarizeHistory, summarizeTimeline} from 'shared/helpers/DateTime';
import {customersFromMarketingSpend} from 'shared/helpers/Financials';
import {formatMoneyConcise, formatMoneyStable, formatWatts} from 'shared/helpers/Format';
import {getStorageBoolean, setStorageKeyValue} from '../../LocalStorage';
import {generateNewTimeline} from '../../reducers/GameState';
import {GameStateType, MonthlyHistoryType} from '../../Types';
import ChartFinances from '../base/ChartFinances';
import GameCard from '../base/GameCard';

const numbro = require('numbro');

export interface StateProps {
  gameState: GameStateType;
}

export interface DispatchProps {
  onDelta: (delta: Partial<GameStateType>) => void;
}

export interface Props extends StateProps, DispatchProps {}

interface State {
  year: number;
  expanded: boolean;
}

// -1:0 -> 0:$100k, each tick increments the front number - when it overflows, instead add a 0 (i.e. 1->2M, 9->10M, 10->20M)
function getValueFromTick(tick: number) {
  if (tick === -1) { return 0; }
  const exponent = Math.floor(tick / 9) + 5;
  const frontNumber = tick % 9 + 1;
  return Math.round(frontNumber * Math.pow(10, exponent));
}

function getTickFromValue(v: number) {
  if (v === 0) { return -1; }
  const exponent = Math.floor(Math.log10(v)) - 5;
  const frontNumber = +v.toString().charAt(0);
  return Math.floor(frontNumber + exponent * 9 - 1);
}

export default class extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = {
      year: props.gameState.date.year,
      expanded: getStorageBoolean('financesTableOpened', false),
    };
  }

  public shouldComponentUpdate(nextProps: Props, nextState: State) {
    // In fast modes, skip rendering alternating frames so that CPU can focus on simulation
    switch (nextProps.gameState.speed) {
      case 'FAST':
        return (nextProps.gameState.date.minute / TICK_MINUTES % 2 === 0);
      case 'LIGHTNING':
        return (nextProps.gameState.date.minute / TICK_MINUTES % 4 === 0);
      default:
        return true;
    }
  }

  public handleYearSelect(newYear: number) {
    this.setState({year: newYear});
  }

  public setExpand(expanded: boolean) {
    setStorageKeyValue('financesTableOpened', expanded);
    this.setState({expanded});
  }

  public render() {
    const {gameState, onDelta} = this.props;
    const {startingYear, timeline, date} = gameState;
    const {year, expanded} = this.state;
    const now = getTimeFromTimeline(date.minute, timeline);

    if (!now) {
      return <span/>;
    }

    const years = []; // Go in reverse so that newest value (current year) is on top
    for (let i = date.year; i >= startingYear; i--) { years.push(i); }

    const monthlyHistory = gameState.monthlyHistory.filter((t: MonthlyHistoryType) => !year || t.year === year);
    const previousMonths = summarizeHistory(monthlyHistory);

    // For the summary table
    let s = reduceHistories({...EMPTY_HISTORY}, previousMonths);
    if (year === date.year) {
      const upToNow = summarizeTimeline(timeline, startingYear, (t) => t.minute <= date.minute);
      s = reduceHistories(s, upToNow);
    }
    const summary = deriveExpandedSummary(s);

    // For the monthly chart
    const monthly = [];
    for (const h of monthlyHistory) {
      monthly.unshift({
        month: h.year * 12 + h.month,
        year: h.year,
        value: h.revenue - (h.expensesFuel + h.expensesOM + h.expensesCarbonFee + h.expensesInterest + h.expensesMarketing),
        projected: false,
      });
    }
    if (!year || date.year === year) { // Add projected months if current year is included in chart
      const presentFutureMonths = [summarizeTimeline(timeline, startingYear)];
      if (date.month !== 'Dec') { // Project out for the rest of the year
        const forecast = {...gameState};
        generateNewTimeline(forecast, now.cash, now.customers, TICKS_PER_MONTH * (13 - date.monthNumber));
        for (let month = date.monthNumber + 1; month <= 12; month++) {
          const m = summarizeTimeline(forecast.timeline, gameState.startingYear, (t) => getDateFromMinute(t.minute, gameState.startingYear).monthNumber === month);
          presentFutureMonths.push(m);
        }
      }
      presentFutureMonths.forEach((m) => {
        monthly.push({
          month: m.year * 12 + m.month,
          year: m.year,
          value: m.revenue - (m.expensesFuel + m.expensesOM + m.expensesCarbonFee + m.expensesInterest + m.expensesMarketing),
          projected: true,
        });
      });
    }

    return (
      <GameCard className= "finances">
        <div className="scrollable">
          <br/>
          <Toolbar>
            <Typography className="flex-newline" variant="body2" color="textSecondary">
              Marketing:&nbsp;
              <Typography color="primary" component="strong">{formatMoneyConcise(gameState.monthlyMarketingSpend)}</Typography>/mo&nbsp;
              (+{numbro(customersFromMarketingSpend(gameState.monthlyMarketingSpend)).format({average: true})} customers)
            </Typography>
            <Slider
              value={getTickFromValue(gameState.monthlyMarketingSpend)}
              aria-labelledby="marketing monthly budget"
              valueLabelDisplay="off"
              min={-1}
              step={1}
              max={getTickFromValue(Math.max(now.cash / 12, gameState.monthlyMarketingSpend))}
              onChange={(e: any, newTick: number) => onDelta({monthlyMarketingSpend: getValueFromTick(newTick)})}
            />
            <div className="flex-newline"></div>
            <Typography variant="h6" style={{flexGrow: 0}}>Financal summary for </Typography>
            <Select defaultValue={date.year} onChange={(e: any) => this.handleYearSelect(e.target.value)}>
              <MenuItem value={0}>All time</MenuItem>
              {years.map((y: number) => {
                return <MenuItem value={y} key={y}>{y}</MenuItem>;
              })}
            </Select>
          </Toolbar>
          {monthly.length > 0 ? <ChartFinances
            height={140}
            timeline={monthly}
            title="Profit"
          /> : <span/>}
          <div className={`expandable ${!expanded && 'notExpanded'}`} onClick={() => this.setExpand(!expanded)}>
            <Table size="small">
              <TableBody>
                <TableRow className="bold">
                  <TableCell>Profit (net income)</TableCell>
                  <TableCell align="right">{formatMoneyStable(summary.profit)}</TableCell>
                </TableRow>
                <TableRow className="tabs-1">
                  <TableCell>Profit per kWh</TableCell>
                  <TableCell align="right">{formatMoneyStable(summary.profitPerkWh)}/kWh</TableCell>
                </TableRow>

                <TableRow className="bold">
                  <TableCell>Revenue</TableCell>
                  <TableCell align="right">{formatMoneyStable(summary.revenue)}</TableCell>
                </TableRow>
                <TableRow className="tabs-1">
                  <TableCell>Revenue per kWh</TableCell>
                  <TableCell align="right">{formatMoneyStable(summary.revenuePerkWh)}/kWh</TableCell>
                </TableRow>
                <TableRow className="tabs-1">
                  <TableCell>Power sold</TableCell>
                  <TableCell align="right">{formatWatts(summary.supplyWh, 0)}h</TableCell>
                </TableRow>
                <TableRow className="tabs-1">
                  <TableCell>Customers served</TableCell>
                  <TableCell align="right">{numbro(summary.customers).format({thousandSeparated: true, mantissa: 0})}</TableCell>
                </TableRow>

                <TableRow className="bold">
                  <TableCell>Expenses</TableCell>
                  <TableCell align="right">{formatMoneyStable(summary.expenses)}</TableCell>
                </TableRow>
                <TableRow className="tabs-1">
                  <TableCell>Fuel</TableCell>
                  <TableCell align="right">{formatMoneyStable(summary.expensesFuel)}</TableCell>
                </TableRow>
                <TableRow className="tabs-1">
                  <TableCell>Operations</TableCell>
                  <TableCell align="right">{formatMoneyStable(summary.expensesOM)}</TableCell>
                </TableRow>
                <TableRow className="tabs-1">
                  <TableCell>Marketing</TableCell>
                  <TableCell align="right">{formatMoneyStable(summary.expensesMarketing)}</TableCell>
                </TableRow>
                <TableRow className="tabs-1">
                  <TableCell>Loan interest</TableCell>
                  <TableCell align="right">{formatMoneyStable(summary.expensesInterest)}</TableCell>
                </TableRow>
                <TableRow className="tabs-1">
                  <TableCell>Carbon Fees</TableCell>
                  <TableCell align="right">{formatMoneyStable(summary.expensesCarbonFee)}</TableCell>
                </TableRow>
                <TableRow className="tabs-2">
                  <TableCell>CO2e emitted</TableCell>
                  <TableCell align="right">{numbro(summary.tco2e).format({thousandSeparated: true, mantissa: 0})} tons</TableCell>
                </TableRow>
                <TableRow className="tabs-2">
                  <TableCell>Emission factor</TableCell>
                  <TableCell align="right">{numbro(summary.kgco2ePerMWh).format({thousandSeparated: true, mantissa: 0})}kg/MWh</TableCell>
                </TableRow>

                <TableRow className="bold">
                  <TableCell>Net Worth</TableCell>
                  <TableCell align="right">{formatMoneyStable(summary.netWorth)}</TableCell>
                </TableRow>
              </TableBody>
            </Table>
            {!expanded && <ArrowDropDownIcon color="primary" className="expand-icon" />}
            {expanded && <ArrowDropUpIcon color="primary" className="expand-icon" />}
          </div>
        </div>
      </GameCard>
    );
  }
}
