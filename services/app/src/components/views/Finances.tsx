import MenuItem from '@material-ui/core/MenuItem';
import Select from '@material-ui/core/Select';
import Table from '@material-ui/core/Table';
import TableBody from '@material-ui/core/TableBody';
import TableCell from '@material-ui/core/TableCell';
import TableRow from '@material-ui/core/TableRow';
import Toolbar from '@material-ui/core/Toolbar';
import Typography from '@material-ui/core/Typography';

import {STARTING_YEAR} from 'app/Constants';
import * as React from 'react';
import {getDateFromMinute} from 'shared/helpers/DateTime';
import {formatMoneyStable, formatWatts} from 'shared/helpers/Format';
import {GameStateType, MonthlyHistoryType} from '../../Types';
import BuildCard from '../base/BuildCard';

export interface StateProps {
  gameState: GameStateType;
}

export interface DispatchProps {
}

export interface Props extends StateProps, DispatchProps {}

export default function FinancesBuild(props: Props): JSX.Element {
  const date = getDateFromMinute(props.gameState.currentMinute);
  const years = [];
  // Go in reverse so that newest value (current year) is on top
  for (let i = date.year; i >= STARTING_YEAR; i--) {
    years.push(i);
  }

  const [year, setYear] = React.useState(date.year);
  const handleYearSelect = (newYear: number) => {
    setYear(newYear);
  };

  const history = props.gameState.monthlyHistory;
  const summary = {
    supplyWh: 0,
    demandWh: 0,
    revenue: 0,
    expensesFuel: 0,
    expensesOM: 0,
    expensesTaxesFees: 0,
  } as MonthlyHistoryType;
  // Go in reverse so that the last values for ending values (like net worth are used)
  for (let i = history.length - 1; i >= 0 ; i--) {
    if (!year || history[i].year === year) {
      summary.supplyWh += history[i].supplyWh;
      summary.demandWh += history[i].demandWh;
      summary.revenue += history[i].revenue;
      summary.expensesFuel += history[i].expensesFuel;
      summary.expensesOM += history[i].expensesOM;
      summary.expensesTaxesFees += history[i].expensesTaxesFees;
      summary.netWorth = history[i].netWorth;
    }
  }
  const expenses = summary.expensesFuel + summary.expensesOM + summary.expensesTaxesFees;

  return (
    <BuildCard className="Finances">
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
              <TableCell colSpan={2}>Revenue</TableCell>
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
          </TableBody>
        </Table>
      </div>
    </BuildCard>
  );
}
