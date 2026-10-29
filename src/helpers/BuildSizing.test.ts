import { createGame } from "../testing/Simulator";
import { corridorsForGame } from "../data/IntertieAccess";
import { intertieBuildQuote, intertieContextForGame } from "./Transmission";
import {
  DEFAULT_BUILD_SIZE,
  averageBuildSize,
  initialIntertieBuildTier,
  sliderTickToW,
  wToSliderTick,
  buildSizeOptions,
  largestAffordableBuildSize,
} from "./BuildSizing";
import { FacilityOperatingType } from "../Types";
import { purchaseTerms } from "./Financials";

describe("size slider", () => {
  it("includes exact caps and respects the minimum size", () => {
    expect(buildSizeOptions(0, 34, 4.5e6)).toEqual([1e6, 2e6, 3e6, 4e6, 4.5e6]);
    expect(buildSizeOptions(4, 37, 4e6)).toEqual([]);
  });

  it("handles downpayment boundaries, fixed costs and unaffordable minimums", () => {
    const sizes = buildSizeOptions(0, 4, 5e6);
    const quote = (size: number) => 2e6 + size;
    const cash = purchaseTerms(quote(3e6), true, 0).downpayment;
    expect(largestAffordableBuildSize(sizes, cash, quote)).toBe(3e6);
    expect(largestAffordableBuildSize(sizes, cash - 1, quote)).toBe(2e6);
    expect(largestAffordableBuildSize(sizes, 0, quote)).toBeUndefined();
    expect(largestAffordableBuildSize([], cash, quote)).toBeUndefined();
  });
  it("steps the leading digit and then the magnitude", () => {
    expect(sliderTickToW(0)).toBe(1e6);
    expect(sliderTickToW(8)).toBe(9e6);
    expect(sliderTickToW(9)).toBe(10e6);
    expect(sliderTickToW(10)).toBe(20e6);
  });

  it("round-trips every tick", () => {
    for (let tick = 0; tick <= 37; tick++) {
      expect(wToSliderTick(sliderTickToW(tick))).toBe(tick);
    }
  });

  it("rounds an exact size down to its tick", () => {
    expect(wToSliderTick(450e6)).toBe(wToSliderTick(400e6));
  });
});

describe("averageBuildSize", () => {
  const facility = (
    id: number,
    peakW: number,
    peakWh?: number,
  ): FacilityOperatingType =>
    ({ id, peakW, peakWh }) as unknown as FacilityOperatingType;

  it("averages all facilities of the requested kind", () => {
    const fleet = [
      facility(1, 100e6),
      facility(3, 50e6, 200e6),
      facility(2, 300e6),
      facility(4, 20e6, 80e6),
    ];
    expect(averageBuildSize(fleet, false)).toBe(200e6);
    expect(averageBuildSize(fleet, true)).toBe(140e6);
  });

  it("scales a first storage project to four hours of average generator output", () => {
    expect(averageBuildSize([facility(1, 100e6)], true)).toBe(400e6);
    expect(averageBuildSize([], false)).toBe(DEFAULT_BUILD_SIZE);
  });
});

it("ignores zero and invalid sizes in the starting average", () => {
  const facilities = [0, NaN, 200e6].map(
    (peakW, id) => ({ id, peakW }) as FacilityOperatingType,
  );
  expect(averageBuildSize(facilities, false)).toBe(200e6);
});

it("starts small grids at the base intertie tier and scales large grids within available limits", () => {
  const game = createGame({ scenarioId: 100 });
  game.transmission = { tradingPolicy: "BALANCED", lines: [] };
  game.facilities = [{ ...game.facilities[0], peakW: 10e6 }];
  expect(initialIntertieBuildTier(game)).toBe(1);
  game.facilities[0].peakW = 10e9;
  const tier = initialIntertieBuildTier(game);
  expect(tier).toBeGreaterThan(1);
  const context = intertieContextForGame(game);
  expect(
    corridorsForGame(game).some(({ id }) =>
      intertieBuildQuote(id, game.date.year, tier, context),
    ),
  ).toBe(true);
  expect(
    corridorsForGame(game).some(({ id }) =>
      intertieBuildQuote(id, game.date.year, tier + 1, context),
    ),
  ).toBe(false);
});
