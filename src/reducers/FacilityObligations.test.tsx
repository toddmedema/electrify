import cloneDeep from "lodash.clonedeep";
import { DEFAULT_CUSTOM_SCENARIO } from "../data/Scenarios";
import { createGame } from "../testing/Simulator";
import { runMonths } from "../testing/SimulationTestHelpers";
import { TICKS_PER_MONTH } from "../Constants";
import reducer, {
  sellFacility,
  togglePauseFacility,
  generateForecastTimeline,
} from "./Game";
import { parseSave, serializeSave } from "../SaveGame";
import { currentTick } from "../helpers/GameSelectors";

const create = (permanentShutdownMonth?: number, startingMonth = 3) =>
  cloneDeep(
    createGame({
      scenarioId: 999,
      scenario: {
        ...DEFAULT_CUSTOM_SCENARIO,
        startingYear: 1986,
        startingMonth,
        cash: 1e10,
        facilities: [
          {
            assetId: "retained-reactor",
            fuel: "Uranium",
            peakW: 100e6,
            saleRestricted: true,
            ...(permanentShutdownMonth === undefined
              ? {}
              : { permanentShutdownMonth }),
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

it.each(["SHORTAGES", "SHORTAGES_AND_STORAGE"] as const)(
  "permanently disconnects at April rollover with %s and rejects subsequent resume commands",
  (buyingRule) => {
    const game = create(4);
    const ordinary = create();
    game.transmission!.buyingRule = buyingRule;
    ordinary.transmission!.buyingRule = buyingRule;
    expect(game.facilities[0].paused).not.toBe(true);
    runMonths(game, 1);
    runMonths(ordinary, 1);
    expect(game.monthlyHistory[0].supplyWh).toBe(
      ordinary.monthlyHistory[0].supplyWh,
    );
    expect(game.facilities[0].paused).toBe(true);
    expect(currentTick(game)!.supplyByFuel.Uranium ?? 0).toBe(0);
    const afterResume = reducer(
      game,
      togglePauseFacility(game.facilities[0].id),
    );
    expect(afterResume.facilities[0].paused).toBe(true);
    expect(afterResume.meaningfulDecisions).toEqual(game.meaningfulDecisions);
  },
);

it("initializes a term that opens after shutdown with the facility already disconnected", () => {
  const game = create(4, 5);
  expect(game.facilities[0].paused).toBe(true);
  expect(currentTick(game)!.supplyByFuel.Uranium ?? 0).toBe(0);
  expect(
    parseSave(JSON.parse(JSON.stringify(serializeSave(game)))),
  ).not.toBeNull();
});

it("rejects resumed or altered shutdown metadata in an imported save", () => {
  const game = create(4);
  runMonths(game, 1);
  game.facilities[0].paused = true;
  const valid = JSON.parse(JSON.stringify(serializeSave(game)));
  expect(parseSave(valid)).not.toBeNull();
  const resumed = cloneDeep(valid);
  resumed.game.facilities[0].paused = false;
  expect(parseSave(resumed)).toBeNull();
  for (const permanentShutdownMonth of [undefined, 3, 5, 0, 4.5]) {
    const edited = cloneDeep(valid);
    edited.game.facilities[0].permanentShutdownMonth = permanentShutdownMonth;
    expect(parseSave(edited)).toBeNull();
  }
});

it("forecasts the permanent shutdown without disconnecting the live March plant early", () => {
  const game = create(4);
  const now = currentTick(game)!;
  const forecast = generateForecastTimeline(
    game,
    now.cash,
    now.customers,
    TICKS_PER_MONTH * 2,
  );
  expect(forecast[0].supplyByFuel.Uranium).toBeGreaterThan(0);
  expect(forecast[TICKS_PER_MONTH].supplyByFuel.Uranium ?? 0).toBe(0);
  expect(forecast.at(-1)!.supplyByFuel.Uranium ?? 0).toBe(0);
  expect(game.facilities[0].paused).not.toBe(true);
});
