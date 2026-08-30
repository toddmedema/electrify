import * as React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import Facilities from "./Facilities";
import { tickState } from "../../reducers/Game";
import { createGame } from "../../testing/Simulator";
import { FacilityOperatingType, GameType } from "../../Types";
import { MINUTES_PER_MONTH } from "../../helpers/DateTime";

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
  // Carbon Fee, which starts with two generators.
  const state = createGame({ scenarioId: 100 });
  for (let i = 0; i < ticks; i++) {
    tickState(state);
  }
  return state;
}

interface Handlers {
  onPause: jest.Mock;
  onSelect: jest.Mock;
  onReprioritize: jest.Mock;
}

function renderFacilities(
  game: GameType,
  selectedFacilityId: number | null,
): Handlers {
  const handlers: Handlers = {
    onPause: jest.fn(),
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
      onPause={handlers.onPause}
      onReprioritize={handlers.onReprioritize}
      onFacilityDragStart={() => undefined}
      onFacilityDragEnd={() => undefined}
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

  it("shows Coal starts and cost without gas-turbine service intervals", () => {
    const coal = game.facilities.find((facility) => facility.name === "Coal")!;
    renderFacilities(game, coal.id);

    expect(screen.getByText("Equivalent starts")).toBeInTheDocument();
    expect(screen.getByText("Non-fuel start cost")).toBeInTheDocument();
    expect(screen.queryByText("Service intervals")).toBeNull();
  });

  it("keeps gas-turbine service context on Natural Gas", () => {
    const gas = game.facilities.find(
      (facility) => facility.name === "Natural Gas",
    )!;
    renderFacilities(game, gas.id);

    expect(screen.getByText("Service intervals")).toBeInTheDocument();
    expect(
      screen.getByText("HGP 900 · major 1,800 starts"),
    ).toBeInTheDocument();
  });

  it("shows Oil fixed and variable O&M without turbine start details", () => {
    const oilGame = createGame({ scenarioId: 101, difficulty: "CEO" });
    const oil = oilGame.facilities.find((facility) => facility.name === "Oil")!;
    renderFacilities(oilGame, oil.id);

    expect(screen.getByText("Equivalent operating hours")).toBeInTheDocument();
    expect(screen.getByText("Fixed O&M")).toBeInTheDocument();
    expect(screen.getByText("$3.09M/yr")).toBeInTheDocument();
    expect(screen.getByText("Variable O&M")).toBeInTheDocument();
    expect(screen.getByText("$25.71/MWh generated")).toBeInTheDocument();
    expect(screen.queryByText("Equivalent starts")).toBeNull();
    expect(screen.queryByText("Non-fuel start cost")).toBeNull();
    expect(screen.queryByText("Service intervals")).toBeNull();
  });

  it("leaves every row closed when nothing is selected", () => {
    renderFacilities(game, null);
    expect(screen.queryByText("Lifetime profit")).toBeNull();
  });

  it("uses singular construction copy for one month remaining", () => {
    const underConstruction = createGame({ scenarioId: 100 });
    underConstruction.facilities[0].yearsToBuildLeft = 1 / 12;
    renderFacilities(underConstruction, null);

    expect(screen.getByText(/1 month left/)).toBeInTheDocument();
    expect(screen.queryByText(/1 months left/)).toBeNull();
  });

  it("labels a facility whose output is constrained by a world event", () => {
    const constrained = createGame({ scenarioId: 104 });
    const facility = constrained.facilities[0];
    constrained.worldEvents.active = [
      {
        key: "story:104:hurricane-2008:landfall",
        definitionId: "hurricane-2008:landfall",
        startsMinute: 0,
        endsMinute: MINUTES_PER_MONTH,
        attributes: {},
        effects: {
          facilityOutputMultipliersById: { [String(facility.id)]: 0.6 },
        },
      },
    ];
    renderFacilities(constrained, null);
    expect(screen.getByText("Derated to 60%")).toBeInTheDocument();
  });

  it("uses compact watt units in the accessible chart summary", () => {
    renderFacilities(game, null);

    expect(
      screen.getByRole("img", {
        name: /electricity supply and demand over the day/i,
      }),
    ).toHaveAccessibleName(/MW/);
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

  it("keeps tick renders out of an active facility drag", () => {
    const fast = { ...game, speed: "FAST" as const };
    const ref = React.createRef<Facilities>();
    const onFacilityDragStart = jest.fn();
    const onFacilityDragEnd = jest.fn();
    const props: React.ComponentProps<typeof Facilities> = {
      game: fast,
      selectedFacilityId: null,
      onGeneratorBuild: () => undefined,
      onStorageBuild: () => undefined,
      onSell: () => undefined,
      onTogglePause: () => undefined,
      onPause: () => undefined,
      onReprioritize: () => undefined,
      onFacilityDragStart,
      onFacilityDragEnd,
      onSelect: () => undefined,
    };
    render(<Facilities {...props} ref={ref} />);

    ref.current!.onBeforeDragStart();
    expect(onFacilityDragStart).toHaveBeenCalledWith("FAST");
    expect(
      ref.current!.shouldComponentUpdate({
        ...props,
        game: {
          ...fast,
          date: { ...fast.date, minute: fast.date.minute + 1_000 },
        },
      }),
    ).toBe(false);

    ref.current!.onDragEnd({
      draggableId: `f${fast.facilities[0].id}`,
      type: "DEFAULT",
      source: { droppableId: "droppable", index: 0 },
      destination: null,
      reason: "CANCEL",
      mode: "FLUID",
      combine: null,
    });
    expect(onFacilityDragEnd).toHaveBeenCalledWith(0, null, "FAST");
    expect(ref.current!.shouldComponentUpdate({ ...props, game })).toBe(true);
  });

  it("can pause the only facility in a fleet", async () => {
    const onePlant = createGame({ scenarioId: 5 });
    const { onPause } = renderFacilities(onePlant, null);
    const facility = onePlant.facilities[0];

    await user.click(screen.getByLabelText(`Pause ${facility.name}`));
    expect(onPause).toHaveBeenCalledWith(facility.id, facility.name);
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
