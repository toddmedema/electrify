import Button from '@material-ui/core/Button';
import * as React from 'react';

export interface StateProps {
}

export interface DispatchProps {
}

export interface Props extends StateProps, DispatchProps {}

const FinancesBuild = (props: Props): JSX.Element => {
  return (
    <div className="Finances">
      Finances
      <Button>BUILD</Button>
    </div>
  );
};

export default FinancesBuild;
