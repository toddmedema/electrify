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

  it("defines unique layers and useful presets", () => {
    expect(new Set(INSIGHT_LAYERS.map((layer) => layer.id)).size).toBe(
      INSIGHT_LAYERS.length,
    );
    expect(INSIGHT_PRESETS.reliability.layers).toContain("supplyDemand");
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
});
