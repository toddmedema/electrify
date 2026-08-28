import * as React from "react";
import { render, screen } from "@testing-library/react";
import { TickPresentFutureType } from "../../Types";
import ChartForecastWater from "./ChartForecastWater";

function tick(minute: number, scale: number): TickPresentFutureType {
  return {
    minute,
    precipitationMm: 40 * scale,
    snowpackMm: 100 * scale,
    hydroReservoirWh: 1_000_000 * scale,
    hydroReservoirCapacityWh: 2_000_000,
  } as TickPresentFutureType;
}

it("makes precipitation, snowpack, and reservoir level readable without the canvas", () => {
  render(
    <ChartForecastWater
      timeline={[tick(0, 0.5), tick(1440, 1)]}
      domain={{ x: [0, 1440] }}
      startingYear={2020}
      multiyear={false}
    />,
  );
  const chart = screen.getByRole("img", {
    name: /watershed precipitation, snowpack, and hydro reservoir level/i,
  });
  expect(chart).toHaveAccessibleName(/Precipitation:/);
  expect(chart).toHaveAccessibleName(/Snowpack:/);
  expect(chart).toHaveAccessibleName(/Reservoir:/);
});
