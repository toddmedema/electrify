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

  it.each([0, 15, 30, 45])(
    "keeps seasonal highs and lows in an hourly forecast starting at minute %i",
    (offset) => {
      // One game month is a day. Two years end at the same winter temperature,
      // so keeping only the endpoints would hide both summers completely.
      const timeline = Array.from({ length: 577 }, (_, index) => ({
        ...tick(offset + index * 60),
        temperatureC: 10 - 20 * Math.cos((index * 2 * Math.PI) / 288),
      }));
      render(
        <ChartForecastWeather
          {...common}
          multiyear
          domain={{ x: [0, timeline.at(-1)!.minute] }}
          timeline={timeline}
        />,
      );

      expect(
        screen.getByRole("img", { name: /Chart of predicted temperature/ }),
      ).toHaveAccessibleName(/range -10 to 30/);
    },
  );
});
