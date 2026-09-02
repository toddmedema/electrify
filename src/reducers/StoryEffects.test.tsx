import cloneDeep from "lodash.clonedeep";
import { TICKS_PER_DAY } from "../Constants";
import { GENERATORS } from "../data/Facilities";
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

  it("applies the renewable discount once to new quotes without repricing commitments", () => {
    const game = createGame({ scenarioId: 101, difficulty: "Manager" });
    game.date = getDateFromMinute(84 * MINUTES_PER_MONTH, game.startingYear);
    const quote = (state: typeof game) =>
      GENERATORS(state, 100_000_000, [20], [500]).find(
        (generator) => generator.fuel === "Sun",
      )!;
    const baseline = quote({ ...game, storyEffectsDisabled: true });
    const discounted = quote(game);
    expect(discounted.buildCost / baseline.buildCost).toBeCloseTo(0.75, 10);

    const committed = cloneDeep(discounted);
    game.date = getDateFromMinute(100 * MINUTES_PER_MONTH, game.startingYear);
    expect(committed.buildCost).toBe(discounted.buildCost);
  });

  it("applies the full coal O&M multiplier to live and forecast costs", () => {
    const game = createGame({ scenarioId: 102, difficulty: "Manager" });
    game.date = getDateFromMinute(180 * MINUTES_PER_MONTH, game.startingYear);
    game.facilities = [game.facilities[0]];
    const baselineGame = cloneDeep(game);
    baselineGame.storyEffectsDisabled = true;
    const story = generateNewTimeline(
      game,
      1_000_000_000,
      2_000_000,
      TICKS_PER_DAY,
    );
    const baseline = generateNewTimeline(
      baselineGame,
      1_000_000_000,
      2_000_000,
      TICKS_PER_DAY,
    );
    const storyOM = story.reduce((total, tick) => total + tick.expensesOM, 0);
    const baselineOM = baseline.reduce(
      (total, tick) => total + tick.expensesOM,
      0,
    );
    expect(storyOM / baselineOM).toBeCloseTo(1.2, 6);
  });

  it("keeps Paradise customer count unchanged while visitor usage rises", () => {
    const game = createGame({ scenarioId: 105, difficulty: "Manager" });
    game.date = getDateFromMinute(28 * MINUTES_PER_MONTH, game.startingYear);
    const baselineGame = cloneDeep(game);
    baselineGame.storyEffectsDisabled = true;
    const story = generateNewTimeline(game, 1_000_000_000, 1_000_000, 1)[0];
    const baseline = generateNewTimeline(
      baselineGame,
      1_000_000_000,
      1_000_000,
      1,
    )[0];
    expect(story.customers).toBe(baseline.customers);
    expect(story.demandW / baseline.demandW).toBeCloseTo(1.06, 6);
  });

  it("records a known eclipse in forecast irradiance and applies it once to supply", () => {
    const game = createGame({ scenarioId: 109, difficulty: "Manager" });
    game.date = getDateFromMinute(32 * MINUTES_PER_MONTH, game.startingYear);
    const solar = game.facilities.find((facility) => facility.fuel === "Sun")!;
    game.facilities = [solar];
    const baselineGame = cloneDeep(game);
    baselineGame.storyEffectsDisabled = true;

    const story = generateNewTimeline(
      game,
      1_000_000_000,
      20_000_000,
      TICKS_PER_DAY,
    );
    const baseline = generateNewTimeline(
      baselineGame,
      1_000_000_000,
      20_000_000,
      TICKS_PER_DAY,
    );
    const totalityIndex = story.findIndex(
      (tick) =>
        getDateFromMinute(tick.minute, game.startingYear).minuteOfDay === 600,
    );

    expect(totalityIndex).toBeGreaterThanOrEqual(0);
    expect(baseline[totalityIndex].solarIrradianceWM2).toBeGreaterThan(0);
    expect(
      story[totalityIndex].solarIrradianceWM2 /
        baseline[totalityIndex].solarIrradianceWM2,
    ).toBeCloseTo(0.08, 6);
    expect(
      story[totalityIndex].supplyByFuel.Sun! /
        baseline[totalityIndex].supplyByFuel.Sun!,
    ).toBeCloseTo(0.08, 6);
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
