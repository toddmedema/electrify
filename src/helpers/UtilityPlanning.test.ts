import { createGame } from "../testing/Simulator";
import {
  UTILITY_TARGETS,
  utilityNetworkAnnualOM,
} from "../data/UtilityExpansion";
import { acquisitionQuote, transferUtility, utilityOffer } from "./Expansion";
import { utilityPlanning, utilityServiceGap } from "./UtilityPlanning";
import { selectProjection } from "./Projection";
import { currentTick } from "./GameSelectors";
import { getDateFromMinute, MINUTES_PER_MONTH } from "./DateTime";

it("shows both dated offers without permitting an unconnected purchase or mutating the game", () => {
  const game = createGame({
    scenarioId: 116,
    difficulty: "Employee",
    seed: 12345,
  });
  const before = JSON.stringify(game);
  for (const target of UTILITY_TARGETS) {
    const offer = utilityOffer(game, target.id)!;
    expect(offer.equityPrice).toBe(target.equityPrice);
    expect(offer.assumedDebt).toBe(target.assumedDebt);
    expect(offer.facilities).toHaveLength(3);
    expect(offer.contracts.length).toBeGreaterThan(0);
    expect(acquisitionQuote(game, target.id)).toBeUndefined();
    expect(
      transferUtility(game, {
        targetId: target.id,
        financed: true,
        quoteKey: "not-an-executable-offer",
      }),
    ).toBe(false);
  }
  expect(utilityOffer(game, "toString")).toBeUndefined();
  expect(JSON.stringify(game)).toBe(before);
});

it("quotes reference lead times by difficulty and shows only owned or deliberately reviewed supply", () => {
  const easy = createGame({
    scenarioId: 116,
    difficulty: "Employee",
    seed: 12345,
  });
  const expert = createGame({
    scenarioId: 116,
    difficulty: "CEO",
    seed: 12345,
  });
  expect(utilityPlanning(easy)?.buildMonths).toBe(12);
  expect(utilityPlanning(expert)?.buildMonths).toBe(39);
  expect(
    utilityPlanning(easy)?.supplyChanges.map((change) => change.utility),
  ).toEqual(["Champlain Electric"]);
  const prospective = utilityPlanning(expert, undefined, "valley-electric")!;
  expect(
    prospective.supplyChanges.find(
      (change) => change.utility === "Valley Electric" && change.year === 2017,
    )?.startMonth,
  ).toBe(105);
  const common = prospective.supplyChanges.find(
    (change) => change.utility === "Champlain Electric" && change.year === 2020,
  )!;
  expect(
    common.contracts.find((source) => source.id === "champlain-nuclear")
      ?.nominalW,
  ).toBe(0);
  expect(
    common.contracts.find((source) => source.id === "champlain-quebec")
      ?.nominalW,
  ).toBe(60e6);
  easy.facilities = easy.facilities.filter(
    (facility) => facility.startingAssetId !== "scenario-116-champlain-oil-a",
  );
  expect(utilityPlanning(easy)?.retirements).toEqual([]);
  easy.date = getDateFromMinute(180 * MINUTES_PER_MONTH, 2005);
  expect(utilityPlanning(easy)?.supplyChanges).toEqual([]);
});

it("bases customer and peak-demand guidance on the real tariff-sensitive forecast", () => {
  const fair = createGame({
    scenarioId: 116,
    difficulty: "Employee",
    seed: 12345,
  });
  const cheap = createGame({
    scenarioId: 116,
    difficulty: "Employee",
    seed: 12345,
    dollarsPerkWh: 0.08,
  });
  const fairPlan = utilityPlanning(
    fair,
    selectProjection(fair, currentTick(fair)!),
  )!;
  const cheapPlan = utilityPlanning(
    cheap,
    selectProjection(cheap, currentTick(cheap)!),
  )!;
  expect(cheapPlan.nextCustomers).toBeGreaterThan(fairPlan.nextCustomers!);
  expect(cheapPlan.nextPeakW).toBeGreaterThan(fairPlan.nextPeakW!);
  expect(cheapPlan.gap).toBeDefined();
});

it("funds recurring renewal stages and additional customer service without erasing inherited costs", () => {
  expect(utilityNetworkAnnualOM(["champlain"], 90000, 2014)).toBe(40e6);
  expect(utilityNetworkAnnualOM(["champlain"], 90000, 2015)).toBe(60e6);
  expect(utilityNetworkAnnualOM(["champlain"], 90000, 2020)).toBe(80e6);
  expect(utilityNetworkAnnualOM(["champlain"], 180000, 2020)).toBe(160e6);
  expect(utilityNetworkAnnualOM(["champlain"], 45000, 2020)).toBe(80e6);
});

it("warns through the scored term and includes later supply risks only after Keep playing", () => {
  const game = createGame({
    scenarioId: 116,
    difficulty: "Employee",
    seed: 12345,
  });
  const projection = selectProjection(game, currentTick(game)!);
  const row = projection.financeProjected[0];
  const december = {
    ...row,
    year: 2024,
    month: 12,
    demandWh: 100,
    supplyWh: 96,
  };
  const january = { ...row, year: 2025, month: 1, demandWh: 100, supplyWh: 94 };
  const future = { ...projection, financeProjected: [december, january] };
  expect(utilityServiceGap(game, future)).toBeUndefined();
  expect(
    utilityServiceGap(game, {
      ...future,
      financeProjected: [{ ...december, supplyWh: 94 }, january],
    }),
  ).toMatchObject({ year: 2024, month: 12 });
  game.date = getDateFromMinute(240 * MINUTES_PER_MONTH, game.startingYear);
  expect(utilityServiceGap(game, future)).toBe(january);
});
