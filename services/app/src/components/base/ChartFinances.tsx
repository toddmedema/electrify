import {MONTHS} from 'app/Constants';
import * as React from 'react';
import {formatMoneyConcise} from 'shared/helpers/Format';
import {demandColor} from 'shared/Theme';
import {VictoryAxis, VictoryChart, VictoryLabel, VictoryLegend, VictoryLine, VictoryTheme} from 'victory';

interface ChartData {
  month: number; // unique across years
  year: number;
  profit: number;
}

export interface Props {
  height?: number;
  timeline: ChartData[];
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
          tickFormat={(t) => MONTHS[t % 12]}
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
            grid: {
              display: 'none',
            },
          }}
        />
        <VictoryLine
          data={props.timeline}
          x="month"
          y="profit"
          style={{
            data: {
              stroke: demandColor,
              strokeWidth: 4,
            },
          }}
        />
        <VictoryLegend x={280} y={12}
          centerTitle
          orientation="vertical"
          rowGutter={-5}
          symbolSpacer={5}
          data={[
            { name: 'Profit', symbol: { fill: demandColor } },
          ]}
        />
      </VictoryChart>
    </div>
  );
};
export default ChartFinances;
