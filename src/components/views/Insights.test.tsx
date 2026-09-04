import * as React from "react";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { EMPTY_HISTORY, MINUTES_PER_MONTH } from "../../helpers/DateTime";
import { createGame } from "../../testing/Simulator";
import { GameType } from "../../Types";
import Insights, {
  INSIGHT_LAYERS,
  INSIGHT_PRESETS,
  MAX_CUSTOM_INSIGHT_PRESETS,
  presetForLayers,
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
  id?: string;
  syncKey?: string;
  timeline?: unknown[];
  domain?: [number, number] | { x: [number, number] };
}

const domainValue = (domain?: ChartMockProps["domain"]) =>
  JSON.stringify(Array.isArray(domain) ? domain : domain?.x);

let mockSupplyDemandPaints = 0;

jest.mock("../base/ChartFinances", () => ({
  __esModule: true,
  default: ({ id, syncKey, timeline, domain }: ChartMockProps) => (
    <div
      role="img"
      id={id}
      data-testid={id}
      data-sync-key={syncKey}
      data-points={timeline?.length}
      data-domain={domainValue(domain)}
    />
  ),
}));

jest.mock("../base/ChartForecastFuelPrices", () => ({
  __esModule: true,
  PRICED_FUELS: [],
  default: ({ syncKey }: ChartMockProps) => (
    <div role="img" data-chart="fuel-prices" data-sync-key={syncKey} />
  ),
}));
jest.mock("../base/ChartForecastDemandByType", () => ({
  __esModule: true,
  demandTypesBySizeAtStart: () => [
    "Residential",
    "Commercial",
    "Industrial",
    "Transportation",
    "Data centers",
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
  default: ({ syncKey, timeline, domain }: ChartMockProps) => {
    mockSupplyDemandPaints++;
    return (
      <div
        role="img"
        data-chart="supply-demand"
        data-testid="supply-demand-chart"
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
      game={suppliedGame || createGame({ scenarioId })}
      selectedFacilityId={null}
      facilityDragActive={false}
      upcomingEvents={upcomingEvents}
      onDelta={() => undefined}
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
  beforeEach(() => localStorage.clear());

  it("defines five distinct, purpose-ordered presets", () => {
    expect(new Set(INSIGHT_LAYERS.map((layer) => layer.id)).size).toBe(
      INSIGHT_LAYERS.length,
    );
    expect(Object.keys(INSIGHT_PRESETS)).toHaveLength(5);
    expect(INSIGHT_PRESETS.overview.layers).toEqual([
      "supplyDemand",
      "cash",
      "profit",
      "customers",
      "emissions",
    ]);
    expect(INSIGHT_PRESETS.reliability.layers).toEqual([
      "supplyDemand",
      "supplyByFuel",
      "storage",
      "weather",
      "water",
    ]);
    expect(INSIGHT_PRESETS.profitability.layers).toEqual([
      "profit",
      "cash",
      "revenue",
      "expenses",
      "fuelPrices",
    ]);
    expect(INSIGHT_PRESETS.growth.layers).toEqual([
      "customers",
      "demandByType",
      "supplyDemand",
      "revenue",
      "profit",
    ]);
    expect(INSIGHT_PRESETS.decarbonization.layers).toEqual([
      "emissions",
      "supplyByFuel",
      "supplyDemand",
      "fuelPrices",
      "profit",
    ]);
    expect(presetForLayers(INSIGHT_PRESETS.growth.layers)).toBe("growth");
  });

  it("starts new players on the five-chart overview in priority order", () => {
    renderInsights();

    expect(
      screen.getByRole("combobox", { name: "Insight preset" }),
    ).toHaveTextContent("Overview");
    const headings = screen.getAllByRole("heading", { level: 6 });
    const expected = [
      "Insights",
      "Supply & Demand",
      "Cash",
      "Profit",
      "Customers",
      "Emissions (CO2e)",
    ];
    expect(headings).toHaveLength(expected.length);
    expected.forEach((label, index) =>
      expect(headings[index]).toHaveTextContent(label),
    );
  });

  it("shows the market benchmark without repeating the rate unit", () => {
    renderInsights();

    const levers = screen.getByRole("region", { name: "Planning controls" });
    expect(levers).toHaveTextContent(/Rate .*\/kWh/);
    expect(
      within(levers).getByText(/market \$/, {
        selector: ".insightsRateSummaryDesktop",
      }).textContent,
    ).not.toMatch(/market [^·]*\/kWh/);
    expect(within(levers).getByText("Market")).toBeInTheDocument();
    expect(within(levers).getByText("Customers / mo")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Hide rate slider" }),
    ).toHaveAccessibleDescription(/projected customers .* next month/i);
  });

  it("keeps the compact rate metrics visible when the slider is collapsed", async () => {
    renderInsights();

    const toggle = screen.getByRole("button", { name: "Hide rate slider" });
    const sliderControl = screen.getByTestId("rate-slider-control");
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(sliderControl).not.toHaveClass("insightsRateSliderCollapsed");
    expect(screen.getByRole("slider")).toBeVisible();

    await user.click(toggle);

    expect(
      screen.getByRole("button", { name: "Show rate slider" }),
    ).toHaveAttribute("aria-expanded", "false");
    expect(sliderControl).toHaveClass("insightsRateSliderCollapsed");
    expect(screen.getByRole("slider")).toBeInTheDocument();
    expect(
      within(
        screen.getByRole("region", { name: "Planning controls" }),
      ).getByText("Customers / mo"),
    ).toBeInTheDocument();
  });

  it("keeps the customer growth rate visible for public utilities", () => {
    renderInsights(107);

    const levers = screen.getByRole("region", { name: "Planning controls" });
    expect(levers).toHaveTextContent(/customer growth \+1.5%\/yr/i);
    expect(levers).not.toHaveTextContent(/market/i);
    expect(
      within(levers).getByText("Customer growth / yr"),
    ).toBeInTheDocument();
    expect(
      within(levers).getByText("+1.5%", { selector: "strong" }),
    ).toBeVisible();
  });

  it("shows in-range scenario events and reveals their forecast details", async () => {
    localStorage.setItem("insightsRange", "next1");
    renderInsights(100, undefined, [
      {
        key: "fee-onset",
        startsMinute: 6 * MINUTES_PER_MONTH,
        endsMinute: 7 * MINUTES_PER_MONTH,
        label: "Expected Jul 2023",
        title: "Higher pollution fee begins",
        message: "Polluting plants become more expensive to run.",
      },
      {
        key: "later-event",
        startsMinute: 18 * MINUTES_PER_MONTH,
        endsMinute: 19 * MINUTES_PER_MONTH,
        label: "Expected Jul 2024",
        title: "Outside range",
        message: "This should not be shown.",
      },
    ]);

    const region = screen.getByRole("region", {
      name: "Upcoming scenario events",
    });
    expect(region).toHaveTextContent("Upcoming");
    expect(region).toHaveTextContent("Jul 2023");
    expect(region).not.toHaveTextContent("Higher pollution fee begins");
    const event = within(region).getByRole("button", {
      name: "Expected Jul 2023: Higher pollution fee begins",
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
        startsMinute: 48 * MINUTES_PER_MONTH,
        endsMinute: 49 * MINUTES_PER_MONTH,
        label: "Expected Jan 2027",
        title: "Future event",
        message: "Forecast only.",
      },
    ]);

    expect(
      screen.queryByRole("region", { name: "Upcoming scenario events" }),
    ).toBeNull();
  });

  it("replaces preset horizons with a displayed 12-month date range", () => {
    localStorage.setItem("insightsRange", "current");
    renderInsights();

    expect(screen.queryByRole("combobox", { name: "Time horizon" })).toBeNull();
    expect(
      screen.getByLabelText("Displayed date range: Jan 2020 – Jan 2021"),
    ).toBeVisible();
  });

  it("zooms and pans every insight chart on one shared time viewport", async () => {
    renderInsights();

    const supply = screen.getByTestId("supply-demand-chart");
    const cash = screen.getByTestId("chartInsightsCashPlot");
    const initial = JSON.parse(supply.getAttribute("data-domain") || "[]");
    expect(cash).toHaveAttribute("data-domain", JSON.stringify(initial));
    expect(screen.getByRole("button", { name: "Pan earlier" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Zoom out" })).toBeEnabled();

    await user.click(screen.getByRole("button", { name: "Zoom in" }));
    const zoomed = JSON.parse(supply.getAttribute("data-domain") || "[]");
    expect(zoomed[1] - zoomed[0]).toBeCloseTo((initial[1] - initial[0]) / 2);
    expect(cash).toHaveAttribute("data-domain", JSON.stringify(zoomed));
    expect(screen.getByRole("button", { name: "Pan earlier" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Pan later" })).toBeEnabled();

    await user.click(screen.getByRole("button", { name: "Pan later" }));
    expect(supply.getAttribute("data-domain")).not.toBe(JSON.stringify(zoomed));
    await user.click(screen.getByRole("button", { name: "Fit full timeline" }));
    expect(supply).toHaveAttribute(
      "data-domain",
      JSON.stringify([0, 20 * 12 * MINUTES_PER_MONTH]),
    );
  });

  it("uses hourly points for the continuous forecast", () => {
    localStorage.setItem("insightsLayers", JSON.stringify(["weather"]));
    renderInsights();

    expect(screen.getByRole("img")).toHaveAttribute("data-step", "60");
  });

  it("advances the end while keeping a scenario-start viewport anchored", () => {
    const game = createGame({ scenarioId: 100 });
    const view = renderInsights(100, game);
    const supply = screen.getByTestId("supply-demand-chart");
    expect(supply).toHaveAttribute(
      "data-domain",
      JSON.stringify([0, 12 * MINUTES_PER_MONTH]),
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
        onDelta={() => undefined}
      />,
    );

    expect(supply).toHaveAttribute(
      "data-domain",
      JSON.stringify([0, 13 * MINUTES_PER_MONTH]),
    );
  });

  it("slides both ends of an unanchored viewport as the game advances", async () => {
    const game = createGame({ scenarioId: 100 });
    const view = renderInsights(100, game);
    const supply = screen.getByTestId("supply-demand-chart");
    await user.click(screen.getByRole("button", { name: "Zoom in" }));
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
        onDelta={() => undefined}
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

  it("persists custom visibility and ordering across a remount", async () => {
    const view = renderInsights();
    await user.click(screen.getByRole("button", { name: /Layers/ }));
    await user.click(screen.getByRole("checkbox", { name: "Revenue" }));
    await user.click(screen.getByRole("button", { name: "Move Revenue up" }));

    const stored = JSON.parse(localStorage.getItem("insightsLayers") || "[]");
    expect(stored).toContain("revenue");
    view.unmount();

    renderInsights();
    expect(screen.getByText("Revenue", { selector: "h6" })).toBeVisible();
    expect(
      screen.getByRole("combobox", { name: "Insight preset" }),
    ).toHaveTextContent("OverviewEdited");
  });

  it("saves changes back to a default preset and restores them on remount", async () => {
    const view = renderInsights();
    await user.click(screen.getByRole("button", { name: /Layers/ }));
    await user.click(screen.getByRole("checkbox", { name: "Revenue" }));

    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "Save" }));

    const library = JSON.parse(
      localStorage.getItem("insightsPresetLibrary") || "{}",
    );
    expect(library.defaults.overview).toContain("revenue");
    view.unmount();

    renderInsights();
    expect(screen.getByText("Revenue", { selector: "h6" })).toBeVisible();
    expect(
      screen.getByRole("combobox", { name: "Insight preset" }),
    ).toHaveTextContent("Overview");
    expect(
      screen.getByRole("combobox", { name: "Insight preset" }),
    ).not.toHaveTextContent("Edited");
  });

  it("restores a modified default preset to its original layers", async () => {
    renderInsights();
    await user.click(screen.getByRole("button", { name: /Layers/ }));
    await user.click(screen.getByRole("checkbox", { name: "Revenue" }));
    await user.click(screen.getByRole("button", { name: "Save" }));

    await user.click(screen.getByRole("button", { name: "Preset actions" }));
    await user.click(
      screen.getByRole("menuitem", { name: "Restore original preset" }),
    );
    await user.click(screen.getByRole("button", { name: "Restore" }));

    expect(screen.queryByText("Revenue", { selector: "h6" })).toBeNull();
    const library = JSON.parse(
      localStorage.getItem("insightsPresetLibrary") || "{}",
    );
    expect(library.defaults.overview).toBeUndefined();
  });

  it("creates and updates a named preset", async () => {
    renderInsights();
    await user.click(screen.getByRole("button", { name: "Preset actions" }));
    await user.click(
      screen.getByRole("menuitem", { name: "Save as new preset" }),
    );
    await user.type(
      screen.getByRole("textbox", { name: "Preset name" }),
      "Peak watch",
    );
    await user.click(screen.getByRole("button", { name: "Save preset" }));

    expect(
      screen.getByRole("combobox", { name: "Insight preset" }),
    ).toHaveTextContent("Peak watch");

    await user.click(screen.getByRole("button", { name: /Layers/ }));
    await user.click(screen.getByRole("checkbox", { name: "Revenue" }));
    await user.click(screen.getByRole("button", { name: "Save" }));
    const library = JSON.parse(
      localStorage.getItem("insightsPresetLibrary") || "{}",
    );
    expect(library.custom[0]).toMatchObject({
      name: "Peak watch",
      layers: expect.arrayContaining(["revenue"]),
    });
  });

  it("renames a named preset and restores it across mounts", async () => {
    storeCustomPreset("Peak watch");
    const view = renderInsights();

    await user.click(screen.getByRole("button", { name: "Preset actions" }));
    await user.click(screen.getByRole("menuitem", { name: /Rename preset/ }));
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
  });

  it("deletes a named preset", async () => {
    storeCustomPreset("Morning peak");
    renderInsights();

    await user.click(screen.getByRole("button", { name: "Preset actions" }));
    await user.click(screen.getByRole("menuitem", { name: /Delete preset/ }));
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

    await user.click(screen.getByRole("button", { name: "Preset actions" }));
    expect(
      screen.getByRole("menuitem", { name: "Save as new preset" }),
    ).toHaveAttribute("aria-disabled", "true");
  });

  it("offers expected renewable output as an insight layer", async () => {
    renderInsights();
    await user.click(screen.getByRole("button", { name: /Layers/ }));
    await user.click(
      screen.getByRole("checkbox", { name: "Renewable output" }),
    );

    expect(
      screen.getByText("Renewable output", { selector: "h6" }),
    ).toBeVisible();
    expect(
      screen.getByTestId("renewable-capacity-factor-chart"),
    ).toHaveAttribute("data-sync-key", "insights");
  });

  it("combines recorded monthly data with the continuous forecast", async () => {
    localStorage.setItem(
      "insightsLayers",
      JSON.stringify(["supplyDemand", "profit", "fuelPrices"]),
    );
    const game = gameWithHistory();
    renderInsights(100, game);

    await user.click(screen.getByRole("button", { name: "Fit full timeline" }));

    expect(
      screen.getByRole("region", { name: "Planning controls" }),
    ).toBeVisible();
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

    await user.click(screen.getByRole("button", { name: /Layers/ }));
    expect(screen.getByRole("checkbox", { name: "Fuel Prices" })).toBeEnabled();
    expect(screen.getByRole("checkbox", { name: "Profit" })).toBeEnabled();
  });

  it("defers chart projection updates until a facility drag ends", () => {
    const game = createGame({ scenarioId: 100 });
    const props: React.ComponentProps<typeof Insights> = {
      game,
      selectedFacilityId: null,
      facilityDragActive: false,
      onDelta: () => undefined,
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
});
