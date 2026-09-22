import { configureStore } from "@reduxjs/toolkit";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import * as React from "react";
import { Provider } from "react-redux";
import cloneDeep from "lodash.clonedeep";
import { MINUTES_PER_MONTH, getTimeFromTimeline } from "../../helpers/DateTime";
import gameReducer, {
  buildTransmissionLine,
  tickState,
  upgradeTransmissionLine,
} from "../../reducers/Game";
import { formatWatts } from "../../helpers/Format";
import uiReducer from "../../reducers/UI";
import { createGame } from "../../testing/Simulator";
import { FacilityOperatingType, GameType } from "../../Types";
import Facilities from "./Facilities";
import TransmissionPanel from "./TransmissionPanel";
import { TRANSMISSION_CORRIDORS } from "../../data/AdjacentMarkets";

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
  onSell: jest.Mock;
}

function renderFacilities(
  game: GameType,
  selectedFacilityId: number | null,
): Handlers {
  const handlers: Handlers = {
    onPause: jest.fn(),
    onSelect: jest.fn(),
    onReprioritize: jest.fn(),
    onSell: jest.fn(),
  };
  const store = configureStore({ reducer: { ui: uiReducer } });
  function ControlledFacilities() {
    const [selected, setSelected] = React.useState(selectedFacilityId);
    return (
      <Facilities
        game={game}
        selectedFacilityId={selected}
        onGeneratorBuild={() => undefined}
        onTransmissionUpgrade={() => undefined}
        onStorageBuild={() => undefined}
        onTransmissionBuild={() => undefined}
        onTradingPolicy={() => undefined}
        onSell={handlers.onSell}
        onTogglePause={() => undefined}
        onPause={handlers.onPause}
        onReprioritize={handlers.onReprioritize}
        onFacilityDragStart={() => undefined}
        onFacilityDragEnd={() => undefined}
        onSelect={(id) => {
          handlers.onSelect(id);
          setSelected(id);
        }}
      />
    );
  }
  render(<ControlledFacilities />, {
    wrapper: ({ children }) => <Provider store={store}>{children}</Provider>,
  });
  return handlers;
}

// The row is the drag handle as well as the select target, so it is addressed by its own class
// rather than by a role -- and asking testing-library for a role by name computes an accessible
// name for every candidate, which over a rendered pane costs about a second a call
function rows(): HTMLElement[] {
  return Array.from(
    document.querySelectorAll<HTMLElement>(".facilityRow .facilityDisclosure"),
  );
}

