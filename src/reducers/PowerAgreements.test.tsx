import type { GeneratorOperatingType, StorageOperatingType } from "../Types";
import { STORAGE } from "../data/Facilities";
import { runMonths } from "../testing/SimulationTestHelpers";
import { validUtilityExpansion } from "../helpers/ExpansionValidation";
import cloneDeep from "lodash.clonedeep";
import { createGame } from "../testing/Simulator";
import { copyOfficialGame } from "../testing/OfficialScenarioExecutionFixtures";
import {
  MINUTES_PER_MONTH,
  getDateFromMinute,
  getTimeFromTimeline,
  summarizeTimeline,
  summarizeTimelineByMonth,
} from "../helpers/DateTime";
import { currentTick } from "../helpers/GameSelectors";
import {
  agreementDate,
  agreementIntervalMinutes,
  validPowerAgreements,
  agreementYearMinute,
  connectionAgreements,
  inheritedConnection,
  powerAgreementQuote,
  agreementDurationDiscount,
  agreementPrice,
  recordAgreementSettlements,
  validPowerAgreementAction,
} from "../helpers/PowerAgreements";
import * as Transmission from "../helpers/Transmission";
import { entitlementSources } from "../helpers/Expansion";
import {
  adjacentMarketPricePerMWh,
  intertieContextForGame,
  intertieBuildQuote,
  intertieUpgradeQuote,
  physicalNeighborImportSupplyW,
} from "../helpers/Transmission";
import { facilitySignature, selectProjection } from "../helpers/Projection";
import { intertieForecastKey } from "../helpers/IntertieOutlook";
import { parseSave, serializeSave } from "../SaveGame";
import { GAME_TO_REAL_YEARS, TICK_MINUTES, TICKS_PER_HOUR } from "../Constants";
import { DEMAND_TYPES } from "../data/DemandProfiles";
import reducer, {
  generateForecastTimeline,
  generateNewTimeline,
  forecastMonthClosingCashAtCustomerRate,
  tickState,
  togglePauseTransmissionLine,
} from "./Game";
import { acceptPowerAgreement, loaded, resume } from "./GameActions";

function at(month = 156) {
  const game = createGame({
    scenarioId: 116,
    seed: 12345,
    difficulty: "Employee",
  });
  game.transmission!.inheritedAgreementTerms = 2;
  game.date = getDateFromMinute(month * MINUTES_PER_MONTH, 2005);
  // This clock-boundary fixture has no played historical objective observations.
  game.objectiveProgress = undefined;
  game.timeline.forEach((tick) => {
    tick.minute += game.date.minute;
  });
  return game;
}
function sign(game: ReturnType<typeof at>, blockId = "champlain-nuclear") {
  const quote = powerAgreementQuote(game, blockId)!;
  expect(quote).toBeDefined();
  return copyOfficialGame(
    reducer(game, acceptPowerAgreement({ blockId, quoteKey: quote.quoteKey })),
  );
}
function request(game: ReturnType<typeof at>, watts: number) {
  game.facilities = [];
  const next = game.timeline.find((tick) => tick.minute > game.date.minute)!;
  next.demandW = watts;
  DEMAND_TYPES.forEach((type) => {
    next.demandByType[type] = type === "Residential" ? watts : 0;
  });
}

let playedSignedGame: ReturnType<typeof at> | undefined;
function playedAgreement() {
  if (!playedSignedGame) {
    const played = createGame({
      scenarioId: 116,
      seed: 12345,
      difficulty: "Employee",
    });
    played.transmission!.inheritedAgreementTerms = 2;
    runMonths(played, 156);
    const quote = powerAgreementQuote(played, "champlain-nuclear", 2)!;
    played.transmission!.acceptedAgreements = [quote.receipt];
    playedSignedGame = played;
  }
  return copyOfficialGame(playedSignedGame);
}

