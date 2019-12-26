import CircularProgress from '@material-ui/core/CircularProgress';
import * as React from 'react';

export interface StateProps {
}

export interface DispatchProps {
  load: () => void;
}

export interface Props extends StateProps, DispatchProps {}

const Loading = (props: Props): JSX.Element => {
  props.load();

  return (
    <CircularProgress />
  );
};

export default Loading;
