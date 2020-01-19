import * as React from 'react';
import {getDateFromMinute} from 'shared/helpers/DateTime';
import {formatWatts} from 'shared/helpers/Format';
import {getIntersectionX} from 'shared/helpers/Math';
import { blackoutColor, demandColor, supplyColor } from 'shared/Theme';
import { VictoryArea, VictoryAxis, VictoryChart, VictoryLabel, VictoryLegend, VictoryLine, VictoryTheme } from 'victory';

interface ChartData {
  minute: number;
  supplyW: number;
  demandW: number;
}

interface BlackoutEdges {
  minute: number;
  value: number;
}

export interface Props {
  currentMinute?: number;
  height?: number;
  legend?: boolean;
  timeline: ChartData[];
}

// TODO how to indicate reality vs forecast? Perhaps current time as a prop, and then split it in the chart
// and don't actually differentiate between reality +  forecast in data?
const ChartSupplyDemand = (props: Props): JSX.Element => {
  // Figure out the boundaries of the chart data
  let domainMin = 999999999999;
  let domainMax = 0;
  const rangeMin = props.timeline[0].minute;
  const rangeMax = props.timeline[props.timeline.length - 1].minute;
  props.timeline.forEach((d: ChartData) => {
    domainMin = Math.min(domainMin, d.supplyW, d.demandW);
    domainMax = Math.max(domainMax, d.supplyW, d.demandW);
  });

  // Get sunrise and sunset, sliding forward if it's actually in the next day
  const date = getDateFromMinute(rangeMin);
  const midnight = Math.floor(rangeMin / 1440) * 1440;
  let sunrise = midnight + date.sunrise;
  let sunset = midnight + date.sunset;
  if (sunrise < rangeMin) {
    sunrise = midnight + 1440 + getDateFromMinute(rangeMin + 1440).sunrise;
  }
  if (sunset < rangeMin) {
    sunset = midnight + 1440 + getDateFromMinute(rangeMin + 1440).sunset;
  }

  // BLACKOUT CALCULATION
  let blackoutCount = 0;
  const blackouts = [{
    minute: rangeMin,
    value: 0,
  }] as BlackoutEdges[];
  let prev = props.timeline[0];
  let isBlackout = prev.demandW > prev.supplyW;
  if (isBlackout) {
    blackouts.push({
      minute: rangeMin,
      value: domainMax,
    });
    blackoutCount++;
  }
  props.timeline.forEach((d: ChartData) => {
    if (d.demandW > d.supplyW && !isBlackout) {
      // Blackout starting: low then high edge
      const intersectionTime = getIntersectionX(prev.minute, prev.supplyW, d.minute, d.supplyW, prev.minute, prev.demandW, d.minute, d.demandW);
      blackouts.push({ minute: intersectionTime, value: 0 });
      blackouts.push({ minute: intersectionTime, value: domainMax });
      isBlackout = true;
      blackoutCount++;
    } else if (d.demandW < d.supplyW && isBlackout) {
      // Blackout ending: high then low edge
      const intersectionTime = getIntersectionX(prev.minute, prev.supplyW, d.minute, d.supplyW, prev.minute, prev.demandW, d.minute, d.demandW);
      blackouts.push({ minute: intersectionTime, value: domainMax });
      blackouts.push({ minute: intersectionTime, value: 0 });
      isBlackout = false;
    }
    prev = d;
  });
  // Final entry
  blackouts.push({
    minute: rangeMax,
    value: (isBlackout) ? domainMax : 0,
  });

  // Divide between historic and forcast
  const currentMinute = props.currentMinute || rangeMax;
  const historic = [...props.timeline].filter((d: ChartData) => d.minute <= currentMinute);
  const forecast = [...props.timeline].filter((d: ChartData) => d.minute >= currentMinute);

  const legendItems = [
    { name: 'Supply', symbol: { fill: supplyColor } },
    { name: 'Demand', symbol: { fill: demandColor } },
  ];
  if (blackoutCount > 0) {
    legendItems.push({ name: 'Blackout', symbol: { fill: blackoutColor } });
  }

  // Wrapping in spare div prevents excessive height bug
  return (
    <div>
      <VictoryChart
        theme={VictoryTheme.material}
        padding={{ top: 10, bottom: 25, left: 55, right: 5 }}
        domain={{ y: [domainMin, domainMax] }}
        domainPadding={{y: [6, 6]}}
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
        <VictoryArea
          data={historic}
          x="minute"
          y="supplyW"
          style={{
            data: {
              stroke: supplyColor,
              strokeWidth: 2,
              fill: '#e3f2fd', // blue50
            },
          }}
        />
        <VictoryLine
          data={historic}
          x="minute"
          y="demandW"
          style={{
            data: {
              stroke: demandColor,
              strokeWidth: 4,
            },
          }}
        />
        <VictoryLine
          data={forecast}
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
          data={forecast}
          x="minute"
          y="demandW"
          style={{
            data: {
              stroke: demandColor,
            },
          }}
        />
        {blackoutCount > 0 && <VictoryArea
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
        />}
        {currentMinute !== rangeMax && <VictoryLine
          data={[{x: currentMinute, y: domainMin}, {x: currentMinute, y: domainMax}]}
          style={{
            data: {
              stroke: '#000000',
              strokeWidth: 1,
              opacity: 0.5,
            },
          }}
        />}
        {props.legend && <VictoryLegend x={280} y={12}
          centerTitle
          orientation="vertical"
          rowGutter={-5}
          symbolSpacer={5}
          data={legendItems}
        />}
      </VictoryChart>
    </div>
  );
};
export default ChartSupplyDemand;
