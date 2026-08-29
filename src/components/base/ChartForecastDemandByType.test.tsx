import * as React from "react";
import { render, screen } from "@testing-library/react";
import { DemandByTypeType, TickPresentFutureType } from "../../Types";
import ChartForecastDemandByType, {
  demandTypesBySizeAtStart,
  formatDemandTypeTooltip,
} from "./ChartForecastDemandByType";

function tick(
  minute: number,
  demandByType: DemandByTypeType,
): TickPresentFutureType {
  return { minute, demandByType } as TickPresentFutureType;
}

it("makes every demand category readable without the canvas", () => {
  render(
    <ChartForecastDemandByType
      timeline={[
        tick(0, {
          Residential: 390,
          Commercial: 340,
          Industrial: 220,
          Transportation: 10,
          "Data centers": 40,
        }),
        tick(1440, {
          Residential: 400,
          Commercial: 345,
          Industrial: 220,
          Transportation: 12,
          "Data centers": 55,
        }),
      ]}
      domain={{ x: [0, 1440] }}
      startingYear={2020}
      multiyear={false}
    />,
  );

  const chart = screen.getByRole("img", {
    name: /electricity demand by load type/i,
  });
  expect(chart).toHaveAccessibleName(/Residential:/);
  expect(chart).toHaveAccessibleName(/Commercial:/);
  expect(chart).toHaveAccessibleName(/Industrial:/);
  expect(chart).toHaveAccessibleName(/Transportation:/);
  expect(chart).toHaveAccessibleName(/Data centers:/);
});

it("orders the legend and tooltip by demand at the start of the plotted range", () => {
  const beforeRange = {
    Residential: 900,
    Commercial: 40,
    Industrial: 30,
    Transportation: 20,
    "Data centers": 10,
  };
  const atStart = {
    Residential: 200,
    Commercial: 500,
    Industrial: 300,
    Transportation: 100,
    "Data centers": 400,
  };
  const timeline = [
    tick(-1440, beforeRange),
    tick(0, atStart),
    tick(1440, { ...atStart, Residential: 800 }),
  ];

  const ordered = demandTypesBySizeAtStart(timeline, 0);
  expect(ordered).toEqual([
    "Commercial",
    "Data centers",
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
