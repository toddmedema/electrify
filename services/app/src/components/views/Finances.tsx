import Toolbar from '@material-ui/core/Toolbar';
import Typography from '@material-ui/core/Typography';
import * as React from 'react';
import {getDateFromMinute} from 'shared/helpers/DateTime';
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
  return (
    <BuildCard className="Finances">
      <Toolbar>
        <Typography variant="h6">{date.year} Finances</Typography>
      </Toolbar>
      <div className="scrollable">
        Numbers...
      </div>
    </BuildCard>
  );
};

export default FinancesBuild;
