import {TimelineType} from 'app/Types';
import * as React from 'react';
import {formatMonthChartAxis, getDateFromMinute} from 'shared/helpers/DateTime';
import {formatMoneyConcise} from 'shared/helpers/Format';
import {coalColor, naturalGasColor, uraniumColor} from 'shared/Theme';
import {VictoryAxis, VictoryChart, VictoryLabel, VictoryLegend, VictoryLine, VictoryTheme} from 'victory';

export interface Props {
  height?: number;
  timeline: TimelineType[];
  domain: { x: [number, number] };
}

const ChartForecastFuelPrices = (props: Props): JSX.Element => {
  // Wrapping in spare div prevents excessive height bug
  return (
    <div>
      <VictoryChart
        theme={VictoryTheme.material}
        padding={{ top: 10, bottom: 25, left: 55, right: 5 }}
        domain={props.domain}
        domainPadding={{y: [6, 6]}}
        height={props.height || 300}
      >
        <VictoryAxis
          tickCount={6}
          tickFormat={(t) => formatMonthChartAxis(getDateFromMinute(t).monthNumber, false)}
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
          tickFormat={(t: number) => formatMoneyConcise(t)}
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
          data={props.timeline}
          x="minute"
          y="Natural Gas"
          style={{
            data: {
              stroke: naturalGasColor,
              strokeWidth: 1,
            },
          }}
        />
        <VictoryLine
          data={props.timeline}
          x="minute"
          y="Coal"
          style={{
            data: {
              stroke: coalColor,
              strokeWidth: 1,
            },
          }}
        />
        <VictoryLine
          data={props.timeline}
          x="minute"
          y="Uranium"
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
        <VictoryLabel
          textAnchor="middle"
          x={200} y={7}
          text="Fuel prices (/mbtu)"
        />
      </VictoryChart>
    </div>
  );
};
export default ChartForecastFuelPrices;
