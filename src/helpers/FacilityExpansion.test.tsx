import cloneDeep from "lodash.clonedeep";
import { YEARS_PER_TICK, TICKS_PER_MONTH } from "../Constants";
import { getBuildFacilityQuote, STORAGE } from "../data/Facilities";
import { createGame } from "../testing/Simulator";
import reducer, {
  buildFacility,
  tickState,
  tick,
  reprioritizeFacility,
  sellFacility,
  retrofitFacility,
} from "../reducers/Game";
import {
  expandFacility,
  cancelFacilityExpansion,
} from "../reducers/GameActions";
import { currentCash, currentTick } from "./GameSelectors";
import { facilityCashBack } from "./Financials";
import {
  facilityExpansionQuote,
  completeFacilityExpansion,
  validExpandFacilityAction,
} from "./FacilityExpansion";
import { facilitySignature } from "./Projection";
import { copyCommitmentMetadata } from "./Commitment";
import { parseSave, serializeSave } from "../SaveGame";
import { GameType, isStorage } from "../Types";
import { validateGameCommand } from "../multiplayer/Commands";

function setup(scenarioId = 104) {
  const game = createGame({ scenarioId, seed: 818 });
  currentTick(game)!.cash = 1e12;
  return game;
}
function quote(
  game: GameType,
  id = game.facilities[0].id,
  size = game.facilities[0].peakW * 1.2,
) {
  const result = facilityExpansionQuote(game, id, size);
  if (result.status !== "ready") throw new Error(result.reason);
  return result;
}
function begin(
  game: GameType,
  id = game.facilities[0].id,
  size = game.facilities[0].peakW * 1.2,
) {
  const result = quote(game, id, size);
  return cloneDeep(
    reducer(
      game,
      expandFacility({
        facilityId: id,
        targetSize: size,
        quoteKey: result.quoteKey,
      }),
    ),
  );
}

it("quotes only the current-era incremental build, keeping historical capital and cash accounting separate", () => {
  const game = setup();
  const plant = game.facilities[0];
  plant.buildCost = 123;
  const result = quote(game);
  const current = getBuildFacilityQuote(game, {
    name: plant.name,
    gasCycle: plant.gasCycle,
    peakW: plant.peakW,
  })!;
  const target = getBuildFacilityQuote(game, {
    name: plant.name,
    gasCycle: plant.gasCycle,
    peakW: result.targetSize,
  })!;
  expect(result.cost).toBeCloseTo(target.buildCost - current.buildCost, 5);
  expect(result.yearsToBuild).toBe(target.yearsToBuild);
  expect(result.constructionKgco2eTotal).toBeGreaterThan(0);
  const started = begin(game);
  expect(currentCash(started)).toBeCloseTo(currentCash(game) - result.cost, 3);
  expect(started.facilities[0].peakW).toBe(plant.peakW);
  expect(started.facilities[0].buildCost).toBe(123);
  expect(started.facilities[0].lifetimeExpenses).toBe(plant.lifetimeExpenses);
  expect(currentTick(started)!.expensesOM).toBe(currentTick(game)!.expensesOM);
  expect(currentTick(started)!.netWorth).toBeCloseTo(
    currentCash(game) +
      game.facilities.reduce(
        (sum, facility) => sum + facilityCashBack(facility, game.date.minute),
        0,
      ),
    2,
  );
  expect(facilityCashBack(started.facilities[0], game.date.minute)).toBeCloseTo(
    facilityCashBack(plant, game.date.minute) + result.cost,
    4,
  );
  expect(
    reducer(
      started,
      expandFacility({
        facilityId: plant.id,
        targetSize: result.targetSize,
        quoteKey: result.quoteKey,
      }),
    ),
  ).toEqual(started);
});

it("rejects malformed, shrinking, stale, foreign, over-limit, conflicting and unaffordable orders", () => {
  const game = setup();
  const plant = game.facilities[0];
  const result = quote(game);
  const action = {
    facilityId: plant.id,
    targetSize: result.targetSize,
    quoteKey: result.quoteKey,
  };
  for (const raw of [
    null,
    {},
    { ...action, cost: 0 },
    { ...action, targetSize: Infinity },
    { ...action, facilityId: -1 },
  ]) {
    expect(validExpandFacilityAction(raw)).toBe(false);
    expect(reducer(game, { type: expandFacility.type, payload: raw })).toEqual(
      game,
    );
  }
  for (const raw of [
    { ...action, quoteKey: "stale" },
    { ...action, facilityId: 999999 },
    { ...action, targetSize: plant.peakW },
    { ...action, targetSize: 1e12 },
  ]) {
    expect(reducer(game, expandFacility(raw))).toEqual(game);
    expect(validateGameCommand(game, "expandFacility", raw)).toHaveProperty(
      "error",
    );
  }
  const conflicting = cloneDeep(game);
  conflicting.facilities[0].upgradeInProgress = {
    upgrade: "coldWeatherPackage",
    cost: 1,
    startsMinute: 0,
    completesMinute: 60,
  };
  expect(reducer(conflicting, expandFacility(action))).toEqual(conflicting);
  const poor = cloneDeep(game);
  currentTick(poor)!.cash = 0;
  expect(reducer(poor, expandFacility(action))).toEqual(poor);
});

