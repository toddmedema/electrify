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
import { formatWatts } from "../../helpers/Format";
import { FuelNameType, TickPresentFutureType } from "../../Types";
import { chartTheme, fuelColors } from "../../Theme";

export interface Props {
  height?: number;
  timeline: TickPresentFutureType[];
  domain: { x: [number, number] };
  startingYear: number;
  multiyear: boolean;
}

// This is a pureComponent because its props should change much less frequently than it renders
export default class ChartForecastSupplyByFuel extends React.PureComponent<
  Props,
  {}
> {
  public render() {
    const { domain, height, timeline, startingYear, multiyear } = this.props;
    // Extract the supply by fuel values
    const data = timeline.map((t) => {
      return { minute: t.minute, ...t.supplyByFuel };
    });

    // Check at the end of the list in case anything new is built during the forecast window, and backfill zeroes as needed, until all fuels are present
    const fuels = Object.keys(
      timeline[timeline.length - 1].supplyByFuel
    ).sort() as FuelNameType[];
    for (let i = 0; i < data.length; i++) {
      let missingFuel = false;
      for (let f = 0; f < fuels.length; f++) {
        if (!data[i][fuels[f]]) {
          missingFuel = true;
          data[i][fuels[f]] = 0;
        }
      }
      if (!missingFuel) {
        break;
      }
    }

    // Wrapping in spare div prevents excessive height bug
    return (
      <div id="chartForecastSupplyByFuel">
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
          {fuels.map((f: FuelNameType, i: number) => (
            <VictoryLine
              key={i}
              data={data}
              x="minute"
              y={f}
              style={{
                data: {
                  stroke: fuelColors[f],
                  strokeWidth: 1,
                },
              }}
            />
          ))}
          <VictoryLegend
            x={270}
            y={15}
            centerTitle
            orientation="vertical"
            rowGutter={-5}
            symbolSpacer={5}
            data={fuels.map((f) => {
              return { name: f, symbol: { fill: fuelColors[f] } };
            })}
          />
        </VictoryChart>
      </div>
    );
  }
}
