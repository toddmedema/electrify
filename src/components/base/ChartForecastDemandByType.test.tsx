import * as React from "react";
import uPlot from "uplot";
import { render, screen } from "@testing-library/react";
import { DemandByTypeType, TickPresentFutureType } from "../../Types";
import ChartForecastDemandByType, {
  demandTypesBySizeAtStart,
  formatDemandTypeTooltip,
  demandChartTimeAxis,
} from "./ChartForecastDemandByType";

function tick(
  minute: number,
  demandByType: DemandByTypeType,
): TickPresentFutureType {
  return { minute, demandByType } as TickPresentFutureType;
}

it("labels city demand by hour across midnight while keeping forecasts on their month axis", () => {
  const breakdown = {
    Residential: 100,
    Commercial: 20,
    Industrial: 10,
    Transportation: 0,
    Mining: 0,
    "Data Centers": 0,
  };
  const props = {
    timeline: [tick(2880, breakdown), tick(4320, breakdown)],
    domain: { x: [2880, 4320] as [number, number] },
    startingYear: 2005,
    multiyear: false,
  };
  const renderAxis = (xAxis: "hour" | "month") => {
    const axis = demandChartTimeAxis(1, () => props, xAxis);
    const splits = (axis.splits as Exclude<uPlot.Axis.Splits, number[]>)(
      null as unknown as uPlot,
      0,
      2880,
      4320,
      0,
      0,
    );
    return (axis.values as uPlot.Axis.DynamicValues)(
      null as unknown as uPlot,
      splits,
      0,
      0,
      0,
    );
  };
  expect(renderAxis("hour")).toEqual([
    "12 AM",
    "4 AM",
    "8 AM",
    "12 PM",
    "4 PM",
    "8 PM",
    "12 AM",
  ]);
  expect(renderAxis("month")).not.toContain("12 AM");
});

it("makes every demand category readable without the canvas", () => {
  render(
    <ChartForecastDemandByType
      timeline={[
        tick(0, {
          Residential: 390,
          Commercial: 340,
          Industrial: 220,
          Transportation: 10,
          Mining: 0,
          "Data Centers": 40,
        }),
        tick(1440, {
          Residential: 400,
          Commercial: 345,
          Industrial: 220,
          Transportation: 12,
          Mining: 0,
          "Data Centers": 55,
        }),
      ]}
      domain={{ x: [0, 1440] }}
      startingYear={2020}
      multiyear={false}
    />,
  );

  const chart = screen.getByRole("img", {
    name: /electricity demand by customer or use type/i,
  });
  expect(chart).toHaveAccessibleName(/Residential:/);
  expect(chart).toHaveAccessibleName(/Commercial:/);
  expect(chart).toHaveAccessibleName(/Industrial:/);
  expect(chart).toHaveAccessibleName(/Transportation:/);
  expect(chart).toHaveAccessibleName(/Data Centers:/);
});

it("orders the legend and tooltip by demand at the start of the plotted range", () => {
  const beforeRange = {
    Residential: 900,
    Commercial: 40,
    Industrial: 30,
    Transportation: 20,
    Mining: 0,
    "Data Centers": 10,
  };
  const atStart = {
    Residential: 200,
    Commercial: 500,
    Industrial: 300,
    Transportation: 100,
    Mining: 0,
    "Data Centers": 400,
  };
  const timeline = [
    tick(-1440, beforeRange),
    tick(0, atStart),
    tick(1440, { ...atStart, Residential: 800 }),
  ];

  const ordered = demandTypesBySizeAtStart(timeline, 0);
  expect(ordered).toEqual([
    "Commercial",
    "Data Centers",
    "Industrial",
    "Residential",
    "Transportation",
  ]);
  expect(
    formatDemandTypeTooltip(0, atStart, 2020, ordered)
      .split("\n")
      .slice(1)
      .map((line) => line.split(":")[0]),
  ).toEqual(ordered);
});

it("shows an authored load label without changing its demand category", () => {
  const breakdown = {
    Residential: 200,
    Commercial: 100,
    Industrial: 50,
    Transportation: 25,
    Mining: 0,
    "Data Centers": 100,
  };
  expect(
    formatDemandTypeTooltip(0, breakdown, 2020, ["Data Centers"], {
      "Data Centers": "Campus demand",
    }),
  ).toContain("Campus demand: 100W");

  render(
    <ChartForecastDemandByType
      timeline={[tick(0, breakdown)]}
      domain={{ x: [0, 1440] }}
      startingYear={2020}
      multiyear={false}
      typeLabels={{ "Data Centers": "Campus demand" }}
    />,
  );
  expect(
    screen.getByRole("img", {
      name: /Campus demand/i,
    }),
  ).toBeInTheDocument();
});
