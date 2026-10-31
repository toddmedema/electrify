import { GameToolMemoryContext } from "../base/GameToolMemory";
import { getHydroAvailability, HYDRO_SITES } from "../../data/HydroSites";
import { LOCATIONS } from "../../Constants";
import * as React from "react";
import { configureStore, createNextState } from "@reduxjs/toolkit";
import { Provider } from "react-redux";
import {
  act,
  fireEvent,
  render,
  screen,
  waitForElementToBeRemoved,
  waitFor,
  within,
} from "@testing-library/react";
import { GENERATORS } from "../../data/Facilities";
import { createGame } from "../../testing/Simulator";
import * as ExpectedOutput from "../../helpers/ExpectedOutput";
import * as GameReducer from "../../reducers/Game";
import * as Facilities from "../../data/Facilities";
import { getTimeFromTimeline } from "../../helpers/DateTime";
import { SCENARIOS } from "../../data/Scenarios";
import { formatMoneyConcise } from "../../helpers/Format";
import {
  resilienceBuildOptions,
  withResilienceOptions,
} from "../../helpers/Hazards";
import { DOWNPAYMENT_PERCENT, TICKS_PER_YEAR } from "../../Constants";
import BuildGenerators, { GeneratorBuildItem } from "./BuildGenerators";
import { purchaseTerms } from "../../helpers/Financials";
import { computeOutlook } from "../base/OutlookForecast";
import type { EvidenceRequestType } from "../../Types";

jest.mock("../base/ManualLink", () => () => null);

it.each([false, true])(
  "resizes an unaffordable generator to the largest affordable slider size (live cash: %s)",
  (live) => {
    const game = createGame({ scenarioId: 100 });
    const quote = (size: number) =>
      GENERATORS(game, size, [], []).find((item) => item.name === "Solar")!;
    const cash = purchaseTerms(
      quote(70e6).buildCost,
      true,
      game.interestRate,
    ).downpayment;
    const cashAt = (amount: number) => ({
      ...game,
      timeline: game.timeline.map((tick) => ({ ...tick, cash: amount })),
    });
    const store = configureStore({
      reducer: {
        game: (
          state = cashAt(live ? 0 : cash),
          action: { type: string; payload?: typeof game },
        ) => (action.type === "replace" ? action.payload! : state),
      },
    });
    const onBuildGenerator = jest.fn();
    const catalog = (
      <BuildGenerators
        game={store.getState().game}
        onBuildGenerator={onBuildGenerator}
        onBack={jest.fn()}
      />
    );
    render(live ? <Provider store={store}>{catalog}</Provider> : catalog);
    fireEvent.change(screen.getByRole("slider"), { target: { value: "18" } });
    const review = screen.getByRole("button", {
      name: "Review purchase of Solar",
    });
    expect(review).toBeDisabled();
    const card = screen.getByText(
      (_text, element) =>
        element?.getAttribute("data-build-option") === "Solar",
    );
    const useMax = () =>
      within(card).queryByRole("button", { name: "Use max size" });
    expect(Boolean(useMax())).toBe(!live);
    const updateCash = (amount: number) =>
      act(() => {
        store.dispatch({ type: "replace", payload: cashAt(amount) });
      });
    const smallerCash = purchaseTerms(
      quote(60e6).buildCost,
      true,
      game.interestRate,
    ).downpayment;
    updateCash(smallerCash);
    expect(useMax()).toBeInTheDocument();
    updateCash(0);
    expect(Boolean(useMax())).toBe(!live);
    updateCash(smallerCash);
    // Both sizes remain below the Review threshold, so the click must read current cash.
    updateCash(cash);
    fireEvent.click(
      within(card).getByRole("button", {
        name: "Use max size",
      }),
    );
    expect(review).toBeEnabled();
    fireEvent.click(review);
    fireEvent.click(screen.getByRole("button", { name: "Take loan" }));
    expect(onBuildGenerator.mock.calls[0][0].peakW).toBe(70e6);
  },
);

it("focuses requested evidence after background quotes arrive", () => {
  const game = createGame({ scenarioId: 103, seed: 12345 });
  const result = computeOutlook("build", game);
  const originalWorker = global.Worker;
  const worker = {
    postMessage: jest.fn(),
    terminate: jest.fn(),
    onmessage: null as Worker["onmessage"],
  };
  const factory = jest
    .spyOn(
      jest.requireMock("../base/OutlookWorkerClient"),
      "createOutlookWorker",
    )
    .mockReturnValue(worker as unknown as Worker);
  const request: EvidenceRequestType = {
    id: 1,
    runId: 0,
    target: { card: "FACILITIES", view: "BUILD_GENERATORS" },
  };
  const ready = jest.fn();
  jest.useFakeTimers();
  global.Worker = jest.fn() as unknown as typeof Worker;
  try {
    const view = render(
      <BuildGenerators
        game={game}
        onBack={jest.fn()}
        onBuildGenerator={jest.fn()}
        evidenceRequest={request}
        onEvidenceReady={ready}
      />,
    );
    expect(screen.getByRole("status")).toHaveTextContent("Calculating quotes");
    expect(ready).not.toHaveBeenCalled();
    act(() => jest.runAllTimers());
    const { requestId } = worker.postMessage.mock.calls[0][0];
    act(() =>
      worker.onmessage?.call(
        worker as unknown as Worker,
        { data: { requestId, result } } as MessageEvent,
      ),
    );
    expect(ready).toHaveBeenCalledWith(
      request,
      screen.getByLabelText("Generator build options"),
    );
    view.unmount();
  } finally {
    factory.mockRestore();
    global.Worker = originalWorker;
    jest.useRealTimers();
  }
});

