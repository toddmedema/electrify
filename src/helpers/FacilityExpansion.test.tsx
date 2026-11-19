import * as FacilityCatalog from "../data/Facilities";
import cloneDeep from "lodash.clonedeep";
import { YEARS_PER_TICK, TICKS_PER_MONTH, TICK_MINUTES } from "../Constants";
import { getBuildFacilityQuote, STORAGE } from "../data/Facilities";
import { DEFAULT_CUSTOM_SCENARIO } from "../data/Scenarios";
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
  acquireUtility,
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
import { acquisitionQuote } from "./Expansion";
import { modScenario } from "../mods/ModScenario";

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

it("accepts and restores an in-era gas-fired steam capacity project", () => {
  const scenario = {
    ...DEFAULT_CUSTOM_SCENARIO,
    startingYear: 1980,
    facilities: [{ name: "Natural Gas Steam", peakW: 100e6 }],
  };
  const game = createGame({ scenarioId: scenario.id, scenario });
  currentTick(game)!.cash = 1e12;
  const facility = game.facilities[0];
  expect(facilityExpansionQuote(game, facility.id, 1.1e9)).toMatchObject({
    status: "unavailable",
    maxSize: 1e9,
  });
  const started = begin(game, facility.id, 200e6);
  const restored = parseSave(
    JSON.parse(JSON.stringify(serializeSave(started))),
  );
  expect(restored?.game.facilities[0]).toMatchObject({
    name: "Natural Gas Steam",
    gasCycle: "steam",
    peakW: 100e6,
    expansionInProgress: { targetPeakW: 200e6 },
  });
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
    cancelFacilityExpansion({
      facilityId: started.facilities[0].id,
      quoteKey: expansion.quoteKey,
    }),
  );
  expect(currentCash(cancelled)).toBeCloseTo(currentCash(game), 3);
  expect(cancelled.facilities[0].constructionKgco2eEmitted).toBe(
    beforeCarbon + 10,
  );
  expect(cancelled.facilities[0].expansionInProgress).toBeUndefined();
  expect(
    reducer(
      cancelled,
      cancelFacilityExpansion({
        facilityId: started.facilities[0].id,
        quoteKey: expansion.quoteKey,
      }),
    ),
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

it.each([false, true])(
  "keeps completion history private during an ordinary reforecast (earlier expansion: %s)",
  (earlierExpansion) => {
    let game = begin(setup());
    const id = game.facilities[0].id;
    const lever = `asset-expansion:${id}`;
    if (earlierExpansion) {
      game.facilities[0].expansionInProgress!.yearsToBuildLeft =
        YEARS_PER_TICK / 2;
      tickState(game);
      game = begin(game);
    }
    game.facilities[0].expansionInProgress!.yearsToBuildLeft =
      YEARS_PER_TICK / 2;
    const before = cloneDeep(game);

    const forecasted = reducer(
      game,
      reprioritizeFacility({ spotInList: 0, delta: 1 }),
    );

    expect(forecasted.date).toEqual(before.date);
    expect(forecasted.facilities.find((plant) => plant.id === id)).toEqual(
      before.facilities[0],
    );
    expect(forecasted.eventLog).toEqual(before.eventLog);
    expect(
      forecasted.meaningfulDecisions.filter((entry) => entry.lever === lever),
    ).toEqual(
      before.meaningfulDecisions.filter((entry) => entry.lever === lever),
    );
    expect(game).toEqual(before);
  },
);

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
    validateGameCommand(game, "cancelFacilityExpansion", {
      facilityId: game.facilities[0].id,
      quoteKey: game.facilities[0].expansionInProgress!.quoteKey,
    }),
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

it("keeps decimal generator targets exact through pending and completed save round trips", () => {
  const original = setup();
  const target = 220000000.1;
  const started = begin(original, original.facilities[0].id, target);
  expect(started.facilities[0].expansionInProgress!.targetPeakW).toBe(target);
  expect(parseSave(serializeSave(started))).not.toBeNull();
  started.facilities[0].expansionInProgress!.yearsToBuildLeft =
    YEARS_PER_TICK / 2;
  tickState(started);
  expect(started.facilities[0].peakW).toBe(target);
  expect(parseSave(serializeSave(started))).not.toBeNull();
});

it("rejects fractional hydro targets in live quotes and imported pending projects", () => {
  const initial = setup(103);
  const hydroQuote = getBuildFacilityQuote(initial, {
    name: "Hydro",
    peakW: 1e6,
  })!;
  const game = cloneDeep(
    reducer(initial, buildFacility({ facility: hydroQuote, financed: false })),
  );
  const hydro = game.facilities.find((facility) => facility.fuel === "Hydro")!;
  hydro.yearsToBuildLeft = 0;
  hydro.minuteOperational = 0;
  game.commissionedHydroSiteIds.push(hydro.hydroSiteId!);
  expect(facilityExpansionQuote(game, hydro.id, 1000000.5).status).toBe(
    "unavailable",
  );
  const started = begin(game, hydro.id, 1000001);
  const saved = serializeSave(started);
  const pending = saved.game.facilities.find(
    ({ id }) => id === hydro.id,
  )!.expansionInProgress!;
  const key = JSON.parse(pending.quoteKey);
  pending.targetSize = pending.targetPeakW = key[3] = key[4] = 1000000.5;
  pending.quoteKey = JSON.stringify(key);
  expect(parseSave(saved)).toBeNull();
});

it("rejects a self-consistent forged technology limit on import", () => {
  const original = setup();
  const started = begin(original);
  expect(
    facilityExpansionQuote(original, original.facilities[0].id, 100e9).status,
  ).toBe("unavailable");
  const oversized = serializeSave(started);
  const pending = oversized.game.facilities[0].expansionInProgress!;
  const key = JSON.parse(pending.quoteKey);
  pending.targetSize = pending.targetPeakW = key[3] = key[4] = 100e9;
  pending.quoteKey = JSON.stringify(key);
  expect(parseSave(oversized)).toBeNull();
});

it("rejects self-consistent forged storage power geometry on import", () => {
  const original = setup(100);
  const storageQuote = STORAGE(original, 10e6).find(
    ({ name }) => name === "Battery",
  )!;
  const withStorage = cloneDeep(
    reducer(
      original,
      buildFacility({ facility: storageQuote, financed: false }),
    ),
  );
  const storage = withStorage.facilities.find(isStorage)!;
  storage.yearsToBuildLeft = 0;
  storage.minuteOperational = 0;
  const expanded = begin(withStorage, storage.id, 20e6);
  expect(parseSave(serializeSave(expanded))).not.toBeNull();
  const malformed = serializeSave(expanded);
  const storagePending = malformed.game.facilities.find(
    ({ id }) => id === storage.id,
  )!.expansionInProgress!;
  const storageKey = JSON.parse(storagePending.quoteKey);
  storagePending.targetPeakW = storageKey[4] = 1e9;
  storagePending.quoteKey = JSON.stringify(storageKey);
  expect(parseSave(malformed)).toBeNull();
});

it("records only material completed expansions and retains earlier completed work after cancellation or sale", () => {
  const original = setup();
  const lever = `asset-expansion:${original.facilities[0].id}`;
  const started = begin(original);
  expect(
    started.meaningfulDecisions.some((decision) => decision.lever === lever),
  ).toBe(false);
  const sold = reducer(
    cloneDeep(started),
    sellFacility(started.facilities[0].id),
  );
  expect(
    sold.meaningfulDecisions.some((decision) => decision.lever === lever),
  ).toBe(false);
  started.facilities[0].expansionInProgress!.yearsToBuildLeft =
    YEARS_PER_TICK / 2;
  tickState(started);
  const completedDecision = started.meaningfulDecisions.find(
    (decision) => decision.lever === lever,
  );
  expect(completedDecision).toBeDefined();
  const second = begin(started);
  const canceled = reducer(second, {
    type: cancelFacilityExpansion.type,
    payload: {
      facilityId: second.facilities[0].id,
      quoteKey: second.facilities[0].expansionInProgress!.quoteKey,
    },
  });
  expect(
    canceled.meaningfulDecisions.find((decision) => decision.lever === lever),
  ).toEqual(completedDecision);
  const soldLater = reducer(second, sellFacility(second.facilities[0].id));
  expect(
    soldLater.meaningfulDecisions.find((decision) => decision.lever === lever),
  ).toEqual(completedDecision);
  const tiny = begin(
    original,
    original.facilities[0].id,
    original.facilities[0].peakW + 1,
  );
  tiny.facilities[0].expansionInProgress!.yearsToBuildLeft = YEARS_PER_TICK / 2;
  tickState(tiny);
  expect(
    tiny.meaningfulDecisions.some((decision) => decision.lever === lever),
  ).toBe(false);
});

it("binds reducer cancellation and stale starts to an identity retained across cancellation, completion and saves", () => {
  const original = setup();
  const first = begin(original);
  const id = first.facilities[0].id;
  const firstProject = first.facilities[0].expansionInProgress!;
  const cancelA = { facilityId: id, quoteKey: firstProject.quoteKey };
  const canceled = reducer(first, cancelFacilityExpansion(cancelA));
  const resumed = parseSave(serializeSave(canceled))!.game;
  const second = begin(resumed, id, firstProject.targetSize);
  const projectB = second.facilities[0].expansionInProgress!;
  expect(projectB.quoteKey).not.toBe(firstProject.quoteKey);
  expect(projectB.projectSequence).toBeGreaterThan(
    firstProject.projectSequence,
  );
  expect(reducer(second, cancelFacilityExpansion(cancelA))).toEqual(second);
  expect(
    reducer(second, { type: cancelFacilityExpansion.type, payload: id }),
  ).toEqual(second);
  const empty = reducer(
    second,
    cancelFacilityExpansion({ facilityId: id, quoteKey: projectB.quoteKey }),
  );
  expect(
    reducer(
      empty,
      expandFacility({
        facilityId: id,
        targetSize: firstProject.targetSize,
        quoteKey: firstProject.quoteKey,
      }),
    ),
  ).toEqual(empty);
  const third = begin(empty);
  third.facilities[0].expansionInProgress!.yearsToBuildLeft =
    YEARS_PER_TICK / 2;
  const sequence = third.facilities[0].expansionSequence!;
  tickState(third);
  expect(third.facilities[0].expansionSequence).toBe(sequence);
  expect(
    parseSave(serializeSave(third))!.game.facilities[0].expansionSequence,
  ).toBe(sequence);
});

it("validates pending imports without repricing and leaves inherited oversized plants loadable", () => {
  const original = setup();
  const started = begin(original);
  const price = jest
    .spyOn(FacilityCatalog, "getBuildFacilityQuote")
    .mockImplementation(() => {
      throw new Error("Save validation must not reprice a project");
    });
  try {
    expect(parseSave(serializeSave(started))).not.toBeNull();
    expect(price).not.toHaveBeenCalled();
  } finally {
    price.mockRestore();
  }
  const inherited = cloneDeep(original);
  inherited.facilities[0].peakW = 100e9;
  expect(parseSave(serializeSave(inherited))).not.toBeNull();
  expect(
    facilityExpansionQuote(inherited, inherited.facilities[0].id, 100e9 + 1)
      .status,
  ).toBe("unavailable");
});

it("enforces the project's era ceiling even when an imported review key agrees with an impossible target", () => {
  const original = setup(117);
  const plant = original.facilities.find(({ name }) => name === "Coal")!;
  const target = Math.min(500000, plant.peakW * 1.2);
  const started = begin(original, plant.id, target);
  expect(parseSave(serializeSave(started))).not.toBeNull();
  expect(facilityExpansionQuote(original, plant.id, 1e6).status).toBe(
    "unavailable",
  );
  const malformed = serializeSave(started);
  const pending = malformed.game.facilities.find(
    ({ id }) => id === plant.id,
  )!.expansionInProgress!;
  const key = JSON.parse(pending.quoteKey);
  pending.targetSize = pending.targetPeakW = key[3] = key[4] = 1e6;
  pending.quoteKey = JSON.stringify(key);
  expect(parseSave(malformed)).toBeNull();
});

it("rejects imported storage targets over the era ceiling while preserving inherited storage power geometry", () => {
  const initial = setup(100);
  const storageQuote = STORAGE(initial, 10e6).find(
    ({ name }) => name === "Battery",
  )!;
  const game = cloneDeep(
    reducer(
      initial,
      buildFacility({ facility: storageQuote, financed: false }),
    ),
  );
  const storage = game.facilities.find(isStorage)!;
  storage.yearsToBuildLeft = 0;
  storage.minuteOperational = 0;
  storage.peakW = storage.peakWh * 0.8; // An inherited vintage with today's four-hour additions.
  const started = begin(game, storage.id, 20e6);
  expect(parseSave(serializeSave(started))).not.toBeNull();
  const malformed = serializeSave(started);
  const pending = malformed.game.facilities.find(
    ({ id }) => id === storage.id,
  )!.expansionInProgress!;
  const key = JSON.parse(pending.quoteKey);
  pending.targetSize = pending.targetPeakWh = key[3] = 100e9;
  pending.targetPeakW = key[4] =
    storage.peakW + (100e9 - storage.peakWh) * 0.25;
  pending.quoteKey = JSON.stringify(key);
  expect(parseSave(malformed)).toBeNull();
});

it("round-trips a valid capacity project longer than 100 years", () => {
  const scenario = modScenario(
    {
      schemaVersion: 1,
      gameApi: 1,
      id: "long-storage-expansion",
      title: "Long storage expansion",
      creator: "Test",
      version: "1",
      description: "Long lead times for closed-loop pumped storage.",
      baseScenarioId: 100,
      facilities: { "Pumped Hydro": { yearsToBuild: 10 } },
    },
    undefined,
    "CEO",
  );
  const game = createGame({
    scenarioId: scenario.id,
    scenario,
    difficulty: "CEO",
  });
  currentTick(game)!.cash = 1e12;
  const storageQuote = STORAGE(game, 10e9).find(
    ({ name }) => name === "Pumped Hydro",
  )!;
  const withStorage = cloneDeep(
    reducer(game, buildFacility({ facility: storageQuote, financed: false })),
  );
  const storage = withStorage.facilities.find(isStorage)!;
  storage.yearsToBuildLeft = 0;
  storage.minuteOperational = 0;
  const expanded = begin(withStorage, storage.id, 20e9);
  const pending = expanded.facilities.find(
    ({ id }) => id === storage.id,
  )!.expansionInProgress;
  expect(pending?.yearsToBuild).toBeGreaterThan(100);
  const resumed = parseSave(serializeSave(expanded))?.game.facilities.find(
    ({ id }) => id === storage.id,
  );
  expect(resumed?.expansionInProgress).toEqual(pending);
});

it("reconciles completed and canceled work on an acquired plant without relaxing provenance", () => {
  const game = setup(116);
  const acquisition = acquisitionQuote(game, "valley-electric")!;
  const bought = cloneDeep(
    reducer(
      game,
      acquireUtility({
        targetId: "valley-electric",
        financed: false,
        quoteKey: acquisition.quoteKey,
      }),
    ),
  );
  const plant = bought.facilities.find(
    ({ startingAssetId }) => startingAssetId === "scenario-116-valley-biomass",
  )!;
  let expanded = begin(bought, plant.id, 12e6);
  const operated = expanded.facilities.find(({ id }) => id === plant.id)!;
  operated.expansionInProgress!.yearsToBuildLeft = YEARS_PER_TICK / 2;
  tickState(expanded);
  expect(operated.expansionInProgress).toBeUndefined();
  expect(operated.peakW).toBe(12e6);
  expect(operated.acquiredExpansion?.addedCapacityW).toBe(1e6);
  expect(
    parseSave(serializeSave(expanded))?.game.facilities.find(
      ({ id }) => id === plant.id,
    ),
  ).toEqual(operated);

  expanded = begin(expanded, plant.id, 13e6);
  tickState(expanded);
  const second = expanded.facilities.find(
    ({ id }) => id === plant.id,
  )!.expansionInProgress!;
  expect(second.constructionKgco2eEmitted).toBeGreaterThan(0);
  const canceled = reducer(
    expanded,
    cancelFacilityExpansion({
      facilityId: plant.id,
      quoteKey: second.quoteKey,
    }),
  );
  const saved = cloneDeep(serializeSave(canceled));
  const savedPlant = saved.game.facilities.find(({ id }) => id === plant.id)!;
  expect(savedPlant.peakW).toBe(12e6);
  expect(savedPlant.constructionKgco2eEmitted).toBeGreaterThan(
    operated.constructionKgco2eEmitted!,
  );
  expect(
    parseSave(saved)?.game.facilities.find(({ id }) => id === plant.id),
  ).toEqual(savedPlant);
  savedPlant.peakW += 1;
  expect(parseSave(saved)).toBeNull();

  savedPlant.peakW = operated.peakW;
  savedPlant.acquiredExpansion!.investedCapital = 1e16;
  savedPlant.buildCost = plant.buildCost + 1e16;
  expect(parseSave(saved)).toBeNull();
});

it.each([
  ["biomass", 12e6, 51e6],
  ["oil", 28e6, 1.1e9],
] as const)(
  "rejects completed acquired %s expansion above its allowable capacity",
  (asset, target, oversized) => {
    const game = setup(116);
    const acquisition = acquisitionQuote(game, "valley-electric")!;
    const bought = cloneDeep(
      reducer(
        game,
        acquireUtility({
          targetId: "valley-electric",
          financed: false,
          quoteKey: acquisition.quoteKey,
        }),
      ),
    );
    const plant = bought.facilities.find(
      ({ startingAssetId }) =>
        startingAssetId === `scenario-116-valley-${asset}`,
    )!;
    expect(facilityExpansionQuote(bought, plant.id, oversized).status).toBe(
      "unavailable",
    );
    const expanded = begin(bought, plant.id, target);
    expanded.facilities.find(
      ({ id }) => id === plant.id,
    )!.expansionInProgress!.yearsToBuildLeft = YEARS_PER_TICK / 2;
    tickState(expanded);
    const saved = cloneDeep(serializeSave(expanded));
    expect(parseSave(saved)).not.toBeNull();

    const installed = saved.game.facilities.find(({ id }) => id === plant.id)!;
    const account = installed.acquiredExpansion!;
    installed.peakW = oversized;
    account.addedCapacityW = oversized - plant.peakW;
    installed.buildCost += 1e6;
    account.investedCapital += 1e6;
    expect(parseSave(saved)).toBeNull();
  },
);

it("binds a new expansion to the particular installation when a facility ID is reused", () => {
  const original = setup();
  const initial = begin(original);
  const facility = initial.facilities[0];
  const replacement = cloneDeep(original);
  replacement.facilities[0].minuteCreated -= TICK_MINUTES;
  const started = begin(replacement);
  expect(started.facilities[0].expansionInProgress!.quoteKey).not.toBe(
    facility.expansionInProgress!.quoteKey,
  );
  const stale = cancelFacilityExpansion({
    facilityId: facility.id,
    quoteKey: facility.expansionInProgress!.quoteKey,
  });
  expect(reducer(started, stale)).toEqual(started);
});

it.each([null, "1000", 0, -1, Infinity, NaN])(
  "declines an invalid storage dimension before pricing: %p",
  (peakWh) => {
    const game = setup(100);
    const request = { name: "Battery", peakW: 1e6, peakWh };
    expect(
      getBuildFacilityQuote(
        game,
        request as Parameters<typeof getBuildFacilityQuote>[1],
      ),
    ).toBeUndefined();
    expect(
      validateGameCommand(game, "buildFacility", {
        facility: request,
        financed: false,
      }),
    ).toEqual({ error: "Choose a valid facility size" });
    expect(
      getBuildFacilityQuote(game, { name: "Battery", peakWh: 1e6 }),
    ).toMatchObject({ name: "Battery", peakWh: 1e6 });
  },
);
