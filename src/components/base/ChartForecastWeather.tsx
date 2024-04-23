import * as React from "react";
import {
  VictoryAxis,
  VictoryChart,
  VictoryLabel,
  VictoryLegend,
  VictoryLine,
  VictoryTheme,
} from "victory";
import { TICK_MINUTES } from "../../Constants";
import { TickPresentFutureType } from "../../Types";
import {
  formatMonthChartAxis,
  getDateFromMinute,
} from "../../helpers/DateTime";
import { chartTheme, temperatureColor, windColor } from "../../Theme";

export interface Props {
  height?: number;
  timeline: TickPresentFutureType[];
  domain: { x: [number, number] };
  startingYear: number;
  multiyear: boolean;
}

// This is a pureComponent because its props should change much less frequently than it renders
export default class ChartForecastWeather extends React.PureComponent<
  Props,
  {}
> {
  public render() {
    const { domain, height, timeline, startingYear, multiyear } = this.props;
    // Downsample the data to 6 per day to make it more vague / forecast-y
    const data = timeline.filter(
      (t: TickPresentFutureType) => t.minute % 240 < TICK_MINUTES
    );
    // Make sure it gets the first + last entries for a full chart
    data.unshift(timeline[0]);
    data.push(timeline[timeline.length - 1]);

    // Wrapping in spare div prevents excessive height bug
    return (
      <div id="chartForecastWeather">
        <VictoryChart
          theme={VictoryTheme.material}
          padding={{ top: 5, bottom: 25, left: 55, right: 5 }}
          domain={domain}
          domainPadding={{ y: [6, 6] }}
          height={height || 300}
        >
          <VictoryAxis
            tickCount={6}
            tickFormat={(t) =>
              formatMonthChartAxis(
                getDateFromMinute(t, startingYear).monthsEllapsed +
                  12 * startingYear,
                multiyear
              )
            }
            tickLabelComponent={<VictoryLabel dy={-5} />}
            axisLabelComponent={<VictoryLabel dy={2} />}
            style={{
              axis: chartTheme.axis,
              grid: {
                display: "none",
              },
              tickLabels: chartTheme.tickLabels,
            }}
          />
          <VictoryAxis
            dependentAxis
            tickFormat={Math.round}
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
            data={data}
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
          <VictoryLegend
            x={270}
            y={15}
            centerTitle
            orientation="vertical"
            rowGutter={-5}
            symbolSpacer={5}
            data={[
              { name: "Heat (°C)", symbol: { fill: temperatureColor } },
              { name: "Wind (Kph)", symbol: { fill: windColor } },
            ]}
          />
        </VictoryChart>
      </div>
    );
  }
}