describe("the three-year build forecast", () => {
  const callbacks = { onBack: jest.fn(), onBuildGenerator: jest.fn() };
  let timeline: jest.SpyInstance;
  beforeEach(() => {
    timeline = jest.spyOn(GameReducer, "generateForecastTimeline");
  });
  afterEach(() => {
    timeline.mockRestore();
  });

  // What a player reads off the screen: all of its text and every typical-year sparkline
  function quotes(container: HTMLElement) {
    return {
      text: container.textContent,
      charts: within(container)
        .getAllByRole("img", { name: /^(Typical year|Available on demand)/ })
        .map((chart) => chart.getAttribute("aria-label")),
    };
  }

  it("keeps typical-year quotes stable while the live clock advances", async () => {
    let game = {
      ...createGame({ scenarioId: 103, seed: 12345 }),
      speed: "NORMAL" as const,
    };
    const view = render(<BuildGenerators game={game} {...callbacks} />);
    const original = quotes(view.container).charts;
    const catalog = jest.spyOn(Facilities, "GENERATORS");
    for (let i = 0; i < 3; i++) {
      game = createNextState(game, (draft) => GameReducer.tickState(draft));
      view.rerender(<BuildGenerators game={game} {...callbacks} />);
    }
    await waitFor(() => expect(timeline).toHaveBeenCalledTimes(1));
    expect(catalog).not.toHaveBeenCalled();
    catalog.mockRestore();
    expect(quotes(view.container).charts).toEqual(original);
  });

  it("updates affordability and an open review from live cash without rebuilding quotes", () => {
    const initial = {
      ...createGame({ scenarioId: 103, seed: 12345 }),
      speed: "NORMAL" as const,
    };
    const cashAt = (cash: number) => ({
      ...initial,
      timeline: initial.timeline.map((tick) => ({ ...tick, cash })),
    });
    const store = configureStore({
      reducer: {
        game: (
          state = cashAt(0),
          action: { type: string; payload?: typeof initial },
        ) => (action.type === "replace" ? action.payload! : state),
      },
    });
    render(
      <Provider store={store}>
        <BuildGenerators game={store.getState().game} {...callbacks} />
      </Provider>,
    );
    const review = screen.getByRole("button", {
      name: "Review purchase of Solar",
    });
    expect(review).toBeDisabled();
    act(() => {
      store.dispatch({ type: "replace", payload: cashAt(1e12) });
    });
    expect(review).toBeEnabled();
    fireEvent.click(review);
    const dialog = screen.getByRole("dialog");
    expect(
      within(dialog).getByRole("button", { name: "Pay cash" }),
    ).toBeEnabled();
    act(() => {
      store.dispatch({ type: "replace", payload: cashAt(0) });
    });
    expect(
      within(dialog).getByRole("button", { name: "Pay cash" }),
    ).toBeDisabled();
    expect(
      within(dialog).getByRole("button", { name: "Take loan" }),
    ).toBeDisabled();
    expect(timeline).toHaveBeenCalledTimes(1);
  });

  it("is computed once per game state across slider, compare, details and remounts", () => {
    const game = createGame({ scenarioId: 100, difficulty: "Employee" });
    const view = render(
      <React.StrictMode>
        <BuildGenerators game={game} {...callbacks} />
      </React.StrictMode>,
    );
    // StrictMode renders twice; the second render reuses the first one's forecast
    expect(timeline).toHaveBeenCalledTimes(1);
    const now = getTimeFromTimeline(game.date.minute, game.timeline)!;
    expect(timeline).toHaveBeenCalledWith(
      game,
      now.cash,
      now.customers,
      TICKS_PER_YEAR * 3,
    );

    const generators = jest.spyOn(Facilities, "GENERATORS");
    const slider = screen.getByRole("slider");
    const before = slider.getAttribute("aria-valuenow");
    fireEvent.keyDown(slider, { key: "ArrowRight" });
    expect(slider).not.toHaveAttribute("aria-valuenow", before!);
    fireEvent.keyDown(slider, { key: "ArrowLeft" });
    fireEvent.click(screen.getAllByRole("button", { name: /^Compare / })[0]);
    fireEvent.click(screen.getAllByRole("button", { name: /details$/ })[0]);
    view.rerender(
      <React.StrictMode>
        <BuildGenerators game={game} {...callbacks} focusFuel="Wind" />
      </React.StrictMode>,
    );
    view.unmount();
    render(<BuildGenerators game={game} {...callbacks} />);
    expect(timeline).toHaveBeenCalledTimes(1);
    // The cheap per-size quote still reruns, against the very same forecast arrays
    expect(generators.mock.calls.length).toBeGreaterThan(1);
    const [first, ...rest] = generators.mock.calls;
    rest.forEach((call) => {
      expect(call[2]).toBe(first[2]);
      expect(call[3]).toBe(first[3]);
      expect(call[4]).toBe(first[4]);
      expect(call[5]).toBe(first[5]);
    });
    generators.mockRestore();
  });

  it("refreshes changed paused inputs without rebuilding for an equal state", async () => {
    const game = createGame({ scenarioId: 100, difficulty: "Employee" });
    const view = render(<BuildGenerators game={game} {...callbacks} />);
    expect(timeline).toHaveBeenCalledTimes(1);
    // Equal inputs do not need another simulation.
    view.rerender(<BuildGenerators game={{ ...game }} {...callbacks} />);
    expect(timeline).toHaveBeenCalledTimes(1);
    // And a changed input reaches it: here the cash the forecast starts from
    const richer = {
      ...game,
      timeline: game.timeline.map((tick) =>
        tick.minute === game.date.minute
          ? Object.assign({}, tick, { cash: 1e12 })
          : tick,
      ),
    };
    view.rerender(<BuildGenerators game={richer} {...callbacks} />);
    await waitFor(() => expect(timeline).toHaveBeenCalledTimes(2));
    expect(timeline.mock.calls[1][1]).toBe(1e12);
  });

  it("refreshes running quotes at month boundaries and after fleet decisions", async () => {
    let game = {
      ...createGame({ scenarioId: 103, seed: 12345 }),
      speed: "FAST" as const,
    };
    const view = render(<BuildGenerators game={game} {...callbacks} />);
    expect(timeline).toHaveBeenCalledTimes(1);
    for (let i = 0; i < 96; i++)
      game = createNextState(game, (draft) => GameReducer.tickState(draft));
    // Discard the reducer's own rollover forecast calls; measure only the catalog.
    timeline.mockClear();
    view.rerender(<BuildGenerators game={game} {...callbacks} />);
    await waitFor(() => expect(timeline).toHaveBeenCalledTimes(1));
    const changed = GameReducer.default(
      game,
      GameReducer.togglePauseFacility(game.facilities[0].id),
    );
    timeline.mockClear();
    view.rerender(<BuildGenerators game={changed} {...callbacks} />);
    await waitFor(() => expect(timeline).toHaveBeenCalledTimes(1));
  });

  it("quotes exactly what a freshly computed forecast quotes", () => {
    const game = createGame({ scenarioId: 104, difficulty: "CEO" });
    // Reused: the forecast from the first render serves each slider position
    const { container: reused } = render(
      <BuildGenerators game={game} {...callbacks} />,
    );
    const reusedSlider = within(reused).getByRole("slider");
    fireEvent.keyDown(reusedSlider, { key: "ArrowRight" });
    fireEvent.keyDown(reusedSlider, { key: "ArrowRight" });
    expect(timeline).toHaveBeenCalledTimes(1);
    const reusedQuotes = quotes(reused);
    const reusedForecast = timeline.mock.results[0].value;
    // Fresh: an equal but distinct game state forces the forecast to be computed again
    const { container: fresh } = render(
      <BuildGenerators game={{ ...game }} {...callbacks} />,
    );
    const freshSlider = within(fresh).getByRole("slider");
    fireEvent.keyDown(freshSlider, { key: "ArrowRight" });
    fireEvent.keyDown(freshSlider, { key: "ArrowRight" });
    expect(timeline).toHaveBeenCalledTimes(2);

    expect(timeline.mock.results[1].value).toEqual(reusedForecast);
    expect(reusedSlider.getAttribute("aria-valuenow")).toBe(
      freshSlider.getAttribute("aria-valuenow"),
    );
    expect(reusedQuotes.charts.length).toBeGreaterThan(0);
    expect(quotes(fresh)).toEqual(reusedQuotes);
  });
});

