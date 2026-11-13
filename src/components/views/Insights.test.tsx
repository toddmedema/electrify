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
import {
  EMPTY_HISTORY,
  MINUTES_PER_MONTH,
  getDateFromMinute,
} from "../../helpers/DateTime";
import { CUSTOM_SCENARIO_ID, getScenario } from "../../data/Scenarios";
import * as GameModule from "../../reducers/Game";
import gameReducer, { buildTransmissionLine } from "../../reducers/Game";
import { cancelPolicy, schedulePolicy } from "../../reducers/GameActions";
import uiReducer from "../../reducers/UI";
import { createGame } from "../../testing/Simulator";
import { loadSimData } from "../../testing/SimData";
import {
  cacheProjection,
  forecastViewportBounds,
  ProjectionView,
  selectProjection,
} from "../../helpers/Projection";
import { GameType, TickPresentFutureType } from "../../Types";
import Insights, {
  INSIGHT_PRESETS,
  INSIGHT_LAYERS,
  INSIGHT_LAYER_MANUAL,
  MAX_CUSTOM_INSIGHT_PRESETS,
  isChartLayer,
  withRequiredLayers,
} from "./Insights";
import { MANUAL_ENTRIES, MANUAL_ENTRY } from "../base/ManualEntries";
import { manualEntryByTitle } from "../base/ManualHelpPopover";
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
  fuels?: string[];
  highlightFuel?: string;
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
// Bottom to top of the supply stack, as forecastFuels orders it
let mockSupplyFuels: string[] = [];

// Restore real timers even when a test that fakes them fails partway
afterEach(() => {
  jest.useRealTimers();
  mockSupplyFuels = [];
});

