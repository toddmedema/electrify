import * as React from "react";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { produce } from "immer";
import Finances, { getComparison, parseRange, projectMonths } from "./Finances";
import { createGame } from "../../testing/Simulator";
import { tickState } from "../../reducers/Game";
import { MINUTES_PER_MONTH, summarizeTimeline } from "../../helpers/DateTime";
import { GameType, MonthlyHistoryType, SpeedType } from "../../Types";

// Every test in here plays a couple of game years and then renders the real pane, chart and all.
// The slowest now runs in about a second -- see `choose` and `summarised` for where the rest of
// it went -- so nothing should come near this. Kept well clear of the default only because
// nothing here waits on anything, which makes a ceiling this high a hang detector rather than
// something a loaded machine can trip
jest.setTimeout(30000);

// The card chrome is connected to the store and hides its children until a game is running, none
// of which this is about. A plain wrapper puts the pane's own contents straight into the document
jest.mock("../base/GameCard", () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}));

/**
 * The "Plotting <metric> for <period>" selectors are the only way to ask the Finances chart for
 * anything other than this year's profit, and both of them live in component state rather than on
 * the game. That makes them the one part of this pane that a render throttle can silently eat, so
 * these drive the real selects and assert against what the chart was actually handed.
 */

// jsdom never lays the chart out, so uPlot never builds; the accessible name of the chart's root
// is the only thing that says which series was passed down, and it is what a screen reader gets
function plottedMetric(): string {
  return screen.getByRole("img").getAttribute("aria-label") || "";
}

function metricSelect(): HTMLElement {
  return screen.getAllByRole("combobox")[0];
}

function periodSelect(): HTMLElement {
  return screen.getAllByRole("combobox")[1];
}

// The period select doesn't reach the chart's accessible name -- it changes which months are in
// it -- so the summary underneath, which is totalled over exactly the same months, stands in.
// Found by its label cell rather than by the row's accessible name: asking for a row by name
// makes testing-library compute one for every row in the table, which costs over a second a call
function summarised(label: string): string {
  const labelCell = screen.getByText(label, { selector: "td" });
  return labelCell.nextElementSibling?.textContent || "";
}

// `delay: null` drops the timer userEvent otherwise waits on between the events of a click.
// There are roughly forty clicks in this file and nothing in the pane is waiting on a timer, so
// that wait was most of what the suite spent its time on
const user = userEvent.setup({ delay: null });

// Found by text inside the open listbox rather than by accessible name, for the same reason
// `summarised` is: asking for an option by name makes testing-library compute one for every
// option in the list, at over a second a call. The role query for the listbox itself carries no
// name, so it stays cheap
async function choose(select: HTMLElement, option: string) {
  await user.click(select);
  const listbox = await screen.findByRole("listbox");
  await user.click(within(listbox).getByText(option));
}

// Carbon Fee: a twelve year scenario, so a couple of years in it is still running and none of the
// end of game machinery (dialogs, high scores) fires while the pane is under test
function playMonths(months: number): GameType {
  let state = createGame({ scenarioId: 100 });
  while (state.date.monthsEllapsed < months) {
    state = produce(state, (draft: GameType) => {
      tickState(draft);
    });
  }
  return state;
}

function renderFinances(
  game: GameType,
  speed: SpeedType,
  selectedFacilityId: number | null = null,
) {
  return render(
    <Finances
      game={{ ...game, speed }}
      selectedFacilityId={selectedFacilityId}
      onDelta={() => undefined}
    />,
  );
}

