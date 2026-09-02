import * as React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createNextState as produce } from "@reduxjs/toolkit";
import Finances from "./Finances";
import { createGame } from "../../testing/Simulator";
import { tickState } from "../../reducers/Game";
import { GameType } from "../../Types";

/**
 * The Finances metric picker on a screen wide enough for small multiples, where the dropdown is
 * replaced by a tile per headline metric. Its own file because the choice is made by measuring
 * the window, and a module mock is the only way to be a desktop in jsdom - the sibling suite
 * covers the same pane at phone width, where the dropdown is still the right control.
 */

jest.setTimeout(30000);

jest.mock("../../Globals", () => ({
  ...jest.requireActual("../../Globals"),
  isDesktopScreen: () => true,
}));

jest.mock("../base/GameCard", () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}));
jest.mock("../base/ManualLink", () => ({
  __esModule: true,
  default: () => null,
}));

const user = userEvent.setup({ delay: null });

// jsdom never lays the chart out, so uPlot never builds: the accessible name of its root is the
// only thing that says which series was passed down. The tiles are images too, and say so
function plottedMetric(): string {
  const chart = screen
    .getAllByRole("img")
    .find(
      (el: HTMLElement) =>
        !(el.getAttribute("aria-label") || "").endsWith("trend"),
    );
  return chart?.getAttribute("aria-label") || "";
}

// By label rather than by role and name: asking for a button by its accessible name makes
// testing-library compute one for every button on the pane, which costs about a second a call
function tile(label: string): HTMLElement {
  return screen.getByLabelText(`Plot ${label}`);
}

function playMonths(months: number): GameType {
  let state = createGame({ scenarioId: 100 });
  while (state.date.monthsElapsed < months) {
    state = produce(state, (draft: GameType) => {
      tickState(draft);
    });
  }
  return state;
}

function renderFinances(game: GameType) {
  render(
    <Finances
      game={game}
      selectedFacilityId={null}
      onDelta={() => undefined}
    />,
  );
}

describe("the Finances small multiples", () => {
  const game = playMonths(14);

  beforeEach(() => localStorage.clear());

  it("draws a tile per headline metric instead of the dropdown", () => {
    renderFinances(game);

    [
      "Profit",
      "Revenue",
      "Expenses",
      "CO2e emitted",
      "Customers",
      "Cash",
    ].forEach((label: string) => {
      expect(tile(label)).toBeInTheDocument();
    });
    // Only the period select is left: the metric one is what the tiles replaced
    expect(screen.getAllByRole("combobox")).toHaveLength(1);
  });

  it("promotes the tile that is clicked to the chart, and says which one that is", async () => {
    renderFinances(game);
    expect(plottedMetric()).toContain("Profit");
    expect(tile("Profit")).toHaveAttribute("aria-pressed", "true");

    await user.click(tile("Revenue"));
    expect(plottedMetric()).toContain("Revenue");
    expect(tile("Revenue")).toHaveAttribute("aria-pressed", "true");
    expect(tile("Profit")).toHaveAttribute("aria-pressed", "false");

    // The second change is the one a render throttle would swallow, and picking a metric is a
    // direct request rather than something the game clock did
    await user.click(tile("Cash"));
    expect(plottedMetric()).toContain("Cash");
  });

  it("remembers the metric across a remount, the way the dropdown did", async () => {
    const view = render(
      <Finances
        game={game}
        selectedFacilityId={null}
        onDelta={() => undefined}
      />,
    );
    await user.click(tile("Expenses"));
    view.unmount();

    renderFinances(game);
    expect(plottedMetric()).toContain("Expenses");
    expect(tile("Expenses")).toHaveAttribute("aria-pressed", "true");
  });

  /**
   * The dropdown offers every metric, including the breakdowns that aren't headline enough for a
   * tile of their own -- so a player who chose one on a phone has to be able to see it here.
   */
  it("adds a tile for a metric chosen elsewhere", () => {
    localStorage.setItem("financesChartKey", "expensesFuel");

    renderFinances(game);
    expect(plottedMetric()).toContain("Fuel");
    expect(tile("Fuel")).toHaveAttribute("aria-pressed", "true");
  });
});
