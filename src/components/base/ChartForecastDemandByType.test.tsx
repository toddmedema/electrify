import * as React from "react";
import { render, screen } from "@testing-library/react";
import { DemandByTypeType, TickPresentFutureType } from "../../Types";
import ChartForecastDemandByType from "./ChartForecastDemandByType";

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
