import { fireEvent, render, screen, within } from "@testing-library/react";
import FleetGrid from "./FleetGrid";
import { createGame } from "../../testing/Simulator";
import { currentTick } from "../../helpers/GameSelectors";
import { isStorage } from "../../Types";
import { formatWatts } from "../../helpers/Format";
import cloneDeep from "lodash.clonedeep";
import gameReducer, { buildTransmissionLine } from "../../reducers/Game";
import { COLD_DEFINITION_ID } from "../../helpers/Hazards";
import { MINUTES_PER_MONTH } from "../../helpers/DateTime";

it("shows actual grid supply and a shortfall without inventing available output", () => {
  const game = createGame({ scenarioId: 107 });
  const now = currentTick(game)!;
  now.supplyW = 500000000;
  now.demandW = 700000000;
  render(
    <FleetGrid
      game={game}
      selectedFacilityId={null}
      onSelect={jest.fn()}
      onInspectInterties={jest.fn()}
    />,
  );
  expect(screen.getByText("200MW short")).toBeInTheDocument();
  expect(screen.getByText("500MW grid supply")).toBeInTheDocument();
  expect(screen.getByText("700MW demand now")).toBeInTheDocument();
});

it("distinguishes storage charge from grid flow, and connects selection to the facility ID", () => {
  const game = createGame({ scenarioId: 110 });
  const battery = game.facilities.find(isStorage)!;
  battery.currentWh = battery.peakWh * 0.25;
  battery.currentW = -10000000;
  const onSelect = jest.fn();
  const { rerender } = render(
    <FleetGrid
      game={game}
      selectedFacilityId={null}
      onSelect={onSelect}
      onInspectInterties={jest.fn()}
    />,
  );
  const node = screen.getByRole("button", { name: /^Inspect Battery in grid/ });
  expect(node).toHaveTextContent("25% charged");
  expect(
    within(node).getByRole("meter", { name: "Battery charge" }),
  ).toHaveAttribute("aria-valuenow", "25");
  expect(node).toHaveTextContent("Charging · 10MW");
  fireEvent.click(node);
  expect(onSelect).toHaveBeenLastCalledWith(battery.id);
  battery.currentW = 5000000;
  rerender(
    <FleetGrid
      game={game}
      selectedFacilityId={battery.id}
      onSelect={onSelect}
      onInspectInterties={jest.fn()}
    />,
  );
  expect(node).toHaveTextContent("Supplying · 5MW");
  expect(node).toHaveAttribute("aria-pressed", "true");
  fireEvent.click(node);
  expect(onSelect).toHaveBeenLastCalledWith(null);
});

it("labels unfinished facilities instead of presenting them as live output", () => {
  const game = createGame({ scenarioId: 107 });
  const facility = game.facilities.find(
    (item) => item.name === "Natural Gas CC",
  )!;
  facility.yearsToBuild = 2;
  facility.yearsToBuildLeft = 1;
  render(
    <FleetGrid
      game={game}
      selectedFacilityId={null}
      onSelect={jest.fn()}
      onInspectInterties={jest.fn()}
    />,
  );
  expect(
    screen.getByRole("button", { name: /^Inspect Natural Gas CC in grid/ }),
  ).toHaveTextContent("50% builtBuilding · 12 months left");
  expect(
    screen.getByRole("meter", { name: "Natural Gas CC construction progress" }),
  ).toHaveAttribute("aria-valuenow", "50");
});

it("uses real intertie direction and opens the existing trading controls", () => {
  const game = cloneDeep(
    gameReducer(
      createGame({ scenarioId: 100 }),
      buildTransmissionLine({
        corridorId: "california-north",
        financed: false,
      }),
    ),
  );
  const line = game.transmission!.lines[0];
  line.yearsToBuildLeft = 0;
  line.currentFlowW = -20000000;
  const onInspectInterties = jest.fn();
  render(
    <FleetGrid
      game={game}
      selectedFacilityId={null}
      onSelect={jest.fn()}
      onInspectInterties={onInspectInterties}
    />,
  );
  const interties = screen.getByRole("button", {
    name: "Inspect interties and trading policy",
  });
  expect(interties).toHaveTextContent(line.name);
  expect(interties).toHaveTextContent(
    `Exporting ${formatWatts(-line.currentFlowW)}`,
  );
  fireEvent.click(interties);
  expect(onInspectInterties).toHaveBeenCalledTimes(1);
});

