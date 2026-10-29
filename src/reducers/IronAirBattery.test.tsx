import cloneDeep from "lodash.clonedeep";
import { CUSTOM_SCENARIO_ID, DEFAULT_CUSTOM_SCENARIO } from "../data/Scenarios";
import { STORAGE } from "../data/Facilities";
import { getTimeFromTimeline } from "../helpers/DateTime";
import { parseSave, serializeSave } from "../SaveGame";
import { createGame } from "../testing/Simulator";
import { GameType } from "../Types";
import { modScenario } from "../mods/ModScenario";
import gameReducer, { buildFacility, tickState } from "./Game";

function futureGame(year = 2030) {
  return createGame({
    scenarioId: CUSTOM_SCENARIO_ID,
    scenario: modScenario(
      {
        schemaVersion: 1,
        gameApi: 1,
        id: "iron-air-fixture",
        title: "Iron-air rollout",
        creator: "Fixture author",
        version: "1",
        description: "A future grid with multi-day storage.",
        seed: 123,
        baseScenarioId: 999,
        objectives: [],
        scenario: { startingYear: year, cash: 100000000 },
      },
      undefined,
      "CEO",
    ),
    difficulty: "CEO",
    seed: 123,
  });
}

function quote(game: GameType) {
  return STORAGE(game, 1000000000).find(
    (facility) => facility.name === "Iron-Air Battery",
  )!;
}

test("rejects a future iron-air quote before 2030 without charging for it", () => {
  const early = futureGame(2029);
  const future = quote(futureGame());
  expect(future).toBeDefined();
  const rejected = gameReducer(
    early,
    buildFacility({ facility: future, financed: false }),
  );
  expect(rejected.facilities).toHaveLength(early.facilities.length);
  expect(
    getTimeFromTimeline(rejected.date.minute, rejected.timeline)!.cash,
  ).toBe(getTimeFromTimeline(early.date.minute, early.timeline)!.cash);
});

test("purchases iron-air as storage and preserves the current save", () => {
  const before = futureGame();
  const facility = quote(before);
  const cash = getTimeFromTimeline(before.date.minute, before.timeline)!.cash;
  const played = cloneDeep(
    gameReducer(before, buildFacility({ facility, financed: false })),
  );
  const built = played.facilities.find(
    (asset) => asset.name === facility.name,
  )!;
  expect(built).toMatchObject({
    peakWh: 1000000000,
    peakW: 10000000,
    roundTripEfficiency: 0.425,
    currentWh: 0,
    yearsToBuildLeft: 2,
  });
  expect(
    getTimeFromTimeline(played.date.minute, played.timeline)!.cash,
  ).toBeCloseTo(cash - facility.buildCost, 4);
  for (let index = 0; index < 8; index++) tickState(played);
  const restored = parseSave(
    JSON.parse(JSON.stringify(serializeSave(played))),
  )!;
  expect(restored).not.toBeNull();
  expect(restored.game.facilities).toEqual(played.facilities);
  tickState(restored.game);
  tickState(played);
  expect(restored.game.facilities).toEqual(played.facilities);
});

test.each([2029, 2030])(
  "custom starting fleets obey iron-air's rollout in %s",
  (year) => {
    const warning = jest.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const game = createGame({
        scenarioId: CUSTOM_SCENARIO_ID,
        scenario: {
          ...DEFAULT_CUSTOM_SCENARIO,
          startingYear: year,
          facilities: [{ name: "Iron-Air Battery", peakWh: 1000000000 }],
        },
        seed: 123,
      });
      expect(
        game.facilities.some((asset) => asset.name === "Iron-Air Battery"),
      ).toBe(year >= 2030);
      expect(game.facilities[0]?.yearsToBuildLeft).toBe(
        year >= 2030 ? 0 : undefined,
      );
    } finally {
      warning.mockRestore();
    }
  },
);
