import {Button} from '@material-ui/core';
import * as React from 'react';

import {openWindow} from '../../Globals';

export interface StateProps {
}

export interface DispatchProps {
  onSettings: () => void;
  onManual: () => void;
  onStart: () => void;
}

export interface Props extends StateProps, DispatchProps {}

// TODO option to resume a saved game; if you try to start a new game w/ a saved game, prompt that it'll delete the save
  // (also, winning / ending a game should clear its save)
const MainMenu = (props: Props): JSX.Element => {
  return (
    <div id="menuCard">
      <div id="logo">
        <img src="images/logo.svg"></img>
      </div>
      <div id="centeredMenu">
        <Button size="large" variant="contained" color="primary" onClick={props.onStart} autoFocus>New Game</Button>
        <Button variant="outlined" color="primary" onClick={props.onSettings}>Settings</Button>
        <Button variant="outlined" color="primary" onClick={props.onManual}>Manual</Button>
      </div>
      <Button style={{position: 'absolute', bottom: 0, left: 0}} color="primary" onClick={() => openWindow('https://fabricate.us10.list-manage.com/subscribe?u=792afb261df839e73b669f83f&id=8ccd05ccba')}>Subscribe</Button>
      <Button style={{position: 'absolute', bottom: 0, left: '50%', transform: 'translateX(-50%)'}} color="primary" onClick={() => openWindow('/about.html')}>About</Button>
      <Button style={{position: 'absolute', bottom: 0, right: 0}} color="primary" onClick={() => openWindow('mailto:todd@fabricate.io')}>Contact</Button>
    </div>
  );
};

export default MainMenu;
