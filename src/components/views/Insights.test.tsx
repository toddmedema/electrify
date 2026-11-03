import { configureStore, createNextState } from "@reduxjs/toolkit";
import {
  act,
  fireEvent,
  waitFor,
  isInaccessible,
  render as renderUI,
  screen,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import cloneDeep from "lodash.clonedeep";
import * as React from "react";
import { flushSync } from "react-dom";
import { Provider } from "react-redux";
import { EMPTY_HISTORY, MINUTES_PER_MONTH } from "../../helpers/DateTime";
import { CUSTOM_SCENARIO_ID, getScenario } from "../../data/Scenarios";
import * as GameModule from "../../reducers/Game";
import gameReducer, { buildTransmissionLine } from "../../reducers/Game";
import { cancelPolicy, schedulePolicy } from "../../reducers/GameActions";
import uiReducer from "../../reducers/UI";
import { createGame } from "../../testing/Simulator";
import { loadSimData } from "../../testing/SimData";
import {
  cacheProjection,
  ProjectionView,
  selectProjection,
} from "../../helpers/Projection";
import { GameType, TickPresentFutureType } from "../../Types";
import Insights, {
  INSIGHT_PRESETS,
  INSIGHT_LAYERS,
  MAX_CUSTOM_INSIGHT_PRESETS,
  withRequiredLayers,
} from "./Insights";
import { UpcomingStoryEventType } from "./StoryEventSelectors";

jest.mock("../base/GameCard", () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}));

interface ChartMockProps {
  currentMinute?: number;
  selectedFuel?: string;
  title?: string;
  hideTitle?: boolean;
  format?: (value: number) => number | string;
  formatAxis?: (value: number) => number | string;
  id?: string;
  syncKey?: string;
  timeline?: unknown[];
  domain?: [number, number] | { x: [number, number] };
}

const domainValue = (domain?: ChartMockProps["domain"]) =>
  JSON.stringify(Array.isArray(domain) ? domain : domain?.x);

let mockSupplyDemandPaints = 0;

// Restore real timers even when a test that fakes them fails partway
afterEach(() => {
  jest.useRealTimers();
});

it("keeps first worker startup and long worker recovery out of the Insights render", () => {
  const game = createGame({ scenarioId: 103, seed: 91 });
  const props = {
    game,
    selectedFacilityId: null,
    facilityDragActive: false,
  };
  const insights = new Insights(props);
  const internals = insights as unknown as {
    props: typeof props;
    getProjection: (now: TickPresentFutureType) => unknown;
  };
  const originalWorker = global.Worker;
  const generate = jest.spyOn(GameModule, "generateForecastTimeline");
  global.Worker = jest.fn() as unknown as typeof Worker;
  try {
    expect(internals.getProjection(game.timeline[0])).toBeUndefined();
    expect(generate).not.toHaveBeenCalled();
    global.Worker = originalWorker;
    const previous = internals.getProjection(game.timeline[0]);
    global.Worker = jest.fn() as unknown as typeof Worker;
    generate.mockClear();
    internals.props = {
      ...props,
      game: { ...game, date: { ...game.date, monthsElapsed: 3 } },
    };
    expect(internals.getProjection(game.timeline[0])).toBe(previous);
    expect(generate).not.toHaveBeenCalled();
    internals.props = { ...props, game: cloneDeep(game) };
    expect(internals.getProjection(game.timeline[0])).toBeUndefined();
    expect(generate).not.toHaveBeenCalled();
  } finally {
    global.Worker = originalWorker;
    generate.mockRestore();
  }
});

it("keeps a connected live exchange's tick updates out of forecast-chart renders", () => {
  const game = createGame({ scenarioId: 112, seed: 92 });
  const props = {
    game,
    live: true,
    selectedFacilityId: null,
    facilityDragActive: false,
  };
  const insights = new Insights(props);
  const next = {
    ...game,
    date: { ...game.date, minute: game.date.minute + 15 },
    speed: "FAST" as const,
  };
  expect(
    insights.shouldComponentUpdate({ ...props, game: next }, insights.state),
  ).toBe(false);
});

it("refreshes paused projections when a customer program is scheduled, replaced, or cancelled", () => {
  const game = createGame({ scenarioId: 106, seed: 4 });
  const props = {
    game,
    selectedFacilityId: null,
    facilityDragActive: false,
  };
  jest.useFakeTimers();
  const insights = new Insights(props);
  const internals = insights as unknown as {
    props: typeof props;
    getProjection: (now: TickPresentFutureType) => {
      timeline: TickPresentFutureType[];
    };
    requestStaleProjection: () => void;
  };
  const before = internals.getProjection(game.timeline[0]);
  const change = {
    id: "efficiency" as const,
    tier: "On" as const,
    month: 1,
  };
  const project = (nextGame: GameType) => {
    const nextProps = { ...props, game: nextGame };
    expect(insights.shouldComponentUpdate(nextProps, insights.state)).toBe(
      true,
    );
    internals.props = nextProps;
    // The decision's own render keeps the last projection, and the new one lands after paint
    const stale = internals.getProjection(nextGame.timeline[0]);
    internals.requestStaleProjection();
    jest.runAllTimers();
    const fresh = internals.getProjection(nextGame.timeline[0]);
    expect(fresh).not.toBe(stale);
    return fresh;
  };
  const scheduledGame = gameReducer(game, schedulePolicy(change));
  const scheduled = project(scheduledGame);
  // Build-outs are on or off, so replacing a scheduled start means scheduling Off instead.
  const replacedGame = gameReducer(
    scheduledGame,
    schedulePolicy({ ...change, tier: "Off" }),
  );
  const replaced = project(replacedGame);
  const rescheduledGame = gameReducer(replacedGame, schedulePolicy(change));
  project(rescheduledGame);
  const cancelled = project(gameReducer(rescheduledGame, cancelPolicy(change)));
  const future = (projection: typeof before) =>
    projection.timeline.find((tick) => tick.minute >= 3 * MINUTES_PER_MONTH)!;
  expect(future(scheduled).demandW).toBeLessThan(future(before).demandW);
  expect(future(scheduled).expensesPolicy).toBeGreaterThan(0);
  expect(replaced.timeline).toEqual(before.timeline);
  expect(cancelled.timeline).toEqual(before.timeline);
  expect(
    insights.shouldComponentUpdate(
      {
        ...internals.props,
        game: {
          ...internals.props.game,
          policies: JSON.parse(JSON.stringify(internals.props.game.policies)),
        },
      },
      insights.state,
    ),
  ).toBe(false);
});

