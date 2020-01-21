import {TimelineType} from 'app/Types';
import * as React from 'react';
import {formatMonthChartAxis, getDateFromMinute} from 'shared/helpers/DateTime';
import {formatWatts} from 'shared/helpers/Format';
import { blackoutColor, demandColor, supplyColor } from 'shared/Theme';
import { VictoryArea, VictoryAxis, VictoryChart, VictoryLabel, VictoryLine, VictoryTheme } from 'victory';

interface BlackoutEdges {
  minute: number;
  value: number;
}

export interface Props {
  height?: number;
  timeline: TimelineType[];
  blackouts: BlackoutEdges[];
  domain: { x: [number, number], y: [number, number] };
  startingYear: number;
}

// This is a pureComponent because its props should change much less frequently than it renders
export default class extends React.PureComponent<Props, {}> {
  public render() {
    const {domain, height, timeline, blackouts, startingYear} = this.props;

    // Wrapping in spare div prevents excessive height bug
    return <div>
      <VictoryChart
        theme={VictoryTheme.material}
        padding={{ top: 10, bottom: 25, left: 55, right: 5 }}
        domain={domain}
        domainPadding={{y: [6, 6]}}
        height={height || 300}
      >
        <VictoryAxis
          tickCount={6}
          tickFormat={(t) => formatMonthChartAxis(getDateFromMinute(t, startingYear).monthNumber, false)}
          tickLabelComponent={<VictoryLabel dy={-5} />}
          axisLabelComponent={<VictoryLabel dy={2} />}
          style={{
            axis: {
              stroke: 'black', strokeWidth: 1,
            },
            grid: {
              display: 'none',
            },
          }}
        />
        <VictoryAxis dependentAxis
          tickFormat={(t: number) => formatWatts(t)}
          tickLabelComponent={<VictoryLabel dx={5} />}
          fixLabelOverlap={true}
          style={{
            axis: {
              stroke: 'black', strokeWidth: 1,
            },
            grid: {
              display: 'none',
            },
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
        <VictoryLabel
          textAnchor="middle"
          x={200} y={7}
          text="Supply & Demand"
        />
      </VictoryChart>
    </div>;
  }
}
