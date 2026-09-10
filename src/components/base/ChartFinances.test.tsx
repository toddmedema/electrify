import { MINUTES_PER_MONTH } from "../../helpers/DateTime";
import { financeXTicks, financeXValue } from "./ChartFinances";

describe("finance chart x values", () => {
  it("converts its absolute month index to Insights' game-minute scale", () => {
    expect(financeXValue({ month: 2020 * 12 + 3 }, 2020)).toBe(
      2 * MINUTES_PER_MONTH,
    );
    expect(financeXValue({ month: 2025 * 12 + 3 }, 2020)).toBe(
      62 * MINUTES_PER_MONTH,
    );
  });
});

describe("finance chart x ticks", () => {
  it("uses month-sized units when Insights plots on the game-minute scale", () => {
    const ticks = financeXTicks([0, 20 * 12 * MINUTES_PER_MONTH], true);

    expect(ticks.length).toBeLessThanOrEqual(6);
    expect(ticks.every((tick) => tick % MINUTES_PER_MONTH === 0)).toBe(true);
  });
});
