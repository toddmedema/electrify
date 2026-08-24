import * as React from "react";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { produce } from "immer";
import Finances from "./Finances";
import { createGame } from "../../testing/Simulator";
import { tickState } from "../../reducers/Game";
import { GameType, SpeedType } from "../../Types";

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
// it -- so the summary underneath, which is totalled over exactly the same months, stands in
function summarised(label: string): string {
  const row = screen.getByRole("row", { name: new RegExp(`^${label} `) });
  return within(row).getAllByRole("cell")[1].textContent || "";
}

async function choose(select: HTMLElement, option: string) {
  await userEvent.click(select);
  await userEvent.click(await screen.findByRole("option", { name: option }));
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

function renderFinances(game: GameType, speed: SpeedType) {
  return render(
    <Finances game={{ ...game, speed }} onDelta={() => undefined} />,
  );
}

describe("the Finances chart selectors", () => {
  // Two years in, so that the period select has past years to offer and each one covers a
  // different stretch of the history
  const game = playMonths(26);

  beforeEach(() => localStorage.clear());

  // Every speed, because the pane skips frames at FAST and used to skip the player's own clicks
  // along with them: the dropdown redrew itself with the new label while the chart kept plotting
  // the old metric, which looks exactly like a selector that does nothing
  it.each(["PAUSED", "SLOW", "NORMAL", "FAST"] as SpeedType[])(
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

  it.each(["PAUSED", "SLOW", "NORMAL", "FAST"] as SpeedType[])(
    "keeps the metric dropdown showing what is plotted at %s speed",
    async (speed: SpeedType) => {
      renderFinances(game, speed);

      await choose(metricSelect(), "Revenue");
      await choose(metricSelect(), "Expenses");

      expect(metricSelect()).toHaveTextContent("Expenses");
      expect(plottedMetric()).toContain("Expenses");
    },
  );

  it.each(["PAUSED", "SLOW", "NORMAL", "FAST"] as SpeedType[])(
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
});