it("opens with a real inherited operating interface that cannot be built, financed or upgraded", () => {
  const game = at(0);
  expect(game.transmission!.lines).toEqual([
    expect.objectContaining({
      corridorId: "vt-champlain-regional",
      capacityW: 300e6,
      buildCost: 0,
      yearsToBuildLeft: 0,
    }),
  ]);
  expect(currentTick(game)!.importedW).toBeGreaterThan(0);
  expect(game.transmission!.lines[0].currentFlowW).toBe(
    currentTick(game)!.importedW,
  );
  expect(intertieBuildQuote("vt-champlain-regional", 2005)).toBeUndefined();
  expect(
    intertieUpgradeQuote(game.transmission!.lines[0], 2005),
  ).toBeUndefined();
});
it("rejects a forged public quote, accepts its valid neighbor once and invalidates both forecast caches", () => {
  const game = at();
  const quote = powerAgreementQuote(game, "champlain-nuclear")!;
  const forged = acceptPowerAgreement({
    blockId: quote.id,
    quoteKey:
      quote.quoteKey.replace('"startMinute":259200', '"startMinute":259215') +
      "forged",
  });
  expect(reducer(game, forged)).toEqual(game);
  const signed = sign(game);
  expect(signed.transmission!.acceptedAgreements).toEqual([quote.receipt]);
  expect(
    reducer(
      signed,
      acceptPowerAgreement({ blockId: quote.id, quoteKey: quote.quoteKey }),
    ),
  ).toEqual(signed);
  expect(facilitySignature(signed)).not.toBe(facilitySignature(game));
  expect(intertieForecastKey(signed)).not.toBe(intertieForecastKey(game));
  const paused = reducer(
    signed,
    togglePauseTransmissionLine(signed.transmission!.lines[0].id),
  );
  expect(facilitySignature(paused)).not.toBe(facilitySignature(signed));
  expect(intertieForecastKey(paused)).not.toBe(intertieForecastKey(signed));
});
it("refreshes v3 reviews when the signing market changes and rejects a changed delivery month", () => {
  const game = at();
  const quote = powerAgreementQuote(game, "champlain-nuclear")!;
  const legacy = powerAgreementQuote(game, quote.id, 2)!;
  game.date = getDateFromMinute(game.date.minute + TICK_MINUTES, 2005);
  expect(powerAgreementQuote(game, quote.id, 2)!.quoteKey).toBe(
    legacy.quoteKey,
  );
  const refreshed = powerAgreementQuote(game, quote.id)!;
  expect(refreshed.quoteKey).not.toBe(quote.quoteKey);
  expect(
    reducer(
      game,
      acceptPowerAgreement({ blockId: quote.id, quoteKey: quote.quoteKey }),
    ),
  ).toEqual(game);
  const accepted = reducer(
    game,
    acceptPowerAgreement({ blockId: quote.id, quoteKey: refreshed.quoteKey }),
  );
  expect(accepted.transmission!.acceptedAgreements).toEqual([
    refreshed.receipt,
  ]);

  const late = at(181);
  const lateQuote = powerAgreementQuote(late, "champlain-nuclear")!;
  late.date = getDateFromMinute(182 * MINUTES_PER_MONTH, 2005);
  expect(
    reducer(
      late,
      acceptPowerAgreement({
        blockId: lateQuote.id,
        quoteKey: lateQuote.quoteKey,
      }),
    ),
  ).toEqual(late);
});
it("owns exact inherited dates and calendar terms, including late signing and recurring cycles", () => {
  const game = at(155);
  expect(powerAgreementQuote(game, "champlain-nuclear")).toBeUndefined();
  game.date = getDateFromMinute(156 * MINUTES_PER_MONTH, 2005);
  const quote = powerAgreementQuote(game, "champlain-quebec")!;
  expect(quote.receipt).toMatchObject({
    startMinute: agreementYearMinute(2020),
    endMinute: agreementYearMinute(2030),
  });
  const before = connectionAgreements(
    game,
    "champlain",
    agreementYearMinute(2020) - 15,
  );
  const after = connectionAgreements(
    game,
    "champlain",
    agreementYearMinute(2020),
  );
  expect(
    before.find((source) => source.id === "champlain-nuclear")!.active,
  ).toBe(true);
  expect(
    after.find((source) => source.id === "champlain-nuclear")!.active,
  ).toBe(false);
  expect(
    after.find((source) => source.id === "champlain-quebec")!.nominalW,
  ).toBe(60e6);
  const late = at(180);
  late.date = getDateFromMinute(late.date.minute + 15, 2005);
  expect(powerAgreementQuote(late, "champlain-nuclear")!.receipt).toMatchObject(
    {
      startMinute: 181 * MINUTES_PER_MONTH,
      endMinute: 241 * MINUTES_PER_MONTH,
    },
  );
  const valley = at(120);
  valley.utilityExpansion!.acquisitions.push({
    targetId: "valley-electric",
    minute: 0,
    financed: false,
    transferredCustomers: 159000,
  });
  valley.transmission!.lines.push(inheritedConnection("valley-electric", 2));
  const valleySigned = sign(valley, "valley-nuclear");
  valleySigned.date = getDateFromMinute(180 * MINUTES_PER_MONTH, 2005);
  expect(
    powerAgreementQuote(valleySigned, "valley-nuclear")!.receipt,
  ).toMatchObject({
    cycle: 1,
    startMinute: agreementYearMinute(2022),
    endMinute: agreementYearMinute(2027),
  });
  valleySigned.date = getDateFromMinute(240 * MINUTES_PER_MONTH, 2005);
  expect(powerAgreementQuote(valleySigned, "valley-nuclear")).toBeUndefined();
});
it("permits signing a paused owned interface while delivering no agreement or market energy", () => {
  const game = at();
  game.transmission!.lines[0].paused = true;
  const signed = sign(game);
  expect(signed.transmission!.lines[0].paused).toBe(true);
  request(signed, 500e6);
  tickState(signed);
  expect(currentTick(signed)!.importedW).toBe(0);
  expect(signed.transmission!.lines[0].currentFlowW).toBe(0);
  signed.transmission!.lines[0].paused = false;
  signed.transmission!.lines[0].yearsToBuildLeft = 1;
  expect(entitlementSources(signed, currentTick(signed)!)).toEqual([]);
});
it.each(["NONE", "SHORTAGES", "SHORTAGES_AND_STORAGE"] as const)(
  "keeps contracts available under %s and uses only the residual physical room for spot",
  (buyingRule) => {
    const game = at(0);
    game.transmission!.buyingRule = buyingRule;
    request(game, 500e6);
    const next = game.timeline[1];
    const sources = entitlementSources(game, next);
    const covered = sources.reduce((sum, source) => sum + source.capacityW, 0);
    tickState(game);
    const now = currentTick(game)!;
    expect(now.entitlementImportedW).toBe(covered);
    expect(now.importedW).toBeLessThanOrEqual(now.transmissionCapacityW!);
    expect(game.transmission!.lines[0].currentFlowW).toBe(now.importedW);
    expect(now.importedW! > covered).toBe(buyingRule !== "NONE");
    const spot = adjacentMarketPricePerMWh(
      game.transmission!.lines[0].corridorId,
      intertieContextForGame(game),
      now.minute,
      now,
    );
    const weighted =
      sources.reduce(
        (sum, source) => sum + source.capacityW * source.pricePerMWh,
        0,
      ) +
      (now.importedW! - covered) * spot;
    expect(now.expensesImports).toBeCloseTo(
      (weighted / 1e6 / TICKS_PER_HOUR) * GAME_TO_REAL_YEARS,
      4,
    );
  },
);
it("retains usable wires after expiry; None stops uncovered purchases", () => {
  const game = at(240);
  request(game, 100e6);
  tickState(game);
  expect(currentTick(game)!.entitlementImportedW).toBe(0);
  expect(currentTick(game)!.importedW).toBeGreaterThan(0);
  expect(game.transmission!.lines[0].capacityW).toBe(300e6);
  const closed = at(240);
  closed.transmission!.buyingRule = "NONE";
  request(closed, 100e6);
  tickState(closed);
  expect(currentTick(closed)!.importedW).toBe(0);
});
it("rejects impossible saved receipts and inherited provenance through the real parser; valid neighbors round trip", () => {
  const signed = sign(at());
  const raw = JSON.parse(JSON.stringify(serializeSave(signed)));
  expect(validPowerAgreements(signed)).toBe(true);
  expect(validUtilityExpansion(signed)).toBe(true);
  expect(parseSave(raw)).not.toBeNull();
  expect(parseSave(parseSave(raw))).toEqual(parseSave(raw));
  for (const mutate of [
    (save: typeof raw) => {
      save.game.transmission.acceptedAgreements[0].endMinute +=
        MINUTES_PER_MONTH;
    },
    (save: typeof raw) => {
      save.game.transmission.acceptedAgreements.push(
        save.game.transmission.acceptedAgreements[0],
      );
    },
    (save: typeof raw) => {
      save.game.transmission.acceptedAgreements[0].blockId = "seller-forgery";
    },
    (save: typeof raw) => {
      save.game.transmission.lines[0].capacityW += 1;
    },
    (save: typeof raw) => {
      save.game.transmission.acceptedAgreements[0].signingMarketPricePerMWh += 0.1;
    },
    (save: typeof raw) => {
      delete save.game.transmission.acceptedAgreements[0].signingTemperatureC;
    },
    (save: typeof raw) => {
      save.game.transmission.acceptedAgreements[0].signingTemperatureC = -101;
    },
    (save: typeof raw) => {
      save.game.transmission.acceptedAgreements[0].signingTemperatureC = 20;
    },
    (save: typeof raw) => {
      save.game.transmission.acceptedAgreements[0].signingTemperatureC = null;
    },
    (save: typeof raw) => {
      save.game.transmission.acceptedAgreements[0].pricePerMWh = 1;
    },
  ]) {
    const malformed = cloneDeep(raw);
    mutate(malformed);
    expect(parseSave(malformed)).toBeNull();
  }
  const legacy = JSON.parse(JSON.stringify(serializeSave(at(0))));
  legacy.schemaVersion = 9;
  delete legacy.game.transmission.inheritedAgreementTerms;
  legacy.game.transmission.lines = [];
  const upgraded = parseSave(legacy)!;
  expect(upgraded).not.toBeNull();
  expect(upgraded.game.transmission!.lines).toEqual([
    inheritedConnection("champlain", 1),
  ]);
  expect(upgraded.game.transmission!.acceptedAgreements).toEqual([]);
  expect(upgraded.game.timeline).toEqual(legacy.game.timeline);
});
it("isolates forecast clones and exposes no offers or acceptance outside the authored scenario", () => {
  const signed = sign(at());
  const before = JSON.stringify(signed);
  generateForecastTimeline(
    signed,
    currentTick(signed)!.cash,
    currentTick(signed)!.customers,
    96,
  );
  expect(JSON.stringify(signed)).toBe(before);
  const mod = cloneDeep(signed);
  mod.scenarioId = 999;
  expect(powerAgreementQuote(mod, "champlain-nuclear")).toBeUndefined();
  const ordinary = createGame({ scenarioId: 101, seed: 12345 });
  expect(powerAgreementQuote(ordinary, "champlain-nuclear")).toBeUndefined();
  expect(
    reducer(
      ordinary,
      acceptPowerAgreement({
        blockId: "champlain-nuclear",
        quoteKey: "forged",
      }),
    ),
  ).toEqual(ordinary);
});

