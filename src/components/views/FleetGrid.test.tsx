import { fireEvent, render, screen, within } from "@testing-library/react";
import FleetGrid from "./FleetGrid";
import { createGame } from "../../testing/Simulator";
import { currentTick } from "../../helpers/GameSelectors";
import { GameType, GeneratorOperatingType, isStorage } from "../../Types";
import cloneDeep from "lodash.clonedeep";
import gameReducer, { buildTransmissionLine } from "../../reducers/Game";
import { COLD_DEFINITION_ID } from "../../helpers/Hazards";
import { MINUTES_PER_MONTH } from "../../helpers/DateTime";

function showSummary(game: GameType, selectedFacilityId: number | null = null) {
  const onSelect = jest.fn();
  const onInspectInterties = jest.fn();
  const onToggleForecast = jest.fn();
  const props = {
    game,
    selectedFacilityId,
    onSelect,
    onInspectInterties,
    forecastOpen: false,
    onToggleForecast,
  };
  return {
    ...render(<FleetGrid {...props} />),
    props,
    onSelect,
    onInspectInterties,
    onToggleForecast,
  };
}
function group(name: string) {
  return screen.getByRole("button", {
    name: new RegExp("^Inspect " + name + " group,"),
  });
}
it("uses authoritative net supply and demand rather than the generation mix total", () => {
  const game = createGame({ scenarioId: 107 });
  const now = currentTick(game)!;
  now.supplyW = 500000000;
  now.demandW = 700000000;
  showSummary(game);
  const balance = screen.getByLabelText("Current power balance");
  expect(balance).toHaveTextContent("200MW short");
  expect(balance).toHaveTextContent("Supply now500MW");
  expect(balance).toHaveTextContent("Demand now700MW");
  expect(
    balance.compareDocumentPosition(group("Wind")) &
      Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
});
it("groups a large fleet in stable technology order and navigates the existing dispatch rows", () => {
  const game = createGame({ scenarioId: 107 });
  const originals = game.facilities;
  game.facilities = Array.from({ length: 30 }, (_, index) => ({
    ...cloneDeep(originals[index % originals.length]),
    id: index + 100,
  }));
  const { onSelect, rerender, props } = showSummary(game);
  const names = screen
    .getAllByRole("button", { name: /^Inspect .* group,/ })
    .map((node) => node.getAttribute("aria-label"));
  expect(names).toHaveLength(originals.length);
  const gas = game.facilities.find(
    (facility) => facility.name === "Natural Gas CC",
  )!;
  fireEvent.click(group("Natural Gas CC"));
  expect(onSelect).toHaveBeenLastCalledWith(gas.id);
  game.facilities.reverse();
  rerender(<FleetGrid {...props} selectedFacilityId={gas.id} />);
  expect(
    screen
      .getAllByRole("button", { name: /^Inspect .* group,/ })
      .map((node) => node.getAttribute("aria-label")),
  ).toEqual(names);
  expect(group("Natural Gas CC")).toHaveAttribute("aria-pressed", "true");
  expect(
    screen.queryByRole("button", { name: /^Inspect Natural Gas CC #/ }),
  ).toBeNull();
});
it("keeps distinct gas technologies separate and excludes construction from current output", () => {
  const game = createGame({ scenarioId: 107 });
  const gas = game.facilities.find(
    (facility) => facility.name === "Natural Gas CC",
  )!;
  gas.currentW = 100000000;
  game.facilities = [
    gas,
    { ...cloneDeep(gas), id: 500, currentW: 200000000 },
    { ...cloneDeep(gas), id: 501, yearsToBuildLeft: 1, currentW: 900000000 },
    { ...cloneDeep(gas), id: 502, name: "Natural Gas Peaker" },
  ];
  const { onSelect } = showSummary(game);
  expect(group("Natural Gas CC")).toHaveAccessibleName(
    /3 facilities, 300MW output/,
  );
  expect(group("Natural Gas Peaker")).toHaveAccessibleName(
    /1 facility, 100MW output/,
  );
  fireEvent.click(group("Natural Gas CC"));
  expect(onSelect).toHaveBeenLastCalledWith(501);
});
it("keeps simultaneous charging and discharging explicit without netting them", () => {
  const game = createGame({ scenarioId: 110 });
  const battery = game.facilities.find(isStorage)!;
  battery.currentW = -10000000;
  game.facilities = [
    battery,
    { ...cloneDeep(battery), id: 500, currentW: 5000000 },
  ];
  showSummary(game);
  expect(group("Battery")).toHaveTextContent("5MW out · 10MW in");
  expect(group("Battery")).toHaveAccessibleName(
    /discharging 5MW, charging 10MW/,
  );
});
it("shows counted exceptions and opens their affected facility", () => {
  const game = createGame({ scenarioId: 107 });
  const gas = game.facilities.find(
    (facility) => facility.name === "Natural Gas CC",
  )!;
  game.facilities = [
    gas,
    { ...cloneDeep(gas), id: 500, yearsToBuildLeft: 1 },
    { ...cloneDeep(gas), id: 501, paused: true, currentW: 0 },
  ];
  game.worldEvents.active.push({
    key: "summary-cold",
    definitionId: COLD_DEFINITION_ID,
    startsMinute: game.date.minute,
    endsMinute: game.date.minute + MINUTES_PER_MONTH,
    attributes: { hazard: "EXTREME_COLD" },
    effects: { facilityOutputMultipliersById: { [String(gas.id)]: 0.55 } },
  });
  const { onSelect } = showSummary(game);
  const exceptions = screen.getByLabelText("Facility exceptions");
  expect(exceptions).toHaveTextContent("1 building");
  expect(exceptions).toHaveTextContent("1 paused");
  expect(exceptions).toHaveTextContent("1 extreme cold");
  fireEvent.click(
    within(exceptions).getByRole("button", {
      name: "Inspect 1 paused facility",
    }),
  );
  expect(onSelect).toHaveBeenLastCalledWith(501);
});
it("keeps gross intertie directions and construction exceptions linked to trading controls", () => {
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
  const { onInspectInterties } = showSummary(game);
  const node = screen.getByRole("button", {
    name: /^Inspect interties and trading policy,/,
  });
  expect(node).toHaveTextContent("10MW in · 20MW out");
  expect(node).toHaveAccessibleName(
    /importing 10MW, exporting 20MW, 1 building/,
  );
  fireEvent.click(node);
  expect(onInspectInterties).toHaveBeenCalledTimes(1);
  expect(screen.getByLabelText("Facility exceptions")).toHaveTextContent(
    "1 intertie building",
  );
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
  showSummary(game);
  expect(
    Boolean(
      screen.queryByRole("button", {
        name: "Inspect 1 low reservoir facility",
      }),
    ),
  ).toBe(low);
});
it("prioritizes one low reservoir without hiding it behind healthy group members", () => {
  const game = createGame({ scenarioId: 108 });
  const hydro = game.facilities.find(
    (facility): facility is GeneratorOperatingType =>
      !isStorage(facility) && facility.fuel === "Hydro",
  )!;
  hydro.reservoirWh = hydro.reservoirCapacityWh! * 0.1;
  game.facilities = [
    { ...cloneDeep(hydro), id: 500, reservoirWh: hydro.reservoirCapacityWh },
    hydro,
  ];
  const { onSelect } = showSummary(game);
  expect(screen.getByLabelText("Facility exceptions")).toHaveTextContent(
    "1 low reservoir",
  );
  fireEvent.click(group("Hydro"));
  expect(onSelect).toHaveBeenLastCalledWith(hydro.id);
});
it("discloses forecast with an accessible expanded state", () => {
  const { props, rerender, onToggleForecast } = showSummary(
    createGame({ scenarioId: 107 }),
  );
  const forecast = screen.getByRole("button", { name: "Forecast" });
  expect(forecast).toHaveAttribute("aria-expanded", "false");
  fireEvent.click(forecast);
  expect(onToggleForecast).toHaveBeenCalledTimes(1);
  rerender(<FleetGrid {...props} forecastOpen />);
  expect(forecast).toHaveAttribute("aria-expanded", "true");
});
