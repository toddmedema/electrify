import * as React from "react";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createGame } from "../../testing/Simulator";
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
}

jest.mock("../base/ChartFinances", () => ({
  __esModule: true,
  default: ({ id, syncKey }: ChartMockProps) => (
    <div role="img" id={id} data-sync-key={syncKey} />
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
  default: ({ syncKey }: ChartMockProps) => (
    <div role="img" data-chart="supply-demand" data-sync-key={syncKey} />
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

function renderInsights(scenarioId = 100) {
  return render(
    <Insights
      game={createGame({ scenarioId })}
      selectedFacilityId={null}
      onDelta={() => undefined}
    />,
  );
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
      "CO2e Emitted",
    ];
    expect(headings).toHaveLength(expected.length);
    expected.forEach((label, index) =>
      expect(headings[index]).toHaveTextContent(label),
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
});
