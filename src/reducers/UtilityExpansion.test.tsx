import { TICKS_PER_HOUR, GAME_TO_REAL_YEARS } from "../Constants";
import cloneDeep from "lodash.clonedeep";
import { createGame } from "../testing/Simulator";
import { GENERATORS } from "../data/Facilities";
import reducer, {
  buildTransmissionLine,
  generateNewTimeline,
  sellFacility,
  tickState,
  togglePauseTransmissionLine,
  recordExpansionMilestones,
} from "./Game";
import { acquireUtility } from "./GameActions";
import {
  acquisitionAssets,
  acquisitionQuote,
  networkCarryingValue,
  ownedUtility,
} from "../helpers/Expansion";
import {
  getTimeFromTimeline,
  MINUTES_PER_MONTH,
  getDateFromMinute,
} from "../helpers/DateTime";
import { facilityCashBack } from "../helpers/Financials";
import type { GameType, UtilityTargetId } from "../Types";
import { UTILITY_TARGETS } from "../data/UtilityExpansion";

function fixture(targetId: UtilityTargetId = "valley-electric") {
  let game = createGame({ scenarioId: 116, seed: 12345, difficulty: "CEO" });
  getTimeFromTimeline(game.date.minute, game.timeline)!.cash = 2e9;
  game = cloneDeep(
    reducer(
      game,
      buildTransmissionLine({
        corridorId: UTILITY_TARGETS.find((target) => target.id === targetId)!
          .corridorId,
        financed: false,
      }),
    ),
  );
  return game;
}
function ready(targetId: UtilityTargetId = "valley-electric") {
  const game = fixture(targetId);
  game.transmission!.lines[0].yearsToBuildLeft = 0;
  return game;
}
function buy(
  game: GameType,
  targetId: UtilityTargetId = "valley-electric",
  financed = true,
) {
  const quote = acquisitionQuote(game, targetId);
  expect(quote).toBeDefined();
  return cloneDeep(
    reducer(
      game,
      acquireUtility({ targetId, financed, quoteKey: quote!.quoteKey }),
    ),
  );
}
test("construction, target identity, missing lines and stale terms guard the owning API", () => {
  const unfinished = fixture();
  expect(acquisitionQuote(unfinished, "valley-electric")).toBeUndefined();
  const game = ready();
  expect(acquisitionQuote(game, "ridge-electric")).toBeUndefined();
  const quote = acquisitionQuote(game, "valley-electric")!;
  expect(quote).toBeDefined();
  const forged = cloneDeep(
    reducer(
      game,
      acquireUtility({
        targetId: "valley-electric",
        financed: true,
        quoteKey: "forged",
      }),
    ),
  );
  expect(forged).toEqual(game);
  const removed = cloneDeep(game);
  removed.transmission!.lines = [];
  expect(acquisitionQuote(removed, "valley-electric")).toBeUndefined();
  const poor = cloneDeep(game);
  getTimeFromTimeline(poor.date.minute, poor.timeline)!.cash = 0;
  expect(
    reducer(
      poor,
      acquireUtility({
        targetId: "valley-electric",
        financed: true,
        quoteKey: quote.quoteKey,
      }),
    ),
  ).toEqual(poor);
});
test.each(["valley-electric", "ridge-electric"] as const)(
  "completed Tier1 buys %s once and a paused wire preserves eligibility",
  (targetId) => {
    let game = ready(targetId);
    game = cloneDeep(
      reducer(
        game,
        togglePauseTransmissionLine(game.transmission!.lines[0].id),
      ),
    );
    const quote = acquisitionQuote(game, targetId)!;
    expect(quote).toBeDefined();
    const before = getTimeFromTimeline(game.date.minute, game.timeline)!;
    const bought = buy(game, targetId);
    expect(ownedUtility(bought, targetId)).toBe(true);
    const after = getTimeFromTimeline(bought.date.minute, bought.timeline)!;
    expect(after.cash).toBeCloseTo(before.cash - quote.financedCashDue, 4);
    expect(after.customers).toBeCloseTo(before.customers + quote.customers, 4);
    expect(after.netWorth).toBeCloseTo(before.netWorth - quote.fee, 3);
    expect(bought.utilityExpansion!.loans).toHaveLength(2);
    expect(
      bought.facilities.filter(
        (facility) => facility.operatingAreaId === targetId,
      ),
    ).toHaveLength(quote.facilities.length);
    expect(acquisitionQuote(bought, targetId)).toBeUndefined();
    expect(
      reducer(
        bought,
        acquireUtility({ targetId, financed: true, quoteKey: quote.quoteKey }),
      ),
    ).toEqual(bought);
    expect(bought.transmission!.lines[0].capacityW).toBe(100e6);
  },
);
test("corporate debt survives selling acquired equipment and network impairment cannot write itself up", () => {
  const game = buy(ready());
  const balance = game.utilityExpansion!.loans.map(
    (loan) => loan.loanAmountLeft,
  );
  const plant = game.facilities.find(
    (facility) => facility.operatingAreaId === "valley-electric",
  )!;
  const sold = cloneDeep(reducer(game, sellFacility(plant.id)));
  expect(
    sold.utilityExpansion!.loans.map((loan) => loan.loanAmountLeft),
  ).toEqual(balance);
  const area = sold.utilityExpansion!.areas.find(
    (entry) => entry.id === "valley-electric",
  )!;
  area.retentionLowWatermark = 0.8;
  const value = networkCarryingValue(
    area,
    area.activatedMinute + 120 * MINUTES_PER_MONTH,
  );
  expect(value).toBeCloseTo(area.networkInitialValue * 0.75 * 0.8, 4);
  area.customers = area.transferredCustomers * 1.1;
  expect(
    networkCarryingValue(area, area.activatedMinute + 120 * MINUTES_PER_MONTH),
  ).toBe(value);
});
test("forecasting does not mutate acquisition ledgers, ownership, money or logs", () => {
  const game = buy(ready());
  const before = cloneDeep(game);
  const now = getTimeFromTimeline(game.date.minute, game.timeline)!;
  const forecast = generateNewTimeline(game, now.cash, now.customers);
  expect(forecast.at(-1)!.areaTicks?.["valley-electric"]).toBeDefined();
  expect(game).toEqual(before);
});
test("acquired portfolios retain original age and purchase does not book construction emissions", () => {
  const game = ready();
  const assets = acquisitionAssets(game, "valley-electric")!;
  expect(assets.every((asset) => asset.constructionKgco2eTotal === 0)).toBe(
    true,
  );
  expect(
    assets.find((asset) => asset.fuel === "Hydro")!.minuteOperational,
  ).toBeLessThan(0);
  expect(
    assets.reduce((sum, asset) => sum + facilityCashBack(asset, 0), 0),
  ).toBeLessThan(610e6);
  const bought = buy(game);
  tickState(bought);
  const now = getTimeFromTimeline(bought.date.minute, bought.timeline)!;
  expect(now.areaTicks?.["valley-electric"]).toBeDefined();
  expect(now.expensesInterest).toBeGreaterThan(0);
  expect(Number.isFinite(now.cash)).toBe(true);
});

