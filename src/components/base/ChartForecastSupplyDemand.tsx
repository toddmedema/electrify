import * as React from 'react';
import {VictoryArea, VictoryAxis, VictoryChart, VictoryLabel, VictoryLine, VictoryTheme} from 'victory';
import {TICK_MINUTES} from '../../Constants';
import {TickPresentFutureType} from '../../Types';
import {formatMonthChartAxis, getDateFromMinute} from '../../helpers/DateTime';
import {formatWatts} from '../../helpers/Format';
import {blackoutColor, chartTheme, demandColor, supplyColor} from '../../Theme';

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
export default class chartForecastSupplyDemand extends React.PureComponent<Props, {}> {
  public render() {
    const {domain, height, timeline, blackouts, startingYear} = this.props;
    // Downsample the data to 6 per day to make it more vague / forecast-y
    const data = timeline.filter((t: TickPresentFutureType) => t.minute % 240 < TICK_MINUTES);
    // Make sure it gets the first + last entries for a full chart
    data.unshift(timeline[0]);
    data.push(timeline[timeline.length - 1]);

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
          data={data}
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
          data={data}
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
