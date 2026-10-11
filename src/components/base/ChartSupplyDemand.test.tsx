import { render, screen } from "@testing-library/react";
import ChartSupplyDemand, {
  formatProductionTooltip,
  productionStack,
  Props,
} from "./ChartSupplyDemand";
import { LOCATIONS } from "../../Constants";

const timeline: Props["timeline"] = [
  {
    minute: 0,
    supplyW: 120,
    demandW: 100,
    supplyByFuel: { Coal: 100, Sun: 0, Wind: 0 },
    importedW: 30,
    storageChargeW: 10,
  },
  {
    minute: 60,
    supplyW: 110,
    demandW: 120,
    supplyByFuel: { Coal: 80, Sun: 40 },
    storageDischargeW: 10,
    exportedW: 20,
  },
];

it("stacks fuels in dispatch order and includes production absent from the current fleet", () => {
  const stack = productionStack(timeline, ["Sun", "Wind"]);
  expect(stack.fuels).toEqual(["Sun", "Coal"]);
  expect(stack.byFuel).toEqual([
    [0, 40],
    [100, 80],
  ]);
  expect(stack.stacked).toEqual([
    [0, 40],
    [100, 120],
  ]);
  expect(stack.production).toEqual([100, 120]);
});

it("reports individual output and customer supply separately from cumulative production", () => {
  const stack = productionStack(timeline, ["Sun", "Coal"]);
  const state = { timeline, ...stack, startingYear: 2020 };
  expect(formatProductionTooltip(0, state)).toContain("Imports: 30W");
  expect(formatProductionTooltip(0, state)).toContain("Storage charging: 10W");
  expect(formatProductionTooltip(1, state)).toContain("Coal: 80W");
  expect(formatProductionTooltip(1, state)).toContain("Total production: 120W");
  expect(formatProductionTooltip(1, state)).toContain(
    "Supply to customers: 110W",
  );
  expect(formatProductionTooltip(1, state)).toContain(
    "Storage discharging: 10W",
  );
  expect(formatProductionTooltip(1, state)).toContain("Exports: 20W");
  expect(formatProductionTooltip(1, state)).toContain("Blackout: 10W unmet");
});

it("makes unstacked fuel output and blackout meaning readable without the canvas", () => {
  render(
    <ChartSupplyDemand
      timeline={timeline}
      fuelOrder={["Sun", "Coal"]}
      currentMinute={30}
      location={LOCATIONS.SF}
      startingYear={2020}
      legend
    />,
  );
  const chart = screen.getByRole("img", {
    name: /electricity supply and demand over the day/i,
  });
  expect(chart).toHaveAccessibleName(/Coal: latest 80W, range 80W to 100W/);
  expect(chart).toHaveAccessibleName(/Sun: latest 40W, range 0W to 40W/);
  expect(chart).toHaveAccessibleName(/Total production: latest 120W/);
  expect(chart).toHaveAccessibleName(/Supply to customers: latest 110W/);
  expect(screen.getByText("Blackout")).toBeVisible();
  expect(screen.queryByText("Wind")).not.toBeInTheDocument();
});

it("keeps a demand chart with customer supply when no generators are producing", () => {
  render(
    <ChartSupplyDemand
      timeline={[{ minute: 0, supplyW: 50, demandW: 50, supplyByFuel: {} }]}
      currentMinute={0}
      location={LOCATIONS.SF}
      startingYear={2020}
      legend
    />,
  );
  expect(screen.getByText("Supply to customers")).toBeVisible();
  expect(screen.getByRole("img")).toHaveAccessibleName(
    /Total production: latest 0W/,
  );
  expect(screen.queryByText("Blackout")).not.toBeInTheDocument();
});
