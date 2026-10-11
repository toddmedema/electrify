import { render, screen } from "@testing-library/react";
import ChartSupplyDemand, {
  formatProductionTooltip,
  productionStack,
  supplyDemandStack,
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

it("balances charging, discharging, imports and exports without netting away storage", () => {
  const ticks = timeline.map((tick) => ({ ...tick }));
  ticks[1].storageChargeW = 5;
  ticks[1].supplyW -= 5;
  const stack = supplyDemandStack(ticks, ["Sun", "Coal"]);
  expect(stack.sources).toEqual([
    "Sun",
    "Coal",
    "Storage discharge",
    "Imports",
  ]);
  expect(stack.supply).toEqual([130, 130]);
  expect(stack.totalDemand).toEqual([110, 145]);
  ticks.forEach((tick, i) => {
    expect(stack.supply[i] - stack.totalDemand[i]).toBe(
      tick.supplyW - tick.demandW,
    );
  });
  expect(stack.bySource[2]).toEqual([0, 10]);
  expect(stack.bySource[3]).toEqual([30, 0]);
});

it("handles older records without optional flow fields and omits unused source keys", () => {
  const stack = supplyDemandStack(
    [
      { minute: 0, supplyW: 50, demandW: 40, supplyByFuel: { Coal: 50 } },
      {
        minute: 60,
        supplyW: 0,
        demandW: 40,
        supplyByFuel: { Coal: 0 },
        storageDischargeW: 0,
        importedW: 0,
      },
    ],
    ["Coal", "Sun"],
  );
  expect(stack.sources).toEqual(["Coal"]);
  expect(stack.supply).toEqual([50, 0]);
  expect(stack.totalDemand).toEqual([40, 40]);
});

it("reports raw source output and the full demand breakdown", () => {
  const stack = supplyDemandStack(timeline, ["Sun", "Coal"]);
  const state = { timeline, ...stack, startingYear: 2020 };
  expect(formatProductionTooltip(0, state)).toContain("Imports: 30W");
  expect(formatProductionTooltip(0, state)).toContain("Storage charging: 10W");
  expect(formatProductionTooltip(1, state)).toContain("Coal: 80W");
  expect(formatProductionTooltip(1, state)).toContain("Total supply: 130W");
  expect(formatProductionTooltip(1, state)).toContain("Customers: 120W");
  expect(formatProductionTooltip(1, state)).toContain("Storage discharge: 10W");
  expect(formatProductionTooltip(1, state)).toContain("Exports: 20W");
  expect(formatProductionTooltip(1, state)).toContain("Total demand: 140W");
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
  expect(chart).toHaveAccessibleName(/Total supply: latest 130W/);
  expect(chart).toHaveAccessibleName(/Total demand: latest 140W/);
  expect(chart).toHaveAttribute("tabindex", "0");
  expect(chart).toHaveAccessibleName(/1 blackout period shaded/);
  expect(screen.queryByText("Blackout")).not.toBeInTheDocument();
  expect(screen.queryByText("Supply to customers")).not.toBeInTheDocument();
  expect(screen.queryByText(/Bands: fuel output/)).not.toBeInTheDocument();
  expect(screen.queryByText("Wind")).not.toBeInTheDocument();
});

it("shows imported supply when no generators are producing", () => {
  render(
    <ChartSupplyDemand
      timeline={[
        {
          minute: 0,
          supplyW: 50,
          demandW: 50,
          supplyByFuel: {},
          importedW: 50,
        },
      ]}
      currentMinute={0}
      location={LOCATIONS.SF}
      startingYear={2020}
      legend
    />,
  );
  expect(screen.getByText("Total demand")).toBeVisible();
  expect(screen.getByText("Imports")).toBeVisible();
  expect(screen.queryByText("Supply to customers")).not.toBeInTheDocument();
  expect(screen.getByRole("img")).toHaveAccessibleName(
    /Total supply: latest 50W/,
  );
  expect(screen.queryByText("Blackout")).not.toBeInTheDocument();
});

it("ends blackout shading when storage exactly meets the customer deficit", () => {
  render(
    <ChartSupplyDemand
      timeline={[
        { minute: 0, supplyW: 80, demandW: 100, supplyByFuel: { Coal: 80 } },
        {
          minute: 60,
          supplyW: 100,
          demandW: 100,
          supplyByFuel: { Coal: 80 },
          storageDischargeW: 20,
        },
        { minute: 120, supplyW: 80, demandW: 100, supplyByFuel: { Coal: 80 } },
      ]}
      currentMinute={60}
      location={LOCATIONS.SF}
      startingYear={2020}
      legend
    />,
  );
  expect(screen.getByRole("img")).toHaveAccessibleName(
    /2 blackout periods shaded/,
  );
});
