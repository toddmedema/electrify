import { validUtilityExpansion } from "./helpers/ExpansionValidation";
import { validPowerAgreements } from "./helpers/PowerAgreements";
import { validTerritoryNetwork } from "./helpers/TerritoryValidation";
import type { GameType } from "./Types";
import { runMonths } from "./testing/SimulationTestHelpers";
import cloneDeep from "lodash.clonedeep";
import { createNextState, freeze } from "@reduxjs/toolkit";
import { SAVE_SCHEMA_VERSION } from "./SaveSchema";
import { validTransmissionLine, parseSave, serializeSave } from "./SaveGame";
import { upgradeSave } from "./SaveUpgrade";
import { createGame } from "./testing/Simulator";
import { retiredValleyOpeningProgress } from "./testing/SaveTestHelpers";
import { currentTick } from "./helpers/GameSelectors";
import { getBuildFacilityQuote } from "./data/Facilities";
import { facilityExpansionQuote } from "./helpers/FacilityExpansion";
import {
  ownedTerritories,
  landPurchaseQuote,
  purchaseLand,
  purchaseTile,
  tilePurchaseQuotes,
} from "./helpers/Territories";
import {
  isGeneralBuildingLand,
  getTerritoryTile,
  ownsTerritoryTile,
} from "./helpers/TerritoryTiles";
import { accessContextForGame } from "./data/IntertieAccess";
import {
  intertieBuildQuote,
  intertieUpgradeQuote,
} from "./helpers/Transmission";
import { inheritedConnection } from "./helpers/PowerAgreements";
import { acquisitionQuote } from "./helpers/Expansion";
import { projectionSignature } from "./helpers/Projection";
import reducer, {
  applyAcquireUtility,
  buildFacility,
  generateForecastTimeline,
  tickState,
} from "./reducers/Game";
import { expandFacility } from "./reducers/GameActions";
import { modScenario } from "./mods/ModScenario";
import { modPackage } from "./testing/ModFixtures";

function legacyPortfolio(
  state: "building" | "paused" | "upgrade" = "building",
) {
  const game = createGame({ scenarioId: 116, seed: 61 });
  game.utilityExpansion!.sellerFleet = "authored";
  currentTick(game)!.cash = 3e9;
  const acquisition = acquisitionQuote(game, "valley-electric")!;
  applyAcquireUtility(game, {
    targetId: "valley-electric",
    financed: true,
    quoteKey: acquisition.quoteKey,
  });
  const quote = intertieBuildQuote(
    "vt-champlain-uplands",
    2005,
    1,
    accessContextForGame(game),
  )!;
  const line = {
    ...quote,
    id: 4,
    corridorId: "vt-champlain-uplands",
    name: "Green Uplands",
    yearsToBuildLeft: state === "building" ? quote.yearsToBuild / 2 : 0,
    minuteCreated: 0,
    financed: true,
    loanAmountLeft: quote.buildCost * 0.8,
    loanMonthlyPayment: quote.buildCost * 0.01,
    interestRate: 0.05,
    currentFlowW: 0,
    paused: state === "paused",
  };
  if (state === "upgrade") {
    const upgrade = intertieUpgradeQuote(
      line,
      2005,
      1,
      1,
      accessContextForGame(game),
    )!;
    Object.assign(line, {
      buildCost: line.buildCost + upgrade.buildCost,
      upgrade: { ...upgrade, yearsToBuildLeft: upgrade.yearsToBuild / 2 },
    });
  }
  game.transmission!.lines = [
    inheritedConnection("champlain", 1),
    inheritedConnection("valley-electric", 2),
    line,
  ];
  const raw = JSON.parse(JSON.stringify(serializeSave(game)));
  raw.schemaVersion = 13;
  raw.game.territoryNetwork = { version: 1 };
  return raw;
}
it.each([
  [19, "retired"],
  [20, "retired"],
  [21, "retired"],
  [22, "retired"],
  [23, "retired"],
  [23, "current"],
] as const)(
  "restores Valley goals from schema %i with %s evidence without changing paid assets or history",
  (schemaVersion, evidence) => {
    const game = createGame({ scenarioId: 116, seed: 61 });
    game.utilityExpansion!.sellerFleet = "authored";
    currentTick(game)!.cash = 3e9;
    const quote = acquisitionQuote(game, "valley-electric")!;
    applyAcquireUtility(game, {
      targetId: "valley-electric",
      financed: true,
      quoteKey: quote.quoteKey,
    });
    const raw = JSON.parse(JSON.stringify(serializeSave(game)));
    raw.schemaVersion = schemaVersion;
    if (evidence === "retired")
      raw.game.objectiveProgress = retiredValleyOpeningProgress(game);
    if (schemaVersion >= 22)
      raw.game.territoryWeather = { dryness: 0.81, fires: [] };
    const original = cloneDeep(raw);
    const parsed = parseSave(raw);
    expect(parsed).not.toBeNull();
    expect(parsed!.schemaVersion).toBe(SAVE_SCHEMA_VERSION);
    const migratedProgress = expect.objectContaining({
      entries: [
        expect.objectContaining({ id: "acquire-neighbor" }),
        expect.objectContaining({ id: "retain-customers" }),
      ],
    });
    expect(parsed!.game.objectiveProgress).toEqual(
      evidence === "current"
        ? original.game.objectiveProgress
        : migratedProgress,
    );
    expect(parsed!.game.facilities).toEqual(raw.game.facilities);
    expect(parsed!.game.utilityExpansion).toEqual(raw.game.utilityExpansion);
    expect(parsed!.game.monthlyHistory).toEqual(raw.game.monthlyHistory);
    expect(parsed!.game.territoryWeather).toEqual(raw.game.territoryWeather);
    expect(currentTick(parsed!.game)!.cash).toBe(currentTick(raw.game)!.cash);
    expect(parseSave(parsed)).toEqual(parsed);
    const roundTrip = parseSave(
      JSON.parse(JSON.stringify(serializeSave(parsed!.game))),
    )!.game;
    expect(roundTrip).toEqual(parsed!.game);
    expect(raw).toEqual(original);
    expect(
      parseSave({ ...raw, schemaVersion: SAVE_SCHEMA_VERSION + 1 }),
    ).toBeNull();
    const resumed = parsed!.game;
    const start = resumed.date.minute;
    for (let step = 0; step < 5; step++) {
      tickState(resumed);
      tickState(roundTrip);
    }
    expect(resumed.date.minute).toBeGreaterThan(start);
    expect(JSON.stringify(roundTrip)).toEqual(JSON.stringify(resumed));
  },
);

