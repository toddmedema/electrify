import Typography from '@material-ui/core/Typography';
import * as React from 'react';
import BuildCard from '../base/BuildCard';

export interface StateProps {
}

export interface DispatchProps {
}

export interface Props extends StateProps, DispatchProps {}

const CustomersBuild = (props: Props): JSX.Element => {
  return (
    <BuildCard className="Customers">
      <Typography variant="h6">Customers</Typography>
      <div>Numbers...</div>
    </BuildCard>
  );
};

export default CustomersBuild;
