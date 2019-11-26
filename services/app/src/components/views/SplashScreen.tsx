import Button from '@material-ui/core/Button';
import * as React from 'react';

export interface StateProps {
}

export interface DispatchProps {
  onStart: () => any;
}

export interface Props extends StateProps, DispatchProps {}

const SplashScreen = (props: Props): JSX.Element => {
  const splashClass = 'splashScreen';
  return (
    <div className={splashClass}>
      <div className="logo">
        <img src="images/logo.svg"></img>
      </div>
      <Button onClick={props.onStart}>Hi</Button>
    </div>
  );
};

export default SplashScreen;
