import * as React from "react";
import {
  fireEvent,
  render,
  screen,
  within,
  waitForElementToBeRemoved,
} from "@testing-library/react";
import { createGame } from "../../testing/Simulator";
import { inheritedConnection } from "../../helpers/PowerAgreements";
import { wToSliderTick } from "../../helpers/BuildSizing";
import { territorySiteInventory } from "../../helpers/Territories";
import TerritoryNetwork from "./TerritoryNetwork";
import BuildGenerators from "./BuildGenerators";
import BuildStorage from "./BuildStorage";
import TransmissionPanel from "./TransmissionPanel";
import { GameToolMemoryContext } from "../base/GameToolMemory";
import { TERRITORY_BUILD_MEMORY_KEY } from "../base/TerritoryBuildDestination";

jest.mock("../base/useOutlookWorker", () => ({
  useOutlookWorker: () => undefined,
}));
jest.mock(
  "../base/ManualLink",
  () => (props: { children?: React.ReactNode }) => <>{props.children}</>,
);

function network() {
  const game = createGame({ scenarioId: 116, seed: 188 });
  game.territoryNetwork = { version: 1 };
  game.timeline = game.timeline.map((tick) => ({ ...tick, cash: 1e9 }));
  return game;
}
function ownedValley() {
  const game = network();
  game.utilityExpansion!.acquisitions.push({
    targetId: "valley-electric",
    minute: 0,
    financed: false,
    transferredCustomers: 159000,
  });
  game.transmission!.lines.push({
    ...inheritedConnection("champlain", 99),
    corridorId: "vt-champlain-valley",
    name: "Champlain ↔ Valley",
    capacityW: 100e6,
    currentFlowW: -50e6,
  });
  return game;
}
const controls = {
  onBuild: jest.fn(),
  onUpgrade: jest.fn(),
  onBuyingRule: jest.fn(),
  onSellingRule: jest.fn(),
};

it("inspects all four territories and sends a real connection purchase through the existing dialog", () => {
  const onBuild = jest.fn();
  render(<TerritoryNetwork game={network()} {...controls} onBuild={onBuild} />);
  expect(
    screen.getAllByRole("button", { name: /^Inspect .* territory$/ }),
  ).toHaveLength(4);
  fireEvent.click(
    screen.getByRole("button", { name: "Inspect Green Uplands territory" }),
  );
  const detail = screen.getByRole("region", { name: "Selected territory" });
  expect(detail).toHaveTextContent("No customers transfer");
  fireEvent.click(
    within(detail).getByRole("button", {
      name: /Review purchase of .*Green Uplands/,
    }),
  );
  const dialog = screen.getByRole("dialog");
  expect(dialog).toHaveTextContent("No purchased power is included");
  fireEvent.click(within(dialog).getByRole("button", { name: "Pay cash" }));
  expect(onBuild).toHaveBeenCalledWith("vt-champlain-uplands", false, 1);
});

it("shows directed internal flow, local sites, and carries its build destination into the catalogue", () => {
  const game = ownedValley();
  const memory = new Map<string, unknown>();
  const onBuildFacility = jest.fn();
  render(
    <GameToolMemoryContext.Provider value={memory}>
      <TerritoryNetwork
        game={game}
        {...controls}
        onBuildFacility={onBuildFacility}
      />
    </GameToolMemoryContext.Provider>,
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Inspect Valley Electric territory" }),
  );
  const detail = screen.getByRole("region", { name: "Selected territory" });
  expect(detail).toHaveTextContent("Champlain → Valley Electric");
  expect(
    within(detail).getByRole("button", {
      name: /^Inspect Champlain ↔ Valley,/,
    }),
  ).toHaveAccessibleName(/50MW of 100MW/);
  expect(
    within(detail).getByRole("meter", {
      name: "Valley Electric connection utilization",
    }),
  ).toHaveAttribute("value", "50000000");
  fireEvent.click(
    within(detail).getByRole("button", { name: "Build in Valley Electric" }),
  );
  expect(onBuildFacility).toHaveBeenCalledWith("valley-electric", false);
  expect(memory.get(TERRITORY_BUILD_MEMORY_KEY)).toBe("valley-electric");
});

it("passes the selected owned territory on purchases and blocks oversized or exhausted projects", async () => {
  let game = ownedValley();
  const onBuildGenerator = jest.fn();
  const view = render(
    <BuildGenerators
      game={game}
      onBuildGenerator={onBuildGenerator}
      onBack={jest.fn()}
    />,
  );
  fireEvent.mouseDown(
    screen.getByRole("combobox", { name: "Build destination" }),
  );
  fireEvent.click(screen.getByRole("option", { name: "Valley Electric" }));
  const slider = screen.getByRole("slider");
  fireEvent.change(slider, { target: { value: wToSliderTick(400e6) } });
  const review = () =>
    screen.getByRole("button", { name: "Review purchase of Natural Gas CC" });
  expect(review()).toBeDisabled();
  expect(
    screen.getAllByText(
      "This project exceeds the territory’s per-site power limit.",
    ).length,
  ).toBeGreaterThan(0);
  fireEvent.change(slider, { target: { value: wToSliderTick(10e6) } });
  fireEvent.click(review());
  expect(screen.getByRole("dialog")).toHaveTextContent(
    "Build in Valley Electric",
  );
  fireEvent.click(screen.getByRole("button", { name: "Pay cash" }));
  expect(onBuildGenerator).toHaveBeenCalledWith(
    expect.objectContaining({ name: "Natural Gas CC" }),
    false,
    "valley-electric",
  );
  await waitForElementToBeRemoved(() => screen.queryByRole("dialog"));
  const plant = game.facilities.find(
    (facility) => facility.fuel === "Natural Gas",
  )!;
  const remaining = territorySiteInventory(
    game,
    "valley-electric",
    "industrial",
  ).remaining;
  game = {
    ...game,
    facilities: [
      ...game.facilities,
      ...Array.from({ length: remaining }, (_, index) => ({
        ...plant,
        id: 1000 + index,
        territoryId: "valley-electric" as const,
      })),
    ],
  };
  view.rerender(
    <BuildGenerators
      game={game}
      onBuildGenerator={onBuildGenerator}
      onBack={jest.fn()}
    />,
  );
  expect(review()).toBeDisabled();
  expect(
    screen.getAllByText("No sites of this type remain in this territory.")
      .length,
  ).toBeGreaterThan(0);
});

