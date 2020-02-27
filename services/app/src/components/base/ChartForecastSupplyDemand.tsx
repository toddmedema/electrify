import {TickPresentFutureType} from 'app/Types';
import * as React from 'react';
import {formatMonthChartAxis, getDateFromMinute} from 'shared/helpers/DateTime';
import {formatWatts} from 'shared/helpers/Format';
import {blackoutColor, chartTheme, demandColor, supplyColor} from 'shared/Theme';
import {VictoryArea, VictoryAxis, VictoryChart, VictoryLabel, VictoryLine, VictoryTheme} from 'victory';

interface BlackoutEdges {
  minute: number;
  value: number;
}

export interface Props {
  height?: number;
  timeline: TickPresentFutureType[];
  blackouts: BlackoutEdges[];
  domain: { x: [number, number], y: [number, number] };
  startingYear: number;
}

// This is a pureComponent because its props should change much less frequently than it renders
export default class extends React.PureComponent<Props, {}> {
  public render() {
    const {domain, height, timeline, blackouts, startingYear} = this.props;

    // Wrapping in spare div prevents excessive height bug
    return <div id="chartForecastSupplyDemand">
      <VictoryChart
        theme={VictoryTheme.material}
        padding={{ top: 5, bottom: 25, left: 55, right: 5 }}
        domain={domain}
        domainPadding={{y: [6, 6]}}
        height={height || 300}
      >
        <VictoryAxis
          tickCount={6}
          tickFormat={(t) => formatMonthChartAxis(getDateFromMinute(t, startingYear).monthNumber, false)}
          tickLabelComponent={<VictoryLabel dy={-5} />}
          style={{
            axis: chartTheme.axis,
            grid: {
              display: 'none',
            },
            tickLabels: chartTheme.tickLabels,
          }}
        />
        <VictoryAxis dependentAxis
          tickFormat={(t: number) => formatWatts(t)}
          tickLabelComponent={<VictoryLabel dx={5} />}
          fixLabelOverlap={true}
          style={{
            axis: chartTheme.axis,
            grid: {
              display: 'none',
            },
            tickLabels: chartTheme.tickLabels,
          }}
        />
        <VictoryLine
          data={timeline}
          x="minute"
          y="supplyW"
          style={{
            data: {
              stroke: supplyColor,
              strokeWidth: 1,
            },
          }}
        />
        <VictoryLine
          data={timeline}
          x="minute"
          y="demandW"
          style={{
            data: {
              stroke: demandColor,
            },
          }}
        />
        <VictoryArea
          data={blackouts}
          x="minute"
          y="value"
          style={{
            data: {
              stroke: 'none',
              fill: blackoutColor,
              opacity: 0.3,
            },
          }}
        />
      </VictoryChart>
    </div>;
  }
}
