import Table from '@material-ui/core/Table';
import TableBody from '@material-ui/core/TableBody';
import TableCell from '@material-ui/core/TableCell';
import TableRow from '@material-ui/core/TableRow';
import Toolbar from '@material-ui/core/Toolbar';
import Typography from '@material-ui/core/Typography';

import * as React from 'react';
import {getDateFromMinute} from 'shared/helpers/DateTime';
import {formatMoneyStable, formatWatts} from 'shared/helpers/Format';
import {GameStateType} from '../../Types';
import BuildCard from '../base/BuildCard';

export interface StateProps {
  gameState: GameStateType;
}

export interface DispatchProps {
}

export interface Props extends StateProps, DispatchProps {}

const FinancesBuild = (props: Props): JSX.Element => {
  const date = getDateFromMinute(props.gameState.currentMinute);
  const history = props.gameState.monthlyHistory;
  const summary = {...history[0]};
  const historyLength = history.length;
  for (let i = 1; i < historyLength; i++) {
    if (history[i].year !== date.year) {
      break;
    }
    summary.supplyWh += history[i].supplyWh;
    summary.demandWh += history[i].demandWh;
    summary.revenue += history[i].revenue;
    summary.expensesFuel += history[i].expensesFuel;
    summary.expensesOM += history[i].expensesOM;
    summary.expensesTaxesFees += history[i].expensesTaxesFees;
  }
  const expenses = summary.expensesFuel + summary.expensesOM + summary.expensesTaxesFees;

  return (
    <BuildCard className="Finances">
      <Toolbar>
        <Typography variant="h6">{date.year} Finances</Typography>
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
};

export default FinancesBuild;
