import cloneDeep from "lodash.clonedeep";
import { TICKS_PER_YEAR, TICK_MINUTES } from "../Constants";
import {
  GameType,
  TickPresentFutureType,
  TransmissionLineOperatingType,
} from "../Types";
import { createGame } from "../testing/Simulator";
import {
  intertieForecastKey,
  intertiePortfolioOutlook,
} from "./IntertiePortfolio";
import * as transmission from "./Transmission";

const tick = (
  minute: number,
  overrides: Partial<TickPresentFutureType> = {},
): TickPresentFutureType =>
  ({
    minute,
    demandW: 2e6,
    supplyW: 1e6,
    importedW: 0,
    exportedW: 0,
    temperatureC: 20,
    solarIrradianceWM2: 0,
    ...overrides,
  }) as TickPresentFutureType;
const northernLine = (yearsToBuildLeft = 0): TransmissionLineOperatingType => ({
  id: 1,
  corridorId: "california-north",
  name: "Northern intertie",
  capacityW: 5e6,
  buildCost: 1.8e6,
  annualOperatingCost: 36000,
  yearsToBuildLeft,
  minuteCreated: 0,
  financed: false,
  loanAmountLeft: 0,
  loanMonthlyPayment: 0,
  interestRate: 0,
  currentFlowW: 0,
});
let game: GameType;
beforeEach(() => {
  game = cloneDeep(createGame({ scenarioId: 111, seed: 12345 }));
  jest.spyOn(transmission, "adjacentMarketPricePerMWh").mockReturnValue(50);
});
afterEach(() => jest.restoreAllMocks());

it("weights hourly and quarter-hour forecasts as the same annual energy bill", () => {
  const yearMinutes = TICKS_PER_YEAR * TICK_MINUTES;
  const forecast = (step: number) =>
    Array.from({ length: yearMinutes / step }, (_, i) => tick(i * step));
  const hourly = intertiePortfolioOutlook(
    game,
    "california-north",
    forecast(60),
    60,
  )!;
  const quarterHourly = intertiePortfolioOutlook(
    game,
    "california-north",
    forecast(15),
    15,
  )!;
  // One MW of local shortage covered continuously: 8,760 MWh at $50/MWh.
  expect(hourly.annualEnergyCost).toBeCloseTo(438000);
  expect(quarterHourly.annualEnergyCost).toBeCloseTo(hourly.annualEnergyCost);
  expect(hourly.shortfallCoverage).toBe(1);
  expect(hourly.marginalCoverage).toBe(1);
  expect(hourly.worstGapW).toBe(0);
});

it("counts existing imports once and reports zero extra coverage for an already covered gap", () => {
  game.transmission!.lines = [northernLine()];
  const forecast = [tick(720, { supplyW: 2e6, importedW: 1e6 })];
  const result = intertiePortfolioOutlook(game, "california-south", forecast)!;
  expect(result.shortfallCoverage).toBe(1);
  expect(result.marginalCoverage).toBe(0);
  expect(result.additionalEnergyCost).toBe(0);
  expect(result.annualEnergyCost).toBeGreaterThan(0);
  expect(result.worstGapW).toBe(0);
});

it("does not claim unfinished connections are already covering the fleet", () => {
  game.transmission!.lines = [northernLine(1)];
  const result = intertiePortfolioOutlook(game, "california-south", [
    tick(720),
  ])!;
  expect(result.marginalCoverage).toBe(1);
  expect(result.additionalEnergyCost).toBe(result.annualEnergyCost);
});

it.each(["CLOSED", "SURPLUS_ONLY"] as const)(
  "honors the %s rule instead of promising forbidden imports",
  (policy) => {
    game.transmission!.tradingPolicy = policy;
    const result = intertiePortfolioOutlook(game, "california-north", [
      tick(0),
    ])!;
    expect(result.shortfallCoverage).toBe(0);
    expect(result.marginalCoverage).toBe(0);
    expect(result.annualEnergyCost).toBe(0);
    expect(result.worstGapW).toBe(1e6);
    expect(result.stressGapW).toBe(1e6);
  },
);

it("treats exported surplus as local power rather than a portfolio shortage", () => {
  const result = intertiePortfolioOutlook(game, "california-north", [
    tick(0, { supplyW: 2e6, exportedW: 1e6 }),
  ])!;
  expect(result.marginalCoverage).toBe(0);
  expect(result.annualEnergyCost).toBe(0);
  expect(result.worstGapW).toBe(0);
  expect(result.stressGapW).toBe(0);
});

it("exposes an independent neighbor constraint in the illustrative stress case", () => {
  const result = intertiePortfolioOutlook(game, "california-north", [
    tick(0, { demandW: 4e6 }),
  ])!;
  // January normal spare supply 4 MW × 80% = 3.2 MW covers a 3 MW deficit.
  // Half that spare supply leaves a 1.4 MW gap even though the wire carries 5 MW.
  expect(result.worstGapW).toBe(0);
  expect(result.stressGapW).toBeCloseTo(1.4e6);
  expect(intertiePortfolioOutlook(game, "missing", [tick(0)])).toBeUndefined();
  expect(
    intertiePortfolioOutlook(game, "california-north", []),
  ).toBeUndefined();
});

it("invalidates same-month outlooks when scenario choices change loads or story consequences", () => {
  const before = intertieForecastKey(game);
  const changedStory = cloneDeep(game);
  changedStory.worldEvents.occurrences.push({
    key: "choice-test",
    definitionId: "choice-test",
    startsMinute: game.date.minute,
    endsMinute: game.date.minute + 15,
    attributes: { scenarioChoice: true, choice: "prepare" },
    effects: {},
  });
  expect(intertieForecastKey(changedStory)).not.toBe(before);
  const changedLoad = cloneDeep(game);
  changedLoad.loadAdditions = [
    {
      id: "test-load",
      label: "Campus",
      demandType: "Data centers",
      peakW: 1e6,
      startsYear: 2024,
      startsMonth: 1,
      loadFactor: 0.9,
    },
  ];
  expect(intertieForecastKey(changedLoad)).not.toBe(before);
  expect(intertieForecastKey({ ...game, storyEffectsDisabled: true })).not.toBe(
    before,
  );
  expect(changedLoad.date.monthsElapsed).toBe(game.date.monthsElapsed);
});
