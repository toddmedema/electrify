import * as React from "react";
import {
  VictoryAxis,
  VictoryChart,
  VictoryLabel,
  VictoryLine,
  VictoryTheme,
  VictoryVoronoiContainer,
  VictoryTooltip,
} from "victory";
import { TickPresentFutureType } from "../../Types";
import {
  formatMonthChartAxis,
  getDateFromMinute,
} from "../../helpers/DateTime";
import { formatWattHours } from "../../helpers/Format";
import { chartTheme, supplyColor } from "../../Theme";

export interface Props {
  height?: number;
  timeline: TickPresentFutureType[];
  domain: { x: [number, number] };
  startingYear: number;
  multiyear: boolean;
}

// This is a pureComponent because its props should change much less frequently than it renders
export default class chartForecastStorage extends React.PureComponent<
  Props,
  {}
> {
  public render() {
    const { domain, height, timeline, startingYear, multiyear } = this.props;

    // Wrapping in spare div prevents excessive height bug
    return (
      <div id="chartForecastStorage">
        <VictoryChart
          theme={VictoryTheme.material}
          padding={{ top: 5, bottom: 25, left: 55, right: 5 }}
          domain={domain}
          domainPadding={{ y: [6, 6] }}
          height={height || 300}
          containerComponent={
            <VictoryVoronoiContainer
              voronoiDimension="x"
              labels={({ datum }) => formatWattHours(datum.storedWh)}
              labelComponent={
                <VictoryTooltip
                  cornerRadius={2}
                  constrainToVisibleArea
                  flyoutStyle={{ fill: "white" }}
                  style={{ textAnchor: "end" }}
                />
              }
            />
          }
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
            tickFormat={(t: number) => formatWattHours(t)}
            tickLabelComponent={<VictoryLabel dx={10} />}
            fixLabelOverlap={true}
            style={{
              axis: chartTheme.axis,
              grid: {
                display: "none",
              },
              tickLabels: chartTheme.tickLabels,
            }}
          />
          <VictoryLine
            data={timeline}
            x="minute"
            y="storedWh"
            style={{
              data: {
                stroke: supplyColor,
                strokeWidth: 1,
              },
            }}
          />
        </VictoryChart>
      </div>
    );
  }
}