describe("the Finances chart selectors", () => {
  // Two years in, so that the period select has past years to offer and each one covers a
  // different stretch of the history
  const game = playMonths(26);

  beforeEach(() => localStorage.clear());

  // PAUSED covers the unthrottled path and FAST covers the frame-skipping path that used to
  // swallow the player's own clicks. SLOW and NORMAL exercise the same branches as FAST.
  it.each(["PAUSED", "FAST"] as SpeedType[])(
    "replots when the metric changes at %s speed",
    async (speed: SpeedType) => {
      renderFinances(game, speed);
      expect(plottedMetric()).toContain("Profit");

      await choose(metricSelect(), "Revenue");
      expect(plottedMetric()).toContain("Revenue");

      // The second change is the one the throttle used to swallow: the first update after mount
      // always got through, and everything after it waited on the game clock
      await choose(metricSelect(), "Net Worth");
      expect(plottedMetric()).toContain("Net Worth");

      await choose(metricSelect(), "Demand");
      expect(plottedMetric()).toContain("Demand");
    },
  );

  it.each(["PAUSED", "FAST"] as SpeedType[])(
    "keeps the metric dropdown showing what is plotted at %s speed",
    async (speed: SpeedType) => {
      renderFinances(game, speed);

      await choose(metricSelect(), "Revenue");
      await choose(metricSelect(), "Expenses");

      expect(metricSelect()).toHaveTextContent("Expenses");
      expect(plottedMetric()).toContain("Expenses");
    },
  );

  it.each(["PAUSED", "FAST"] as SpeedType[])(
    "replots when the period changes at %s speed",
    async (speed: SpeedType) => {
      renderFinances(game, speed);
      const thisYear = summarised("Revenue");

      await choose(periodSelect(), "All time");
      expect(periodSelect()).toHaveTextContent("All time");
      const allTime = summarised("Revenue");
      // Two years of revenue against this year's, so they cannot agree
      expect(allTime).not.toEqual(thisYear);

      // And back again, which is the change the throttle used to swallow
      await choose(periodSelect(), "Current year");
      expect(periodSelect()).toHaveTextContent("Current year");
      expect(summarised("Revenue")).toEqual(thisYear);
    },
  );

  it("remembers the metric across a remount, dropdown and chart together", async () => {
    const view = renderFinances(game, "PAUSED");
    await choose(metricSelect(), "Net Worth");
    view.unmount();

    renderFinances(game, "PAUSED");
    expect(metricSelect()).toHaveTextContent("Net Worth");
    expect(plottedMetric()).toContain("Net Worth");
  });

  // A remount is what going off to build a facility and coming back amounts to, and the period
  // is the half of the pair that used to snap back to the current year on the way in
  it("remembers the period across a remount", async () => {
    const view = renderFinances(game, "PAUSED");
    await choose(periodSelect(), "All time");
    const allTime = summarised("Revenue");
    view.unmount();

    renderFinances(game, "PAUSED");
    expect(periodSelect()).toHaveTextContent("All time");
    expect(summarised("Revenue")).toEqual(allTime);
  });

  // Each game offers only the years it has reached, so one left over from a longer game has to
  // be dropped rather than left selected on a year the dropdown cannot even list
  it("falls back to the current year when the stored one predates this game", () => {
    localStorage.setItem("financesChartYear", "2099");

    renderFinances(game, "PAUSED");
    expect(periodSelect()).toHaveTextContent("Current year");
  });

  // The sentinels the dropdown used to store its two non-year options as. They aren't options
  // any more, and a returning player has one of them sitting in storage
  it.each(["-1", "0"])(
    "falls back to the current year when storage holds the old %s sentinel",
    (stored: string) => {
      localStorage.setItem("financesChartYear", stored);

      renderFinances(game, "PAUSED");
      expect(periodSelect()).toHaveTextContent("Current year");
    },
  );

  it("plots further than the game has reached when a forward range is chosen", async () => {
    renderFinances(game, "PAUSED");
    const thisYear = summarised("Revenue");

    await choose(periodSelect(), "Next 5 years");
    expect(periodSelect()).toHaveTextContent("Next 5 years");
    // Five years of projected revenue against the part of this year already played
    expect(summarised("Revenue")).not.toEqual(thisYear);

    await choose(periodSelect(), "Current year");
    expect(summarised("Revenue")).toEqual(thisYear);
  });

  it("remembers a forward range across a remount", async () => {
    const view = renderFinances(game, "PAUSED");
    await choose(periodSelect(), "Next 20 years");
    const projected = summarised("Revenue");
    view.unmount();

    renderFinances(game, "PAUSED");
    expect(periodSelect()).toHaveTextContent("Next 20 years");
    expect(summarised("Revenue")).toEqual(projected);
  });
});

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
    const game = createGame({ scenarioId: 103 });
    // A year, five years and twenty years, the horizons the dropdown offers
    expect(monthsAhead(game, 12).length).toEqual(13);
    expect(monthsAhead(game, 60).length).toEqual(61);
    expect(monthsAhead(game, 240).length).toEqual(241);
  });

  it("should only project the current month when nothing is ahead of it", () => {
    const game = createGame({ scenarioId: 103 });
    const months = monthsAhead(game, 0);
    expect(months.length).toEqual(1);
    expect(months[0]).toEqual(
      summarizeTimeline(game.timeline, game.startingYear),
    );
  });

  it("should run consecutive months, rolling the year over as it goes", () => {
    const game = createGame({ scenarioId: 103 });
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
    const game = createGame({ scenarioId: 103 });
    const projected = monthsAhead(game, 24).slice(1);
    const wholeMonth = summarizeTimeline(game.timeline, game.startingYear);

    // Demand runs to a seasonal shape rather than a flat line, so months differ from each other
    // -- but never by the order of magnitude a half-counted one would
    projected.forEach((m: MonthlyHistoryType) => {
      expect(m.demandWh).toBeGreaterThan(wholeMonth.demandWh * 0.5);
    });
  });

  it("should carry cash forward across the horizon rather than holding it flat", () => {
    const game = createGame({ scenarioId: 103 });
    const months = monthsAhead(game, 60);
    const cash = months.map((m: MonthlyHistoryType) => m.cash);
    expect(new Set(cash).size).toBeGreaterThan(1);
  });

  it("should start where the live timeline's own month does", () => {
    const game = createGame({ scenarioId: 103 });
    const months = monthsAhead(game, 12);
    expect(Math.floor(game.date.minute / MINUTES_PER_MONTH)).toEqual(
      Math.floor(game.timeline[0].minute / MINUTES_PER_MONTH),
    );
    expect(months[0].month).toEqual(game.date.monthNumber);
  });
});