it("reports a weather outage without treating zero output as its cause", () => {
  const game = createGame({ scenarioId: 107 });
  const gas = game.facilities.find(
    (facility) => facility.fuel === "Natural Gas",
  )!;
  game.worldEvents.active.push({
    key: "grid-cold",
    definitionId: COLD_DEFINITION_ID,
    startsMinute: game.date.minute,
    endsMinute: game.date.minute + MINUTES_PER_MONTH,
    attributes: { hazard: "EXTREME_COLD" },
    effects: { facilityOutputMultipliersById: { [String(gas.id)]: 0.55 } },
  });
  const { rerender } = render(
    <FleetGrid
      game={game}
      selectedFacilityId={null}
      onSelect={jest.fn()}
      onInspectInterties={jest.fn()}
    />,
  );
  const node = screen.getByRole("button", {
    name: /^Inspect Natural Gas CC in grid/,
  });
  expect(node).toHaveTextContent("Extreme cold · 55% available");
  gas.paused = true;
  rerender(
    <FleetGrid
      game={game}
      selectedFacilityId={null}
      onSelect={jest.fn()}
      onInspectInterties={jest.fn()}
    />,
  );
  expect(node).toHaveTextContent("Paused");
});

it("puts the generator meter on an explicit current/rated power scale", () => {
  const game = createGame({ scenarioId: 107 });
  const wind = game.facilities.find((facility) => facility.fuel === "Wind")!;
  wind.currentW = 600000000;
  render(
    <FleetGrid
      game={game}
      selectedFacilityId={null}
      onSelect={jest.fn()}
      onInspectInterties={jest.fn()}
    />,
  );
  const node = screen.getByRole("button", { name: /^Inspect Wind in grid/ });
  expect(node).toHaveTextContent("600MW/1.2GW output");
  const meter = within(node).getByRole("meter", { name: "Wind output" });
  expect(meter).toHaveAttribute("aria-valuenow", "50");
  expect(meter).toHaveAttribute("aria-valuemin", "0");
  expect(meter).toHaveAttribute("aria-valuemax", "100");
  expect(meter).toHaveAttribute("aria-valuetext", "50% output");
});

it.each([
  [75, "75%", false],
  [19.49, "19% · Low", true],
  [19.5, "20%", false],
  [0, "0% · Low", true],
])(
  "reports reservoir %s%% using the fleet row's rounded warning threshold",
  (percent, text, low) => {
    const game = createGame({ scenarioId: 108 });
    const hydro = game.facilities.find(
      (facility) => facility.fuel === "Hydro",
    )!;
    hydro.reservoirWh = (hydro.reservoirCapacityWh! * Number(percent)) / 100;
    render(
      <FleetGrid
        game={game}
        selectedFacilityId={null}
        onSelect={jest.fn()}
        onInspectInterties={jest.fn()}
      />,
    );
    const node = screen.getByRole("button", { name: /^Inspect Hydro in grid/ });
    expect(node).toHaveTextContent(`Reservoir ${text}`);
    expect(within(node).getByText(`Reservoir ${text}`)).toHaveClass(
      "fleetGridStored",
    );
    expect(node).toHaveAccessibleName(
      new RegExp(
        `reservoir ${Math.round(Number(percent))}%${low ? " low" : ""}$`,
      ),
    );
    expect(within(node).getByText(`Reservoir ${text}`)).toHaveAttribute(
      "class",
      low ? "fleetGridStored fleetGridReservoirLow" : "fleetGridStored",
    );
  },
);
