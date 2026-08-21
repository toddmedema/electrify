import * as React from "react";
import {
  VictoryAxis,
  VictoryChart,
  VictoryLabel,
  VictoryLine,
  VictoryTheme,
} from "victory";
import { chartTooltipContainer } from "./ChartTooltipContainer";
import {
  formatMonthChartAxis,
  getDateFromMinute,
} from "../../helpers/DateTime";
import { formatMoneyConcise, formatMoneyStable } from "../../helpers/Format";
import { TickPresentFutureType } from "../../Types";
import { chartTheme, fuelColors, fuelDashArrays } from "../../Theme";

export interface Props {
  height?: number;
  timeline: TickPresentFutureType[];
  domain: { x: [number, number] };
  startingYear: number;
  multiyear: boolean;
}

type PricedFuelType = "Coal" | "Natural Gas" | "Oil" | "Uranium";
const PRICED_FUELS: PricedFuelType[] = [
  "Coal",
  "Natural Gas",
  "Oil",
  "Uranium",
];

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
          containerComponent={chartTooltipContainer({
            ariaLabel: "Chart of forecasted fuel prices",
            labels: ({ datum }: any) =>
              PRICED_FUELS.map(
                (f) => `${f}: ${formatMoneyStable(datum[f])}`
              ).join("\n"),
            // Labels are rendered on EACH chart, so we only render on Coal, otherwise we get duplicate labels
            voronoiBlacklist: PRICED_FUELS.slice(1),
          })}
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
          {PRICED_FUELS.map((f) => (
            <VictoryLine
              key={f}
              name={f}
              data={timeline}
              x="minute"
              y={f}
              interpolation="natural"
              style={{
                data: {
                  stroke: fuelColors[f],
                  strokeWidth: 1.5,
                  // Four overlapping lines are more than color alone can separate, so each
                  // fuel also gets its own dash pattern
                  strokeDasharray: fuelDashArrays[f],
                },
              }}
            />
          ))}
        </VictoryChart>
        {/* Below the plot rather than floating in it, where it used to clip the data */}
        <div className="chartLegend">
          {PRICED_FUELS.map((f) => (
            <span key={f} className="chartLegendItem">
              <svg
                className="chartLegendSwatch chartLegendSwatch-line"
                viewBox="0 0 20 4"
                aria-hidden="true"
              >
                <line
                  x1="0"
                  y1="2"
                  x2="20"
                  y2="2"
                  stroke={fuelColors[f]}
                  strokeWidth="3"
                  strokeDasharray={fuelDashArrays[f]}
                />
              </svg>
              {f}
            </span>
          ))}
        </div>
      </div>
    );
  }
}
