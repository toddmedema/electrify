import {TICK_MINUTES} from 'app/Constants';
import {TickPresentFutureType} from 'app/Types';
import * as React from 'react';
import {formatMonthChartAxis, getDateFromMinute} from 'shared/helpers/DateTime';
import {formatMoneyConcise} from 'shared/helpers/Format';
import {chartTheme, coalColor, naturalGasColor, uraniumColor} from 'shared/Theme';
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
    // Downsample the data to one per day to make it more vague / forecast-y
    const data = timeline.filter((t: TickPresentFutureType) => t.minute % 1440 < TICK_MINUTES);
    // Make sure it gets the first + last entries for a full chart
    data.unshift(timeline[0]);
    data.push(timeline[timeline.length - 1]);

    // Wrapping in spare div prevents excessive height bug
    return (
      <div id="chartForecastFuelPrices">
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
            axisLabelComponent={<VictoryLabel dy={-30} />}
            label="Per MMBTU"
            tickFormat={(t: number) => formatMoneyConcise(t)}
            tickLabelComponent={<VictoryLabel dx={5} />}
            fixLabelOverlap={true}
            style={{
              axis: chartTheme.axis,
              tickLabels: chartTheme.tickLabels,
            }}
          />
          <VictoryLine
            data={data}
            x="minute"
            y="Natural Gas"
            interpolation="natural"
            style={{
              data: {
                stroke: naturalGasColor,
                strokeWidth: 1,
              },
            }}
          />
          <VictoryLine
            data={data}
            x="minute"
            y="Coal"
            interpolation="natural"
            style={{
              data: {
                stroke: coalColor,
                strokeWidth: 1,
              },
            }}
          />
          <VictoryLine
            data={data}
            x="minute"
            y="Uranium"
            interpolation="natural"
            style={{
              data: {
                stroke: uraniumColor,
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
              { name: 'Coal', symbol: { fill: coalColor } },
              { name: 'Natural Gas', symbol: { fill: naturalGasColor } },
              { name: 'Uranium', symbol: { fill: uraniumColor } },
            ]}
          />
        </VictoryChart>
      </div>
    );
  }
}
