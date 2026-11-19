import cloneDeep from "lodash.clonedeep";
import { parseSave, serializeSave } from "../SaveGame";
import { createGame } from "./Simulator";
import { DEFAULT_CUSTOM_SCENARIO } from "../data/Scenarios";

test("ordinary custom saves round trip without accepting stored native rules", () => {
  const game = createGame({
    scenarioId: 999,
    scenario: DEFAULT_CUSTOM_SCENARIO,
  });
  const source = cloneDeep(serializeSave(game));
  expect(parseSave(source)?.game.customScenario).toEqual(game.customScenario);
  const forged = cloneDeep(source);
  Object.assign(forged.game.customScenario!, { rules: {} });
  expect(parseSave(forged)).toBeNull();
  expect(parseSave(source)).not.toBeNull();
});

test("a custom 1980 game can start with gas steam and restore its vintage", () => {
  const scenario = {
    ...DEFAULT_CUSTOM_SCENARIO,
    startingYear: 1980,
    facilities: [
      { name: "Natural Gas Steam", peakW: 100e6, initialAgeYears: 20 },
    ],
  };
  const game = createGame({ scenarioId: scenario.id, scenario });
  const restored = parseSave(JSON.parse(JSON.stringify(serializeSave(game))));
  const boiler = restored?.game.facilities[0];
  expect(boiler).toMatchObject({
    name: "Natural Gas Steam",
    gasCycle: "steam",
    spinMinutes: 240,
  });
  // A 1960-vintage boiler is less efficient than a 1980 quote.
  expect(boiler!.btuPerWh).toBeCloseTo(11.5625, 4);
});
