import { fireEvent, render, screen, within } from "@testing-library/react";
import FleetGrid from "./FleetGrid";
import { createGame } from "../../testing/Simulator";
import { currentTick } from "../../helpers/GameSelectors";
import { GameType, GeneratorOperatingType, isStorage } from "../../Types";
import cloneDeep from "lodash.clonedeep";
import gameReducer, { buildTransmissionLine } from "../../reducers/Game";
import { COLD_DEFINITION_ID } from "../../helpers/Hazards";
import { MINUTES_PER_MONTH } from "../../helpers/DateTime";

function showGrid(game: GameType, selectedFacilityId: number | null = null) {
  const onSelect = jest.fn();
  const onInspectInterties = jest.fn();
  const props = { game, selectedFacilityId, onSelect, onInspectInterties };
  return {
    ...render(<FleetGrid {...props} />),
    props,
    onSelect,
    onInspectInterties,
  };
}

function group(name: string) {
  return screen.getByRole("button", {
    name: new RegExp(`^Inspect ${name} group,`),
  });
}

it("puts authoritative supply, demand and shortfall before the technology groups", () => {
  const game = createGame({ scenarioId: 107 });
  const now = currentTick(game)!;
  now.supplyW = 500000000;
  now.demandW = 700000000;
  showGrid(game);
  const balance = screen.getByLabelText("Current power balance");
  expect(balance).toHaveTextContent("200MW short");
  expect(balance).toHaveTextContent("500MW grid supply");
  expect(balance).toHaveTextContent("700MW demand now");
  expect(
    balance.compareDocumentPosition(group("Wind")) &
      Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
});

it("groups 30 repeated plants without inheriting dispatch order, and selects by unique ID", () => {
  const game = createGame({ scenarioId: 107 });
  const originals = game.facilities;
  game.facilities = Array.from({ length: 30 }, (_, index) => ({
    ...cloneDeep(originals[index % originals.length]),
    id: index + 100,
  }));
  const { onSelect, rerender, props } = showGrid(game);
  const nodes = screen.getAllByRole("button", { name: /^Inspect .* group,/ });
  expect(nodes).toHaveLength(originals.length);
  const names = nodes.map((node) => within(node).getByText(/×/).textContent);
  const gas = group("Natural Gas CC");
  fireEvent.click(gas);
  const gasFacilities = game.facilities
    .filter((facility) => facility.name === "Natural Gas CC")
    .sort((a, b) => a.id - b.id);
  expect(
    screen.getAllByRole("button", { name: /^Inspect Natural Gas CC #/ }),
  ).toHaveLength(gasFacilities.length);
  fireEvent.click(
    screen.getByRole("button", {
      name: new RegExp(`^Inspect Natural Gas CC #${gasFacilities[1].id} ·`),
    }),
  );
  expect(onSelect).toHaveBeenLastCalledWith(gasFacilities[1].id);
  game.facilities.reverse();
  rerender(<FleetGrid {...props} selectedFacilityId={gasFacilities[1].id} />);
  expect(
    screen
      .getAllByRole("button", { name: /^Inspect .* group,/ })
      .map((node) => within(node).getByText(/×/).textContent),
  ).toEqual(names);
  expect(group("Natural Gas CC")).toHaveAttribute("aria-expanded", "true");
  fireEvent.click(screen.getByRole("button", { name: "Close facility group" }));
  expect(onSelect).toHaveBeenLastCalledWith(null);
});

it("keeps different gas technologies separate and sums output on a rated power scale", () => {
  const game = createGame({ scenarioId: 107 });
  const gas = game.facilities.find(
    (facility) => facility.name === "Natural Gas CC",
  )!;
  gas.currentW = 100000000;
  gas.peakW = 200000000;
  game.facilities = [
    gas,
    { ...cloneDeep(gas), id: 500, currentW: 200000000, peakW: 400000000 },
    { ...cloneDeep(gas), id: 501, name: "Natural Gas Peaker" },
  ];
  showGrid(game);
  expect(group("Natural Gas CC")).toHaveTextContent("×2");
  expect(group("Natural Gas CC")).toHaveTextContent("300/600MW output");
  expect(within(group("Natural Gas CC")).getByRole("meter")).toHaveAttribute(
    "aria-valuenow",
    "50",
  );
  expect(group("Natural Gas Peaker")).toHaveTextContent("×1");
});

it("keeps simultaneous charging and discharging visible and weights stored charge by capacity", () => {
  const game = createGame({ scenarioId: 110 });
  const battery = game.facilities.find(isStorage)!;
  battery.currentWh = 100000000;
  battery.peakWh = 400000000;
  battery.currentW = -10000000;
  game.facilities = [
    battery,
    {
      ...cloneDeep(battery),
      id: 500,
      peakWh: 100000000,
      currentWh: 100000000,
      currentW: 5000000,
    },
  ];
  const { onSelect } = showGrid(game);
  const node = group("Battery");
  expect(node).toHaveTextContent("Charging 10MW");
  expect(node).toHaveTextContent("Discharging 5MW");
  expect(node).toHaveTextContent("40% charged · 200MWh stored");
  expect(
    within(node).getByRole("meter", { name: "Battery charge" }),
  ).toHaveAttribute("aria-valuenow", "40");
  fireEvent.click(node);
  expect(onSelect).toHaveBeenLastCalledWith(null);
  expect(
    screen.getByRole("button", { name: /^Inspect Battery #500/ }),
  ).toHaveTextContent("Discharging · 5MW");
});

it("selects a single facility directly and preserves selection after a live tick", () => {
  const game = createGame({ scenarioId: 110 });
  const battery = game.facilities.find(isStorage)!;
  const { onSelect, rerender, props } = showGrid(game);
  fireEvent.click(group("Battery"));
  expect(onSelect).toHaveBeenLastCalledWith(battery.id);
  battery.currentW = 5000000;
  rerender(<FleetGrid {...props} selectedFacilityId={battery.id} />);
  expect(group("Battery")).toHaveAttribute("aria-expanded", "true");
  expect(group("Battery")).toHaveTextContent("Discharging 5MW");
  fireEvent.click(group("Battery"));
  expect(onSelect).toHaveBeenLastCalledWith(null);
});

it("keeps a group open when deselecting a facility restored from Dispatch", () => {
  const game = createGame({ scenarioId: 110 });
  const battery = game.facilities.find(isStorage)!;
  game.facilities.push({ ...cloneDeep(battery), id: 500 });
  const { props, rerender, onSelect } = showGrid(game, battery.id);
  fireEvent.click(
    screen.getByRole("button", {
      name: new RegExp(`^Inspect Battery #${battery.id} ·`),
    }),
  );
  expect(onSelect).toHaveBeenLastCalledWith(null);
  rerender(<FleetGrid {...props} selectedFacilityId={null} />);
  expect(group("Battery")).toHaveAttribute("aria-expanded", "true");
  expect(
    screen.getAllByRole("button", { name: /^Inspect Battery #/ }),
  ).toHaveLength(2);
});

it("shows construction, paused and weather exceptions without counting future capacity", () => {
  const game = createGame({ scenarioId: 107 });
  const gas = game.facilities.find(
    (facility) => facility.name === "Natural Gas CC",
  )!;
  gas.currentW = 100000000;
  gas.peakW = 200000000;
  const building = {
    ...cloneDeep(gas),
    id: 500,
    yearsToBuild: 2,
    yearsToBuildLeft: 1,
    currentW: 900000000,
  };
  const paused = { ...cloneDeep(gas), id: 501, currentW: 0, paused: true };
  game.facilities = [gas, building, paused];
  game.worldEvents.active.push({
    key: "grid-cold",
    definitionId: COLD_DEFINITION_ID,
    startsMinute: game.date.minute,
    endsMinute: game.date.minute + MINUTES_PER_MONTH,
    attributes: { hazard: "EXTREME_COLD" },
    effects: { facilityOutputMultipliersById: { [String(gas.id)]: 0.55 } },
  });
  showGrid(game);
  const node = group("Natural Gas CC");
  expect(node).toHaveTextContent("100/400MW output");
  expect(node).toHaveTextContent("1 extreme cold");
  expect(node).toHaveTextContent("1 building");
  expect(node).toHaveTextContent("1 paused");
  fireEvent.click(node);
  expect(
    screen.getByRole("button", { name: /^Inspect Natural Gas CC #500/ }),
  ).toHaveTextContent("Building · 12 months left");
  expect(
    screen.getByRole("button", {
      name: new RegExp(`^Inspect Natural Gas CC #${gas.id} ·`),
    }),
  ).toHaveTextContent("Extreme cold · 55% available");
});

it("uses gross intertie directions, visible exceptions and the existing trading controls", () => {
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
  game.transmission!.lines.push(
    { ...cloneDeep(line), id: 500, currentFlowW: 10000000 },
    {
      ...cloneDeep(line),
      id: 501,
      yearsToBuildLeft: 1,
      currentFlowW: 1000000000,
    },
  );
  const { onInspectInterties } = showGrid(game);
  const node = screen.getByRole("button", {
    name: "Inspect interties and trading policy",
  });
  expect(node).toHaveTextContent("Importing 10MW");
  expect(node).toHaveTextContent("Exporting 20MW");
  expect(node).toHaveTextContent("1 building");
  fireEvent.click(node);
  expect(onInspectInterties).toHaveBeenCalledTimes(1);
});

it.each([
  [19.49, true],
  [19.5, false],
  [0, true],
  [75, false],
])("preserves the rounded hydro warning threshold at %s%%", (percent, low) => {
  const game = createGame({ scenarioId: 108 });
  const hydro = game.facilities.find(
    (facility): facility is GeneratorOperatingType =>
      !isStorage(facility) && facility.fuel === "Hydro",
  )!;
  hydro.reservoirWh = (hydro.reservoirCapacityWh! * Number(percent)) / 100;
  showGrid(game);
  expect(group("Hydro")).toHaveTextContent(
    `Reservoir ${Math.round(Number(percent))}%`,
  );
  expect(group("Hydro").textContent?.includes("1 low reservoir")).toBe(low);
});

it("does not hide one low reservoir behind a healthy aggregate", () => {
  const game = createGame({ scenarioId: 108 });
  const hydro = game.facilities.find(
    (facility): facility is GeneratorOperatingType =>
      !isStorage(facility) && facility.fuel === "Hydro",
  )!;
  hydro.reservoirCapacityWh = 100000000;
  hydro.reservoirWh = 10000000;
  game.facilities = [
    hydro,
    {
      ...cloneDeep(hydro),
      id: 500,
      reservoirCapacityWh: 900000000,
      reservoirWh: 900000000,
    },
  ];
  showGrid(game);
  expect(group("Hydro")).toHaveTextContent("Reservoir 91%");
  expect(group("Hydro")).toHaveTextContent("1 low reservoir");
});
