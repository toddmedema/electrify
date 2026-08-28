import * as React from "react";
import { render, screen } from "@testing-library/react";
import { TickPresentFutureType } from "../../Types";
import ChartForecastWeather from "./ChartForecastWeather";

function tick(minute: number, windOffshoreKph?: number): TickPresentFutureType {
  return {
    minute,
    temperatureC: 15 + minute / 1440,
    windKph: 20 + minute / 1440,
    windOffshoreKph,
  } as TickPresentFutureType;
}

describe("ChartForecastWeather", () => {
  const common = {
    domain: { x: [0, 1440] as [number, number] },
    startingYear: 2020,
    multiyear: false,
  };

  it("adds the offshore series only when the timeline carries it", () => {
    const view = render(
      <ChartForecastWeather
        {...common}
        timeline={[tick(0, 28), tick(1440, 32)]}
      />,
    );
    expect(
      screen.getByRole("img", { name: /Offshore wind speed:/ }),
    ).toBeInTheDocument();

    view.rerender(
      <ChartForecastWeather {...common} timeline={[tick(0), tick(1440)]} />,
    );
    expect(
      screen.getByRole("img", {
        name: /Chart of forecasted temperature and wind/,
      }),
    ).not.toHaveAccessibleName(/Offshore wind speed:/);
  });
});
