import gameReducer, { buildTransmissionLine, setTradingPolicy } from "./Game";
import { getTimeFromTimeline } from "../helpers/DateTime";
import { createGame } from "../testing/Simulator";

describe("transmission actions", () => {
  it("builds one valid California corridor and charges the down payment", () => {
    const game = createGame({ scenarioId: 100, seed: 61 });
    const before = getTimeFromTimeline(game.date.minute, game.timeline)!.cash;
    getTimeFromTimeline(game.date.minute, game.timeline)!.cash = 1000000000;
    const next = gameReducer(
      game,
      buildTransmissionLine({
        corridorId: "california-north",
        financed: true,
      }),
    );
    expect(next.transmission?.lines).toHaveLength(1);
    expect(next.transmission?.lines[0]).toMatchObject({
      corridorId: "california-north",
      yearsToBuildLeft: 1,
      financed: true,
    });
    expect(getTimeFromTimeline(next.date.minute, next.timeline)!.cash).toBe(
      1000000000 - 180000000 * 0.2,
    );
    const duplicate = gameReducer(
      next,
      buildTransmissionLine({
        corridorId: "california-north",
        financed: true,
      }),
    );
    expect(duplicate.transmission?.lines).toHaveLength(1);
    expect(Number.isFinite(before)).toBe(true);
  });

  it("updates the trading rule", () => {
    const game = createGame({ scenarioId: 100, seed: 61 });
    const next = gameReducer(game, setTradingPolicy("RELIABILITY_FIRST"));
    expect(next.transmission?.tradingPolicy).toBe("RELIABILITY_FIRST");
  });
});
