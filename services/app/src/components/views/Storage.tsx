import Toolbar from '@material-ui/core/Toolbar';
import Typography from '@material-ui/core/Typography';
import * as React from 'react';
import BuildCard from '../base/BuildCard';

export interface StateProps {
}

export interface DispatchProps {
}

export interface Props extends StateProps, DispatchProps {}

const StorageBuild = (props: Props): JSX.Element => {
  return (
    <BuildCard className="Storage">
      <Toolbar>
        <Typography variant="h6">Storage</Typography>
      </Toolbar>
      <div id="contents">
        Numbers...
      </div>
    </BuildCard>
  );
};

export default StorageBuild;
