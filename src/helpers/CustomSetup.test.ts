import { DEFAULT_CUSTOM_SCENARIO } from "../data/Scenarios";
import {
  prepareCustomSetup,
  prepareOfficialArcScenario,
  standardCustomRate,
  validOfficialArcIds,
  validOfficialArcScenario,
  validSavedCustomScenario,
} from "./CustomSetup";
import { createGame } from "../testing/Simulator";
import { parseSave, serializeSave } from "../SaveGame";

it("a custom game carries no scenario events, whether set up or saved", () => {
  expect(validSavedCustomScenario(DEFAULT_CUSTOM_SCENARIO)).toBe(true);
  expect(
    validSavedCustomScenario({
      ...DEFAULT_CUSTOM_SCENARIO,
      eventScenarioIds: [],
    }),
  ).toBe(true);
  expect(
    validSavedCustomScenario({
      ...DEFAULT_CUSTOM_SCENARIO,
      eventScenarioIds: [108],
    }),
  ).toBe(false);
  const game = createGame({
    scenarioId: 999,
    scenario: DEFAULT_CUSTOM_SCENARIO,
  });
  expect(parseSave(serializeSave(game))).not.toBeNull();
  const withEvent = JSON.parse(JSON.stringify(serializeSave(game)));
  withEvent.game.customScenario.eventScenarioIds = [108];
  expect(parseSave(withEvent)).toBeNull();
});

it("a stored setup that selected events opens without them or their imported loads", () => {
  const setup = prepareCustomSetup({
    ...DEFAULT_CUSTOM_SCENARIO,
    eventScenarioIds: [106],
    loadAdditions: [
      {
        id: "custom-106-campus",
        label: "Data Centers",
        startsYear: 2026,
        peakW: 1e8,
        loadFactor: 0.9,
        demandType: "Data Centers",
      },
    ],
    dollarsPerkWh: 0.5,
  });
  expect(setup.eventScenarioIds).toBeUndefined();
  expect(setup.loadAdditions).toBeUndefined();
  // The opening rate is always the era's automatic one.
  expect(setup.dollarsPerkWh).toBe(standardCustomRate(DEFAULT_CUSTOM_SCENARIO));
  expect(setup.facilities).toEqual(DEFAULT_CUSTOM_SCENARIO.facilities);
});

it("community packages still import official arcs, including their loads and term", () => {
  expect(validOfficialArcIds([106, 111])).toBe(true);
  expect(validOfficialArcIds([106, 106])).toBe(false);
  expect(validOfficialArcIds([999])).toBe(false);
  const scenario = {
    ...DEFAULT_CUSTOM_SCENARIO,
    startingYear: 2050,
    eventScenarioIds: [106],
  };
  expect(validOfficialArcScenario(scenario)).toBe(true);
  const prepared = prepareOfficialArcScenario(scenario);
  expect(prepared.loadAdditions?.[0].id).toBe(
    "custom-106-manassas-data-centers",
  );
  expect(prepared.durationMonths).toBeGreaterThanOrEqual(
    DEFAULT_CUSTOM_SCENARIO.durationMonths,
  );
});
