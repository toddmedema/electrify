import * as React from 'react'
import RaisedButton from 'material-ui/RaisedButton'


export interface SplashScreenStateProps {};

export interface SplashScreenDispatchProps {
  onAdTap: () => void;
  onContinueTap: () => void;
  onPlayTap: () => void;
  onTutorialTap: () => void;
}

interface SplashScreenProps extends SplashScreenStateProps, SplashScreenDispatchProps {}

const SplashScreen = (props: SplashScreenProps): JSX.Element => {

// TODO more intelligent buttons:
// If never played tutorial: Tutorial on top + primary, then Play
// else, If save game: Continue primary, then New Game, then tutorial
// else (If no save): Play primary, then tutorial
  return (
    <div className="splash">
      <div className="splash--logo">
        <img src="images/logo.png"></img>
      </div>
      <div className="splash--menu">
        <RaisedButton onTouchTap={props.onTutorialTap} primary={true} className="splash--button splash--button--primary">
          Tutorial
        </RaisedButton>
        <RaisedButton onTouchTap={props.onPlayTap} className="splash--button">
          Play
        </RaisedButton>
        <RaisedButton onTouchTap={props.onContinueTap} className="splash--button">
          Continue
        </RaisedButton>
      </div>
      <RaisedButton className="splash--ad" onTouchTap={() => props.onAdTap()}>
        Expedition!
      </RaisedButton>
    </div>
  );
}

export default SplashScreen;
