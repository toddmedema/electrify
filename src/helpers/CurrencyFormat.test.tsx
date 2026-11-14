import { currencyByCode, USD_CURRENCY } from "./Currency";
import {
  currencyFormatters,
  formatDecimalNumber,
  formatForecastMoney,
  formatMoneyConcise,
  formatMoneyFull,
  formatMoneyStable,
  formatPricePerMWh,
  formatRateCompact,
} from "./Format";

const eur = currencyByCode("EUR");

describe("local currency display", () => {
  it("converts USD once before choosing compact units and precision", () => {
    expect(formatMoneyConcise(1e6, eur)).toBe("€851k");
    expect(formatMoneyStable(1000, eur)).toBe("€851");
    expect(formatForecastMoney(1000, eur)).toBe("€850");
    expect(formatPricePerMWh(100, eur)).toBe("€85.1/MWh");
    expect(formatMoneyFull(1234.567, eur)).toBe("€1,050.62");
    expect(formatMoneyFull(0.01, eur, 4)).toBe("€0.0085");
  });

  it("keeps retail prices in local major units outside USD", () => {
    expect(formatRateCompact(0.1)).toBe("10¢");
    expect(formatRateCompact(0.1, eur)).toBe("€0.0851");
    expect(formatRateCompact(0.1, currencyByCode("INR"))).toBe("₹8.99");
    expect(formatRateCompact(0.1, currencyByCode("ZMW"))).toBe("ZK2.2");
    expect(formatRateCompact(0.1, currencyByCode("ZAR"))).toBe("R1.65");
    expect(formatRateCompact(0.1, currencyByCode("JPY"))).toBe("¥15.7");
    expect(formatRateCompact(0.01, currencyByCode("KWD"))).toBe("KWD 0.00308");
  });

  it("rounds tiny exact prices at the requested precision without changing legacy decimal truncation", () => {
    expect(formatMoneyFull(0.000001, eur, 6)).toBe("€0.000001");
    expect(formatMoneyFull(-0.000001, eur, 6)).toBe("-€0.000001");
    expect(formatMoneyFull(1.25e-7, USD_CURRENCY, 8)).toBe("$0.00000013");
    expect(formatMoneyFull(0.0000001, eur, 6)).toBe("€0.000000");
    expect(formatMoneyFull(-0.0000001, eur, 6)).toBe("€0.000000");
    expect(formatMoneyFull(1.005)).toBe("$1.01");
    expect(formatDecimalNumber(8.51e-7, { digits: 6 })).toBe("0.000000");
  });

  it("preserves leading signs, rounded zero and missing estimates", () => {
    expect(formatMoneyConcise(-1000, eur)).toBe("-€851");
    expect(formatMoneyStable(-0.001, eur)).toBe("€0.00");
    expect(formatMoneyConcise(-0.001, eur)).toBe("€0");
    expect(formatMoneyFull(-0.001, eur)).toBe("€0.00");
    expect(formatMoneyFull(-1, eur)).toBe("-€0.85");
    expect(formatRateCompact(-0, eur)).toBe("€0");
    expect(formatRateCompact(-0.1, eur)).toBe("-€0.0851");
    [NaN, Infinity, -Infinity].forEach((value) => {
      expect(formatMoneyConcise(value, eur)).toBe("—");
      expect(formatMoneyStable(value, eur)).toBe("—");
      expect(formatForecastMoney(value, eur)).toBe("—");
      expect(formatMoneyFull(value, eur)).toBe("—");
      expect(formatRateCompact(value, eur)).toBe("—");
    });
  });

  it("binds callbacks without changing their USD input or leaking another currency", () => {
    const local = currencyFormatters(eur);
    const dollar = currencyFormatters(USD_CURRENCY);
    expect(local.currency).toBe(eur);
    expect(local.formatMoneyConcise(100)).toBe("€85.1");
    expect(local.formatMoneyStable(100)).toBe("€85.1");
    expect(local.formatForecastMoney(100)).toBe("€85");
    expect(local.formatRateCompact(0.1)).toBe("€0.0851");
    expect(local.formatPricePerMWh(100)).toBe("€85.1/MWh");
    expect(local.formatMoneyFull(100)).toBe("€85.10");
    expect(local.formatMoneyFull(0.01, 4)).toBe("€0.0085");
    expect(dollar.formatMoneyConcise(100)).toBe("$100");
    expect(formatMoneyConcise(100)).toBe("$100");
  });
});
