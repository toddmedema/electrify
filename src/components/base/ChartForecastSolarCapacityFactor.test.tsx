import * as React from "react";
import { render, screen } from "@testing-library/react";
import { TickPresentFutureType } from "../../Types";
import { MINUTES_PER_MONTH } from "../../helpers/DateTime";
import ChartForecastSolarCapacityFactor, {
  monthlySolarCapacityFactors,
} from "./ChartForecastSolarCapacityFactor";

function tick(
  minute: number,
  solarIrradianceWM2: number,
): TickPresentFutureType {
  return { minute, solarIrradianceWM2 } as TickPresentFutureType;
}

describe("ChartForecastSolarCapacityFactor", () => {
  const timeline = [
    tick(0, 0),
    tick(10, 1_000),
    tick(MINUTES_PER_MONTH, 500),
    tick(MINUTES_PER_MONTH + 10, 500),
  ];

  it("averages the solar estimate into monthly capacity factors", () => {
    expect(monthlySolarCapacityFactors(timeline)).toEqual([
      { minute: 5, capacityFactor: 0.45 },
      { minute: MINUTES_PER_MONTH + 5, capacityFactor: 0.45 },
    ]);
  });

  it("exposes the chart values to assistive technology as percentages", () => {
    render(
      <ChartForecastSolarCapacityFactor
        timeline={timeline}
        domain={{ x: [0, MINUTES_PER_MONTH + 10] }}
        startingYear={2020}
        multiyear={false}
      />,
    );

    expect(
      screen.getByRole("img", {
        name: /Solar capacity factor \(%\): latest 45, range 45 to 45/,
      }),
    ).toBeInTheDocument();
  });
});
