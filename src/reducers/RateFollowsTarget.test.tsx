import cloneDeep from "lodash.clonedeep";
import { publicTargetRate } from "../helpers/Customers";
import { getScenario } from "../data/Scenarios";
import { createGame } from "../testing/Simulator";
import { runMonths } from "../testing/SimulationTestHelpers";
import { GameType } from "../Types";
import gameReducer, { delta } from "./Game";

// Hurricane Season is a public utility; Investor Owned Utility is not.
const PUBLIC_ID = 104;
const INVESTOR_ID = 100;

function target(game: GameType) {
  return publicTargetRate(
    getScenario(PUBLIC_ID)!.dollarsPerkWh,
    game.date,
    game.startingYear,
    game.seed,
  );
}

describe("public utility rate following its target", () => {
  it("starts new public games following and leaves investor rates alone", () => {
    expect(createGame({ scenarioId: PUBLIC_ID }).rateFollowsTarget).toBe(true);
    expect(createGame({ scenarioId: INVESTOR_ID }).rateFollowsTarget).toBe(
      false,
    );
  });

  it("tracks the inflating target across a new year until a rate is set by hand", () => {
    const game = createGame({ scenarioId: PUBLIC_ID });
    const startYear = game.date.year;
    const startTarget = target(game);
    runMonths(game, 13);
    expect(game.date.year).toBe(startYear + 1);
    expect(target(game)).not.toBe(startTarget);
    expect(game.dollarsPerkWh).toBe(target(game));

    const manual = cloneDeep(gameReducer(game, delta({ dollarsPerkWh: 0.08 })));
    expect(manual.rateFollowsTarget).toBe(false);
    runMonths(manual, 12);
    expect(manual.dollarsPerkWh).toBe(0.08);
  });

  it("snaps to the target when following is turned back on, and records it for replay", () => {
    const manual = gameReducer(
      createGame({ scenarioId: PUBLIC_ID }),
      delta({ dollarsPerkWh: 0.08 }),
    );
    const resumed = gameReducer(manual, delta({ rateFollowsTarget: true }));
    expect(resumed.rateFollowsTarget).toBe(true);
    expect(resumed.dollarsPerkWh).toBe(target(resumed));
    expect(resumed.replayLog?.at(-1)?.payload).toEqual({
      dollarsPerkWh: target(resumed),
      rateFollowsTarget: true,
    });
  });

  it("cannot follow a target that an investor-owned utility doesn't have", () => {
    const game = createGame({ scenarioId: INVESTOR_ID });
    const next = gameReducer(game, delta({ rateFollowsTarget: true }));
    expect(next.rateFollowsTarget).toBe(false);
    expect(next.dollarsPerkWh).toBe(game.dollarsPerkWh);
  });
});
