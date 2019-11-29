import * as React from 'react';
import { blackoutColor, demandColor, supplyColor } from 'shared/Theme';
import { VictoryArea, VictoryAxis, VictoryChart, VictoryLabel, VictoryLegend, VictoryLine, VictoryTheme } from 'victory';

const numbro = require('numbro');

interface ChartData {
  hour: number;
  supply: number;
  demand: number;
}

interface BlackoutEdges {
  hour: number;
  value: number;
}

export interface Props {
  height?: number;
  sunrise: number;
  sunset: number;
  forecast: ChartData[];
}

/// http://jsfiddle.net/justin_c_rounds/Gd2S2/light/
function getIntersectionX(line1StartX: number, line1StartY: number, line1EndX: number, line1EndY: number, line2StartX: number, line2StartY: number, line2EndX: number, line2EndY: number) {
    const denominator = ((line2EndY - line2StartY) * (line1EndX - line1StartX)) - ((line2EndX - line2StartX) * (line1EndY - line1StartY));
    if (denominator === 0) {
      return 0;
    }
    const a = line1StartY - line2StartY;
    const b = line1StartX - line2StartX;
    const numerator1 = ((line2EndX - line2StartX) * a) - ((line2EndY - line2StartY) * b);
    return line1StartX + (numerator1 / denominator * (line1EndX - line1StartX));
}

const Chart = (props: Props): JSX.Element => {
  let domainMin = 999999999999;
  let domainMax = 0;
  props.forecast.forEach((d: ChartData) => {
    domainMin = Math.min(domainMin, d.supply, d.demand);
    domainMax = Math.max(domainMax, d.supply, d.demand);
  });

  // BLACKOUT CALCULATION
  const blackouts = [{
    hour: 1,
    value: domainMin,
  }] as BlackoutEdges[];
  let prev = props.forecast[0];
  let isBlackout = prev.demand > prev.supply;
  if (isBlackout) {
    blackouts.push({
      hour: 1,
      value: domainMax,
    });
  }
  props.forecast.forEach((d: ChartData) => {
    const intersectionTime = getIntersectionX(d.hour - 1, prev.supply, d.hour, d.supply, d.hour - 1, prev.demand, d.hour, d.demand);
    if (d.demand > d.supply && !isBlackout) {
      // Blackout starting: low then high edge
      blackouts.push({ hour: intersectionTime, value: domainMin });
      blackouts.push({ hour: intersectionTime, value: domainMax });
      isBlackout = true;
    } else if (d.demand < d.supply && isBlackout) {
      // Blackout ending: high then low edge
      blackouts.push({ hour: intersectionTime, value: domainMax });
      blackouts.push({ hour: intersectionTime, value: domainMin });
      isBlackout = false;
    }
    prev = d;
  });
  // Final entry
  if (isBlackout) {
    blackouts.push({
      hour: 24,
      value: domainMax,
    });
  } else {
    blackouts.push({
      hour: 24,
      value: domainMin,
    });
  }

  // Wrapping in spare div prevents weird excessive height bug
  return (
    <div>
      <VictoryChart
        theme={VictoryTheme.material}
        padding={{ top: 10, bottom: 25, left: 50, right: 10 }}
        domain={{ y: [domainMin * .95, domainMax] }}
        height={props.height || 300}
      >
        <VictoryAxis
          tickValues={[props.sunrise, props.sunset]}
          tickFormat={['sunrise', 'sunset']}
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
          tickFormat={(i) => numbro(i).format({spaceSeparated: false, average: true}) + 'W'}
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
        <VictoryArea
          data={props.forecast}
          interpolation="monotoneX"
          x="hour"
          y="supply"
          style={{
            data: {
              stroke: supplyColor,
              fill: '#e3f2fd', // blue50
            },
          }}
        />
        <VictoryLine
          data={props.forecast}
          interpolation="monotoneX"
          x="hour"
          y="demand"
          style={{
            data: {
              stroke: demandColor,
              strokeWidth: 3,
            },
          }}
        />
        <VictoryArea
          data={blackouts}
          x="hour"
          y="value"
          style={{
            data: {
              stroke: 'none',
              fill: blackoutColor,
              opacity: 0.35,
            },
          }}
        />
        <VictoryLegend x={280} y={12}
          centerTitle
          orientation="vertical"
          rowGutter={-5}
          symbolSpacer={5}
          data={[
            { name: 'Supply', symbol: { fill: supplyColor } },
            { name: 'Demand', symbol: { fill: demandColor } },
            { name: 'Blackout', symbol: { fill: blackoutColor } },
          ]}
        />
      </VictoryChart>
    </div>
  );
};
export default Chart;
