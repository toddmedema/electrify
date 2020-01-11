import CircularProgress from '@material-ui/core/CircularProgress';
import {GameStateType} from 'app/Types';
import * as React from 'react';

export interface StateProps {
  gameState: GameStateType;
}

export interface DispatchProps {
  load: (gameState: GameStateType) => void;
}

export interface Props extends StateProps, DispatchProps {}

export default class Loading extends React.PureComponent<Props, {}> {
  constructor(props: Props) {
    super(props);
    props.load(props.gameState);
  }

  public render() {
    return (
      <CircularProgress />
    );
  }
}