jest.mock("../base/ChartFinances", () => ({
  __esModule: true,
  default: ({
    id,
    syncKey,
    timeline,
    domain,
    title,
    hideTitle,
    format,
    formatAxis,
  }: ChartMockProps) => (
    <div
      role="img"
      id={id}
      data-testid={id}
      data-visible-title={hideTitle ? "" : title}
      data-inspected-value={format?.(123456)}
      data-axis-value={(formatAxis || format)?.(123456)}
      data-sync-key={syncKey}
      data-points={timeline?.length}
      data-domain={domainValue(domain)}
    />
  ),
}));

jest.mock("../base/ChartForecastFuelPrices", () => ({
  __esModule: true,
  PRICED_FUELS: [],
  default: ({ syncKey, selectedFuel }: ChartMockProps) => (
    <div
      role="img"
      aria-label="Fuel price inspection"
      data-chart="fuel-prices"
      data-sync-key={syncKey}
      data-fuel={selectedFuel || "all"}
    />
  ),
}));
jest.mock("../base/ChartForecastDemandByType", () => ({
  __esModule: true,
  demandTypesBySizeAtStart: () => [
    "Residential",
    "Commercial",
    "Industrial",
    "Transportation",
    "Data Centers",
  ],
  default: ({ syncKey }: ChartMockProps) => (
    <div role="img" data-chart="demand-by-type" data-sync-key={syncKey} />
  ),
}));
jest.mock("../base/ChartForecastSupplyByFuel", () => ({
  __esModule: true,
  forecastFuels: () => [],
  default: ({ syncKey }: ChartMockProps) => (
    <div role="img" data-chart="supply-by-fuel" data-sync-key={syncKey} />
  ),
}));
jest.mock("../base/ChartForecastSupplyDemand", () => ({
  __esModule: true,
  default: ({ syncKey, timeline, domain, currentMinute }: ChartMockProps) => {
    mockSupplyDemandPaints++;
    return (
      <div
        role="img"
        data-chart="supply-demand"
        data-testid="supply-demand-chart"
        data-forecast-start={currentMinute}
        data-sync-key={syncKey}
        data-points={timeline?.length}
        data-domain={domainValue(domain)}
      />
    );
  },
}));
jest.mock("../base/ChartSupplyDemandRanges", () => ({
  __esModule: true,
  default: ({ syncKey, timeline, domain, currentMinute }: ChartMockProps) => {
    mockSupplyDemandPaints++;
    return (
      <div
        role="img"
        data-testid="supply-demand-chart"
        data-forecast-start={currentMinute}
        data-sync-key={syncKey}
        data-points={timeline?.length}
        data-domain={domainValue(domain)}
      />
    );
  },
}));
jest.mock("../base/ChartForecastStorage", () => ({
  __esModule: true,
  default: ({ syncKey }: ChartMockProps) => (
    <div role="img" data-chart="storage" data-sync-key={syncKey} />
  ),
}));
jest.mock("../base/ChartForecastRenewableCapacityFactor", () => ({
  __esModule: true,
  default: ({ syncKey }: ChartMockProps) => (
    <div
      role="img"
      data-testid="renewable-capacity-factor-chart"
      data-sync-key={syncKey}
    />
  ),
}));
jest.mock("../base/ChartForecastWater", () => ({
  __esModule: true,
  default: ({ syncKey }: ChartMockProps) => (
    <div role="img" data-chart="water" data-sync-key={syncKey} />
  ),
}));
jest.mock("../base/ChartForecastWeather", () => ({
  __esModule: true,
  default: ({ syncKey, timeline }: ChartMockProps) => (
    <div
      role="img"
      data-chart="weather"
      data-sync-key={syncKey}
      data-points={timeline?.length}
      data-step={
        timeline && timeline.length > 1
          ? (timeline[1] as { minute: number }).minute -
            (timeline[0] as { minute: number }).minute
          : undefined
      }
    />
  ),
}));

const user = userEvent.setup({ delay: null });

let overviewGame: GameType;

it("reframes the same event after its selected chip leaves the viewport", () => {
  localStorage.clear();
  const ref = React.createRef<Insights>();
  const props = {
    game: createGame({ scenarioId: 101 }),
    selectedFacilityId: null,
    facilityDragActive: false,
    onEvidenceReady: jest.fn(),
    upcomingEvents: [
      {
        key: "growth",
        startsMinute: 6 * MINUTES_PER_MONTH,
        label: "July",
        title: "Load growth",
        message: "Demand grows.",
      },
    ],
  };
  const request = {
    id: 1,
    runId: 0,
    target: { card: "INSIGHTS" as const, eventKey: "growth" },
  };
  const { rerender } = render(
    <Insights {...props} ref={ref} evidenceRequest={request} />,
  );
  expect(
    screen.getByRole("button", { name: "July: Load growth" }),
  ).toHaveAttribute("aria-expanded", "true");
  rerender(<Insights {...props} ref={ref} />);
  act(() => ref.current!.setState({ viewport: [0, MINUTES_PER_MONTH] }));
  expect(
    screen.queryByRole("button", { name: "July: Load growth" }),
  ).not.toBeInTheDocument();
  const nextRequest = { ...request, id: 2 };
  rerender(<Insights {...props} ref={ref} evidenceRequest={nextRequest} />);
  const chip = screen.getByRole("button", { name: "July: Load growth" });
  expect(chip).toHaveAttribute("aria-expanded", "true");
  expect(props.onEvidenceReady).toHaveBeenLastCalledWith(nextRequest, chip);
});

it("reveals finance evidence temporarily and lets explicit selection own saved layers", async () => {
  localStorage.clear();
  const configured = ["supplyDemand"];
  localStorage.setItem("insightsLayers", JSON.stringify(configured));
  const props = {
    game: createGame({ scenarioId: 101 }),
    selectedFacilityId: null,
    facilityDragActive: false,
    onEvidenceReady: jest.fn(),
  };
  const request = { id: 1, runId: 0, target: "finances" as const };
  const { rerender } = render(
    <Insights {...props} evidenceRequest={request} />,
  );
  expect(screen.getByLabelText("Finance details evidence")).toBeInTheDocument();
  expect(props.onEvidenceReady).toHaveBeenCalledWith(
    request,
    screen.getByLabelText("Finance details evidence"),
  );
  expect(JSON.parse(localStorage.getItem("insightsLayers")!)).toEqual(
    configured,
  );
  rerender(<Insights {...props} />);
  await choosePreset("Reliability");
  expect(
    screen.queryByLabelText("Finance details evidence"),
  ).not.toBeInTheDocument();
  expect(JSON.parse(localStorage.getItem("insightsLayers")!)).not.toContain(
    "financeDetails",
  );
  rerender(<Insights {...props} evidenceRequest={{ ...request, id: 2 }} />);
  expect(screen.getByText(/Temporary evidence/)).toBeInTheDocument();
  rerender(<Insights {...props} />);
  await user.click(screen.getByRole("button", { name: /Layers/ }));
  await user.click(
    screen.getByRole("button", { name: "Keep Finance details" }),
  );
  expect(screen.queryByText(/Temporary evidence/)).not.toBeInTheDocument();
  expect(JSON.parse(localStorage.getItem("insightsLayers")!)).toContain(
    "financeDetails",
  );
});

