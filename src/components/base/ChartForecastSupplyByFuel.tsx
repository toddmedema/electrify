import * as React from "react";
import {
  VictoryArea,
  VictoryAxis,
  VictoryChart,
  VictoryLabel,
  VictoryLine,
  VictoryStack,
  VictoryTheme,
} from "victory";
import { chartTooltipContainer } from "./ChartTooltipContainer";
import {
  formatMonthChartAxis,
  getDateFromMinute,
} from "../../helpers/DateTime";
import { formatWatts, formatWattsAxis } from "../../helpers/Format";
import { FuelNameType, TickPresentFutureType } from "../../Types";
import { chartTheme, demandColor, fuelColors } from "../../Theme";

export interface Props {
  height?: number;
  timeline: TickPresentFutureType[];
  domain: { x: [number, number] };
  startingYear: number;
  multiyear: boolean;
  // Bottom-to-top order of the stack, ie the order these fuels are dispatched in
  fuels: FuelNameType[];
}

// This is a pureComponent because its props should change much less frequently than it renders
export default class ChartForecastSupplyByFuel extends React.PureComponent<
  Props,
  {}
> {
  public render() {
    const { domain, height, timeline, startingYear, multiyear } = this.props;

    // Anything generating in the forecast window belongs in the stack, even if it was built
    // partway through and so isn't in the fleet the dispatch order was derived from
    const fuelsInForecast = new Set<FuelNameType>();
    timeline.forEach((t) => {
      Object.keys(t.supplyByFuel).forEach((f) =>
        fuelsInForecast.add(f as FuelNameType),
      );
    });
    const fuels = this.props.fuels.filter((f) => fuelsInForecast.has(f));
    fuelsInForecast.forEach((f) => {
      if (fuels.indexOf(f) === -1) {
        fuels.push(f);
      }
    });

    // Every band needs a value at every x or the stack tears, so backfill the whole series.
    // Each point carries every fuel as well as its own x/y, so that the shared tooltip can read
    // the whole mix off whichever series the pointer landed on.
    // The sampled forecast repeats its first minute, and a stack lines its bands up by x, so a
    // duplicate x knocks every band after it out of alignment - drop repeats as we go.
    const data: Array<{ [index: string]: number }> = [];
    timeline.forEach((t) => {
      if (data.length && data[data.length - 1].minute === t.minute) {
        return;
      }
      const point: { [index: string]: number } = {
        minute: t.minute,
        demandW: t.demandW,
      };
      fuels.forEach((f) => {
        point[f] = t.supplyByFuel[f] || 0;
      });
      data.push(point);
    });
    const seriesByFuel = fuels.map((f) =>
      data.map((point) => ({ ...point, x: point.minute, y: point[f] })),
    );
    const demandSeries = data.map((point) => ({
      ...point,
      x: point.minute,
      y: point.demandW,
    }));

    // The stack tops out at total generation, which can sit either side of demand - leave room for both
    let maxY = 0;
    data.forEach((d) => {
      const generated = fuels.reduce((sum, f) => sum + d[f], 0);
      maxY = Math.max(maxY, generated, d.demandW);
    });

    // Wrapping in spare div prevents excessive height bug
    return (
      <div id="chartForecastSupplyByFuel">
        <VictoryChart
          theme={VictoryTheme.material}
          padding={{ top: 5, bottom: 25, left: 55, right: 5 }}
          domain={{ x: domain.x, y: [0, maxY] }}
          height={height || 300}
          containerComponent={chartTooltipContainer({
            ariaLabel: "Chart of forecasted electricity supply by fuel type",
            labels: ({ datum }: any) =>
              [
                ...[...fuels]
                  .reverse()
                  .map((f: FuelNameType) => f + ": " + formatWatts(datum[f])),
                "Demand: " + formatWatts(datum.demandW),
              ].join("\n"),
            // The stacked bands all carry the same datum, so only the demand line renders labels
            voronoiBlacklist: fuels,
          })}
        >
          <VictoryAxis
            tickCount={6}
            tickFormat={(t) =>
              formatMonthChartAxis(
                getDateFromMinute(t, startingYear).monthsEllapsed +
                  12 * startingYear,
                multiyear,
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
            tickFormat={(t: number, _i: number, ticks: number[]) =>
              formatWattsAxis(t, ticks)
            }
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
          {/* Every band already covers every x, so let Victory stack them as given */}
          <VictoryStack fillInMissingData={false}>
            {fuels.map((f: FuelNameType, i: number) => (
              <VictoryArea
                key={f}
                name={f}
                data={seriesByFuel[i]}
                style={{
                  data: {
                    fill: fuelColors[f],
                    // A hairline of background between bands keeps them apart even where two
                    // fuel colors are close, since seven series can't all be far apart
                    stroke: "#ffffff",
                    strokeWidth: 0.5,
                  },
                }}
              />
            ))}
          </VictoryStack>
          {/* Drawn over the stack so the gap between the two reads as the shortfall */}
          <VictoryLine
            name="demand"
            data={demandSeries}
            style={{
              data: {
                stroke: demandColor,
                strokeWidth: 2,
                strokeDasharray: "4,2",
              },
            }}
          />
        </VictoryChart>
        {/* Below the plot rather than floating in it, where it used to clip the data */}
        <div className="chartLegend">
          {[...fuels].reverse().map((f: FuelNameType) => (
            <span key={f} className="chartLegendItem">
              <span
                className="chartLegendSwatch"
                style={{ backgroundColor: fuelColors[f] }}
              />
              {f}
            </span>
          ))}
          <span className="chartLegendItem">
            <span className="chartLegendSwatch chartLegendSwatch-demand" />
            Demand
          </span>
        </div>
      </div>
    );
  }
}