it("caps storage by local power and sends its selected destination to the purchase action", () => {
  const game = ownedValley();
  game.date.year = 2020;
  const memory = new Map<string, unknown>([
    [TERRITORY_BUILD_MEMORY_KEY, "valley-electric"],
  ]);
  const onBuildStorage = jest.fn();
  render(
    <GameToolMemoryContext.Provider value={memory}>
      <BuildStorage
        game={game}
        onBuildStorage={onBuildStorage}
        onBack={jest.fn()}
      />
    </GameToolMemoryContext.Provider>,
  );
  const slider = screen.getByRole("slider");
  fireEvent.change(slider, { target: { value: wToSliderTick(800e6) } });
  const review = screen.getByRole("button", {
    name: "Review purchase of Lithium Battery",
  });
  expect(review).toBeDisabled();
  fireEvent.change(slider, { target: { value: wToSliderTick(40e6) } });
  fireEvent.click(review);
  expect(screen.getByRole("dialog")).toHaveTextContent(
    "Storage charges and supplies customers in its territory.",
  );
  fireEvent.click(screen.getByRole("button", { name: "Pay cash" }));
  expect(onBuildStorage).toHaveBeenCalledWith(
    expect.objectContaining({ name: "Battery", peakW: 10e6 }),
    false,
    "valley-electric",
  );
});

it("restores a supported tier when switching from another connection catalogue to Green Uplands", () => {
  const game = network();
  const memory = new Map<string, unknown>();
  const view = render(
    <GameToolMemoryContext.Provider value={memory}>
      <TransmissionPanel
        game={game}
        {...controls}
        projectsOnly
        corridorIds={["vt-champlain-valley"]}
      />
    </GameToolMemoryContext.Provider>,
  );
  fireEvent.change(screen.getByRole("slider", { name: /Construction tier/ }), {
    target: { value: 2 },
  });
  expect(
    screen.getByRole("slider", { name: /Construction tier/ }),
  ).toHaveAttribute("aria-valuenow", "2");
  view.unmount();
  const onBuild = jest.fn();
  render(
    <GameToolMemoryContext.Provider value={memory}>
      <TerritoryNetwork game={game} {...controls} onBuild={onBuild} />
    </GameToolMemoryContext.Provider>,
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Inspect Green Uplands territory" }),
  );
  const detail = screen.getByRole("region", { name: "Selected territory" });
  expect(
    within(detail).getByRole("slider", { name: /Construction tier/ }),
  ).toHaveAttribute("aria-valuenow", "1");
  const review = within(detail).getByRole("button", {
    name: /Review purchase of .*Green Uplands/,
  });
  expect(review).toBeEnabled();
  fireEvent.click(review);
  fireEvent.click(
    within(screen.getByRole("dialog")).getByRole("button", {
      name: "Pay cash",
    }),
  );
  expect(onBuild).toHaveBeenCalledWith("vt-champlain-uplands", false, 1);
});

it("reviews an acquired corridor upgrade using physical capacity in both directions", () => {
  render(<TerritoryNetwork game={ownedValley()} {...controls} />);
  fireEvent.click(
    screen.getByRole("button", { name: "Inspect Valley Electric territory" }),
  );
  const detail = screen.getByRole("region", { name: "Selected territory" });
  fireEvent.click(
    within(detail).getByRole("button", {
      name: /^Inspect Champlain ↔ Valley,/,
    }),
  );
  fireEvent.click(
    within(detail).getByRole("button", {
      name: "Review upgrade of Champlain ↔ Valley",
    }),
  );
  const dialog = screen.getByRole("dialog");
  expect(dialog).toHaveTextContent("Power to Champlain100MW → 150MW");
  expect(dialog).toHaveTextContent("Power from Champlain100MW → 150MW");
});

it.each(["project", "review"] as const)(
  "shows the Green Uplands physical capacity in the %s facts",
  (surface) => {
    render(<TerritoryNetwork game={network()} {...controls} />);
    fireEvent.click(
      screen.getByRole("button", { name: "Inspect Green Uplands territory" }),
    );
    let facts = screen.getByRole("region", { name: "Selected territory" });
    if (surface === "review") {
      fireEvent.click(
        within(facts).getByRole("button", {
          name: /Review purchase of .*Green Uplands/,
        }),
      );
      facts = screen.getByRole("dialog");
    }
    expect(facts).toHaveTextContent("Power to Champlain120MW");
    expect(facts).toHaveTextContent("Power from Champlain120MW");
  },
);