// The O&M tests below use a 2024 start, which prices at the tables' published 2023 dollars.
it("shows natural-gas base, per-start, and daily-start estimated O&M", async () => {
  const game = createGame({ scenarioId: 111, difficulty: "CEO" });
  // Pin the quote era independently of the scenario preparation start.
  game.startingYear = 2024;
  game.date = { ...game.date, year: 2024 };
  const generator = GENERATORS(game, 419000000, [], []).find(
    (candidate) => candidate.name === "Natural Gas Peaker",
  );
  expect(generator).toBeDefined();

  render(
    <GeneratorBuildItem
      cash={1000000000}
      date={game.date}
      interestRate={game.interestRate}
      generator={generator!}
      location={game.location}
      seed={game.seed}
      onBuild={jest.fn()}
    />,
  );

  expect(
    screen.queryByText("Est. operations & maintenance"),
  ).not.toBeInTheDocument();
  expect(screen.queryByText("$11.9M/yr")).not.toBeInTheDocument();
  expect(screen.queryByText("Flexible power")).toBeNull();
  expect(screen.queryByText(/Typical output/)).not.toBeInTheDocument();
  fireEvent.click(
    screen.getByRole("button", { name: "Show Natural Gas Peaker details" }),
  );

  expect(
    screen.getByRole("row", {
      name: /Fixed upkeep.*\$2\.88M/,
    }),
  ).toBeInTheDocument();
  expect(
    screen.getByRole("row", {
      name: /Variable upkeep.*\$1\.24\/MWh/,
    }),
  ).toBeInTheDocument();
  expect(
    screen.getByRole("row", {
      name: /Non-fuel start cost.*\$23\.1k\/start/,
    }),
  ).toBeInTheDocument();
  expect(
    screen.getByRole("row", {
      name: /Estimated annual upkeep.*\$11\.9M\/yr/,
    }),
  ).toBeInTheDocument();

  fireEvent.click(
    screen.getByRole("button", {
      name: "Review purchase of Natural Gas Peaker",
    }),
  );
  const impact = screen.getByRole("region", { name: "Expected impact" });
  expect(impact).not.toHaveTextContent("What changes");
  expect(impact).toHaveTextContent("Cash purchase");
  expect(impact).toHaveTextContent(
    /Loan option.* \+ .*\/mo · \d+\.\d+%, 30 yrs/,
  );
  expect(impact).toHaveTextContent("Estimated upkeep");
  expect(impact).toHaveTextContent("Online in");
  expect(impact).toHaveTextContent("Typical output");
  expect(impact).toHaveTextContent("weather may limit it");
  expect(impact).not.toHaveTextContent("largest forecast shortage");
  expect(impact).not.toHaveTextContent("Loan:");
  expect(
    screen.queryByRole("table", { name: "Financing terms" }),
  ).not.toBeInTheDocument();
  expect(screen.queryByText("Cash cost")).not.toBeInTheDocument();
  expect(screen.queryByText("Time to build")).not.toBeInTheDocument();

  const dialog = screen.getByRole("dialog");
  fireEvent.click(within(dialog).getByRole("button", { name: "close" }));
  // Watch this element leave after MUI's exit transition; repeated role searches can
  // starve its timer on a busy CI worker.
  await waitForElementToBeRemoved(dialog);
}, 15000);

