import * as React from "react";
import {
  VictoryArea,
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
import { formatWatts } from "../../helpers/Format";
import {
  blackoutColor,
  chartTheme,
  demandColor,
  supplyColor,
} from "../../Theme";

interface BlackoutEdges {
  minute: number;
  value: number;
}

export interface Props {
  height?: number;
  timeline: TickPresentFutureType[];
  blackouts: BlackoutEdges[];
  domain: { x: [number, number]; y: [number, number] };
  startingYear: number;
  multiyear: boolean;
}

// This is a pureComponent because its props should change much less frequently than it renders
export default class chartForecastSupplyDemand extends React.PureComponent<
  Props,
  {}
> {
  public render() {
    const { domain, height, timeline, blackouts, startingYear, multiyear } =
      this.props;

    // Wrapping in spare div prevents excessive height bug
    return (
      <div id="chartForecastSupplyDemand">
        <VictoryChart
          theme={VictoryTheme.material}
          padding={{ top: 5, bottom: 25, left: 55, right: 5 }}
          domain={domain}
          domainPadding={{ y: [6, 6] }}
          height={height || 300}
          containerComponent={
            <VictoryVoronoiContainer
              voronoiDimension="x"
              // Labels are rendered on EACH chart, so we only render on supply, otherwise we get duplicate labels
              voronoiBlacklist={["demand", "blackouts"]}
              labels={({ datum }) =>
                `Supply: ${formatWatts(datum.supplyW)}\nDemand: ${formatWatts(datum.demandW)}`
              }
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
            tickFormat={(t: number) => formatWatts(t)}
            tickLabelComponent={<VictoryLabel dx={5} />}
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
            name="supply"
            data={timeline}
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
            name="demand"
            data={timeline}
            x="minute"
            y="demandW"
            style={{
              data: {
                stroke: demandColor,
              },
            }}
          />
          <VictoryArea
            name="blackouts"
            data={blackouts}
            x="minute"
            y="value"
            style={{
              data: {
                stroke: "none",
                fill: blackoutColor,
                opacity: 0.3,
              },
            }}
          />
        </VictoryChart>
      </div>
    );
  }
}
