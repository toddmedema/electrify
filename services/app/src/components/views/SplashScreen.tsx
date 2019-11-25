import Button from '@material-ui/core/Button';
import * as React from 'react';
import {AnnouncementState} from '../../reducers/StateTypes';

export interface StateProps {
  announcement: AnnouncementState;
}

export interface DispatchProps {
  onAnnouncementTap: (announcement: AnnouncementState) => void;
  onStart: () => any;
}

export interface Props extends StateProps, DispatchProps {}

const SplashScreen = (props: Props): JSX.Element => {
  const announcementVisible = (props.announcement && props.announcement.open && props.announcement.message !== '');
  const splashClass = 'splashScreen' + (announcementVisible ? ' announcing' : '');
  return (
    <div className={splashClass}>
      {announcementVisible &&
        <Button className="announcement" onClick={() => props.onAnnouncementTap(props.announcement)}>
          {props.announcement.message} {props.announcement.link && <img className="inline_icon" src="images/new_window_white.svg" />}
        </Button>
      }
      <div className="logo">
        <img src="images/logo.png"></img>
      </div>
    </div>
  );
};

export default SplashScreen;