describe("the fleet list", () => {
  // Long enough that both generators have a record worth reporting in an expanded row
  const game = playedGame(60);

  it.each([
    [-500000, "charging"],
    [500000, "discharging"],
  ])(
    "keeps storage activity aligned with %s W on mount and selection",
    async (currentW, label) => {
      const storageGame = createGame({ scenarioId: 100 });
      storageGame.facilities = [
        {
          ...storageGame.facilities[0],
          name: "Battery",
          peakWh: 2000000,
          currentWh: 1000000,
          peakW: 1000000,
          currentW: Number(currentW),
          yearsToBuildLeft: 0,
          paused: false,
        },
      ];
      renderFacilities(storageGame, null);
      expect(rows()[0]).toHaveTextContent(String(label));
      expect(rows()[0]).toHaveAccessibleName(
        `Inspect Battery, 1/2MWh · ${label}`,
      );
      await user.click(rows()[0]);
      expect(rows()[0]).toHaveTextContent(String(label));
      expect(rows()[0]).toHaveAccessibleName(
        `Inspect Battery, 1/2MWh · ${label}`,
      );
    },
  );

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
    expect(screen.getByText("Avg output")).toBeInTheDocument();
    expect(screen.getByText("Lifetime cost per MWh")).toBeInTheDocument();
    expect(screen.getByText("Revenue per MWh")).toBeInTheDocument();
  });

  it("shows Coal starts and cost", () => {
    const coal = game.facilities.find((facility) => facility.name === "Coal")!;
    renderFacilities(game, coal.id);

    expect(screen.getByText("Starts")).toBeInTheDocument();
    expect(screen.getByText("Non-fuel start cost")).toBeInTheDocument();
  });

  it("shows Oil fixed and variable O&M without turbine start details", () => {
    const oilGame = createGame({ scenarioId: 101, difficulty: "CEO" });
    const oil = oilGame.facilities.find((facility) => facility.name === "Oil")!;
    renderFacilities(oilGame, oil.id);

    expect(screen.getByText("Fixed upkeep")).toBeInTheDocument();
    expect(screen.getByText("$3.09M/yr")).toBeInTheDocument();
    expect(screen.getByText("Variable upkeep")).toBeInTheDocument();
    expect(screen.getByText("$25.71/MWh")).toBeInTheDocument();
    expect(screen.queryByText("Starts")).toBeNull();
    expect(screen.queryByText("Non-fuel start cost")).toBeNull();
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
          facilityOutputMultipliersByFuel: { [facility.fuel!]: 0.5 },
        },
      },
    ];
    renderFacilities(constrained, null);
    expect(screen.getByText("30% limit")).toBeInTheDocument();
    expect(
      screen.getByLabelText("Temporarily limited to 30% of rated output"),
    ).toBeInTheDocument();
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
    const { onReprioritize } = renderFacilities(game, game.facilities[1].id);
    await user.click(
      screen.getByLabelText(
        `Move ${game.facilities[1].name} earlier in the dispatch order`,
      ),
    );
    expect(onReprioritize).toHaveBeenCalledWith(1, -1);
    await user.click(
      screen.getByRole("button", {
        name: `Inspect ${game.facilities[0].name}`,
      }),
    );

    await user.click(
      screen.getByLabelText(
        `Move ${game.facilities[0].name} later in the dispatch order`,
      ),
    );
    expect(onReprioritize).toHaveBeenCalledWith(0, 1);
  });

  it("offers no way to move the ends of the list past themselves", async () => {
    renderFacilities(game, game.facilities[0].id);
    const last = game.facilities.length - 1;
    expect(
      screen.getByLabelText(
        `Move ${game.facilities[0].name} earlier in the dispatch order`,
      ),
    ).toBeDisabled();
    await user.click(
      screen.getByRole("button", {
        name: `Inspect ${game.facilities[last].name}`,
      }),
    );
    expect(
      screen.getByLabelText(
        `Move ${game.facilities[last].name} later in the dispatch order`,
      ),
    ).toBeDisabled();
  });

  it("does not select the row when a row action is used", async () => {
    const { onSelect } = renderFacilities(game, game.facilities[1].id);
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
      onTransmissionBuild: () => undefined,
      onTransmissionUpgrade: () => undefined,
      onTradingPolicy: () => undefined,
      onSell: () => undefined,
      onTogglePause: () => undefined,
      onPause: () => undefined,
      onReprioritize: () => undefined,
      onFacilityDragStart,
      onFacilityDragEnd,
      onSelect: () => undefined,
    };
    render(
      <Provider store={configureStore({ reducer: { ui: uiReducer } })}>
        <Facilities {...props} ref={ref} />
      </Provider>,
    );

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
    await user.click(
      screen.getByRole("button", { name: `Inspect ${facility.name}` }),
    );

    await user.click(screen.getByLabelText(`Pause ${facility.name}`));
    expect(onPause).toHaveBeenCalledWith(facility.id, facility.name);
  });

  it("can sell the only facility left in a fleet", async () => {
    const onePlant = createGame({ scenarioId: 5 });
    const { onSell } = renderFacilities(onePlant, onePlant.facilities[0].id);
    const facility = onePlant.facilities[0];

    await user.click(screen.getByLabelText(`Sell ${facility.name}`));
    await user.click(screen.getByRole("button", { name: "Sell" }));

    expect(onSell).toHaveBeenCalledWith(facility.id);
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

function renderProjects(game: GameType, onBuild = jest.fn()) {
  return render(
    <Provider store={configureStore({ reducer: { ui: uiReducer } })}>
      <TransmissionPanel
        game={game}
        projectsOnly
        onBuild={onBuild}
        onUpgrade={jest.fn()}
        onPolicy={jest.fn()}
      />
    </Provider>,
  );
}

describe("the interties view", () => {
  it("explains and offers California connection projects", async () => {
    const game = playedGame(0);
    renderProjects(game);
    expect(
      screen.queryByText("Share power with nearby grids"),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Connection projects")).not.toBeInTheDocument();
    expect(screen.getByText("Pacific Northwest")).toBeInTheDocument();
    expect(screen.queryByLabelText("Trading rule")).toBeNull();
    expect(
      screen.getAllByRole("button", { name: /Review purchase of .* intertie/ }),
    ).not.toHaveLength(0);
    expect(screen.getAllByText("Total cost")).toHaveLength(2);
    expect(
      screen.getByText(/Pay \$36M now · finance \$144M/),
    ).toBeInTheDocument();
  });

  it("tells the neighbours apart by kind, typical year, peak help and price", async () => {
    renderProjects(playedGame(0));
    const north = screen.getByTestId("transmission-project-california-north");
    const south = screen.getByTestId("transmission-project-california-south");
    expect(within(north).getByText("Seasonal hydro")).toBeInTheDocument();
    expect(within(south).getByText("Solar surplus")).toBeInTheDocument();
    expect(within(north).getByText("Existing corridor")).toBeInTheDocument();
    // Neighbour character and the typical year are comparison material, so they sit behind the
    // same disclosure the generator and storage cards use.
    for (const card of [north, south]) {
      await user.click(
        within(card).getByRole("button", { name: /^Show .* details$/ }),
      );
    }
    for (const card of [north, south]) {
      expect(
        within(card).getByRole("img", { name: /^Typical year of import room/ }),
      ).toBeInTheDocument();
      expect(
        within(card).getByText(/^Typical year · Low \w{3} \d+%$/),
      ).toBeInTheDocument();
      expect(within(card).getByText("At your peak")).toBeInTheDocument();
      expect(within(card).getByText(/^~\d+% of line$/)).toBeInTheDocument();
      expect(within(card).getByText(/^\$\d+–\d+\/MWh$/)).toBeInTheDocument();
    }
    expect(
      within(south).getByText("Cheapest midday · priciest evening"),
    ).toBeInTheDocument();

    await user.click(
      screen.getByRole("button", {
        name: "Review purchase of Desert Southwest intertie",
      }),
    );
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent(/Import room~\d+% at your peak/);
    expect(dialog).toHaveTextContent(/Neighbor price\$\d+–\d+\/MWh/);
    expect(dialog).toHaveTextContent("cheapest connected neighbor first");
    expect(dialog).not.toHaveTextContent("backup is not guaranteed");
  });

  it("keeps every earlier tutorial focused on plants", () => {
    for (const scenarioId of [0, 1, 2, 4, 3, 5]) {
      renderFacilities(createGame({ scenarioId }), null);
      expect(screen.queryByRole("tablist")).toBeNull();
      expect(screen.queryByText("Interties")).toBeNull();
      cleanup();
    }
  });

  it("shows one list and one build action in Mission 7", () => {
    renderFacilities(createGame({ scenarioId: 112 }), null);
    expect(screen.queryByRole("tablist")).toBeNull();
    expect(screen.getByRole("button", { name: "Build" })).toBeInTheDocument();
    expect(screen.getByText(/Plants & storage/)).toBeInTheDocument();
    expect(screen.getByText(/Interties/)).toBeInTheDocument();
  });

  it("does not render an empty interties destination where no corridor exists", () => {
    const game = createGame({ scenarioId: 103 });
    game.location = { ...game.location, id: "HNL", name: "Honolulu, HI" };
    renderFacilities(game, null);

    expect(screen.queryByRole("tablist")).toBeNull();
    expect(screen.queryByText(/Interties are coming/)).toBeNull();
  });

  it("shows researched local market names outside California", async () => {
    const game = createGame({ scenarioId: 103 });
    game.location = { ...game.location, id: "Dublin", name: "Dublin" };
    renderProjects(game);

    expect(screen.getByText("Great Britain")).toBeInTheDocument();
    expect(screen.getByText("Continental Europe")).toBeInTheDocument();
  });

  it("gives the guided northern approval a stable target and specific name", async () => {
    renderProjects(createGame({ scenarioId: 112 }));

    const approval = screen.getByRole("button", {
      name: "Review purchase of Pacific Northwest intertie",
    });
    expect(approval).toHaveAttribute("id", "review-intertie-california-north");
    expect(
      screen.getByTestId("transmission-project-california-north"),
    ).toHaveAttribute("data-corridor-id", "california-north");
    expect(screen.queryByText("Desert Southwest")).toBeNull();
  });

  it("reviews and cancels before committing a financed intertie", async () => {
    const onBuild = jest.fn();
    renderProjects(createGame({ scenarioId: 112 }), onBuild);
    const review = screen.getByRole("button", {
      name: "Review purchase of Pacific Northwest intertie",
    });
    await user.click(review);
    expect(onBuild).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toHaveTextContent("Loan option");
    await user.click(screen.getByRole("button", { name: "close" }));
    expect(onBuild).not.toHaveBeenCalled();
    await user.click(review);
    await user.click(screen.getByRole("button", { name: "Take loan" }));
    expect(onBuild).toHaveBeenCalledTimes(1);
    expect(onBuild).toHaveBeenCalledWith("california-north", true);
  });
});

describe("unified connections", () => {
  function connectedGame(): GameType {
    const game = playedGame(0);
    game.transmission!.lines = TRANSMISSION_CORRIDORS.filter((corridor) =>
      corridor.id.startsWith("california-"),
    ).map((corridor, i) => ({
      id: i + 1,
      corridorId: corridor.id,
      name: corridor.name,
      capacityW: corridor.capacityW,
      buildCost: corridor.buildCost,
      annualOperatingCost: corridor.annualOperatingCost,
      yearsToBuildLeft: i,
      minuteCreated: game.date.minute,
      financed: true,
      loanAmountLeft: 1000,
      loanMonthlyPayment: 10,
      interestRate: game.interestRate,
    }));
    return game;
  }

  it("keeps connections outside dispatch and reports network flow only once", async () => {
    const game = connectedGame();
    renderFacilities(game, null);
    expect(rows()).toHaveLength(game.facilities.length);
    // These assertions inspect the drag-library boundary, which has no accessible role.
    /* eslint-disable testing-library/no-node-access */
    const connections = document.querySelectorAll(".transmissionLine");
    expect(connections).toHaveLength(2);
    expect(document.querySelectorAll(".tradingControls")).toHaveLength(1);
    expect(connections[0].querySelector("[data-rfd-draggable-id]")).toBeNull();
    /* eslint-enable testing-library/no-node-access */
    // A built line reports the power actually moving over it, signed, instead of a static
    // "Connected" that never changes
    expect(connections[0]).toHaveTextContent(/0\/500MW/);
    expect(connections[0]).not.toHaveTextContent("Connected");
    expect(connections[1]).toHaveTextContent("Building");
    await user.click(screen.getByText(game.transmission!.lines[0].name));
    expect(
      screen.getByRole("button", {
        name: `Inspect ${game.transmission!.lines[0].name}, no power flowing`,
      }),
    ).toHaveAttribute("aria-expanded", "true");
    expect(connections[0]).toHaveTextContent("Loan balance");
    // The connected line reports what it can do right now beside its typical year
    expect(connections[0]).toHaveTextContent(/Price now\$\d+/);
    expect(connections[0]).toHaveTextContent(/Can import now.+ of /);
    expect(connections[0]).toHaveTextContent(/Typical price\$\d+–\d+\/MWh/);
    expect(connections[0]).toHaveTextContent("At your peak");
    expect(connections[0]).toHaveTextContent("Purchased emissions");
    expect(
      within(connections[0] as HTMLElement).getByRole("img", {
        name: /^Typical year of import room/,
      }),
    ).toBeInTheDocument();
  });

  it("shows a building line's outlook without claiming it can import yet", async () => {
    const game = connectedGame();
    renderFacilities(game, null);
    await user.click(screen.getByText(game.transmission!.lines[1].name));
    // eslint-disable-next-line testing-library/no-node-access
    const building = document.querySelectorAll(".transmissionLine")[1];
    expect(building).toHaveTextContent("Power can flow when construction");
    expect(building).not.toHaveTextContent("Can import now");
    expect(building).toHaveTextContent("Typical price");
  });

  it("permits inspecting replay connections but disables trading and building", async () => {
    const game = connectedGame();
    game.replayPlayback = {
      actions: [],
      index: 0,
    } as GameType["replayPlayback"];
    renderFacilities(game, null);
    expect(screen.queryByRole("button", { name: "Build" })).toBeNull();
    expect(screen.getByText("No power flowing")).toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "Trading rule" })).toBeNull();
    expect(
      screen.getByText("Trading rule: Buy for shortages, sell extra"),
    ).toBeInTheDocument();
  });
});

