import * as React from "react";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { EMPTY_HISTORY } from "../../helpers/DateTime";
import { createGame } from "../../testing/Simulator";
import { GameType } from "../../Types";
import Insights, {
  INSIGHT_LAYERS,
  INSIGHT_PRESETS,
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
  default: ({ syncKey, timeline }: ChartMockProps) => (
    <div
      role="img"
      data-chart="supply-demand"
      data-testid="supply-demand-chart"
      data-sync-key={syncKey}
      data-points={timeline?.length}
    />
  ),
}));
jest.mock("../base/ChartForecastStorage", () => ({
  __esModule: true,
  default: ({ syncKey }: ChartMockProps) => (
    <div role="img" data-chart="storage" data-sync-key={syncKey} />
  ),
}));
jest.mock("../base/ChartForecastSolarCapacityFactor", () => ({
  __esModule: true,
  default: ({ syncKey }: ChartMockProps) => (
    <div
      role="img"
      data-testid="solar-capacity-factor-chart"
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
  default: ({ syncKey }: ChartMockProps) => (
    <div role="img" data-chart="weather" data-sync-key={syncKey} />
  ),
}));

const user = userEvent.setup({ delay: null });

function renderInsights(scenarioId = 100, suppliedGame?: GameType) {
  return render(
    <Insights
      game={suppliedGame || createGame({ scenarioId })}
      selectedFacilityId={null}
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

  it("defines unique layers and useful presets", () => {
    expect(new Set(INSIGHT_LAYERS.map((layer) => layer.id)).size).toBe(
      INSIGHT_LAYERS.length,
    );
    expect(INSIGHT_PRESETS.reliability.layers).toContain("supplyDemand");
    expect(INSIGHT_PRESETS.reliability.layers).toContain("demandByType");
    expect(INSIGHT_PRESETS.profitability.layers).toContain("profit");
    expect(presetForLayers(INSIGHT_PRESETS.growth.layers)).toBe("growth");
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
    await user.click(screen.getByRole("checkbox", { name: "Profit" }));
    await user.click(screen.getByRole("button", { name: "Move Profit up" }));

    const stored = JSON.parse(localStorage.getItem("insightsLayers") || "[]");
    expect(stored).toContain("profit");
    view.unmount();

    renderInsights();
    expect(screen.getByText("Profit", { selector: "h6" })).toBeVisible();
    expect(
      screen.getByRole("combobox", { name: "Insight preset" }),
    ).toHaveTextContent("Custom");
  });

  it("offers a solar capacity factor chart as an insight layer", async () => {
    renderInsights();
    await user.click(screen.getByRole("button", { name: /Layers/ }));
    await user.click(
      screen.getByRole("checkbox", { name: "Solar Capacity Factor" }),
    );

    expect(
      screen.getByText("Solar Capacity Factor", { selector: "h6" }),
    ).toBeVisible();
    expect(screen.getByTestId("solar-capacity-factor-chart")).toHaveAttribute(
      "data-sync-key",
      "insights",
    );
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
      screen.queryByRole("region", { name: "Planning levers" }),
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
});
