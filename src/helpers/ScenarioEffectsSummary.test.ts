import { scenarioEffectsSummary } from "./ScenarioEffectsSummary";

test("authored monthly expenses retain fractional dollars and a general expense label", () => {
  expect(
    scenarioEffectsSummary({ operatingExpensePerMonth: 0.000123456789 }, true),
  ).toEqual(["Operating expense: $0.000123456789/month"]);
  expect(
    scenarioEffectsSummary({ operatingExpensePerMonth: 123456.789012 }, true),
  ).toEqual(["Operating expense: $123,456.789012/month"]);
});

test("legacy regional restoration summaries retain their established rounded wording", () => {
  expect(
    scenarioEffectsSummary({ operatingExpensePerMonth: 123456.789012 }),
  ).toEqual(["Restoration: $123,457/month"]);
});
