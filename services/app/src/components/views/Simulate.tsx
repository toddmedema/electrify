import Button from '@material-ui/core/Button';
import * as React from 'react';

export interface StateProps {
}

export interface DispatchProps {
  onNextSeason: () => void;
}

export interface Props extends StateProps, DispatchProps {}

const Simulate = (props: Props): JSX.Element => {
  return (
    <div className="Simulate">
      Simulate
      <Button onClick={props.onNextSeason}>NEXT</Button>
    </div>
  );
};

export default Simulate;
