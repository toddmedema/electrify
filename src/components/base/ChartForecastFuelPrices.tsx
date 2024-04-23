import * as React from "react";
import {
  VictoryAxis,
  VictoryChart,
  VictoryLabel,
  VictoryLegend,
  VictoryLine,
  VictoryTheme,
} from "victory";
import {
  formatMonthChartAxis,
  getDateFromMinute,
} from "../../helpers/DateTime";
import { formatMoneyConcise } from "../../helpers/Format";
import { TickPresentFutureType } from "../../Types";
import { chartTheme, fuelColors } from "../../Theme";

export interface Props {
  height?: number;
  timeline: TickPresentFutureType[];
  domain: { x: [number, number] };
  startingYear: number;
}

// This is a pureComponent because its props should change much less frequently than it renders
export default class ChartForecastFuelPrices extends React.PureComponent<
  Props,
  {}
> {
  public render() {
    const { domain, height, timeline, startingYear } = this.props;

    // Wrapping in spare div prevents excessive height bug
    return (
      <div id="chartForecastFuelPrices">
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
                getDateFromMinute(t, startingYear).monthNumber,
                false
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
            axisLabelComponent={<VictoryLabel dy={-30} />}
            label="Per MMBTU"
            tickFormat={(t: number) => formatMoneyConcise(t)}
            tickLabelComponent={<VictoryLabel dx={5} />}
            fixLabelOverlap={true}
            style={{
              axis: chartTheme.axis,
              tickLabels: chartTheme.tickLabels,
            }}
          />
          <VictoryLine
            data={timeline}
            x="minute"
            y="Natural Gas"
            interpolation="natural"
            style={{
              data: {
                stroke: fuelColors["Natural Gas"],
                strokeWidth: 1,
              },
            }}
          />
          <VictoryLine
            data={timeline}
            x="minute"
            y="Coal"
            interpolation="natural"
            style={{
              data: {
                stroke: fuelColors.Coal,
                strokeWidth: 1,
              },
            }}
          />
          <VictoryLine
            data={timeline}
            x="minute"
            y="Oil"
            interpolation="natural"
            style={{
              data: {
                stroke: fuelColors.Oil,
                strokeWidth: 1,
              },
            }}
          />
          <VictoryLine
            data={timeline}
            x="minute"
            y="Uranium"
            interpolation="natural"
            style={{
              data: {
                stroke: fuelColors.Uranium,
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
              { name: "Coal", symbol: { fill: fuelColors.Coal } },
              {
                name: "Natural Gas",
                symbol: { fill: fuelColors["Natural Gas"] },
              },
              { name: "Oil", symbol: { fill: fuelColors.Oil } },
              { name: "Uranium", symbol: { fill: fuelColors.Uranium } },
            ]}
          />
        </VictoryChart>
      </div>
    );
  }
}
