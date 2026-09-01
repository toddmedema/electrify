import * as React from "react";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { EMPTY_HISTORY } from "../../helpers/DateTime";
import { createGame } from "../../testing/Simulator";
import { GameType } from "../../Types";
import Insights, {
  INSIGHT_LAYERS,
  INSIGHT_PRESETS,
  MAX_CUSTOM_INSIGHT_PRESETS,
  presetForLayers,
  withRequiredLayers,
} from "./Insights";

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
}

let mockSupplyDemandPaints = 0;

jest.mock("../base/ChartFinances", () => ({
  __esModule: true,
  default: ({ id, syncKey, timeline }: ChartMockProps) => (
    <div
      role="img"
      id={id}
      data-testid={id}
      data-sync-key={syncKey}
      data-points={timeline?.length}
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
  default: ({ syncKey, timeline }: ChartMockProps) => {
    mockSupplyDemandPaints++;
    return (
      <div
        role="img"
        data-chart="supply-demand"
        data-testid="supply-demand-chart"
        data-sync-key={syncKey}
        data-points={timeline?.length}
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

function renderInsights(scenarioId = 100, suppliedGame?: GameType) {
  return render(
    <Insights
      game={suppliedGame || createGame({ scenarioId })}
      selectedFacilityId={null}
      facilityDragActive={false}
      onDelta={() => undefined}
    />,
  );
}

function gameWithHistory(): GameType {
  const game = createGame({ scenarioId: 100 });
  game.date.year = game.startingYear + 2;
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
    expect(levers.textContent).not.toMatch(/market [^·]*\/kWh/);
  });

  it("keeps the customer growth rate visible for public utilities", () => {
    renderInsights(107);

    const levers = screen.getByRole("region", { name: "Planning controls" });
    expect(levers).toHaveTextContent(/customer growth \+1.5%\/yr/i);
    expect(levers).not.toHaveTextContent(/market/i);
  });

  it("offers one rolling 12-month range instead of separate calendar years", async () => {
    localStorage.setItem("insightsRange", "current");
    renderInsights();

    const range = screen.getByRole("combobox", { name: "Insight range" });
    expect(range).toHaveTextContent("Next 12 months");
    await user.click(range);

    const options = within(await screen.findByRole("listbox"));
    expect(options.getByText("Next 12 months")).toBeVisible();
    expect(options.queryByText("Current year")).toBeNull();
    expect(options.queryByText("Next year")).toBeNull();
  });

  it.each([
    ["next10", "2880"],
    ["next20", "5760"],
  ])("uses hourly points for the %s forecast", (range, expectedPoints) => {
    localStorage.setItem("insightsRange", range);
    localStorage.setItem("insightsLayers", JSON.stringify(["weather"]));
    renderInsights();

    expect(screen.getByRole("img")).toHaveAttribute(
      "data-points",
      expectedPoints,
    );
    expect(screen.getByRole("img")).toHaveAttribute("data-step", "60");
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
      screen.getByRole("menuitem", { name: /Restore original preset/ }),
    );
    await user.click(screen.getByRole("button", { name: "Restore" }));

    expect(screen.queryByText("Revenue", { selector: "h6" })).toBeNull();
    const library = JSON.parse(
      localStorage.getItem("insightsPresetLibrary") || "{}",
    );
    expect(library.defaults.overview).toBeUndefined();
  });

  it("creates, updates, renames, and deletes a named preset", async () => {
    const view = renderInsights();
    await user.click(screen.getByRole("button", { name: "Preset actions" }));
    await user.click(
      screen.getByRole("menuitem", { name: /Save as new preset/ }),
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
    let library = JSON.parse(
      localStorage.getItem("insightsPresetLibrary") || "{}",
    );
    expect(library.custom[0]).toMatchObject({
      name: "Peak watch",
      layers: expect.arrayContaining(["revenue"]),
    });

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

    await user.click(screen.getByRole("button", { name: "Preset actions" }));
    await user.click(screen.getByRole("menuitem", { name: /Delete preset/ }));
    await user.click(screen.getByRole("button", { name: "Delete" }));
    expect(
      screen.getByRole("combobox", { name: "Insight preset" }),
    ).toHaveTextContent("Unsaved view");
    library = JSON.parse(localStorage.getItem("insightsPresetLibrary") || "{}");
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
      screen.getByRole("menuitem", { name: /Save as new preset/ }),
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

  it("charts recorded monthly data and disables forecast-only layers", async () => {
    localStorage.setItem(
      "insightsLayers",
      JSON.stringify(["supplyDemand", "profit", "fuelPrices"]),
    );
    const game = gameWithHistory();
    renderInsights(100, game);

    await user.click(screen.getByRole("combobox", { name: "Insight range" }));
    const ranges = within(await screen.findByRole("listbox"));
    expect(ranges.getByText(String(game.startingYear))).toBeVisible();
    await user.click(ranges.getByText("All recorded"));

    expect(
      screen.queryByRole("region", { name: "Planning controls" }),
    ).toBeNull();
    expect(
      screen.getByText(
        "Monthly records · forecast-only layers are unavailable",
      ),
    ).toBeVisible();
    expect(
      screen.getByText("Supply & Demand", { selector: "h6" }),
    ).toBeVisible();
    expect(screen.getByText("Profit", { selector: "h6" })).toBeVisible();
    expect(screen.queryByText("Fuel Prices", { selector: "h6" })).toBeNull();
    expect(screen.getByTestId("chartInsightsProfitPlot")).toHaveAttribute(
      "data-points",
      "3",
    );
    expect(screen.getByTestId("supply-demand-chart")).toHaveAttribute(
      "data-points",
      "3",
    );
    expect(screen.getByText(/Energy not served:/)).toBeVisible();

    await user.click(screen.getByRole("combobox", { name: "Insight range" }));
    await user.click(
      within(await screen.findByRole("listbox")).getByText(
        String(game.startingYear),
      ),
    );
    expect(screen.getByTestId("chartInsightsProfitPlot")).toHaveAttribute(
      "data-points",
      "2",
    );

    await user.click(screen.getByRole("button", { name: /Layers/ }));
    expect(
      screen.getByRole("checkbox", { name: "Fuel Prices" }),
    ).toBeDisabled();
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
