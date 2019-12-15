import Toolbar from '@material-ui/core/Toolbar';
import Typography from '@material-ui/core/Typography';
import * as React from 'react';
import BuildCard from '../base/BuildCard';

export interface StateProps {
}

export interface DispatchProps {
}

export interface Props extends StateProps, DispatchProps {}

const FinancesBuild = (props: Props): JSX.Element => {
  return (
    <BuildCard className="Finances">
      <Toolbar>
        <Typography variant="h6">Finances</Typography>
      </Toolbar>
      <div className="scrollable">
        Numbers...
      </div>
    </BuildCard>
  );
};

export default FinancesBuild;