it("extends the full planning horizon when a successor takes over, including restored views", () => {
  const first = createGame({ scenarioId: 117 });
  const props = {
    game: first,
    selectedFacilityId: null,
    facilityDragActive: false,
  };
  const initial = new Insights(props);
  const offset = 240 * MINUTES_PER_MONTH;
  const game = {
    ...first,
    scenarioId: 118,
    date: getDateFromMinute(offset, first.startingYear),
    campaign: { ...first.campaign!, generationIndex: 1, termStartMonth: 240 },
  };
  const next = { ...props, game };
  const successor = new Insights(next);
  expect(successor.state.viewport[1]).toBe(480 * MINUTES_PER_MONTH);
  expect(
    Insights.getDerivedStateFromProps(next, initial.state)?.viewport?.[1],
  ).toBe(480 * MINUTES_PER_MONTH);
  const restored = new Insights({
    ...next,
    savedViewport: { month: 240, viewport: [0, offset] },
  });
  expect(restored.state.viewport[1]).toBe(480 * MINUTES_PER_MONTH);
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
      data-history-points={
        timeline?.filter(
          (point) => (point as { projected: boolean }).projected === false,
        ).length
      }
      data-projected-points={
        timeline?.filter(
          (point) => (point as { projected: boolean }).projected === true,
        ).length
      }
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
  forecastFuels: () => mockSupplyFuels,
  default: ({ syncKey, fuels, highlightFuel }: ChartMockProps) => (
    <div
      role="img"
      aria-label="Supply by fuel inspection"
      data-chart="supply-by-fuel"
      data-sync-key={syncKey}
      data-fuels={fuels?.join(",")}
      data-highlight={highlightFuel || ""}
    />
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
  // Insights reads the real marker helpers to key its legend to what the chart would draw.
  ...jest.requireActual("../base/ChartSupplyDemandRanges"),
  __esModule: true,
  default: ({
    syncKey,
    ranges,
    domain,
  }: React.ComponentProps<
    typeof import("../base/ChartSupplyDemandRanges").default
  >) => {
    mockSupplyDemandPaints++;
    return (
      <div
        role="img"
        data-testid="supply-demand-chart"
        data-forecast-start={ranges.find((range) => range.projected)?.minute}
        data-sync-key={syncKey}
        data-points={ranges.length}
        data-ranges={JSON.stringify(ranges)}
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

jest.mock("../base/ChartForecastPowerExchange", () => ({
  __esModule: true,
  default: ({
    syncKey,
    timeline,
    domain,
    currentMinute,
  }: Omit<ChartMockProps, "timeline"> & {
    timeline?: Array<{ transmissionCapacityW?: number }>;
  }) => (
    <div
      role="img"
      aria-label="Power exchange inspection"
      data-chart="power-exchange"
      data-sync-key={syncKey}
      data-points={timeline?.length}
      data-domain={domainValue(domain)}
      data-forecast-start={currentMinute}
      data-line-capacity={Math.max(
        0,
        ...(timeline || []).map((tick) => tick.transmissionCapacityW || 0),
      )}
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

it("targets event evidence inside the expanded chart, then returns to the page rail", async () => {
  localStorage.clear();
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
  const { rerender } = render(<Insights {...props} />);
  fireEvent.click(
    screen.getByRole("button", { name: "Expand Supply & Demand chart" }),
  );
  rerender(<Insights {...props} evidenceRequest={request} />);
  const dialog = screen.getByRole("dialog", { name: "Supply & Demand" });
  const chip = within(dialog).getByRole("button", {
    name: "July: Load growth",
  });
  expect(chip).toHaveAttribute("aria-expanded", "true");
  expect(props.onEvidenceReady).toHaveBeenLastCalledWith(request, chip);

  fireEvent.click(
    within(dialog).getByRole("button", { name: "Close Supply & Demand chart" }),
  );
  await waitFor(() => expect(dialog).not.toBeInTheDocument());
  const nextRequest = { ...request, id: 2 };
  rerender(<Insights {...props} evidenceRequest={nextRequest} />);
  expect(props.onEvidenceReady).toHaveBeenLastCalledWith(
    nextRequest,
    screen.getByRole("button", { name: "July: Load growth" }),
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
  await user.click(presetControl());
  await user.click(within(await screen.findByRole("listbox")).getByText(label));
}

function presetControl() {
  const preset = screen.getByLabelText("Insight preset");
  expect(preset).toHaveRole("combobox");
  expect(preset).toHaveAccessibleName("Insight preset");
  expect(isInaccessible(preset)).toBe(false);
  return preset;
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
  let exchangeGame: GameType;
  let exchangeProjection: ProjectionView;
  beforeAll(() => {
    // Layer/preset controls share immutable real inputs and a real forecast. Cache
    // regression cases still create independent games with distinct history identities.
    overviewGame = createNextState(createGame({ scenarioId: 100 }), () => {});
    overviewProjection = createNextState(
      selectProjection(overviewGame, overviewGame.timeline[0]),
      () => {},
    );
  });
  // The same for a grid with an open intertie, whose forecast carries the exchange. Stored
  // Energy and Water only appear for fleets that have storage and hydro, so it claims both.
  // Its own hook, so a second twenty-year forecast has its own time allowance.
  beforeAll(() => {
    exchangeGame = createNextState(gameWithOpenIntertie(), () => {});
    loadSimData(exchangeGame.location);
    exchangeProjection = createNextState(
      {
        ...selectProjection(exchangeGame, exchangeGame.timeline[0]),
        hasStorage: true,
        hasHydro: true,
      },
      () => {},
    );
  }, 60_000);
  beforeEach(() => {
    localStorage.clear();
    // Other cases play different seeds and locations. Reusing the immutable game
    // must not inherit their mutable weather/fuel/economy projection caches.
    loadSimData(overviewGame.location);
    cacheProjection(overviewGame, overviewProjection);
  });

  it("discards retired layers from stored views and presets", async () => {
    const legacyLayers = [
      "revenue",
      "expenses",
      "solarCapacityFactor",
      "profit",
    ];
    localStorage.setItem("insightsLayers", JSON.stringify(legacyLayers));
    localStorage.setItem(
      "insightsPresetLibrary",
      JSON.stringify({
        defaults: { profitability: legacyLayers },
        custom: [{ id: "1", name: "My finances", layers: legacyLayers }],
      }),
    );
    renderInsights();
    await user.click(labelledButton(/Layers/));
    for (const name of ["Revenue", "Expenses", "Renewable output"]) {
      expect(
        screen.queryByLabelText(name, { selector: 'input[type="checkbox"]' }),
      ).toBeNull();
      expect(screen.queryByRole("heading", { name })).toBeNull();
    }
    expect(screen.getByRole("heading", { name: "Profit" })).toBeVisible();
    await choosePreset("Overview");
    await choosePreset("Profitability");
    expect(JSON.parse(localStorage.getItem("insightsLayers")!)).toEqual([
      "profit",
    ]);
    await choosePreset("Overview");
    await choosePreset("My finances");
    expect(JSON.parse(localStorage.getItem("insightsLayers")!)).toEqual([
      "profit",
    ]);
  });

  it("offers every chart an expand control with its help button right after it, and tables neither", () => {
    localStorage.setItem(
      "insightsLayers",
      JSON.stringify(INSIGHT_LAYERS.map((layer) => layer.id)),
    );
    cacheProjection(exchangeGame, exchangeProjection);
    renderInsights(100, exchangeGame);
    const tracks = screen
      .getAllByRole("region", { name: / evidence$/ })
      .map((track) => {
        const name = track
          .getAttribute("aria-label")!
          .replace(/ evidence$/, "");
        return {
          track,
          name,
          layer: INSIGHT_LAYERS.find((l) => l.label === name)!,
        };
      });
    expect(tracks).toHaveLength(INSIGHT_LAYERS.length);
    const tables = tracks.filter(({ layer }) => !isChartLayer(layer.id));
    expect(tables.map(({ name }) => name)).toEqual(["Finance details"]);
    for (const { track } of tables) {
      expect(
        within(track).queryByRole("button", { name: /^(Expand|What is) / }),
      ).toBeNull();
    }
    const charts = tracks.flatMap(({ track, name, layer }) =>
      isChartLayer(layer.id) ? [{ track, name, id: layer.id }] : [],
    );
    expect(charts).toHaveLength(INSIGHT_LAYERS.length - tables.length);
    for (const { track, name, id } of charts) {
      // Nothing interactive sits between the two, and both follow the title
      const [expand, help] = within(track).getAllByRole("button");
      expect(expand).toHaveAccessibleName(`Expand ${name} chart`);
      expect(help).toHaveAccessibleName(`What is ${INSIGHT_LAYER_MANUAL[id]}?`);
      const [title] = within(track).getAllByRole("heading", { level: 3 });
      expect(
        title.compareDocumentPosition(expand) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
      expect(
        expand.compareDocumentPosition(help) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    }
  });

  it("keeps the help button beside the expand control while layers are being edited", async () => {
    localStorage.setItem("insightsLayers", JSON.stringify(["cash", "profit"]));
    renderInsights();
    await user.click(labelledButton(/Layers/));
    const track = screen.getByRole("region", { name: "Cash evidence" });
    expect(
      within(track)
        .getAllByRole("button")
        .slice(0, 5)
        .map((button) => button.getAttribute("aria-label")),
    ).toEqual([
      "Expand Cash chart",
      "What is Cash?",
      "Move Cash up",
      "Move Cash down",
      "Remove Cash",
    ]);
  });

  it("opens the manual page chosen for the layer", async () => {
    localStorage.setItem("insightsLayers", JSON.stringify(["spareCapacity"]));
    const store = configureStore({ reducer: { ui: uiReducer } });
    renderUI(
      <Provider store={store}>
        <Insights
          game={overviewGame}
          selectedFacilityId={null}
          facilityDragActive={false}
        />
      </Provider>,
    );
    await user.click(
      screen.getByRole("button", { name: "What is Lowest reserve?" }),
    );
    expect(store.getState().ui.manualHelpEntry).toBe("Lowest reserve");
  });

  it("points every chart layer at a manual entry that exists", () => {
    const charts: string[] = [];
    const missing: string[] = [];
    for (const { id } of INSIGHT_LAYERS) {
      if (!isChartLayer(id)) continue;
      charts.push(id);
      if (!manualEntryByTitle(INSIGHT_LAYER_MANUAL[id])) missing.push(id);
    }
    expect(missing).toEqual([]);
    const sections = MANUAL_ENTRIES.find(
      (entry) => entry.title === MANUAL_ENTRY.FORECASTS,
    )!.sections!;
    expect(Object.values(INSIGHT_LAYER_MANUAL).sort()).toEqual(
      sections.map((section) => section.title).sort(),
    );
    expect(Object.keys(INSIGHT_LAYER_MANUAL).sort()).toEqual(charts.sort());
    // The finance table has no plot to explain
    expect(isChartLayer("financeDetails")).toBe(false);
  });

  it("keeps fuel selection and time zoom when expanding and closing a chart", async () => {
    localStorage.setItem(
      "insightsLayers",
      JSON.stringify(["fuelPrices", "cash"]),
    );
    renderInsights();
    const layers = localStorage.getItem("insightsLayers");
    const fuels = within(
      screen.getByRole("group", { name: "Show fuel prices" }),
    );
    fireEvent.click(fuels.getByRole("button", { name: "Coal" }));
    expect(
      screen.getByRole("img", { name: "Fuel price inspection" }),
    ).toHaveAttribute("data-fuel", "Coal");
    const expand = labelledButton("Expand Fuel Prices chart");
    act(() => expand.focus());
    fireEvent.click(expand);
    const dialog = screen.getByRole("dialog", { name: "Fuel Prices" });
    const expanded = within(dialog);
    // The title names the dialog on its own; the help button beside it doesn't join the name
    expect(labelledButton("What is Fuel Prices?", dialog)).toBeVisible();
    expect(
      within(
        expanded.getByRole("group", { name: "Show fuel prices" }),
      ).getByRole("button", { name: "Coal" }),
    ).toHaveAttribute("aria-pressed", "true");
    const chart = expanded.getByRole("img", {
      name: "Fuel price inspection",
    });
    expect(chart).toHaveAttribute("data-fuel", "Coal");
    fireEvent.click(labelledButton("Zoom in", dialog));
    const date = expanded.getByLabelText(/^Displayed date range:/).textContent;
    fireEvent.click(
      within(
        expanded.getByRole("group", { name: "Show fuel prices" }),
      ).getByRole("button", { name: "All fuels" }),
    );
    expect(chart).toHaveRole("img");
    expect(chart).toHaveAccessibleName("Fuel price inspection");
    expect(isInaccessible(chart)).toBe(false);
    expect(chart).toHaveAttribute("data-fuel", "all");
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

  it("narrows supply by fuel with the same selectable key as fuel prices", () => {
    mockSupplyFuels = ["Coal", "Natural Gas", "Wind"];
    localStorage.setItem("insightsLayers", JSON.stringify(["supplyByFuel"]));
    renderInsights();
    const key = screen.getByRole("group", { name: "Show supply by fuel" });
    // Top of the stack first, as the bands read, then what they are stacked against
    expect(
      within(key)
        .getAllByRole("button")
        .map((button) => button.textContent),
    ).toEqual(["All fuels", "Wind", "Natural Gas", "Coal"]);
    expect(within(key).getByText("Demand")).toBeVisible();
    expect(
      within(key).queryByRole("button", { name: "Demand" }),
    ).not.toBeInTheDocument();
    const chart = () =>
      screen.getByRole("img", { name: "Supply by fuel inspection" });
    expect(chart()).toHaveAttribute("data-fuels", "Coal,Natural Gas,Wind");
    const all = within(key).getByRole("button", { name: "All fuels" });
    const gas = within(key).getByRole("button", { name: "Natural Gas" });
    expect(all).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(gas);
    expect(chart()).toHaveAttribute("data-fuels", "Natural Gas");
    expect(gas).toHaveAccessibleName("Natural Gas");
    expect(isInaccessible(gas)).toBe(false);
    expect(gas).toHaveAttribute("aria-pressed", "true");
    expect(all).toHaveAccessibleName("All fuels");
    expect(isInaccessible(all)).toBe(false);
    expect(all).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(all);
    expect(chart()).toHaveAttribute("data-fuels", "Coal,Natural Gas,Wind");
  });

  it("returns supply by fuel to every fuel once the chosen one leaves the forecast", () => {
    mockSupplyFuels = ["Coal", "Wind"];
    localStorage.setItem("insightsLayers", JSON.stringify(["supplyByFuel"]));
    const { rerender } = renderInsights();
    fireEvent.click(screen.getByRole("button", { name: "Coal" }));
    expect(
      screen.getByRole("img", { name: "Supply by fuel inspection" }),
    ).toHaveAttribute("data-fuels", "Coal");
    mockSupplyFuels = ["Wind"];
    // Selecting a facility is what makes the pane draw again
    rerender(
      <Insights
        game={overviewGame}
        selectedFacilityId={-1}
        facilityDragActive={false}
      />,
    );
    expect(
      screen.getByRole("img", { name: "Supply by fuel inspection" }),
    ).toHaveAttribute("data-fuels", "Wind");
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
    const headings = screen.getAllByRole("heading", { level: 3 });
    const expected = ["Supply & Demand", "Cash", "Emissions (tonnes CO₂e)"];
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

  it("closes only the layer editor on Escape and returns focus to its toggle", async () => {
    renderInsights();
    const outer = jest.fn();
    document.addEventListener("keydown", outer);
    try {
      await user.click(labelledButton(/Layers/));
      const panel = screen.getByRole("region", { name: "Data layers" });
      within(panel).getAllByRole("checkbox")[0].focus();
      await user.keyboard("{Escape}");
      expect(
        screen.queryByRole("region", { name: "Data layers" }),
      ).not.toBeInTheDocument();
      expect(labelledButton(/Layers/)).toHaveFocus();
      // The workspace's pane-closing handler sees the Escape as already handled.
      expect(outer).toHaveBeenCalledWith(
        expect.objectContaining({ key: "Escape", defaultPrevented: true }),
      );
    } finally {
      document.removeEventListener("keydown", outer);
    }
  });

  it("checks required tutorial layers when the selected preset omits them", async () => {
    renderInsights(4);
    await user.click(labelledButton(/Layers/));

    const expectRequiredLayers = () => {
      for (const name of ["Profit", "Finance details"]) {
        const checkbox = labelledCheckbox(name);
        expect(checkbox).toBeChecked();
        expect(checkbox).toBeDisabled();
        expect(screen.getByRole("heading", { name })).toBeVisible();
      }
      expect(labelledCheckbox("Supply & Demand")).toBeChecked();
      expect(labelledCheckbox("Supply & Demand")).toBeEnabled();
      expect(labelledCheckbox("Fuel Prices")).not.toBeChecked();
    };
    expectRequiredLayers();
    await choosePreset("Profitability");
    await choosePreset("Overview");
    expectRequiredLayers();
    expect(JSON.parse(localStorage.getItem("insightsLayers")!)).toEqual(
      INSIGHT_PRESETS.overview.layers,
    );
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
    // The tooltip names each month as recorded or projected; no key repeats it
    expect(within(track).queryByText("Recorded")).not.toBeInTheDocument();
    expect(within(track).queryByText("Projected")).not.toBeInTheDocument();
    const headings = screen.getAllByRole("heading", { level: 3 });
    expect(headings[0]).toHaveTextContent("Supply & Demand");
    expect(headings[1]).toHaveTextContent("Lowest reserve");
    await user.click(labelledButton(/Layers/));
    await user.click(labelledCheckbox("Lowest reserve"));
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

  it("names the numbered events above the full-screen chart and keeps their details inside it", async () => {
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
    ]);

    fireEvent.click(
      screen.getByRole("button", { name: "Expand Supply & Demand chart" }),
    );
    const dialog = screen.getByRole("dialog", { name: "Supply & Demand" });
    const rail = within(dialog).getByRole("region", {
      name: "Upcoming scenario events",
    });
    expect(rail).toHaveTextContent("Higher carbon fee begins");
    expect(rail).toHaveTextContent("Jul 2023");
    // The rail behind the dialog is hidden, so the events are named once.
    expect(
      screen.getAllByRole("region", { name: "Upcoming scenario events" }),
    ).toHaveLength(1);

    const chip = within(rail).getByRole("button", {
      name: "Expected Jul 2023: Higher carbon fee begins",
    });
    await user.click(chip);
    expect(chip).toHaveAttribute("aria-expanded", "true");
    expect(
      within(dialog).getByRole("dialog", { name: "Higher carbon fee begins" }),
    ).toHaveTextContent("Polluting plants become more expensive to run.");

    // Escape closes the event's details first and leaves the chart open.
    await user.keyboard("{Escape}");
    expect(chip).toHaveAttribute("aria-expanded", "false");
    expect(
      within(dialog).queryByRole("dialog", {
        name: "Higher carbon fee begins",
      }),
    ).toBeNull();
    expect(
      screen.getByRole("dialog", { name: "Supply & Demand" }),
    ).toBeInTheDocument();
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
    expect(labelledButton("Fit full timeline")).toBeDisabled();
    await user.click(labelledButton("Zoom in"));
    await user.click(labelledButton("Fit full timeline"));
    expect(supply).toHaveAttribute("data-domain", JSON.stringify(initial));
    expect(labelledButton("Fit full timeline")).toBeDisabled();
    expect(labelledButton("Zoom out")).toBeDisabled();
  });

  it.each([1, 12, 60, 192, 240, 300, 0])(
    "fits the scenario span, capped at 20 years, for duration %s",
    async (durationMonths) => {
      const game = overviewGame;
      const months = Math.min(durationMonths || 240, 240);
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
      if (months > 1) {
        await user.click(labelledButton("Zoom in"));
        await user.click(labelledButton("Fit full timeline"));
      }
      expect(screen.getByTestId("supply-demand-chart")).toHaveAttribute(
        "data-domain",
        JSON.stringify([0, months * MINUTES_PER_MONTH]),
      );
      expect(labelledButton("Fit full timeline")).toBeDisabled();
    },
  );

  it.each([144, 300, 0])(
    "fits from scenario start after time has elapsed, for duration %s",
    async (durationMonths) => {
      renderInsights(100, {
        ...overviewGame,
        date: getDateFromMinute(
          120 * MINUTES_PER_MONTH,
          overviewGame.startingYear,
        ),
        scenarioId: CUSTOM_SCENARIO_ID,
        customScenario: {
          ...getScenario(100)!,
          id: CUSTOM_SCENARIO_ID,
          durationMonths,
        },
      });
      expect(labelledButton("Zoom out")).toBeDisabled();
      await user.click(labelledButton("Zoom in"));
      await user.click(labelledButton("Fit full timeline"));
      expect(screen.getByTestId("supply-demand-chart")).toHaveAttribute(
        "data-domain",
        JSON.stringify([
          0,
          Math.min(durationMonths || 240, 240) * MINUTES_PER_MONTH,
        ]),
      );
      expect(labelledButton("Fit full timeline")).toBeDisabled();
    },
  );

  it.each([
    [1, 118],
    [2, 119],
  ])(
    "fits the active successor term with a 20-year span for generation %s",
    async (generationIndex, scenarioId) => {
      const first = createGame({ scenarioId: 117 });
      const termStartMonth = generationIndex * 240;
      const game = {
        ...first,
        scenarioId,
        date: getDateFromMinute(
          (termStartMonth + 6) * MINUTES_PER_MONTH,
          first.startingYear,
        ),
        campaign: {
          ...first.campaign!,
          generationIndex,
          termStartMonth,
        },
      };
      cacheProjection(game, {
        ...overviewProjection,
        domain: {
          ...overviewProjection.domain,
          x: forecastViewportBounds(game),
        },
      });
      renderInsights(scenarioId, game);
      await user.click(labelledButton("Zoom in"));
      await user.click(labelledButton("Fit full timeline"));
      const domain = [
        termStartMonth * MINUTES_PER_MONTH,
        (termStartMonth + 240) * MINUTES_PER_MONTH,
      ];
      expect(screen.getByTestId("supply-demand-chart")).toHaveAttribute(
        "data-domain",
        JSON.stringify(domain),
      );
      expect(domain[1] - domain[0]).toBe(240 * MINUTES_PER_MONTH);
      expect(game.date.minute).toBeGreaterThanOrEqual(domain[0]);
      expect(game.date.minute).toBeLessThan(domain[1]);
      expect(labelledButton("Fit full timeline")).toBeDisabled();
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
        .mockReturnValue({ peakW, wh, startYear: 2034 });
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

  it("keys the unmet demand legend to the shortfall markers on the plot, not the hourly total", () => {
    // The hourly forecast total for the viewport can be empty while a marker reaches into it, as
    // when the tick behind the marker lies just outside the viewport.
    const shortfall = jest
      .spyOn(
        Insights.prototype as unknown as {
          rangeShortfall: () => ProjectionView["shortfall"];
        },
        "rangeShortfall",
      )
      .mockReturnValue(undefined);
    try {
      const game = createGame({ scenarioId: 100 });
      game.facilities = [];
      renderInsights(100, game);
      expect(screen.getByText("Unmet demand")).toBeInTheDocument();
    } finally {
      shortfall.mockRestore();
    }
  });

  it("keeps all available forecast hours in months cut by the viewport", () => {
    const month = MINUTES_PER_MONTH;
    const timeline = Array.from({ length: 32 * 24 }, (_unused, hour) => ({
      ...overviewProjection.supplyDemandTimeline[0],
      minute: hour * 60,
      demandW: 100,
      // These hours lie beyond opposite edges of the displayed viewport, within its edge months.
      supplyW: hour === 24 + 1 || hour === 30 * 24 + 23 ? 50 : 100,
    }));
    cacheProjection(overviewGame, {
      ...overviewProjection,
      supplyDemandTimeline: timeline,
    });
    render(
      <Insights
        game={overviewGame}
        selectedFacilityId={null}
        facilityDragActive={false}
        savedViewport={{
          month: overviewGame.date.monthsElapsed,
          viewport: [1.25 * month, 30.25 * month],
        }}
      />,
    );
    const ranges = JSON.parse(
      screen.getByTestId("supply-demand-chart").getAttribute("data-ranges")!,
    );
    for (const minute of [month, 30 * month]) {
      expect(
        ranges.find((range: { minute: number }) => range.minute === minute),
      ).toMatchObject({ peakShortfall: 50, unmetSum: 50, demandSum: 2400 });
    }
  });

  function cacheShortfallForecast() {
    const year = 12 * MINUTES_PER_MONTH;
    const forecast = [
      // Large shortages outside the panned range must not affect its year, energy or peak.
      { minute: 0, shortageW: 20e6 },
      { minute: 5.5 * year, shortageW: 10e6 },
      { minute: 6 * year, shortageW: 0 },
      { minute: 8 * year, shortageW: 2e6 },
      { minute: 8.5 * year, shortageW: 1e6 },
      { minute: 9 * year, shortageW: 30e6 },
    ].map(({ minute, shortageW }) => ({
      ...overviewProjection.forecast[0],
      minute,
      demandW: 40e6,
      supplyW: 40e6 - shortageW,
    }));
    cacheProjection(overviewGame, {
      ...overviewProjection,
      forecast,
      timeline: forecast,
      supplyDemandTimeline: forecast,
      projectionStepMinutes: 60,
    });
    return year;
  }

  it("pans the shortfall year, energy and peak together to the first visible shortage", async () => {
    const year = cacheShortfallForecast();
    render(
      <Insights
        game={overviewGame}
        selectedFacilityId={null}
        facilityDragActive={false}
        savedViewport={{ month: 0, viewport: [5.25 * year, 8.25 * year] }}
      />,
    );
    expect(screen.getByRole("note")).toHaveTextContent(
      "Shortfalls start 2025: ~370MWh unmet · ~10MW peak",
    );

    await user.click(labelledButton("Pan later"));
    expect(screen.getByTestId("supply-demand-chart")).toHaveAttribute(
      "data-domain",
      JSON.stringify([6 * year, 9 * year]),
    );
    const note = screen.getByRole("note");
    expect(note).toHaveTextContent(
      /^Shortfalls start 2028: ~91MWh unmet · ~2MW peak$/,
    );
    expect(note).toHaveAccessibleName(
      "Forecast shortfalls start 2028: about 91MWh of demand unmet, about 2MW peak",
    );
  });

  it("includes a shortage at the left boundary and excludes one at the right boundary", () => {
    const year = cacheShortfallForecast();
    render(
      <Insights
        game={overviewGame}
        selectedFacilityId={null}
        facilityDragActive={false}
        savedViewport={{ month: 0, viewport: [8 * year, 8.5 * year] }}
      />,
    );
    expect(screen.getByRole("note")).toHaveTextContent(
      /^Shortfalls start 2028: ~61MWh unmet · ~2MW peak$/,
    );
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

    expect(screen.getAllByRole("heading", { level: 3 })[0]).toHaveTextContent(
      "Power exchange",
    );
    const exchange = screen.getByRole("region", {
      name: "Power exchange evidence",
    });
    expect(
      within(exchange).getByRole("button", { name: "What is Power exchange?" }),
    ).toBeVisible();
    expect(within(exchange).queryByText("How interties work")).toBeNull();
    expect(localStorage.getItem("insightsLayers")).toBe(
      JSON.stringify(["cash", "supplyDemand"]),
    );
  });

  it("keeps Mission 7's exchange checked across presets without changing saved layers", async () => {
    const savedLayers = JSON.stringify(INSIGHT_PRESETS.reliability.layers);
    localStorage.setItem("insightsLayers", savedLayers);
    localStorage.setItem("insightsActivePreset", "reliability");
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
    expect(
      screen.getByRole("combobox", { name: "Insight preset" }),
    ).toHaveTextContent("Reliability");
    await user.click(labelledButton(/Layers/));
    const exchange = labelledCheckbox("Power exchange");
    expect(exchange).toBeChecked();
    expect(exchange).toBeDisabled();

    await choosePreset("Overview");
    const overviewExchange = labelledCheckbox("Power exchange");
    expect(overviewExchange).toBeChecked();
    expect(overviewExchange).toBeDisabled();
    expect(
      screen.getByRole("heading", { name: "Power exchange" }),
    ).toBeVisible();
    expect(localStorage.getItem("insightsLayers")).toBe(savedLayers);
    expect(localStorage.getItem("insightsActivePreset")).toBe("reliability");
  });

  it("plots the exchange over the forecast's own time axis, beside the current reading", () => {
    localStorage.setItem("insightsLayers", JSON.stringify(["powerExchange"]));
    cacheProjection(exchangeGame, exchangeProjection);
    renderInsights(100, exchangeGame);

    const exchange = screen.getByRole("region", {
      name: "Power exchange evidence",
    });
    // The reading of what is flowing now stays, but is no longer the whole layer
    expect(within(exchange).getByText("Power flowing")).toBeVisible();
    expect(within(exchange).getByText("Available capacity")).toBeVisible();
    const chart = within(exchange).getByRole("img", {
      name: "Power exchange inspection",
    });
    expect(chart).toHaveAttribute("data-sync-key", "insights");
    expect(Number(chart.getAttribute("data-points"))).toBeGreaterThan(100);
    expect(Number(chart.getAttribute("data-line-capacity"))).toBeGreaterThan(0);
    // The same viewport the other layers share, and the same marker for where the forecast starts
    const [from, to] = JSON.parse(chart.getAttribute("data-domain")!);
    expect(to).toBeGreaterThan(from);
    expect(chart).toHaveAttribute("data-forecast-start", "0");
  });

  it("expands the power exchange like any other chart, with its help button in the header", async () => {
    localStorage.setItem("insightsLayers", JSON.stringify(["powerExchange"]));
    cacheProjection(exchangeGame, exchangeProjection);
    renderInsights(100, exchangeGame);

    const expand = screen.getByRole("button", {
      name: "Expand Power exchange chart",
    });
    act(() => expand.focus());
    fireEvent.click(expand);
    const dialog = screen.getByRole("dialog", { name: "Power exchange" });
    expect(
      within(dialog).getByRole("img", { name: "Power exchange inspection" }),
    ).toHaveAttribute("data-sync-key", "insights-expanded");
    expect(
      within(dialog).getByRole("button", { name: "What is Power exchange?" }),
    ).toBeVisible();
    fireEvent.keyDown(dialog, { key: "Escape" });
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(expand).toHaveFocus();
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
    expect(chart).toHaveAttribute("data-axis-value", "120k");
    expect(chart).toHaveAttribute("data-inspected-value", "123k");
  });

  it("applies presets and gives every chart the shared cursor key", async () => {
    renderInsights();
    await choosePreset("Profitability");

    expect(screen.getByText("Profit", { selector: "h3" })).toBeVisible();
    expect(screen.getByText("Fuel Prices", { selector: "h3" })).toBeVisible();
    screen
      .getAllByRole("img")
      .forEach((chart) =>
        expect(chart).toHaveAttribute("data-sync-key", "insights"),
      );
  });

  it("persists edited layer order, saves the preset, and restores its original layers", async () => {
    let view = renderInsights();
    await user.click(labelledButton(/Layers/));
    await user.click(labelledCheckbox("Profit"));
    await user.click(labelledButton("Move Profit up"));

    const layers = ["supplyDemand", "cash", "profit", "emissions"];
    expect(JSON.parse(localStorage.getItem("insightsLayers")!)).toEqual(layers);
    view.unmount();
    view = renderInsights();
    expect(screen.getByText("Profit", { selector: "h3" })).toBeVisible();
    expect(presetControl()).toHaveTextContent("OverviewEdited");
    const headings = screen
      .getAllByRole("heading", { level: 3 })
      .map((heading) => heading.textContent);
    expect(headings.indexOf("Profit")).toBeLessThan(
      headings.indexOf("Emissions (tonnes CO₂e)"),
    );

    await user.click(labelledButton("Preset actions"));
    await user.click(screen.getByRole("menuitem", { name: "Save changes" }));

    const library = JSON.parse(
      localStorage.getItem("insightsPresetLibrary") || "{}",
    );
    expect(library.defaults.overview).toEqual(layers);
    view.unmount();

    renderInsights();
    expect(screen.getByText("Profit", { selector: "h3" })).toBeVisible();
    expect(
      screen
        .getAllByRole("heading", { level: 3 })
        .map((heading) => heading.textContent),
    ).toEqual(headings);
    const preset = presetControl();
    expect(preset).toHaveTextContent("Overview");
    expect(preset).not.toHaveTextContent("Edited");
    await user.click(labelledButton("Preset actions"));
    await user.click(
      screen.getByRole("menuitem", { name: "Reset to default" }),
    );
    await user.click(screen.getByRole("button", { name: "Restore" }));

    expect(screen.queryByText("Profit", { selector: "h3" })).toBeNull();
    const restoredLibrary = JSON.parse(
      localStorage.getItem("insightsPresetLibrary") || "{}",
    );
    expect(restoredLibrary.defaults.overview).toBeUndefined();
  });

  it("resets unsaved changes to a standard preset", async () => {
    renderInsights();
    await user.click(labelledButton(/Layers/));
    await user.click(labelledCheckbox("Profit"));
    await user.click(labelledButton("Preset actions"));
    await user.click(
      screen.getByRole("menuitem", { name: "Reset to default" }),
    );
    await user.click(screen.getByRole("button", { name: "Restore" }));
    expect(screen.queryByText("Profit", { selector: "h3" })).toBeNull();
    await user.click(labelledButton("Preset actions"));
    expect(
      screen.getByRole("menuitem", { name: "Save changes" }),
    ).toHaveAttribute("aria-disabled", "true");
  });

  it("only groups the preset choices when custom presets exist", async () => {
    const view = renderInsights();
    await user.click(presetControl());
    expect(screen.queryByText("Default presets")).toBeNull();
    expect(screen.queryByText("Your presets")).toBeNull();
    expect(screen.queryByRole("option", { name: "Unsaved view" })).toBeNull();
    await user.keyboard("{Escape}");
    view.unmount();

    storeCustomPreset("Peak watch");
    renderInsights();
    await user.click(presetControl());
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

    const preset = presetControl();
    expect(preset).toHaveTextContent("Peak watch");

    await user.click(labelledButton(/Layers/));
    await user.click(labelledCheckbox("Profit"));
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
      layers: expect.arrayContaining(["profit"]),
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
    expect(presetControl()).toHaveTextContent("Morning peak");

    view.unmount();
    renderInsights();
    const preset = presetControl();
    expect(preset).toHaveTextContent("Morning peak");
    await user.click(labelledButton("Preset actions"));
    await user.click(screen.getByRole("menuitem", { name: /Delete custom/ }));
    await user.click(screen.getByRole("button", { name: "Delete" }));
    expect(presetControl()).toHaveTextContent("Unsaved view");
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

    await user.click(labelledButton("Zoom in"));
    await user.click(labelledButton("Fit full timeline"));

    expect(
      screen.queryByRole("region", { name: "Electricity pricing" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText("Supply & Demand", { selector: "h3" }),
    ).toBeVisible();
    expect(screen.getByText("Profit", { selector: "h3" })).toBeVisible();
    expect(screen.getByText("Fuel Prices", { selector: "h3" })).toBeVisible();
    const profit = screen.getByTestId("chartInsightsProfitPlot");
    expect(profit).toHaveAttribute("data-history-points", "3");
    expect(
      Number(profit.getAttribute("data-projected-points")),
    ).toBeGreaterThan(0);
    expect(profit).toHaveAttribute(
      "data-domain",
      JSON.stringify([0, getScenario(100)!.durationMonths * MINUTES_PER_MONTH]),
    );
    expect(
      Number(
        screen.getByTestId("supply-demand-chart").getAttribute("data-points"),
      ),
    ).toBeGreaterThan(3);

    await user.click(labelledButton(/Layers/));
    expect(labelledCheckbox("Fuel Prices")).toBeEnabled();
    expect(labelledCheckbox("Profit")).toBeEnabled();
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
    expect(screen.queryByText("Power exchange", { selector: "h3" })).toBeNull();
  });
});

function gameWithOpenIntertie(): GameType {
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
  return game;
}

// Label queries avoid repeatedly computing every MUI checkbox's accessible name.
// Check accessibility explicitly so a hidden labelled input still fails the contract.
function labelledCheckbox(label: string): HTMLElement {
  const checkbox = screen.getByLabelText(label, {
    selector: 'input[type="checkbox"]',
  });
  expect(checkbox).toHaveRole("checkbox");
  expect(checkbox).toHaveAccessibleName(label);
  expect(isInaccessible(checkbox)).toBe(false);
  return checkbox;
}

function labelledButton(
  label: string | RegExp,
  scope?: HTMLElement,
): HTMLElement {
  const button = scope
    ? within(scope).getByLabelText(label, { selector: "button" })
    : screen.getByLabelText(label, { selector: "button" });
  expect(button).toHaveRole("button");
  expect(button).toHaveAccessibleName(label);
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
