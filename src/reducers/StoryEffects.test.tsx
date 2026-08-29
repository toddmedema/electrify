import { TICKS_PER_DAY } from "../Constants";
import { getDateFromMinute, MINUTES_PER_MONTH } from "../helpers/DateTime";
import { generateNewTimeline, tickState } from "./Game";
import { createGame } from "../testing/Simulator";

describe("story effects in dispatch", () => {
  it("caps every gas plant during the Shale freeze, including a newly commissioned one", () => {
    const game = createGame({
      scenarioId: 103,
      difficulty: "Manager",
      seed: 2468,
      initialBuild: {
        name: "Natural Gas",
        peakW: 500_000_000,
        financed: true,
      },
    });
    const gas = game.facilities.find(
      (facility) => facility.fuel === "Natural Gas",
    )!;
    game.facilities = [gas];
    gas.yearsToBuildLeft = 0;
    gas.currentW = 0;
    gas.minuteOperational = 96 * MINUTES_PER_MONTH;
    game.date = getDateFromMinute(96 * MINUTES_PER_MONTH, game.startingYear);

    const freeze = generateNewTimeline(
      game,
      1_000_000_000,
      2_000_000,
      TICKS_PER_DAY,
    );
    expect(
      Math.max(...freeze.map((tick) => tick.supplyByFuel["Natural Gas"] || 0)),
    ).toBeLessThanOrEqual(gas.peakW * 0.7);

    game.date = getDateFromMinute(99 * MINUTES_PER_MONTH, game.startingYear);
    const restored = generateNewTimeline(
      game,
      1_000_000_000,
      2_000_000,
      TICKS_PER_DAY,
    );
    expect(
      Math.max(
        ...restored.map((tick) => tick.supplyByFuel["Natural Gas"] || 0),
      ),
    ).toBeGreaterThan(gas.peakW * 0.7);
  });

  it("pauses exactly once at freeze onset and logs the authored price change once", () => {
    const game = createGame({
      scenarioId: 103,
      difficulty: "Manager",
      seed: 1357,
      initialBuild: {
        name: "Natural Gas",
        peakW: 500_000_000,
        financed: true,
      },
    });
    game.speed = "NORMAL";
    while (game.date.monthsElapsed < 95) {
      tickState(game);
    }
    expect(game.speed).toBe("NORMAL");

    while (game.date.monthsElapsed < 96) {
      tickState(game);
    }
    expect(game.speed).toBe("PAUSED");
    expect(
      game.eventLog.filter(
        (event) => event.storyPhaseKey === "story:103:shale-boom:freeze",
      ),
    ).toHaveLength(1);
    expect(
      game.eventLog.filter(
        (event) => event.label === "Jan 2014" && event.kind === "FUEL_PRICE",
      ),
    ).toHaveLength(0);

    for (let tick = 0; tick < 10; tick++) {
      tickState(game);
    }
    expect(
      game.eventLog.filter(
        (event) => event.storyPhaseKey === "story:103:shale-boom:freeze",
      ),
    ).toHaveLength(1);
  });
});
