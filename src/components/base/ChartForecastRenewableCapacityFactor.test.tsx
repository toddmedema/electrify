import * as React from "react";
import { render, screen } from "@testing-library/react";
import { MINUTES_PER_MONTH } from "../../helpers/DateTime";
import { createGame } from "../../testing/Simulator";
import { GeneratorShoppingType, TickPresentFutureType } from "../../Types";
import ChartForecastRenewableCapacityFactor, {
  availableWeatherRenewables,
  monthlyRenewableCapacityFactors,
} from "./ChartForecastRenewableCapacityFactor";

function tick(
  minute: number,
  windKph: number,
  solarIrradianceWM2: number,
): TickPresentFutureType {
  return {
    minute,
    windKph,
    windAirborneKph: windKph,
    solarIrradianceWM2,
    hydroRunoffMm: 10,
  } as TickPresentFutureType;
}

describe("ChartForecastRenewableCapacityFactor", () => {
  const timeline = [
    tick(0, 0, 0),
    tick(10, 30, 1000),
    tick(MINUTES_PER_MONTH, 20, 500),
    tick(MINUTES_PER_MONTH + 10, 20, 500),
  ];

  it("builds monthly resource factors without requiring built facilities", () => {
    const technologies = [
      { name: "Wind" },
      { name: "Solar" },
      { name: "Hydro", peakW: 1_000_000, hydroWhPerMm: 20_000_000 },
    ] as GeneratorShoppingType[];
    const points = monthlyRenewableCapacityFactors(timeline, technologies);

    expect(points).toHaveLength(2);
    expect(points[0].factors.Wind).toBeGreaterThan(0);
    expect(points[0].factors.Solar).toBeCloseTo(0.45);
    expect(points[0].factors.Hydro).toBeGreaterThan(0);
  });

  it("uses every weather-driven technology available in the current location", () => {
    const game = createGame({ scenarioId: 100 });
    const names = availableWeatherRenewables(game, game.timeline).map(
      (technology) => technology.name,
    );

    expect(names).toEqual(expect.arrayContaining(["Wind", "Solar", "Hydro"]));
  });

  it("exposes each available series as a percentage", () => {
    const game = createGame({ scenarioId: 100 });
    render(
      <ChartForecastRenewableCapacityFactor
        game={game}
        timeline={game.timeline}
        domain={{ x: [game.timeline[0].minute, game.timeline.at(-1)!.minute] }}
        startingYear={game.startingYear}
        multiyear={false}
      />,
    );

    expect(
      screen.getByRole("img", {
        name: /predicted monthly renewable output.*Wind capacity factor \(%\)/,
      }),
    ).toBeInTheDocument();
  });
});
