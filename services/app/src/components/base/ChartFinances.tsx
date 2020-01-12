import {MONTHS} from 'app/Constants';
import * as React from 'react';
import {formatMoneyConcise} from 'shared/helpers/Format';
import {demandColor} from 'shared/Theme';
import {VictoryAxis, VictoryChart, VictoryLabel, VictoryLine, VictoryTheme} from 'victory';

interface ChartData {
  month: number; // unique across years
  year: number;
  profit: number;
  projected: boolean;
}

export interface Props {
  height?: number;
  title: string;
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
  const past = [] as ChartData[];
  const projected = [] as ChartData[];
  props.timeline.forEach((d: ChartData) => {
    domainMin = Math.min(domainMin, d.profit);
    domainMax = Math.max(domainMax, d.profit);
    if (d.projected) {
      projected.push(d);
    } else {
      past.push(d);
    }
  });
  if (projected.length > 0 && past.length > 0) {
    projected.push(past[past.length - 1]);
  }
  const multiyear = rangeMax - rangeMin > 12;

  // Wrapping in spare div prevents excessive height bug
  return (
    <div>
      <VictoryChart
        theme={VictoryTheme.material}
        padding={{ top: 10, bottom: 25, left: 55, right: 5 }}
        domain={{ x: [rangeMin, rangeMax], y: [domainMin, domainMax] }}
        domainPadding={{y: [6, 6]}}
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
          tickFormat={(t) => formatMoneyConcise(t)}
          tickLabelComponent={<VictoryLabel dx={5} />}
          fixLabelOverlap={true}
          style={{
            axis: {
              stroke: 'black', strokeWidth: 1,
            },
          }}
        />
        <VictoryLine
          data={past}
          x="month"
          y="profit"
          style={{
            data: {
              stroke: demandColor,
            },
          }}
        />
        <VictoryLine
          data={projected}
          x="month"
          y="profit"
          style={{
            data: {
              stroke: demandColor,
              strokeDasharray: '4,4',
            },
          }}
        />
        <VictoryLabel
          textAnchor="middle"
          x={200} y={7}
          text={props.title}
        />
      </VictoryChart>
    </div>
  );
};
export default ChartFinances;
