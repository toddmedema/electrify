import {Button, IconButton} from '@material-ui/core';
import EmailIcon from '@material-ui/icons/Email';
import FacebookIcon from '@material-ui/icons/Facebook';
import InfoIcon from '@material-ui/icons/Info';
import * as React from 'react';

import {getStorageJson} from 'app/LocalStorage';
import {LocalStoragePlayedType} from 'app/Types';
import {interactiveColor} from 'shared/Theme';

export interface StateProps {
  // From auth:
  error?: any;
  user?: any;
  signInWithGoogle?: any;
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
  const plays = ((getStorageJson('plays', {plays: []}) as any).plays as LocalStoragePlayedType[]);
  const ids = plays.map((s) => s.scenarioId);
  const playedTutorial = ids.indexOf(0) !== -1 && ids.indexOf(1) !== -1;

  return (
    <div id="menuCard">
      <div id="logo">
        <img src="images/logo.svg"></img>
      </div>
      <div id="centeredMenu">
        <Button size="large" variant={!playedTutorial ? 'contained' : 'outlined'} color="primary" onClick={props.onTutorial} autoFocus={!playedTutorial}>Learn to play</Button>
        <Button size="large" variant={playedTutorial ? 'contained' : 'outlined'} color="primary" onClick={props.onStart} autoFocus={playedTutorial}>New Game</Button>
        <Button variant="outlined" color="primary" onClick={props.onManual}>Manual</Button>
        <Button variant="outlined" color="primary" onClick={props.onSettings}>Options</Button>
        {!props.user && <Button variant="outlined" color="primary" onClick={props.signInWithGoogle}>Log in</Button>}
      </div>
      <div style={{position: 'absolute', bottom: 0, left: 0, right: 0, opacity: 0.7}}>
        <IconButton color="primary" href="https://fabricate.us10.list-manage.com/subscribe?u=792afb261df839e73b669f83f&id=8ccd05ccba">
          <EmailIcon/>
        </IconButton>
        <IconButton color="primary" href="https://www.facebook.com/electrifygame">
          <FacebookIcon/>
        </IconButton>
        <IconButton color="primary" href="https://discord.gg/2fTDHE7">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 245 240" width={24}>
            <path d="M104.4 103.9c-5.7 0-10.2 5-10.2 11.1s4.6 11.1 10.2 11.1c5.7 0 10.2-5 10.2-11.1.1-6.1-4.5-11.1-10.2-11.1zM140.9 103.9c-5.7 0-10.2 5-10.2 11.1s4.6 11.1 10.2 11.1c5.7 0 10.2-5 10.2-11.1s-4.5-11.1-10.2-11.1z"/>
            <path style={{fill: interactiveColor}} d="M189.5 20h-134C44.2 20 35 29.2 35 40.6v135.2c0 11.4 9.2 20.6 20.5 20.6h113.4l-5.3-18.5 12.8 11.9 12.1 11.2 21.5 19V40.6c0-11.4-9.2-20.6-20.5-20.6zm-38.6 130.6s-3.6-4.3-6.6-8.1c13.1-3.7 18.1-11.9 18.1-11.9-4.1 2.7-8 4.6-11.5 5.9-5 2.1-9.8 3.5-14.5 4.3-9.6 1.8-18.4 1.3-25.9-.1-5.7-1.1-10.6-2.7-14.7-4.3-2.3-.9-4.8-2-7.3-3.4-.3-.2-.6-.3-.9-.5-.2-.1-.3-.2-.4-.3-1.8-1-2.8-1.7-2.8-1.7s4.8 8 17.5 11.8c-3 3.8-6.7 8.3-6.7 8.3-22.1-.7-30.5-15.2-30.5-15.2 0-32.2 14.4-58.3 14.4-58.3 14.4-10.8 28.1-10.5 28.1-10.5l1 1.2c-18 5.2-26.3 13.1-26.3 13.1s2.2-1.2 5.9-2.9c10.7-4.7 19.2-6 22.7-6.3.6-.1 1.1-.2 1.7-.2 6.1-.8 13-1 20.2-.2 9.5 1.1 19.7 3.9 30.1 9.6 0 0-7.9-7.5-24.9-12.7l1.4-1.6s13.7-.3 28.1 10.5c0 0 14.4 26.1 14.4 58.3 0 0-8.5 14.5-30.6 15.2z"/>
          </svg>
        </IconButton>
        <IconButton color="primary" href="/about.html">
          <InfoIcon/>
        </IconButton>
      </div>
    </div>
  );
};

export default MainMenu;
