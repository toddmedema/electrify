import { runMonths } from "../testing/SimulationTestHelpers";
import { validUtilityExpansion } from "../helpers/ExpansionValidation";
import cloneDeep from "lodash.clonedeep";
import { createGame } from "../testing/Simulator";
import { copyOfficialGame } from "../testing/OfficialScenarioExecutionFixtures";
import { MINUTES_PER_MONTH, getDateFromMinute } from "../helpers/DateTime";
import { currentTick } from "../helpers/GameSelectors";
import {
  agreementDate,
  validPowerAgreements,
  agreementYearMinute,
  connectionAgreements,
  inheritedConnection,
  powerAgreementQuote,
} from "../helpers/PowerAgreements";
import { entitlementSources } from "../helpers/Expansion";
import {
  adjacentMarketPricePerMWh,
  intertieContextForGame,
  intertieBuildQuote,
  intertieUpgradeQuote,
} from "../helpers/Transmission";
import { facilitySignature } from "../helpers/Projection";
import { intertieForecastKey } from "../helpers/IntertieOutlook";
import { parseSave, serializeSave } from "../SaveGame";
import { SAVE_SCHEMA_VERSION } from "../SaveSchema";
import { GAME_TO_REAL_YEARS, TICK_MINUTES, TICKS_PER_HOUR } from "../Constants";
import { DEMAND_TYPES } from "../data/DemandProfiles";
import reducer, {
  generateForecastTimeline,
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
    runMonths(played, 156);
    playedSignedGame = sign(played);
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
it("keeps unchanged reviewed terms across ticks but rejects a changed delivery month", () => {
  const game = at();
  const quote = powerAgreementQuote(game, "champlain-nuclear")!;
  game.date = getDateFromMinute(game.date.minute + TICK_MINUTES, 2005);
  expect(powerAgreementQuote(game, quote.id)!.quoteKey).toBe(quote.quoteKey);
  const accepted = reducer(
    game,
    acceptPowerAgreement({ blockId: quote.id, quoteKey: quote.quoteKey }),
  );
  expect(accepted.transmission!.acceptedAgreements).toEqual([
    { ...quote.receipt, acceptedMinute: game.date.minute },
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
  ]) {
    const malformed = cloneDeep(raw);
    mutate(malformed);
    expect(parseSave(malformed)).toBeNull();
  }
  const legacy = JSON.parse(JSON.stringify(serializeSave(at(0))));
  legacy.schemaVersion = SAVE_SCHEMA_VERSION - 1;
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