it("cancels and sells pending equity exactly once, without reversing emitted construction carbon", () => {
  const game = setup();
  const result = quote(game);
  const started = begin(game);
  const expansion = started.facilities[0].expansionInProgress!;
  expansion.constructionKgco2eEmitted = 10;
  const beforeCarbon = started.facilities[0].constructionKgco2eEmitted ?? 0;
  const cancelled = reducer(
    started,
    cancelFacilityExpansion(started.facilities[0].id),
  );
  expect(currentCash(cancelled)).toBeCloseTo(currentCash(game), 3);
  expect(cancelled.facilities[0].constructionKgco2eEmitted).toBe(
    beforeCarbon + 10,
  );
  expect(cancelled.facilities[0].expansionInProgress).toBeUndefined();
  expect(
    reducer(cancelled, cancelFacilityExpansion(started.facilities[0].id)),
  ).toEqual(cancelled);
  expect(
    currentCash(reducer(started, sellFacility(started.facilities[0].id))),
  ).toBeCloseTo(
    currentCash(started) +
      facilityCashBack(started.facilities[0], started.date.minute),
    3,
  );
  expect(started.facilities[0].expansionInProgress!.cost).toBe(result.cost);
});

it("keeps old capacity online, completes in forecasts and live ticks, and books final construction emissions", () => {
  const original = setup();
  const game = begin(original);
  const plant = game.facilities[0];
  const result = quote(original);
  const job = plant.expansionInProgress!;
  // Compress a valid canonical project only in this fixture, placing its last partial tick at rollover.
  job.yearsToBuild = YEARS_PER_TICK * (TICKS_PER_MONTH + 0.5);
  job.yearsToBuildLeft = job.yearsToBuild;
  expect(plant.currentW).toBe(original.facilities[0].currentW);
  tickState(game);
  expect(plant.peakW).toBe(original.facilities[0].peakW);
  expect(plant.currentW).toBeGreaterThan(0);
  const lifetimeBefore = plant.lifetimeWh;
  let control = cloneDeep(game);
  control.facilities[0].expansionInProgress!.yearsToBuildLeft =
    YEARS_PER_TICK / 2;
  // One fast-ramping plant under a shortage makes the capacity boundary directly observable.
  control.facilities[0].spinMinutes = 1;
  control.facilities.slice(1).forEach((facility) => {
    facility.paused = true;
    facility.currentW = 0;
  });
  control.timeline.forEach((frame) => {
    frame.demandW = 1e12;
  });
  const forecasted = reducer(
    control,
    reprioritizeFacility({ spotInList: 0, delta: 1 }),
  );
  const forecast = forecasted.timeline;
  const controlledId = plant.id;
  expect(
    forecasted.facilities.find(({ id }) => id === controlledId)!.peakW,
  ).toBe(original.facilities[0].peakW);
  control = cloneDeep(forecasted);
  forecasted.timeline.forEach((frame, index) =>
    copyCommitmentMetadata(frame, control.timeline[index]),
  );
  const predicted = forecast.find(
    (frame) => frame.minute > control.date.minute,
  )!;
  tickState(control);
  expect(control.facilities.find(({ id }) => id === controlledId)!.peakW).toBe(
    result.targetPeakW,
  );
  expect(
    control.facilities.find(({ id }) => id === controlledId)!
      .expansionInProgress,
  ).toBeUndefined();
  expect(currentTick(control)!.supplyW).toBe(predicted.supplyW);
  for (let i = 0; i < TICKS_PER_MONTH + 2; i++) tickState(game);
  const completed = game.facilities[0];
  expect(completed.peakW).toBe(result.targetPeakW);
  expect(completed.constructionKgco2eEmitted).toBeCloseTo(
    (original.facilities[0].constructionKgco2eEmitted ?? 0) +
      result.constructionKgco2eTotal,
    5,
  );
  expect(completed.lifetimeWh).toBeGreaterThan(lifetimeBefore);
  expect(completed).toMatchObject({
    id: plant.id,
    minuteOperational: original.facilities[0].minuteOperational,
    lifespanYears: original.facilities[0].lifespanYears,
    btuPerWh: original.facilities[0].btuPerWh,
    loanAmountTotal: original.facilities[0].loanAmountTotal,
  });
});

