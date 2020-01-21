import {MenuItem, Select, Table, TableBody, TableCell, TableRow, Toolbar, Typography} from '@material-ui/core';
import * as React from 'react';

import {TICK_MINUTES} from 'app/Constants';
import {summarizeHistory} from 'shared/helpers/Financials';
import {formatMoneyStable, formatWatts} from 'shared/helpers/Format';
import {DateType, GameStateType, MonthlyHistoryType} from '../../Types';
import ChartFinances from '../base/ChartFinances';
import GameCard from '../base/GameCard';

const numbro = require('numbro');

export interface StateProps {
  gameState: GameStateType;
  date: DateType;
}

export interface DispatchProps {
}

export interface Props extends StateProps, DispatchProps {}

interface State {
  year: number;
}

export default class extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = {year: props.date.year};
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
    const {date, gameState} = this.props;
    const {year} = this.state;
    const years = [];
    // Go in reverse so that newest value (current year) is on top
    for (let i = date.year; i >= gameState.startingYear; i--) {
      years.push(i);
    }

    const handleYearSelect = (newYear: number) => {
      this.setState({year: newYear});
    };

    const history = gameState.monthlyHistory;
    const timeline = [];
    for (const h of history) {
      if (!year || h.year === year) {
        let profit = h.revenue - (h.expensesFuel + h.expensesOM + h.expensesCarbonFee + h.expensesInterest);
        const projected = (h.month === date.monthNumber && h.year === date.year);
        if (projected) {
          profit /= date.percentOfMonth;
        }
        timeline.unshift({
          month: h.year * 12 + h.month,
          year: h.year,
          profit,
          projected,
        });
      }
    }

    const summary = summarizeHistory(gameState.monthlyHistory, (t: MonthlyHistoryType) => !year || t.year === year);
    const expenses = summary.expensesFuel + summary.expensesOM + summary.expensesCarbonFee + summary.expensesInterest;
    const supplykWh = (summary.supplyWh || 1) / 1000;

    return (
      <GameCard className="finances">
        <div className="scrollable">
          {timeline.length > 0 ? <ChartFinances
            height={140}
            timeline={timeline}
            title={(year || 'All time') + ' profit'}
          /> : <span/>}
          <Toolbar>
            <Typography variant="h6">Finances for </Typography>
            <Select defaultValue={date.year} onChange={(e: any) => handleYearSelect(e.target.value)}>
              <MenuItem value={0}>All time</MenuItem>
              {years.map((y: number) => {
                return <MenuItem value={y} key={y}>{y}</MenuItem>;
              })}
            </Select>
          </Toolbar>
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
                <TableCell>Income</TableCell>
                <TableCell align="right">{formatMoneyStable(summary.revenue)}</TableCell>
              </TableRow>
              <TableRow className="tabs-1">
                <TableCell>Power sold</TableCell>
                <TableCell align="right">{formatWatts(summary.supplyWh, 0)}h</TableCell>
              </TableRow>
              <TableRow className="tabs-1">
                <TableCell>Average rate</TableCell>
                <TableCell align="right">{formatMoneyStable(summary.revenue / supplykWh)}/kWh</TableCell>
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
                <TableCell>Interest</TableCell>
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
              <TableRow className="bold">
                <TableCell>Population served</TableCell>
                <TableCell align="right">{numbro(summary.population).format({thousandSeparated: true, mantissa: 0})}</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </div>
      </GameCard>
    );
  }
}
