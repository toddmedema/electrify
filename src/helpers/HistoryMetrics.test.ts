import {
  formatCustomerChange,
  HISTORY_METRIC_KEYS,
  historyMetrics,
} from "./HistoryMetrics";

describe("history metrics", () => {
  it("describes every listed metric, in both unit systems", () => {
    for (const units of ["metric", "imperial"] as const) {
      const metrics = historyMetrics(units);
      expect(Object.keys(metrics)).toEqual([...HISTORY_METRIC_KEYS]);
      for (const key of HISTORY_METRIC_KEYS) {
        expect(metrics[key].label).not.toEqual("");
        expect(typeof metrics[key].format(1234)).toEqual("string");
      }
    }
  });

  it("reads emissions in the chosen unit system", () => {
    expect(historyMetrics("metric").kgco2ePerMWh.suffix).not.toEqual(
      historyMetrics("imperial").kgco2ePerMWh.suffix,
    );
  });
});

describe("the customer forecast", () => {
  it("shows customer growth as a delta and percent when compact totals would look equal", () => {
    expect(formatCustomerChange(9900, 1000000)).toEqual("+9.9k (+1.0%)");
  });

  it("formats losses and omits an undefined percent with no existing customers", () => {
    expect(formatCustomerChange(-9900, 1000000)).toEqual("-9.9k (-1.0%)");
    expect(formatCustomerChange(9900, 0)).toEqual("+9.9k");
  });
});

it("does not display negative zero in customer changes or inflation", () => {
  expect(formatCustomerChange(-0.001, 1000000)).toBe("0 (0.0%)");
  expect(formatCustomerChange(-1, 1000000)).toBe("-1 (0.0%)");
  expect(historyMetrics("metric").inflationRate.format(-0.00001)).toBe("0.0%");
});
