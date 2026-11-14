import { modScenario } from "../mods/ModScenario";
import { modPlayerFacts } from "../mods/ModAuthoring";
import { modBrowseSummary } from "../multiplayer/ModBrowse";
import { prepareCustomScenario } from "./CustomScenarioEvents";
import { scenarioRules } from "./ScenarioRules";
import { runMonths } from "../testing/SimulationTestHelpers";
import { tickState } from "../reducers/Game";
import { validScenarioRuleState } from "./ScenarioRuleValidation";
import { DEFAULT_CUSTOM_SCENARIO, getScenario } from "../data/Scenarios";
import { currencyByCode, currencyForLocation } from "./Currency";
import { buildVictoryDebrief } from "./Debrief";
import { EMPTY_HISTORY } from "./DateTime";
import {
  formatMoneyConcise,
  formatMoneyFull,
  formatRateCompact,
} from "./Format";
import { historyMetrics } from "./HistoryMetrics";
import { getScenarioLocation } from "./Locations";
import { getMissionStatus } from "./MissionStatus";
import { objectiveTargetText } from "./ObjectivePresentation";
import { compileOfficialArcChoices } from "./ScenarioRuleChoices";
import { scenarioEffectsSummary } from "./ScenarioEffectsSummary";
import { scoreRuleText } from "./Scoring";
import { createGame } from "../testing/Simulator";
import { parseSavedRunResult } from "../SaveModel";
import { fakeSavedResult } from "../testing/SaveTestHelpers";

const delhi = getScenario(115)!;
const currency = currencyForLocation(
  getScenarioLocation(delhi),
  delhi.startingYear,
);

test("mission, history, objectives and scoring use the run's currency without changing raw amounts", () => {
  const game = createGame({ scenarioId: 115, seed: 42 });
  const before = JSON.stringify(game);
  const cash = getMissionStatus(game).requirements.find(
    (item) => item.id === "cash",
  )!;
  expect(cash.target).toContain("₹0");
  expect(cash.current).toContain("₹");
  const history = historyMetrics("metric", currency);
  expect(history.cash.format(1e6)).toBe(formatMoneyConcise(1e6, currency));
  expect(history.cash.formatTable!(1e6)).toContain("₹");
  expect(
    objectiveTargetText(
      {
        id: "bills",
        label: "Bills",
        metric: "monthlyBilledRate",
        required: true,
        fromMonth: 0,
        throughMonth: 1,
        maxDollarsPerKWh: 0.1,
      },
      currency,
    ),
  ).toContain(`${formatRateCompact(0.1, currency)}/kWh`);
  expect(
    scoreRuleText("Public", 0.1, "1 megatonne", currency).financial,
  ).toContain(`${formatMoneyFull(0.01, currency, 6)}/kWh`);
  expect(JSON.stringify(game)).toBe(before);
});

test("an imported dollar arc quotes the receiving custom location without converting its payments", () => {
  const receivingScenario = {
    ...DEFAULT_CUSTOM_SCENARIO,
    locationId: delhi.locationId,
    location: delhi.location,
    startingYear: 2050,
    startingCustomers: 12345,
  };
  const params = {
    namespace: { kind: "mod" as const, id: "local-currency" },
    difficulty: "Employee" as const,
    seed: 42,
    startingYear: 2050,
    durationMonths: 240,
    startingAssetIds: [],
    receivingScenario,
  };
  const local = compileOfficialArcChoices(params, [
    { scenarioId: 106, includeChoices: true },
  ]);
  const usd = compileOfficialArcChoices(
    {
      ...params,
      receivingScenario: {
        ...receivingScenario,
        locationId: DEFAULT_CUSTOM_SCENARIO.locationId,
        location: undefined,
      },
    },
    [{ scenarioId: 106, includeChoices: true }],
  );
  const funded = local[0].options.find((option) => option.grant > 0)!;
  expect(funded.description).toContain(
    formatMoneyConcise(funded.grant, currency),
  );
  expect(funded.description).not.toContain("$");
  expect(usd[0].options.map(({ cost, grant }) => ({ cost, grant }))).toEqual(
    local[0].options.map(({ cost, grant }) => ({ cost, grant })),
  );
  expect(
    usd[0].options.find((option) => option.grant > 0)!.description,
  ).toContain("$");
  expect(
    scenarioEffectsSummary({ operatingExpensePerMonth: 1000 }, false, currency),
  ).toEqual([`Restoration: ${currency.symbol}89.9k/month`]);
});