it.each([20, -40])(
  "bills covered rates before the real spot rate at %s°C, including when spot is cheaper",
  (temperatureC) => {
    const game = playedAgreement();
    runMonths(game, 24);
    expect(game.date.minute).toBe(agreementYearMinute(2020));
    request(game, 400e6);
    const next = game.timeline[1];
    next.temperatureC = temperatureC;
    const sources = entitlementSources(game, next);
    const covered = sources.reduce((sum, source) => sum + source.capacityW, 0);
    const spot = adjacentMarketPricePerMWh(
      game.transmission!.lines[0].corridorId,
      intertieContextForGame(game),
      next.minute,
      next,
    );
    const agreed = sources.find(
      (source) => source.id === "champlain-nuclear:0",
    )!;
    expect(spot < agreed.pricePerMWh).toBe(temperatureC === 20);
    tickState(game);
    const now = currentTick(game)!;
    expect(now.entitlementImportedW).toBe(covered);
    expect(now.importedW).toBeGreaterThan(covered);
    const weighted =
      sources.reduce(
        (sum, source) => sum + source.capacityW * source.pricePerMWh,
        0,
      ) +
      (now.importedW! - covered) * spot;
    expect(now.expensesImports).toBeCloseTo(
      (weighted / 1e6 / TICKS_PER_HOUR) * GAME_TO_REAL_YEARS,
      4,
    );
    expect(agreed.emissionsKgPerMWh).toBeGreaterThan(0);
  },
);
it("keeps real played saves deterministic after signing and after a pause decision", () => {
  let live = playedAgreement();
  live = copyOfficialGame(
    reducer(live, togglePauseTransmissionLine(live.transmission!.lines[0].id)),
  );
  const saved = parseSave(JSON.parse(JSON.stringify(serializeSave(live))));
  expect(saved).not.toBeNull();
  const restored = copyOfficialGame(
    reducer(reducer(undefined, resume(saved!.game)), loaded()),
  );
  for (let i = 0; i < 3; i++) {
    tickState(live);
    tickState(restored);
  }
  expect(currentTick(restored)).toEqual(currentTick(live));
  expect(restored.transmission).toEqual(live.transmission);
});
it("formats calendar month ends accurately across a leap year without inventing inherited starts", () => {
  expect(agreementDate(182 * MINUTES_PER_MONTH, true)).toBe("29 Feb 2020");
  expect(agreementDate(194 * MINUTES_PER_MONTH, true)).toBe("28 Feb 2021");
});

