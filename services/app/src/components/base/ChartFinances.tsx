import {MONTHS} from 'app/Constants';
import * as React from 'react';
import {formatMoneyConcise} from 'shared/helpers/Format';
import {demandColor} from 'shared/Theme';
import {VictoryAxis, VictoryBar, VictoryChart, VictoryLabel, VictoryTheme} from 'victory';

interface ChartData {
  month: number; // unique across years
  year: number;
  profit: number;
}

export interface Props {
  height?: number;
  timeline: ChartData[];
}

function formatMonth(t: number, multiyear: boolean) {
  if (multiyear) {
    return (t % 12 + 1) + '/' + Math.floor(t / 12).toString().slice(-2);
  }
  return MONTHS[t % 12];
}

const ChartFinances = (props: Props): JSX.Element => {
  // Figure out the boundaries of the chart data
  let domainMin = 0;
  let domainMax = 0;
  const rangeMin = props.timeline[0].month;
  const rangeMax = Math.max(rangeMin + 11, props.timeline[props.timeline.length - 1].month);
  props.timeline.forEach((d: ChartData) => {
    domainMin = Math.min(domainMin, d.profit);
    domainMax = Math.max(domainMax, d.profit);
  });
  const multiyear = rangeMax - rangeMin > 12;

  // Wrapping in spare div prevents excessive height bug
  return (
    <div>
      <VictoryChart
        theme={VictoryTheme.material}
        padding={{ top: 10, bottom: 25, left: 55, right: 5 }}
        domain={{ x: [rangeMin, rangeMax], y: [domainMin, domainMax] }}
        domainPadding={{x: [5, 5], y: [6, 6]}}
        height={props.height || 300}
      >
        <VictoryAxis
          tickFormat={(t) => formatMonth(t, multiyear)}
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
          tickFormat={formatMoneyConcise}
          tickLabelComponent={<VictoryLabel dx={5} />}
          fixLabelOverlap={true}
          style={{
            axis: {
              stroke: 'black', strokeWidth: 1,
            },
          }}
        />
        <VictoryBar
          data={props.timeline}
          x="month"
          y="profit"
          barWidth={10}
          // barRatio={0.9}
          style={{
            data: {
              stroke: demandColor,
            },
          }}
        />
        <VictoryLabel
          textAnchor="middle"
          x={200} y={7}
          text="Profit"
        />
      </VictoryChart>
    </div>
  );
};
export default ChartFinances;
