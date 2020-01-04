import Button from '@material-ui/core/Button';
import * as React from 'react';

export interface StateProps {
}

export interface DispatchProps {
  onSettings: () => any;
  onStart: () => any;
  onTutorial: () => any;
}

export interface Props extends StateProps, DispatchProps {}

// TODO option to resume a saved game; if you try to start a new game w/ a saved game, prompt that it'll delete the save
  // (also, winning / ending a game should clear its save)
const MainMenu = (props: Props): JSX.Element => {
  return (
    <div id="menuCard">
      <div className="logo">
        <img src="images/logo.svg"></img>
      </div>
      <div id="centeredMenu">
        <Button size="large" variant="contained" color="primary" onClick={props.onStart}>New Game</Button>
        <Button variant="outlined" color="primary" onClick={props.onTutorial}>Tutorial</Button>
        <Button variant="outlined" color="primary" onClick={props.onSettings}>Settings</Button>
      </div>
    </div>
  );
};

export default MainMenu;
