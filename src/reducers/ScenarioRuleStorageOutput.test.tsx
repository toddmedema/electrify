import "../Store";
import cloneDeep from "lodash.clonedeep";
import { TICKS_PER_HOUR } from "../Constants";
import { resolveStoryAtDate } from "../data/WorldEvents";
import { currentTick } from "../helpers/GameSelectors";
import { buildStorySnapshot } from "../helpers/Story";
import { modScenario } from "../mods/ModScenario";
import { loadSimData } from "../testing/SimData";
import { runMonths } from "../testing/SimulationTestHelpers";
import { createGame } from "../testing/Simulator";
import type { GameType, TickPresentFutureType } from "../Types";
import { isStorage } from "../Types";
import reducer, {
  generateNewTimeline,
  tickState,
  togglePauseFacility,
} from "./Game";

beforeEach(() => jest.useFakeTimers());
afterEach(() => {
  jest.clearAllTimers();
  jest.useRealTimers();
});

function originalBattery(game: GameType) {
  const battery = game.facilities.find(
    (facility) => facility.startingAssetId === "scenario-110-battery",
  )!;
  expect(isStorage(battery)).toBe(true);
  if (!isStorage(battery)) throw new Error("Original battery is not storage");
  return battery;
}

function setup(multiplier: number) {
  loadSimData("Paris");
  const scenario = modScenario(
    {
      schemaVersion: 1,
      gameApi: 1,
      id: "qa-storage-output",
      title: "Storage output",
      creator: "QA review",
      description: "The original battery has a temporary output limit.",
      version: "1",
      seed: 12345,
      baseScenarioId: 110,
      officialArcs: [],
      objectives: { mode: "none" },
      scenario: {
        durationMonths: 6,
        startingCustomers: 100000,
        cash: 1e9,
        dollarsPerkWh: 0.2,
      },
      events: [
        {
          id: "battery-limit",
          title: "Battery output limit",
          message: "The battery temporarily loses output.",
          preview: "The battery will temporarily lose output.",
          startMonth: 2,
          durationMonths: 1,
          effects: {
            outputMultipliersBySelector: [
              {
                target: {
                  selector: "startingAsset",
                  assetId: "scenario-110-battery",
                },
                outputMultiplier: multiplier,
              },
            ],
          },
        },
      ],
    },
    undefined,
    "Employee",
  );
  let game = createGame({
    scenarioId: 999,
    scenario,
    difficulty: "Employee",
    seed: 12345,
  });
  // Charge the catalog battery from actual surplus, then use ordinary player
  // actions to expose its discharge and reserve. No energy or clock is injected.
  runMonths(game, 1);
  for (const facility of [...game.facilities])
    if (!isStorage(facility))
      game = cloneDeep(reducer(game, togglePauseFacility(facility.id)));
  const battery = originalBattery(game);
  expect(battery.currentWh).toBeGreaterThan(battery.peakW / TICKS_PER_HOUR);
  expect(
    game.facilities
      .filter((facility) => !isStorage(facility))
      .every((facility) => facility.paused === true),
  ).toBe(true);
  // Reach the authored rule through the public compiler and its real onset
  // selection, rather than supplying a fabricated runtime multiplier.
  const effects = resolveStoryAtDate({
    rules: game.customScenario!.mod!.rules,
    scenarioId: 999,
    seed: game.seed,
    difficulty: game.difficulty,
    date: game.date,
    location: game.location,
    occurrences: game.worldEvents.occurrences,
    snapshot: buildStorySnapshot(
      game.monthlyHistory,
      game.facilities,
      game.date.minute,
    ),
  }).effects;
  expect(effects.facilityOutputMultipliersById?.[String(battery.id)]).toBe(
    multiplier,
  );
  return game;
}

function reachableTotalW(tick: TickPresentFutureType) {
  expect(tick.reserveW).toBeDefined();
  if (tick.reserveW === undefined)
    throw new Error("Actual tick did not report reachable reserve");
  return tick.reserveW + tick.demandW;
}

test.each([1, 0.5, 0])(
  "starting battery output multiplier %s controls actual discharge and reachable reserve",
  (multiplier) => {
    const game = setup(multiplier);
    tickState(game);
    const battery = originalBattery(game);
    const tick = currentTick(game)!;
    const limitedPeakW = battery.peakW * multiplier;
    expect(tick.demandW).toBeGreaterThan(0);
    if (multiplier === 0.5) expect(tick.demandW).toBeGreaterThan(limitedPeakW);
    expect(battery.currentW).toBeCloseTo(
      Math.min(tick.demandW, limitedPeakW),
      5,
    );
    expect(tick.storageDischargeW).toBeCloseTo(battery.currentW, 5);
    expect(reachableTotalW(tick)).toBeCloseTo(limitedPeakW, 5);
  },
);

test("a zero-output battery forecast uses the same output limit without mutating live energy", () => {
  const game = setup(0);
  const before = cloneDeep(game);
  const tick = currentTick(game)!;
  const forecast = generateNewTimeline(game, tick.cash, tick.customers, 2);
  expect(forecast).toHaveLength(2);
  for (const projected of forecast) {
    expect(projected.demandW).toBeGreaterThan(0);
    expect(projected.storageDischargeW).toBe(0);
    expect(reachableTotalW(projected)).toBeCloseTo(0, 5);
  }
  expect(game).toEqual(before);
});

test("the battery output limit expires normally with real charge and no invented energy", () => {
  const game = setup(0);
  runMonths(game, 1);
  expect(originalBattery(game).currentWh).toBeGreaterThan(0);
  tickState(game);
  const battery = originalBattery(game);
  expect(battery.currentW).toBeGreaterThan(0);
  expect(reachableTotalW(currentTick(game)!)).toBeCloseTo(battery.peakW, 5);
});