it("charges supplier-ready minimums with zero demand and buyer pause, without phantom energy", () => {
  for (const paused of [false, true]) {
    const game = at(0);
    game.transmission!.buyingRule = "NONE";
    game.transmission!.lines[0].paused = paused;
    request(game, 0);
    tickState(game);
    const now = currentTick(game)!;
    expect(now.expensesImports).toBeGreaterThan(0);
    expect(now.importedW).toBe(0);
    expect(now.importedKgco2e).toBe(0);
    expect(now.exportedW).toBe(0);
    expect(game.transmission!.agreementAccounts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          agreementId: "champlain-nuclear",
          accountedThroughMinute: TICK_MINUTES,
          months: [
            expect.objectContaining({
              usefulMWh: 0,
              payment: expect.any(Number),
            }),
          ],
        }),
      ]),
    );
  }
});

it("records available, useful and payment separately and rejects forged history", () => {
  const game = at(0);
  request(game, 1e6);
  tickState(game);
  const raw = JSON.parse(JSON.stringify(serializeSave(game)));
  expect(parseSave(raw)).not.toBeNull();
  const account = game.transmission!.agreementAccounts![0];
  expect(account.months[0].availableMWh).toBeGreaterThan(
    account.months[0].usefulMWh,
  );
  for (const mutate of [
    (save: typeof raw) => {
      save.game.transmission.agreementAccounts[0].months[0].payment += 1;
    },
    (save: typeof raw) => {
      save.game.transmission.agreementAccounts[0].months[0].usefulMWh = 1e20;
    },
    (save: typeof raw) => {
      save.game.transmission.agreementAccounts[0].accountedThroughMinute +=
        TICK_MINUTES;
    },
    (save: typeof raw) => {
      save.game.transmission.agreementAccounts[0].agreementId = "invented";
    },
    (save: typeof raw) => {
      save.game.transmission.agreementAccounts[0].months[0].month += 1;
    },
  ]) {
    const forged = cloneDeep(raw);
    mutate(forged);
    expect(parseSave(forged)).toBeNull();
  }
  const before = JSON.stringify(game.transmission!.agreementAccounts);
  generateForecastTimeline(
    game,
    currentTick(game)!.cash,
    currentTick(game)!.customers,
    96,
  );
  expect(JSON.stringify(game.transmission!.agreementAccounts)).toBe(before);
});

it("rejects internally consistent stale accounts before a resumed settlement can encounter a gap", () => {
  const game = at(0);
  request(game, 1e6);
  tickState(game);
  const stale = cloneDeep(game.transmission!.agreementAccounts);
  tickState(game);
  const raw = JSON.parse(JSON.stringify(serializeSave(game)));
  const valid = parseSave(raw)!;
  expect(valid).not.toBeNull();
  expect(() => tickState(copyOfficialGame(valid.game))).not.toThrow();
  raw.game.transmission.agreementAccounts = stale;
  expect(parseSave(raw)).toBeNull();
});

it("prorates half-open terms and records the final elapsed interval before expiry exactly once", () => {
  expect(agreementIntervalMinutes(0, 15, 5, 10)).toBe(5);
  expect(agreementIntervalMinutes(0, 15, 15, 30)).toBe(0);
  const game = at(239);
  game.date = getDateFromMinute(agreementYearMinute(2025) - TICK_MINUTES, 2005);
  // Keep the engine's clamped last monthly frame and completed-month ownership.
  game.monthlyHistory = Array.from(
    { length: 239 },
    () => ({ year: 2024, month: 11 }) as (typeof game.monthlyHistory)[number],
  );
  game.timeline.forEach((tick, index) => {
    tick.minute = 239 * MINUTES_PER_MONTH + index * TICK_MINUTES;
  });
  game.facilities = [];
  tickState(game);
  const accounts = cloneDeep(game.transmission!.agreementAccounts);
  expect(
    accounts!.every(
      (account) => account.accountedThroughMinute === agreementYearMinute(2025),
    ),
  ).toBe(true);
  expect(accounts!.every((account) => account.months.length === 1)).toBe(true);
  expect(currentTick(game)!.entitlementImportedW).toBe(0);
  tickState(game);
  expect(game.transmission!.agreementAccounts).toEqual(accounts);
});

it("preserves existing delivered-energy promises while future offers bind monthly-energy terms", () => {
  const game = at();
  game.transmission!.acceptedAgreements = [
    powerAgreementQuote(game, "champlain-nuclear", 1)!.receipt,
  ];
  const raw = JSON.parse(JSON.stringify(serializeSave(game)));
  raw.schemaVersion = 10;
  delete raw.game.transmission.inheritedAgreementTerms;
  for (const receipt of raw.game.transmission.acceptedAgreements)
    delete receipt.termsVersion;
  const migrated = parseSave(raw)!;
  expect(migrated).not.toBeNull();
  expect(migrated.game.transmission!.inheritedAgreementTerms).toBe(1);
  expect(migrated.game.transmission!.acceptedAgreements![0].termsVersion).toBe(
    1,
  );
  expect(migrated.game.timeline).toEqual(raw.game.timeline);
  const live = copyOfficialGame(migrated.game);
  live.transmission!.lines[0].paused = true;
  request(live, 0);
  tickState(live);
  expect(currentTick(live)!.expensesImports).toBe(0);
  const nextOffer = powerAgreementQuote(live, "champlain-quebec")!;
  expect(nextOffer.receipt.termsVersion).toBe(3);
});

it("reduces the payable minimum to zero when the physical route is unavailable", () => {
  const game = at(0);
  request(game, 0);
  game.transmission!.lines[0].capacityW = 0;
  tickState(game);
  expect(currentTick(game)!.expensesImports).toBe(0);
  expect(Object.values(currentTick(game)!.agreementAvailableMWh!)).toEqual([
    0, 0,
  ]);
});

