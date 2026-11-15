import { scenarioEffectsSummary } from "./ScenarioEffectsSummary";
import { currencyByCode } from "./Currency";

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

test("a small credit retains precision in runtime and authored summaries", () => {
  expect(scenarioEffectsSummary({ operatingExpensePerMonth: -0.01 })).toEqual([
    "Restoration: $-0.01/month",
  ]);
  expect(
    scenarioEffectsSummary({ operatingExpensePerMonth: -0.01 }, true),
  ).toEqual(["Operating expense: $-0.01/month"]);
});

test.each([false, true])(
  "fractional local fees and upkeep stay nonzero with exact=%s without changing their USD amounts",
  (exact) => {
    const effects = {
      carbonFeePerKgCO2e: 0.001,
      operatingExpensePerMonth: 0.001,
    };
    expect(
      scenarioEffectsSummary(effects, exact, currencyByCode("KWD")),
    ).toEqual([
      `${exact ? "Operating expense" : "Restoration"}: KWD 0.000308/month`,
      "Carbon fee: KWD 0.308/tonne",
    ]);
    expect(effects).toEqual({
      carbonFeePerKgCO2e: 0.001,
      operatingExpensePerMonth: 0.001,
    });
  },
);
