import {Button, IconButton} from '@material-ui/core';
import EmailIcon from '@material-ui/icons/Email';
import FacebookIcon from '@material-ui/icons/Facebook';
import InfoIcon from '@material-ui/icons/Info';
import * as React from 'react';

import {openWindow} from '../../Globals';

export interface StateProps {
}

export interface DispatchProps {
  onSettings: () => void;
  onManual: () => void;
  onStart: () => void;
  onTutorial: () => void;
}

export interface Props extends StateProps, DispatchProps {}

// TODO option to resume a saved game; if you try to start a new game w/ a saved game, prompt that it'll delete the save
const MainMenu = (props: Props): JSX.Element => {
  return (
    <div id="menuCard">
      <div id="logo">
        <img src="images/logo.svg"></img>
      </div>
      <div id="centeredMenu">
        <Button size="large" variant="contained" color="primary" onClick={props.onTutorial} autoFocus>Learn to play</Button>
        <Button size="large" variant="contained" color="primary" onClick={props.onStart}>New Game</Button>
        <Button variant="outlined" color="primary" onClick={props.onManual}>Manual</Button>
        <Button variant="outlined" color="primary" onClick={props.onSettings}>Options</Button>
      </div>
      <div style={{position: 'absolute', bottom: 0, left: 0, right: 0, opacity: 0.7}}>
        <IconButton color="primary" onClick={() => openWindow('https://fabricate.us10.list-manage.com/subscribe?u=792afb261df839e73b669f83f&id=8ccd05ccba')}>
          <EmailIcon/>
        </IconButton>
        <IconButton color="primary" onClick={() => openWindow('https://www.facebook.com/electrifygame')}>
          <FacebookIcon/>
        </IconButton>
        <IconButton color="primary" onClick={() => openWindow('/about.html')}>
          <InfoIcon/>
        </IconButton>
      </div>
    </div>
  );
};

export default MainMenu;
