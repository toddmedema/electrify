import Toolbar from '@material-ui/core/Toolbar';
import Typography from '@material-ui/core/Typography';
import * as React from 'react';
import GameCard from '../base/GameCard';

export interface StateProps {
}

export interface DispatchProps {
}

export interface Props extends StateProps, DispatchProps {}

const StorageBuild = (props: Props): JSX.Element => {
  return (
    <GameCard className="Storage">
      <Toolbar>
        <Typography variant="h6">Storage</Typography>
      </Toolbar>
      <div className="scrollable">
        Numbers...
      </div>
    </GameCard>
  );
};

export default StorageBuild;