it("uses the dispatch timestamp's shared physical supply when an agreement interval starts before peak scarcity", () => {
  const game = at(96);
  game.difficulty = "CEO";
  game.utilityExpansion!.acquisitions.push({
    targetId: "valley-electric",
    minute: 0,
    financed: false,
    transferredCustomers: 159000,
  });
  game.transmission!.lines.push(inheritedConnection("valley-electric", 2));
  game.monthlyHistory = Array.from(
    { length: 96 },
    () => ({ year: 2012, month: 12 }) as (typeof game.monthlyHistory)[number],
  );
  game.date = getDateFromMinute(game.date.minute + 16 * 60 + 45, 2005);
  game.facilities = [];
  const next = getTimeFromTimeline(
    game.date.minute + TICK_MINUTES,
    game.timeline,
  )!;
  next.demandW = 1e9;
  next.temperatureC = -30;
  DEMAND_TYPES.forEach((type) => {
    next.demandByType[type] = type === "Residential" ? 1e9 : 0;
  });
  tickState(game);
  const now = currentTick(game)!;
  expect(now.minute % MINUTES_PER_MONTH).toBe(17 * 60);
  const pool = physicalNeighborImportSupplyW(
    game.transmission!.lines[0].corridorId,
    intertieContextForGame(game),
    now.minute,
    now,
  );
  expect(now.demandW).toBe(1e9);
  expect(now.entitlementImportedW).toBeGreaterThan(0);
  expect(now.importedW).toBeLessThanOrEqual(pool + 1);
});

it("v3 defers unused monthly energy payment until the exclusive month end", () => {
  const game = at(0);
  game.transmission!.inheritedAgreementTerms = 3;
  game.transmission!.buyingRule = "NONE";
  request(game, 0);
  tickState(game);
  expect(currentTick(game)!.expensesImports).toBe(0);
  expect(game.transmission!.agreementAccounts![0].months[0].payment).toBe(0);
  expect(game.transmission!.agreementAccounts![0].months[0]).toHaveProperty(
    "availableValue",
  );
});

it("uses fully paid v2 supply before v3 monthly energy credit in a mixed-version month", () => {
  jest.spyOn(Transmission, "adjacentMarketPricePerMWh").mockReturnValue(20);
  const accepted = powerAgreementQuote(
    at(),
    "champlain-nuclear",
    3,
    10,
  )!.receipt;
  const game = at(180);
  game.transmission!.acceptedAgreements = [accepted];
  game.transmission!.buyingRule = "NONE";
  game.monthlyHistory = Array.from(
    { length: 180 },
    () => ({ year: 2019, month: 11 }) as (typeof game.monthlyHistory)[number],
  );
  game.facilities = [];
  for (let i = 0; i < 96; i++) {
    const frame = getTimeFromTimeline(
      game.date.minute + TICK_MINUTES,
      game.timeline,
    )!;
    frame.demandW = 80e6;
    DEMAND_TYPES.forEach((type) => {
      frame.demandByType[type] = type === "Residential" ? 80e6 : 0;
    });
    tickState(game);
  }
  const accounts = game.transmission!.agreementAccounts!;
  const inherited = accounts.find(
    (account) => account.agreementId === "champlain-quebec",
  )!;
  const replacement = accounts.find(
    (account) => account.agreementId !== "champlain-quebec",
  )!;
  expect(inherited.termsVersion).toBe(2);
  expect(replacement.termsVersion).toBe(3);
  const paid = inherited.months[0];
  const minimum = replacement.months[0];
  expect(paid.usefulMWh).toBeCloseTo(paid.availableMWh, 6);
  expect(minimum.usefulMWh / minimum.availableMWh).toBeCloseTo(23 / 95, 10);
  expect(minimum.payment).toBeCloseTo(minimum.availableValue! * 0.7, 6);
  expect(paid.payment).toBeGreaterThan(0);
});

afterEach(() => jest.restoreAllMocks());

it("binds 1–10 whole years to canonical duration, discount, action and saved receipt", () => {
  const game = at();
  expect(agreementDurationDiscount(1)).toBeCloseTo(0.01, 12);
  expect(agreementDurationDiscount(10)).toBeCloseTo(0.2, 12);
  for (const years of [1, 4, 10]) {
    const quote = powerAgreementQuote(game, "champlain-nuclear", 3, years)!;
    const action = {
      blockId: quote.id,
      quoteKey: quote.quoteKey,
      durationYears: years,
    };
    expect(quote.receipt.endMinute - quote.receipt.startMinute).toBe(
      years * 12 * MINUTES_PER_MONTH,
    );
    expect(quote.minimumMWhPerMonth).toBeCloseTo(
      quote.maximumMWhPerMonth * 0.7,
      9,
    );
    expect(validPowerAgreementAction(game, action)).toBe(true);
    expect(
      validPowerAgreementAction(game, {
        ...action,
        durationYears: years === 1 ? 10 : 1,
      }),
    ).toBe(false);
    const signed = copyOfficialGame(
      reducer(game, acceptPowerAgreement(action)),
    );
    const raw = JSON.parse(JSON.stringify(serializeSave(signed)));
    expect(parseSave(raw)?.game.transmission!.acceptedAgreements).toEqual([
      quote.receipt,
    ]);
    for (const invalid of [undefined, 0, 11, 1.5, "5", null]) {
      const forged = cloneDeep(raw);
      forged.game.transmission.acceptedAgreements[0].durationYears = invalid;
      expect(parseSave(forged)).toBeNull();
    }
  }
  for (const durationYears of [0, 11, 1.5, NaN, Infinity]) {
    expect(
      powerAgreementQuote(game, "champlain-nuclear", 3, durationYears),
    ).toBeUndefined();
  }
});

