import { Button, Typography } from '@material-ui/core';
import * as React from 'react';

export interface StateProps {
}

export interface DispatchProps {
  onStart: () => void;
}

export interface Props extends StateProps, DispatchProps {}

const GameSetup = (props: Props): JSX.Element => {
  return (
    <div id="menuCard">
      <Typography variant="h4" gutterBottom>Game Setup</Typography>
      <div id="centeredMenu">
        <Button size="large" variant="contained" color="primary" onClick={props.onStart}>Play</Button>
      </div>
    </div>
  );
};

export default GameSetup;
