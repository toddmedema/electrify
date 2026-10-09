import { configureStore } from "@reduxjs/toolkit";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
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
import uiReducer from "../../reducers/UI";
import { createGame } from "../../testing/Simulator";
import {
  EvidenceRequestType,
  FacilityOperatingType,
  GameType,
} from "../../Types";
import Facilities from "./Facilities";
import TransmissionPanel from "./TransmissionPanel";
import * as transmission from "../../helpers/Transmission";
import { TRANSMISSION_CORRIDORS } from "../../data/AdjacentMarkets";
import { SCENARIOS } from "../../data/Scenarios";
import {
  COLD_DEFINITION_ID,
  HAIL_DEFINITION_ID,
  retrofitCost,
} from "../../helpers/Hazards";
import { formatMoneyConcise } from "../../helpers/Format";

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

beforeAll(() => {
  // jsdom has no viewport scrolling; actual selection scrolling is verified in Playwright.
  Element.prototype.scrollIntoView = jest.fn();
});
afterAll(() => {
  delete (Element.prototype as Partial<Element>).scrollIntoView;
});

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
  onRetrofit: jest.Mock;
  onCancelRetrofit: jest.Mock;
}

function renderFacilities(
  game: GameType,
  selectedFacilityId: number | null,
  fleetView: "grid" | "dispatch" = "dispatch",
  initialEvidenceRequest?: EvidenceRequestType,
): Handlers & { rerenderGame: (next: GameType, runId?: number) => void } {
  const handlers: Handlers = {
    onPause: jest.fn(),
    onSelect: jest.fn(),
    onReprioritize: jest.fn(),
    onSell: jest.fn(),
    onRetrofit: jest.fn(),
    onCancelRetrofit: jest.fn(),
  };
  const store = configureStore({ reducer: { ui: uiReducer } });
  function ControlledFacilities({
    state,
    runId = 0,
  }: {
    state: GameType;
    runId?: number;
  }) {
    const [selected, setSelected] = React.useState(selectedFacilityId);
    const [evidenceRequest, setEvidenceRequest] = React.useState(
      initialEvidenceRequest,
    );
    return (
      <Facilities
        game={state}
        feedbackRunId={runId}
        evidenceRequest={evidenceRequest}
        onEvidenceReady={(_request, element) => {
          element?.focus();
          setEvidenceRequest(undefined);
        }}
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
        onRetrofit={handlers.onRetrofit}
        onCancelRetrofit={handlers.onCancelRetrofit}
        onFacilityDragStart={() => undefined}
        onFacilityDragEnd={() => undefined}
        onSelect={(id) => {
          handlers.onSelect(id);
          setSelected(id);
        }}
      />
    );
  }
  const view = render(<ControlledFacilities state={game} />, {
    wrapper: ({ children }) => <Provider store={store}>{children}</Provider>,
  });
  const dispatchView = screen.queryByRole("button", {
    name: "Dispatch",
  });
  if (dispatchView && fleetView === "dispatch") fireEvent.click(dispatchView);
  return {
    ...handlers,
    rerenderGame: (next, runId) =>
      view.rerender(<ControlledFacilities state={next} runId={runId} />),
  };
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

  it.each(["grid", "dispatch"] as const)(
    "announces commissioning once across views, preserving paused operation in %s",
    (fleetView) => {
      const building = createGame({ scenarioId: 100 });
      building.facilities[0].yearsToBuildLeft = 1;
      building.facilities[0].paused = true;
      const { rerenderGame } = renderFacilities(building, null, fleetView);
      expect(screen.queryByText(/^Commissioned/)).toBeNull();
      const completed = cloneDeep(building);
      completed.facilities[0].yearsToBuildLeft = 0;
      rerenderGame(completed);
      expect(screen.getByText(/^Commissioned/)).toBeVisible();
      expect(
        screen.getByText(
          `${completed.facilities[0].name}: construction complete. Operation is paused.`,
        ),
      ).toHaveAttribute("role", "status");
      expect(screen.getAllByRole("status")).toHaveLength(1);
      fireEvent.click(
        screen.getByRole("button", {
          name: fleetView === "grid" ? "Dispatch" : "Grid",
        }),
      );
      expect(
        screen.getAllByText("Commissioned", { exact: false }),
      ).toHaveLength(1);
      expect(screen.getAllByRole("status")).toHaveLength(1);
      fireEvent.click(screen.getByRole("button", { name: "Grid" }));
      fireEvent.click(
        screen.getAllByRole("button", { name: /^Inspect .* in grid/ })[0],
      );
      expect(screen.getAllByRole("status")).toHaveLength(1);
      cleanup();
      renderFacilities(completed, null, fleetView);
      expect(screen.queryByText(/^Commissioned/)).toBeNull();
    },
  );

  it.each(["grid", "dispatch"] as const)(
    "does not announce replay commissioning in %s",
    (fleetView) => {
      const game = createGame({ scenarioId: 100 });
      game.facilities[0].yearsToBuildLeft = 1;
      game.replayPlayback = { actions: [], index: 0 };
      const { rerenderGame } = renderFacilities(game, null, fleetView);
      const completed = cloneDeep(game);
      completed.facilities[0].yearsToBuildLeft = 0;
      rerenderGame(completed);
      expect(screen.queryByText(/Commissioned/)).toBeNull();
      expect(screen.getByRole("status")).toBeEmptyDOMElement();
    },
  );

  it("clears observed cues when another save loads into the same pane", () => {
    const game = createGame({ scenarioId: 100 });
    game.facilities[0].yearsToBuildLeft = 1;
    const { rerenderGame } = renderFacilities(game, null, "grid");
    const completed = cloneDeep(game);
    completed.facilities[0].yearsToBuildLeft = 0;
    rerenderGame(completed);
    expect(screen.getByText(/Commissioned/)).toBeVisible();
    rerenderGame(completed, 1);
    expect(screen.queryByText(/Commissioned/)).toBeNull();
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
  });

  it("keeps supply and demand evidence mounted and focused after acknowledging a request from Grid", () => {
    renderFacilities(game, null, "grid", {
      id: 1,
      runId: 0,
      target: "supply-demand",
    });
    expect(screen.getByLabelText("Supply and demand")).toHaveFocus();
    expect(screen.getByRole("button", { name: "Dispatch" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(
      screen.queryByRole("region", { name: "Live power grid" }),
    ).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Grid" }));
    expect(
      screen.getByRole("region", { name: "Live power grid" }),
    ).toBeVisible();
  });

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
          // Turn the scenario's generator into storage rather than build a full fixture
        } as unknown as FacilityOperatingType,
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
    // Rise of Renewables opens in 2002, so the 2023-dollar EIA figures are deflated by CPI-U
    // (179.9 / 304.702): $3.09M/yr and $25.71/MWh become $1.82M/yr and $15.18/MWh.
    const oilGame = createGame({ scenarioId: 101, difficulty: "CEO" });
    const oil = oilGame.facilities.find((facility) => facility.name === "Oil")!;
    renderFacilities(oilGame, oil.id);

    expect(screen.getByText("Fixed upkeep")).toBeInTheDocument();
    expect(screen.getByText("$1.82M/yr")).toBeInTheDocument();
    expect(screen.getByText("Variable upkeep")).toBeInTheDocument();
    expect(screen.getByText("$15.18/MWh")).toBeInTheDocument();
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

  it("omits move buttons from expanded actions", () => {
    renderFacilities(game, game.facilities[1].id);
    expect(
      screen.queryByRole("button", {
        name: /earlier in the dispatch order|later in the dispatch order/,
      }),
    ).toBeNull();
  });

  it("scrolls live wheel input with its units while preserving zoom and edge gestures", () => {
    const initial = cloneDeep(game);
    initial.speed = "NORMAL";
    initial.facilities[0].currentW = initial.facilities[0].peakW;
    const noop = () => undefined;
    const props: React.ComponentProps<typeof Facilities> = {
      game: initial,
      selectedFacilityId: null,
      onGeneratorBuild: noop,
      onStorageBuild: noop,
      onTransmissionBuild: noop,
      onTransmissionUpgrade: noop,
      onTradingPolicy: noop,
      onSell: noop,
      onTogglePause: noop,
      onPause: noop,
      onReprioritize: noop,
      onFacilityDragStart: noop,
      onFacilityDragEnd: noop,
      onSelect: noop,
    };
    const store = configureStore({ reducer: { ui: uiReducer } });
    const pane = (nextGame = initial) => (
      <React.StrictMode>
        <Provider store={store}>
          <Facilities {...props} game={nextGame} />
        </Provider>
      </React.StrictMode>
    );
    const { rerender, unmount } = render(pane());
    fireEvent.click(screen.getByRole("button", { name: "Dispatch" }));
    const list = screen.getByRole("list");
    list.style.overflowY = "auto";
    list.style.lineHeight = "24px";
    Object.defineProperties(list, {
      clientHeight: { value: 200 },
      scrollHeight: { value: 800 },
    });
    const status = screen.getByRole("button", {
      name: /^Inspect Natural Gas CC/,
    });
    const wheel = (options: WheelEventInit) => {
      const event = new WheelEvent("wheel", {
        bubbles: true,
        cancelable: true,
        ...options,
      });
      status.dispatchEvent(event);
      return event;
    };
    expect(wheel({ deltaY: 120 }).defaultPrevented).toBe(true);
    expect(list.scrollTop).toBe(120);
    wheel({ deltaY: 2, deltaMode: WheelEvent.DOM_DELTA_LINE });
    expect(list.scrollTop).toBe(168);
    wheel({ deltaY: 1, deltaMode: WheelEvent.DOM_DELTA_PAGE });
    expect(list.scrollTop).toBe(368);
    list.scrollTop = 600;
    expect(wheel({ deltaY: 100 }).defaultPrevented).toBe(false);
    expect(wheel({ deltaY: -100, ctrlKey: true }).defaultPrevented).toBe(false);
    expect(wheel({ deltaY: -100, metaKey: true }).defaultPrevented).toBe(false);
    expect(wheel({ deltaY: -100, shiftKey: true }).defaultPrevented).toBe(
      false,
    );
    expect(wheel({ deltaY: -100, cancelable: false }).defaultPrevented).toBe(
      false,
    );
    expect(list.scrollTop).toBe(600);
    wheel({ deltaY: -500 });
    expect(list.scrollTop).toBe(100);

    const latest = cloneDeep(initial);
    latest.date.minute += 15;
    latest.facilities[0].currentW = 0;
    rerender(pane(latest));
    expect(status).toHaveTextContent("idle");
    expect(list.scrollTop).toBe(100);
    unmount();
    expect(wheel({ deltaY: 100 }).defaultPrevented).toBe(false);
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
      ref.current!.shouldComponentUpdate(
        {
          ...props,
          game: {
            ...fast,
            date: { ...fast.date, minute: fast.date.minute + 1_000 },
          },
        },
        ref.current!.state,
      ),
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
    expect(
      ref.current!.shouldComponentUpdate(
        { ...props, game },
        ref.current!.state,
      ),
    ).toBe(true);
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

describe("weather hazards in the fleet", () => {
  // Game minutes per real day: a representative game month stands for a real month.
  const DAY = MINUTES_PER_MONTH / (365 / 12);

  // Carbon Fee plus a standing solar farm, eligible for hail because it is not a tutorial
  function gameWithSolar(): GameType {
    const state = createGame({ scenarioId: 100 });
    const template = state.facilities[0];
    state.facilities.push({
      ...cloneDeep(template),
      id: 3,
      name: "Solar",
      fuel: "Sun",
      resilience: { hailResistant: false },
    } as FacilityOperatingType);
    return state;
  }

  function hailOn(state: GameType, availableFraction: number, days: number) {
    state.worldEvents.active.push({
      key: `hail:${state.location.id}:0:f3`,
      definitionId: HAIL_DEFINITION_ID,
      startsMinute: state.date.minute,
      endsMinute: state.date.minute + Math.floor(days * DAY),
      attributes: { hazard: "HAIL", facilityId: 3 },
      effects: { facilityOutputMultipliersById: { "3": availableFraction } },
    });
  }

  it.each(["grid", "dispatch"] as const)(
    "identifies weather recovery without claiming output in %s",
    (fleetView) => {
      const state = gameWithSolar();
      hailOn(state, 0.72, 9);
      const { rerenderGame } = renderFacilities(state, null, fleetView);
      expect(screen.queryByText("Outage ended")).toBeNull();
      const repaired = cloneDeep(state);
      repaired.worldEvents.active = [];
      repaired.facilities[2].paused = true;
      rerenderGame(repaired);
      expect(screen.getByText(/Outage ended/)).toBeVisible();
      expect(
        screen.getByText("Solar: weather outage ended. Operation is paused."),
      ).toHaveAttribute("role", "status");
    },
  );

  it("shows an upgrading plant's progress and lets the player cancel it", async () => {
    const state = gameWithSolar();
    const gas = state.facilities.find((f) => f.fuel === "Natural Gas")!;
    (gas as { upgradeInProgress?: object }).upgradeInProgress = {
      upgrade: "coldWeatherPackage",
      cost: 1e6,
      startsMinute: state.date.minute - MINUTES_PER_MONTH / 2,
      completesMinute: state.date.minute + MINUTES_PER_MONTH / 2,
    };
    const { onCancelRetrofit } = renderFacilities(state, gas.id);
    const gasRow = rows().find((row) =>
      row.getAttribute("aria-label")?.startsWith(`Inspect ${gas.name}`),
    )!;
    expect(gasRow).toHaveTextContent("Upgrading 50%");
    expect(gasRow).toHaveTextContent("cold-weather package, 16 days left");
    // The only plant out of service, so the only progress bar on the pane. The bar is
    // aria-hidden (the percentage is in the text), so there is no role to query it by.
    // eslint-disable-next-line testing-library/no-node-access
    const fills = document.querySelectorAll(".constructionProgressFill");
    expect(fills).toHaveLength(1);
    expect(fills[0]).toHaveStyle({ width: "50%" });
    expect(
      screen.queryByRole("button", { name: `Pause ${gas.name}` }),
    ).toBeNull();
    await user.click(
      screen.getByRole("button", { name: `Cancel upgrade of ${gas.name}` }),
    );
    expect(onCancelRetrofit).toHaveBeenCalledWith(gas.id);
  });

  it("leads a hail-damaged row with the outage instead of a generic limit chip", () => {
    const state = gameWithSolar();
    hailOn(state, 0.72, 9);
    renderFacilities(state, null);

    const lead = screen.getByTitle(
      "Hail damage · 72% available · 9 days to repair",
    );
    expect(lead).toHaveTextContent(
      "Hail damage · 72% available · 9 days to repair",
    );
    expect(screen.getByText("Hail · 72% · 9d")).toBeInTheDocument();
    expect(screen.queryByText("72% limit")).toBeNull();
    const solarRow = rows().find((row) =>
      row.getAttribute("aria-label")?.startsWith("Inspect Solar"),
    );
    expect(solarRow).toHaveAttribute(
      "aria-label",
      "Inspect Solar, Hail damage, 72% available, 9 days to repair",
    );
  });

  it("leads a cold-derated gas row with the month-long outage and no limit chip", () => {
    const state = gameWithSolar();
    const gas = state.facilities.find((f) => f.fuel === "Natural Gas")!;
    state.worldEvents.active.push({
      key: `cold:${state.location.id}:0`,
      definitionId: COLD_DEFINITION_ID,
      startsMinute: state.date.minute,
      endsMinute: state.date.minute + MINUTES_PER_MONTH,
      attributes: { hazard: "EXTREME_COLD" },
      effects: {
        facilityOutputMultipliersById: { [String(gas.id)]: 0.55 },
      },
    });
    renderFacilities(state, null);

    expect(screen.getByTitle("Extreme cold · 55% available")).toHaveTextContent(
      "Extreme cold · 55% available",
    );
    expect(screen.getByText("Cold · 55%")).toBeInTheDocument();
    expect(screen.queryByText("55% limit")).toBeNull();
    const gasRow = rows().find((row) =>
      row.getAttribute("aria-label")?.startsWith(`Inspect ${gas.name}`),
    );
    expect(gasRow).toHaveAttribute(
      "aria-label",
      `Inspect ${gas.name}, Extreme cold, 55% available`,
    );
  });

  it("offers hail-resistant panels from the details and confirms before paying", async () => {
    const state = gameWithSolar();
    const cost = retrofitCost(state.facilities[2], state, "hailResistant")!;
    const { onRetrofit, onSelect } = renderFacilities(state, 3);

    const details = screen.getByRole("region", { name: "Upgrades" });
    expect(details).not.toHaveTextContent("Standard panels");
    await user.click(
      within(details).getByRole("button", {
        name: `Add hail-resistant panels · ${formatMoneyConcise(cost)}`,
      }),
    );
    const dialog = screen.getByRole("dialog", {
      name: "Add hail-resistant panels to Solar?",
    });
    expect(dialog).not.toHaveTextContent("cash now");
    await user.click(
      within(dialog).getByRole("button", {
        name: `Pay ${formatMoneyConcise(cost)}`,
      }),
    );
    expect(onRetrofit).toHaveBeenCalledWith({
      facilityId: 3,
      upgrade: "hailResistant",
    });
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("shows a replay's hardening without offering to buy any", () => {
    const state = {
      ...gameWithSolar(),
      replayPlayback: { actions: [], index: 0 },
    } as GameType;
    state.facilities[2].resilience = { hailResistant: true };
    renderFacilities(state, 3);
    const details = screen.getByRole("region", { name: "Upgrades" });
    expect(details).not.toHaveTextContent("Standard panels");
    expect(within(details).queryByRole("button")).toBeNull();
  });
});

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
    const north = screen.getByTestId("transmission-project-california-north");
    await user.click(
      within(north).getByRole("button", { name: /^Show .* details$/ }),
    );
    expect(within(north).queryByText("Down payment")).not.toBeInTheDocument();
    await user.click(
      within(north).getByRole("button", { name: /Review purchase/ }),
    );
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent("$10.8M");
    expect(dialog).toHaveTextContent("Loan option");
    expect(dialog).toHaveTextContent("Payments start now");
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
        within(card).getByText(/^Low \w{3} [\d.]+MW$/),
      ).toBeInTheDocument();
      expect(within(card).getByText("At your peak")).toBeInTheDocument();
      expect(within(card).getByText(/^~[\d.]+MW$/)).toBeInTheDocument();
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
    expect(dialog).toHaveTextContent("Ready in 36 months.");
    expect(dialog).not.toHaveTextContent("Portfolio outlook");
    expect(dialog).not.toHaveTextContent("Typical price");
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

  it("hides the empty interties section while keeping the build action in Mission 7", () => {
    renderFacilities(createGame({ scenarioId: 112 }), null);
    expect(screen.queryByRole("tablist")).toBeNull();
    expect(screen.getByRole("button", { name: "Build" })).toBeInTheDocument();
    expect(screen.queryByText(/Plants & storage/)).toBeNull();
    expect(screen.queryByText(/Interties/)).toBeNull();
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
    game.date = { ...game.date, year: 2024 };
    renderProjects(game);

    expect(screen.getByText("Great Britain")).toBeInTheDocument();
    expect(screen.getByText("Continental Europe")).toBeInTheDocument();
  });

  it("lists connections whose real path had not been built yet", () => {
    const game = createGame({ scenarioId: 103 });
    game.location = { ...game.location, id: "Dublin", name: "Dublin" };
    game.date = { ...game.date, year: 2008 };
    renderProjects(game);

    expect(screen.getByText("Continental Europe")).toBeInTheDocument();
    expect(screen.queryByText("Great Britain")).toBeNull();
    expect(
      screen.getByText("Opens later: Great Britain in 2012"),
    ).toBeInTheDocument();
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

  it("sorts current-tier quotes by time, price and import emissions", async () => {
    const quote = transmission.intertieBuildQuote;
    const mock = jest
      .spyOn(transmission, "intertieBuildQuote")
      .mockImplementation((...args) => {
        const result = quote(...args);
        if (!result) return result;
        // Make price order differ from time/emissions and reverse it at higher tiers.
        const cheap = args[2] === 1 ? "california-south" : "california-north";
        return { ...result, buildCost: result.id === cheap ? 1e6 : 2e6 };
      });
    try {
      renderProjects(createGame({ scenarioId: 111 }));
      const first = () => screen.getAllByTestId(/^transmission-project-/)[0];
      expect(first()).toHaveAttribute("data-corridor-id", "california-north");
      const select = async (label: string) => {
        await user.click(
          screen.getByRole("button", { name: /^Sort interties:/ }),
        );
        await user.click(screen.getByRole("menuitem", { name: label }));
      };
      expect(
        screen.getByRole("button", { name: "Sort interties: Fastest" }),
      ).toBeInTheDocument();
      await select("Cheapest");
      expect(first()).toHaveAttribute("data-corridor-id", "california-south");
      fireEvent.change(screen.getByRole("slider"), { target: { value: 2 } });
      expect(first()).toHaveAttribute("data-corridor-id", "california-north");
      fireEvent.change(screen.getByRole("slider"), { target: { value: 1 } });
      expect(first()).toHaveAttribute("data-corridor-id", "california-south");
      await select("Lowest emissions");
      expect(first()).toHaveAttribute("data-corridor-id", "california-north");
      await select("Fastest");
      expect(first()).toHaveAttribute("data-corridor-id", "california-north");
    } finally {
      mock.mockRestore();
    }
  });
  it("updates capacity and purchase quote when selecting a larger tier", async () => {
    const onBuild = jest.fn();
    renderProjects(createGame({ scenarioId: 111 }), onBuild);
    const north = screen.getByTestId("transmission-project-california-north");
    const slider = screen.getByRole("slider");
    expect(north).toHaveTextContent("Import capacity4MW");
    expect(north).toHaveTextContent("Export capacity5MW");
    fireEvent.change(slider, { target: { value: 3 } });
    expect(slider).toHaveAttribute("aria-valuenow", "3");
    expect(north).not.toHaveTextContent("Line capacity");
    expect(north).toHaveTextContent("Import capacity5MW");
    expect(north).toHaveTextContent("Export capacity5MW");
    await user.click(
      within(north).getByRole("button", { name: /Review purchase/ }),
    );
    expect(screen.getByRole("dialog")).toHaveTextContent("Tier 3");
    expect(screen.getByRole("dialog")).toHaveTextContent("Import capacity5MW");
    expect(screen.getByRole("dialog")).toHaveTextContent("Export capacity5MW");
    await user.click(screen.getByRole("button", { name: "Pay cash" }));
    expect(onBuild).toHaveBeenCalledWith("california-north", false, 3);
  });

  it("reviews and cancels before committing a financed intertie", async () => {
    const onBuild = jest.fn();
    renderProjects(createGame({ scenarioId: 112 }), onBuild);
    const review = screen.getByRole("button", {
      name: "Review purchase of Pacific Northwest intertie",
    });
    await user.click(review);
    expect(onBuild).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toHaveTextContent("Payments start now");
    await user.click(screen.getByRole("button", { name: "close" }));
    expect(onBuild).not.toHaveBeenCalled();
    await user.click(review);
    await user.click(screen.getByRole("button", { name: "Take loan" }));
    expect(onBuild).toHaveBeenCalledTimes(1);
    expect(onBuild).toHaveBeenCalledWith("california-north", true, 1);
  });

  it("shows usable directional capacities in the catalog and purchase review", async () => {
    renderProjects(createGame({ scenarioId: 115 }));
    const card = screen.getByTestId(
      "transmission-project-india-bangladesh-upgrade",
    );
    expect(card).toHaveTextContent("Import capacity25MW");
    expect(card).toHaveTextContent("Export capacity70MW");
    expect(card).not.toHaveTextContent("Line capacity");
    await user.click(
      within(card).getByRole("button", { name: /Review purchase/ }),
    );
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent("Import capacity25MW");
    expect(dialog).toHaveTextContent("Export capacity70MW");
    expect(dialog).not.toHaveTextContent("100MW");
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
      currentFlowW: 0,
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
    expect(connections[0]).toHaveAttribute("data-rfd-draggable-id", "t1");
    expect(
      connections[0].querySelector(".facilityDragHandle"),
    ).toHaveAccessibleName("Reorder " + game.transmission!.lines[0].name);
    /* eslint-enable testing-library/no-node-access */
    // A built line reports the power actually moving over it, signed, instead of a static
    // "Connected" that never changes
    expect(connections[0]).toHaveTextContent(/0\/270MW/);
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
    expect(connections[0]).toHaveTextContent(/Import available now[\d.]+MW/);
    expect(connections[0]).toHaveTextContent("Import capacity270MW");
    expect(connections[0]).toHaveTextContent("Export capacity150MW");
    expect(connections[0]).toHaveTextContent(/Typical price\$\d+–\d+\/MWh/);
    expect(connections[0]).not.toHaveTextContent("At your peak");
    expect(connections[0]).toHaveTextContent("Emissions");
    expect(
      within(connections[0] as HTMLElement).getByRole("img", {
        name: /^Typical year of import room/,
      }),
    ).toBeInTheDocument();
  });

  it("shows a building line's outlook without claiming it can import yet", async () => {
    const game = connectedGame();
    game.transmission!.lines[1].minuteCreated -= 12 * MINUTES_PER_MONTH;
    renderFacilities(game, null);
    await user.click(screen.getByText(game.transmission!.lines[1].name));
    // eslint-disable-next-line testing-library/no-node-access
    const building = document.querySelectorAll(".transmissionLine")[1];
    expect(building).not.toHaveTextContent("Power can flow when construction");
    expect(building).toHaveTextContent("Building 50% · 12 months left");
    expect(building).not.toHaveTextContent("Line capacity");
    expect(building).toHaveTextContent("Import capacity180MW");
    expect(building).toHaveTextContent("Export capacity150MW");
    expect(building).toHaveTextContent("Emissions");
    expect(building).not.toHaveTextContent("Import available now");
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
    expect(screen.queryByRole("button", { name: /^Reorder / })).toBeNull();
    expect(
      screen.getByText("Trading rule: Buy for shortages, sell extra"),
    ).toBeInTheDocument();
  });
});

describe("the intertie upgrade control", () => {
  /** A California run whose northern intertie is open and carrying power. */
  function gameWithOpenIntertie(
    scenarioId = 100,
    corridorId = "california-north",
  ): GameType {
    const state = createGame({ scenarioId });
    const built = cloneDeep(
      gameReducer(
        state,
        buildTransmissionLine({
          corridorId,
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
    const upgrade = screen.getByLabelText(`Review upgrade of ${line.name}`);
    expect(screen.queryByText(/CO2e to build/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Extra import room/)).not.toBeInTheDocument();
    await user.click(upgrade);
    expect(handleUpgrade).not.toHaveBeenCalled();
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent(/Construction emits.*CO2e/);
    expect(dialog).toHaveTextContent(/for 30 years/);
    expect(dialog).toHaveTextContent("Upkeep after upgrade");
    expect(dialog).not.toHaveTextContent("Line capacity");
    expect(dialog).toHaveTextContent("Import capacity150MW → 210MW");
    expect(dialog).toHaveTextContent(
      "Export capacity150MW → 150MW · Unchanged",
    );
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
    await user.click(
      screen.getByRole("button", { name: /^Review upgrade of / }),
    );
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: "close" }),
    );
    expect(handleUpgrade).not.toHaveBeenCalled();
    await user.click(
      screen.getByRole("button", { name: /^Review upgrade of / }),
    );
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

  it("shows increased export capacity when an upgrade unlocks the fixed export allowance", async () => {
    const game = gameWithOpenIntertie(115, "india-bangladesh-upgrade");
    renderFleet(game);
    await user.click(
      screen.getByLabelText(`Inspect ${game.transmission!.lines[0].name}`, {
        exact: false,
      }),
    );
    await user.click(
      screen.getByRole("button", { name: /^Review upgrade of / }),
    );
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent("Import capacity25MW → 30MW");
    expect(dialog).toHaveTextContent("Export capacity70MW → 100MW");
    expect(dialog).not.toHaveTextContent("Unchanged");
  });

  it("shows increased directional capacities for custom-game upgrades with fixed access", async () => {
    const game = gameWithOpenIntertie();
    game.customScenario = { ...SCENARIOS.find((s) => s.id === 100)!, id: -1 };
    game.transmission!.lines[0].capacityW = 500e6;
    renderFleet(game);
    await user.click(
      screen.getByLabelText(`Inspect ${game.transmission!.lines[0].name}`, {
        exact: false,
      }),
    );
    await user.click(
      screen.getByRole("button", { name: /^Review upgrade of / }),
    );
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent("Import capacity500MW → 750MW");
    expect(dialog).toHaveTextContent("Export capacity500MW → 750MW");
    expect(within(dialog).queryAllByText(/· Unchanged$/)).toHaveLength(0);
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
    expect(
      screen.getByText(/Current capacities stay in use/),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText(/^Review upgrade of /)).toBeNull();
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
    expect(screen.getByText(/Corridor full/)).toBeInTheDocument();
  });
});
