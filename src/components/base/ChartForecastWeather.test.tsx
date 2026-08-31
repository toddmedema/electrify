import * as React from "react";
import { render, screen } from "@testing-library/react";
import { TickPresentFutureType } from "../../Types";
import ChartForecastWeather from "./ChartForecastWeather";

function tick(minute: number): TickPresentFutureType {
  return {
    minute,
    temperatureC: 15 + minute / 1440,
  } as TickPresentFutureType;
}

describe("ChartForecastWeather", () => {
  const common = {
    domain: { x: [0, 1440] as [number, number] },
    startingYear: 2020,
    multiyear: false,
  };

  it("keeps temperature on its own scale and accessible series", () => {
    render(
      <ChartForecastWeather {...common} timeline={[tick(0), tick(1440)]} />,
    );
    expect(
      screen.getByRole("img", {
        name: /Chart of predicted temperature.*Temperature: latest 16/,
      }),
    ).toBeInTheDocument();
  });
});