function render(element: React.ReactElement) {
  const store = configureStore({ reducer: { ui: uiReducer } });
  return renderUI(element, {
    wrapper: ({ children }) => <Provider store={store}>{children}</Provider>,
  });
}

it("reorders configured charts while ending temporary reveal without saving it", async () => {
  localStorage.clear();
  localStorage.setItem(
    "insightsLayers",
    JSON.stringify(["supplyDemand", "cash"]),
  );
  const props = {
    game: createGame({ scenarioId: 101 }),
    selectedFacilityId: null,
    facilityDragActive: false,
    onEvidenceReady: jest.fn(),
  };
  const { rerender } = render(
    <Insights
      {...props}
      evidenceRequest={{ id: 1, runId: 0, target: "finances" }}
    />,
  );
  await user.click(screen.getByRole("button", { name: /Layers/ }));
  expect(
    screen.getByRole("button", { name: "Move Finance details up" }),
  ).toBeDisabled();
  expect(
    screen.getByRole("button", { name: "Keep Finance details" }),
  ).toBeEnabled();
  rerender(<Insights {...props} />);
  await user.click(screen.getByRole("button", { name: "Move Cash up" }));
  expect(screen.queryByText(/Temporary evidence/)).not.toBeInTheDocument();
  expect(
    screen.queryByLabelText("Finance details evidence"),
  ).not.toBeInTheDocument();
  expect(JSON.parse(localStorage.getItem("insightsLayers")!)).toEqual([
    "cash",
    "supplyDemand",
  ]);
});
// MUI interaction tests share the coverage runner with the simulation suite in CI, where opening
// and clicking several portal-backed controls can legitimately exceed Jest's 5 second default.
jest.setTimeout(15_000);

function renderInsights(
  scenarioId = 100,
  suppliedGame?: GameType,
  upcomingEvents?: UpcomingStoryEventType[],
) {
  return render(
    <Insights
      game={
        suppliedGame ||
        (scenarioId === 100 ? overviewGame : createGame({ scenarioId }))
      }
      selectedFacilityId={null}
      facilityDragActive={false}
      upcomingEvents={upcomingEvents}
    />,
  );
}

function gameWithHistory(): GameType {
  const game = createGame({ scenarioId: 100 });
  game.date = {
    ...game.date,
    minute: 24 * MINUTES_PER_MONTH,
    monthsElapsed: 24,
    monthNumber: 1,
    year: game.startingYear + 2,
  };
  game.monthlyHistory = [
    {
      ...EMPTY_HISTORY,
      year: game.startingYear + 1,
      month: 1,
      supplyWh: 110_000,
      demandWh: 110_000,
      cash: 1_400_000,
      customers: 1_200,
      revenue: 220_000,
    },
    {
      ...EMPTY_HISTORY,
      year: game.startingYear,
      month: 2,
      supplyWh: 90_000,
      demandWh: 100_000,
      cash: 1_200_000,
      customers: 1_100,
      revenue: 200_000,
    },
    {
      ...EMPTY_HISTORY,
      year: game.startingYear,
      month: 1,
      supplyWh: 80_000,
      demandWh: 80_000,
      cash: 1_000_000,
      customers: 1_000,
      revenue: 180_000,
    },
  ];
  return game;
}

async function choosePreset(label: string) {
  await user.click(screen.getByRole("combobox", { name: "Insight preset" }));
  await user.click(within(await screen.findByRole("listbox")).getByText(label));
}

function storeCustomPreset(name: string) {
  const layers = [...INSIGHT_PRESETS.overview.layers];
  localStorage.setItem(
    "insightsPresetLibrary",
    JSON.stringify({
      defaults: {},
      custom: [{ id: "1", name, layers }],
    }),
  );
  localStorage.setItem("insightsLayers", JSON.stringify(layers));
  localStorage.setItem("insightsActivePreset", "saved:1");
}