it("preserves absolute stored energy, reservoir water, debt and operating history at completion", () => {
  const game = setup(100);
  const storageQuote = STORAGE(game, 10e6).find(
    (item) => item.name === "Battery",
  )!;
  const storageGame = cloneDeep(
    reducer(game, buildFacility({ facility: storageQuote, financed: false })),
  );
  const storage = storageGame.facilities.find(isStorage)!;
  storage.yearsToBuildLeft = 0;
  storage.minuteOperational = 0;
  storage.currentWh = 12345;
  const started = begin(storageGame, storage.id, storage.peakWh * 2);
  const plant = started.facilities.find((item) => item.id === storage.id)!;
  const before = cloneDeep(plant);
  plant.expansionInProgress!.yearsToBuildLeft = 0;
  completeFacilityExpansion(plant);
  expect(plant.currentWh).toBe(12345);
  expect(plant.peakWh).toBe(storage.peakWh * 2);
  expect(plant).toMatchObject({
    id: before.id,
    minuteCreated: before.minuteCreated,
    minuteOperational: before.minuteOperational,
    loanAmountLeft: before.loanAmountLeft,
    lifetimeWh: before.lifetimeWh,
    lifetimeExpenses: before.lifetimeExpenses,
  });
  // Hydro's extensive sizing fields grow, while its actual stored water does not.
  const hydro = {
    ...game.facilities[0],
    fuel: "Hydro",
    reservoirWh: 77,
    reservoirCapacityWh: 100,
    hydroWhPerMm: 2,
    hydroMeanMonthlyInflowWh: 10,
    expansionInProgress: {
      ...before.expansionInProgress!,
      targetPeakWh: undefined,
      targetSize: game.facilities[0].peakW * 2,
      targetPeakW: game.facilities[0].peakW * 2,
      yearsToBuildLeft: 0,
    },
  } as (typeof game.facilities)[0];
  completeFacilityExpansion(hydro);
  expect(hydro.reservoirWh).toBe(77);
  expect(hydro.reservoirCapacityWh).toBe(200);
  expect(hydro.hydroWhPerMm).toBe(4);
  expect(hydro.hydroMeanMonthlyInflowWh).toBe(20);
});

it("round trips pending work, rejects malformed saves, blocks retrofits and keeps projection signatures stable during progress", () => {
  const game = begin(setup());
  const signature = facilitySignature(game);
  const saved = parseSave(JSON.parse(JSON.stringify(serializeSave(game))));
  expect(saved).not.toBeNull();
  expect(saved!.game.facilities).toEqual(game.facilities);
  expect(
    validateGameCommand(game, "cancelFacilityExpansion", game.facilities[0].id),
  ).toHaveProperty("payload");
  const frozen = reducer(
    game,
    retrofitFacility({
      facilityId: game.facilities[0].id,
      upgrade: "coldWeatherPackage",
    }),
  );
  expect(frozen).toEqual(game);
  const progress = cloneDeep(game);
  progress.facilities[0].expansionInProgress!.yearsToBuildLeft /= 2;
  expect(facilitySignature(progress)).toBe(signature);
  for (const mutation of [
    { cost: -1 },
    { cost: game.facilities[0].expansionInProgress!.cost + 1 },
    { targetPeakW: game.facilities[0].expansionInProgress!.targetPeakW + 1 },
    { targetSize: 1 },
    { yearsToBuildLeft: Infinity },
    { targetPeakWh: 123 },
    { constructionKgco2eEmitted: 1e15 },
    { loanAmountLeft: 0 },
  ]) {
    const malformed = JSON.parse(JSON.stringify(serializeSave(game)));
    Object.assign(malformed.game.facilities[0].expansionInProgress, mutation);
    expect(parseSave(malformed)).toBeNull();
  }
  // The Redux tick path must clone the nested project before mutating a frozen snapshot.
  const running = { ...game, inGame: true, speed: "FAST" as const };
  const clock = jest.spyOn(performance, "now").mockReturnValue(1000000);
  const advanced = reducer(running, tick());
  clock.mockRestore();
  expect(
    advanced.facilities[0].expansionInProgress!.yearsToBuildLeft,
  ).toBeLessThan(game.facilities[0].expansionInProgress!.yearsToBuildLeft);
});

it("pins hydro expansion to its original named site without releasing any other claim", () => {
  const initial = setup(103);
  const hydroQuote = getBuildFacilityQuote(initial, {
    name: "Hydro",
    peakW: 1e6,
  })!;
  const game = cloneDeep(
    reducer(initial, buildFacility({ facility: hydroQuote, financed: false })),
  );
  const hydro = game.facilities.find((facility) => facility.fuel === "Hydro")!;
  expect(hydro.hydroSiteId).toBeDefined();
  hydro.yearsToBuildLeft = 0;
  hydro.minuteOperational = 0;
  game.commissionedHydroSiteIds.push(hydro.hydroSiteId!);
  const claims = [...game.commissionedHydroSiteIds];
  // Inherited sites can be absent from the inventory offered for fresh construction.
  const result = quote(game, hydro.id, hydro.peakW * 1.05);
  const started = begin(game, hydro.id, result.targetSize);
  expect(
    started.facilities.find(({ id }) => id === hydro.id)!.hydroSiteId,
  ).toBe(hydro.hydroSiteId);
  expect(game.commissionedHydroSiteIds).toEqual(claims);
  expect(started.commissionedHydroSiteIds).toEqual(claims);
  expect(facilityExpansionQuote(game, hydro.id, 1e12).status).toBe(
    "unavailable",
  );
  expect(parseSave(serializeSave(started))).not.toBeNull();
});