it.each([20, -40])(
  "quotes new v3 terms exactly 1%% or 20%% below the current market at %s°C",
  (temperatureC) => {
    const game = at();
    currentTick(game)!.temperatureC = temperatureC;
    const spot = adjacentMarketPricePerMWh(
      game.transmission!.lines[0].corridorId,
      intertieContextForGame(game),
      game.date.minute,
      currentTick(game)!,
    );
    for (const [years, fraction] of [
      [1, 0.99],
      [10, 0.8],
    ]) {
      const quote = powerAgreementQuote(game, "champlain-nuclear", 3, years)!;
      expect(quote.priceToday).toBeCloseTo(spot * fraction, 10);
      expect(quote.receipt).toMatchObject({
        signingMarketPricePerMWh: spot,
        signingTemperatureC: temperatureC,
      });
    }
  },
);

it("indexes each signed ceiling from its own signing CPI and preserves the authored older promises", () => {
  const game = at();
  for (const termsVersion of [1, 2] as const) {
    game.transmission!.acceptedAgreements = [];
    const receipt = powerAgreementQuote(
      game,
      "champlain-nuclear",
      termsVersion,
    )!.receipt;
    expect(Object.keys(receipt)).toHaveLength(6);
    game.transmission!.acceptedAgreements = [receipt];
    const source = connectionAgreements(game, "champlain").find(
      (entry) => !entry.inherited,
    )!;
    expect(source.pricePerMWh).toBe(70);
    expect(source.priceToday).toBe(agreementPrice(game, 70));
  }
  game.transmission!.acceptedAgreements = [];
  game.transmission!.inheritedAgreementTerms = 3;
  currentTick(game)!.temperatureC = -40;
  const first = powerAgreementQuote(game, "champlain-nuclear", 3, 1)!;
  game.transmission!.acceptedAgreements = [first.receipt];
  game.date = getDateFromMinute(168 * MINUTES_PER_MONTH, 2005);
  const second = powerAgreementQuote(game, "champlain-quebec", 3, 10)!;
  game.transmission!.acceptedAgreements.push(second.receipt);
  const sources = connectionAgreements(
    game,
    "champlain",
    agreementYearMinute(2020),
  );
  expect(
    sources.find(
      (source) => source.inherited && source.id === "champlain-quebec",
    )!.pricePerMWh,
  ).toBe(60);
  for (const quote of [first, second]) {
    const source = sources.find((entry) => entry.id === `${quote.id}:0`)!;
    expect(
      agreementPrice(game, source.pricePerMWh, quote.receipt.acceptedMinute),
    ).toBeCloseTo(quote.receipt.signingMarketPricePerMWh!, 10);
  }
  const futureMinute = agreementYearMinute(2021);
  const market = jest
    .spyOn(Transmission, "adjacentMarketPricePerMWh")
    .mockReturnValue(500);
  for (const quote of [first, second]) {
    const source = connectionAgreements(game, "champlain", futureMinute).find(
      (entry) => entry.id === `${quote.id}:0`,
    )!;
    expect(source.priceToday).toBeCloseTo(
      (quote.priceToday * agreementPrice(game, 1, futureMinute)) /
        agreementPrice(game, 1, quote.receipt.acceptedMinute),
      10,
    );
  }
  market.mockReturnValue(5);
  expect(
    connectionAgreements(game, "champlain", futureMinute).find(
      (entry) => entry.id === `${second.id}:0`,
    )!.priceToday,
  ).toBeCloseTo(4, 10);
});

it("settles and reloads a v3 signing ceiling above the old authored ceiling, using bounded historical quote conditions", () => {
  const game = playedAgreement();
  runMonths(game, 24);
  game.transmission!.acceptedAgreements = [];
  currentTick(game)!.temperatureC = -40;
  const quote = powerAgreementQuote(game, "champlain-nuclear", 3, 1)!;
  const payload = {
    blockId: quote.id,
    quoteKey: quote.quoteKey,
    durationYears: 1,
    signingMarketPricePerMWh: 1,
    signingTemperatureC: 100,
  };
  const signed = copyOfficialGame(reducer(game, acceptPowerAgreement(payload)));
  expect(signed.transmission!.acceptedAgreements).toEqual([quote.receipt]);
  request(signed, 500e6);
  signed.timeline[1].temperatureC = -40;
  tickState(signed);
  const row = signed.transmission!.agreementAccounts!.find(
    (account) => account.agreementId === `${quote.id}:0`,
  )!.months[0];
  expect(row.usefulMWh).toBeGreaterThan(0);
  expect(row.availableValue! / row.availableMWh).toBeGreaterThan(
    agreementPrice(signed, 70),
  );
  // Old acceptance weather can leave the rolling timeline; validate its canonical seeded snapshot.
  signed.timeline[0].temperatureC = 20;
  expect(validPowerAgreements(signed)).toBe(true);
  expect(validUtilityExpansion(signed)).toBe(true);
  const raw = JSON.parse(JSON.stringify(serializeSave(signed)));
  const parsed = parseSave(raw);
  expect(parsed).not.toBeNull();
  const restored = copyOfficialGame(parsed!.game);
  for (let i = 0; i < 3; i++) {
    tickState(signed);
    tickState(restored);
  }
  expect(restored.transmission).toEqual(signed.transmission);
  expect(currentTick(restored)).toEqual(currentTick(signed));
});

it.each([5, 250])(
  "caps actual v3 dispatch below the unchanged current spot price %s",
  (price) => {
    const game = at(0);
    game.transmission!.inheritedAgreementTerms = 3;
    // A falling market between interval start and dispatch catches stale-price capping.
    const next = game.timeline[1];
    jest
      .spyOn(Transmission, "adjacentMarketPricePerMWh")
      .mockImplementation((_id, _context, minute) =>
        minute === next.minute ? price : 500,
      );
    request(game, 500e6);
    tickState(game);
    const now = currentTick(game)!;
    for (const [id, usefulMWh] of Object.entries(now.agreementUsefulMWh!)) {
      expect(usefulMWh).toBeGreaterThan(0);
      expect(now.agreementPayments![id] / usefulMWh).toBeLessThanOrEqual(
        price * 0.8 + 1e-8,
      );
    }
  },
);

