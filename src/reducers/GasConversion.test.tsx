import cloneDeep from "lodash.clonedeep";
import reducer, {
  retrofitFacility,
  cancelRetrofit,
  tickState,
  resume,
  reprioritizeFacility,
} from "./Game";
import { createGame, createGameFromReplay } from "../testing/Simulator";
import {
  gasConversionQuote,
  GAS_CONVERSION_MINUTES,
  completeGasConversion,
} from "../helpers/GasConversion";
import { currentCash } from "../helpers/GameSelectors";
import { parseSave, serializeSave } from "../SaveGame";
import { serializeReplay } from "../Replay";
import { GameType } from "../Types";
import { getInflationIndex } from "../data/Economy";
import { GENERATORS } from "../data/Facilities";
import { getDateFromMinute } from "../helpers/DateTime";
import { serializeCommitmentMetadata } from "../helpers/Commitment";

const advance = (game: GameType, minute: number) => {
  while (game.date.minute < minute) tickState(game);
};
const begin = (game: GameType) =>
  cloneDeep(
    reducer(
      game,
      retrofitFacility({ facilityId: 2, upgrade: "combinedCycle" }),
    ),
  );

it("reordering near conversion uses CC dispatch and preserves the unconstrained baseline", () => {
  const game = createGame({ scenarioId: 104 });
  const plant = game.facilities.find((f) => f.id === 2)!;
  // Put a small merit-order request on the peaker, below either technology's minimum output.
  game.facilities = [plant, ...game.facilities.filter((f) => f.id !== 2)];
  plant.currentW = 0;
  plant.committed = false;
  plant.generatingLastRealTick = false;
  plant.upgradeInProgress = {
    upgrade: "combinedCycle",
    cost: 1,
    startsMinute: 0,
    completesMinute: 120,
  };
  game.timeline.forEach((t) => {
    t.demandW = 1000000;
  });
  const expected = cloneDeep(game);
  // Reference fleet already has the target technology, but retains the exact same outage.
  completeGasConversion(expected.facilities[0], {
    ...expected,
    date: getDateFromMinute(120, expected.startingYear),
  });
  const action = reprioritizeFacility({ spotInList: 1, delta: 1 });
  const forecast = reducer(game, action);
  const reference = reducer(expected, action);
  expect(forecast.facilities[0].gasCycle).toBe("simple"); // A forecast must not convert the live asset.
  const after = forecast.timeline.filter((t) => t.minute >= 120);
  expect(after.some((t) => t.supplyW > 0)).toBe(true);
  expect(after.map((t) => [t.supplyW, t.expensesFuel])).toEqual(
    reference.timeline
      .filter((t) => t.minute >= 120)
      .map((t) => [t.supplyW, t.expensesFuel]),
  );
  const metadata = serializeCommitmentMetadata(forecast.timeline)!;
  metadata
    .slice(forecast.timeline.findIndex((t) => t.minute >= 120))
    .forEach((entry) => {
      expect(entry!.dispatchTargets["2"]).toBeLessThanOrEqual(1000000);
    });
  expect(metadata).toEqual(serializeCommitmentMetadata(reference.timeline));
});

it("charges once, allows cancellation, completes, and preserves save/replay parity", () => {
  const game = createGame({ scenarioId: 104, seed: 4242 });
  const original = game.facilities.find((f) => f.id === 2)!;
  const quote = gasConversionQuote(original, game)!;
  expect(quote).toBeDefined();
  let played = begin(game);
  expect(currentCash(played)).toBeCloseTo(currentCash(game) - quote.cost, 3);
  expect(begin(played)).toEqual(played);
  const cancelled = reducer(played, cancelRetrofit(2));
  expect(currentCash(cancelled)).toBeCloseTo(currentCash(game), 3);
  expect(cancelled.meaningfulDecisions).toEqual(game.meaningfulDecisions);
  expect(cancelled.facilities.find((f) => f.id === 2)!.gasCycle).toBe("simple");
  played = cloneDeep(played);
  advance(played, 60);
  expect(played.facilities.find((f) => f.id === 2)!.currentW).toBe(0);
  const saved = parseSave(JSON.parse(JSON.stringify(serializeSave(played))));
  expect(saved).not.toBeNull();
  const restored = cloneDeep(reducer(undefined, resume(saved!.game)));
  advance(played, GAS_CONVERSION_MINUTES + 60);
  advance(restored, GAS_CONVERSION_MINUTES + 60);
  const converted = played.facilities.find((f) => f.id === 2)!;
  expect(converted).toMatchObject({
    gasCycle: "combined",
    peakW: original.peakW,
    minuteOperational: original.minuteOperational,
    lifespanYears: original.lifespanYears,
    btuPerWh: 6.266,
    spinMinutes: 90,
    minimumStableOutput: 0.45,
  });
  expect(converted.upgradeInProgress).toBeUndefined();
  const target = GENERATORS(played, original.peakW, [], []).find(
    (g) => g.gasCycle === "combined",
  )!;
  const escalation =
    getInflationIndex(played.date, played.startingYear, played.seed) /
    (converted.costIndexAtBuild ?? 1);
  expect(converted.annualOperatingCost * escalation).toBeCloseTo(
    target.annualOperatingCost,
    4,
  );
  expect(converted.variableOperatingCostPerMWh! * escalation).toBeCloseTo(
    target.variableOperatingCostPerMWh!,
    4,
  );
  expect(converted.costPerStart! * escalation).toBeCloseTo(
    target.costPerStart!,
    4,
  );
  expect(gasConversionQuote(converted, played)).toBeUndefined();
  expect(restored.facilities).toEqual(played.facilities);
  expect(restored.monthlyHistory).toEqual(played.monthlyHistory);
  const replayed = createGameFromReplay(serializeReplay(played)!);
  advance(replayed, played.date.minute);
  expect(replayed.facilities).toEqual(played.facilities);
  expect(replayed.monthlyHistory).toEqual(played.monthlyHistory);
}, 120000);

it("rejects ineligible plants and unaffordable conversions", () => {
  const game = createGame({ scenarioId: 104 });
  const plant = game.facilities.find((f) => f.id === 2)!;
  expect(
    gasConversionQuote({ ...plant, yearsToBuildLeft: 1 }, game),
  ).toBeUndefined();
  expect(
    gasConversionQuote(plant, { ...game, date: { ...game.date, year: 1989 } }),
  ).toBeUndefined();
  expect(
    gasConversionQuote({ ...plant, minuteOperational: -100000000 }, game),
  ).toBeUndefined();
  expect(gasConversionQuote(game.facilities[0], game)).toBeUndefined();
  game.timeline.forEach((t) => {
    t.cash = 0;
  });
  expect(begin(game).facilities).toEqual(game.facilities);
});
