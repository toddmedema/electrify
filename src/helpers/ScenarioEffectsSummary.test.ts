import { scenarioEffectsSummary } from "./ScenarioEffectsSummary";

test("authored monthly expenses cap fractional dollars at three significant digits and a general expense label", () => {
  expect(
    scenarioEffectsSummary({ operatingExpensePerMonth: 0.000123456789 }, true),
  ).toEqual(["Operating expense: $0.000123/month"]);
  expect(
    scenarioEffectsSummary({ operatingExpensePerMonth: 123456.789012 }, true),
  ).toEqual(["Operating expense: $123k/month"]);
});

test("regional restoration summaries compact large costs", () => {
  expect(
    scenarioEffectsSummary({ operatingExpensePerMonth: 123456.789012 }),
  ).toEqual(["Restoration: $123k/month"]);
});

test("a small credit rounds without a negative zero and retains precision in the authored summary", () => {
  expect(scenarioEffectsSummary({ operatingExpensePerMonth: -0.01 })).toEqual([
    "Restoration: $0/month",
  ]);
  expect(
    scenarioEffectsSummary({ operatingExpensePerMonth: -0.01 }, true),
  ).toEqual(["Operating expense: $-0.01/month"]);
});
