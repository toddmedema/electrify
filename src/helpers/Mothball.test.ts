import cloneDeep from "lodash.clonedeep";
import gameReducer, { delta } from "../reducers/Game";
import { runMonths } from "../testing/SimulationTestHelpers";
import { createGame } from "../testing/Simulator";
import { FacilityOperatingType } from "../Types";
import { GAME_TO_REAL_YEARS } from "../Constants";
import { MINUTES_PER_MONTH } from "./DateTime";
import { generatorsAboveDemandFloor, mothballAdvice } from "./Mothball";

const HOURS = (MINUTES_PER_MONTH / 60) * GAME_TO_REAL_YEARS;
const coal = (overrides: Partial<FacilityOperatingType> = {}) =>
  ({
    id: 1,
    name: "Coal",
    fuel: "Coal",
    peakW: 500_000_000,
    minimumStableOutput: 0.4,
    yearsToBuildLeft: 0,
    ...overrides,
  }) as FacilityOperatingType;

describe("plants running above demand", () => {
  it("flags a committed thermal plant whose floor exceeds average demand", () => {
    // A 200 MW floor against 150 MW of average demand
    const month = { demandWh: 150_000_000 * HOURS };
    expect(generatorsAboveDemandFloor([coal()], month)).toHaveLength(1);
    expect(
      generatorsAboveDemandFloor([coal()], { demandWh: 250_000_000 * HOURS }),
    ).toHaveLength(0);
    expect(
      generatorsAboveDemandFloor([coal({ paused: true })], month),
    ).toHaveLength(0);
    expect(
      generatorsAboveDemandFloor([coal({ yearsToBuildLeft: 1 })], month),
    ).toHaveLength(0);
    expect(
      generatorsAboveDemandFloor(
        [coal({ fuel: "Uranium", name: "Nuclear" })],
        month,
      ),
    ).toHaveLength(0);
    expect(mothballAdvice(coal() as never)).toMatch(
      /^Coal has a 40% minimum output/,
    );
  });

  it("advises pausing the Shale Boom coal plant once customers have left", () => {
    // The reducer freezes its result; runMonths ticks a mutable copy
    const game = cloneDeep(
      gameReducer(
        createGame({ scenarioId: 103 }),
        delta({ dollarsPerkWh: 0.2 }),
      ),
    );
    // Average demand falls under the 200 MW floor during the third year
    runMonths(game, 12);
    expect(
      game.eventLog.some(
        (event) => event.title === "Plant running above demand",
      ),
    ).toBe(false);
    runMonths(game, 36);
    const advice = game.eventLog.filter(
      (event) => event.title === "Plant running above demand",
    );
    expect(advice).toHaveLength(1);
    expect(advice[0].message).toMatch(
      /Consider pausing it on the Facilities screen/,
    );
  }, 120000);
});

it.each(["exportedW", "storageChargeW"] as const)(
  "does not call useful %s output wasted",
  (flow) => {
    const month = {
      demandWh: 150_000_000 * HOURS,
      chartAverage: { [flow]: 60_000_000 },
    };
    expect(generatorsAboveDemandFloor([coal()], month)).toHaveLength(0);
  },
);