it("shows Coal's start charge without the representative-day breakdown", () => {
  const game = createGame({ scenarioId: 111, difficulty: "CEO" });
  // Pin the quote era independently of the scenario preparation start.
  game.startingYear = 2024;
  game.date = { ...game.date, year: 2024 };
  const generator = GENERATORS(game, 650000000, [], []).find(
    (candidate) => candidate.name === "Coal",
  );
  expect(generator).toBeDefined();

  render(
    <GeneratorBuildItem
      cash={1000000000}
      date={game.date}
      interestRate={game.interestRate}
      generator={generator!}
      location={game.location}
      seed={game.seed}
      onBuild={jest.fn()}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Show Coal details" }));

  expect(
    screen.getByRole("row", {
      name: /Non-fuel start cost.*\$52\.7k\/start/,
    }),
  ).toBeInTheDocument();
  expect(screen.queryByText(/Representative-day charge/)).toBeNull();
});

it("shows Oil's fixed, variable, and expected-output O&M", () => {
  const game = createGame({ scenarioId: 111, difficulty: "CEO" });
  // Pin the quote era independently of the scenario preparation start.
  game.startingYear = 2024;
  game.date = { ...game.date, year: 2024 };
  const generator = GENERATORS(game, 100000000, [], []).find(
    (candidate) => candidate.name === "Oil",
  );
  expect(generator).toBeDefined();

  render(
    <GeneratorBuildItem
      cash={1000000000}
      date={game.date}
      interestRate={game.interestRate}
      generator={generator!}
      location={game.location}
      seed={game.seed}
      onBuild={jest.fn()}
    />,
  );

  expect(
    screen.queryByText("Est. operations & maintenance"),
  ).not.toBeInTheDocument();
  expect(screen.queryByText("$7.59M/yr")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Show Oil details" }));

  expect(
    screen.getByRole("row", {
      name: /Fixed upkeep.*\$3\.09M\/yr/,
    }),
  ).toBeInTheDocument();
  expect(
    screen.getByRole("row", {
      name: /Variable upkeep.*\$25\.71\/MWh/,
    }),
  ).toBeInTheDocument();
  expect(
    screen.getByRole("row", {
      name: /Estimated annual upkeep.*\$7\.59M\/yr/,
    }),
  ).toBeInTheDocument();
  expect(screen.queryByText("Non-fuel start cost")).toBeNull();
});

it("keeps primary generator metrics visible and discloses secondary details", () => {
  const game = createGame({ scenarioId: 104, difficulty: "CEO" });
  const generator = GENERATORS(game, 419000000, [], []).find(
    (candidate) => candidate.name === "Natural Gas Peaker",
  )!;

  render(
    <GeneratorBuildItem
      cash={1000000000}
      date={game.date}
      interestRate={game.interestRate}
      generator={generator}
      location={game.location}
      seed={game.seed}
      advantages={["Fastest online", "Lowest lifetime cost"]}
      onBuild={jest.fn()}
    />,
  );

  expect(screen.getByText("Natural Gas Peaker")).toBeInTheDocument();
  expect(screen.getByText("On demand")).toBeInTheDocument();
  expect(
    screen.getByRole("img", { name: "Available on demand." }),
  ).toBeInTheDocument();
  expect(
    screen.queryByText(/largest forecast shortage/),
  ).not.toBeInTheDocument();
  expect(screen.getByText("Build cost")).toBeInTheDocument();
  expect(screen.getByText("Build time")).toBeInTheDocument();
  expect(screen.queryByText("Fastest online")).not.toBeInTheDocument();
  expect(screen.queryByText("Cost per MWh")).not.toBeInTheDocument();
  expect(screen.queryByText("Emissions")).not.toBeInTheDocument();

  fireEvent.click(
    screen.getByRole("button", { name: "Show Natural Gas Peaker details" }),
  );

  expect(
    screen.getByRole("group", { name: "Generator advantages" }),
  ).toHaveTextContent("Fastest online");
  expect(screen.getByText("Lifetime cost")).toBeVisible();
  expect(screen.getByText("Direct emissions")).toBeVisible();
});

it("keeps the active lifetime-cost sort metric visible on collapsed cards", () => {
  const game = createGame({ scenarioId: 104, difficulty: "CEO" });
  const generator = GENERATORS(game, 419000000, [], []).find(
    (candidate) => candidate.name === "Natural Gas Peaker",
  )!;

  render(
    <GeneratorBuildItem
      cash={1000000000}
      date={game.date}
      interestRate={game.interestRate}
      generator={generator}
      location={game.location}
      seed={game.seed}
      secondaryMetric="lcWh"
      onBuild={jest.fn()}
    />,
  );

  expect(screen.getByText("Cost per MWh")).toBeVisible();
});

it("submits a generator purchase only once on a double-click", () => {
  const game = createGame({ scenarioId: 104, difficulty: "CEO" });
  const generator = GENERATORS(game, 419000000, [], []).find(
    (candidate) => candidate.name === "Natural Gas Peaker",
  )!;
  const onBuild = jest.fn();

  render(
    <GeneratorBuildItem
      cash={1000000000}
      date={game.date}
      interestRate={game.interestRate}
      generator={generator}
      location={game.location}
      seed={game.seed}
      onBuild={onBuild}
    />,
  );

  fireEvent.click(
    screen.getByRole("button", {
      name: "Review purchase of Natural Gas Peaker",
    }),
  );
  const takeLoan = screen.getByRole("button", { name: "Take loan" });
  fireEvent.click(takeLoan);
  fireEvent.click(takeLoan);

  expect(onBuild).toHaveBeenCalledTimes(1);
});

it("explains affordability and hides comparison when a build is disabled", () => {
  const game = createGame({ scenarioId: 104, difficulty: "CEO" });
  const generator = GENERATORS(game, 419000000, [], []).find(
    (candidate) => candidate.name === "Natural Gas Peaker",
  )!;

  render(
    <GeneratorBuildItem
      cash={0}
      date={game.date}
      interestRate={game.interestRate}
      generator={generator}
      location={game.location}
      seed={game.seed}
      onCompare={jest.fn()}
      onBuild={jest.fn()}
    />,
  );

  expect(
    screen.getByText(/^Need \$.+ down payment · you have \$0$/),
  ).toBeVisible();
  expect(
    screen.queryByRole("button", { name: /Compare Natural Gas Peaker/ }),
  ).toBeNull();
  expect(
    screen.getByRole("button", {
      name: "Review purchase of Natural Gas Peaker",
    }),
  ).toBeDisabled();
});

it("explains unavailable technologies and hides their comparison button", () => {
  const game = createGame({ scenarioId: 100, difficulty: "CEO" });
  const availableGenerator = GENERATORS(game, 1000000, [], [500]).find(
    (candidate) => candidate.name === "Solar",
  )!;
  const generator = {
    ...availableGenerator,
    name: "Unavailable Solar",
    available: false,
  };

  render(
    <GeneratorBuildItem
      cash={1000000000}
      date={game.date}
      interestRate={game.interestRate}
      generator={generator}
      location={game.location}
      seed={game.seed}
      onCompare={jest.fn()}
      onBuild={jest.fn()}
    />,
  );

  expect(screen.getByText("Not available here yet.")).toBeVisible();
  expect(
    screen.queryByRole("button", { name: /Compare Unavailable Solar/ }),
  ).toBeNull();
  expect(
    screen.getByRole("button", {
      name: "Review purchase of Unavailable Solar",
    }),
  ).toBeDisabled();
});

it("draws each generator's typical year against one shared scale", () => {
  const game = createGame({ scenarioId: 100, difficulty: "Employee" });
  const monthly = jest.spyOn(ExpectedOutput, "expectedMonthlyOutputShape");
  render(
    <BuildGenerators
      game={game}
      onBack={jest.fn()}
      onBuildGenerator={jest.fn()}
    />,
  );

  const cards = screen.getAllByRole("button", {
    name: /^Review purchase of/,
  });
  // Once per generator in the list, not again inside each card
  expect(monthly).toHaveBeenCalledTimes(cards.length);
  monthly.mockRestore();

  expect(
    screen.getAllByRole("img", { name: /^Typical year|on demand/ }),
  ).toHaveLength(cards.length);
  expect(
    screen.getAllByRole("img", { name: /^Typical year: .*lowest in/ }).length,
  ).toBeGreaterThan(0);
  expect(
    screen.getAllByText(/^[A-Z][a-z]{2} low: \d+% of capacity$/).length,
  ).toBeGreaterThan(0);
  expect(screen.getAllByText("On demand").length).toBeGreaterThan(0);
  expect(
    screen.getByText(/^[A-Z][a-z]{2} low: \d+% of typical water$/),
  ).toBeVisible();
  expect(
    screen.getByRole("img", { name: /^Typical year of water inflow: / }),
  ).toBeInTheDocument();
});

it("pins up to three current-grid choices into a comparison tray", () => {
  const game = createGame({ scenarioId: 100, difficulty: "Employee" });
  render(
    <BuildGenerators
      game={game}
      onBack={jest.fn()}
      onBuildGenerator={jest.fn()}
    />,
  );

  const compare = screen.getAllByRole("button", { name: /^Compare / });
  fireEvent.click(compare[0]);
  fireEvent.click(compare[1]);
  expect(
    screen.getByRole("region", { name: "Generator comparison" }),
  ).toHaveTextContent("Comparing 2/3");
});

it("keeps expanded details with their generator when tutorial choices expand", () => {
  const game = createGame({ scenarioId: 1 });
  game.tutorialStep = 3;
  const callbacks = { onBack: jest.fn(), onBuildGenerator: jest.fn() };
  const { rerender } = render(<BuildGenerators game={game} {...callbacks} />);
  expect(
    screen.getAllByRole("button", { name: /^Review purchase of/ }),
  ).toHaveLength(4);
  fireEvent.click(screen.getByRole("button", { name: "Show Wind details" }));
  rerender(
    <BuildGenerators game={{ ...game, tutorialStep: 4 }} {...callbacks} />,
  );
  expect(
    screen.getByRole("button", { name: "Hide Wind details" }),
  ).toHaveAttribute("aria-expanded", "true");
  expect(
    screen.getAllByRole("button", { name: /^Hide .* details/ }),
  ).toHaveLength(1);
  expect(
    screen.getAllByRole("button", { name: /^Review purchase of/ }).length,
  ).toBeGreaterThan(4);
});

it("remembers dismissal of Hydro help when reopening the build screen", () => {
  localStorage.removeItem("hydroPrimerSeen");
  const game = createGame({ scenarioId: 103 });
  const callbacks = { onBack: jest.fn(), onBuildGenerator: jest.fn() };
  const view = render(<BuildGenerators game={game} {...callbacks} />);
  fireEvent.click(screen.getByRole("button", { name: "Use site maximum" }));
  const help = screen.getByRole("region", { name: "About Hydro" });
  expect(help).toHaveTextContent("Each plant uses a whole site");
  fireEvent.click(
    within(help).getByRole("button", { name: "Dismiss About Hydro" }),
  );
  expect(screen.queryByRole("region", { name: "About Hydro" })).toBeNull();
  expect(localStorage.getItem("hydroPrimerSeen")).toBe("true");
  expect(
    screen.getByRole("button", { name: "Review purchase of Hydro" }),
  ).toBeInTheDocument();
  view.unmount();
  render(<BuildGenerators game={game} {...callbacks} />);
  fireEvent.click(screen.getByRole("button", { name: "Use site maximum" }));
  expect(screen.queryByRole("region", { name: "About Hydro" })).toBeNull();
  localStorage.removeItem("hydroPrimerSeen");
});

it("quotes a Hydro site maximum and updates the shared slider", () => {
  const game = createGame({ scenarioId: 104, difficulty: "CEO" });
  game.location = LOCATIONS.PIT;
  game.facilities = [];
  game.commissionedHydroSiteIds = [];
  const remaining = getHydroAvailability(game, 1000000).remaining;
  const site =
    remaining.find((site) => site.maxPeakW === 24000000) || remaining[0];
  expect(site).toBeDefined();
  game.commissionedHydroSiteIds = remaining
    .filter((candidate) => candidate.id !== site.id)
    .map((candidate) => candidate.id);
  game.timeline[0].cash = 1e12;
  const onBuild = jest.fn();
  render(
    <BuildGenerators
      game={game}
      onBack={jest.fn()}
      onBuildGenerator={onBuild}
    />,
  );
  const slider = screen.getByRole("slider");
  const before = slider.getAttribute("aria-valuenow");
  expect(
    screen.getByRole("button", { name: "Review purchase of Hydro" }),
  ).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Use site maximum" }));
  expect(slider).not.toHaveAttribute("aria-valuenow", before!);
  expect(
    screen.queryByRole("button", { name: "Use site maximum" }),
  ).not.toBeInTheDocument();
  expect(
    screen.getByText(new RegExp("Site: " + HYDRO_SITES[site.id].name)),
  ).toBeInTheDocument();
  fireEvent.click(
    screen.getByRole("button", { name: "Review purchase of Hydro" }),
  );
  expect(screen.getByRole("dialog")).toHaveTextContent(
    "Only canceling before completion frees it",
  );
  fireEvent.click(screen.getByRole("button", { name: "Pay cash" }));
  expect(onBuild).toHaveBeenCalledWith(
    expect.objectContaining({ name: "Hydro", peakW: site.maxPeakW }),
    false,
  );
});

it("updates fit counts and distinguishes exhausted and unavailable Hydro inventories", () => {
  const game = createGame({ scenarioId: 103 });
  game.facilities = [];
  game.commissionedHydroSiteIds = [];
  const onBuild = jest.fn();
  const { rerender } = render(
    <BuildGenerators
      game={game}
      onBack={jest.fn()}
      onBuildGenerator={onBuild}
    />,
  );
  const sites = getHydroAvailability(game, 1000000).remaining;
  expect(sites.length).toBeGreaterThan(0);
  game.commissionedHydroSiteIds = sites.map((site) => site.id);
  rerender(
    <BuildGenerators
      game={{ ...game }}
      onBack={jest.fn()}
      onBuildGenerator={onBuild}
    />,
  );
  expect(screen.queryByText(/sites left/)).not.toBeInTheDocument();
  expect(
    screen.getByText("No remaining buildable locations"),
  ).toBeInTheDocument();
  const reviews = screen.getAllByRole("button", { name: /Review purchase of/ });
  expect(reviews[reviews.length - 1]).toHaveAccessibleName(
    "Review purchase of Hydro",
  );
  expect(
    screen.getByRole("button", { name: "Review purchase of Hydro" }),
  ).toBeDisabled();
  game.location = { ...game.location, lat: game.location.lat + 1 };
  rerender(
    <BuildGenerators
      game={{ ...game }}
      onBack={jest.fn()}
      onBuildGenerator={onBuild}
    />,
  );
  expect(
    screen.getByText("No remaining buildable locations"),
  ).toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "Review purchase of Hydro" }),
  ).toBeDisabled();
});