describe("the intertie upgrade control", () => {
  /** A California run whose northern intertie is open and carrying power. */
  function gameWithOpenIntertie(): GameType {
    const state = playedGame(0);
    const built = cloneDeep(
      gameReducer(
        state,
        buildTransmissionLine({
          corridorId: "california-north",
          financed: false,
        }),
      ),
    );
    built.transmission!.lines[0].yearsToBuildLeft = 0;
    getTimeFromTimeline(built.date.minute, built.timeline)!.cash = 1e11;
    return built;
  }

  function renderFleet(game: GameType, handleUpgrade = jest.fn()) {
    render(
      <Provider store={configureStore({ reducer: { ui: uiReducer } })}>
        <TransmissionPanel
          game={game}
          onBuild={jest.fn()}
          onUpgrade={handleUpgrade}
          onPolicy={jest.fn()}
        />
      </Provider>,
    );
  }

  it("offers to widen an open line, and says what the work emits", async () => {
    const user = userEvent.setup();
    const game = gameWithOpenIntertie();
    const handleUpgrade = jest.fn();
    renderFleet(game, handleUpgrade);
    const line = game.transmission!.lines[0];

    await user.click(
      screen.getByLabelText(`Inspect ${line.name}`, { exact: false }),
    );
    const upgrade = screen.getByLabelText(
      `Upgrade ${line.name} to ${formatWatts(line.capacityW * 1.5, 3)}`,
    );
    // The embodied cost of the work is on the button's own row, where the decision is made,
    // rather than somewhere the player has to go looking for it.
    expect(screen.getByText(/CO2e to build/)).toBeInTheDocument();
    await user.click(upgrade);
    expect(handleUpgrade).not.toHaveBeenCalled();
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent("Interest rate:");
    expect(dialog).toHaveTextContent("Upkeep after upgrade");
    await user.click(within(dialog).getByRole("button", { name: "Take loan" }));
    expect(handleUpgrade).toHaveBeenCalledWith(line.corridorId, true);
  });

  it("lets the player cancel or pay cash for an upgrade", async () => {
    const user = userEvent.setup();
    const game = gameWithOpenIntertie();
    const handleUpgrade = jest.fn();
    renderFleet(game, handleUpgrade);
    await user.click(
      screen.getByLabelText(`Inspect ${game.transmission!.lines[0].name}`, {
        exact: false,
      }),
    );
    await user.click(screen.getByRole("button", { name: /^Upgrade / }));
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: "close" }),
    );
    expect(handleUpgrade).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: /^Upgrade / }));
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Pay cash",
      }),
    );
    expect(handleUpgrade).toHaveBeenCalledWith(
      game.transmission!.lines[0].corridorId,
      false,
    );
  });

  it("says the line keeps running while the work is under way", async () => {
    const user = userEvent.setup();
    const game = cloneDeep(
      gameReducer(
        gameWithOpenIntertie(),
        upgradeTransmissionLine({
          corridorId: "california-north",
          financed: false,
        }),
      ),
    );
    renderFleet(game);
    const line = game.transmission!.lines[0];
    await user.click(
      screen.getByLabelText(`Inspect ${line.name}`, { exact: false }),
    );
    expect(screen.getByText(/keeps carrying/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/^Upgrade /)).toBeNull();
  });

  it("explains which ceiling stopped it rather than just disappearing", async () => {
    const user = userEvent.setup();
    const game = gameWithOpenIntertie();
    // Three steps taken already: the corridor is full.
    game.transmission!.lines[0].capacityW *= Math.pow(1.5, 3);
    renderFleet(game);
    const line = game.transmission!.lines[0];
    await user.click(
      screen.getByLabelText(`Inspect ${line.name}`, { exact: false }),
    );
    expect(screen.getByText(/corridor is full/)).toBeInTheDocument();
  });
});
