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

test("Chernobyl saves retain exact legacy dollar receipts without accepting altered effects", () => {
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
  disaster.effects.facilityOutputMultipliersById = {
    ...disaster.effects.facilityOutputMultipliersById,
    1: 0.5,
  };
  expect(validScenarioRuleState(game)).toBe(false);
});