describe("weather hardening in the purchase dialog", () => {
  // Carbon Fee moved to Pittsburgh: a cold climate that also sees some hail
  function coldGame() {
    const scenario = SCENARIOS.find((candidate) => candidate.id === 100)!;
    const game = createGame({
      scenario: { ...scenario, locationId: "PIT" },
      scenarioId: 100,
    });
    game.timeline[0].cash = 1e12;
    return game;
  }

  function showBuildList(onBuild = jest.fn()) {
    render(
      <BuildGenerators
        game={coldGame()}
        onBack={jest.fn()}
        onBuildGenerator={onBuild}
      />,
    );
    return onBuild;
  }

  it("prices the default cold-weather package and builds without it when cleared", () => {
    const onBuild = showBuildList();
    fireEvent.click(
      screen.getByRole("button", {
        name: "Review purchase of Natural Gas Peaker",
      }),
    );
    const dialog = screen.getByRole("dialog");
    const option = within(dialog).getByRole("checkbox", {
      name: /^Cold-weather package \+\$/,
    });
    expect(option).toBeChecked();
    expect(option).toHaveAccessibleDescription(
      "Rated to \u221230°C instead of \u22128°C; halves remaining cold losses and deep-freeze losses. Recommended here: winters often drop below \u22128°C.",
    );
    const impact = within(dialog).getByRole("region", {
      name: "Expected impact",
    });
    const withPackage = impact.textContent;
    fireEvent.click(option);
    expect(impact.textContent).not.toEqual(withPackage);
    fireEvent.click(within(dialog).getByRole("button", { name: "Pay cash" }));
    const [quote, financed] = onBuild.mock.calls[0];
    expect(financed).toBe(false);
    expect(quote.fuel).toBe("Natural Gas");
    expect(quote.resilience).toEqual({
      coldWeatherPackage: false,
      designMinTempC: -8,
    });
    expect(quote.resilienceExtraBuildCost).toBeUndefined();
  });

  it.each(["Natural Gas Peaker", "Coal", "Nuclear", "Wind"])(
    "offers permanent winterization when buying %s in Deep Freeze",
    (name) => {
      const game = createGame({ scenarioId: 107 });
      game.timeline[0].cash = 1e12;
      const onBuild = jest.fn();
      render(
        <BuildGenerators
          game={game}
          onBack={jest.fn()}
          onBuildGenerator={onBuild}
        />,
      );
      fireEvent.click(
        screen.getByRole("button", { name: `Review purchase of ${name}` }),
      );
      const dialog = screen.getByRole("dialog");
      const option = within(dialog).getByRole("checkbox", {
        name: /^Cold-weather package/,
      });
      expect(option).not.toBeChecked();
      fireEvent.click(option);
      fireEvent.click(within(dialog).getByRole("button", { name: "Pay cash" }));
      expect(onBuild.mock.calls[0][0].resilience.coldWeatherPackage).toBe(true);
    },
  );

  it("offers no cold-weather package where winters never get cold enough", () => {
    const game = createGame({ scenarioId: 100 });
    game.timeline[0].cash = 1e12;
    render(
      <BuildGenerators
        game={game}
        onBack={jest.fn()}
        onBuildGenerator={jest.fn()}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: "Review purchase of Natural Gas Peaker",
      }),
    );
    expect(
      within(screen.getByRole("dialog")).queryByRole("checkbox", {
        name: /^Cold-weather package/,
      }),
    ).toBeNull();
  });

  it("offers hail-resistant solar as an opt-in that follows the quoted price", () => {
    const onBuild = showBuildList();
    fireEvent.click(
      screen.getByRole("button", { name: "Review purchase of Solar" }),
    );
    const dialog = screen.getByRole("dialog");
    const option = within(dialog).getByRole("checkbox", {
      name: /^Hail-resistant panels \+\$/,
    });
    expect(option).not.toBeChecked();
    fireEvent.click(option);
    fireEvent.click(within(dialog).getByRole("button", { name: "Pay cash" }));
    const [quote] = onBuild.mock.calls[0];
    expect(quote.resilience).toEqual({
      hailResistant: true,
      solarTrackers: false,
    });
    expect(quote.resilienceExtraBuildCost).toBeGreaterThan(0);
    expect(option).toHaveAccessibleName(
      `Hail-resistant panels +${formatMoneyConcise(quote.resilienceExtraBuildCost)}`,
    );
  });

  it("offers solar trackers at build, pitched on morning and evening output", () => {
    const onBuild = showBuildList();
    fireEvent.click(
      screen.getByRole("button", { name: "Review purchase of Solar" }),
    );
    const dialog = screen.getByRole("dialog");
    const option = within(dialog).getByRole("checkbox", {
      name: /^Solar trackers \+\$/,
    });
    expect(option).not.toBeChecked();
    expect(option).toHaveAccessibleDescription(
      /more morning and evening power.*Stows in hail\. Can't be added later\./,
    );
    fireEvent.click(option);
    fireEvent.click(within(dialog).getByRole("button", { name: "Pay cash" }));
    const [quote] = onBuild.mock.calls[0];
    expect(quote.resilience).toMatchObject({
      solarTrackers: true,
      hailResistant: false,
    });
    expect(quote.resilience.trackerHailDamageFactor).toBeGreaterThan(0);
  });

  function gasItem(cash: number, onBuild = jest.fn()) {
    const game = coldGame();
    const quote = GENERATORS(game, 419000000, [], []).find(
      (candidate) => candidate.name === "Natural Gas Peaker",
    )!;
    render(
      <GeneratorBuildItem
        cash={cash}
        date={game.date}
        interestRate={game.interestRate}
        generator={quote}
        location={game.location}
        seed={game.seed}
        resilienceOptions={resilienceBuildOptions(quote, game)}
        withResilience={(selection) =>
          withResilienceOptions(quote, game, selection)
        }
        onBuild={onBuild}
      />,
    );
    return {
      packaged: withResilienceOptions(quote, game, {
        coldWeatherPackage: true,
      }),
      plain: withResilienceOptions(quote, game, {}),
      onBuild,
    };
  }

  it("keeps the card buyable when only the default package is unaffordable", () => {
    const game = coldGame();
    const quote = GENERATORS(game, 419000000, [], []).find(
      (candidate) => candidate.name === "Natural Gas Peaker",
    )!;
    const plainDownpayment =
      DOWNPAYMENT_PERCENT * withResilienceOptions(quote, game, {}).buildCost;
    const packagedDownpayment = DOWNPAYMENT_PERCENT * quote.buildCost;
    const cash = (plainDownpayment + packagedDownpayment) / 2;
    const { onBuild } = gasItem(cash);

    expect(screen.getByText("Incl. cold-weather package")).toBeVisible();
    const review = screen.getByRole("button", {
      name: "Review purchase of Natural Gas Peaker",
    });
    expect(review).toBeEnabled();
    fireEvent.click(review);
    const dialog = screen.getByRole("dialog");
    const option = within(dialog).getByRole("checkbox", {
      name: /^Cold-weather package/,
    });
    expect(option).toBeChecked();
    expect(option).toHaveAccessibleDescription(
      /Uncheck to afford the downpayment\.$/,
    );
    expect(
      within(dialog).getByText("Uncheck to afford the downpayment."),
    ).toHaveClass("resilienceBuildOptionWarning");
    expect(
      within(dialog).getByRole("button", { name: "Take loan" }),
    ).toBeDisabled();
    fireEvent.click(option);
    fireEvent.click(within(dialog).getByRole("button", { name: "Take loan" }));
    expect(onBuild).toHaveBeenCalledWith(true, {
      coldWeatherPackage: false,
    });
  });

  it("prices cash, downpayment and loan from the selected quote", () => {
    const cash = 1e12;
    const { packaged, plain, onBuild } = gasItem(cash);
    fireEvent.click(
      screen.getByRole("button", {
        name: "Review purchase of Natural Gas Peaker",
      }),
    );
    const dialog = screen.getByRole("dialog");
    const impact = within(dialog).getByRole("region", {
      name: "Expected impact",
    });
    expect(impact).toHaveTextContent(
      `${formatMoneyConcise(DOWNPAYMENT_PERCENT * packaged.buildCost)} now +`,
    );
    expect(impact).toHaveTextContent(
      `${formatMoneyConcise(packaged.buildCost)} now`,
    );
    fireEvent.click(
      within(dialog).getByRole("checkbox", { name: /^Cold-weather package/ }),
    );
    expect(impact).toHaveTextContent(
      `${formatMoneyConcise(plain.buildCost)} now`,
    );
    expect(impact).toHaveTextContent(
      `${formatMoneyConcise(DOWNPAYMENT_PERCENT * plain.buildCost)} now +`,
    );
    fireEvent.click(within(dialog).getByRole("button", { name: "Take loan" }));
    expect(onBuild).toHaveBeenCalledWith(true, {
      coldWeatherPackage: false,
    });
  });

  it("offers no hardening for technologies without a modelled hazard", () => {
    showBuildList();
    fireEvent.click(
      screen.getByRole("button", { name: "Review purchase of Wind" }),
    );
    expect(
      within(screen.getByRole("dialog")).queryByRole("checkbox"),
    ).toBeNull();
  });
});