it.each([22, 23])(
  "rejects corrupt evidence from either Valley ruleset through schema %i solo import",
  (schemaVersion) => {
    const game = createGame({ scenarioId: 116, seed: 61 });
    const current = game.objectiveProgress!;
    const retired = retiredValleyOpeningProgress(game);
    for (const original of [current, retired]) {
      const save = { ...serializeSave(game), schemaVersion };
      const progress = { ...original, rulesDigest: `sha256-${"0".repeat(64)}` };
      expect(
        parseSave({ ...save, game: { ...game, objectiveProgress: original } }),
      ).not.toBeNull();
      expect(
        parseSave({ ...save, game: { ...game, objectiveProgress: progress } }),
      ).toBeNull();
    }
  },
);

it.each(["building", "paused", "upgrade"] as const)(
  "converts a %s land project to immediate rights without changing cash, history, debts or paid investment",
  (state) => {
    const raw = legacyPortfolio(state);
    const original = cloneDeep(raw);
    const upgraded = upgradeSave(raw)!;
    expect(raw).toEqual(original);
    expect(upgraded.schemaVersion).toBe(SAVE_SCHEMA_VERSION);
    for (const line of raw.game.transmission.lines)
      expect({
        corridor: line.corridorId,
        valid: validTransmissionLine(
          line,
          2005,
          accessContextForGame(raw.game),
        ),
      }).toEqual({ corridor: line.corridorId, valid: true });
    expect({
      territory: validTerritoryNetwork(upgraded.game as GameType),
      expansion: validUtilityExpansion(upgraded.game as GameType),
      agreements: validPowerAgreements(upgraded.game as GameType),
    }).toEqual({ territory: true, expansion: true, agreements: true });
    const parsed = parseSave(raw);
    expect(parsed).not.toBeNull();
    const game = parsed!.game;
    expect(game.transmission!.lines).toEqual([]);
    expect(game.territoryNetwork!.legacyConnections).toEqual(
      raw.game.transmission.lines,
    );
    expect(ownedTerritories(game)).toContain("green-uplands");
    const oldCapital = raw.game.transmission.lines.reduce(
      (sum: number, line: { buildCost: number; loanAmountLeft: number }) =>
        sum + line.buildCost - line.loanAmountLeft,
      0,
    );
    const newCapital =
      game.territoryNetwork!.legacyConnections.reduce(
        (sum, line) =>
          sum +
          (line.corridorId === "vt-champlain-uplands" ? 0 : line.buildCost) -
          line.loanAmountLeft,
        0,
      ) +
      game.territoryNetwork!.landPurchases.reduce(
        (sum, receipt) => sum + receipt.price,
        0,
      );
    expect(newCapital).toBe(oldCapital);
    expect(currentTick(game)!.cash).toBe(
      raw.game.timeline.find(
        (tick: { minute: number }) => tick.minute === raw.game.date.minute,
      ).cash,
    );
    expect(currentTick(game)!.netWorth).toBe(
      raw.game.timeline.find(
        (tick: { minute: number }) => tick.minute === raw.game.date.minute,
      ).netWorth,
    );
    expect(
      game.territoryNetwork!.legacyConnections.reduce(
        (sum, line) => sum + line.loanAmountLeft,
        0,
      ),
    ).toBe(
      raw.game.transmission.lines.reduce(
        (sum: number, line: { loanAmountLeft: number }) =>
          sum + line.loanAmountLeft,
        0,
      ),
    );
    for (const key of [
      "timeline",
      "monthlyHistory",
      "date",
      "utilityExpansion",
      "facilities",
      "meaningfulDecisions",
    ] as const)
      expect(game[key]).toEqual(raw.game[key]);
    expect(game.territoryNetwork!.landPurchases).toEqual([
      {
        territoryId: "green-uplands",
        minute: 0,
        price: raw.game.transmission.lines[2].buildCost,
        legacy: true,
      },
    ]);
    expect(parseSave(serializeSave(game))?.game).toEqual(game);
  },
);
it("keeps legacy projects frozen while servicing their debt and retaining capital", () => {
  const game = parseSave(legacyPortfolio())!.game;
  const before = cloneDeep(game.territoryNetwork!.legacyConnections.at(-1)!);
  const netWorth = currentTick(game)!.netWorth;
  tickState(game);
  const after = game.territoryNetwork!.legacyConnections.at(-1)!;
  expect(after.yearsToBuildLeft).toBe(before.yearsToBuildLeft);
  expect(after.loanAmountLeft).toBeLessThan(before.loanAmountLeft);
  expect(after.buildCost).toBe(before.buildCost);
  expect(currentTick(game)!.netWorth).toBeGreaterThan(netWorth - 1e7);
  expect(parseSave(serializeSave(game))).not.toBeNull();
});

