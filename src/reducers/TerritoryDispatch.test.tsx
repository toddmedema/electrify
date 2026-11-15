import { STORAGE } from "../data/Facilities";
import { currentTick } from "../helpers/GameSelectors";
import { createGame } from "../testing/Simulator";
import { copyOfficialGame } from "../testing/OfficialScenarioExecutionFixtures";
import type { GameType, GeneratorOperatingType, TerritoryId } from "../Types";
import { tickState } from "./Game";
import { acquisitionQuote, transferUtility } from "../helpers/Expansion";
import {
  acceptAgreement,
  powerAgreementQuote,
  connectionAgreements,
} from "../helpers/PowerAgreements";
import { landPurchaseQuote, purchaseLand } from "../helpers/Territories";

function isolated() {
  const game = createGame({ scenarioId: 116, seed: 61 });
  currentTick(game)!.cash = 1e9;
  const quote = acquisitionQuote(game, "ridge-electric")!;
  transferUtility(game, {
    targetId: "ridge-electric",
    financed: false,
    quoteKey: quote.quoteKey,
  });
  game.facilities = [];
  game.transmission!.inheritedAgreementTerms = 1;
  game.transmission!.buyingRule = "NONE";
  game.transmission!.sellingRule = "NONE";
  return game;
}
function plant(game: GameType, territoryId: TerritoryId, peakW = 600e6) {
  const template = createGame({ scenarioId: 116, seed: 61 }).facilities.find(
    (f) => f.fuel === "Natural Gas",
  )!;
  const facility = {
    ...template,
    id: 900,
    territoryId,
    peakW,
    currentW: peakW,
    spinMinutes: 1,
    minimumStableOutput: 0,
    startingAssetId: undefined,
  } as GeneratorOperatingType;
  game.facilities.push(facility);
  return facility;
}
function demand(game: GameType, demandW = 600e6) {
  const next = game.timeline.find((t) => t.minute > game.date.minute)!;
  next.demandW = demandW;
  Object.keys(next.demandByType).forEach((k) => {
    next.demandByType[k as keyof typeof next.demandByType] =
      k === "Residential" ? demandW : 0;
  });
}
it("remote generation serves all customers with the same result as home generation and no line", () => {
  const remote = isolated();
  plant(remote, "ridge-electric");
  demand(remote);
  const home = copyOfficialGame(remote);
  home.facilities[0].territoryId = "champlain";
  tickState(remote);
  tickState(home);
  expect(currentTick(remote)!.supplyW).toBe(600e6);
  expect(JSON.parse(JSON.stringify(currentTick(remote)))).toEqual(
    JSON.parse(JSON.stringify(currentTick(home))),
  );
  expect(remote.transmission!.lines).toEqual([]);
});
it("remote storage charges and discharges from the shared pool without a line", () => {
  const game = isolated();
  const land = landPurchaseQuote(game)!;
  purchaseLand(game, {
    territoryId: land.territoryId,
    quoteKey: land.quoteKey,
  });
  const quote = STORAGE(
    { ...game, date: { ...game.date, year: 2025 } },
    100e6,
  ).find((f) => f.name === "Battery")!;
  const battery = {
    ...quote,
    id: 901,
    territoryId: "green-uplands" as const,
    currentW: 0,
    currentWh: 0,
    yearsToBuildLeft: 0,
    minuteCreated: 0,
    loanAmountTotal: 0,
    loanAmountLeft: 0,
    loanMonthlyPayment: 0,
    interestRate: 0,
    lifetimeWh: 0,
    lifetimePotentialWh: 0,
    lifetimeRevenue: 0,
    lifetimeExpenses: 0,
    hourlyLoss: 0,
  };
  const generator = plant(game, "ridge-electric");
  game.facilities.push(battery);
  demand(game, 100e6);
  tickState(game);
  const charged = game.facilities.find((f) => f.id === 901)!;
  expect(charged.currentWh).toBeGreaterThan(0);
  expect(currentTick(game)!.storageChargeW).toBeGreaterThan(0);
  generator.paused = true;
  game.facilities.find((f) => f.id === 900)!.paused = true;
  demand(game);
  tickState(game);
  expect(currentTick(game)!.storageDischargeW).toBeGreaterThan(0);
  expect(game.facilities.find((f) => f.id === 901)!.currentWh).toBeLessThan(
    charged.currentWh! + 1,
  );
  expect(game.transmission!.lines).toEqual([]);
});
it("neighbor contracts are finite, nonstacking and terminate as external supply on acquisition", () => {
  const game = createGame({ scenarioId: 116, seed: 61 });
  currentTick(game)!.cash = 1e9;
  const quote = powerAgreementQuote(game, "ridge-purchase", 3, 1)!;
  expect(quote).toBeDefined();
  expect(quote.deliverableW).toBeLessThanOrEqual(30e6);
  expect(
    acceptAgreement(game, {
      blockId: quote.id,
      quoteKey: quote.quoteKey,
      durationYears: 1,
    }),
  ).toBe(true);
  expect(powerAgreementQuote(game, "ridge-purchase")).toBeUndefined();
  const before = connectionAgreements(game, "champlain").find(
    (s) => s.id === "ridge-purchase:0",
  )!;
  expect(before.active).toBe(true);
  expect(before.endMinute).toBeGreaterThan(before.startMinute);
  const acquisition = acquisitionQuote(game, "ridge-electric")!;
  expect(
    transferUtility(game, {
      targetId: "ridge-electric",
      financed: false,
      quoteKey: acquisition.quoteKey,
    }),
  ).toBe(true);
  expect(
    connectionAgreements(game, "champlain").find((s) => s.id === before.id)!
      .active,
  ).toBe(false);
  expect(game.facilities.some((f) => f.territoryId === "ridge-electric")).toBe(
    true,
  );
  expect(powerAgreementQuote(game, "ridge-purchase")).toBeUndefined();
  expect(game.transmission!.lines).toEqual([]);
});