it("credits shifted monthly MWh and closes one prorated weighted-rate minimum, without phantom delivery", () => {
  const game = at(0);
  game.transmission!.inheritedAgreementTerms = 3;
  const profiles = [
    [80, 0],
    [0, 80],
  ];
  const payments = profiles.map((profile) => {
    const ledger = cloneDeep(game);
    for (let i = 0; i < 2; i++) {
      const usefulMWh = profile[i];
      const row = {
        agreementId: "champlain-nuclear",
        availableMWh: 100,
        usefulMWh,
        availableValue: 2000,
        usefulValue: usefulMWh * 20,
        payment: usefulMWh * 20,
      };
      const start = (i * MINUTES_PER_MONTH) / 2;
      const topUp = recordAgreementSettlements(
        ledger,
        start,
        start + MINUTES_PER_MONTH / 2,
        [row],
      );
      expect(topUp).toBe(i === 0 ? 0 : 1200);
      expect(ledger.transmission!.agreementAccounts![0].months[0].payment).toBe(
        profile.slice(0, i + 1).reduce((sum, energy) => sum + energy * 20, 0) +
          (i === 1 ? 1200 : 0),
      );
    }
    return ledger.transmission!.agreementAccounts![0].months[0];
  });
  expect(payments[0]).toEqual(payments[1]);
  expect(payments[0].payment).toBe(2800);
  const aboveMinimum = {
    agreementId: "champlain-nuclear",
    availableMWh: 100,
    usefulMWh: 75,
    availableValue: 2000,
    usefulValue: 1500,
    payment: 1500,
  };
  expect(
    recordAgreementSettlements(cloneDeep(game), 0, MINUTES_PER_MONTH, [
      aboveMinimum,
    ]),
  ).toBe(0);
  const outage = {
    ...aboveMinimum,
    availableMWh: 0,
    usefulMWh: 0,
    availableValue: 0,
    usefulValue: 0,
    payment: 0,
  };
  expect(
    recordAgreementSettlements(cloneDeep(game), 0, MINUTES_PER_MONTH, [outage]),
  ).toBe(0);
});

it("bills the real v3 month once after pause, preserves schema11 promises, and rejects forged weighted meters", () => {
  const game = at(0);
  game.transmission!.inheritedAgreementTerms = 3;
  game.transmission!.lines[0].paused = true;
  game.facilities = [];
  for (let i = 0; i < 48; i++) {
    tickState(game);
    expect(
      game.transmission!.agreementAccounts!.every(
        (account) => account.months[0].payment === 0,
      ),
    ).toBe(true);
  }
  const rawV3 = JSON.parse(JSON.stringify(serializeSave(game)));
  expect(parseSave(rawV3)).not.toBeNull();
  const restored = copyOfficialGame(
    reducer(reducer(undefined, resume(parseSave(rawV3)!.game)), loaded()),
  );
  for (const mutate of [
    (save: typeof rawV3) => {
      save.game.transmission.agreementAccounts[0].months[0].availableValue = 1e20;
    },
    (save: typeof rawV3) => {
      save.game.transmission.agreementAccounts[0].months[0].usefulValue = 1;
    },
    (save: typeof rawV3) => {
      save.game.transmission.agreementAccounts[0].months[0].payment += 1;
    },
  ]) {
    const forged = cloneDeep(rawV3);
    mutate(forged);
    expect(parseSave(forged)).toBeNull();
  }
  for (let i = 0; i < 47; i++) {
    tickState(game);
    tickState(restored);
    expect(
      game.transmission!.agreementAccounts!.every(
        (account) => account.months[0].payment === 0,
      ),
    ).toBe(true);
  }
  tickState(game);
  tickState(restored);
  expect(game.date.minute).toBe(MINUTES_PER_MONTH);
  expect(restored!.transmission).toEqual(game.transmission);
  expect(currentTick(restored!)!.cash).toBe(currentTick(game)!.cash);
  for (const account of game.transmission!.agreementAccounts!) {
    expect(account.accountedThroughMinute).toBe(MINUTES_PER_MONTH);
    expect(account.months[0].payment).toBeCloseTo(
      account.months[0].availableValue! * 0.7,
      6,
    );
    expect(account.months[0].usefulMWh).toBe(0);
  }
  expect(currentTick(game)!.importedW).toBe(0);
  const before = cloneDeep(game.transmission!.agreementAccounts);
  tickState(game);
  expect(
    game.transmission!.agreementAccounts!.map((account) => account.months[0]),
  ).toEqual(before!.map((account) => account.months[0]));
  const legacy = at(0);
  request(legacy, 0);
  tickState(legacy);
  const raw = JSON.parse(JSON.stringify(serializeSave(legacy)));
  raw.schemaVersion = 11;
  expect(parseSave(raw)?.game.transmission).toEqual(legacy.transmission);
});

it("allows all canonical annual renewal cycles beyond the old six-receipt limit", () => {
  const game = at();
  for (let i = 0; i < 5; i++) {
    game.date = getDateFromMinute(agreementYearMinute(2018 + i), 2005);
    for (const blockId of ["champlain-nuclear", "champlain-quebec"]) {
      const quote = powerAgreementQuote(game, blockId, 3, 1)!;
      expect(quote).toBeDefined();
      (game.transmission!.acceptedAgreements ??= []).push(quote.receipt);
    }
  }
  expect(game.transmission!.acceptedAgreements).toHaveLength(10);
  expect(validPowerAgreements(game)).toBe(true);
});