describe("Insights layers", () => {
  let overviewProjection: ProjectionView;
  beforeAll(() => {
    // Layer/preset controls share immutable real inputs and a real forecast. Cache
    // regression cases still create independent games with distinct history identities.
    overviewGame = createNextState(createGame({ scenarioId: 100 }), () => {});
    overviewProjection = createNextState(
      selectProjection(overviewGame, overviewGame.timeline[0]),
      () => {},
    );
  });
  beforeEach(() => {
    localStorage.clear();
    // Other cases play different seeds and locations. Reusing the immutable game
    // must not inherit their mutable weather/fuel/economy projection caches.
    loadSimData(overviewGame.location);
    cacheProjection(overviewGame, overviewProjection);
  });

  it("offers chart expansion beside plotted layers, never summaries", () => {
    localStorage.setItem(
      "insightsLayers",
      JSON.stringify(INSIGHT_LAYERS.map((layer) => layer.id)),
    );
    renderInsights();
    const tracks = screen.getAllByRole("region", { name: / evidence$/ });
    for (const track of tracks) {
      const name = track.getAttribute("aria-label")!.replace(/ evidence$/, "");
      const expand = within(track).queryByRole("button", {
        name: `Expand ${name} chart`,
      });
      expect(expand !== null).toBe(
        !["Power exchange", "Finance details"].includes(name),
      );
    }
  });

  it("keeps fuel selection and time zoom when expanding and closing a chart", async () => {
    localStorage.setItem(
      "insightsLayers",
      JSON.stringify(["fuelPrices", "cash"]),
    );
    renderInsights();
    const layers = localStorage.getItem("insightsLayers");
    fireEvent.click(screen.getByRole("button", { name: "Coal" }));
    expect(
      screen.getByRole("img", { name: "Fuel price inspection" }),
    ).toHaveAttribute("data-fuel", "Coal");
    const expand = screen.getByRole("button", {
      name: "Expand Fuel Prices chart",
    });
    act(() => expand.focus());
    fireEvent.click(expand);
    const dialog = screen.getByRole("dialog", { name: "Fuel Prices" });
    expect(
      within(dialog).getByRole("button", { name: "Coal" }),
    ).toHaveAttribute("aria-pressed", "true");
    const chart = within(dialog).getByRole("img", {
      name: "Fuel price inspection",
    });
    expect(chart).toHaveAttribute("data-fuel", "Coal");
    fireEvent.click(within(dialog).getByRole("button", { name: "Zoom in" }));
    const date = within(dialog).getByLabelText(
      /^Displayed date range:/,
    ).textContent;
    fireEvent.click(within(dialog).getByRole("button", { name: "All fuels" }));
    expect(
      within(dialog).getByRole("img", { name: "Fuel price inspection" }),
    ).toHaveAttribute("data-fuel", "all");
    fireEvent.keyDown(dialog, { key: "Escape" });
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(expand).toHaveFocus();
    expect(screen.getByLabelText(/^Displayed date range:/)).toHaveTextContent(
      date!,
    );
    expect(localStorage.getItem("insightsLayers")).toBe(layers);
    expect(screen.getByRole("button", { name: "All fuels" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("shows expanded finance rows and both rate graphs", () => {
    localStorage.setItem(
      "insightsLayers",
      JSON.stringify(["financeDetails", "inflationInterest"]),
    );
    const game = overviewGame;
    renderInsights(100, game);
    for (const label of [
      "Fuel",
      "Operations & maintenance",
      "Loan interest",
      "Carbon fees",
      "Profit per kWh",
      "Net worth",
      "Current interest rate",
    ]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    const interestRow = screen.getByRole("row", {
      name: /Current interest rate/,
    });
    expect(interestRow).toHaveTextContent(
      (game.timeline[0].interestRate * 100).toFixed(2) + "%",
    );
    expect(
      screen.getByTestId("chartInsightsInflationInterestPlotinflationRate"),
    ).toHaveAttribute("data-visible-title", "Inflation");
    expect(
      screen.getByTestId("chartInsightsInflationInterestPlotinterestRate"),
    ).toHaveAttribute("data-visible-title", "Interest rate");
  });

  it("starts new players on reliability, cash and climate impact without editing controls", async () => {
    renderInsights();

    expect(
      screen.getByRole("combobox", { name: "Insight preset" }),
    ).toHaveTextContent("Overview");
    const headings = screen.getAllByRole("heading", { level: 6 });
    const expected = [
      "Insights",
      "Supply & Demand",
      "Cash",
      "Emissions (CO₂e)",
    ];
    expect(headings).toHaveLength(expected.length);
    expected.forEach((label, index) =>
      expect(headings[index]).toHaveTextContent(label),
    );
    expect(
      screen.queryByRole("button", { name: "Remove Cash" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Chart time key")).not.toBeInTheDocument();
    await user.click(labelledButton(/Layers/));
    expect(labelledButton("Remove Cash")).toBeEnabled();
    expect(labelledButton("Move Cash up")).toBeEnabled();
    await user.click(labelledButton("Done choosing layers"));
    expect(
      screen.queryByRole("button", { name: "Remove Cash" }),
    ).not.toBeInTheDocument();
  });

  it("adds monthly lowest spare capacity to Reliability and lets players toggle the layer", async () => {
    renderInsights();
    await choosePreset("Reliability");
    const track = screen.getByRole("region", {
      name: "Lowest reserve evidence",
    });
    expect(
      within(track).getByRole("img", { name: /Monthly lowest reserve/ }),
    ).toBeInTheDocument();
    const headings = screen.getAllByRole("heading", { level: 6 });
    expect(headings[1]).toHaveTextContent("Supply & Demand");
    expect(headings[2]).toHaveTextContent("Lowest reserve");
    await user.click(labelledButton(/Layers/));
    await user.click(
      screen.getByRole("checkbox", {
        name: "Lowest reserve",
      }),
    );
    expect(
      screen.queryByRole("region", { name: "Lowest reserve evidence" }),
    ).not.toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem("insightsLayers")!)).not.toContain(
      "spareCapacity",
    );
  });

  // Regression test. Construction progress was part of the projection's cache key, so every
  // tick of a build re-simulated the long-range forecast from a start that had moved on by one
  // tick, and its hourly samples (wind most visibly) jittered from frame to frame
  it("keeps the long-range projection stable while a facility is under construction", () => {
    const game = createGame({
      scenarioId: 100,
      initialBuild: { name: "Wind", peakW: 100000000, financed: true },
    });
    expect(game.facilities.some((f) => f.yearsToBuildLeft > 0)).toBe(true);
    const generate = jest.spyOn(GameModule, "generateForecastTimeline");
    const props = {
      selectedFacilityId: null,
      facilityDragActive: false,
    };
    const { rerender } = render(<Insights game={game} {...props} />);
    const calls = generate.mock.calls.length;

    const nextTick = cloneDeep(game);
    // Immer preserves completed history during ordinary ticks.
    nextTick.monthlyHistory = game.monthlyHistory;
    nextTick.date = { ...nextTick.date, minute: nextTick.date.minute + 15 };
    nextTick.facilities.forEach((facility) => {
      if (facility.yearsToBuildLeft > 0) facility.yearsToBuildLeft -= 0.001;
    });
    rerender(<Insights game={nextTick} {...props} />);

    expect(generate.mock.calls.length).toBe(calls);
    generate.mockRestore();
  });

  it("shows in-range scenario events and reveals their forecast details", async () => {
    localStorage.setItem("insightsRange", "next1");
    renderInsights(100, undefined, [
      {
        key: "fee-onset",
        startsMinute: 6 * MINUTES_PER_MONTH,
        endsMinute: 7 * MINUTES_PER_MONTH,
        label: "Expected Jul 2023",
        title: "Higher carbon fee begins",
        message: "Polluting plants become more expensive to run.",
      },
      {
        key: "later-event",
        startsMinute: 180 * MINUTES_PER_MONTH,
        endsMinute: 181 * MINUTES_PER_MONTH,
        label: "Expected Jan 2035",
        title: "Outside range",
        message: "This should not be shown.",
      },
    ]);

    const region = screen.getByRole("region", {
      name: "Upcoming scenario events",
    });
    expect(region).toHaveTextContent("Jul 2023");
    expect(region).toHaveTextContent("Higher carbon fee begins");
    const event = within(region).getByRole("button", {
      name: "Expected Jul 2023: Higher carbon fee begins",
    });
    expect(event).toHaveAttribute("aria-expanded", "false");
    await user.click(event);
    expect(event).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("dialog")).toHaveTextContent(
      "Polluting plants become more expensive to run.",
    );
    await user.click(event);
    expect(event).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("dialog")).toBeNull();
    await user.click(event);
    await user.click(screen.getByRole("button", { name: "Zoom to event" }));
    expect(screen.getByTestId("supply-demand-chart")).toHaveAttribute(
      "data-domain",
      JSON.stringify([5.9 * MINUTES_PER_MONTH, 7.1 * MINUTES_PER_MONTH]),
    );
    expect(screen.queryByRole("dialog")).toBeNull();
    await user.keyboard("{Escape}");
    expect(event).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(region).not.toHaveTextContent("Outside range");
  });

  it("ignores the removed stored horizon and shows only events in the viewport", () => {
    localStorage.setItem("insightsRange", "all");
    renderInsights(100, gameWithHistory(), [
      {
        key: "future",
        startsMinute: 150 * MINUTES_PER_MONTH,
        endsMinute: 151 * MINUTES_PER_MONTH,
        label: "Expected Jul 2032",
        title: "Future event",
        message: "Forecast only.",
      },
    ]);

    expect(
      screen.queryByRole("region", { name: "Upcoming scenario events" }),
    ).toBeNull();
  });

  it("zooms and pans every insight chart on one shared time viewport", async () => {
    renderInsights();

    const supply = screen.getByTestId("supply-demand-chart");
    const cash = screen.getByTestId("chartInsightsCashPlot");
    const initial = JSON.parse(supply.getAttribute("data-domain") || "[]");
    expect(cash).toHaveAttribute("data-domain", JSON.stringify(initial));
    expect(labelledButton("Pan earlier")).toBeDisabled();
    expect(labelledButton("Zoom out")).toBeDisabled();

    await user.click(labelledButton("Zoom in"));
    const zoomed = JSON.parse(supply.getAttribute("data-domain") || "[]");
    expect(zoomed[1] - zoomed[0]).toBeCloseTo((initial[1] - initial[0]) / 2);
    expect(cash).toHaveAttribute("data-domain", JSON.stringify(zoomed));
    expect(
      screen.getByLabelText("Displayed date range: 2023–28"),
    ).toBeVisible();
    expect(labelledButton("Pan earlier")).toBeEnabled();
    expect(labelledButton("Pan later")).toBeEnabled();

    await user.click(labelledButton("Pan later"));
    expect(supply.getAttribute("data-domain")).not.toBe(JSON.stringify(zoomed));
    await user.click(labelledButton("Zoom out"));
    expect(screen.getByTestId("supply-demand-chart")).toHaveAttribute(
      "data-domain",
      JSON.stringify([0, getScenario(100)!.durationMonths * MINUTES_PER_MONTH]),
    );
    expect(
      screen.getByLabelText("Displayed date range: 2020–31"),
    ).toBeVisible();
    expect(labelledButton("Zoom out")).toBeDisabled();
    expect(
      screen.queryByText(/Monthly forecast ranges show/),
    ).not.toBeInTheDocument();
    await user.click(labelledButton("Fit full timeline"));
    expect(
      screen.getByLabelText("Displayed date range: 2020–39"),
    ).toBeVisible();
    // Already wider than the scenario: nothing further out to go to.
    expect(labelledButton("Zoom out")).toBeDisabled();
  });

  it.each([1, 12, 60, 192, 0])(
    "opens on the scenario span, with a 20-year fallback for duration %s",
    (durationMonths) => {
      const game = overviewGame;
      const months = durationMonths || 20 * 12;
      renderInsights(100, {
        ...game,
        scenarioId: CUSTOM_SCENARIO_ID,
        customScenario: {
          ...getScenario(100)!,
          id: CUSTOM_SCENARIO_ID,
          durationMonths,
        },
      });
      expect(screen.getByTestId("supply-demand-chart")).toHaveAttribute(
        "data-domain",
        JSON.stringify([0, months * MINUTES_PER_MONTH]),
      );
      expect(labelledButton("Zoom out")).toBeDisabled();
    },
  );

  it("opens on the full scenario and keeps its endpoints as the game advances", () => {
    const game = overviewGame;
    const view = renderInsights(100, game);
    const supply = screen.getByTestId("supply-demand-chart");
    expect(supply).toHaveAttribute(
      "data-domain",
      JSON.stringify([0, getScenario(100)!.durationMonths * MINUTES_PER_MONTH]),
    );

    const nextGame = {
      ...game,
      date: {
        ...game.date,
        minute: game.date.minute + MINUTES_PER_MONTH,
        monthsElapsed: game.date.monthsElapsed + 1,
      },
    };
    view.rerender(
      <Insights
        game={nextGame}
        selectedFacilityId={null}
        facilityDragActive={false}
      />,
    );

    expect(supply).toHaveAttribute(
      "data-domain",
      JSON.stringify([0, getScenario(100)!.durationMonths * MINUTES_PER_MONTH]),
    );
  });

  it.each([
    [962e6, 1.01e12, "~1TWh unmet · ~960MW peak"],
    [9.96e6, 999e9, "~1TWh unmet · ~10MW peak"],
    [12.6e6, 126e9, "~130GWh unmet · ~13MW peak"],
  ])(
    "rounds shortfall estimates to two significant digits (%s W, %s Wh)",
    (peakW, wh, text) => {
      const shortfall = jest
        .spyOn(
          Insights.prototype as unknown as {
            rangeShortfall: () => ProjectionView["shortfall"];
          },
          "rangeShortfall",
        )
        .mockReturnValue({ peakW, wh, label: "2020–31" });
      try {
        renderInsights();
        const note = screen.getByRole("note", { name: /^Forecast shortfall/ });
        expect(note).toHaveTextContent(text);
        expect(note).toHaveAccessibleName(/of demand unmet, about .* peak$/);
      } finally {
        shortfall.mockRestore();
      }
    },
  );

  it("sizes the forecast shortfall to the displayed range", async () => {
    const game = createGame({ scenarioId: 100 });
    game.facilities = [];
    renderInsights(100, game);
    const note = screen.getByRole("note", {
      name: /^Forecast shortfall for 2020–31:/,
    });
    expect(note).toHaveTextContent(
      /^Shortfall, 2020–31:\s*~.+ unmet · ~.+ peak$/,
    );
    const wholeScenario = note.textContent;

    await user.click(labelledButton("Zoom in"));
    expect(
      screen.getByRole("note", {
        name: /^Forecast shortfall for 2023–28:/,
      }),
    ).not.toHaveTextContent(wholeScenario!);
  });

  it("reports the viewport and reopens on it after the pane remounts", async () => {
    const game = overviewGame;
    const onViewportChange = jest.fn();
    const view = render(
      <Insights
        game={game}
        selectedFacilityId={null}
        facilityDragActive={false}
        onViewportChange={onViewportChange}
      />,
    );
    await user.click(labelledButton("Zoom in"));
    const saved = onViewportChange.mock.calls.at(-1)[0];
    const zoomed = screen
      .getByTestId("supply-demand-chart")
      .getAttribute("data-domain");
    expect(JSON.stringify(saved.viewport)).toBe(zoomed);
    view.unmount();

    render(
      <Insights
        game={game}
        selectedFacilityId={null}
        facilityDragActive={false}
        savedViewport={saved}
      />,
    );
    expect(screen.getByTestId("supply-demand-chart")).toHaveAttribute(
      "data-domain",
      zoomed!,
    );
  });

  it("follows a month without another Redux save and restores that range after remounting", async () => {
    // React keeps derived state out of the update queue's base state while the component has
    // pending work, so every synchronous render until that work lands derives the month's
    // viewport again. Automatic following needs no Redux update, even with pending work.
    const game = overviewGame;
    const nextMonth = {
      ...game,
      date: {
        ...game.date,
        minute: game.date.minute + MINUTES_PER_MONTH,
        monthsElapsed: game.date.monthsElapsed + 1,
      },
    };
    const insights = React.createRef<Insights>();
    const saves: { viewport: [number, number]; month: number }[] = [];
    let setGame: (game: GameType) => void = () => undefined;
    function Host() {
      const [current, setCurrent] = React.useState(game);
      const [saved, setSaved] = React.useState<(typeof saves)[number]>();
      setGame = setCurrent;
      return (
        <Insights
          ref={insights}
          game={current}
          savedViewport={saved}
          selectedFacilityId={null}
          facilityDragActive={false}
          onViewportChange={(next) => {
            saves.push(next);
            setSaved(next);
          }}
        />
      );
    }
    const view = render(<Host />);
    // The player's edit is saved; following the month can later be derived from that saved month.
    await user.click(labelledButton("Zoom in"));
    const zoomed = saves.at(-1)!;
    saves.length = 0;

    act(() => {
      React.startTransition(() => insights.current!.forceUpdate());
      flushSync(() => setGame(nextMonth));
    });

    const advanced = zoomed.viewport.map(
      (minute) => minute + MINUTES_PER_MONTH,
    );
    expect(saves).toEqual([]);
    expect(screen.getByTestId("supply-demand-chart")).toHaveAttribute(
      "data-domain",
      JSON.stringify(advanced),
    );
    view.unmount();
    const onViewportChange = jest.fn();
    render(
      <Insights
        game={nextMonth}
        savedViewport={zoomed}
        selectedFacilityId={null}
        facilityDragActive={false}
        onViewportChange={onViewportChange}
      />,
    );
    expect(screen.getByTestId("supply-demand-chart")).toHaveAttribute(
      "data-domain",
      JSON.stringify(advanced),
    );
    await user.click(labelledButton("Zoom in"));
    const edited = onViewportChange.mock.calls.at(-1)![0];
    expect(edited.month).toBe(nextMonth.date.monthsElapsed);
    expect(screen.getByTestId("supply-demand-chart")).toHaveAttribute(
      "data-domain",
      JSON.stringify(edited.viewport),
    );
  });

  it("slides both ends of an unanchored viewport as the game advances", async () => {
    const game = overviewGame;
    const view = renderInsights(100, game);
    const supply = screen.getByTestId("supply-demand-chart");
    await user.click(labelledButton("Zoom in"));
    const before = JSON.parse(supply.getAttribute("data-domain") || "[]");

    const nextGame = {
      ...game,
      date: {
        ...game.date,
        minute: game.date.minute + MINUTES_PER_MONTH,
        monthsElapsed: game.date.monthsElapsed + 1,
      },
    };
    view.rerender(
      <Insights
        game={nextGame}
        selectedFacilityId={null}
        facilityDragActive={false}
      />,
    );
    const after = JSON.parse(supply.getAttribute("data-domain") || "[]");

    expect(after).toEqual(
      before.map((minute: number) => minute + MINUTES_PER_MONTH),
    );
  });

  it("keeps tutorial targets visible without duplicating stored layers", () => {
    expect(withRequiredLayers(["profit"], 4)).toEqual([
      "profit",
      "financeDetails",
    ]);
    expect(withRequiredLayers(["profit", "financeDetails"], 4)).toEqual([
      "profit",
      "financeDetails",
    ]);
    expect(withRequiredLayers(["cash", "powerExchange"], 112)).toEqual([
      "powerExchange",
      "cash",
    ]);
  });

  it("puts Mission 7's required exchange track first once its line opens", () => {
    localStorage.setItem(
      "insightsLayers",
      JSON.stringify(["cash", "supplyDemand"]),
    );
    const game = cloneDeep(
      gameReducer(
        createGame({ scenarioId: 112 }),
        buildTransmissionLine({
          corridorId: "california-north",
          financed: true,
        }),
      ),
    );
    game.transmission!.lines[0].yearsToBuildLeft = 0;

    renderInsights(112, game);

    expect(screen.getAllByRole("heading", { level: 6 })[1]).toHaveTextContent(
      "Power exchange",
    );
    const exchange = screen.getByRole("region", {
      name: "Power exchange evidence",
    });
    expect(
      within(exchange).getByRole("button", { name: "What is Interties?" }),
    ).toBeVisible();
    expect(within(exchange).queryByText("How interties work")).toBeNull();
    expect(localStorage.getItem("insightsLayers")).toBe(
      JSON.stringify(["cash", "supplyDemand"]),
    );
  });

  it("scrolls the power exchange into view on the phone step that points to it", () => {
    jest.useFakeTimers();
    const game = cloneDeep(
      gameReducer(
        createGame({ scenarioId: 112 }),
        buildTransmissionLine({
          corridorId: "california-north",
          financed: true,
        }),
      ),
    );
    game.transmission!.lines[0].yearsToBuildLeft = 0;
    game.tutorialStep = getScenario(112)!.tutorialSteps!.findIndex(
      (step) => step.target === '[data-layer="powerExchange"]',
    );
    expect(game.tutorialStep).toBeGreaterThan(0);
    const width = window.innerWidth;
    const scrolled: Element[] = [];
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 390,
    });
    const original = HTMLElement.prototype.scrollIntoView;
    HTMLElement.prototype.scrollIntoView = function (this: HTMLElement) {
      scrolled.push(this);
    };
    try {
      renderInsights(112, game);
      act(() => jest.runOnlyPendingTimers());
      expect(scrolled).toHaveLength(1);
      expect(scrolled[0]).toHaveAttribute("data-layer", "powerExchange");
    } finally {
      HTMLElement.prototype.scrollIntoView = original;
      Object.defineProperty(window, "innerWidth", {
        configurable: true,
        value: width,
      });
    }
  });

  it("gives the customer chart two significant digits on axes and three on inspection", () => {
    localStorage.setItem("insightsLayers", JSON.stringify(["customers"]));
    renderInsights();
    const chart = screen.getByTestId("chartInsightsCustomersPlot");
    expect(chart).toHaveAttribute("data-axis-value", "120K");
    expect(chart).toHaveAttribute("data-inspected-value", "123K");
  });

  it("applies presets and gives every chart the shared cursor key", async () => {
    renderInsights();
    await choosePreset("Profitability");

    expect(screen.getByText("Profit", { selector: "h6" })).toBeVisible();
    expect(screen.getByText("Fuel Prices", { selector: "h6" })).toBeVisible();
    screen
      .getAllByRole("img")
      .forEach((chart) =>
        expect(chart).toHaveAttribute("data-sync-key", "insights"),
      );
  });

  it("persists edited layer order, saves the preset, and restores its original layers", async () => {
    let view = renderInsights();
    await user.click(labelledButton(/Layers/));
    await user.click(screen.getByRole("checkbox", { name: "Revenue" }));
    await user.click(labelledButton("Move Revenue up"));

    const layers = ["supplyDemand", "cash", "revenue", "emissions"];
    expect(JSON.parse(localStorage.getItem("insightsLayers")!)).toEqual(layers);
    view.unmount();
    view = renderInsights();
    expect(screen.getByText("Revenue", { selector: "h6" })).toBeVisible();
    expect(
      screen.getByRole("combobox", { name: "Insight preset" }),
    ).toHaveTextContent("OverviewEdited");
    const headings = screen
      .getAllByRole("heading", { level: 6 })
      .map((heading) => heading.textContent);
    expect(headings.indexOf("Revenue")).toBeLessThan(
      headings.indexOf("Emissions (CO₂e)"),
    );

    await user.click(labelledButton("Preset actions"));
    await user.click(screen.getByRole("menuitem", { name: "Save changes" }));

    const library = JSON.parse(
      localStorage.getItem("insightsPresetLibrary") || "{}",
    );
    expect(library.defaults.overview).toEqual(layers);
    view.unmount();

    renderInsights();
    expect(screen.getByText("Revenue", { selector: "h6" })).toBeVisible();
    expect(
      screen
        .getAllByRole("heading", { level: 6 })
        .map((heading) => heading.textContent),
    ).toEqual(headings);
    expect(
      screen.getByRole("combobox", { name: "Insight preset" }),
    ).toHaveTextContent("Overview");
    expect(
      screen.getByRole("combobox", { name: "Insight preset" }),
    ).not.toHaveTextContent("Edited");
    await user.click(labelledButton("Preset actions"));
    await user.click(
      screen.getByRole("menuitem", { name: "Reset to default" }),
    );
    await user.click(screen.getByRole("button", { name: "Restore" }));

    expect(screen.queryByText("Revenue", { selector: "h6" })).toBeNull();
    const restoredLibrary = JSON.parse(
      localStorage.getItem("insightsPresetLibrary") || "{}",
    );
    expect(restoredLibrary.defaults.overview).toBeUndefined();
  });

  it("resets unsaved changes to a standard preset", async () => {
    renderInsights();
    await user.click(labelledButton(/Layers/));
    await user.click(screen.getByRole("checkbox", { name: "Revenue" }));
    await user.click(labelledButton("Preset actions"));
    await user.click(
      screen.getByRole("menuitem", { name: "Reset to default" }),
    );
    await user.click(screen.getByRole("button", { name: "Restore" }));
    expect(screen.queryByText("Revenue", { selector: "h6" })).toBeNull();
    await user.click(labelledButton("Preset actions"));
    expect(
      screen.getByRole("menuitem", { name: "Save changes" }),
    ).toHaveAttribute("aria-disabled", "true");
  });

  it("only groups the preset choices when custom presets exist", async () => {
    const view = renderInsights();
    await user.click(screen.getByRole("combobox", { name: "Insight preset" }));
    expect(screen.queryByText("Default presets")).toBeNull();
    expect(screen.queryByText("Your presets")).toBeNull();
    expect(screen.queryByRole("option", { name: "Unsaved view" })).toBeNull();
    await user.keyboard("{Escape}");
    view.unmount();

    storeCustomPreset("Peak watch");
    renderInsights();
    await user.click(screen.getByRole("combobox", { name: "Insight preset" }));
    expect(screen.getByText("Default presets")).toBeVisible();
    expect(screen.getByText("Your presets", { exact: true })).toBeVisible();
    expect(screen.getByRole("option", { name: "Peak watch" })).toBeVisible();
    expect(screen.queryByRole("option", { name: "Unsaved view" })).toBeNull();
  });

  it("creates and updates a named preset", async () => {
    renderInsights();
    await user.click(labelledButton("Preset actions"));
    await user.click(screen.getByRole("menuitem", { name: "Save as new" }));
    await user.type(
      screen.getByRole("textbox", { name: "Preset name" }),
      "Peak watch",
    );
    await user.click(screen.getByRole("button", { name: "Save preset" }));

    expect(
      screen.getByRole("combobox", { name: "Insight preset" }),
    ).toHaveTextContent("Peak watch");

    await user.click(labelledButton(/Layers/));
    await user.click(screen.getByRole("checkbox", { name: "Revenue" }));
    const preset = screen.getByRole("combobox", { name: "Insight preset" });
    expect(preset).toHaveTextContent("Peak watchEdited");
    await user.click(preset);
    expect(screen.getByRole("option", { name: "Peak watch" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.queryByRole("option", { name: "Unsaved view" })).toBeNull();
    await user.keyboard("{Escape}");
    await user.click(labelledButton("Preset actions"));
    await user.click(screen.getByRole("menuitem", { name: "Save changes" }));
    const library = JSON.parse(
      localStorage.getItem("insightsPresetLibrary") || "{}",
    );
    expect(library.custom[0]).toMatchObject({
      name: "Peak watch",
      layers: expect.arrayContaining(["revenue"]),
    });
  });

  it("renames a saved preset across mounts and deletes it", async () => {
    storeCustomPreset("Peak watch");
    const view = renderInsights();

    await user.click(labelledButton("Preset actions"));
    await user.click(screen.getByRole("menuitem", { name: /Rename/ }));
    const name = screen.getByRole("textbox", { name: "Preset name" });
    await user.clear(name);
    await user.type(name, "Morning peak");
    await user.click(screen.getByRole("button", { name: "Rename" }));
    expect(
      screen.getByRole("combobox", { name: "Insight preset" }),
    ).toHaveTextContent("Morning peak");

    view.unmount();
    renderInsights();
    expect(
      screen.getByRole("combobox", { name: "Insight preset" }),
    ).toHaveTextContent("Morning peak");
    await user.click(labelledButton("Preset actions"));
    await user.click(screen.getByRole("menuitem", { name: /Delete custom/ }));
    await user.click(screen.getByRole("button", { name: "Delete" }));
    expect(
      screen.getByRole("combobox", { name: "Insight preset" }),
    ).toHaveTextContent("Unsaved view");
    const library = JSON.parse(
      localStorage.getItem("insightsPresetLibrary") || "{}",
    );
    expect(library.custom).toEqual([]);
  });

  it("caps the custom preset library at ten entries", async () => {
    localStorage.setItem(
      "insightsPresetLibrary",
      JSON.stringify({
        defaults: {},
        custom: Array.from(
          { length: MAX_CUSTOM_INSIGHT_PRESETS },
          (_, index) => ({
            id: String(index + 1),
            name: `Preset ${index + 1}`,
            layers: ["supplyDemand"],
          }),
        ),
      }),
    );
    renderInsights();

    await user.click(labelledButton("Preset actions"));
    expect(
      screen.getByRole("menuitem", { name: "Save as new" }),
    ).toHaveAttribute("aria-disabled", "true");
  });

  it("combines recorded monthly data with the continuous forecast", async () => {
    localStorage.setItem(
      "insightsLayers",
      JSON.stringify(["supplyDemand", "profit", "fuelPrices"]),
    );
    const game = gameWithHistory();
    renderInsights(100, game);

    await user.click(labelledButton("Fit full timeline"));

    expect(
      screen.queryByRole("region", { name: "Electricity pricing" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText("Supply & Demand", { selector: "h6" }),
    ).toBeVisible();
    expect(screen.getByText("Profit", { selector: "h6" })).toBeVisible();
    expect(screen.getByText("Fuel Prices", { selector: "h6" })).toBeVisible();
    expect(
      Number(
        screen
          .getByTestId("chartInsightsProfitPlot")
          .getAttribute("data-points"),
      ),
    ).toBeGreaterThan(240);
    expect(
      Number(
        screen.getByTestId("supply-demand-chart").getAttribute("data-points"),
      ),
    ).toBeGreaterThan(3);

    await user.click(labelledButton(/Layers/));
    expect(screen.getByRole("checkbox", { name: "Fuel Prices" })).toBeEnabled();
    expect(screen.getByRole("checkbox", { name: "Profit" })).toBeEnabled();
  });

  it("defers chart projection updates until a facility drag ends", () => {
    const game = createGame({ scenarioId: 100 });
    const props: React.ComponentProps<typeof Insights> = {
      game,
      selectedFacilityId: null,
      facilityDragActive: false,
    };
    mockSupplyDemandPaints = 0;
    const view = render(<Insights {...props} />);
    const chartCountBeforeDrag = mockSupplyDemandPaints;
    const nextGame = {
      ...game,
      date: { ...game.date, monthsElapsed: game.date.monthsElapsed + 1 },
    };

    view.rerender(
      <Insights {...props} game={nextGame} facilityDragActive={true} />,
    );
    expect(mockSupplyDemandPaints).toBe(chartCountBeforeDrag);

    view.rerender(
      <Insights {...props} game={nextGame} facilityDragActive={false} />,
    );
    expect(mockSupplyDemandPaints).toBeGreaterThan(chartCountBeforeDrag);
  });

  it("refreshes a visible power exchange on ticks and speed changes", () => {
    localStorage.setItem("insightsLayers", JSON.stringify(["powerExchange"]));
    const game = cloneDeep(
      gameReducer(
        createGame({ scenarioId: 100, seed: 61 }),
        buildTransmissionLine({
          corridorId: "california-north",
          financed: true,
        }),
      ),
    );
    game.transmission!.lines[0].yearsToBuildLeft = 0;
    const props: React.ComponentProps<typeof Insights> = {
      game,
      selectedFacilityId: null,
      facilityDragActive: false,
    };
    const ref = React.createRef<Insights>();
    render(<Insights {...props} ref={ref} />);

    expect(
      ref.current!.shouldComponentUpdate(
        {
          ...props,
          game: {
            ...game,
            speed: game.speed === "PAUSED" ? "NORMAL" : "PAUSED",
          },
        },
        ref.current!.state,
      ),
    ).toBe(true);
    expect(
      ref.current!.shouldComponentUpdate(
        {
          ...props,
          game: {
            ...game,
            date: { ...game.date, minute: game.date.minute + 600 },
          },
        },
        ref.current!.state,
      ),
    ).toBe(true);
  });

  it("does not offer the power-exchange layer for an explicitly islanded grid", async () => {
    const game = cloneDeep(
      gameReducer(
        createGame({ scenarioId: 100, seed: 61 }),
        buildTransmissionLine({
          corridorId: "california-north",
          financed: true,
        }),
      ),
    );
    game.transmission!.lines[0].yearsToBuildLeft = 0;
    game.location = { ...game.location, id: "HNL", name: "Honolulu, HI" };

    renderInsights(100, game);
    await user.click(labelledButton(/Layers/));

    expect(
      screen.queryByRole("checkbox", { name: "Power exchange" }),
    ).toBeNull();
    expect(screen.queryByText("Power exchange", { selector: "h6" })).toBeNull();
  });
});

function labelledButton(label: string | RegExp): HTMLElement {
  const button = screen.getByLabelText(label, {
    selector: "button",
  });
  expect(button).toBeVisible();
  expect(isInaccessible(button)).toBe(false);
  return button;
}

it("does not relabel cached simulated samples as recorded history as time advances", () => {
  localStorage.clear();
  localStorage.setItem("insightsLayers", JSON.stringify(["supplyDemand"]));
  const game = createGame({ scenarioId: 100 });
  const props = {
    game,
    selectedFacilityId: null,
    facilityDragActive: false,
  };
  const { rerender } = render(<Insights {...props} />);
  expect(screen.getByTestId("supply-demand-chart")).toHaveAttribute(
    "data-forecast-start",
    "0",
  );
  rerender(
    <Insights
      {...props}
      game={{ ...game, date: { ...game.date, minute: 120 } }}
      selectedFacilityId={game.facilities[0].id}
    />,
  );
  expect(screen.getByTestId("supply-demand-chart")).toHaveAttribute(
    "data-forecast-start",
    "0",
  );
});
