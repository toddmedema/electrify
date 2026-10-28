import { createGame } from "../testing/Simulator";
import { getDateFromMinute, MINUTES_PER_MONTH } from "./DateTime";
import { winterizationPrice } from "./Winterization";

it("prices targeted protection by capacity and fuel in 2020 dollars, independent of difficulty", () => {
  for (const difficulty of ["Intern", "CEO"] as const) {
    const game = createGame({ scenarioId: 107, difficulty });
    game.date = getDateFromMinute(36 * MINUTES_PER_MONTH, 2017);
    expect(
      winterizationPrice({ fuel: "Natural Gas", peakW: 100e6 }, game),
    ).toBe(300000);
    expect(winterizationPrice({ fuel: "Coal", peakW: 100e6 }, game, true)).toBe(
      200000,
    );
    expect(winterizationPrice({ fuel: "Uranium", peakW: 100e6 }, game)).toBe(
      300000,
    );
    expect(winterizationPrice({ fuel: "Wind", peakW: 100e6 }, game)).toBe(
      6200000,
    );
    expect(winterizationPrice({ fuel: "Sun", peakW: 100e6 }, game)).toBe(0);
  }
});
