import * as React from 'react';
import {formatWatts} from 'shared/Helpers/Format';
import { blackoutColor, demandColor, supplyColor } from 'shared/Theme';
import { VictoryArea, VictoryAxis, VictoryChart, VictoryLabel, VictoryLegend, VictoryLine, VictoryTheme } from 'victory';

interface ChartData {
  hour: number;
  supplyW: number;
  demandW: number;
}

interface BlackoutEdges {
  hour: number;
  value: number;
}

export interface Props {
  height?: number;
  sunrise: number;
  sunset: number;
  timeline: ChartData[];
}

// http://jsfiddle.net/justin_c_rounds/Gd2S2/light/
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

// TODO how to indicate reality vs forecast? Perhaps current time as a prop, and then split it in the chart
// and don't actually differentiate between reality +  forecast in data?
const Chart = (props: Props): JSX.Element => {
  // Figure out the boundaries of the chart data
  let domainMin = 999999999999;
  let domainMax = 0;
  let rangeMin = 999999999999;
  let rangeMax = 0;
  props.timeline.forEach((d: ChartData) => {
    domainMin = Math.min(domainMin, d.supplyW, d.demandW);
    domainMax = Math.max(domainMax, d.supplyW, d.demandW);
    rangeMin = Math.min(rangeMin, d.hour);
    rangeMax = Math.max(rangeMax, d.hour);
  });

  // Use that to slide sunrise / sunset forward to the correct hour
  const midnight = Math.floor(rangeMin / 24) * 24;
  let sunrise = midnight + props.sunrise;
  let sunset = midnight + props.sunset;
  if (sunrise < rangeMin) {
    sunrise += 24;
  }
  if (sunset < rangeMin) {
    sunset += 24;
  }

  // BLACKOUT CALCULATION
  const blackouts = [{
    hour: rangeMin,
    value: 0,
  }] as BlackoutEdges[];
  let prev = props.timeline[0];
  let isBlackout = prev.demandW > prev.supplyW;
  if (isBlackout) {
    blackouts.push({
      hour: rangeMin,
      value: domainMax,
    });
  }
  props.timeline.forEach((d: ChartData) => {
    const intersectionTime = getIntersectionX(d.hour - 1, prev.supplyW, d.hour, d.supplyW, d.hour - 1, prev.demandW, d.hour, d.demandW);
    if (d.demandW > d.supplyW && !isBlackout) {
      // Blackout starting: low then high edge
      blackouts.push({ hour: intersectionTime, value: 0 });
      blackouts.push({ hour: intersectionTime, value: domainMax });
      isBlackout = true;
    } else if (d.demandW < d.supplyW && isBlackout) {
      // Blackout ending: high then low edge
      blackouts.push({ hour: intersectionTime, value: domainMax });
      blackouts.push({ hour: intersectionTime, value: 0 });
      isBlackout = false;
    }
    prev = d;
  });
  // Final entry
  if (isBlackout) {
    blackouts.push({
      hour: rangeMax,
      value: domainMax,
    });
  } else {
    blackouts.push({
      hour: rangeMax,
      value: 0,
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
          tickValues={[sunrise, sunset]}
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
          tickFormat={formatWatts}
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
          data={props.timeline}
          interpolation="monotoneX"
          x="hour"
          y="supplyW"
          style={{
            data: {
              stroke: supplyColor,
              fill: '#e3f2fd', // blue50
            },
          }}
        />
        <VictoryLine
          data={props.timeline}
          interpolation="monotoneX"
          x="hour"
          y="demandW"
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