it("keeps a migrated property's forecast current across ordinary loan payments", () => {
  const game = freeze(parseSave(legacyPortfolio())!.game, true);
  const network = game.territoryNetwork!;
  const loan = network.legacyConnections.at(-1)!;
  const openingBalance = loan.loanAmountLeft;
  const { cash, customers } = currentTick(game)!;
  const signature = projectionSignature(game);

  generateForecastTimeline(game, cash, customers);
  const next = createNextState(game, (draft) => tickState(draft));

  expect(loan.loanAmountLeft).toBe(openingBalance);
  expect(
    next.territoryNetwork!.legacyConnections.at(-1)!.loanAmountLeft,
  ).toBeLessThan(openingBalance);
  expect(next.territoryNetwork!.landPurchases).toBe(network.landPurchases);
  expect(projectionSignature(next)).toBe(signature);
  expect(
    projectionSignature({
      ...next,
      territoryNetwork: {
        ...next.territoryNetwork!,
        landPurchases: [],
      },
    }),
  ).not.toBe(signature);
});
it("retains seeded resume and roundtrip behavior for a current land owner", () => {
  const game = createGame({ scenarioId: 116, seed: 61 });
  const quote = landPurchaseQuote(game)!;
  expect(
    purchaseLand(game, {
      territoryId: quote.territoryId,
      quoteKey: quote.quoteKey,
    }),
  ).toBe(true);
  const resumed = parseSave(
    JSON.parse(JSON.stringify(serializeSave(game))),
  )!.game;
  expect(ownsTerritoryTile(resumed, quote.tileId)).toBe(true);
  for (let i = 0; i < 5; i++) {
    tickState(game);
    tickState(resumed);
  }
  expect(JSON.parse(JSON.stringify(resumed))).toEqual(
    JSON.parse(JSON.stringify(game)),
  );
  expect(parseSave(serializeSave(game))).not.toBeNull();
});
it.each([null, { hydroSiteId: 42 }])(
  "rejects malformed Valley facility %p without throwing",
  (facility) => {
    const raw = JSON.parse(
      JSON.stringify(serializeSave(createGame({ scenarioId: 116, seed: 61 }))),
    );
    const plant = raw.game.facilities[0];
    raw.game.facilities[0] = facility && { ...plant, ...facility };
    expect(parseSave(raw)).toBeNull();
  },
);
it.each([{}, [null]])(
  "rejects schema 16 facility data %p before reconstructing legacy tiles",
  (facilities) => {
    const raw = JSON.parse(
      JSON.stringify(serializeSave(createGame({ scenarioId: 116, seed: 61 }))),
    );
    raw.schemaVersion = 16;
    delete raw.game.territoryNetwork.legacyTiles;
    raw.game.facilities = facilities;
    expect(upgradeSave(raw)).toBeNull();
  },
);
it("rejects malformed retained tiles even when a generated tile has a pending project", () => {
  const game = createGame({ scenarioId: 116, seed: 61 });
  currentTick(game)!.cash = 3e9;
  const offer = [...tilePurchaseQuotes(game).values()].find(
    ({ tileId }) =>
      tileId.startsWith("frontier:") &&
      isGeneralBuildingLand(getTerritoryTile(tileId)!),
  )!;
  const tile = getTerritoryTile(offer.tileId)!;
  expect(
    purchaseTile(game, { tileId: tile.id, quoteKey: offer.quoteKey }),
  ).toBe(true);
  runMonths(game, offer.buildMonths);
  const order = getBuildFacilityQuote(
    game,
    { name: "Wind", peakW: 10e6 },
    tile.territoryId,
    tile.id,
  )!;
  const built = cloneDeep(
    reducer(
      game,
      buildFacility({
        facility: order,
        financed: false,
        territoryId: tile.territoryId,
        tileId: tile.id,
      }),
    ),
  );
  const plant = built.facilities.find(({ tileId }) => tileId === tile.id)!;
  plant.yearsToBuildLeft = 0;
  plant.minuteOperational = built.date.minute;
  const project = facilityExpansionQuote(built, plant.id, 20e6);
  if (project.status !== "ready") throw new Error(project.reason);
  const pending = reducer(
    built,
    expandFacility({
      facilityId: plant.id,
      targetSize: project.targetSize,
      quoteKey: project.quoteKey,
    }),
  );
  expect(
    pending.facilities.find(({ id }) => id === plant.id)?.expansionInProgress,
  ).toBeDefined();
  const raw = JSON.parse(JSON.stringify(serializeSave(pending)));
  expect(parseSave(raw)).not.toBeNull();
  raw.game.territoryNetwork.legacyTiles = {};
  expect(parseSave(raw)).toBeNull();
});
it.each([
  null,
  undefined,
  { version: 1 },
  { version: 2, landPurchases: [], legacyConnections: [], extra: true },
])("rejects a malformed current territory marker %p", (marker) => {
  const raw = JSON.parse(
    JSON.stringify(serializeSave(createGame({ scenarioId: 116, seed: 61 }))),
  );
  raw.game.territoryNetwork = marker;
  expect(parseSave(raw)).toBeNull();
});
it("rejects spoofed prices, duplicate receipts, unknown locations and forged legacy capital", () => {
  const game = createGame({ scenarioId: 116, seed: 61 });
  const quote = landPurchaseQuote(game)!;
  purchaseLand(game, {
    territoryId: quote.territoryId,
    quoteKey: quote.quoteKey,
  });
  const raw = JSON.parse(JSON.stringify(serializeSave(game)));
  expect(parseSave(raw)).not.toBeNull();
  raw.game.territoryNetwork.tilePurchases[0].price = 0;
  expect(parseSave(raw)).toBeNull();
  raw.game.territoryNetwork.tilePurchases[0].price = quote.price;
  raw.game.territoryNetwork.tilePurchases.push({
    ...raw.game.territoryNetwork.tilePurchases[0],
  });
  expect(parseSave(raw)).toBeNull();
  const legacy = legacyPortfolio();
  legacy.game.transmission.lines[2].buildCost = 1;
  expect(parseSave(legacy)).toBeNull();
});
it("migrates supported older versions by asset provenance and rejects future saves", () => {
  const raw = legacyPortfolio();
  raw.schemaVersion = 12;
  delete raw.game.territoryNetwork;
  raw.game.facilities.forEach(
    (f: { territoryId?: unknown }) => delete f.territoryId,
  );
  const result = parseSave(raw);
  expect(result).not.toBeNull();
  expect(
    result!.game.facilities.some((f) => f.territoryId === "valley-electric"),
  ).toBe(true);
  raw.schemaVersion = SAVE_SCHEMA_VERSION + 1;
  expect(parseSave(raw)).toBeNull();
});
it("uses the same territory model for a scenario116 mod and leaves other scenarios unchanged", () => {
  const scenario = modScenario(
    modPackage({ id: "valley-migration", baseScenarioId: 116, seed: 61 }),
  );
  const game = createGame({ scenarioId: 999, scenario, seed: 61 });
  const raw = JSON.parse(JSON.stringify(serializeSave(game)));
  raw.schemaVersion = 13;
  raw.game.territoryNetwork = { version: 1 };
  expect(parseSave(raw)?.game.territoryNetwork?.version).toBe(3);
  const other = createGame({ scenarioId: 100, seed: 61 });
  expect(parseSave(serializeSave(other))?.game).toEqual(other);
});
