import MenuItem from '@material-ui/core/MenuItem';
import Select from '@material-ui/core/Select';
import Table from '@material-ui/core/Table';
import TableBody from '@material-ui/core/TableBody';
import TableCell from '@material-ui/core/TableCell';
import TableRow from '@material-ui/core/TableRow';
import Toolbar from '@material-ui/core/Toolbar';
import Typography from '@material-ui/core/Typography';

import {STARTING_YEAR, TICK_MINUTES} from 'app/Constants';
import * as React from 'react';
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
    for (let i = date.year; i >= STARTING_YEAR; i--) {
      years.push(i);
    }

    const handleYearSelect = (newYear: number) => {
      this.setState({year: newYear});
    };

    const history = gameState.monthlyHistory;
    const summary = {
      supplyWh: 0,
      demandWh: 0,
      kgco2e: 0,
      revenue: 0,
      expensesFuel: 0,
      expensesOM: 0,
      expensesTaxesFees: 0,
      expensesInterest: 0,
    } as MonthlyHistoryType;
    const timeline = [];
    // Go in reverse so that the last values for ending values (like net worth are used)
    for (let i = history.length - 1; i >= 0 ; i--) {
      const h = history[i];
      if (!year || h.year === year) {
        timeline.push({
          month: h.year * 12 + h.month,
          year: h.year,
          profit: h.revenue - (h.expensesFuel + h.expensesOM + h.expensesTaxesFees + h.expensesInterest),
        });
        summary.supplyWh += h.supplyWh;
        summary.demandWh += h.demandWh;
        summary.kgco2e += h.kgco2e;
        summary.revenue += h.revenue;
        summary.expensesFuel += h.expensesFuel;
        summary.expensesOM += h.expensesOM;
        summary.expensesTaxesFees += h.expensesTaxesFees;
        summary.expensesInterest += h.expensesInterest;
        summary.netWorth = h.netWorth;
      }
    }
    const expenses = summary.expensesFuel + summary.expensesOM + summary.expensesTaxesFees + summary.expensesInterest;

    return (
      <GameCard className="Finances">
        <Typography variant="body2">Current population served: {numbro(gameState.regionPopulation).format({ thousandSeparated: true })}</Typography>
        <ChartFinances
          height={180}
          timeline={timeline}
          title={(year || 'All time') + ' profit'}
        />
        <Toolbar>
          <Typography variant="h6">Finances for </Typography>
          <Select defaultValue={date.year} onChange={(e: any) => handleYearSelect(e.target.value)}>
            {years.map((y: number) => {
              return <MenuItem value={y} key={y}>{y}</MenuItem>;
            })}
            <MenuItem value={0}>all time</MenuItem>
          </Select>
        </Toolbar>
        <div className="scrollable">
          <Table size="small">
            <TableBody>
              <TableRow>
                <TableCell colSpan={2}>Income</TableCell>
                <TableCell align="right">{formatMoneyStable(summary.revenue)}</TableCell>
              </TableRow>
              <TableRow>
                <TableCell colSpan={2}>Expenses</TableCell>
                <TableCell align="right">{formatMoneyStable(expenses)}</TableCell>
              </TableRow>
              <TableRow>
                <TableCell></TableCell>
                <TableCell>Fuel</TableCell>
                <TableCell align="right">{formatMoneyStable(summary.expensesFuel)}</TableCell>
              </TableRow>
              <TableRow>
                <TableCell></TableCell>
                <TableCell>Operations</TableCell>
                <TableCell align="right">{formatMoneyStable(summary.expensesOM)}</TableCell>
              </TableRow>
              <TableRow>
                <TableCell></TableCell>
                <TableCell>Interest</TableCell>
                <TableCell align="right">{formatMoneyStable(summary.expensesInterest)}</TableCell>
              </TableRow>
              <TableRow>
                <TableCell></TableCell>
                <TableCell>Taxes & Fees</TableCell>
                <TableCell align="right">{formatMoneyStable(summary.expensesTaxesFees)}</TableCell>
              </TableRow>
              <TableRow>
                <TableCell colSpan={2}>Net Worth</TableCell>
                <TableCell align="right">{formatMoneyStable(summary.netWorth)}</TableCell>
              </TableRow>
              <TableRow>
                <TableCell colSpan={2}>Supply generated</TableCell>
                <TableCell align="right">{formatWatts(summary.supplyWh, 0)}h</TableCell>
              </TableRow>
              <TableRow>
                <TableCell colSpan={2}>Pollution (CO2e)</TableCell>
                <TableCell align="right">{Math.round(summary.kgco2e / (summary.supplyWh / 1000000))}kg/MWh</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </div>
      </GameCard>
    );
  }
}
