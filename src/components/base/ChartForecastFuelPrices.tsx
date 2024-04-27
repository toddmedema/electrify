import * as React from "react";
import {
  VictoryAxis,
  VictoryChart,
  VictoryLabel,
  VictoryLegend,
  VictoryLine,
  VictoryTheme,
  VictoryVoronoiContainer,
  VictoryTooltip,
} from "victory";
import {
  formatMonthChartAxis,
  getDateFromMinute,
} from "../../helpers/DateTime";
import { formatMoneyConcise, formatMoneyStable } from "../../helpers/Format";
import { TickPresentFutureType } from "../../Types";
import { chartTheme, fuelColors } from "../../Theme";

export interface Props {
  height?: number;
  timeline: TickPresentFutureType[];
  domain: { x: [number, number] };
  startingYear: number;
  multiyear: boolean;
}

// This is a pureComponent because its props should change much less frequently than it renders
export default class ChartForecastFuelPrices extends React.PureComponent<
  Props,
  {}
> {
  public render() {
    const { domain, height, timeline, startingYear, multiyear } = this.props;

    // Wrapping in spare div prevents excessive height bug
    return (
      <div id="chartForecastFuelPrices">
        <VictoryChart
          theme={VictoryTheme.material}
          padding={{ top: 5, bottom: 25, left: 55, right: 5 }}
          domain={domain}
          domainPadding={{ y: [6, 6] }}
          height={height || 300}
          containerComponent={
            <VictoryVoronoiContainer
              voronoiDimension="x"
              // Labels are rendered on EACH chart, so we only render on Coal, otherwise we get duplicate labels
              voronoiBlacklist={["naturalGas", "oil", "uranium"]}
              labels={({ datum }) =>
                `Coal: ${formatMoneyStable(datum.Coal)}
                Natural Gas: ${formatMoneyStable(datum["Natural Gas"])}
                Oil: ${formatMoneyStable(datum.Oil)}
                Uranium: ${formatMoneyStable(datum.Uranium)}`
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
            name="coal"
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
            name="naturalGas"
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
            name="oil"
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
            name="uranium"
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
