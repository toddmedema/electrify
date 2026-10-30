import { configureStore } from "@reduxjs/toolkit";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
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
import { FacilityOperatingType, GameType } from "../../Types";
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
import { GAME_TO_REAL_YEARS, TICKS_PER_HOUR } from "../../Constants";
import { purchaseTerms } from "../../helpers/Financials";

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
  onTogglePause: jest.Mock;
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
  ref?: React.RefObject<Facilities>,
): Handlers {
  const handlers: Handlers = {
    onTogglePause: jest.fn(),
    onPause: jest.fn(),
    onSelect: jest.fn(),
    onReprioritize: jest.fn(),
    onSell: jest.fn(),
    onRetrofit: jest.fn(),
    onCancelRetrofit: jest.fn(),
  };
  const store = configureStore({ reducer: { ui: uiReducer } });
  function ControlledFacilities() {
    const [selected, setSelected] = React.useState(selectedFacilityId);
    return (
      <Facilities
        ref={ref}
        game={game}
        selectedFacilityId={selected}
        onTransmissionUpgrade={() => undefined}
        onStorageBuild={() => undefined}
        onTransmissionBuild={() => undefined}
        onTradingPolicy={() => undefined}
        onSell={handlers.onSell}
        onTogglePause={handlers.onTogglePause}
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
  render(<ControlledFacilities />, {
    wrapper: ({ children }) => <Provider store={store}>{children}</Provider>,
  });
  return handlers;
}

// Address inspection targets by their class; asking for a role by name computes an accessible
// name for every candidate, which over a rendered pane costs about a second a call.
function rows(): HTMLElement[] {
  return Array.from(
    document.querySelectorAll<HTMLElement>(".facilityRow .facilityDisclosure"),
  );
}

describe("the fleet list", () => {
  // Long enough that both generators have a record worth reporting in an expanded row
  const game = playedGame(60);

  it.each([
    [2000, 0, 0, false, "filling"],
    [500, 0, 0, false, "draining"],
    [1000, 0, 0, false, ""],
    [2000, 1000, 0, false, "spilling"],
    [500, 0, 1000, true, "draining"],
    [500, 0, 0, true, "filling"],
  ])(
    "reports hydro water movement on mount and selection",
    async (inflow, spill, bypass, paused, label) => {
      const hydroGame = createGame({ scenarioId: 108 });
      const hydro = hydroGame.facilities.find((f) => f.fuel === "Hydro")!;
      hydroGame.facilities = [hydro];
      hydro.reservoirWh = hydro.reservoirCapacityWh! / (spill ? 1 : 2);
      hydro.currentW = (1000 * TICKS_PER_HOUR) / GAME_TO_REAL_YEARS;
      hydro.hydroLastInflowWh = Number(inflow);
      hydro.hydroLastSpillWh = Number(spill);
      hydro.hydroLastBypassWh = Number(bypass);
      hydro.paused = Boolean(paused);
      renderFacilities(hydroGame, null);
      expect(rows()[0]).toHaveTextContent(label || hydro.name);
      expect(rows()[0]).not.toHaveTextContent("steady");
      expect(
        within(rows()[0]).queryAllByText("·", { exact: true }),
      ).toHaveLength(label ? 1 : 0);
      expect(rows()[0]).not.toHaveTextContent("50%");
      await user.click(rows()[0]);
      expect(rows()[0]).toHaveTextContent(label || hydro.name);
      expect(rows()[0]).not.toHaveTextContent("steady");
      expect(
        within(rows()[0]).queryAllByText("·", { exact: true }),
      ).toHaveLength(label ? 1 : 0);
    },
  );

  it("keeps facility icons inspectable while a tutorial hides reordering", async () => {
    const tutorial = createGame({ scenarioId: 0 });
    tutorial.inGame = true;
    tutorial.tutorialStep = 0;
    const { onSelect } = renderFacilities(tutorial, null);
    expect(screen.queryByRole("button", { name: /^Reorder / })).toBeNull();
    const icon = within(rows()[0]).getByRole("img", {
      name: tutorial.facilities[0].name,
    });
    await user.click(icon);
    expect(onSelect).toHaveBeenCalledWith(tutorial.facilities[0].id);
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

  it("opens a facility's record and closes it when its row is clicked again", async () => {
    const { onSelect } = renderFacilities(game, null);
    expect(
      screen.getByRole("img", {
        name: /electricity supply and demand over the day/i,
      }),
    ).toHaveAccessibleName(/MW/);
    await user.click(rows()[0]);
    expect(onSelect).toHaveBeenCalledWith(game.facilities[0].id);
    // One panel, not one per row -- getByText throws if a second facility opened too
    expect(screen.getByText("Lifetime profit")).toBeInTheDocument();
    expect(screen.getByText("Avg output")).toBeInTheDocument();
    expect(screen.getByText("Lifetime cost per MWh")).toBeInTheDocument();
    await user.click(rows()[0]);
    expect(onSelect).toHaveBeenLastCalledWith(null);
    expect(screen.queryByText("Lifetime profit")).not.toBeInTheDocument();
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

  it("scrolls live wheel input with its units while preserving zoom and edge gestures", () => {
    const initial = cloneDeep(game);
    initial.speed = "NORMAL";
    initial.facilities[0].currentW = initial.facilities[0].peakW;
    const noop = () => undefined;
    const props: React.ComponentProps<typeof Facilities> = {
      game: initial,
      selectedFacilityId: null,
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

    act(() => ref.current!.onBeforeDragStart());
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

    act(() =>
      ref.current!.onDragEnd({
        draggableId: `f${fast.facilities[0].id}`,
        type: "DEFAULT",
        source: { droppableId: "droppable", index: 0 },
        destination: null,
        reason: "CANCEL",
        mode: "FLUID",
        combine: null,
      }),
    );
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

  it("names the original Oil A retirement target in its direct sale confirmation", async () => {
    const expansion = createGame({ scenarioId: 116 });
    const oil = expansion.facilities.find(
      (facility) => facility.startingAssetId === "scenario-116-champlain-oil-a",
    )!;
    const { onSell } = renderFacilities(expansion, oil.id);
    await user.click(
      screen.getByRole("button", {
        name: "Sell Champlain Electric Oil A",
      }),
    );
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAccessibleName(
      "Sell 40MW Champlain Electric Oil A facility?",
    );
    await user.click(within(dialog).getByRole("button", { name: "Sell" }));
    expect(onSell).toHaveBeenCalledWith(oil.id);
  });

  it("can sell the only facility left in a fleet", async () => {
    const onePlant = createGame({ scenarioId: 5 });
    const { onSell } = renderFacilities(onePlant, onePlant.facilities[0].id);
    const facility = onePlant.facilities[0];

    await user.click(screen.getByLabelText(`Sell ${facility.name}`));
    await user.click(screen.getByRole("button", { name: "Sell" }));

    expect(onSell).toHaveBeenCalledWith(facility.id);
  });

  it.each([0, 150e6])(
    "shows capacity and the cash refund before cancelling a build with a %s loan",
    async (loanAmountLeft) => {
      const game = createGame({ scenarioId: 100 });
      const facility = game.facilities[0];
      facility.peakW = 320e6;
      facility.yearsToBuildLeft = 2;
      facility.buildCost = 200e6;
      facility.loanAmountLeft = loanAmountLeft;
      const { onSell } = renderFacilities(game, facility.id);
      const construction = screen.getByRole("region", { name: "Construction" });
      expect(construction).toHaveTextContent("Nameplate capacity320MW");
      const refund = formatMoneyConcise(200e6 - loanAmountLeft);
      expect(construction).toHaveTextContent(`Refund if cancelled${refund}`);
      expect(
        within(construction).queryByText("After settling the loan") !== null,
      ).toBe(loanAmountLeft > 0);
      await user.click(
        screen.getByRole("button", {
          name: `Cancel construction of ${facility.name}`,
        }),
      );
      const dialog = screen.getByRole("dialog");
      expect(dialog).toHaveTextContent(`You will receive ${refund}`);
      await user.click(
        within(dialog).getByRole("button", { name: "Cancel construction" }),
      );
      expect(onSell).toHaveBeenCalledWith(facility.id);
    },
  );
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

  it("shows an upgrading plant's progress and lets the player cancel it", async () => {
    const state = gameWithSolar();
    const gas = state.facilities.find((f) => f.fuel === "Natural Gas")!;
    (gas as { upgradeInProgress?: object }).upgradeInProgress = {
      upgrade: "coldWeatherPackage",
      cost: 1e6,
      startsMinute: state.date.minute - MINUTES_PER_MONTH / 2,
      completesMinute: state.date.minute + MINUTES_PER_MONTH / 2,
    };
    gas.currentW = gas.peakW / 2;
    const { onCancelRetrofit } = renderFacilities(state, gas.id);
    const gasRow = rows().find((row) =>
      row.getAttribute("aria-label")?.startsWith(`Inspect ${gas.name}`),
    )!;
    expect(gasRow).toHaveTextContent(
      "Winterizing 50% · 90% capacity available",
    );
    expect(
      screen.getByRole("img", {
        name: `${gas.name} installing winterization, 90% capacity available`,
      }),
    ).toBeInTheDocument();
    expect(gasRow).toHaveTextContent("16 days left");
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
});

describe("the interties view", () => {
  it("reveals the resized intertie after its new cost moves it to a different row", () => {
    const original = transmission.intertieBuildQuote;
    const quotes = jest
      .spyOn(transmission, "intertieBuildQuote")
      .mockImplementation((...args) => {
        const quote = original(...args);
        if (!quote) return quote;
        const north = quote.id === "california-north";
        return {
          ...quote,
          buildCost: args[2] === 1 ? (north ? 2e6 : 1e6) : north ? 10e6 : 20e6,
        };
      });
    const scroll = jest.fn(function (this: HTMLElement) {
      // The effect must run after sorting has committed, on the same named card.
      expect(screen.getAllByTestId(/^transmission-project-/)[1]).toBe(this);
    });
    const priorScroll = HTMLElement.prototype.scrollIntoView;
    HTMLElement.prototype.scrollIntoView = scroll;
    try {
      const game = createGame({ scenarioId: 100 });
      game.transmission!.lines = [];
      game.timeline = game.timeline.map((tick) => ({ ...tick, cash: 400000 }));
      renderProjects(game);
      fireEvent.change(screen.getByRole("slider"), { target: { value: 2 } });
      const north = screen.getByTestId("transmission-project-california-north");
      expect(screen.getAllByTestId(/^transmission-project-/)[0]).toBe(north);
      fireEvent.click(
        within(north).getByRole("button", { name: "Use max size" }),
      );
      expect(screen.getAllByTestId(/^transmission-project-/)[1]).toBe(north);
      expect(scroll).toHaveBeenCalledTimes(1);
      expect(scroll.mock.instances[0]).toBe(north);
    } finally {
      quotes.mockRestore();
      HTMLElement.prototype.scrollIntoView = priorScroll;
    }
  });
  it("uses the largest affordable tier and hides the shortcut when even tier one is too expensive", () => {
    const game = createGame({ scenarioId: 100 });
    game.transmission!.lines = [];
    const context = transmission.intertieContextForGame(game);
    const quote = transmission.intertieBuildQuote(
      "california-north",
      game.date.year,
      2,
      context,
    )!;
    const cash = purchaseTerms(
      quote.buildCost,
      true,
      game.interestRate,
    ).downpayment;
    game.timeline = game.timeline.map((tick) => ({ ...tick, cash }));
    renderProjects(game);
    const north = screen.getByTestId("transmission-project-california-north");
    const review = within(north).getByRole("button", {
      name: /Review purchase/,
    });
    fireEvent.change(screen.getByRole("slider"), { target: { value: 3 } });
    expect(review).toBeDisabled();
    fireEvent.click(
      within(north).getByRole("button", { name: "Use max size" }),
    );
    expect(screen.getByRole("slider")).toHaveAttribute("aria-valuenow", "2");
    expect(review).toBeEnabled();
    cleanup();
    game.timeline = game.timeline.map((tick) => ({ ...tick, cash: 0 }));
    renderProjects(game);
    fireEvent.change(screen.getByRole("slider"), { target: { value: 3 } });
    expect(screen.queryByRole("button", { name: "Use max size" })).toBeNull();
  });
  it("explains and offers California connection projects", async () => {
    const game = playedGame(0);
    renderProjects(game);
    fireEvent.change(screen.getByRole("slider"), { target: { value: 1 } });
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
    fireEvent.change(screen.getByRole("slider"), { target: { value: 1 } });
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

  it("hides the empty interties section in Mission 7", () => {
    renderFacilities(createGame({ scenarioId: 112 }), null);
    expect(screen.queryByRole("tablist")).toBeNull();
    expect(screen.queryByRole("button", { name: "Build" })).toBeNull();
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
      const game = createGame({ scenarioId: 111 });
      game.transmission!.lines = [];
      renderProjects(game);
      const first = () => screen.getAllByTestId(/^transmission-project-/)[0];
      expect(first()).toHaveAttribute("data-corridor-id", "california-south");
      const select = async (label: string) => {
        await user.click(
          screen.getByRole("button", { name: /^Sort interties:/ }),
        );
        await user.click(screen.getByRole("menuitem", { name: label }));
      };
      expect(
        screen.getByRole("button", { name: "Sort interties: Build cost" }),
      ).toBeInTheDocument();
      await select("Build time");
      expect(first()).toHaveAttribute("data-corridor-id", "california-north");
      await select("Build cost");
      expect(first()).toHaveAttribute("data-corridor-id", "california-south");
      fireEvent.change(screen.getByRole("slider"), { target: { value: 2 } });
      expect(first()).toHaveAttribute("data-corridor-id", "california-north");
      fireEvent.change(screen.getByRole("slider"), { target: { value: 1 } });
      expect(first()).toHaveAttribute("data-corridor-id", "california-south");
      await select("Lowest emissions");
      expect(first()).toHaveAttribute("data-corridor-id", "california-north");
      await select("Build time");
      expect(first()).toHaveAttribute("data-corridor-id", "california-north");
    } finally {
      mock.mockRestore();
    }
  });
  it("updates capacity and purchase quote when selecting a larger tier", async () => {
    const onBuild = jest.fn();
    const game = createGame({ scenarioId: 111 });
    game.transmission!.lines = [];
    renderProjects(game, onBuild);
    const north = screen.getByTestId("transmission-project-california-north");
    const slider = screen.getByRole("slider");
    expect(north).toHaveTextContent("Import capacity40MW");
    expect(north).toHaveTextContent("Export capacity5MW");
    fireEvent.change(slider, { target: { value: 3 } });
    expect(slider).toHaveAttribute("aria-valuenow", "3");
    expect(north).not.toHaveTextContent("Line capacity");
    expect(north).toHaveTextContent("Import capacity50MW");
    expect(north).toHaveTextContent("Export capacity5MW");
    await user.click(
      within(north).getByRole("button", { name: /Review purchase/ }),
    );
    expect(screen.getByRole("dialog")).toHaveTextContent("Tier 3");
    expect(screen.getByRole("dialog")).toHaveTextContent("Import capacity50MW");
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
    fireEvent.change(screen.getByRole("slider"), { target: { value: 1 } });
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

  it.each([
    [55, 0, 1],
    [90, 0, 1],
    [95, 0, 0],
    [55, 1, 0],
  ] as const)(
    "labels an operating intertie at %d%% capacity with %d years of construction left",
    (percent, yearsToBuildLeft, badgeCount) => {
      const game = connectedGame();
      const line = game.transmission!.lines[0];
      line.yearsToBuildLeft = yearsToBuildLeft;
      getTimeFromTimeline(
        game.date.minute,
        game.timeline,
      )!.transmissionCapacityLimitsWByCorridor = {
        [line.corridorId]: (line.capacityW * percent) / 100,
      };
      renderFacilities(game, null);
      expect(screen.queryAllByText(`${percent}% limit`)).toHaveLength(
        badgeCount,
      );
      expect(
        screen.queryAllByLabelText(
          `Temporarily limited to ${percent}% of rated capacity`,
        ),
      ).toHaveLength(badgeCount);
    },
  );

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
    // A built line reports the power actually moving over it instead of a static "Connected"
    // that never changes
    expect(connections[0]).toHaveTextContent("Idle 0/270MW");
    expect(connections[0]).not.toHaveTextContent("Connected");
    expect(connections[1]).toHaveTextContent("Building");
    await user.click(screen.getByText(game.transmission!.lines[0].name));
    expect(
      screen.getByRole("button", {
        name: `Inspect ${game.transmission!.lines[0].name}, idle, 270MW available`,
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

  it.each([
    [42e6, "Importing", "42/270MW", "importing 42MW of 270MW"],
    [-42e6, "Exporting", "42/150MW", "exporting 42MW of 150MW"],
  ])(
    "names a line's flow direction in words (%d W)",
    (flowW, word, reading, spoken) => {
      const game = connectedGame();
      game.transmission!.lines[0].currentFlowW = flowW;
      renderFacilities(game, null);
      // eslint-disable-next-line testing-library/no-node-access
      const line = document.querySelector(".transmissionLine")!;
      // Unsigned: the word carries direction, not a minus sign against the rating
      expect(line).toHaveTextContent(`${word} ${reading}`);
      expect(line).not.toHaveTextContent("-42");
      expect(
        screen.getByRole("button", {
          name: `Inspect ${game.transmission!.lines[0].name}, ${spoken}`,
        }),
      ).toBeInTheDocument();
    },
  );

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
    expect(building).toHaveTextContent(
      `Refund if cancelled${formatMoneyConcise(game.transmission!.lines[1].buildCost - 1000)}`,
    );
    expect(building).toHaveTextContent("After settling the loan");
    expect(building).toHaveTextContent("Emissions");
    expect(building).not.toHaveTextContent("Import available now");
    expect(building).toHaveTextContent("Typical price");
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

describe("mouse facility selection", () => {
  const matchMedia = window.matchMedia;
  beforeEach(() => {
    window.matchMedia = (query) => ({
      ...matchMedia(query),
      matches: query === "(any-pointer: fine)",
    });
  });
  afterEach(() => {
    window.matchMedia = matchMedia;
  });

  function fleet(): GameType {
    const game = createGame({ scenarioId: 100 });
    game.facilities = Array.from({ length: 5 }, (_, i) => ({
      ...cloneDeep(game.facilities[i % 2]),
      id: i + 1,
      name: `Plant ${i + 1}`,
    }));
    return game;
  }

  it.each([
    ["Shift", "shiftKey"],
    ["Meta", "metaKey"],
    ["Control", "ctrlKey"],
  ])("previews selection checkboxes only while %s is held", (key, flag) => {
    renderFacilities(fleet(), null);
    expect(screen.queryByRole("checkbox")).toBeNull();
    fireEvent.keyDown(document.body, { key, [flag]: true });
    expect(screen.getAllByRole("checkbox")).toHaveLength(5);
    expect(
      screen
        .getAllByRole("checkbox")
        .every((box) => !(box as HTMLInputElement).checked),
    ).toBe(true);
    fireEvent.keyUp(document.body, { key });
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(screen.queryByRole("button", { name: "Actions" })).toBeNull();
  });

  it("keeps checkboxes after a deliberate selection and separates toggling from inspection", async () => {
    renderFacilities(fleet(), null);
    fireEvent.click(rows()[0]);
    expect(screen.queryByRole("checkbox")).toBeNull();
    fireEvent.click(rows()[2], { metaKey: true });
    fireEvent.keyUp(document.body, { key: "Meta" });
    expect(screen.getAllByRole("checkbox")).toHaveLength(5);
    expect(
      screen.getByRole("checkbox", { name: "Select Plant 1" }),
    ).toBeChecked();
    await user.click(screen.getByRole("checkbox", { name: "Select Plant 2" }));
    expect(
      screen.getByRole("status", { name: "Facility selection" }),
    ).toHaveTextContent("3 facilities selected");
    fireEvent.click(rows()[4]);
    expect(rows()[4]).toHaveAttribute("aria-expanded", "true");
    expect(
      screen.getByRole("checkbox", { name: "Select Plant 5" }),
    ).not.toBeChecked();
    expect(
      screen.getByRole("status", { name: "Facility selection" }),
    ).toHaveTextContent("3 facilities selected");
    await user.click(screen.getByRole("button", { name: "Clear selection" }));
    expect(screen.queryByRole("checkbox")).toBeNull();
  });

  it("opens the existing eligible actions from the selection bar without a context click", async () => {
    const game = fleet();
    game.facilities[1].paused = true;
    const view = renderFacilities(game, null);
    fireEvent.click(rows()[0], { ctrlKey: true });
    fireEvent.click(rows()[1], { ctrlKey: true });
    const actions = screen.getByRole("button", { name: "Actions" });
    expect(actions).toHaveAttribute("aria-haspopup", "menu");
    await user.click(actions);
    const menu = screen.getByRole("menu", { name: "Facility actions" });
    expect(
      within(menu).getByRole("menuitem", { name: "Resume (1)" }),
    ).toBeInTheDocument();
    await user.click(within(menu).getByRole("menuitem", { name: "Pause (1)" }));
    expect(view.onPause).toHaveBeenCalledWith(1, "Plant 1");
    await user.click(actions);
    await user.keyboard("{Escape}");
    await waitFor(() => expect(rows()[0]).toHaveFocus());
    expect(screen.queryByRole("checkbox")).toBeNull();
  });

  it("clears a deliberate single selection and an empty selection mode with Escape", async () => {
    renderFacilities(fleet(), null);
    fireEvent.click(rows()[0], { metaKey: true });
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(screen.queryByRole("checkbox")).toBeNull();
    fireEvent.click(rows()[0], { metaKey: true });
    await user.click(screen.getByRole("checkbox", { name: "Select Plant 1" }));
    expect(screen.getAllByRole("checkbox")).toHaveLength(5);
    expect(screen.getByRole("button", { name: "Actions" })).toBeDisabled();
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(screen.queryByRole("checkbox")).toBeNull();
  });

  it("clears a deliberate single selection when Escape cancels a keyboard drag", () => {
    const ref = React.createRef<Facilities>();
    renderFacilities(fleet(), null, ref);
    fireEvent.click(rows()[0], { metaKey: true });
    act(() =>
      ref.current!.onBeforeDragStart({
        draggableId: "f1",
        type: "DEFAULT",
        source: { droppableId: "droppable", index: 0 },
        mode: "SNAP",
      }),
    );
    act(() =>
      ref.current!.onDragEnd({
        draggableId: "f1",
        type: "DEFAULT",
        source: { droppableId: "droppable", index: 0 },
        destination: null,
        reason: "CANCEL",
        mode: "SNAP",
        combine: null,
      }),
    );
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(screen.queryByRole("button", { name: "Actions" })).toBeNull();
    expect(rows()[0]).toHaveAttribute("aria-pressed", "false");
  });

  it("resets modifier previews on blur and ignores modifiers while editing or behind a dialog", () => {
    renderFacilities(fleet(), null);
    fireEvent.keyDown(document.body, { key: "Shift", shiftKey: true });
    fireEvent.blur(window);
    expect(screen.queryByRole("checkbox")).toBeNull();
    const input = document.createElement("input");
    document.body.append(input);
    fireEvent.keyDown(input, { key: "Control", ctrlKey: true });
    expect(screen.queryByRole("checkbox")).toBeNull();
    input.remove();
    fireEvent.contextMenu(rows()[0]);
    fireEvent.keyDown(document.body, { key: "Shift", shiftKey: true });
    expect(screen.queryByRole("checkbox", { hidden: true })).toBeNull();
  });

  it("returns focus to inspection when releasing a modifier hides a focused preview checkbox", () => {
    renderFacilities(fleet(), null);
    fireEvent.keyDown(document.body, { key: "Shift", shiftKey: true });
    const checkbox = screen.getByRole("checkbox", { name: "Select Plant 2" });
    act(() => checkbox.focus());
    fireEvent.keyUp(checkbox, { key: "Shift" });
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(rows()[1]).toHaveFocus();
  });

  it("restores preview focus when returning to the window without stealing a later focus choice", () => {
    renderFacilities(fleet(), null);
    fireEvent.keyDown(document.body, { key: "Shift", shiftKey: true });
    act(() => screen.getByRole("checkbox", { name: "Select Plant 2" }).focus());
    fireEvent.blur(window);
    expect(screen.queryByRole("checkbox")).toBeNull();
    fireEvent.focus(window);
    expect(rows()[1]).toHaveFocus();
    fireEvent.keyDown(document.body, { key: "Shift", shiftKey: true });
    act(() => screen.getByRole("checkbox", { name: "Select Plant 2" }).focus());
    fireEvent.blur(window);
    act(() => rows()[3].focus());
    fireEvent.focus(window);
    expect(rows()[3]).toHaveFocus();
  });

  it("supports ranges from the checkbox as well as the inspection target", async () => {
    renderFacilities(fleet(), null);
    fireEvent.click(rows()[1], { metaKey: true });
    await user.keyboard("{Shift>}");
    await user.click(screen.getByRole("checkbox", { name: "Select Plant 4" }));
    await user.keyboard("{/Shift}");
    expect(rows().map((row) => row.getAttribute("aria-pressed"))).toEqual([
      "false",
      "true",
      "true",
      "true",
      "false",
    ]);
  });

  it("selects anchored ranges in either direction and toggles nonadjacent facilities with Ctrl or Cmd", () => {
    renderFacilities(fleet(), null);
    fireEvent.click(rows()[1]);
    fireEvent.click(rows()[4], { shiftKey: true });
    expect(rows().map((row) => row.getAttribute("aria-pressed"))).toEqual([
      "false",
      "true",
      "true",
      "true",
      "true",
    ]);
    fireEvent.click(rows()[0], { shiftKey: true });
    expect(rows().map((row) => row.getAttribute("aria-pressed"))).toEqual([
      "true",
      "true",
      "false",
      "false",
      "false",
    ]);
    fireEvent.click(rows()[3], { ctrlKey: true });
    fireEvent.click(rows()[1], { metaKey: true });
    expect(rows().map((row) => row.getAttribute("aria-pressed"))).toEqual([
      "true",
      "false",
      "false",
      "true",
      "false",
    ]);
    fireEvent.contextMenu(rows()[1], { button: 0, ctrlKey: true });
    expect(rows()[1]).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByRole("menu")).toBeNull();
    fireEvent.keyDown(rows()[0], { key: "Escape" });
    expect(
      rows().every((row) => row.getAttribute("aria-pressed") === "false"),
    ).toBe(true);
  });

  it("clears multi-select with Escape when focus is outside the fleet", () => {
    const view = renderFacilities(fleet(), null);
    fireEvent.click(rows()[0]);
    fireEvent.click(rows()[2], { shiftKey: true });
    expect(
      rows().filter((row) => row.getAttribute("aria-pressed") === "true"),
    ).toHaveLength(3);
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(
      rows().every((row) => row.getAttribute("aria-pressed") === "false"),
    ).toBe(true);
    fireEvent.click(rows()[0]);
    fireEvent.click(rows()[2], { shiftKey: true });
    const calls = view.onSelect.mock.calls.length;
    cleanup();
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(view.onSelect).toHaveBeenCalledTimes(calls);
  });

  it("keeps single inspection intact outside the fleet and clears it locally", () => {
    renderFacilities(fleet(), null);
    fireEvent.click(rows()[0]);
    expect(rows()[0]).toHaveAttribute("aria-expanded", "true");
    expect(fireEvent.keyDown(document.body, { key: "Escape" })).toBe(true);
    expect(rows()[0]).toHaveAttribute("aria-expanded", "true");
    fireEvent.keyDown(rows()[0], { key: "Escape" });
    expect(rows()[0]).toHaveAttribute("aria-expanded", "false");
    expect(rows()[0]).toHaveAttribute("aria-pressed", "false");
  });

  it("leaves Escape to the incoming screen while the fleet is inert", () => {
    const view = renderFacilities(fleet(), null);
    fireEvent.click(rows()[0]);
    fireEvent.click(rows()[2], { shiftKey: true });
    // Compositor marks the outgoing screen inert until its exit animation unmounts it.
    // eslint-disable-next-line testing-library/no-node-access
    const surface = rows()[0].closest(".facilitiesBody")!;
    surface.setAttribute("inert", "");
    const calls = view.onSelect.mock.calls.length;
    expect(fireEvent.keyDown(document.body, { key: "Escape" })).toBe(true);
    expect(view.onSelect).toHaveBeenCalledTimes(calls);
  });

  it("keeps Escape available after selected facilities leave the fleet", () => {
    const game = fleet();
    const view = renderFacilities(game, null);
    fireEvent.click(rows()[0]);
    fireEvent.click(rows()[2], { shiftKey: true });
    game.facilities = [];
    const calls = view.onSelect.mock.calls.length;
    expect(fireEvent.keyDown(document.body, { key: "Escape" })).toBe(true);
    expect(view.onSelect).toHaveBeenCalledTimes(calls);
  });

  it("preserves keyboard inspection when a canceled drag only has stale mouse IDs", () => {
    const game = fleet();
    const ref = React.createRef<Facilities>();
    const view = renderFacilities(game, null, ref);
    fireEvent.click(rows()[0]);
    fireEvent.click(rows()[2], { shiftKey: true });
    game.facilities = game.facilities.slice(3);
    act(() => ref.current!.props.onSelect(game.facilities[0].id));
    expect(rows()[0]).toHaveAttribute("aria-expanded", "true");
    const calls = view.onSelect.mock.calls.length;
    act(() =>
      ref.current!.onBeforeDragStart({
        draggableId: "f4",
        type: "DEFAULT",
        source: { droppableId: "droppable", index: 0 },
        mode: "SNAP",
      }),
    );
    act(() =>
      ref.current!.onDragEnd({
        draggableId: "f4",
        type: "DEFAULT",
        source: { droppableId: "droppable", index: 0 },
        destination: null,
        reason: "CANCEL",
        mode: "SNAP",
        combine: null,
      }),
    );
    expect(rows()[0]).toHaveAttribute("aria-expanded", "true");
    expect(view.onSelect).toHaveBeenCalledTimes(calls);
  });

  it("clears multi-select when Escape closes its context menu", async () => {
    renderFacilities(fleet(), null);
    fireEvent.click(rows()[0]);
    fireEvent.click(rows()[2], { shiftKey: true });
    fireEvent.contextMenu(rows()[1]);
    expect(
      screen.getByRole("menu", { name: "Facility actions" }),
    ).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(
      rows().every((row) => row.getAttribute("aria-pressed") === "false"),
    ).toBe(true);
    await waitFor(() => expect(rows()[1]).toHaveFocus());
  });

  it("offers eligible bulk pause and resume actions without toggling the wrong state", async () => {
    const game = fleet();
    game.facilities[1].paused = true;
    game.facilities[2].yearsToBuildLeft = 1;
    const view = renderFacilities(game, null);
    fireEvent.click(rows()[0]);
    fireEvent.click(rows()[2], { shiftKey: true });
    fireEvent.contextMenu(rows()[1]);
    const menu = screen.getByRole("menu", { name: "Facility actions" });
    expect(menu).not.toHaveTextContent("facilities selected");
    expect(menu).not.toHaveTextContent("Counts show eligible facilities");
    expect(
      within(menu).getByRole("menuitem", { name: "Resume (1)" }),
    ).toBeInTheDocument();
    await user.click(within(menu).getByRole("menuitem", { name: "Pause (1)" }));
    expect(view.onPause).toHaveBeenCalledWith(1, "Plant 1");
    expect(view.onPause).toHaveBeenCalledTimes(1);
  });

  it("right clicking an unselected row replaces the group and requires sale confirmation", async () => {
    const view = renderFacilities(fleet(), null);
    fireEvent.click(rows()[0]);
    fireEvent.click(rows()[2], { shiftKey: true });
    fireEvent.contextMenu(rows()[4]);
    const menu = screen.getByRole("menu", { name: "Facility actions" });
    expect(menu).toHaveTextContent("Plant 5");
    expect(menu).not.toHaveTextContent("3 facilities selected");
    await user.click(within(menu).getByRole("menuitem", { name: "Sell" }));
    expect(view.onSell).not.toHaveBeenCalled();
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Sell",
      }),
    );
    expect(view.onSell).toHaveBeenCalledWith(5);
    expect(view.onSell).toHaveBeenCalledTimes(1);
  });

  it("separates construction cancellation, upgrade cancellation, and sale in a mixed selection", async () => {
    const game = fleet();
    game.facilities[1].yearsToBuildLeft = 1;
    game.facilities[2].upgradeInProgress = {
      upgrade: "coldWeatherPackage",
      cost: 1e6,
      startsMinute: game.date.minute,
      completesMinute: game.date.minute + MINUTES_PER_MONTH,
    };
    const view = renderFacilities(game, null);
    fireEvent.click(rows()[0]);
    fireEvent.click(rows()[2], { shiftKey: true });
    fireEvent.contextMenu(rows()[0]);
    const menu = screen.getByRole("menu", { name: "Facility actions" });
    expect(
      within(menu).getByRole("menuitem", { name: "Sell (2)" }),
    ).toBeInTheDocument();
    expect(
      within(menu).getByRole("menuitem", { name: "Cancel construction (1)" }),
    ).toBeInTheDocument();
    await user.click(
      within(menu).getByRole("menuitem", { name: "Cancel upgrade (1)" }),
    );
    expect(view.onCancelRetrofit).toHaveBeenCalledWith(3);
    expect(view.onSell).not.toHaveBeenCalled();
    fireEvent.contextMenu(rows()[0]);
    await user.click(
      screen.getByRole("menuitem", { name: "Cancel construction (1)" }),
    );
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Cancel construction",
      }),
    );
    expect(view.onSell).toHaveBeenCalledWith(2);
  });

  it("starts a new range at the clicked row after its anchor leaves the fleet", () => {
    const game = fleet();
    renderFacilities(game, null);
    fireEvent.click(rows()[1]);
    game.facilities.splice(1, 1);
    fireEvent.click(rows()[3], { shiftKey: true });
    expect(rows().map((row) => row.getAttribute("aria-pressed"))).toEqual([
      "false",
      "false",
      "true",
      "false",
    ]);
  });

  it("does not expose mouse actions while the tutorial hides facility actions", () => {
    const game = createGame({ scenarioId: 0 });
    game.inGame = true;
    game.tutorialStep = 0;
    renderFacilities(game, null);
    fireEvent.contextMenu(rows()[0]);
    expect(screen.queryByRole("menu")).toBeNull();
    expect(screen.queryByText(/Shift-click a range/)).toBeNull();
  });

  it("keeps touch-only devices on the existing inspection path", () => {
    window.matchMedia = matchMedia;
    const game = fleet();
    const view = renderFacilities(game, null);
    fireEvent.click(rows()[0]);
    fireEvent.click(rows()[2], { shiftKey: true });
    expect(view.onSelect).toHaveBeenLastCalledWith(3);
    fireEvent.contextMenu(rows()[0]);
    expect(screen.queryByRole("menu")).toBeNull();
    cleanup();
  });

  it("confirms the combined price of upgrades and blocks a cash shortfall", async () => {
    const game = fleet();
    game.facilities = game.facilities.slice(0, 2).map(
      (f) =>
        ({
          ...f,
          name: "Solar",
          fuel: "Sun",
          resilience: undefined,
        }) as FacilityOperatingType,
    );
    const total = game.facilities.reduce(
      (sum, f) => sum + retrofitCost(f, game, "hailResistant")!,
      0,
    );
    getTimeFromTimeline(game.date.minute, game.timeline)!.cash = total - 1;
    const view = renderFacilities(game, null);
    fireEvent.click(rows()[0]);
    fireEvent.click(rows()[1], { shiftKey: true });
    fireEvent.contextMenu(rows()[0]);
    expect(
      screen.getByRole("menuitem", {
        name: /^Add hail-resistant panels \(2\)/,
      }),
    ).toHaveAttribute("aria-disabled", "true");
    cleanup();
    getTimeFromTimeline(game.date.minute, game.timeline)!.cash = total;
    const utils = renderFacilities(game, null);
    fireEvent.click(rows()[0]);
    fireEvent.click(rows()[1], { shiftKey: true });
    fireEvent.contextMenu(rows()[0]);
    await user.click(
      screen.getByRole("menuitem", {
        name: /^Add hail-resistant panels \(2\)/,
      }),
    );
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent("Offline for one month");
    expect(view.onRetrofit).not.toHaveBeenCalled();
    await user.click(
      within(dialog).getByRole("button", {
        name: `Pay ${formatMoneyConcise(total)}`,
      }),
    );
    expect(utils.onRetrofit.mock.calls).toEqual([
      [{ facilityId: 1, upgrade: "hailResistant" }],
      [{ facilityId: 2, upgrade: "hailResistant" }],
    ]);
  });
});