test("completed custom results keep their currency through the saved-result allowlist", () => {
  const scenario = {
    ...DEFAULT_CUSTOM_SCENARIO,
    locationId: delhi.locationId,
    location: delhi.location,
  };
  const debrief = buildVictoryDebrief(
    scenario,
    { ...EMPTY_HISTORY, cash: 1234 },
    [],
    [],
  );
  expect(debrief.currencyCode).toBe("INR");
  const result = fakeSavedResult({ scenarioId: 999, debrief });
  const restored = parseSavedRunResult(JSON.parse(JSON.stringify(result)))!;
  expect(restored.debrief!.currencyCode).toBe("INR");
  expect(restored.debrief!.finalCash).toBe(1234);
  expect(currencyByCode(restored.debrief!.currencyCode).symbol).toBe("₹");
  for (const currencyCode of ["UNKNOWN", "toString", 42, { unitsPerDollar: 2 }])
    expect(
      parseSavedRunResult({ ...result, debrief: { ...debrief, currencyCode } }),
    ).toBeNull();
  const { currencyCode, ...legacy } = debrief;
  expect(currencyCode).toBe("INR");
  expect(
    parseSavedRunResult({ ...result, debrief: legacy })!.debrief,
  ).not.toHaveProperty("currencyCode");
});

test("Chernobyl saves retain their previously authored dollar receipts", () => {
  const game = createGame({ scenarioId: 126, seed: 17 });
  runMonths(game, 1);
  tickState(game);
  const disaster = game.worldEvents.occurrences.find((event) =>
    event.message?.includes("Cleanup costs"),
  )!;
  expect(disaster.message).toContain("SUR 250M");
  expect(validScenarioRuleState(game)).toBe(true);
  // The old receipt differs only in its authored display text; numeric obligations are identical.
  disaster.message = disaster.message!.replace("SUR 250M", "$250M");
  expect(validScenarioRuleState(game)).toBe(true);
});

test("custom non-dollar saves retain legacy dollar carbon-fee receipts", () => {
  const scenario = prepareCustomScenario({
    ...DEFAULT_CUSTOM_SCENARIO,
    locationId: delhi.locationId,
    location: delhi.location,
    eventScenarioIds: [100],
    cash: 1e12,
    startingDemandScale: 0.1,
  });
  const game = createGame({ scenarioId: 999, scenario, seed: 17 });
  const onset = scenarioRules(scenario, game)!.events.find(
    (event) => event.effects.carbonFeePerKgCO2e,
  )!;
  runMonths(game, onset.startMonth);
  tickState(game);
  const receipt = game.worldEvents.occurrences.find(
    (event) => event.effects.carbonFeePerKgCO2e,
  )!;
  expect(receipt.message).toContain("₹");
  expect(validScenarioRuleState(game)).toBe(true);
  receipt.message = `${game.location.name}: ${scenarioEffectsSummary(receipt.effects).join("; ")}.`;
  expect(receipt.message).toContain("$");
  expect(validScenarioRuleState(game)).toBe(true);
  receipt.effects.carbonFeePerKgCO2e = 999;
  expect(validScenarioRuleState(game)).toBe(false);
});

test("community and co-op mod previews use the selected location's currency", () => {
  const scenario = modScenario({
    schemaVersion: 1,
    gameApi: 1,
    id: "local-preview",
    title: "Local preview",
    creator: "Author",
    version: "1",
    description: "A local-currency challenge.",
    baseScenarioId: 115,
    officialArcs: [],
    objectives: [
      {
        id: "bills",
        label: "Affordable bills",
        metric: "monthlyBilledRate",
        fromMonth: 1,
        throughMonth: 2,
        maxDollarsPerKWh: 0.1,
      },
    ],
    events: [
      {
        id: "maintenance",
        title: "Maintenance",
        message: "Maintenance costs more.",
        startMonth: 1,
        durationMonths: 1,
        effects: { operatingExpenseDollarsPerMonth: 1000 },
      },
    ],
  });
  const before = JSON.stringify(scenario);
  const facts = modPlayerFacts(scenario);
  const setup = facts.sections.find((section) => section.id === "setup")!;
  expect(
    setup.rows.find((row) => row.label === "Starting cash and billed rate")!
      .value,
  ).toContain("₹");
  expect(JSON.stringify(facts)).toContain("Operating expense: ₹89.9k/month");
  const summary = modBrowseSummary(scenario);
  expect(summary.objectives[0].target).toContain("₹8.99/kWh");
  expect(JSON.stringify(scenario)).toBe(before);
});
