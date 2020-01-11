import * as React from 'react';
import GameCard from '../base/GameCard';

export interface StateProps {
}

export interface DispatchProps {
}

export interface Props extends StateProps, DispatchProps {}

interface State {
  year: number;
}

export default class extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = {year: 0};
  }

  public render() {
    return (
      <GameCard className="Forecasts">
        <div>Long term forecasts - future weather, demand + supply, ???</div>
        <div className="scrollable">...</div>
      </GameCard>
    );
  }
}
