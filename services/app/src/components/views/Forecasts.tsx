import {TICKS_PER_YEAR} from 'app/Constants';
import {GameStateType} from 'app/Types';
import * as React from 'react';
import {generateNewTimeline, reforecastAll} from '../../reducers/GameState';
import ChartForecastSupplyDemand from '../base/ChartForecastSupplyDemand';
import GameCard from '../base/GameCard';

const FORECAST_YEARS = 1;

export interface StateProps {
  gameState: GameStateType;
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

  public shouldComponentUpdate(nextProps: Props, nextState: any) {
    // Because forecasts are computationally intense and long term, only update when the month changes
    return (this.props.gameState.date.monthNumber !== nextProps.gameState.date.monthNumber);
  }

  public render() {
    const newState = {...this.props.gameState};
    newState.timeline = generateNewTimeline(newState.date.minute, TICKS_PER_YEAR * FORECAST_YEARS);
    newState.timeline = reforecastAll(newState);
    return (
      <GameCard className="Forecasts">
        <ChartForecastSupplyDemand
          height={180}
          timeline={newState.timeline}
          currentMinute={newState.date.minute}
        />
        <div className="scrollable">Long term forecasts - future weather, demand + supply, ???</div>
      </GameCard>
    );
  }
}