test("a paused owned wire exposes local shortage even when another area has excess generation", () => {
  let game = buy(ready("ridge-electric"), "ridge-electric");
  game = cloneDeep(
    reducer(game, togglePauseTransmissionLine(game.transmission!.lines[0].id)),
  );
  game.facilities = game.facilities.filter(
    (facility) => facility.operatingAreaId !== "ridge-electric",
  );
  const wind = game.facilities.find((facility) => facility.fuel === "Wind")!;
  wind.peakW = 1e9;
  const now = getTimeFromTimeline(game.date.minute, game.timeline)!;
  const forecast = generateNewTimeline(game, now.cash, now.customers);
  const constrained = forecast.find((tick) => {
    const champlain = tick.areaTicks!.champlain!,
      ridge = tick.areaTicks!["ridge-electric"]!;
    return (
      champlain.supplyW > champlain.demandW && ridge.supplyW < ridge.demandW
    );
  });
  expect(constrained).toBeDefined();
  expect(constrained!.curtailedW).toBeGreaterThan(0);
  expect(constrained!.supplyW).toBeLessThan(constrained!.demandW);
  expect(constrained!.supplyW).toBeCloseTo(
    Object.values(constrained!.areaTicks!).reduce(
      (sum, tick) => sum + Math.min(tick!.supplyW, tick!.demandW),
      0,
    ),
    4,
  );
});

test("owned endpoints remove their external pool and contracted headroom cannot be resold", () => {
  const game = buy(ready("valley-electric"));
  game.facilities = [];
  for (const area of game.utilityExpansion!.areas) area.customers = 1;
  const now = getTimeFromTimeline(game.date.minute, game.timeline)!;
  const forecast = generateNewTimeline(game, now.cash, 2);
  expect(forecast.every((tick) => tick.transmissionCapacityW === 0)).toBe(true);
  expect(forecast.every((tick) => tick.exportedW === 0)).toBe(true);
  expect(
    forecast.every(
      (tick) => tick.entitlementImportedW! <= tick.entitlementImportCapacityW!,
    ),
  ).toBe(true);
  // The former Valley external offer cannot add a second copy of source supply.
  expect(
    forecast.every(
      (tick) => Math.abs(tick.importedW! - tick.entitlementImportedW!) < 0.001,
    ),
  ).toBe(true);
});