it("opens at the fleet average and remembers the player's chosen generator size", () => {
  const game = createGame({ scenarioId: 100 });
  game.facilities = [100e6, 200e6, 300e6].map((peakW, index) => ({
    ...game.facilities[0],
    id: index + 1,
    peakW,
  }));
  const memory = new Map<string, unknown>();
  const catalog = () => (
    <GameToolMemoryContext.Provider value={memory}>
      <BuildGenerators
        game={game}
        onBack={jest.fn()}
        onBuildGenerator={jest.fn()}
      />
    </GameToolMemoryContext.Provider>
  );
  const view = render(catalog());
  expect(screen.getByRole("slider")).toHaveAccessibleName(/200MW/);
  fireEvent.keyDown(screen.getByRole("slider"), { key: "ArrowRight" });
  view.unmount();
  render(catalog());
  expect(screen.getByRole("slider")).toHaveAccessibleName(/300MW/);
});

it.each([undefined, "Natural Gas"] as const)(
  "sorts generators by lowest direct emissions with initial fuel focus %s",
  (focusFuel) => {
    const game = createGame({ scenarioId: 111, difficulty: "CEO" });
    render(
      <BuildGenerators
        game={game}
        focusFuel={focusFuel}
        onBack={jest.fn()}
        onBuildGenerator={jest.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /^Sort facilities:/ }));
    const choices = screen.getAllByRole("menuitem");
    expect(choices[choices.length - 1]).toHaveTextContent("Emissions");
    fireEvent.click(screen.getByRole("menuitem", { name: "Emissions" }));
    const choicesInOrder = screen.getAllByRole("button", {
      name: /^Review purchase of /,
    });
    const index = (name: string) =>
      choicesInOrder.indexOf(
        screen.getByRole("button", { name: `Review purchase of ${name}` }),
      );
    expect(index("Solar")).toBeLessThan(index("Natural Gas CC"));
    expect(index("Natural Gas CC")).toBeLessThan(index("Natural Gas Peaker"));
    expect(index("Natural Gas Peaker")).toBeLessThan(index("Coal"));
    expect(index("Coal")).toBeLessThan(index("Oil"));
  },
);
