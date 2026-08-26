import * as React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import Facilities from "./Facilities";
import { tickState } from "../../reducers/Game";
import { createGame } from "../../testing/Simulator";
import { FacilityOperatingType, GameType } from "../../Types";

// The pane renders its own supply chart, which jsdom never lays out; nothing here waits on
// anything, so a ceiling this high is a hang detector rather than something a loaded machine trips
jest.setTimeout(30000);

// The card chrome is connected to the store and hides its children until a game is running, none
// of which this is about
jest.mock("../base/GameCard", () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}));

// `delay: null` drops the timer userEvent otherwise waits on between the events of a click
const user = userEvent.setup({ delay: null });

function playedGame(ticks: number): GameType {
  // Carbon Fee, which starts with two generators - a fleet of one hides every row action, since
  // there is nothing to reorder it against and nothing to fall back on if it is paused or sold
  const state = createGame({ scenarioId: 100 });
  for (let i = 0; i < ticks; i++) {
    tickState(state);
  }
  return state;
}

interface Handlers {
  onSelect: jest.Mock;
  onReprioritize: jest.Mock;
}

function renderFacilities(
  game: GameType,
  selectedFacilityId: number | null,
): Handlers {
  const handlers: Handlers = {
    onSelect: jest.fn(),
    onReprioritize: jest.fn(),
  };
  render(
    <Facilities
      game={game}
      selectedFacilityId={selectedFacilityId}
      onGeneratorBuild={() => undefined}
      onStorageBuild={() => undefined}
      onSell={() => undefined}
      onTogglePause={() => undefined}
      onPause={() => undefined}
      onReprioritize={handlers.onReprioritize}
      onSelect={handlers.onSelect}
    />,
  );
  return handlers;
}

// The row is the drag handle as well as the select target, so it is addressed by its own class
// rather than by a role -- and asking testing-library for a role by name computes an accessible
// name for every candidate, which over a rendered pane costs about a second a call
function rows(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>(".facilityRow"));
}

describe("the fleet list", () => {
  // Long enough that both generators have a record worth reporting in an expanded row
  const game = playedGame(60);

  it("selects a facility when its row is clicked", async () => {
    const { onSelect } = renderFacilities(game, null);
    await user.click(rows()[0]);
    expect(onSelect).toHaveBeenCalledWith(game.facilities[0].id);
  });

  it("deselects when the row that is already open is clicked again", async () => {
    const { onSelect } = renderFacilities(game, game.facilities[0].id);
    await user.click(rows()[0]);
    expect(onSelect).toHaveBeenCalledWith(null);
  });

  it("shows what the selected facility has earned, and only that one", () => {
    renderFacilities(game, game.facilities[0].id);
    // One panel, not one per row -- getByText throws if a second facility opened too
    expect(screen.getByText("Lifetime profit")).toBeInTheDocument();
    expect(screen.getByText("Capacity factor")).toBeInTheDocument();
    expect(screen.getByText("Cost")).toBeInTheDocument();
    expect(screen.getByText("Earned")).toBeInTheDocument();
  });

  it("leaves every row closed when nothing is selected", () => {
    renderFacilities(game, null);
    expect(screen.queryByText("Lifetime profit")).toBeNull();
  });

  /**
   * onReprioritize was declared and passed for years without the row ever calling it: dispatch
   * order could only be changed by dragging, which is undiscoverable with a mouse and unusable
   * once the list has scrolled.
   */
  it("reorders from the row's own arrows", async () => {
    const { onReprioritize } = renderFacilities(game, null);
    await user.click(
      screen.getByLabelText(
        `Move ${game.facilities[1].name} earlier in the dispatch order`,
      ),
    );
    expect(onReprioritize).toHaveBeenCalledWith(1, -1);

    await user.click(
      screen.getByLabelText(
        `Move ${game.facilities[0].name} later in the dispatch order`,
      ),
    );
    expect(onReprioritize).toHaveBeenCalledWith(0, 1);
  });

  it("offers no way to move the ends of the list past themselves", () => {
    renderFacilities(game, null);
    const last = game.facilities.length - 1;
    expect(
      screen.getByLabelText(
        `Move ${game.facilities[0].name} earlier in the dispatch order`,
      ),
    ).toBeDisabled();
    expect(
      screen.getByLabelText(
        `Move ${game.facilities[last].name} later in the dispatch order`,
      ),
    ).toBeDisabled();
  });

  it("does not select the row when a row action is used", async () => {
    const { onSelect } = renderFacilities(game, null);
    await user.click(
      screen.getByLabelText(
        `Move ${game.facilities[1].name} earlier in the dispatch order`,
      ),
    );
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("hides the player's controls while a replay is being watched", () => {
    const replay = {
      ...game,
      replayPlayback: { actions: [], index: 0 },
    } as GameType;
    renderFacilities(replay, null);
    game.facilities.forEach((f: FacilityOperatingType) => {
      expect(
        screen.queryByLabelText(`Move ${f.name} earlier in the dispatch order`),
      ).toBeNull();
    });
  });
});
