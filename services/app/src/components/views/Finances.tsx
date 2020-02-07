import {MenuItem, Select, Slider, Table, TableBody, TableCell, TableRow, Toolbar, Typography} from '@material-ui/core';
import ArrowDropDownIcon from '@material-ui/icons/ArrowDropDown';
import ArrowDropUpIcon from '@material-ui/icons/ArrowDropUp';
import * as React from 'react';

import {TICK_MINUTES} from 'app/Constants';
import {getTimeFromTimeline} from 'shared/helpers/DateTime';
import {customersFromMarketingSpend, summarizeHistory, summarizeTimeline} from 'shared/helpers/Financials';
import {formatMoneyConcise, formatMoneyStable, formatWatts} from 'shared/helpers/Format';
import {DateType, GameStateType, MonthlyHistoryType} from '../../Types';
import ChartFinances from '../base/ChartFinances';
import GameCard from '../base/GameCard';

const numbro = require('numbro');

export interface StateProps {
  gameState: GameStateType;
  date: DateType;
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
  return frontNumber * Math.pow(10, exponent);
}

function getTickFromValue(v: number) {
  if (v === 0) { return -1; }
  const exponent = Math.floor(Math.log10(v)) - 5;
  const frontNumber = +v.toString().charAt(0);
  return frontNumber + exponent * 9 - 1;
}

export default class extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = {
      year: props.date.year,
      expanded: false,
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

  public render() {
    const {date, gameState, onDelta} = this.props;
    const {year, expanded} = this.state;
    const tick = getTickFromValue(gameState.monthlyMarketingSpend);

    const now = getTimeFromTimeline(gameState.date.minute, gameState.timeline);
    if (!now) {
      return <span/>;
    }

    const years = [];
    // Go in reverse so that newest value (current year) is on top
    for (let i = date.year; i >= gameState.startingYear; i--) {
      years.push(i);
    }

    const handleYearSelect = (newYear: number) => {
      this.setState({year: newYear});
    };

    const toggleExpand = () => {
      this.setState({expanded: !expanded});
    };

    const history = gameState.monthlyHistory;
    const then = summarizeHistory(history, (t: MonthlyHistoryType) => !year || t.year === year);
    const upToNow = summarizeTimeline(gameState.timeline, gameState.startingYear, 0, gameState.date.minute);
    const thisMonth = summarizeTimeline(gameState.timeline, gameState.startingYear, 0, gameState.date.minute);
    const timeline = [];
    for (const h of history) {
      if (!year || h.year === year) {
        timeline.unshift({
          month: h.year * 12 + h.month,
          year: h.year,
          profit: h.revenue - (h.expensesFuel + h.expensesOM + h.expensesCarbonFee + h.expensesInterest + h.expensesMarketing),
          projected: false,
        });
      }
    }
    // TODO project out for whole year, not just up to present
    if (!year || thisMonth.year === year) {
      timeline.push({
        month: thisMonth.year * 12 + thisMonth.month,
        year: thisMonth.year,
        profit: (upToNow.revenue - (upToNow.expensesFuel + upToNow.expensesOM + upToNow.expensesCarbonFee + upToNow.expensesInterest + upToNow.expensesMarketing)) / date.percentOfMonth,
        projected: true,
      });
    }

    const summary = {
      netWorth: now.netWorth,
      cash: now.cash,
      customers: upToNow.customers,
      supplyWh: then.supplyWh + upToNow.supplyWh,
      demandWh: then.demandWh + upToNow.demandWh,
      revenue: then.revenue + upToNow.revenue,
      expensesFuel: then.expensesFuel + upToNow.expensesFuel,
      expensesOM: then.expensesOM + upToNow.expensesOM,
      expensesCarbonFee: then.expensesCarbonFee + upToNow.expensesCarbonFee,
      expensesInterest: then.expensesInterest + upToNow.expensesInterest,
      expensesMarketing: then.expensesMarketing + upToNow.expensesMarketing,
      kgco2e: then.kgco2e + upToNow.kgco2e,
    } as MonthlyHistoryType;
    const expenses = summary.expensesFuel + summary.expensesOM + summary.expensesMarketing + summary.expensesCarbonFee + summary.expensesInterest;
    const supplykWh = (summary.supplyWh || 1) / 1000;

    console.log(summary, then, upToNow);

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
              value={tick}
              aria-labelledby="marketing monthly budget"
              valueLabelDisplay="off"
              min={-1}
              step={1}
              max={Math.floor(getTickFromValue(Math.max(now.cash / 12, gameState.monthlyMarketingSpend)))}
              onChange={(e: any, newTick: number) => onDelta({monthlyMarketingSpend: getValueFromTick(newTick)})}
            />
            <div className="flex-newline"></div>
            <Typography variant="h6" style={{flexGrow: 0}}>Financal summary for </Typography>
            <Select defaultValue={date.year} onChange={(e: any) => handleYearSelect(e.target.value)}>
              <MenuItem value={0}>All time</MenuItem>
              {years.map((y: number) => {
                return <MenuItem value={y} key={y}>{y}</MenuItem>;
              })}
            </Select>
          </Toolbar>
          {timeline.length > 0 ? <ChartFinances
            height={140}
            timeline={timeline}
            title="Profit"
          /> : <span/>}
          <div className={`expandable ${!this.state.expanded && 'notExpanded'}`} onClick={toggleExpand}>
            <Table size="small">
              <TableBody>
                <TableRow className="bold">
                  <TableCell>Profit (net income)</TableCell>
                  <TableCell align="right">{formatMoneyStable(summary.revenue - expenses)}</TableCell>
                </TableRow>
                <TableRow className="tabs-1">
                  <TableCell>Profit per kWh</TableCell>
                  <TableCell align="right">{formatMoneyStable((summary.revenue - expenses) / supplykWh)}/kWh</TableCell>
                </TableRow>

                <TableRow className="bold">
                  <TableCell>Revenue</TableCell>
                  <TableCell align="right">{formatMoneyStable(summary.revenue)}</TableCell>
                </TableRow>
                <TableRow className="tabs-1">
                  <TableCell>Revenue per kWh</TableCell>
                  <TableCell align="right">{formatMoneyStable(summary.revenue / supplykWh)}/kWh</TableCell>
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
                  <TableCell align="right">{formatMoneyStable(expenses)}</TableCell>
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
                  <TableCell align="right">{numbro(summary.kgco2e / 1000).format({thousandSeparated: true, mantissa: 0})} tons</TableCell>
                </TableRow>
                <TableRow className="tabs-2">
                  <TableCell>Emission factor</TableCell>
                  <TableCell align="right">{numbro(summary.kgco2e / (supplykWh / 1000)).format({thousandSeparated: true, mantissa: 0})}kg/MWh</TableCell>
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
