import {TickPresentFutureType} from 'app/Types';
import * as React from 'react';
import {formatMonthChartAxis, getDateFromMinute} from 'shared/helpers/DateTime';
import {chartTheme, temperatureColor, windColor} from 'shared/Theme';
import {VictoryAxis, VictoryChart, VictoryLabel, VictoryLegend, VictoryLine, VictoryTheme} from 'victory';

export interface Props {
  height?: number;
  timeline: TickPresentFutureType[];
  domain: { x: [number, number] };
  startingYear: number;
}

// This is a pureComponent because its props should change much less frequently than it renders
export default class extends React.PureComponent<Props, {}> {
  public render() {
    const {domain, height, timeline, startingYear} = this.props;

    // Wrapping in spare div prevents excessive height bug
    return (
      <div>
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
            axisLabelComponent={<VictoryLabel dy={2} />}
            style={{
              axis: chartTheme.axis,
              grid: {
                display: 'none',
              },
              tickLabels: chartTheme.tickLabels,
            }}
          />
          <VictoryAxis dependentAxis
            tickFormat={Math.round}
            tickLabelComponent={<VictoryLabel dx={5} />}
            fixLabelOverlap={true}
            style={{
              axis: chartTheme.axis,
              tickLabels: chartTheme.tickLabels,
            }}
          />
          <VictoryLine
            data={timeline}
            x="minute"
            y="temperatureC"
            interpolation="bundle"
            style={{
              data: {
                stroke: temperatureColor,
                strokeWidth: 1,
              },
            }}
          />
          <VictoryLine
            data={timeline}
            x="minute"
            y="windKph"
            interpolation="bundle"
            style={{
              data: {
                stroke: windColor,
                strokeWidth: 1,
              },
            }}
          />
          <VictoryLegend x={270} y={15}
            centerTitle
            orientation="vertical"
            rowGutter={-5}
            symbolSpacer={5}
            data={[
              { name: 'Heat (°C)', symbol: { fill: temperatureColor } },
              { name: 'Wind (Kph)', symbol: { fill: windColor } },
            ]}
          />
        </VictoryChart>
      </div>
    );
  }
}