test("internal transfer carries purchased source emissions once in the company ledger", () => {
  const game = buy(ready("ridge-electric"), "ridge-electric");
  game.facilities = [];
  const now = getTimeFromTimeline(game.date.minute, game.timeline)!;
  const forecast = generateNewTimeline(game, now.cash, now.customers);
  for (const tick of forecast) {
    const champlain = tick.areaTicks!.champlain!,
      ridge = tick.areaTicks!["ridge-electric"]!;
    const champlainHydro = Math.max(0, champlain.entitlementImportedW! - 95e6);
    const expected =
      (((champlainHydro * 4 + ridge.entitlementImportedW! * 417) /
        TICKS_PER_HOUR) *
        GAME_TO_REAL_YEARS) /
      1e6;
    expect(tick.localKgco2e).toBe(0);
    expect(tick.importedKgco2e).toBeCloseTo(expected, 4);
    expect(tick.kgco2e).toBeCloseTo(expected, 4);
  }
});

test("both utilities can be acquired independently and a late Valley deal inherits the 2017 reduction", () => {
  let game = buy(ready("valley-electric"));
  game = cloneDeep(
    reducer(
      game,
      buildTransmissionLine({
        corridorId: "vt-champlain-ridge",
        financed: false,
      }),
    ),
  );
  game.transmission!.lines.find(
    (line) => line.corridorId === "vt-champlain-ridge",
  )!.yearsToBuildLeft = 0;
  game = buy(game, "ridge-electric");
  expect(game.utilityExpansion!.areas.map((area) => area.id)).toEqual([
    "champlain",
    "valley-electric",
    "ridge-electric",
  ]);
  expect(game.utilityExpansion!.loans).toHaveLength(4);
  const late = ready("valley-electric");
  late.date = {
    ...late.date,
    year: 2017,
    monthNumber: 1,
    monthsElapsed: 144,
    minute: 144 * MINUTES_PER_MONTH,
  };
  const opening = acquisitionQuote(
    ready("valley-electric"),
    "valley-electric",
  )!;
  const reduced = acquisitionQuote(late, "valley-electric")!;
  expect(
    opening.contracts.find((source) => source.name === "Regional nuclear")!
      .deliverableW,
  ).toBe(152e6);
  expect(
    reduced.contracts.find((source) => source.name === "Regional nuclear")!
      .deliverableW,
  ).toBe(76e6);
  expect(
    acquisitionQuote(ready("ridge-electric"), "ridge-electric")!.contracts[0]
      .deliverableW,
  ).toBe(38e6);
});

test("owned Valley receives its dated supply reminder and reduction once; Ridge receives neither", () => {
  const valley = buy(ready("valley-electric"));
  const ridge = buy(ready("ridge-electric"), "ridge-electric");
  for (const year of [2015, 2017])
    for (const game of [valley, ridge]) {
      game.date = getDateFromMinute(
        (year - 2005) * 12 * MINUTES_PER_MONTH,
        2005,
      );
      recordExpansionMilestones(game);
      recordExpansionMilestones(game);
    }
  expect(
    valley.reportedEventKeys.filter((key) =>
      key.startsWith("scenario-116-valley-supply-"),
    ),
  ).toHaveLength(2);
  expect(
    valley.eventLog.filter((event) => event.title?.startsWith("Valley")),
  ).toHaveLength(2);
  expect(
    ridge.reportedEventKeys.filter((key) =>
      key.startsWith("scenario-116-valley-supply-"),
    ),
  ).toHaveLength(0);
});

it.each(["", "not-an-area", "valley-electric"])(
  "rejects a build with unavailable operating area %p",
  (operatingAreaId) => {
    const game = createGame({ scenarioId: 116, seed: 12345 });
    const facility = GENERATORS(game, 1e6, [], []).find(
      (f) => f.available && f.name === "Solar",
    )!;
    expect(facility).toBeDefined();
    expect(
      reducer(game, {
        type: "game/buildFacility",
        payload: { facility, financed: false, operatingAreaId },
      }),
    ).toBe(game);
  },
);
