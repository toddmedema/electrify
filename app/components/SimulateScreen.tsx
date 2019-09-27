import * as React from 'react'
import RaisedButton from 'material-ui/RaisedButton'


export interface SimulateScreenStateProps {};

export interface SimulateScreenDispatchProps {
  onBuildTap: () => void;
}

interface SimulateScreenProps extends SimulateScreenStateProps, SimulateScreenDispatchProps {}

const SimulateScreen = (props: SimulateScreenProps): JSX.Element => {

// TODO
// During simulation, screen gets redder as you get close to supply < demand
// If supply < demand, flash red (if not paused) and incur large fines
  return (
    <div className="simulate">
      <p>Simulate!</p>
      <RaisedButton onTouchTap={props.onBuildTap} className="simulate--button">
        Round Over
      </RaisedButton>
    </div>
  );
}

export default SimulateScreen;
