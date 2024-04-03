import * as React from 'react';
import {CircularProgress} from '@mui/material';
import {GameType} from '../../Types';

export interface StateProps {
  game: GameType;
}

export interface DispatchProps {
  load: (game: GameType) => void;
}

export interface Props extends StateProps, DispatchProps {}

export default class Loading extends React.PureComponent<Props, {}> {
  constructor(props: Props) {
    super(props);
    props.load(props.game);
  }

  public render() {
    return (
      <div className="flex-fully-centered">
        <div id="logo" className="fadein-slow">
          <img src="images/logo.svg" alt="Logo"></img>
        </div>
        <CircularProgress className="fadein-fast" size={60} />
      </div>
    );
  }
}