it.each([48, 72])(
  "real reducer gives equal monthly energy credit when %s full-delivery intervals shift",
  (usedTicks) => {
    jest.spyOn(Transmission, "adjacentMarketPricePerMWh").mockReturnValue(20);
    const rows = [false, true].map((late) => {
      const game = at(0);
      game.transmission!.inheritedAgreementTerms = 3;
      game.transmission!.buyingRule = "NONE";
      game.facilities = [];
      for (let i = 0; i < 96; i++) {
        const used = late ? i >= 96 - usedTicks : i < usedTicks;
        const frame = getTimeFromTimeline(
          game.date.minute + TICK_MINUTES,
          game.timeline,
        )!;
        frame.demandW = used ? 209e6 : 0;
        DEMAND_TYPES.forEach((type) => {
          frame.demandByType[type] = type === "Residential" ? frame.demandW : 0;
        });
        tickState(game);
      }
      return game.transmission!.agreementAccounts!.map(
        (account) => account.months[0],
      );
    });
    expect(rows[0]).toEqual(rows[1]);
    for (const row of rows[0]) {
      expect(row.usefulMWh / row.availableMWh).toBeCloseTo(usedTicks / 96, 10);
      expect(row.payment).toBeCloseTo(
        Math.max(row.usefulMWh, row.availableMWh * 0.7) * 16,
        6,
      );
    }
  },
);

it("rejects historical agreement delivery above the capacity recorded for that tick", () => {
  const game = at(0);
  const raw = JSON.parse(JSON.stringify(serializeSave(game)));
  expect(parseSave(raw)).not.toBeNull();
  const tick = raw.game.timeline[0];
  tick.entitlementImportedW = 50e6;
  tick.importedW = Math.max(tick.importedW, 50e6);
  tick.entitlementImportCapacityW = 0;
  expect(parseSave(raw)).toBeNull();
});

it.each(["NONE", "SHORTAGES"] as const)(
  "preserves agreement supply used to charge storage under %s",
  (buyingRule) => {
    const game = at(0);
    game.transmission!.buyingRule = buyingRule;
    game.transmission!.sellingRule = "NONE";
    const base = game.facilities[0];
    const generator: GeneratorOperatingType = {
      ...base,
      fuel: "Natural Gas",
      id: 100,
      peakW: 100e6,
      currentW: 0,
      yearsToBuildLeft: 0,
      spinMinutes: 1,
      minimumStableOutput: 0,
      paused: false,
      tracksStarts: false,
    } as GeneratorOperatingType;
    const battery: StorageOperatingType = {
      ...STORAGE({ ...game, date: { ...game.date, year: 2030 } }, 1000e6).find(
        (facility) => facility.name === "Battery",
      )!,
      id: 101,
      peakW: 100e6,
      currentW: 0,
      currentWh: 0,
      yearsToBuildLeft: 0,
      minuteCreated: 0,
      spinMinutes: 1,
      paused: false,
      roundTripEfficiency: 0.8,
      hourlyLoss: 0,
      loanAmountLeft: 0,
      loanAmountTotal: 0,
      loanMonthlyPayment: 0,
      interestRate: 0,
      lifetimeWh: 0,
      lifetimePotentialWh: 0,
      lifetimeRevenue: 0,
      lifetimeExpenses: 0,
    };
    request(game, 100e6);
    game.facilities = [generator, battery];
    tickState(game);
    const now = currentTick(game)!;
    expect(now.storageChargeW).toBeGreaterThan(0);
    expect(now.supplyW).toBeGreaterThanOrEqual(now.demandW);
    expect(now.entitlementImportedW).toBeCloseTo(100e6, 0);
    expect(now.importedW).toBe(now.entitlementImportedW);
  },
);

it.each([0, 15])(
  "includes exclusive monthly minimums in forecast cash and the closing month from offset %s",
  (offset) => {
    const game = at(0);
    game.transmission!.inheritedAgreementTerms = 3;
    game.transmission!.lines[0].paused = true;
    game.facilities = [];
    const now = currentTick(game)!;
    game.timeline = generateNewTimeline(game, now.cash, now.customers);
    const expected = summarizeTimeline(game.timeline, game.startingYear);
    expect(expected.expensesImports).toBeGreaterThan(0);
    runMonths(game, 1);
    expect(game.monthlyHistory[0].expensesImports).toBeCloseTo(
      expected.expensesImports!,
      6,
    );
    expect(game.monthlyHistory[0].cash).toBeCloseTo(expected.cash, 6);

    if (offset) tickState(game);
    const accounts: NonNullable<
      NonNullable<typeof game.transmission>["agreementAccounts"]
    > = [];
    const timeline = generateForecastTimeline(
      game,
      currentTick(game)!.cash,
      currentTick(game)!.customers,
      48,
      60,
      (state) => {
        accounts.splice(
          0,
          accounts.length,
          ...state.transmission!.agreementAccounts!,
        );
      },
    );
    const months = summarizeTimelineByMonth(timeline, game.startingYear);
    for (const month of months) {
      const index = (month.year - game.startingYear) * 12 + month.month - 1;
      const payment = accounts.reduce(
        (sum, account) =>
          sum +
          (account.months.find((row) => row.month === index)?.payment ?? 0),
        0,
      );
      const complete = accounts.every(
        (account) =>
          account.accountedThroughMinute >= (index + 1) * MINUTES_PER_MONTH,
      );
      expect(payment > 0).toBe(complete);
      expect(month.expensesImports).toBeCloseTo(payment, 6);
    }
  },
);

it("keeps the closing minimum in the finance projection when the current frame is the last in the month", () => {
  const game = at(0);
  game.transmission!.inheritedAgreementTerms = 3;
  game.transmission!.lines[0].paused = true;
  game.facilities = [];
  for (let i = 0; i < 95; i++) tickState(game);
  const closingCash = forecastMonthClosingCashAtCustomerRate(
    game,
    game.dollarsPerkWh,
  );
  expect(closingCash).toBeLessThan(currentTick(game)!.cash);
  expect(
    selectProjection(game, currentTick(game)!).financeProjected[0].cash,
  ).toBeCloseTo(closingCash, 6);
});
