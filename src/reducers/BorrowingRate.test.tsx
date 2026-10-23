import cloneDeep from "lodash.clonedeep";
import { GENERATORS, STORAGE } from "../data/Facilities";
import {
  intertieBuildQuote,
  intertieUpgradeQuote,
} from "../helpers/Transmission";
import { accessContextForGame } from "../data/IntertieAccess";
import { getTimeFromTimeline } from "../helpers/DateTime";
import { createGame } from "../testing/Simulator";
import gameReducer, {
  buildFacility,
  buildTransmissionLine,
  upgradeTransmissionLine,
} from "./Game";

describe("borrowing while paused", () => {
  it.each(["generator", "storage"] as const)(
    "reprices consecutive %s loans without advancing time",
    (kind) => {
      const before = createGame({ scenarioId: 100, seed: 61 });
      before.speed = "PAUSED";
      before.facilities = [];
      const facility =
        kind === "generator"
          ? GENERATORS(before, 50000000, [20], [500]).find(
              (g) => g.available && g.name === "Natural Gas CC",
            )!
          : STORAGE(before, 50000000)[0];
      const now = getTimeFromTimeline(before.date.minute, before.timeline)!;
      now.cash = facility.buildCost * 0.6;
      now.netWorth = now.cash;
      const first = gameReducer(
        before,
        buildFacility({ facility, financed: true }),
      );
      expect(first.facilities).toHaveLength(1);
      expect(first.interestRate).toBeGreaterThan(before.interestRate);
      expect(first.facilities[0].interestRate).toBe(before.interestRate);
      expect(
        getTimeFromTimeline(first.date.minute, first.timeline)!.interestRate,
      ).toBe(first.interestRate);
      const second = gameReducer(
        first,
        buildFacility({ facility, financed: true }),
      );
      expect(second.facilities).toHaveLength(2);
      expect(second.interestRate).toBeGreaterThan(first.interestRate);
      expect(second.facilities.find((f) => f.id === 2)!.interestRate).toBe(
        first.interestRate,
      );
      expect(second.facilities.find((f) => f.id === 1)!.interestRate).toBe(
        before.interestRate,
      );
      expect(second.date).toEqual(before.date);
      expect(second.speed).toBe("PAUSED");
      expect(second.monthlyHistory).toEqual(before.monthlyHistory);
    },
  );

  it("reprices an intertie build and upgrade immediately", () => {
    const before = createGame({ scenarioId: 100, seed: 61 });
    before.speed = "PAUSED";
    before.facilities = [];
    const corridorId = "california-north";
    const quote = intertieBuildQuote(
      corridorId,
      before.date.year,
      1,
      accessContextForGame(before),
    )!;
    const now = getTimeFromTimeline(before.date.minute, before.timeline)!;
    now.cash = quote.buildCost * 0.6;
    now.netWorth = now.cash;
    const built = gameReducer(
      before,
      buildTransmissionLine({ corridorId, financed: true }),
    );
    expect(built.interestRate).toBeGreaterThan(before.interestRate);
    expect(built.transmission!.lines[0].interestRate).toBe(before.interestRate);
    expect(
      getTimeFromTimeline(built.date.minute, built.timeline)!.interestRate,
    ).toBe(built.interestRate);

    const ready = cloneDeep(built);
    ready.transmission!.lines[0].yearsToBuildLeft = 0;
    const upgrade = intertieUpgradeQuote(
      ready.transmission!.lines[0],
      ready.date.year,
      1,
      1,
      accessContextForGame(ready),
    )!;
    expect(
      getTimeFromTimeline(ready.date.minute, ready.timeline)!.cash,
    ).toBeGreaterThan(upgrade.buildCost * 0.2);
    const upgraded = gameReducer(
      ready,
      upgradeTransmissionLine({ corridorId, financed: true }),
    );
    expect(upgraded.transmission!.lines[0].upgrade).toBeDefined();
    expect(upgraded.interestRate).toBeGreaterThan(built.interestRate);
    expect(upgraded.transmission!.lines[0].interestRate).toBe(
      built.interestRate,
    );
    expect(
      getTimeFromTimeline(upgraded.date.minute, upgraded.timeline)!
        .interestRate,
    ).toBe(upgraded.interestRate);
    expect(upgraded.date).toEqual(before.date);
  });
});
