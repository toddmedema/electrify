import { validUtilityExpansion } from "./helpers/ExpansionValidation";
import { validPowerAgreements } from "./helpers/PowerAgreements";
import { validTerritoryNetwork } from "./helpers/TerritoryValidation";
import type { GameType } from "./Types";
import cloneDeep from "lodash.clonedeep";
import { createNextState, freeze } from "@reduxjs/toolkit";
import { SAVE_SCHEMA_VERSION } from "./SaveSchema";
import { validTransmissionLine, parseSave, serializeSave } from "./SaveGame";
import { upgradeSave } from "./SaveUpgrade";
import { createGame } from "./testing/Simulator";
import { currentTick } from "./helpers/GameSelectors";
import {
  ownedTerritories,
  landPurchaseQuote,
  purchaseLand,
} from "./helpers/Territories";
import { accessContextForGame } from "./data/IntertieAccess";
import {
  intertieBuildQuote,
  intertieUpgradeQuote,
} from "./helpers/Transmission";
import { inheritedConnection } from "./helpers/PowerAgreements";
import { acquisitionQuote } from "./helpers/Expansion";
import { projectionSignature } from "./helpers/Projection";
import {
  applyAcquireUtility,
  generateForecastTimeline,
  tickState,
} from "./reducers/Game";
import { modScenario } from "./mods/ModScenario";
import { modPackage } from "./testing/ModFixtures";

function legacyPortfolio(
  state: "building" | "paused" | "upgrade" = "building",
) {
  const game = createGame({ scenarioId: 116, seed: 61 });
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
  purchaseLand(game, {
    territoryId: quote.territoryId,
    quoteKey: quote.quoteKey,
  });
  const resumed = parseSave(
    JSON.parse(JSON.stringify(serializeSave(game))),
  )!.game;
  for (let i = 0; i < 5; i++) {
    tickState(game);
    tickState(resumed);
  }
  expect(JSON.parse(JSON.stringify(resumed))).toEqual(
    JSON.parse(JSON.stringify(game)),
  );
  expect(parseSave(serializeSave(game))).not.toBeNull();
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
