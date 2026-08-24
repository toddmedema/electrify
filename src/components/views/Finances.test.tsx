import { parseRange, projectMonths } from "./Finances";
import { MINUTES_PER_MONTH, summarizeTimeline } from "../../helpers/DateTime";
import { GameType, MonthlyHistoryType } from "../../Types";
import { createGame } from "../../testing/Simulator";

function aGame(): GameType {
  return createGame({ scenarioId: 103 });
}

describe("parseRange", () => {
  it("should follow the clock rather than pinning the year it was chosen in", () => {
    expect(parseRange("current", 2050)).toEqual({ mode: "year", year: 2050 });
  });

  it("should read a year the game has been to as that year", () => {
    expect(parseRange("2032", 2050)).toEqual({ mode: "year", year: 2032 });
  });

  it("should read the forward ranges as horizons", () => {
    expect(parseRange("next1", 2050)).toEqual({ mode: "future", years: 1 });
    expect(parseRange("next20", 2050)).toEqual({ mode: "future", years: 20 });
  });

  it("should treat all time as its own mode", () => {
    expect(parseRange("all", 2050)).toEqual({ mode: "all" });
  });

  /**
   * The range is remembered in local storage, so a returning player can arrive with a value from
   * a build that offered something this one doesn't. Falling back beats charting NaN months.
   */
  it("should fall back to the current year for anything it doesn't recognise", () => {
    expect(parseRange("next7", 2050)).toEqual({ mode: "year", year: 2050 });
    expect(parseRange("sometime", 2050)).toEqual({ mode: "year", year: 2050 });
    expect(parseRange("", 2050)).toEqual({ mode: "year", year: 2050 });
  });
});

describe("projectMonths", () => {
  const monthsAhead = (game: GameType, ahead: number) =>
    projectMonths(
      game,
      game.timeline[0].cash,
      game.timeline[0].customers,
      ahead,
    );

  it("should return the current month plus the months asked for", () => {
    const game = aGame();
    // A year, five years and twenty years, the horizons the dropdown offers
    expect(monthsAhead(game, 12).length).toEqual(13);
    expect(monthsAhead(game, 60).length).toEqual(61);
    expect(monthsAhead(game, 240).length).toEqual(241);
  });

  it("should only project the current month when nothing is ahead of it", () => {
    const game = aGame();
    const months = monthsAhead(game, 0);
    expect(months.length).toEqual(1);
    expect(months[0]).toEqual(
      summarizeTimeline(game.timeline, game.startingYear),
    );
  });

  it("should run consecutive months, rolling the year over as it goes", () => {
    const game = aGame();
    const months = monthsAhead(game, 26);
    const indexes = months.map(
      (m: MonthlyHistoryType) => m.year * 12 + m.month,
    );
    expect(indexes).toEqual(indexes.map((_, i: number) => indexes[0] + i));
    expect(months[months.length - 1].year - months[0].year).toEqual(2);
  });

  /**
   * The forecast starts at the current minute, part way through a month, so its first and last
   * buckets cover only part of one. Drawing either would put a false trough on the chart.
   */
  it("should drop the partial months at both ends of the forecast", () => {
    const game = aGame();
    const projected = monthsAhead(game, 24).slice(1);
    const wholeMonth = summarizeTimeline(game.timeline, game.startingYear);

    // Demand runs to a seasonal shape rather than a flat line, so months differ from each other
    // -- but never by the order of magnitude a half-counted one would
    projected.forEach((m: MonthlyHistoryType) => {
      expect(m.demandWh).toBeGreaterThan(wholeMonth.demandWh * 0.5);
    });
  });

  it("should carry cash forward across the horizon rather than holding it flat", () => {
    const game = aGame();
    const months = monthsAhead(game, 60);
    const cash = months.map((m: MonthlyHistoryType) => m.cash);
    expect(new Set(cash).size).toBeGreaterThan(1);
  });

  it("should start where the live timeline's own month does", () => {
    const game = aGame();
    const months = monthsAhead(game, 12);
    expect(Math.floor(game.date.minute / MINUTES_PER_MONTH)).toEqual(
      Math.floor(game.timeline[0].minute / MINUTES_PER_MONTH),
    );
    expect(months[0].month).toEqual(game.date.monthNumber);
  });
});