/**
 * The change column, which is what turns a table of totals into something scannable: a
 * profit of "-$51.4K" says nothing on its own about whether the company is recovering.
 */
describe("the month over month column", () => {
  const game = playMonths(26);

  // The change sits in the row's third cell, past the label and the period total. Both role
  // queries go without a `name`, which is what keeps them cheap over a table this size
  function changeCell(label: string): HTMLElement {
    const row = screen
      .getAllByRole("row")
      .find((r: HTMLElement) =>
        r.textContent?.startsWith(label),
      ) as HTMLElement;
    return within(row).getAllByRole("cell")[2];
  }

  function toneOf(label: string): string {
    const cell = changeCell(label);
    if (cell.className.includes("good")) {
      return "good";
    }
    return cell.className.includes("bad") ? "bad" : "flat";
  }

  /**
   * The game with a two month record of its own making, so a test can say which way a
   * number moved instead of asking the simulation what it happened to do.
   */
  function withChange(changes: Partial<MonthlyHistoryType>): GameType {
    const previous = game.monthlyHistory[1];
    return {
      ...game,
      // Newest first, the order the game itself keeps
      monthlyHistory: [{ ...previous, ...changes }, previous],
    };
  }

  it("compares the month just closed against the one before it", () => {
    const comparison = getComparison(game);
    const [latest, previous] = game.monthlyHistory;
    expect(comparison).toBeDefined();
    expect(comparison?.label).toBeTruthy();
    expect(comparison?.current.revenue).toEqual(latest.revenue);
    expect(comparison?.previous.revenue).toEqual(previous.revenue);
  });

  it("has nothing to compare against in a company's first month", () => {
    const newborn = createGame({ scenarioId: 100 });
    expect(newborn.monthlyHistory).toHaveLength(0);
    expect(getComparison(newborn)).toBeUndefined();
    // And one month on the record is still one month short of a comparison
    expect(
      getComparison({
        ...newborn,
        monthlyHistory: [game.monthlyHistory[0]],
      }),
    ).toBeUndefined();
  });

  it("puts the change beside each total once there are two months on the record", () => {
    renderFinances(game, "PAUSED");
    const comparison = getComparison(game);
    expect(screen.getByText(comparison?.label || "")).toBeInTheDocument();
    // Every metric gets one, even if it is the em dash that means it hasn't moved
    expect(changeCell("Profit").textContent).not.toEqual("");
    expect(changeCell("Revenue").textContent).not.toEqual("");
  });

  // Both point up, so the arrow alone can't tell these apart -- and colouring a rise in
  // spending the same green as a rise in earnings would be exactly backwards
  it("reads a rise in revenue as good news and a rise in an expense as bad", () => {
    renderFinances(withChange({ revenue: 0 }), "PAUSED");
    expect(toneOf("Revenue")).toEqual("bad");

    cleanup();
    const previous = game.monthlyHistory[1];
    renderFinances(
      withChange({
        revenue: previous.revenue * 1.5,
        expensesFuel: previous.expensesFuel * 1.5,
      }),
      "PAUSED",
    );
    expect(toneOf("Revenue")).toEqual("good");
    expect(toneOf("Fuel")).toEqual("bad");
    expect(toneOf("Expenses")).toEqual("bad");
  });

  it("says nothing about a month that came in where the last one did", () => {
    renderFinances(withChange({}), "PAUSED");
    expect(toneOf("Revenue")).toEqual("flat");
    expect(changeCell("Revenue").textContent).toEqual("—");
  });

  it("reports what a selected facility has contributed, and nothing when none is", () => {
    renderFinances(game, "PAUSED", null);
    expect(screen.queryByText(/of your fleet/)).toBeNull();

    cleanup();
    renderFinances(game, "PAUSED", game.facilities[0].id);
    expect(
      screen.getByText(game.facilities[0].name, { selector: "strong" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/of your fleet/)).toBeInTheDocument();
  });
});
