import {
  formatCount,
  formatNumber,
  formatScore,
  formatWatts,
  formatForecastNumber,
  formatForecastMoney,
  formatForecastWatts,
  formatForecastWattHours,
  formatForecastPercent,
  formatPercent,
  formatRateCompact,
  formatMoneyConcise,
  formatMoneyStable,
} from "./Format";
import { formatLargeMassValue } from "./Units";
import { objectiveValueText } from "./ObjectivePresentation";
import type { CompiledRuleObjective } from "../data/ScenarioRules";

it("caps observed amounts at three digits, including legacy requests for more precision", () => {
  expect(formatCount(561952)).toBe("562k");
  expect(formatScore(561952)).toBe("562k");
  expect(formatNumber(561952, { maximumSignificantDigits: 12 })).toBe("562k");
  expect(formatWatts(1521, 6)).toBe("1.52kW");
  expect(formatMoneyConcise(561952)).toBe("$562k");
  expect(formatLargeMassValue(561952000, "metric")).toBe("562k");
  expect(formatLargeMassValue(561952000 * 0.90718474, "imperial")).toBe("562k");
});

it.each([1, -1])(
  "caps estimated amounts at two digits with sign %s",
  (sign) => {
    const prefix = sign < 0 ? "-" : "";
    expect(formatForecastNumber(sign * 561952)).toBe(`${prefix}560k`);
    expect(formatForecastWatts(sign * 562.1e6)).toBe(`${prefix}560MW`);
    expect(formatForecastWattHours(sign * 562.1e6)).toBe(`${prefix}560MWh`);
    expect(formatForecastMoney(sign * 561952)).toBe(`${prefix}$560k`);
    expect(formatForecastPercent(sign * 0.5621)).toBe(`${prefix}56%`);
  },
);

it("keeps small estimates, unit boundaries and missing estimates readable", () => {
  expect(formatForecastNumber(0.00561952)).toBe("0.0056");
  expect(formatForecastNumber(999500)).toBe("1M");
  expect(formatForecastMoney(999500)).toBe("$990k");
  expect(formatForecastMoney(Infinity)).toBe("—");
  expect(formatForecastWatts(-0)).toBe("0W");
});

it("qualifies a rounded forecast that would otherwise look like it met its goal", () => {
  const goal: CompiledRuleObjective = {
    id: "customers",
    label: "Keep customers",
    metric: "customerCount",
    deadlineMonth: 11,
    minCustomers: 100000,
    required: true,
  };
  expect(objectiveValueText(goal, 99951, 100000, 2)).toBe(
    "100k customers (below goal)",
  );
  expect(objectiveValueText(goal, 100049, 100000, 2)).toBe(
    "100k customers (above goal)",
  );
});

it("recalculates stable currency decimals when rounding crosses ten or a hundred", () => {
  expect(formatMoneyStable(9.999)).toBe("$10.0");
  expect(formatMoneyStable(99.999)).toBe("$100");
  expect(formatMoneyStable(9999)).toBe("$10.0k");
  expect(formatMoneyStable(999.999)).toBe("$999");
  expect(formatForecastMoney(999)).toBe("$990");
});

it("retains decimal tie rounding while limiting significant digits", () => {
  expect(formatMoneyConcise(2.675)).toBe("$2.68");
  expect(formatMoneyStable(9.995)).toBe("$10.0");
  expect(formatWatts(-562.5e6)).toBe("-562MW");
});

it("rounds once when the existing display precision is coarser than the significant-digit cap", () => {
  expect(formatMoneyConcise(0.0149999)).toBe("$0.01");
  expect(formatWatts(9.849999e6)).toBe("9.8MW");
  expect(formatPercent(0.999499, 2)).toBe("99.9%");
  expect(formatForecastPercent(0.99499)).toBe("99%");
  expect(formatRateCompact(1.0049999)).toBe("100¢");
  expect(formatForecastMoney(0.0523)).toBe("$0.05");
});
