import cloneDeep from "lodash.clonedeep";
import { DEFAULT_CUSTOM_SCENARIO } from "../data/Scenarios";
import { createGame } from "../testing/Simulator";
import { runMonths } from "../testing/SimulationTestHelpers";
import reducer, { sellFacility, togglePauseFacility } from "./Game";
import { parseSave, serializeSave } from "../SaveGame";
import { currentTick } from "../helpers/GameSelectors";

const create = () =>
  cloneDeep(
    createGame({
      scenarioId: 999,
      scenario: {
        ...DEFAULT_CUSTOM_SCENARIO,
        startingYear: 1986,
        startingMonth: 3,
        cash: 1e10,
        facilities: [
          {
            assetId: "retained-reactor",
            fuel: "Uranium",
            peakW: 100e6,
            saleRestricted: true,
            maintenanceObligation: {
              startsMonth: 4,
              monthlyCost: 2e6,
              reason: "Cleanup and recovery",
            },
          },
        ],
      },
    }),
  );

it("rejects selling or cancelling a retained facility at the owning reducer", () => {
  const game = create();
  for (const yearsToBuildLeft of [0, 1]) {
    const state = cloneDeep(game);
    state.facilities[0].yearsToBuildLeft = yearsToBuildLeft;
    expect(reducer(state, sellFacility(state.facilities[0].id))).toEqual(state);
  }
});

it("replaces ordinary upkeep from April, including while paused, and attributes every charge to the facility", () => {
  const game = create();
  runMonths(game, 1);
  expect(game.monthlyHistory[0].expensesOM).not.toBeCloseTo(2e6, 2);
  const lifetime = game.facilities[0].lifetimeExpenses;
  const openingCash = currentTick(game)!.cash;
  const operating = cloneDeep(game);
  const paused = cloneDeep(
    reducer(game, togglePauseFacility(game.facilities[0].id)),
  );
  runMonths(operating, 1);
  runMonths(paused, 1);
  expect(operating.monthlyHistory[0].expensesOM).toBeCloseTo(2e6, 2);
  expect(paused.monthlyHistory[0].expensesOM).toBeCloseTo(2e6, 2);
  expect(paused.facilities[0].lifetimeExpenses - lifetime).toBeCloseTo(2e6, 2);
  expect(currentTick(paused)!.cash).toBeLessThan(openingCash);
});

it("round trips the liability and rejects removed or altered inherited obligations", () => {
  const game = create();
  const save = () => JSON.parse(JSON.stringify(serializeSave(game)));
  expect(parseSave(save())).not.toBeNull();
  const missing = save();
  missing.game.facilities = [];
  expect(parseSave(missing)).toBeNull();
  for (const field of ["saleRestricted", "maintenanceObligation"]) {
    const removed = save();
    delete removed.game.facilities[0][field];
    expect(parseSave(removed)).toBeNull();
  }
});

it("rejects a malformed inherited facility catalog without throwing during import", () => {
  const raw = JSON.parse(JSON.stringify(serializeSave(create())));
  raw.game.customScenario.facilities = null;
  expect(parseSave(raw)).toBeNull();
});
